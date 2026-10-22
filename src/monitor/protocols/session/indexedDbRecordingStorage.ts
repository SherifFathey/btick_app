import { DBSchema, IDBPDatabase, wrap } from "idb";
import {
  BTTreeModel,
  RecordingSession,
  RecordingSnapshot,
  TransitionEvent,
} from "../../types/bt";
import { compactRecordingRecords } from "./recordingCompactor";
import {
  RecordingSessionMetadata,
  RecordingStorageAdapter,
  RecordingStorageRecord,
} from "./recordingStorage";

interface RecordingDatabase extends DBSchema {
  records: {
    key: [string, number];
    value: {
      sessionId: string;
      sequence: number;
      record: RecordingStorageRecord;
    };
    indexes: {
      "by-session": string;
    };
  };
}

const DATABASE_NAME = "btick_sessions_v1";
const LEGACY_DATABASE_NAMES = ["rtick_sessions_v1", "bt_monitor_sessions_v1"];
const STORE_NAME = "records";
let nextConnectionId = 1;
let sharedDatabasePromise: Promise<IDBPDatabase<RecordingDatabase>> | null =
  null;
let sharedDatabase: IDBPDatabase<RecordingDatabase> | null = null;
let migrationAttempted = false;

const migrateLegacyDatabase = async (
  targetDb: IDBPDatabase<RecordingDatabase>,
) => {
  if (migrationAttempted || typeof indexedDB === "undefined") return;
  migrationAttempted = true;

  try {
    const dbs =
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : null;
    for (const legacyName of LEGACY_DATABASE_NAMES) {
      const hasLegacy = dbs ? dbs.some((db) => db.name === legacyName) : true;
      if (!hasLegacy) continue;

      await new Promise<void>((resolve) => {
        const legacyReq = indexedDB.open(legacyName);
        legacyReq.onerror = () => resolve();
        legacyReq.onsuccess = async () => {
          const legacyDb = legacyReq.result;
          if (!legacyDb.objectStoreNames.contains(STORE_NAME)) {
            legacyDb.close();
            resolve();
            return;
          }

          try {
            const tx = legacyDb.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = async () => {
              const rows = getAllReq.result;
              if (Array.isArray(rows) && rows.length > 0) {
                const targetTx = targetDb.transaction(STORE_NAME, "readwrite");
                for (const row of rows) {
                  targetTx.store.put(row);
                }
                await targetTx.done;
              }
              legacyDb.close();
              try {
                indexedDB.deleteDatabase(legacyName);
              } catch {
                // Ignore legacy cleanup errors
              }
              resolve();
            };
            getAllReq.onerror = () => {
              legacyDb.close();
              resolve();
            };
          } catch {
            legacyDb.close();
            resolve();
          }
        };
      });
    }
  } catch (err) {
    console.warn("[BTick][IDB] Legacy migration skipped/failed:", err);
  }
};

const openRecordingDatabase = (): Promise<IDBPDatabase<RecordingDatabase>> => {
  if (sharedDatabase) {
    return Promise.resolve(sharedDatabase);
  }
  if (sharedDatabasePromise) {
    return sharedDatabasePromise;
  }

  const connectionId = nextConnectionId++;
  sharedDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onblocked = (event) => {
      console.warn(
        `[BTick][IDB] [#${connectionId}] onblocked for ${DATABASE_NAME}`,
        event,
      );
    };

    request.onerror = (event) => {
      console.error(
        `[BTick][IDB] [#${connectionId}] onerror for ${DATABASE_NAME}`,
        request.error,
        event,
      );
      sharedDatabasePromise = null;
      reject(request.error || new Error("Failed to open IndexedDB database"));
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, {
            keyPath: ["sessionId", "sequence"],
          });
      if (store && !store.indexNames.contains("by-session")) {
        store.createIndex("by-session", "sessionId");
      }
    };

    request.onsuccess = async () => {
      const db = request.result;
      (db as any).__connectionId = connectionId;

      db.onversionchange = () => {
        console.warn(
          `[BTick][IDB] [#${connectionId}] onversionchange received; closing connection`,
        );
        db.close();
        sharedDatabase = null;
        sharedDatabasePromise = null;
      };
      db.onerror = (errEvent) => {
        console.error(
          `[BTick][IDB] [#${connectionId}] database error`,
          errEvent,
        );
      };
      const wrapped = wrap(db) as unknown as IDBPDatabase<RecordingDatabase>;
      (wrapped as any).__connectionId = connectionId;
      sharedDatabase = wrapped;

      // Migrate from bt_monitor_sessions_v1 in background if present
      void migrateLegacyDatabase(wrapped);

      resolve(wrapped);
    };
  });

  return sharedDatabasePromise;
};

