import React, { useState, useCallback } from "react";
import { BaseEdge, EdgeProps, getBezierPath } from "@xyflow/react";
import { getHierarchyEdgePath } from "../../shared/utils/hierarchyEdgePath";

const CORRIDOR_OFFSET = 40;

/**
 * Monitor edge — rendering matches BTEditorEdge exactly.
 *
 * Path geometry:
 *   - shared rounded orthogonal routing with offset=CORRIDOR_OFFSET
 *   - Shared corridor: source rank plus CORRIDOR_OFFSET (vertical)
 *                      or source column plus CORRIDOR_OFFSET (horizontal)
 *
 * Visual behaviour:
 *   - Hover: lighter stroke (#38bdf8) + drop shadow + endpoint circles
 *   - Selected: blue stroke (#0284c7) + stronger glow + endpoint circles
 *   - Fixed interactionWidth=28 on BaseEdge interaction path
 *   - Visible path has pointerEvents: "none" so stroke-width changes never shift hit area
 *   - Endpoint circles remain permanently in DOM with opacity transition (no DOM mutation thrashing)
 *
 * Runtime-specific behaviour (preserved from dagreLayout):
 *   - Stroke color and width come from edge.style (set by dagreLayout per node status)
 *   - animated=true produces the CSS dash animation for RUNNING edges
 */
export const BTMonitorEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  animated,
  data,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

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
  const pathMode = data?.pathMode;
  const [bezierPath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const renderedPath = pathMode === "bezier" ? bezierPath : edgePath;

  // Base stroke color comes from dagreLayout (status-driven: green/red/amber/gray).
  // On hover/select we override it with the editor's blue-highlight convention.
  const baseStroke = style.stroke || "#64748b";
  const baseStrokeWidth = style.strokeWidth || 2;

  return (
    <g
      className={`react-flow__edge-custom group cursor-pointer ${selected ? "selected" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <BaseEdge
        id={id}
        path={renderedPath}
        markerEnd={markerEnd}
        className={animated ? "animated" : undefined}
        style={{
          ...style,
          stroke: selected
            ? "#0284c7"
            : isHovered
              ? "#38bdf8"
              : baseStroke,
          strokeWidth: selected
            ? 3.5
            : isHovered
              ? 2.5
              : baseStrokeWidth,
          filter: selected
            ? "drop-shadow(0 0 6px rgba(2,132,199,0.7))"
            : isHovered
              ? "drop-shadow(0 0 4px rgba(56,189,248,0.5))"
              : undefined,
          pointerEvents: "none",
        }}
        interactionWidth={28}
      />

      {/* Endpoint circles on hover/select — always in DOM with opacity transition to avoid DOM mutation thrashing */}
      <g
        className="pointer-events-none transition-opacity duration-150"
        style={{
          opacity: isHovered || selected ? 1 : 0,
          pointerEvents: "none",
        }}
      >
        <circle
          cx={sourceX}
          cy={sourceY}
          r={4.5}
          fill="#0284c7"
          stroke="#ffffff"
          strokeWidth={1.5}
        />
        <circle
          cx={targetX}
          cy={targetY}
          r={4.5}
          fill="#0284c7"
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      </g>
    </g>
  );
};

