/**
 * Isolated Command Controller for BTick (ROS 2 Backend)
 */
export class BTickController {
  private sendCommand: (cmd: any) => void;

  constructor(sendCommand: (cmd: any) => void) {
    this.sendCommand = sendCommand;
  }

  public setBreakpoint(
    treeId: string,
    uid: number,
    enabled: boolean,
    once: boolean = false,
  ) {
    this.sendCommand({
      action: "set_breakpoint",
      tree_id: treeId,
      uid,
      enabled,
      once,
      source: "btick",
    });
  }

  public clearAllBreakpoints(treeId?: string) {
    this.sendCommand({
      action: "clear_all_breakpoints",
      tree_id: treeId || "ALL",
      source: "btick",
    });
  }

  public injectFault(
    treeId: string,
    uid: number,
    mode: string,
    delayMs: number = 0,
    once: boolean = false,
  ) {
    this.sendCommand({
      action: "inject_fault",
      tree_id: treeId,
      uid,
      mode,
      delay_ms: delayMs,
      once,
      source: "btick",
    });
  }

  public clearFault(treeId: string, uid: number) {
    this.sendCommand({
      action: "clear_fault",
      tree_id: treeId,
      uid,
      source: "btick",
    });
  }

  public clearAllFaults(treeId?: string) {
    this.sendCommand({
      action: "clear_all_faults",
      tree_id: treeId || "ALL",
      source: "btick",
    });
  }

  public resume(treeId?: string) {
    this.sendCommand({
      action: "resume",
      tree_id: treeId,
      source: "btick",
    });
  }

  public forceSuccess(treeId?: string) {
    this.sendCommand({
      action: "force_success",
      tree_id: treeId,
      source: "btick",
    });
  }

  public forceFailure(treeId?: string) {
    this.sendCommand({
      action: "force_failure",
      tree_id: treeId,
      source: "btick",
    });
  }
}
