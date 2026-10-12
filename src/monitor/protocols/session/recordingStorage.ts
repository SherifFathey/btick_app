import {
  BTTreeModel,
  RecordingSession,
  RecordingSnapshot,
  TransitionEvent,
} from "../../types/bt";

export interface RecordingSessionMetadata {
  name: string;
  recorded_at: string;
  lastHeartbeatAt?: number;
}

export interface RecordingHeaderRecord {
  kind: "header";
  sessionId: string;
  metadata: RecordingSessionMetadata;
  initialTrees: BTTreeModel[];
}

export interface RecordingEventRecord {
  kind: "event";
  event: TransitionEvent;
}

export interface RecordingSnapshotRecord {
  kind: "snapshot";
  snapshot: RecordingSnapshot;
}

export interface RecordingFooterRecord {
  kind: "footer";
  finalTrees?: BTTreeModel[];
}

export type RecordingStorageRecord =
  | RecordingHeaderRecord
  | RecordingEventRecord
  | RecordingSnapshotRecord
  | RecordingFooterRecord;

export interface RecordingStorageAdapter {
  startSession(
    sessionId: string,
    initialTrees: BTTreeModel[],
    metadata: RecordingSessionMetadata,
  ): Promise<void>;
  appendEvent(event: TransitionEvent): void | Promise<void>;
  appendSnapshot(snapshot: RecordingSnapshot): void | Promise<void>;
  finalize(finalTrees?: BTTreeModel[]): Promise<RecordingSession | null>;
  deleteSession(sessionId: string): Promise<void>;
  loadSession?(sessionId: string): Promise<RecordingSession | null>;
  /**
   * NON-DESTRUCTIVE read. Flushes all pending writes then reads and compacts
   * the current session WITHOUT deleting or finalizing it.
   * Returns null if no session is active or the adapter does not support it.
   */
  readSession?(): Promise<RecordingSession | null>;
  /**
   * Returns record counts directly from persistent disk storage.
   */
  getRecordCounts?(sessionId?: string): Promise<{
    events: number;
    snapshots: number;
    executions: number;
    total: number;
  }>;
  /**
   * Reads a bounded event range directly from disk.
   */
  readEventRange?(
    sessionId: string,
    startIndex: number,
    count: number,
  ): Promise<TransitionEvent[]>;
  /**
   * Updates the heartbeat timestamp for an active session.
   */
  updateHeartbeat?(sessionId: string, timestamp: number): Promise<void> | void;
  dispose?(): Promise<void>;
}
