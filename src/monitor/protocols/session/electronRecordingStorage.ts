import { BTTreeModel, RecordingSession, RecordingSnapshot, TransitionEvent } from '../../types/bt';
import { compactRecordingRecords } from './recordingCompactor';
import {
  RecordingSessionMetadata,
  RecordingStorageAdapter,
  RecordingStorageRecord,
} from './recordingStorage';

interface ElectronRecordingStorageBridge {
  startSession(sessionId: string, initialTrees: BTTreeModel[], metadata: RecordingSessionMetadata): Promise<void>;
  appendBatch(sessionId: string, records: RecordingStorageRecord[]): Promise<void>;
  finalize(sessionId: string, finalTrees?: BTTreeModel[]): Promise<string>;
  readRecords(sessionId: string): Promise<RecordingStorageRecord[]>;
  deleteSession(sessionId: string): Promise<void>;
  updateHeartbeat?(sessionId: string, timestamp: number): Promise<void>;
}

const getBridge = (): ElectronRecordingStorageBridge => {
  const bridge = (globalThis as { window?: { electronAPI?: { recordingStorage?: ElectronRecordingStorageBridge } } })
    .window?.electronAPI?.recordingStorage;
  if (!bridge) {
    throw new Error('Electron recording storage is unavailable');
  }
  return bridge;
};

export class ElectronRecordingStorage implements RecordingStorageAdapter {
  private readonly batchSize = 50;
  private readonly flushIntervalMs = 100;
  private sessionId: string | null = null;
  private pendingRecords: RecordingStorageRecord[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private flushPromise: Promise<void> | null = null;
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

  async startSession(
    sessionId: string,
    initialTrees: BTTreeModel[],
    metadata: RecordingSessionMetadata,
  ): Promise<void> {
    await getBridge().startSession(sessionId, initialTrees, metadata);
    this.sessionId = sessionId;
    this.pendingRecords = [];
    this.flushChain = Promise.resolve();
    this.flushPromise = null;
  }

  appendEvent(event: TransitionEvent): void {
    this.enqueue({ kind: 'event', event });
  }

  appendSnapshot(snapshot: RecordingSnapshot): void {
    this.enqueue({ kind: 'snapshot', snapshot });
  }

  async finalize(finalTrees?: BTTreeModel[]): Promise<RecordingSession | null> {
    if (!this.sessionId) {
      throw new Error('Cannot finalize recording without an active session');
    }
    const sessionId = this.sessionId;
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    await getBridge().finalize(sessionId, finalTrees);
    const records = await getBridge().readRecords(sessionId);
    this.sessionId = null;
    return compactRecordingRecords(records);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await getBridge().deleteSession(sessionId);
    if (this.sessionId === sessionId) {
      this.sessionId = null;
      this.pendingRecords = [];
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
    const records = await getBridge().readRecords(this.sessionId);
    if (records.length === 0) return null;
    return compactRecordingRecords(records);
  }

  /**
   * Returns record counts directly from persistent disk storage.
   */
  async getRecordCounts(sessionId?: string): Promise<{ events: number; snapshots: number; executions: number; total: number }> {
    const targetId = sessionId || this.sessionId;
    if (!targetId) return { events: 0, snapshots: 0, executions: 0, total: 0 };
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    const records = await getBridge().readRecords(targetId);
    let events = 0;
    let snapshots = 0;
    for (const r of records) {
      if (r.kind === 'event') events++;
      else if (r.kind === 'snapshot') snapshots++;
    }
    return { events, snapshots, executions: 0, total: records.length };
  }

  /**
   * Reads a bounded slice of events directly from disk.
   */
  async readEventRange(sessionId: string, startIndex: number, count: number): Promise<TransitionEvent[]> {
    while (this.pendingRecords.length > 0 || this.flushPromise) {
      await this.flush();
    }
    const records = await getBridge().readRecords(sessionId);
    return records
      .filter((r): r is Extract<RecordingStorageRecord, { kind: 'event' }> => r.kind === 'event')
      .slice(startIndex, startIndex + count)
      .map((r) => r.event);
  }

  async updateHeartbeat(sessionId: string, timestamp: number): Promise<void> {
    const bridge = getBridge();
    if (bridge.updateHeartbeat) {
      await bridge.updateHeartbeat(sessionId, timestamp);
    }
  }

  private enqueue(record: RecordingStorageRecord): void {
    if (!this.sessionId) {
      throw new Error('Cannot append to recording without an active session');
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
    if (!this.sessionId || this.pendingRecords.length === 0) return Promise.resolve();

    const sessionId = this.sessionId;
    const records = this.pendingRecords;
    this.pendingRecords = [];
    this.flushPromise = this.flushChain
      .then(() => getBridge().appendBatch(sessionId, records))
      .finally(() => {
        this.flushPromise = null;
      });
    this.flushChain = this.flushPromise;
    return this.flushPromise;
  }
}
