import React, { useState } from "react";
import { BaseEdge, EdgeProps, getBezierPath } from "@xyflow/react";
import { getHierarchyEdgePath } from "../../shared/utils/hierarchyEdgePath";

export interface BTEditorEdgeData {
  sourceId: string;
  targetId: string;
  treeId: string;
  sourceFlowId?: string;
  targetFlowId?: string;
  isBeingDragged?: boolean;
  pathMode?: "orthogonal" | "bezier";
  onReconnect?: (
    edgeId: string,
    oldParentId: string,
    newParentId: string,
    childId: string,
    treeId: string,
  ) => void;
  onSelectEdge?: (
    edgeId: string,
    sourceId: string,
    targetId: string,
    treeId: string,
  ) => void;
  onStartEdgeDrag?: (
    event: React.MouseEvent,
    edgeInfo: {
      edgeId: string;
      sourceId: string;
      targetId: string;
      treeId: string;
      sourceFlowId: string;
      targetFlowId: string;
    },
  ) => void;
}

// Corridor offset mirrors BTMonitorEdge so editor and Monitor edges look identical.
// All sibling edges from the same parent exit through the same layout-direction corridor
// before fanning out to their respective child nodes.
const CORRIDOR_OFFSET = 40;

export const BTEditorEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  style = {},
  markerEnd,
  selected,
  data,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (
    sourceX == null ||
    sourceY == null ||
    targetX == null ||
    targetY == null
  ) {
    return null;
  }

  const edgePath = getHierarchyEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    offset: CORRIDOR_OFFSET,
  });
  const [bezierPath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const edgeData = (data || {}) as unknown as BTEditorEdgeData;
  const renderedPath = edgeData.pathMode === "bezier" ? bezierPath : edgePath;


  // Dragging directly from the edge/path to reconnect the parent to another node
  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    const cleanSource =
      edgeData.sourceId ||
      (source.includes(":::") ? source.split(":::").pop()! : source);
    const cleanChild =
      edgeData.targetId ||
      (target.includes(":::") ? target.split(":::").pop()! : target);

    if (edgeData.onStartEdgeDrag) {
      edgeData.onStartEdgeDrag(event, {
        edgeId: id,
        sourceId: cleanSource,
        targetId: cleanChild,
        treeId: edgeData.treeId,
        sourceFlowId: edgeData.sourceFlowId || source,
        targetFlowId: edgeData.targetFlowId || target,
      });
      return;
    }

    // Fallback: select edge
    edgeData.onSelectEdge?.(id, cleanSource, cleanChild, edgeData.treeId);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={renderedPath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected
            ? "#0284c7"
            : isHovered
              ? "#38bdf8"
              : style.stroke || "#64748b",
          strokeWidth: selected
            ? 3.5
            : isHovered
              ? 2.5
              : style.strokeWidth || 2,
          filter: selected
            ? "drop-shadow(0 0 6px rgba(2,132,199,0.7))"
            : isHovered
              ? "drop-shadow(0 0 4px rgba(56,189,248,0.5))"
              : undefined,
        }}
        interactionWidth={28}
      />

      {/* Invisible wider hit-area path for easy hovering, clicking, and dragging to reconnect */}
      <path
        d={renderedPath}
        fill="none"
        stroke="rgba(0,0,0,0.001)"
        strokeWidth={28}
        className="cursor-pointer"
        style={{ pointerEvents: "stroke" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          edgeData.onSelectEdge?.(
            id,
            edgeData.sourceId || source,
            edgeData.targetId || target,
            edgeData.treeId,
          );
        }}
      />

      {/* Small, clean connection points matching node handles (consistent appearance, never visually enlarged) */}
      {(isHovered || selected) && (
        <g className="pointer-events-none transition-opacity duration-150">
          <circle
            cx={sourceX}
            cy={sourceY}
            r={4.5}
            fill="#0284c7"
            stroke="#ffffff"
            strokeWidth={1.5}
            data-testid="edge-endpoint-source"
          />
          <circle
            cx={targetX}
            cy={targetY}
            r={4.5}
            fill="#0284c7"
            stroke="#ffffff"
            strokeWidth={1.5}
            data-testid="edge-endpoint-target"
          />
        </g>
      )}
    </>
  );
};