export class IndexedDbRecordingStorage implements RecordingStorageAdapter {
  private readonly batchSize = 50;
  private readonly flushIntervalMs = 100;
  private databasePromise: Promise<IDBPDatabase<RecordingDatabase>> | null =
    null;
  private sessionId: string | null = null;
  private nextSequence = 0;
  private pendingRecords: RecordingStorageRecord[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private flushPromise: Promise<void> | null = null;
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

  async startSession(
    sessionId: string,
    initialTrees: BTTreeModel[],
    metadata: RecordingSessionMetadata,
  ): Promise<void> {
    if (this.sessionId) {
      throw new Error(`Recording session "${this.sessionId}" is already open`);
    }
    const database = await this.getDatabase();

    await database.put(STORE_NAME, {
      sessionId,
      sequence: 0,
      record: { kind: "header", sessionId, initialTrees, metadata },
    });
    this.sessionId = sessionId;
    this.nextSequence = 1;
    this.pendingRecords = [];
    this.flushChain = Promise.resolve();
    this.flushPromise = null;

    // Orphan cleanup in background, completely off the startup critical path
    queueMicrotask(() => {
      void this.cleanupOrphanSessions(60_000).catch((err) => {
        console.warn("[BTick][IDB] Orphan session cleanup error:", err);
      });
    });
  }

  appendEvent(event: TransitionEvent): void {
    this.enqueue({ kind: "event", event });
  }

  appendSnapshot(snapshot: RecordingSnapshot): void {
    this.enqueue({ kind: "snapshot", snapshot });
  }

  async finalize(finalTrees?: BTTreeModel[]): Promise<RecordingSession | null> {
    if (!this.sessionId) {
      throw new Error("Cannot finalize recording without an active session");
    }
    const sessionId = this.sessionId;
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    const database = await this.getDatabase();
    await database.put(STORE_NAME, {
      sessionId,
      sequence: this.nextSequence,
      record: { kind: "footer", finalTrees },
    });
    const records = await this.readRecords(sessionId);
    this.sessionId = null;
    const compacted = compactRecordingRecords(records);
    await this.dispose();
    return compacted;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const database = await this.getDatabase();
    const keys = await database.getAllKeysFromIndex(
      STORE_NAME,
      "by-session",
      sessionId,
    );
    if (keys.length > 0) {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      await Promise.all(keys.map((key) => transaction.store.delete(key)));
      await transaction.done;
    }
    if (this.sessionId === sessionId) {
      this.sessionId = null;
      this.pendingRecords = [];
      this.flushPromise = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    this.databasePromise = null;
    this.sessionId = null;
  }

  /**
   * NON-DESTRUCTIVE read. Flushes all pending writes then reads and compacts
   * the current session WITHOUT deleting or closing it. The session remains
   * active and continues to accept new events after this call.
   */
  async readSession(): Promise<RecordingSession | null> {
    if (!this.sessionId) return null;
    // Flush any pending records first
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    const records = await this.readRecords(this.sessionId);
    if (records.length === 0) return null;
    return compactRecordingRecords(records);
  }

  /**
   * Returns record counts directly from persistent disk storage.
   */
  async getRecordCounts(sessionId?: string): Promise<{
    events: number;
    snapshots: number;
    executions: number;
    total: number;
  }> {
    const targetId = sessionId || this.sessionId;
    if (!targetId) return { events: 0, snapshots: 0, executions: 0, total: 0 };
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    const database = await this.getDatabase();
    const rows = await database.getAllFromIndex(
      STORE_NAME,
      "by-session",
      targetId,
    );
    let events = 0;
    let snapshots = 0;
    for (const r of rows) {
      if (r.record.kind === "event") events++;
      else if (r.record.kind === "snapshot") snapshots++;
    }
    return { events, snapshots, executions: 0, total: rows.length };
  }

  /**
   * Reads a bounded slice of events directly from disk.
   */
  async readEventRange(
    sessionId: string,
    startIndex: number,
    count: number,
  ): Promise<TransitionEvent[]> {
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    const database = await this.getDatabase();
    const rows = await database.getAllFromIndex(
      STORE_NAME,
      "by-session",
      sessionId,
    );
    return rows
      .filter((r) => r.record.kind === "event")
      .sort((a, b) => a.sequence - b.sequence)
      .slice(startIndex, startIndex + count)
      .map(
        (r) =>
          (r.record as Extract<RecordingStorageRecord, { kind: "event" }>)
            .event,
      );
  }

  private async readRecords(
    sessionId: string,
  ): Promise<RecordingStorageRecord[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllFromIndex(
      STORE_NAME,
      "by-session",
      sessionId,
    );
    return rows
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => row.record);
  }

  private getDatabase(): Promise<IDBPDatabase<RecordingDatabase>> {
    return openRecordingDatabase();
  }

  /**
   * Updates the heartbeat timestamp in the session header record.
   */
  async updateHeartbeat(sessionId: string, timestamp: number): Promise<void> {
    const database = await this.getDatabase();
    const rows = await database.getAllFromIndex(
      STORE_NAME,
      "by-session",
      sessionId,
    );
    const headerRow = rows.find(
      (r) => r.sequence === 0 && r.record.kind === "header",
    );
    if (headerRow && headerRow.record.kind === "header") {
      headerRow.record.metadata = {
        ...headerRow.record.metadata,
        lastHeartbeatAt: timestamp,
      };
      await database.put(STORE_NAME, headerRow);
    }
  }

  /**
   * Cleans up orphaned sessions whose last heartbeat (or creation time if no heartbeat)
   * is older than the staleness threshold.
   */
  async cleanupOrphanSessions(
    stalenessThresholdMs: number = 60_000,
  ): Promise<void> {
    try {
      const database = await this.getDatabase();
      const transaction = database.transaction(STORE_NAME, "readonly");
      let cursor = await transaction.store.openCursor();
      const staleSessionIds: string[] = [];
      const now = Date.now();

      while (cursor) {
        const { sessionId, sequence, record } = cursor.value;
        if (
          sessionId !== this.sessionId &&
          sequence === 0 &&
          record.kind === "header" &&
          record.metadata
        ) {
          const lastHeartbeatAt = record.metadata.lastHeartbeatAt;
          const lastActivityTime =
            typeof lastHeartbeatAt === "number" &&
            Number.isFinite(lastHeartbeatAt)
              ? lastHeartbeatAt
              : new Date(record.metadata.recorded_at).getTime();
          const ageMs = now - lastActivityTime;

          if (
            Number.isFinite(lastActivityTime) &&
            ageMs > stalenessThresholdMs
          ) {
            staleSessionIds.push(sessionId);
          }
        }

        // Fast-forward cursor to next session to avoid reading events/snapshots
        if (!cursor) break;
        try {
          cursor = await cursor.continue([sessionId + "\uffff", 0]);
        } catch {
          if (cursor) {
            cursor = await cursor.continue();
          }
        }
      }

      for (const staleId of staleSessionIds) {
        await this.deleteSession(staleId);
      }
    } catch (err) {
      console.warn("[BTick][IDB] Orphan session cleanup error:", err);
    }
  }

  private enqueue(record: RecordingStorageRecord): void {
    if (!this.sessionId) {
      throw new Error("Cannot append to recording without an active session");
    }
    this.pendingRecords.push(record);
    if (this.pendingRecords.length >= this.batchSize) {
      if (this.flushTimeoutId) {
        clearTimeout(this.flushTimeoutId);
        this.flushTimeoutId = null;
      }
      void this.flush();
    } else if (!this.flushTimeoutId) {
      this.flushTimeoutId = setTimeout(() => {
        this.flushTimeoutId = null;
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  private flush(): Promise<void> {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }
    if (this.flushPromise) return this.flushPromise;
    if (!this.sessionId || this.pendingRecords.length === 0)
      return Promise.resolve();

    const sessionId = this.sessionId;
    const records = this.pendingRecords;
    const firstSequence = this.nextSequence;
    this.pendingRecords = [];
    this.nextSequence += records.length;
    this.flushPromise = this.flushChain
      .then(async () => {
        const database = await this.getDatabase();
        const transaction = database.transaction(STORE_NAME, "readwrite");
        records.forEach((record, index) => {
          transaction.store.put({
            sessionId,
            sequence: firstSequence + index,
            record,
          });
        });
        await transaction.done;
      })
      .finally(() => {
        this.flushPromise = null;
      });
    this.flushChain = this.flushPromise;
    return this.flushPromise;
  }
}

export const closeSharedRecordingDatabase = async (): Promise<void> => {
  if (sharedDatabase) {
    sharedDatabase.close();
    sharedDatabase = null;
    sharedDatabasePromise = null;
  }
};
