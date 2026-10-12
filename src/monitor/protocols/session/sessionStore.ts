import {
  BTTreeModel,
  RecordingSession,
  RecordingSnapshot,
  TransitionEvent,
} from "../../types/bt";
import {
  RecordingSessionMetadata,
  RecordingStorageAdapter,
} from "./recordingStorage";
import { createRecordingStorage } from "./createRecordingStorage";

/** How often the store logs a heartbeat tick (milliseconds). */
export const SESSION_STORE_HEARTBEAT_INTERVAL_MS = 10_000;

/** How old (ms) a session's last activity must be before it is considered orphaned. */
export const SESSION_STORE_ORPHAN_THRESHOLD_MS = 60_000;

/** Timeout (ms) for awaiting SessionStore startup during export/finalization. */
export const SESSION_STORE_STARTUP_TIMEOUT_MS = 5_000;

/**
 * Number of events in a replay session that triggers the large-session warning banner.
 * The warning is informational only and does NOT block replay.
 */
export const SESSION_STORE_REPLAY_WARNING_THRESHOLD = 20_000;

interface StartupQueueEntry {
  kind: "event" | "snapshot";
  event?: TransitionEvent;
  snapshot?: RecordingSnapshot;
}

/**
 * SessionStore wraps RecordingStorageAdapter to provide always-on unbounded
 * session history for both live monitoring and recording.
 *
 * Key guarantees:
 *  - appendEvent / appendSnapshot are non-blocking and never throw.
 *  - exportSession() is NON-DESTRUCTIVE: flushes + reads + compacts without
 *    deleting or closing the session. Safe to call mid-session.
 *  - finalizeSession() is DESTRUCTIVE and IDEMPOTENT: flushes, writes footer,
 *    reads, compacts, deletes storage, resets internal state. Calling it a
 *    second time returns null without error.
 *  - dispose() deletes storage and resets state without exporting.
 *  - Storage quota failures put the store in degraded mode: live monitoring
 *    continues normally; only persistence is lost.
 */
export class SessionStore {
  private adapter: RecordingStorageAdapter | null = null;
  private _sessionId: string | null = null;
  private _isReady = false;
  private _degraded = false;
  private finalized = false;
  private startupQueue: StartupQueueEntry[] = [];
  private startPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  get sessionId(): string | null {
    return this._sessionId;
  }
  get isReady(): boolean {
    return this._isReady;
  }
  get degraded(): boolean {
    return this._degraded;
  }

  /**
   * Start a new session. If a session is already active it is disposed first.
   * Returns a promise that resolves once the adapter is ready (or degraded).
   * Guards against concurrent duplicate calls for the same session ID.
   */
  async startSession(
    sessionId: string,
    initialTrees: BTTreeModel[],
    metadata: RecordingSessionMetadata,
    customAdapter?: RecordingStorageAdapter,
  ): Promise<void> {
    // If startSession is already in flight for this exact session, reuse existing promise
    if (this.startPromise && this._sessionId === sessionId) {
      return this.startPromise;
    }
    // If already started and ready for this exact session, no-op
    if (this._isReady && this._sessionId === sessionId) {
      return;
    }

    // Tear down any prior session first
    if (this._sessionId || this.adapter) {
      await this.dispose();
    }

    this._sessionId = sessionId;
    this._isReady = false;
    this._degraded = false;
    this.finalized = false;
    this.startupQueue = [];

    const adapter = customAdapter || createRecordingStorage();
    this.adapter = adapter;

    this.startPromise = (async () => {
      try {
        await adapter.startSession(sessionId, initialTrees, metadata);
        this._isReady = true;

        // Flush events that arrived before the adapter was ready
        for (const entry of this.startupQueue) {
          try {
            if (entry.kind === "event" && entry.event) {
              adapter.appendEvent(entry.event);
            } else if (entry.kind === "snapshot" && entry.snapshot) {
              adapter.appendSnapshot(entry.snapshot);
            }
          } catch (flushErr) {
            console.error(
              "[BTick][SessionStore] Failed to flush startup queue entry:",
              flushErr,
            );
          }
        }
        this.startupQueue = [];
        console.debug(
          "[BTick][SessionStore] Session started; startup queue flushed.",
          { sessionId },
        );
      } catch (err) {
        this._degraded = true;
        this.startupQueue = [];
        const isQuota =
          err instanceof DOMException &&
          (err.name === "QuotaExceededError" || err.code === 22);
        if (isQuota) {
          console.warn(
            "[BTick][SessionStore] Storage quota exceeded; degraded mode.",
            err,
          );
        } else {
          console.error(
            "[BTick][SessionStore] Failed to start session; degraded mode.",
            err,
          );
        }
      } finally {
        this.startPromise = null;
      }
    })();

    this.heartbeatTimer = setInterval(() => {
      this.updateHeartbeat();
    }, SESSION_STORE_HEARTBEAT_INTERVAL_MS);

    await this.startPromise;
  }

  /**
   * Enqueue a transition event for storage. Non-blocking — never throws.
   * Events that arrive before the adapter is ready go into the startup queue.
   */
  appendEvent(event: TransitionEvent): void {
    if (this._degraded) return;
    if (!this._isReady) {
      this.startupQueue.push({ kind: "event", event });
      return;
    }
    try {
      this.adapter?.appendEvent(event);
    } catch (err) {
      console.error("[BTick][SessionStore] appendEvent failed:", err);
    }
  }

