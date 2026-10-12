import {
  ProtocolSource,
  ProtocolSessionState,
  IProtocolHandler,
  ProtocolCapabilities,
} from "./types";
import {
  btickHandler,
  createInitialBTickSession,
  BTICK_CAPABILITIES,
} from "./btick";
import {
  groot2Handler,
  createInitialGroot2Session,
  GROOT2_CAPABILITIES,
} from "./groot2";
import {
  nav2Handler,
  createInitialNav2Session,
  NAV2_CAPABILITIES,
} from "./nav2";

export const PROTOCOL_HANDLERS: Record<ProtocolSource, IProtocolHandler> = {
  btick: btickHandler,
  groot2: groot2Handler,
  nav2: nav2Handler,
};

export const PROTOCOL_CAPABILITIES: Record<
  ProtocolSource,
  ProtocolCapabilities
> = {
  btick: BTICK_CAPABILITIES,
  groot2: GROOT2_CAPABILITIES,
  nav2: NAV2_CAPABILITIES,
};

export const getProtocolHandler = (
  protocol: ProtocolSource,
): IProtocolHandler => {
  return PROTOCOL_HANDLERS[protocol] || btickHandler;
};

export const getProtocolCapabilities = (
  protocol: ProtocolSource,
): ProtocolCapabilities => {
  return PROTOCOL_CAPABILITIES[protocol] || BTICK_CAPABILITIES;
};

export const detectMessageProtocol = (data: any): ProtocolSource => {
  if (!data) return "btick";
  if (data.source === "groot2" || data.protocol === "groot2") return "groot2";
  if (data.source === "nav2" || data.protocol === "nav2") return "nav2";
  if (data.source === "btick" || data.protocol === "btick") return "btick";
  if (
    data.tree_id?.toLowerCase().includes("nav2") ||
    data.tree_name?.toLowerCase().includes("nav2")
  )
    return "nav2";
  if (
    data.tree_id?.toLowerCase().includes("groot") ||
    data.tree_name?.toLowerCase().includes("groot")
  )
    return "groot2";
  return "btick";
};

export const createInitialSessions = (): Record<
  ProtocolSource,
  ProtocolSessionState
> => ({
  btick: createInitialBTickSession(),
  groot2: createInitialGroot2Session(),
  nav2: createInitialNav2Session(),
});

export const routeIncomingMessage = (
  data: any,
  sessions: Record<ProtocolSource, ProtocolSessionState>,
  sendCommand: (cmd: any) => void,
): Record<ProtocolSource, ProtocolSessionState> => {
  const targetProtocol = detectMessageProtocol(data);
  if (data && typeof data === "object") {
    if (!data.source) data.source = targetProtocol;
    if (!data.protocol) data.protocol = targetProtocol;
  }
  const handler = getProtocolHandler(targetProtocol);
  const currentSession =
    sessions[targetProtocol] ||
    (targetProtocol === "groot2"
      ? createInitialGroot2Session()
      : targetProtocol === "nav2"
        ? createInitialNav2Session()
        : createInitialBTickSession());

  const updatedSession = handler.handleMessage(
    data,
    currentSession,
    sendCommand,
  );

  return {
    ...sessions,
    [targetProtocol]: updatedSession,
  };
};
