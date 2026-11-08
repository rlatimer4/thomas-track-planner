/**
 * 2D geometry helpers.
 *
 * Coordinate system: millimetres, x to the right, y DOWN (screen/SVG convention).
 * Angles are degrees; heading 0 points along +x and positive angles rotate clockwise
 * on screen, so a positive turn is a RIGHT turn from the train's point of view.
 */

export interface Vec {
  x: number;
  y: number;
}

/** A position plus heading, and an elevation in track levels. */
export interface Pose extends Vec {
  dir: number;
  z: number;
}

export const DEG = Math.PI / 180;

export function normDeg(a: number): number {
  let r = a % 360;
  if (r < 0) r += 360;
  // snap tiny float noise so 359.9999999 becomes 0
  if (Math.abs(r - 360) < 1e-6) r = 0;
  return r;
}

/** Smallest signed difference a-b in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = normDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

export function rotate(v: Vec, deg: number): Vec {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dirVec(deg: number): Vec {
  return { x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) };
}

/** A rigid transform: rotate by `rot` degrees then translate by (x, y). */
export interface Transform {
  x: number;
  y: number;
  rot: number;
}

export function applyTransform(t: Transform, p: Vec): Vec {
  return add(rotate(p, t.rot), t);
}

/** One step of a track centre-line, expressed relative to the current heading. */
export type TurtleOp =
  | { kind: 'line'; len: number }
  /** Arc of radius r; `turn` degrees, positive = right turn, negative = left turn. */
  | { kind: 'arc'; r: number; turn: number };

/** A sampled point on a track centre-line. */
export interface Sample extends Vec {
  z: number;
}

/** Advance a pose through one turtle op, ignoring elevation. */
export function stepPose(p: Pose, op: TurtleOp): Pose {
  if (op.kind === 'line') {
    const d = dirVec(p.dir);
    return { x: p.x + d.x * op.len, y: p.y + d.y * op.len, dir: p.dir, z: p.z };
  }
  const s = Math.sign(op.turn) || 1;
  const h = p.dir * DEG;
  const center = { x: p.x + s * op.r * -Math.sin(h), y: p.y + s * op.r * Math.cos(h) };
  const end = add(center, rotate(sub(p, center), op.turn));
  return { x: end.x, y: end.y, dir: normDeg(p.dir + op.turn), z: p.z };
}

export function opLength(op: TurtleOp): number {
  return op.kind === 'line' ? op.len : Math.abs(op.turn) * DEG * op.r;
}

/**
 * Walk a list of ops from `start`, returning the end pose and centre-line samples
 * roughly every `step` mm. Elevation is interpolated linearly from zFrom to zTo
 * along the total length.
 */
export function walk(
  start: Pose,
  ops: TurtleOp[],
  zFrom: number,
  zTo: number,
  step = 10,
): { end: Pose; samples: Sample[]; length: number } {
  const total = ops.reduce((a, o) => a + opLength(o), 0);
  const samples: Sample[] = [];
  let pose: Pose = { ...start, z: zFrom };
  let travelled = 0;
  const zAt = (d: number) => (total === 0 ? zFrom : zFrom + (zTo - zFrom) * (d / total));
  samples.push({ x: pose.x, y: pose.y, z: zFrom });
  for (const op of ops) {
    const len = opLength(op);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) {
      const frac = i / n;
      const partial: TurtleOp =
        op.kind === 'line' ? { kind: 'line', len: len * frac } : { kind: 'arc', r: op.r, turn: op.turn * frac };
      const p = stepPose(pose, partial);
      samples.push({ x: p.x, y: p.y, z: zAt(travelled + len * frac) });
    }
    pose = stepPose(pose, op);
    travelled += len;
  }
  return { end: { ...pose, z: zTo }, samples, length: total };
}

/** Bounding box of a set of points. */
export function bbox(points: Vec[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
