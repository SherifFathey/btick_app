import {
  BTTreeModel,
  NodeStatus,
  RecordedNodeExecution,
  RecordingSession,
  RecordingSnapshot,
  TransitionEvent,
} from "../../types/bt";
import { RecordingStorageRecord } from "./recordingStorage";

const cloneTrees = (trees: BTTreeModel[]): BTTreeModel[] =>
  trees.map((tree) => ({
    ...tree,
    blackboard: tree.blackboard ? { ...tree.blackboard } : tree.blackboard,
    nodes: tree.nodes.map((node) => ({
      ...node,
      children_ids: [...node.children_ids],
      ports: { ...node.ports },
      attributes: { ...node.attributes },
      meta: node.meta ? { ...node.meta } : node.meta,
      port_details: node.port_details
        ? node.port_details.map((port) => ({ ...port }))
        : node.port_details,
      output_ports_values: node.output_ports_values
        ? { ...node.output_ports_values }
        : node.output_ports_values,
    })),
  }));

const buildNodeExecutions = (
  events: TransitionEvent[],
): RecordedNodeExecution[] => {
  const active = new Map<string, RecordedNodeExecution>();
  const executions: RecordedNodeExecution[] = [];

  events.forEach((event, eventIndex) => {
    const key = `${event.tree_id}::${event.uid}::${event.node_id}`;
    if (event.status === "RUNNING") {
      if (!active.has(key)) {
        active.set(key, {
          tree_id: event.tree_id,
          node_id: event.node_id,
          uid: event.uid,
          status: event.status,
          start_timestamp: event.timestamp,
          tick_count: event.tick_count,
          start_event_index: eventIndex,
        });
      }
      return;
    }

    if (
      event.status !== "SUCCESS" &&
      event.status !== "FAILURE" &&
      event.status !== "IDLE"
    ) {
      return;
    }

    const execution = active.get(key);
    if (!execution) return;

    executions.push({
      ...execution,
      status: event.status as NodeStatus,
      end_timestamp: event.timestamp,
      duration:
        event.duration > 0
          ? event.duration
          : Math.max(0, event.timestamp - execution.start_timestamp),
      tick_count: event.tick_count,
      end_event_index: eventIndex,
    });
    active.delete(key);
  });

  executions.push(...active.values());
  return executions;
};

export const compactRecordingRecords = (
  records: Iterable<RecordingStorageRecord>,
): RecordingSession | null => {
  let header: Extract<RecordingStorageRecord, { kind: "header" }> | undefined;
  let footer: Extract<RecordingStorageRecord, { kind: "footer" }> | undefined;
  const events: TransitionEvent[] = [];
  const seenEventKeys = new Set<string>();
  const snapshots: RecordingSnapshot[] = [];

  for (const record of records) {
    switch (record.kind) {
      case "header":
        header = record;
        break;
      case "event":
        {
          const event = { ...record.event };
          const eventKey = JSON.stringify(event);
          if (!seenEventKeys.has(eventKey)) {
            seenEventKeys.add(eventKey);
            events.push(event);
          }
        }
        break;
      case "snapshot":
        snapshots.push({
          ...record.snapshot,
          trees: cloneTrees(record.snapshot.trees),
        });
        break;
      case "footer":
        footer = record;
        break;
    }
  }

  if (!header) {
    throw new Error("Recording storage is missing its header record");
  }
  if (header.initialTrees.length === 0 && events.length === 0) {
    return null;
  }

  const initialTrees = cloneTrees(header.initialTrees);
  const finalTrees = footer?.finalTrees
    ? cloneTrees(footer.finalTrees)
    : snapshots.length > 0
      ? cloneTrees(snapshots[snapshots.length - 1].trees)
      : cloneTrees(initialTrees);

  return {
    id: header.sessionId,
    name: header.metadata.name,
    recorded_at: header.metadata.recorded_at,
    trees: finalTrees,
    events,
    snapshots,
    initial_trees: initialTrees,
    node_executions: buildNodeExecutions(events),
  };
};
