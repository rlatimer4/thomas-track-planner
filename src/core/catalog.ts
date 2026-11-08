import { normDeg, walk, type Pose, type Sample, type TurtleOp } from './geometry';
import { TRACK_STANDARD } from './standards';
import { BUILTIN_PIECES } from './pieces';

/**
 * Calibration: the sizes of the standard units, in mm. The manufacturer doesn't publish
 * them, so these are estimates the user can correct in Settings; every piece is defined
 * in these units and is rebuilt when they change.
 */
export interface GeometryParams {
  /** S: length of a standard straight (S1), mm. */
  straight: number;
  /** R: centre-line radius of a standard curve (C), mm. */
  curveRadius: number;
  /** Lane: distance between the two parallel tracks after an offset switch (PR/PL), mm. */
  parallelSpacing: number;
  /** Width of the track bed, used for overlap detection, mm. */
  trackWidth: number;
  /** Height of one elevation level, mm (display only). */
  levelHeight: number;
  /** Levels of clearance an engine needs to pass under other track. */
  clearanceLevels: number;
  /** Number of engines that run at the same time (for collision and capacity checks). */
  engineCount: number;
  /** Longest train (engine + cars), mm: sidings and passing loops must hold it. */
  trainLength: number;
  /** Widest engine/car body, mm: parallel tracks closer than this are too close. */
  vehicleWidth: number;
  /** 1 if an engine pushes through a switch set against it when arriving from a branch, 0 if it derails. */
  trailingPushThrough: number;
  /** Joints within this distance (mm) are treated as connected. Toy track has some play. */
  joinTolerance: number;
  /** Joints within this angle (degrees) are treated as connected. */
  angleTolerance: number;
}

export const DEFAULT_PARAMS: GeometryParams = {
  straight: 210,
  curveRadius: 200,
  parallelSpacing: 70,
  trackWidth: 46,
  levelHeight: 65,
  clearanceLevels: TRACK_STANDARD.headroomLevels,
  joinTolerance: 12,
  angleTolerance: 4,
  engineCount: 2,
  trainLength: 250,
  vehicleWidth: 60,
  trailingPushThrough: 1,
};

export type PieceCategory = 'straight' | 'curve' | 'switch' | 'ramp' | 'buffer' | 'crossing' | 'station' | 'bridge' | 'support';

/**
 * One way through a piece, described by how it changes the track's direction and height.
 *
 * Shape (pick one):
 * - straight: `length` straights long (default 1)
 * - curve: `turn` degrees (+ right, − left) on `radius` × R (default 1)
 * - offset: shifts sideways `offset` lanes (+ right, − left) over `length` straights and
 *   ends parallel, like the PR/PL switches
 *
 * Height: starts `level` levels above the piece's base and climbs `rise` levels by the end.
 * Position: starts at the piece's origin facing along it, unless `start` moves it (in
 * straights along/sideways, or lanes sideways) or turns it (`heading`, degrees).
 */
export interface PathDef {
  from: string;
  /** End where the path finishes. Omit for a dead end (buffer stop). */
  to?: string;
  turn?: number;
  radius?: number;
  length?: number;
  offset?: number;
  level?: number;
  rise?: number;
  start?: { along?: number; side?: number; lanes?: number; heading?: number };
}

export interface PieceSpec {
  code: string;
  name: string;
  category: PieceCategory;
  description: string;
  /** Display colour for the piece. */
  color: string;
  paths?: PathDef[];
  /** For support pieces: the level they hold track at. */
  supportLevel?: number;
  /** Supports used in pairs (one each side of the joint) with a D1 deck on top. */
  pairedSupport?: boolean;
  /** Supports that can be stacked on each other to reach higher levels. */
  stackable?: boolean;
  /** How many raised joints one of these supports holds (the bridge holds both ends of a straight). */
  jointsHeld?: number;
  /** Pieces that hold themselves up when elevated (the bucket, the lid). */
  selfSupporting?: boolean;
  /** Ends whose joint is held up by this piece itself (e.g. AR1's rock base). */
  supportedPorts?: string[];
  /** Inventory codes this piece can't be joined to directly. */
  cannotJoin?: string[];
  /** Pieces with a stop/go lever where engines wait (stop track, docks, station). */
  stop?: boolean;
  /** Solid body that other track can't pass through, in straights from the origin, between two levels. */
  body?: { along: number; side: number; length: number; width: number; zMin: number; zMax: number; tunnel?: boolean };
  /** Inventory code when this is another way of using a physical piece. Defaults to `code`. */
  stock?: string;
  /** True when the geometry is an estimate rather than confirmed. */
  approximate?: boolean;
  /** Set on pieces the user defined. */
  custom?: boolean;
}

export interface PortDef {
  id: string;
  x: number;
  y: number;
  /** Outward-facing direction of the connector. */
  dir: number;
  z: number;
}

