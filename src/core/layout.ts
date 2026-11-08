import { angleDiff, applyTransform, normDeg, rotate, type Pose, type Sample } from './geometry';
import type { Catalog, GeometryParams } from './catalog';
import type { Counts } from './inventory';

export interface PlacedPiece {
  uid: string;
  code: string;
  x: number;
  y: number;
  rot: number;
  /** Base elevation in levels; port z values are relative to this. */
  z: number;
}

export interface Layout {
  id: string;
  name: string;
  pieces: PlacedPiece[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorldPort extends Pose {
  uid: string;
  port: string;
}

export interface PortRef {
  uid: string;
  port: string;
}

let uidCounter = 0;
export function newUid(prefix = 'p'): string {
  uidCounter = (uidCounter + 1) % 1e9;
  return `${prefix}${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function newLayout(name = 'Untitled layout'): Layout {
  const now = Date.now();
  return { id: newUid('L'), name, pieces: [], createdAt: now, updatedAt: now };
}

export function worldPorts(cat: Catalog, piece: PlacedPiece): WorldPort[] {
  const t = cat.get(piece.code);
  return t.ports.map((p) => {
    const w = applyTransform(piece, p);
    return { uid: piece.uid, port: p.id, x: w.x, y: w.y, dir: normDeg(p.dir + piece.rot), z: piece.z + p.z };
  });
}

export function worldSamples(cat: Catalog, piece: PlacedPiece): Sample[][] {
  const t = cat.get(piece.code);
  return t.samples.map((path) =>
    path.map((s) => {
      const w = applyTransform(piece, s);
      return { x: w.x, y: w.y, z: s.z + piece.z };
    }),
  );
}

/**
 * Where a new piece must go so that its port `portId` mates with `target`
 * (an open port pose, pointing outward).
 */
export function attachPose(cat: Catalog, target: Pose, code: string, portId: string): Omit<PlacedPiece, 'uid' | 'code'> {
  const t = cat.get(code);
  const p = t.ports.find((q) => q.id === portId);
  if (!p) throw new Error(`Piece ${code} has no port ${portId}`);
  const rot = normDeg(target.dir + 180 - p.dir);
  const off = rotate(p, rot);
  return { x: target.x - off.x, y: target.y - off.y, rot, z: target.z - p.z };
}

export const portKey = (r: PortRef) => `${r.uid}:${r.port}`;

export interface Connectivity {
  /** port key -> mated port */
  links: Map<string, PortRef>;
  open: WorldPort[];
  ports: WorldPort[];
}

/** Two ports mate if they coincide (within tolerance), face each other and are at the same level. */
export function portsMate(a: Pose, b: Pose, params: GeometryParams): boolean {
  if (Math.abs(a.z - b.z) > 0.01) return false;
  if (Math.hypot(a.x - b.x, a.y - b.y) > params.joinTolerance) return false;
  return Math.abs(angleDiff(a.dir, b.dir + 180)) <= params.angleTolerance;
}

export function computeConnectivity(cat: Catalog, pieces: PlacedPiece[]): Connectivity {
  const params = cat.params;
  const ports = pieces.flatMap((p) => worldPorts(cat, p));
  const cell = Math.max(params.joinTolerance * 2, 1);
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  ports.forEach((p, i) => {
    const k = keyOf(p.x, p.y);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  // collect candidate pairs ordered by distance, then match greedily so each port mates once
  const pairs: { i: number; j: number; d: number }[] = [];
  ports.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j <= i) continue;
          const q = ports[j];
          if (q.uid === p.uid) continue;
          if (portsMate(p, q, params)) pairs.push({ i, j, d: Math.hypot(p.x - q.x, p.y - q.y) });
        }
      }
  });
  pairs.sort((a, b) => a.d - b.d);
  const links = new Map<string, PortRef>();
  for (const { i, j } of pairs) {
    const a = ports[i];
    const b = ports[j];
    if (links.has(portKey(a)) || links.has(portKey(b))) continue;
    links.set(portKey(a), { uid: b.uid, port: b.port });
    links.set(portKey(b), { uid: a.uid, port: a.port });
  }
  const open = ports.filter((p) => !links.has(portKey(p)));
  return { links, open, ports };
}

export function pieceCounts(pieces: PlacedPiece[]): Counts {
  const out: Counts = {};
  for (const p of pieces) out[p.code] = (out[p.code] ?? 0) + 1;
  return out;
}

/** Bounding box of all track centre-lines, padded by half the track width. */
export function layoutBounds(cat: Catalog, pieces: PlacedPiece[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pieces)
    for (const path of worldSamples(cat, p))
      for (const s of path) {
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.x > maxX) maxX = s.x;
        if (s.y > maxY) maxY = s.y;
      }
  const pad = cat.params.trackWidth / 2;
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
  };
}

/** Move all pieces so the layout's bounding box starts at (0, 0). */
export function normalizeOrigin(cat: Catalog, pieces: PlacedPiece[]): PlacedPiece[] {
  const b = layoutBounds(cat, pieces);
  return pieces.map((p) => ({ ...p, x: p.x - b.minX, y: p.y - b.minY }));
}

/** Rotate the whole layout about a point. */
export function rotateLayout(pieces: PlacedPiece[], deg: number, about = { x: 0, y: 0 }): PlacedPiece[] {
  return pieces.map((p) => {
    const r = rotate({ x: p.x - about.x, y: p.y - about.y }, deg);
    return { ...p, x: r.x + about.x, y: r.y + about.y, rot: normDeg(p.rot + deg) };
  });
}