  /**
   * Enqueue a snapshot for storage. Non-blocking — never throws.
   */
  appendSnapshot(snapshot: RecordingSnapshot): void {
    if (this._degraded) return;
    if (!this._isReady) {
      this.startupQueue.push({ kind: "snapshot", snapshot });
      return;
    }
    try {
      this.adapter?.appendSnapshot(snapshot);
    } catch (err) {
      console.error("[BTick][SessionStore] appendSnapshot failed:", err);
    }
  }

  /**
   * NON-DESTRUCTIVE export.
   * Flushes pending writes then reads and compacts all records from storage
   * WITHOUT deleting them. The session remains active and continues accepting
   * new events after this call. Safe to call multiple times.
   */
  async exportSession(
    startupTimeoutMs: number = SESSION_STORE_STARTUP_TIMEOUT_MS,
  ): Promise<RecordingSession | null> {
    if (this._degraded || !this.adapter || !this._sessionId) return null;

    // Wait for startup if still in progress with timeout
    if (this.startPromise) {
      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `SessionStore startup timed out after ${startupTimeoutMs}ms`,
            ),
          );
        }, startupTimeoutMs);
      });
      try {
        await Promise.race([this.startPromise, timeoutPromise]);
      } catch (err) {
        console.error(
          "[BTick][SessionStore] exportSession startup wait failed:",
          err,
        );
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (this._degraded || !this.adapter) return null;

    try {
      if (typeof this.adapter.readSession === "function") {
        return await this.adapter.readSession();
      }
      return null;
    } catch (err) {
      console.error("[BTick][SessionStore] exportSession failed:", err);
      throw err;
    }
  }

  /**
   * Reads record counts directly from disk storage.
   */
  async getRecordCounts(): Promise<{
    events: number;
    snapshots: number;
    executions: number;
    total: number;
  }> {
    if (this._degraded || !this.adapter || !this._sessionId) {
      return { events: 0, snapshots: 0, executions: 0, total: 0 };
    }
    if (typeof this.adapter.getRecordCounts === "function") {
      return await this.adapter.getRecordCounts(this._sessionId);
    }
    return { events: 0, snapshots: 0, executions: 0, total: 0 };
  }

  /**
   * Reads a bounded event slice directly from disk storage.
   */
  async readEventRange(
    startIndex: number,
    count: number,
  ): Promise<TransitionEvent[]> {
    if (this._degraded || !this.adapter || !this._sessionId) {
      return [];
    }
    if (typeof this.adapter.readEventRange === "function") {
      return await this.adapter.readEventRange(
        this._sessionId,
        startIndex,
        count,
      );
    }
    return [];
  }

  /**
   * DESTRUCTIVE finalization — idempotent.
   * Flushes pending writes, writes a footer record, reads and compacts all
   * records, deletes the session from storage, and resets internal state.
   * Calling this a second time returns null without error.
   */
  async finalizeSession(
    finalTrees?: BTTreeModel[],
  ): Promise<RecordingSession | null> {
    if (this.finalized) {
      console.warn(
        "[BTick][SessionStore] finalizeSession() called on already-finalized session; returning null.",
      );
      return null;
    }
    this.finalized = true;
    this.stopHeartbeat();

    if (this._degraded || !this.adapter || !this._sessionId) {
      this.reset();
      return null;
    }

    // Wait for startup if still pending
    if (this.startPromise) {
      let timeoutId: any;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, SESSION_STORE_STARTUP_TIMEOUT_MS);
      });
      try {
        await Promise.race([this.startPromise, timeoutPromise]);
      } catch (_) {
        /* already logged */
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (this._degraded || !this.adapter) {
      this.reset();
      return null;
    }

    const adapter = this.adapter;
    const sessionId = this._sessionId;

    try {
      const session = await adapter.finalize(finalTrees);
      console.debug("[BTick][SessionStore] Session finalized.", {
        sessionId,
        events: session?.events?.length ?? 0,
      });
      this.reset();
      return session;
    } catch (err) {
      console.error("[BTick][SessionStore] finalizeSession failed:", err);
      this.reset();
      return null;
    }
  }

  /**
   * Dispose the current session WITHOUT exporting.
   * Deletes the storage entry and resets state.
   * Used when a new tree/protocol session starts and the previous session is no
   * longer needed, or on component unmount.
   */
  async dispose(
    timeoutMs: number = SESSION_STORE_STARTUP_TIMEOUT_MS,
  ): Promise<void> {
    this.stopHeartbeat();

    if (this.startPromise) {
      let timeoutId: any;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      });
      try {
        await Promise.race([this.startPromise, timeoutPromise]);
      } catch (_) {
        /* already logged */
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (this.adapter && this._sessionId) {
      try {
        await this.adapter.deleteSession(this._sessionId);
      } catch (err) {
        console.error(
          "[BTick][SessionStore] dispose deleteSession failed:",
          err,
        );
      }
    }

    if (this.adapter?.dispose) {
      try {
        await this.adapter.dispose();
      } catch (_) {
        /* ignore */
      }
    }

    this.reset();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private reset(): void {
    this.adapter = null;
    this._sessionId = null;
    this._isReady = false;
    this._degraded = false;
    this.startupQueue = [];
    this.startPromise = null;
    // finalized stays as-is; the store is now fully idle
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private updateHeartbeat(): void {
    if (this._sessionId && this.adapter && this._isReady) {
      try {
        void this.adapter.updateHeartbeat?.(this._sessionId, Date.now());
      } catch (err) {
        console.debug("[BTick][SessionStore] Heartbeat update error:", err);
      }
    }
  }
}