export interface PieceType extends PieceSpec {
  ports: PortDef[];
  /** Centre-line samples per path, in the piece's local frame. */
  samples: Sample[][];
  /** Points filling the piece's solid body, used only for overlap checks. */
  blockers: Sample[];
  /** Inventory code this piece is counted against. */
  stockCode: string;
  /** Route table: for each port, the ports a train can leave through after entering it. */
  routes: Record<string, string[]>;
  /** Centre-line length of each route, keyed `from>to`, mm. */
  routeLength: Record<string, number>;
  /** Body rectangle in mm (local frame), for drawing. */
  bodyRect?: { x: number; y: number; w: number; h: number; zMax: number };
  isTrack: boolean;
  /** Total centre-line length of the main route, mm (used for scoring). */
  length: number;
}

const arc = (r: number, turn: number): TurtleOp => ({ kind: 'arc', r, turn });

/** S-curve that shifts sideways by `offset` over plan length `len` and ends parallel. */
function sCurve(len: number, offset: number): TurtleOp[] {
  const theta = 2 * Math.atan(Math.abs(offset) / len);
  const r = len / (2 * Math.sin(theta));
  const deg = (theta * 180) / Math.PI;
  const s = Math.sign(offset) || 1;
  return [arc(r, s * deg), arc(r, -s * deg)];
}

/** Turn a path definition into turtle steps in mm. */
export function pathOps(path: PathDef, p: GeometryParams): TurtleOp[] {
  if (path.turn) return [arc((path.radius ?? 1) * p.curveRadius, path.turn)];
  const len = (path.length ?? 1) * p.straight;
  if (path.offset) return sCurve(len, path.offset * p.parallelSpacing);
  return [{ kind: 'line', len }];
}

export function pathStart(path: PathDef, p: GeometryParams): { x: number; y: number; dir: number } {
  const s = path.start ?? {};
  return {
    x: (s.along ?? 0) * p.straight,
    y: (s.side ?? 0) * p.straight + (s.lanes ?? 0) * p.parallelSpacing,
    dir: s.heading ?? 0,
  };
}

/** Problems with a piece definition (used by the editor before saving). */
export function checkSpec(spec: PieceSpec, p: GeometryParams = DEFAULT_PARAMS): string[] {
  const errors: string[] = [];
  if (!spec.code.trim()) errors.push('Give the piece a code.');
  if (!spec.name.trim()) errors.push('Give the piece a name.');
  if (spec.category === 'support') {
    if (!spec.supportLevel || spec.supportLevel < 1) errors.push('A support must hold track at level 1 or higher.');
    return errors;
  }
  const paths = spec.paths ?? [];
  if (!paths.length) errors.push('Add at least one path.');
  for (const [i, path] of paths.entries()) {
    const n = `Path ${i + 1}`;
    if (!path.from) errors.push(`${n}: name the end it starts at.`);
    if (path.to && path.to === path.from) errors.push(`${n}: it must end at a different end from where it starts.`);
    if (path.turn && path.offset) errors.push(`${n}: use either a turn or an offset, not both.`);
    if (path.turn && Math.abs(path.turn) > 180) errors.push(`${n}: turn must be between −180° and 180°.`);
    if ((path.length ?? 1) <= 0) errors.push(`${n}: length must be more than 0.`);
    if ((path.radius ?? 1) <= 0) errors.push(`${n}: radius must be more than 0.`);
  }
  // an end shared by several paths must be in the same place, facing the same way, at the same level
  try {
    const t = resolveSpec(spec, p, { strict: true });
    if (t.ports.length < 1) errors.push('The piece has no ends.');
  } catch (e) {
    errors.push((e as Error).message);
  }
  return errors;
}

