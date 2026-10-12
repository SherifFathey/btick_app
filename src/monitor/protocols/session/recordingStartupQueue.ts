import {
  RecordingStorageAdapter,
  RecordingStorageRecord,
} from "./recordingStorage";

export const appendOrQueueRecordingRecords = (
  adapter: RecordingStorageAdapter | null,
  ready: boolean,
  pending: RecordingStorageRecord[],
  records: RecordingStorageRecord[],
): void => {
  if (!ready || !adapter) {
    pending.push(...records);
    return;
  }
  for (const record of records) {
    if (record.kind === "event") adapter.appendEvent(record.event);
    if (record.kind === "snapshot") adapter.appendSnapshot(record.snapshot);
  }
};

export const flushQueuedRecordingRecords = (
  adapter: RecordingStorageAdapter,
  pending: RecordingStorageRecord[],
): void => {
  for (const record of pending) {
    if (record.kind === "event") adapter.appendEvent(record.event);
    if (record.kind === "snapshot") adapter.appendSnapshot(record.snapshot);
  }
  pending.length = 0;
};
