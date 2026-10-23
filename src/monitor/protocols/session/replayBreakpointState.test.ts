import { describe, it, expect } from "vitest";
import {
  applySingleReplayEvent,
  getReplayNodeStatus,
  IncrementalKeyframeRecorder,
} from "./sessionManager";
import { BTNodeModel, BTTreeModel, TransitionEvent } from "../../types/bt";

describe("Replay Breakpoint and Node Status State Management", () => {
  const createBaseNode = (id: string, name: string): BTNodeModel => ({
    id,
    uid: 1,
    name,
    type: "Action",
    category: "Action",
    parent_id: "root",
    ports: {},
    attributes: {},
    status: "IDLE",
    is_paused: false,
    is_breakpoint: false,
    children_ids: [],
  });

  const createBaseTree = (
    treeId: string,
    nodes: BTNodeModel[],
  ): BTTreeModel => ({
    type: "tree",
    tree_id: treeId,
    tree_name: "TestTree",
    root_node_id: nodes[0]?.id || "root",
    status: "IDLE",
    nodes,
  });

  const createEvent = (
    treeId: string,
    nodeId: string,
    status: string,
    prevStatus?: string,
    timestamp: number = 1000,
    uid: number = 1,
  ): TransitionEvent => ({
    id: `evt_${timestamp}`,
    type: "transition",
    tree_id: treeId,
    tree_name: "TestTree",
    timestamp,
    node_id: nodeId,
    node_name: nodeId,
    status: status as any,
    prev_status: prevStatus as any,
    uid,
    duration: 0,
    tick_count: 0,
  });

  it("getReplayNodeStatus correctly handles RESUMED and standard states", () => {
    const node = createBaseNode("n1", "TestNode");
    node.last_result = "SUCCESS";

    expect(
      getReplayNodeStatus(
        node,
        createEvent("t1", "n1", "PAUSED_AT_BREAKPOINT"),
      ),
    ).toBe("PAUSED_AT_BREAKPOINT");
    expect(
      getReplayNodeStatus(
        node,
        createEvent("t1", "n1", "RESUMED", "PAUSED_AT_BREAKPOINT"),
      ),
    ).toBe("SUCCESS");

    node.last_result = undefined;
    expect(
      getReplayNodeStatus(
        node,
        createEvent("t1", "n1", "RESUMED", "PAUSED_AT_BREAKPOINT"),
      ),
    ).toBe("IDLE");

    expect(getReplayNodeStatus(node, createEvent("t1", "n1", "RUNNING"))).toBe(
      "RUNNING",
    );
    expect(getReplayNodeStatus(node, createEvent("t1", "n1", "SUCCESS"))).toBe(
      "SUCCESS",
    );
    expect(getReplayNodeStatus(node, createEvent("t1", "n1", "FAILURE"))).toBe(
      "FAILURE",
    );
  });

  it("handles full lifecycle via applySingleReplayEvent: IDLE -> PAUSED_AT_BREAKPOINT -> RESUMED -> RUNNING -> SUCCESS", () => {
    const tree = createBaseTree("t1", [
      createBaseNode("SaySomething_14", "SaySomething"),
    ]);
    const treeMap = new Map<string, BTTreeModel>([["t1", tree]]);
    const executionMap = new Map();

    // 1. Initial State
    expect(treeMap.get("t1")!.nodes[0].status).toBe("IDLE");
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(false);

    // 2. Node enters breakpoint pause
    const evtPause = createEvent(
      "t1",
      "SaySomething_14",
      "PAUSED_AT_BREAKPOINT",
      "RUNNING",
      1000,
    );
    applySingleReplayEvent(treeMap, evtPause, 0, executionMap);
    expect(treeMap.get("t1")!.nodes[0].status).toBe("PAUSED_AT_BREAKPOINT");
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(true);

    // 3. User resumes execution -> RESUMED event
    const evtResume = createEvent(
      "t1",
      "SaySomething_14",
      "RESUMED",
      "PAUSED_AT_BREAKPOINT",
      2000,
    );
    applySingleReplayEvent(treeMap, evtResume, 1, executionMap);
    expect(treeMap.get("t1")!.nodes[0].status).toBe("IDLE"); // falls back to last_result/IDLE
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(false); // pause cleared!

    // 4. Node runs -> RUNNING event
    const evtRunning = createEvent(
      "t1",
      "SaySomething_14",
      "RUNNING",
      "IDLE",
      3000,
    );
    applySingleReplayEvent(treeMap, evtRunning, 2, executionMap);
    expect(treeMap.get("t1")!.nodes[0].status).toBe("RUNNING");
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(false);

    // 5. Node completes -> SUCCESS event
    const evtSuccess = createEvent(
      "t1",
      "SaySomething_14",
      "SUCCESS",
      "RUNNING",
      4000,
    );
    applySingleReplayEvent(treeMap, evtSuccess, 3, executionMap);
    expect(treeMap.get("t1")!.nodes[0].status).toBe("SUCCESS");
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(false);
  });

  it("retains PAUSED_AT_BREAKPOINT and is_paused=true if recording ends while paused", () => {
    const tree = createBaseTree("t1", [createBaseNode("n1", "Node1")]);
    const treeMap = new Map<string, BTTreeModel>([["t1", tree]]);
    const executionMap = new Map();

    const evtRunning = createEvent("t1", "n1", "RUNNING", "IDLE", 1000);
    applySingleReplayEvent(treeMap, evtRunning, 0, executionMap);
    expect(treeMap.get("t1")!.nodes[0].status).toBe("RUNNING");
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(false);

    const evtPause = createEvent(
      "t1",
      "n1",
      "PAUSED_AT_BREAKPOINT",
      "RUNNING",
      2000,
    );
    applySingleReplayEvent(treeMap, evtPause, 1, executionMap);

    // Recording ends here
    expect(treeMap.get("t1")!.nodes[0].status).toBe("PAUSED_AT_BREAKPOINT");
    expect(treeMap.get("t1")!.nodes[0].is_paused).toBe(true);
  });

  it("IncrementalKeyframeRecorder correctly updates is_paused and status", () => {
    const tree = createBaseTree("t1", [createBaseNode("n1", "Node1")]);
    const recorder = new IncrementalKeyframeRecorder([tree]);

    const pauseEvt = createEvent(
      "t1",
      "n1",
      "PAUSED_AT_BREAKPOINT",
      "RUNNING",
      1000,
    );
    recorder.applyEvent(pauseEvt, 0);
    const updatedTree1 = recorder.treeMap.get("t1")!;
    expect(updatedTree1.nodes.find((n) => n.id === "n1")?.status).toBe(
      "PAUSED_AT_BREAKPOINT",
    );
    expect(updatedTree1.nodes.find((n) => n.id === "n1")?.is_paused).toBe(true);

    const resumeEvt = createEvent(
      "t1",
      "n1",
      "RESUMED",
      "PAUSED_AT_BREAKPOINT",
      2000,
    );
    recorder.applyEvent(resumeEvt, 1);
    const updatedTree2 = recorder.treeMap.get("t1")!;
    expect(updatedTree2.nodes.find((n) => n.id === "n1")?.status).not.toBe(
      "PAUSED_AT_BREAKPOINT",
    );
    expect(updatedTree2.nodes.find((n) => n.id === "n1")?.is_paused).toBe(
      false,
    );
  });

  it("seeking backward and forward recalculates deterministic replay state correctly", () => {
    const node = createBaseNode("n1", "Node1");
    const initialTree = createBaseTree("t1", [node]);

    const events: TransitionEvent[] = [
      createEvent("t1", "n1", "IDLE", undefined, 1000),
      createEvent("t1", "n1", "RUNNING", "IDLE", 2000),
      createEvent("t1", "n1", "PAUSED_AT_BREAKPOINT", "RUNNING", 3000),
      createEvent("t1", "n1", "RESUMED", "PAUSED_AT_BREAKPOINT", 4000),
      createEvent("t1", "n1", "RUNNING", "IDLE", 5000),
      createEvent("t1", "n1", "SUCCESS", "RUNNING", 6000),
    ];

    // Helper that simulates seeking to targetIndex from scratch / keyframe
    const seekTo = (targetIndex: number) => {
      const treeMap = new Map<string, BTTreeModel>([
        ["t1", JSON.parse(JSON.stringify(initialTree))],
      ]);
      const executionMap = new Map();
      for (let i = 0; i <= targetIndex; i++) {
        applySingleReplayEvent(treeMap, events[i], i, executionMap);
      }
      return treeMap.get("t1")!.nodes.find((n) => n.id === "n1")!;
    };

    // 1. Seek to index 2 (PAUSED_AT_BREAKPOINT)
    const atPause = seekTo(2);
    expect(atPause.status).toBe("PAUSED_AT_BREAKPOINT");
    expect(atPause.is_paused).toBe(true);

    // 2. Seek forward to index 4 (RUNNING after resume)
    const atRunning = seekTo(4);
    expect(atRunning.status).toBe("RUNNING");
    expect(atRunning.is_paused).toBe(false);

    // 3. Seek backward to index 2 (PAUSED_AT_BREAKPOINT)
    const backAtPause = seekTo(2);
    expect(backAtPause.status).toBe("PAUSED_AT_BREAKPOINT");
    expect(backAtPause.is_paused).toBe(true);

    // 4. Seek backward further to index 1 (RUNNING before pause)
    const atEarlyRunning = seekTo(1);
    expect(atEarlyRunning.status).toBe("RUNNING");
    expect(atEarlyRunning.is_paused).toBe(false);

    // 5. Seek forward to end (SUCCESS)
    const atEnd = seekTo(5);
    expect(atEnd.status).toBe("SUCCESS");
    expect(atEnd.is_paused).toBe(false);

    // Ensure raw events remain untouched (immutability check)
    expect(events[2].status).toBe("PAUSED_AT_BREAKPOINT");
    expect(events[3].status).toBe("RESUMED");
  });
});