/** Resolve a spec into concrete ports, samples and routes, in mm. */
export function resolveSpec(spec: PieceSpec, p: GeometryParams, opts: { strict?: boolean; sampleStep?: number } = {}): PieceType {
  const ports = new Map<string, PortDef>();
  const samples: Sample[][] = [];
  const routes: Record<string, string[]> = {};
  const routeLength: Record<string, number> = {};
  let length = 0;
  const addPort = (pd: PortDef) => {
    const prev = ports.get(pd.id);
    if (!prev) return void ports.set(pd.id, pd);
    if (opts.strict) {
      const apart = Math.hypot(prev.x - pd.x, prev.y - pd.y);
      if (apart > 1 || Math.abs(normDeg(prev.dir - pd.dir + 180) - 180) > 1 || prev.z !== pd.z)
        throw new Error(`End "${pd.id}" is used by two paths that don't meet at the same place, direction and level.`);
    }
  };
  const addRoute = (a: string, b: string) => {
    (routes[a] ??= []).includes(b) || routes[a].push(b);
  };
  for (const [i, path] of (spec.paths ?? []).entries()) {
    const zFrom = path.level ?? 0;
    const zTo = zFrom + (path.rise ?? 0);
    const s = pathStart(path, p);
    const start: Pose = { ...s, z: zFrom };
    const w = walk(start, pathOps(path, p), zFrom, zTo, opts.sampleStep ?? 8);
    samples.push(w.samples);
    if (i === 0) length = w.length;
    addPort({ id: path.from, x: start.x, y: start.y, dir: normDeg(start.dir + 180), z: zFrom });
    if (path.to) {
      addPort({ id: path.to, x: w.end.x, y: w.end.y, dir: normDeg(w.end.dir), z: zTo });
      addRoute(path.from, path.to);
      addRoute(path.to, path.from);
      routeLength[`${path.from}>${path.to}`] = w.length;
      routeLength[`${path.to}>${path.from}`] = w.length;
    } else {
      routes[path.from] ??= [];
    }
  }
  const blockers: Sample[] = [];
  let bodyRect: PieceType['bodyRect'];
  if (spec.body) {
    const b = spec.body;
    const inset = p.trackWidth * 0.3;
    const rect = {
      x: b.along * p.straight + inset,
      y: b.side * p.straight + inset,
      w: b.length * p.straight - 2 * inset,
      h: b.width * p.straight - 2 * inset,
    };
    bodyRect = { ...rect, zMax: b.zMax };
    const step = 15;
    for (let z = b.zMin; z < b.zMax; z++)
      for (let x = rect.x; x <= rect.x + rect.w + 1e-6; x += step)
        for (let y = rect.y; y <= rect.y + rect.h + 1e-6; y += step) {
          // keep a tunnel (along the piece, centred on its origin line) open at the bottom level
          if (b.tunnel && z === b.zMin && Math.abs(y) < 40) continue;
          blockers.push({ x, y, z });
        }
  }
  return {
    ...spec,
    stockCode: spec.stock ?? spec.code,
    routeLength,
    blockers,
    bodyRect,
    ports: [...ports.values()],
    samples,
    routes,
    isTrack: (spec.paths?.length ?? 0) > 0,
    length,
  };
}

/** Pre-2.0 custom pieces were stored as a kind plus sizes in mm; convert them to path form. */
export interface LegacyCustomPiece {
  code: string;
  name: string;
  kind: 'straight' | 'curve' | 'ramp' | 'buffer' | 'switch' | 'support';
  length?: number;
  radius?: number;
  angle?: number;
  hand?: 'left' | 'right';
  levels?: number;
  color?: string;
  description?: string;
}

export function fromLegacyCustom(d: LegacyCustomPiece, p: GeometryParams = DEFAULT_PARAMS): PieceSpec {
  const base = { code: d.code, name: d.name, color: d.color ?? '#7c3aed', description: d.description ?? 'Custom piece.', custom: true };
  const length = (d.length ?? p.straight) / p.straight;
  const radius = (d.radius ?? p.curveRadius) / p.curveRadius;
  const turn = d.angle ?? TRACK_STANDARD.curveAngle;
  switch (d.kind) {
    case 'straight':
      return { ...base, category: 'straight', paths: [{ from: 'a', to: 'b', length }] };
    case 'curve':
      return { ...base, category: 'curve', paths: [{ from: 'a', to: 'b', turn, radius }] };
    case 'ramp':
      return { ...base, category: 'ramp', paths: [{ from: 'a', to: 'b', length, rise: d.levels ?? 1 }] };
    case 'buffer':
      return { ...base, category: 'buffer', paths: [{ from: 'a', length: 0.2 }] };
    case 'switch':
      return {
        ...base,
        category: 'switch',
        paths: [
          { from: 'a', to: 'b', length },
          { from: 'a', to: 'c', turn: d.hand === 'left' ? -turn : turn, radius },
        ],
      };
    case 'support':
      return { ...base, category: 'support', supportLevel: d.levels ?? 1 };
  }
}

export const isLegacyCustom = (x: unknown): x is LegacyCustomPiece => !!x && typeof x === 'object' && 'kind' in x;

export class Catalog {
  readonly params: GeometryParams;
  private byCode = new Map<string, PieceType>();

  constructor(params: GeometryParams = DEFAULT_PARAMS, custom: (PieceSpec | LegacyCustomPiece)[] = []) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    for (const s of BUILTIN_PIECES) this.byCode.set(s.code, resolveSpec(s, this.params));
    for (const c of custom) {
      const spec = isLegacyCustom(c) ? fromLegacyCustom(c, this.params) : { ...c, custom: true };
      try {
        this.byCode.set(spec.code, resolveSpec(spec, this.params));
      } catch {
        /* skip a broken custom piece rather than breaking the app */
      }
    }
  }

  get(code: string): PieceType {
    const t = this.byCode.get(code);
    if (!t) throw new Error(`Unknown piece code: ${code}`);
    return t;
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  all(): PieceType[] {
    return [...this.byCode.values()];
  }

  trackPieces(): PieceType[] {
    return this.all().filter((t) => t.isTrack);
  }

  supports(): PieceType[] {
    return this.all().filter((t) => t.category === 'support');
  }

  /** Degrees turned by the standard curve (C), or the standard if C was removed. */
  standardTurn(): number {
    const c = this.byCode.get('C');
    const turn = c?.paths?.[0]?.turn;
    return turn ? Math.abs(turn) : TRACK_STANDARD.curveAngle;
  }
}
