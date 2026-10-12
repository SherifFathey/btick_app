import { ProtocolSessionState } from "../types";
import { SessionStore } from "./sessionStore";

export interface StorageDiagnosticsMetrics {
  heapUsed: string;
  heapTotal: string;
  rawHeapUsed: number;
  rawHeapTotal: number;

  ramEventCount: number;
  ramReplayEventCount: number;
  ramExecutionCount: number;
  ramKeyframeCount: number;
  ramSnapshotCount: number;

  diskEventCount: number;
  diskExecutionCount: number;
  diskKeyframeCount: number;
  diskSnapshotCount: number;
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getHeapUsage = (): {
  heapUsed: string;
  heapTotal: string;
  rawHeapUsed: number;
  rawHeapTotal: number;
} => {
  if (
    typeof process !== "undefined" &&
    typeof process.memoryUsage === "function"
  ) {
    const mem = process.memoryUsage();
    return {
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      rawHeapUsed: mem.heapUsed,
      rawHeapTotal: mem.heapTotal,
    };
  }

  if (typeof window !== "undefined" && (window.performance as any)?.memory) {
    const mem = (window.performance as any).memory;
    return {
      heapUsed: formatBytes(mem.usedJSHeapSize),
      heapTotal: formatBytes(mem.totalJSHeapSize),
      rawHeapUsed: mem.usedJSHeapSize,
      rawHeapTotal: mem.totalJSHeapSize,
    };
  }

  return {
    heapUsed: "N/A",
    heapTotal: "N/A",
    rawHeapUsed: 0,
    rawHeapTotal: 0,
  };
};

export async function collectStorageDiagnostics(
  sessions: Record<string, ProtocolSessionState>,
  treeStores: Map<string, { store: SessionStore } | SessionStore>,
): Promise<StorageDiagnosticsMetrics> {
  const heap = getHeapUsage();

  let ramEventCount = 0;
  let ramReplayEventCount = 0;
  let ramExecutionCount = 0;
  let ramKeyframeCount = 0;
  let ramSnapshotCount = 0;

  for (const sess of Object.values(sessions)) {
    if (sess.events) {
      ramEventCount += sess.events.length;
    }
    if (sess.treeEvents) {
      for (const evList of sess.treeEvents.values()) {
        ramEventCount += evList.length;
      }
    }
    if (sess.treeReplays) {
      for (const tr of sess.treeReplays.values()) {
        if (tr.events) {
          ramReplayEventCount += tr.events.length;
        }
        if (tr.session?.events) {
          ramReplayEventCount += tr.session.events.length;
        }
        if (tr.session?.snapshots) {
          ramSnapshotCount += tr.session.snapshots.length;
          ramKeyframeCount += tr.session.snapshots.length;
        }
        if (tr.session?.node_executions) {
          ramExecutionCount += tr.session.node_executions.length;
        }
      }
    }
  }

  let diskEventCount = 0;
  let diskExecutionCount = 0;
  let diskKeyframeCount = 0;
  let diskSnapshotCount = 0;

  for (const entry of treeStores.values()) {
    const store = "store" in entry ? entry.store : entry;
    if (store && typeof store.getRecordCounts === "function") {
      try {
        const counts = await store.getRecordCounts();
        diskEventCount += counts.events;
        diskSnapshotCount += counts.snapshots;
        diskKeyframeCount += counts.snapshots;
        diskExecutionCount += counts.executions;
      } catch (err) {
        console.warn(
          "[BTick][StorageDiagnostics] Error querying store counts:",
          err,
        );
      }
    }
  }

  return {
    heapUsed: heap.heapUsed,
    heapTotal: heap.heapTotal,
    rawHeapUsed: heap.rawHeapUsed,
    rawHeapTotal: heap.rawHeapTotal,

    ramEventCount,
    ramReplayEventCount,
    ramExecutionCount,
    ramKeyframeCount,
    ramSnapshotCount,

    diskEventCount,
    diskExecutionCount,
    diskKeyframeCount,
    diskSnapshotCount,
  };
}
