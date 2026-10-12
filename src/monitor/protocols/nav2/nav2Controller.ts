import { BTTreeModel } from "../../types/bt";

/**
 * Isolated Command & Lifecycle Controller for Nav2 (Passive Mode)
 */
export class Nav2Controller {
  private sendCommand: (cmd: any) => void;

  constructor(sendCommand: (cmd: any) => void) {
    this.sendCommand = sendCommand;
  }

  public registerLoadedTree(tree: BTTreeModel) {
    this.sendCommand({
      action: "register_tree",
      tree,
      source: "nav2",
    });
  }

  public requestSampleTree() {
    this.sendCommand({
      type: "request_sample_tree",
      source: "nav2",
    });
  }
}
