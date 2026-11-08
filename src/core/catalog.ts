import { normDeg, walk, type Pose, type Sample, type TurtleOp } from './geometry';

/**
 * Global geometry parameters. Real TrackMaster dimensions are not published, so these
 * are measured/estimated defaults; users can calibrate them in Settings and every
 * piece is rebuilt from them.
 */
export interface GeometryParams {
  /** Length of a standard straight (S1), mm. */
  straight: number;
  /** Centre-line radius of a standard curve (C), mm. */
  curveRadius: number;
  /** Turn of a standard curve, degrees. 45 means 8 curves make a circle. */
  curveAngle: number;
  /** Plan length of an ascending ramp (AL/AR), mm. */
  rampLength: number;
  /** Lateral distance between parallel tracks on the PR/PL offset switches and station, mm. */
  parallelSpacing: number;
  /** Width of the track bed, used for overlap detection, mm. */
  trackWidth: number;
  /** Height of one elevation level, mm (display only). */
  levelHeight: number;
  /** Minimum level difference for one track to pass over another. */
  clearanceLevels: number;
  /** Joints within this distance (mm) are treated as connected. Toy track has some play. */
  joinTolerance: number;
  /** Joints within this angle (degrees) are treated as connected. */
  angleTolerance: number;
}

export const DEFAULT_PARAMS: GeometryParams = {
  straight: 210,
  curveRadius: 200,
  curveAngle: 45,
  rampLength: 315,
  parallelSpacing: 70,
  trackWidth: 46,
  levelHeight: 65,
  clearanceLevels: 1,
  joinTolerance: 12,
  angleTolerance: 4,
};

export type PieceCategory =
  | 'straight'
  | 'curve'
  | 'switch'
  | 'ramp'
  | 'buffer'
  | 'crossing'
  | 'station'
  | 'bridge'
  | 'support';

export interface PathSpec {
  from: string;
  /** Omit for a dead end (buffer). */
  to?: string;
  start?: { x: number; y: number; dir: number };
  ops: TurtleOp[];
  zFrom?: number;
  zTo?: number;
}

export interface PieceSpec {
  code: string;
  name: string;
  category: PieceCategory;
  description: string;
  /** Display colour for the piece. */
  color: string;
  paths?: PathSpec[];
  /** For support pieces: the level they hold track at. */
  supportLevel?: number;
  /** Pieces that hold themselves up when elevated (bridges, the bucket lid). */
  selfSupporting?: boolean;
  /** True when the geometry is an estimate rather than measured. */
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
  /** Route table: for each port, the ports a train can leave through after entering it. */
  routes: Record<string, string[]>;
  isTrack: boolean;
  /** Total centre-line length of the main route, mm (used for scoring). */
  length: number;
}

const line = (len: number): TurtleOp => ({ kind: 'line', len });
const arc = (r: number, turn: number): TurtleOp => ({ kind: 'arc', r, turn });

/** S-curve that shifts sideways by `offset` over plan length `len` and ends parallel. */
function sCurve(len: number, offset: number): TurtleOp[] {
  const theta = 2 * Math.atan(Math.abs(offset) / len); // radians
  const r = len / (2 * Math.sin(theta));
  const deg = (theta * 180) / Math.PI;
  const s = Math.sign(offset) || 1;
  return [arc(r, s * deg), arc(r, -s * deg)];
}

