import { Position } from "@xyflow/react";

interface Point {
  x: number;
  y: number;
}

const DEFAULT_OFFSET = 40;
const DEFAULT_RADIUS = 8;

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

const simplifyPoints = (points: Point[]): Point[] => {
  const result: Point[] = [];

  points.forEach((point) => {
    if (result.length === 0 || !samePoint(result[result.length - 1], point)) {
      result.push(point);
    }
  });

  for (let i = result.length - 2; i > 0; i -= 1) {
    const previous = result[i - 1];
    const current = result[i];
    const next = result[i + 1];
    if (
      (previous.x === current.x && current.x === next.x) ||
      (previous.y === current.y && current.y === next.y)
    ) {
      result.splice(i, 1);
    }
  }

  return result;
};

const roundedOrthogonalPath = (
  points: Point[],
  radius: number,
): string => {
  const simplified = simplifyPoints(points);
  if (simplified.length < 2) return "";

  let path = `M ${simplified[0].x},${simplified[0].y}`;

  for (let i = 1; i < simplified.length - 1; i += 1) {
    const previous = simplified[i - 1];
    const current = simplified[i];
    const next = simplified[i + 1];
    const beforeDistance = Math.max(
      Math.abs(current.x - previous.x),
      Math.abs(current.y - previous.y),
    );
    const afterDistance = Math.max(
      Math.abs(next.x - current.x),
      Math.abs(next.y - current.y),
    );
    const bendRadius = Math.min(radius, beforeDistance / 2, afterDistance / 2);

    const before = {
      x: current.x + Math.sign(previous.x - current.x) * bendRadius,
      y: current.y + Math.sign(previous.y - current.y) * bendRadius,
    };
    const after = {
      x: current.x + Math.sign(next.x - current.x) * bendRadius,
      y: current.y + Math.sign(next.y - current.y) * bendRadius,
    };

    path += ` L ${before.x},${before.y} Q ${current.x},${current.y} ${after.x},${after.y}`;
  }

  const last = simplified[simplified.length - 1];
  path += ` L ${last.x},${last.y}`;
  return path;
};

/**
 * Routes hierarchy edges through the layout direction before turning toward
 * the child. The first corridor is anchored to the source rank, so siblings
 * cannot independently choose opposite directions.
 */
export const getHierarchyEdgePath = ({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  offset = DEFAULT_OFFSET,
  borderRadius = DEFAULT_RADIUS,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition?: Position;
  targetX: number;
  targetY: number;
  targetPosition?: Position;
  offset?: number;
  borderRadius?: number;
}): string => {
  const isHorizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;

  if (isHorizontal) {
    const direction = sourcePosition === Position.Left ? -1 : 1;
    const targetDirection = targetPosition === Position.Left ? -1 : 1;
    const sourceCorridor = { x: sourceX + direction * offset, y: sourceY };
    const targetCorridor = {
      x: targetX + targetDirection * offset,
      y: targetY,
    };

    return roundedOrthogonalPath(
      [
        { x: sourceX, y: sourceY },
        sourceCorridor,
        { x: sourceCorridor.x, y: targetCorridor.y },
        targetCorridor,
        { x: targetX, y: targetY },
      ],
      borderRadius,
    );
  }

  const direction = sourcePosition === Position.Top ? -1 : 1;
  const targetDirection = targetPosition === Position.Top ? -1 : 1;
  const sourceCorridor = { x: sourceX, y: sourceY + direction * offset };
  const targetCorridor = {
    x: targetX,
    y: targetY + targetDirection * offset,
  };

  return roundedOrthogonalPath(
    [
      { x: sourceX, y: sourceY },
      sourceCorridor,
      { x: targetCorridor.x, y: sourceCorridor.y },
      targetCorridor,
      { x: targetX, y: targetY },
    ],
    borderRadius,
  );
};
