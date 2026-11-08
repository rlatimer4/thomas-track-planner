import type { Pose } from './geometry';
import type { Catalog } from './catalog';
import { attachPose, newUid, worldPorts, type PlacedPiece, type WorldPort } from './layout';

/** One step of a chain: attach `code` by `inPort`, continue from `outPort`. */
export interface ChainStep {
  code: string;
  inPort: string;
  outPort: string;
}

/** Place a single piece onto an open pose, returning the piece and its world ports. */
export function placeAt(cat: Catalog, target: Pose, code: string, inPort: string, uid = newUid()): { piece: PlacedPiece; ports: WorldPort[] } {
  const pose = attachPose(cat, target, code, inPort);
  const piece: PlacedPiece = { uid, code, ...pose };
  return { piece, ports: worldPorts(cat, piece) };
}

/**
 * Place a sequence of pieces end to end starting from an outward-facing pose
 * (the pose a piece's port would need to mate with).
 */
export function placeChain(cat: Catalog, start: Pose, steps: ChainStep[]): { pieces: PlacedPiece[]; end: Pose; ports: WorldPort[][] } {
  let cur = start;
  const pieces: PlacedPiece[] = [];
  const ports: WorldPort[][] = [];
  for (const s of steps) {
    const { piece, ports: wp } = placeAt(cat, cur, s.code, s.inPort);
    pieces.push(piece);
    ports.push(wp);
    const out = wp.find((p) => p.port === s.outPort);
    if (!out) throw new Error(`Piece ${s.code} has no port ${s.outPort}`);
    cur = out;
  }
  return { pieces, end: cur, ports };
}

/** Shorthand: curve turning right ('R') or left ('L'), straight ('S'), ramp up ('U') / down ('D'). */
export function step(code: string, how: 'fwd' | 'rev' = 'fwd'): ChainStep {
  return how === 'fwd' ? { code, inPort: 'a', outPort: 'b' } : { code, inPort: 'b', outPort: 'a' };
}

/** The pose that a first piece attaches to, so its port 'a' sits at (x, y) heading `dir`. */
export function startPose(x = 0, y = 0, dir = 0, z = 0): Pose {
  // behaves like the forward-facing end of an imaginary previous piece
  return { x, y, dir, z };
}