/** Built-in piece catalogue. Codes are the ones printed under each piece. */
export function builtinSpecs(p: GeometryParams): PieceSpec[] {
  const S = p.straight;
  const R = p.curveRadius;
  const A = p.curveAngle;
  const straight = (code: string, name: string, description: string, color: string, extra: Partial<PieceSpec> = {}): PieceSpec => ({
    code,
    name,
    category: 'straight',
    description,
    color,
    paths: [{ from: 'a', to: 'b', ops: [line(S)] }],
    ...extra,
  });
  const curve = (code: string, name: string, description: string, color: string, extra: Partial<PieceSpec> = {}): PieceSpec => ({
    code,
    name,
    category: 'curve',
    description,
    color,
    paths: [{ from: 'a', to: 'b', ops: [arc(R, A)] }],
    ...extra,
  });
  const sw = (code: string, name: string, turn: number, description: string, color = '#59616b', extra: Partial<PieceSpec> = {}): PieceSpec => ({
    code,
    name,
    category: 'switch',
    description,
    color,
    paths: [
      { from: 'a', to: 'b', ops: [line(S)] },
      { from: 'a', to: 'c', ops: [arc(R, turn)] },
    ],
    ...extra,
  });
  const offsetSw = (code: string, name: string, side: number, description: string): PieceSpec => ({
    code,
    name,
    category: 'switch',
    description,
    color: '#59616b',
    approximate: true,
    paths: [
      { from: 'a', to: 'b', ops: [line(S)] },
      { from: 'a', to: 'c', ops: sCurve(S, side * p.parallelSpacing) },
    ],
  });
  const ramp = (code: string, name: string, description: string, color: string): PieceSpec => ({
    code,
    name,
    category: 'ramp',
    description,
    color,
    paths: [{ from: 'a', to: 'b', ops: [line(p.rampLength)], zFrom: 0, zTo: 1 }],
  });
  const buffer = (code: string, name: string, color: string): PieceSpec => ({
    code,
    name,
    category: 'buffer',
    description: 'Buffer stop. Ends a siding or spur so engines stop safely.',
    color,
    paths: [{ from: 'a', ops: [line(40)] }],
  });
  const support = (code: string, name: string, level: number, description: string, color: string): PieceSpec => ({
    code,
    name,
    category: 'support',
    description,
    color,
    supportLevel: level,
  });

  return [
    // Straights
    straight('S1', 'Straight', 'Standard straight track.', '#4b5563'),
    straight('TU4', 'Straight (support tabs)', 'Straight with side tabs that clip onto supports.', '#374151'),
    straight('ES3', 'Elevated straight', 'Straight designed to sit on supports in raised sections.', '#334155'),
    straight('BT1', 'Wide-bed straight', 'Straight with a wide bed; used for play features.', '#84cc16', { approximate: true }),
    straight('RRT', 'Flat-deck straight', 'Straight with a flat grey deck.', '#9ca3af', { approximate: true }),
    // Curves
    curve('C', 'Curve', `Standard curve: ${A}° turn, ${Math.round(360 / A)} make a circle.`, '#4b5563'),
    curve('CU4', 'Curve (support tabs)', 'Curve with tabs that clip onto supports.', '#374151'),
    curve('CS2', 'Curve with stop', 'Curve with a built-in stop/go lever.', '#4b5563'),
    curve('CHT', 'Curve (raised)', 'Curve used at the top of raised sections.', '#334155', { approximate: true }),
    curve('DOCK', 'Brendam Docks curve', 'Dock curve with a stop lever; part of the GLK80 set.', '#a16207', { approximate: true }),
    // Switches
    sw('TL', 'Switch, left', -A, 'Points: straight through, or branch curving left.'),
    sw('TR', 'Switch, right', A, 'Points: straight through, or branch curving right.'),
    offsetSw('PL', 'Offset switch, left', -1, 'Points whose branch shifts left and runs parallel. Pairs with PR around the loading station.'),
    offsetSw('PR', 'Offset switch, right', 1, 'Points whose branch shifts right and runs parallel. Pairs with PL around the loading station.'),
    sw('SWB', 'Junction base (switch)', A, 'Blue junction base with a switch lever (HNP81). Modelled as a right-hand switch.', '#2563eb', {
      approximate: true,
    }),
    // Ramps
    ramp('AL', 'Ascending ramp', 'Climbs (or descends) one level over its length.', '#4b5563'),
    ramp('AR', 'Ascending ramp (R)', 'Climbs one level over its length.', '#334155'),
    ramp('AR1', 'Ascending ramp (rock base)', 'Climbs one level; has a rock-style base.', '#334155'),
    // Buffers
    buffer('BS1', 'Buffer stop', '#dc2626'),
    buffer('BS2', 'Buffer stop (wood)', '#a8a29e'),
    // Bridges / special
    {
      code: 'VB',
      name: 'Vicarstown lift bridge',
      category: 'bridge',
      description: 'Two-piece lift bridge. Holds itself up, so it needs no supports when raised.',
      color: '#b91c1c',
      selfSupporting: true,
      approximate: true,
      paths: [{ from: 'a', to: 'b', ops: [line(2 * S)] }],
    },
    {
      code: 'LS',
      name: 'Loading station (2 lanes)',
      category: 'station',
      description: 'Two parallel lanes with stop levers. Feed it with an offset switch (PR/PL) at each end.',
      color: '#6b7280',
      approximate: true,
      paths: [
        { from: 'a', to: 'b', ops: [line(S)] },
        { from: 'c', to: 'd', start: { x: 0, y: p.parallelSpacing, dir: 0 }, ops: [line(S)] },
      ],
    },
    {
      code: 'XB',
      name: 'Bucket crossing (lid on tunnel)',
      category: 'crossing',
      description:
        'The track-bucket lid: a raised 90° crossing (3 levels up) sitting on the bucket, with a tunnel underneath for ground-level track.',
      color: '#9ca3af',
      selfSupporting: true,
      approximate: true,
      paths: [
        { from: 'a', to: 'b', ops: [line(S)] },
        { from: 'c', to: 'd', start: { x: S / 2, y: -S / 2, dir: 90 }, ops: [line(S)] },
        { from: 'e', to: 'f', start: { x: 0, y: 0, dir: 0 }, ops: [line(S)], zFrom: -3, zTo: -3 },
      ],
    },
    // Supports (not placed directly; counted against raised joints)
    support('RR1', 'Riser pier', 1, 'Short pier that holds a joint one level up.', '#9a3412'),
    support('RS1', 'Support, short', 1, 'Short support. Two stacked make a level-2 support.', '#991b1b'),
    support('RS2', 'Support, medium', 2, 'Medium support (level 2). Used in pairs with a D1 deck.', '#991b1b'),
    support('RS3', 'Support, tall', 3, 'Tall support (level 3). Used in pairs with a D1 deck.', '#991b1b'),
    support('D1', 'Support deck', 0, 'Grey deck that bridges a pair of supports under a joint.', '#9ca3af'),
  ];
}

