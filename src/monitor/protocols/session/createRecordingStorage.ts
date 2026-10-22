import { RecordingStorageAdapter } from "./recordingStorage";
import { ElectronRecordingStorage } from "./electronRecordingStorage";
import { IndexedDbRecordingStorage } from "./indexedDbRecordingStorage";

interface ElectronRecordingStorageMarker {
  startSession?: unknown;
  appendBatch?: unknown;
  finalize?: unknown;
  deleteSession?: unknown;
}

interface ElectronWindow extends Window {
  electronAPI?: {
    isElectron?: boolean;
    recordingStorage?: ElectronRecordingStorageMarker;
  };
}

export const hasElectronRecordingStorage = (): boolean => {
  const browserWindow = (globalThis as { window?: ElectronWindow }).window;
  const electronAPI = browserWindow?.electronAPI;
  const available = Boolean(
    electronAPI?.isElectron &&
    electronAPI.recordingStorage &&
    typeof electronAPI.recordingStorage.startSession === "function" &&
    typeof electronAPI.recordingStorage.appendBatch === "function" &&
    typeof electronAPI.recordingStorage.finalize === "function",
  );
  return available;
};

export interface RecordingStorageBackends {
  electron: RecordingStorageAdapter;
  browser: RecordingStorageAdapter;
}

export const createRecordingStorage = (
  backends?: Partial<RecordingStorageBackends>,
): RecordingStorageAdapter => {
  if (hasElectronRecordingStorage()) {
    return backends?.electron || new ElectronRecordingStorage();
  }
  return backends?.browser || new IndexedDbRecordingStorage();
};