/** User-defined piece, described by simple parameters. */
export interface CustomPieceDef {
  code: string;
  name: string;
  kind: 'straight' | 'curve' | 'ramp' | 'buffer' | 'switch' | 'support';
  length?: number;
  radius?: number;
  angle?: number;
  /** For switches: which way the branch goes. */
  hand?: 'left' | 'right';
  /** For ramps: levels climbed. For supports: level held. */
  levels?: number;
  color?: string;
  description?: string;
}

export function customSpec(d: CustomPieceDef, p: GeometryParams): PieceSpec {
  const base = { code: d.code, name: d.name, color: d.color ?? '#7c3aed', description: d.description ?? 'Custom piece.', custom: true };
  const len = d.length ?? p.straight;
  const r = d.radius ?? p.curveRadius;
  const ang = d.angle ?? p.curveAngle;
  switch (d.kind) {
    case 'straight':
      return { ...base, category: 'straight', paths: [{ from: 'a', to: 'b', ops: [line(len)] }] };
    case 'curve':
      return { ...base, category: 'curve', paths: [{ from: 'a', to: 'b', ops: [arc(r, ang)] }] };
    case 'ramp':
      return { ...base, category: 'ramp', paths: [{ from: 'a', to: 'b', ops: [line(len)], zFrom: 0, zTo: d.levels ?? 1 }] };
    case 'buffer':
      return { ...base, category: 'buffer', paths: [{ from: 'a', ops: [line(40)] }] };
    case 'switch': {
      const turn = d.hand === 'left' ? -ang : ang;
      return {
        ...base,
        category: 'switch',
        paths: [
          { from: 'a', to: 'b', ops: [line(len)] },
          { from: 'a', to: 'c', ops: [arc(r, turn)] },
        ],
      };
    }
    case 'support':
      return { ...base, category: 'support', supportLevel: d.levels ?? 1 };
  }
}

/** Resolve a spec into concrete ports, samples and routes. */
export function resolveSpec(spec: PieceSpec, sampleStep = 8): PieceType {
  const ports = new Map<string, PortDef>();
  const samples: Sample[][] = [];
  const routes: Record<string, string[]> = {};
  let length = 0;
  const addPort = (pd: PortDef) => {
    if (!ports.has(pd.id)) ports.set(pd.id, pd);
  };
  const addRoute = (a: string, b: string) => {
    (routes[a] ??= []).includes(b) || routes[a].push(b);
  };
  for (const [i, path] of (spec.paths ?? []).entries()) {
    const zFrom = path.zFrom ?? 0;
    const zTo = path.zTo ?? zFrom;
    const start: Pose = { x: path.start?.x ?? 0, y: path.start?.y ?? 0, dir: path.start?.dir ?? 0, z: zFrom };
    const w = walk(start, path.ops, zFrom, zTo, sampleStep);
    samples.push(w.samples);
    if (i === 0) length = w.length;
    addPort({ id: path.from, x: start.x, y: start.y, dir: normDeg(start.dir + 180), z: zFrom });
    if (path.to) {
      addPort({ id: path.to, x: w.end.x, y: w.end.y, dir: normDeg(w.end.dir), z: zTo });
      addRoute(path.from, path.to);
      addRoute(path.to, path.from);
    } else {
      routes[path.from] ??= [];
    }
  }
  return {
    ...spec,
    ports: [...ports.values()],
    samples,
    routes,
    isTrack: (spec.paths?.length ?? 0) > 0,
    length,
  };
}

export class Catalog {
  readonly params: GeometryParams;
  private byCode = new Map<string, PieceType>();

  constructor(params: GeometryParams = DEFAULT_PARAMS, custom: CustomPieceDef[] = []) {
    this.params = params;
    for (const s of builtinSpecs(params)) this.byCode.set(s.code, resolveSpec(s));
    for (const c of custom) this.byCode.set(c.code, resolveSpec(customSpec(c, params)));
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
}
