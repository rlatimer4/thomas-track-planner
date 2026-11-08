/**
 * Automatic layout generation.
 *
 * Strategy
 * 1. Main line: every curve in the system turns by the same angle with the same radius,
 *    and the straight-like pieces (straights, switch through-legs, station lanes, ramps)
 *    are multiples of half a straight. A loop closes exactly when (a) the sequence of
 *    curves closes on its own and (b) the straight runs in opposite headings have equal
 *    total length. We enumerate closing curve sequences ("turn words"), then size the
 *    straight runs to satisfy (b). This finds exact loops quickly without blind search.
 * 2. Elevation: ramps are placed as a balanced up/down sequence so the line never goes
 *    below ground, which lets figure-8s cross over themselves on a raised section.
 * 3. Decoration: straights on the finished loop are swapped for same-length switches to
 *    add passing loops, sidings with buffer stops, offset double track and the station.
 *    Branch connections are found by a small bounded search.
 * 4. Every candidate is checked by the same validator the builder uses, and scored with
 *    railroad design rules in mind (continuous running, no dead ends without buffers,
 *    grade separation at crossings, no switches on grades, tangents between reverse
 *    curves, supports available for raised track, fits the space).
 */
import { dist, normDeg, stepPose, type Pose, type Sample, type Vec } from './geometry';
import type { Catalog, PieceType } from './catalog';
import type { Counts } from './inventory';
import { placeAt, placeChain, startPose, type ChainStep } from './build';
import {
  layoutBounds,
  normalizeOrigin,
  pieceCounts,
  portsMate,
  rotateLayout,
  worldPorts,
  worldSamples,
  type PlacedPiece,
  type WorldPort,
} from './layout';
import { validateLayout, type Issue } from './validate';

export type LayoutStyle = 'any' | 'loop' | 'figure8';

export interface AutoGenOptions {
  owned: Counts;
  /** Available floor/table space in mm; omit for unlimited. */
  maxWidth?: number;
  maxDepth?: number;
  style?: LayoutStyle;
  wantSidings?: boolean;
  wantElevation?: boolean;
  wantStation?: boolean;
  /** Number of layouts to return. */
  results?: number;
  timeBudgetMs?: number;
  seed?: number;
}

export interface Candidate {
  name: string;
  pieces: PlacedPiece[];
  score: number;
  features: string[];
  breakdown: Record<string, number>;
  issues: Issue[];
  width: number;
  depth: number;
  counts: Counts;
}

// ---------------------------------------------------------------- utilities

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Spatial hash of centre-line samples for fast overlap checks. */
class SampleGrid {
  private cells = new Map<string, Sample[]>();
  constructor(private cell: number) {}
  private key(x: number, y: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  add(samples: Sample[]) {
    for (const s of samples) {
      const k = this.key(s.x, s.y);
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(s);
    }
  }
  /** True if any sample comes closer than `gap` at a similar height, ignoring points near `ignore`. */
  hits(samples: Sample[], gap: number, clearance: number, ignore: Vec[], ignoreR: number): boolean {
    for (const s of samples) {
      if (ignore.some((p) => dist(p, s) < ignoreR)) continue;
      const cx = Math.floor(s.x / this.cell);
      const cy = Math.floor(s.y / this.cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const o of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (Math.abs(o.z - s.z) >= clearance - 1e-6) continue;
            if (dist(o, s) < gap && !ignore.some((p) => dist(p, o) < ignoreR)) return true;
          }
    }
    return false;
  }
}

// ---------------------------------------------------------------- piece pools

interface Pools {
  straight: string[];
  curve: string[];
  ramp: string[];
  buffer: string[];
}

/** True if two piece types have the same ports (within 0.5 mm / 0.5°). */
function sameGeometry(a: PieceType, b: PieceType): boolean {
  if (a.ports.length !== b.ports.length) return false;
  return a.ports.every((p) => {
    const q = b.ports.find((x) => x.id === p.id);
    return q && Math.hypot(p.x - q.x, p.y - q.y) < 0.5 && Math.abs(normDeg(p.dir - q.dir + 180) - 180) < 0.5 && p.z === q.z;
  });
}

// plain pieces are preferred; feature pieces (stop levers, wide beds) are used last
const PREFERENCE = ['S1', 'C', 'AL', 'TU4', 'ES3', 'CU4', 'AR', 'AR1', 'RRT', 'BT1', 'CHT', 'CS2', 'DOCK'];
const prefIndex = (code: string) => {
  const i = PREFERENCE.indexOf(code);
  return i < 0 ? PREFERENCE.length : i;
};

export function piecePools(cat: Catalog): Pools {
  const ref = (code: string) => (cat.has(code) ? cat.get(code) : undefined);
  const S = ref('S1');
  const C = ref('C');
  const A = ref('AL');
  const sorted = (xs: PieceType[]) => xs.map((t) => t.code).sort((a, b) => prefIndex(a) - prefIndex(b));
  const tracks = cat.trackPieces();
  return {
    straight: S ? sorted(tracks.filter((t) => t.category === 'straight' && sameGeometry(t, S))) : [],
    curve: C ? sorted(tracks.filter((t) => t.category === 'curve' && sameGeometry(t, C))) : [],
    ramp: A ? sorted(tracks.filter((t) => t.category === 'ramp' && sameGeometry(t, A))) : [],
    buffer: sorted(tracks.filter((t) => t.category === 'buffer')),
  };
}

const poolCount = (owned: Counts, codes: string[]) => codes.reduce((a, c) => a + (owned[c] ?? 0), 0);

/** Take one piece from a pool, honouring a preference function. */
function takeFrom(avail: Counts, codes: string[], prefer?: (code: string) => number): string | undefined {
  const order = prefer ? [...codes].sort((a, b) => prefer(a) - prefer(b)) : codes;
  for (const c of order)
    if ((avail[c] ?? 0) > 0) {
      avail[c]--;
      return c;
    }
  return undefined;
}

// ---------------------------------------------------------------- turn words

/** A closed sequence of curve turns: +1 right, -1 left. */
export type TurnWord = number[];

function canonical(word: TurnWord): string {
  // smallest rotation, so cyclic shifts dedupe
  let best = '';
  for (let i = 0; i < word.length; i++) {
    const s = [...word.slice(i), ...word.slice(0, i)].map((t) => (t > 0 ? 'R' : 'L')).join('');
    if (!best || s < best) best = s;
  }
  return best;
}

/** Number of places (cyclically) where the turn direction flips. */
function directionChanges(word: TurnWord): number {
  let n = 0;
  for (let i = 0; i < word.length; i++) if (word[i] !== word[(i + 1) % word.length]) n++;
  return n;
}

/**
 * Enumerate candidate curve sequences with at most `maxCurves` curves whose total turn is
 * one full circle (a loop) or zero (figure-8 style). Straight runs between the curves are
 * sized later to close the shape. Words that wiggle back and forth (many direction
 * changes) make poor railways and are skipped.
 */
export function closingWords(maxCurves: number, angle: number, allowNetZero: boolean): TurnWord[] {
  const perCircle = Math.round(360 / angle);
  if (Math.abs(perCircle * angle - 360) > 1e-6) return [];
  const out = new Map<string, TurnWord>();
  const limit = Math.min(maxCurves, 16);
  const rec = (word: number[], sum: number) => {
    const n = word.length;
    if (n >= perCircle - 2 && (sum === perCircle || (allowNetZero && sum === 0 && n >= perCircle))) {
      const changes = directionChanges(word);
      if (changes <= (sum === 0 ? 2 : 4)) {
        const k = canonical(word);
        if (!out.has(k)) out.set(k, [...word]);
      }
    }
    if (n === limit) return;
    const remaining = limit - n;
    for (const t of [1, -1]) {
      const s2 = sum + t;
      const canLoop = Math.abs(perCircle - s2) <= remaining - 1;
      const canZero = allowNetZero && Math.abs(s2) <= remaining - 1;
      if (n === 0 && t < 0) continue; // mirror images are added later
      if (canLoop || canZero) {
        word.push(t);
        rec(word, s2);
        word.pop();
      }
    }
  };
  rec([], 0);
  return [...out.values()];
}

// ---------------------------------------------------------------- main loop

type Slot =
  | { kind: 'curve'; turn: number }
  | { kind: 'straight' }
  | { kind: 'ramp'; up: boolean };

interface LoopPlan {
  word: TurnWord;
  slots: Slot[];
  ramps: number;
}

interface LoopGeometry {
  perCircle: number;
  /** half a straight, mm: the length unit for runs */
  unit: number;
  /** ramp length in units, or 0 if ramps don't fit the unit grid */
  rampUnits: number;
  radius: number;
  angle: number;
  /** allowed closing error, mm */
  tolerance: number;
}

/** Displacement of the curves alone (no straights), and the heading of each run. */
function curveSkeleton(word: TurnWord, g: LoopGeometry) {
  let pose: Pose = { x: 0, y: 0, dir: 0, z: 0 };
  const headings: number[] = [];
  for (const t of word) {
    pose = stepPose(pose, { kind: 'arc', r: g.radius, turn: t * g.angle });
    headings.push(((Math.round(pose.dir / g.angle) % g.perCircle) + g.perCircle) % g.perCircle);
  }
  return { dx: pose.x, dy: pose.y, headings };
}

/**
 * Build a slot plan for one turn word: decide where ramps go and how many straights each
 * run between curves gets so the loop closes (within tolerance).
 */
function planLoop(
  rng: Rng,
  word: TurnWord,
  g: LoopGeometry,
  budget: { straight: number; ramp: number },
  rampPairs: number,
): LoopPlan | undefined {
  const m = word.length;
  const { dx, dy, headings } = curveSkeleton(word, g);
  const half = g.perCircle / 2;
  if (g.perCircle % 2 !== 0) return undefined;

  // ramps: a balanced up/down sequence assigned to runs in loop order (never below ground)
  const rampSeq: boolean[] = [];
  if (rampPairs > 0 && g.rampUnits > 0) {
    let z = 0;
    let ups = rampPairs,
      downs = rampPairs;
    while (ups + downs > 0) {
      const canUp = ups > 0 && z < 2;
      const canDown = downs > 0 && z > 0;
      const up = canUp && (!canDown || rng() < 0.5);
      rampSeq.push(up);
      z += up ? 1 : -1;
      if (up) ups--;
      else downs--;
    }
  }
  if (rampSeq.length > budget.ramp) return undefined;
  const rampRuns = rampSeq.map(() => randInt(rng, 0, m - 1)).sort((a, b) => a - b);
  const runRamps: boolean[][] = Array.from({ length: m }, () => []);
  rampRuns.forEach((r, i) => runRamps[r].push(rampSeq[i]));

  // fixed (ramp) length per heading class, in units
  const fixed = Array(g.perCircle).fill(0);
  runRamps.forEach((rs, i) => (fixed[headings[i]] += rs.length * g.rampUnits));
  const runsOf = (k: number) => headings.map((h, i) => (h === k ? i : -1)).filter((i) => i >= 0);

  // Solve sum_k net_k * unit * e_k = -(dx, dy), where net_k = T_k - T_{k+half} for k < half.
  // Only the 8-direction (45°) case gets the fast solver; other angles need exact closure.
  const solutions: number[][] = [];
  if (g.perCircle === 8) {
    const r2 = Math.SQRT1_2;
    const tx = -dx / g.unit;
    const ty = -dy / g.unit;
    for (let n1 = -8; n1 <= 8; n1++)
      for (let n3 = -8; n3 <= 8; n3++) {
        const n0f = tx - (n1 - n3) * r2;
        const n2f = ty - (n1 + n3) * r2;
        for (const n0 of [Math.floor(n0f), Math.ceil(n0f)])
          for (const n2 of [Math.floor(n2f), Math.ceil(n2f)]) {
            const ex = (n0 + (n1 - n3) * r2 - tx) * g.unit;
            const ey = (n2 + (n1 + n3) * r2 - ty) * g.unit;
            if (Math.hypot(ex, ey) <= g.tolerance) solutions.push([n0, n1, n2, n3]);
          }
      }
  } else if (Math.hypot(dx, dy) < 1e-6) {
    solutions.push(Array(half).fill(0));
  }
  if (!solutions.length) return undefined;

  for (const net of shuffle(rng, solutions).slice(0, 6)) {
    const s = Array(m).fill(0);
    let ok = true;
    for (let k = 0; k < half && ok; k++) {
      // straights in units of 2: 2*(sA - sB) = net_k - (fixed_k - fixed_{k+half})
      const need = net[k] - (fixed[k] - fixed[k + half]);
      if (need % 2 !== 0) {
        ok = false;
        break;
      }
      const d = need / 2;
      const A = runsOf(k);
      const B = runsOf(k + half);
      let extra = A.length && B.length ? (rng() < 0.5 ? 0 : randInt(rng, 0, 2)) : 0;
      let sA = Math.max(d, 0) + extra;
      let sB = Math.max(-d, 0) + extra;
      if ((sA > 0 && !A.length) || (sB > 0 && !B.length)) {
        ok = false;
        break;
      }
      while (sA-- > 0) s[pick(rng, A)]++;
      while (sB-- > 0) s[pick(rng, B)]++;
      extra = 0;
    }
    if (!ok) continue;
    if (s.reduce((a, b) => a + b, 0) > budget.straight) continue;
    const slots: Slot[] = [];
    for (let i = 0; i < m; i++) {
      slots.push({ kind: 'curve', turn: word[i] });
      const run: Slot[] = Array.from({ length: s[i] }, () => ({ kind: 'straight' }) as Slot);
      // ramps go at random positions inside the run but keep their order
      let pos = 0;
      for (const up of runRamps[i]) {
        pos = randInt(rng, pos, run.length);
        run.splice(pos, 0, { kind: 'ramp', up });
        pos++;
      }
      slots.push(...run);
    }
    return { word, slots, ramps: rampSeq.length };
  }
  return undefined;
}

interface Built {
  pieces: PlacedPiece[];
  /** uid for each slot, in loop order */
  order: string[];
}

function buildLoop(cat: Catalog, pools: Pools, plan: LoopPlan, owned: Counts): Built | undefined {
  const avail = { ...owned };
  const steps: ChainStep[] = [];
  // compute z per slot to pick support-friendly pieces for raised track
  let z = 0;
  for (const slot of plan.slots) {
    let code: string | undefined;
    if (slot.kind === 'curve') {
      code = takeFrom(avail, pools.curve, (c) => (z > 0 && c === 'CU4' ? -1 : prefIndex(c)));
      if (!code) return undefined;
      steps.push({ code, inPort: slot.turn > 0 ? 'a' : 'b', outPort: slot.turn > 0 ? 'b' : 'a' });
    } else if (slot.kind === 'straight') {
      code = takeFrom(avail, pools.straight, (c) => (z > 0 && (c === 'TU4' || c === 'ES3') ? -1 : prefIndex(c)));
      if (!code) return undefined;
      steps.push({ code, inPort: 'a', outPort: 'b' });
    } else {
      code = takeFrom(avail, pools.ramp);
      if (!code) return undefined;
      steps.push(slot.up ? { code, inPort: 'a', outPort: 'b' } : { code, inPort: 'b', outPort: 'a' });
      z += slot.up ? 1 : -1;
    }
  }
  const { pieces, end } = placeChain(cat, startPose(), steps);
  const first = worldPorts(cat, pieces[0]).find((p) => p.port === steps[0].inPort)!;
  if (!portsMate(end, first, cat.params)) return undefined;
  return { pieces, order: pieces.map((p) => p.uid) };
}

// ---------------------------------------------------------------- decoration

interface DecorState {
  pieces: PlacedPiece[];
  order: string[];
  avail: Counts;
  features: string[];
}

const SWITCH_RIGHT = ['TR', 'SWB'];
const SWITCH_LEFT = ['TL'];

function piecePortPose(cat: Catalog, piece: PlacedPiece, port: string): WorldPort {
  return worldPorts(cat, piece).find((p) => p.port === port)!;
}

/** Replace a straight in the loop with another same-length piece entered through `inPort`. */
function replaceInline(cat: Catalog, st: DecorState, uid: string, code: string, inPort: string): PlacedPiece {
  const old = st.pieces.find((p) => p.uid === uid)!;
  const a = piecePortPose(cat, old, 'a');
  const target: Pose = { x: a.x, y: a.y, dir: normDeg(a.dir + 180), z: a.z };
  const { piece } = placeAt(cat, target, code, inPort, uid);
  return piece;
}

function gridOf(cat: Catalog, pieces: PlacedPiece[]): SampleGrid {
  const g = new SampleGrid(cat.params.trackWidth);
  for (const p of pieces) for (const s of worldSamples(cat, p)) g.add(s);
  return g;
}

/**
 * Bounded search for a chain of straights/curves from `from` (an outward port) that
 * mates with `to`. Used to close passing loops between two switch branches.
 */
function connectPorts(
  cat: Catalog,
  pools: Pools,
  existing: PlacedPiece[],
  from: WorldPort,
  to: WorldPort,
  avail: Counts,
  maxDepth: number,
): PlacedPiece[] | undefined {
  const params = cat.params;
  const grid = gridOf(cat, existing);
  const gap = params.trackWidth * 0.85;
  const S = params.straight;
  const moves: { pool: string[]; inPort: string; outPort: string }[] = [
    { pool: pools.straight, inPort: 'a', outPort: 'b' },
    { pool: pools.curve, inPort: 'a', outPort: 'b' },
    { pool: pools.curve, inPort: 'b', outPort: 'a' },
  ];
  const path: PlacedPiece[] = [];
  const pathSamples: Sample[][] = [];
  let found: PlacedPiece[] | undefined;
  let nodes = 0;
  const rec = (cur: Pose, depth: number) => {
    if (found || nodes++ > 4000) return;
    if (path.length > 0 && portsMate(cur, to, params)) {
      found = [...path];
      return;
    }
    if (depth === 0) return;
    if (dist(cur, to) > depth * S + params.joinTolerance) return;
    const options = moves
      .map((m) => {
        const code = m.pool.find((c) => (avail[c] ?? 0) > 0);
        if (!code) return undefined;
        const { piece, ports } = placeAt(cat, cur, code, m.inPort);
        const out = ports.find((p) => p.port === m.outPort)!;
        return { code, piece, out, d: dist(out, to) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.d - b.d);
    for (const o of options) {
      const samples = worldSamples(cat, o.piece).flat();
      const ignore = [cur, o.out, to, from];
      if (grid.hits(samples, gap, params.clearanceLevels, ignore, params.trackWidth)) continue;
      // the new piece must not fold back onto the path built so far (skip the piece it joins)
      const local = new SampleGrid(params.trackWidth);
      pathSamples.slice(0, -1).forEach((ss) => local.add(ss));
      if (local.hits(samples, gap, params.clearanceLevels, ignore, params.trackWidth)) continue;
      avail[o.code]--;
      path.push(o.piece);
      pathSamples.push(samples);
      rec(o.out, depth - 1);
      path.pop();
      pathSamples.pop();
      avail[o.code]++;
      if (found) return;
    }
  };
  rec(from, maxDepth);
  if (found) for (const p of found) avail[p.code]--;
  return found;
}

/** Runs of consecutive ground-level straights in loop order (indices into order). */
function straightRuns(cat: Catalog, st: DecorState, pools: Pools): number[][] {
  const byUid = new Map(st.pieces.map((p) => [p.uid, p]));
  const runs: number[][] = [];
  let cur: number[] = [];
  st.order.forEach((uid, i) => {
    const p = byUid.get(uid)!;
    const flat = cat.get(p.code).ports.every((q) => q.z + p.z === p.z) && p.z === 0;
    if (pools.straight.includes(p.code) && flat) cur.push(i);
    else {
      if (cur.length) runs.push(cur);
      cur = [];
    }
  });
  if (cur.length) runs.push(cur);
  return runs;
}

function tryCommit(cat: Catalog, st: DecorState, next: PlacedPiece[]): boolean {
  const v = validateLayout(cat, next);
  const bad = v.issues.some((i) => i.severity === 'error' || i.rule === 'open-end' || i.rule === 'misaligned');
  if (bad) return false;
  st.pieces = next;
  return true;
}

function withReplaced(st: DecorState, repl: PlacedPiece[], extra: PlacedPiece[] = []): PlacedPiece[] {
  const m = new Map(repl.map((p) => [p.uid, p]));
  return [...st.pieces.map((p) => m.get(p.uid) ?? p), ...extra];
}

function giveBack(st: DecorState, codes: string[]) {
  for (const c of codes) st.avail[c] = (st.avail[c] ?? 0) + 1;
}

function addStation(cat: Catalog, st: DecorState, pools: Pools, rng: Rng, withStation: boolean): boolean {
  const need = withStation ? ['PR', 'LS', 'PL'] : ['PR', 'PL'];
  if (need.some((c) => !cat.has(c) || (st.avail[c] ?? 0) < 1)) return false;
  for (const run of shuffle(rng, straightRuns(cat, st, pools))) {
    if (run.length < need.length) continue;
    const startIdx = randInt(rng, 0, run.length - need.length);
    const uids = run.slice(startIdx, startIdx + need.length).map((i) => st.order[i]);
    for (const mirrored of shuffle(rng, [false, true])) {
      // right-hand lane: PR fwd, [LS fwd], PL rev. Left-hand: PL fwd, [LS rev], PR rev.
      const plan = mirrored
        ? [
            ['PL', 'a'],
            ...(withStation ? [['LS', 'b']] : []),
            ['PR', 'b'],
          ]
        : [
            ['PR', 'a'],
            ...(withStation ? [['LS', 'a']] : []),
            ['PL', 'b'],
          ];
      const freed = uids.map((u) => st.pieces.find((p) => p.uid === u)!.code);
      const repl = plan.map(([code, inPort], i) => replaceInline(cat, st, uids[i], code, inPort));
      if (!tryCommit(cat, st, withReplaced(st, repl))) continue;
      giveBack(st, freed);
      need.forEach((c) => st.avail[c]--);
      st.features.push(withStation ? 'Loading station with two lanes' : 'Double-track passing section');
      return true;
    }
  }
  return false;
}

function addSiding(cat: Catalog, st: DecorState, pools: Pools, rng: Rng): boolean {
  // a pair of switches on the loop whose branches are joined by a new track
  const right = SWITCH_RIGHT.filter((c) => cat.has(c) && (st.avail[c] ?? 0) > 0);
  const left = SWITCH_LEFT.filter((c) => cat.has(c) && (st.avail[c] ?? 0) > 0);
  const runs = straightRuns(cat, st, pools).filter((r) => r.length >= 2);
  for (const run of shuffle(rng, runs)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const i = randInt(rng, 0, run.length - 2);
      const j = randInt(rng, i + 1, run.length - 1);
      const uA = st.order[run[i]];
      const uB = st.order[run[j]];
      // facing switch at A diverging to one side; trailing switch at B joining from the same side
      for (const side of shuffle(rng, ['right', 'left'] as const)) {
        const codeA = side === 'right' ? right[0] : left[0];
        // trailing (entered at b) switch whose branch is on the same side must be the other hand
        const codeB = side === 'right' ? left[0] : right.find((c) => c !== codeA) ?? right[0];
        if (!codeA || !codeB) continue;
        if (codeA === codeB && (st.avail[codeA] ?? 0) < 2) continue;
        const pA = replaceInline(cat, st, uA, codeA, 'a');
        const pB = replaceInline(cat, st, uB, codeB, 'b');
        const base = withReplaced(st, [pA, pB]);
        const from = piecePortPose(cat, pA, 'c');
        const to = piecePortPose(cat, pB, 'c');
        const avail = { ...st.avail };
        avail[codeA]--;
        avail[codeB]--;
        if ((avail[codeA] ?? 0) < 0 || (avail[codeB] ?? 0) < 0) continue;
        // the two replaced straights become available again
        const freed = [st.pieces.find((p) => p.uid === uA)!.code, st.pieces.find((p) => p.uid === uB)!.code];
        freed.forEach((c) => (avail[c] = (avail[c] ?? 0) + 1));
        const link = connectPorts(cat, pools, base, from, to, avail, 8);
        if (!link) continue;
        if (!tryCommit(cat, st, [...base, ...link])) continue;
        st.avail = avail;
        st.features.push('Passing loop');
        return true;
      }
    }
  }
  return false;
}

function addSpur(cat: Catalog, st: DecorState, pools: Pools, rng: Rng): boolean {
  const buffer = pools.buffer.find((c) => (st.avail[c] ?? 0) > 0);
  if (!buffer) return false;
  const switches = [...SWITCH_RIGHT, ...SWITCH_LEFT].filter((c) => cat.has(c) && (st.avail[c] ?? 0) > 0);
  if (!switches.length) return false;
  const runs = straightRuns(cat, st, pools);
  for (const run of shuffle(rng, runs)) {
    for (const idx of shuffle(rng, run).slice(0, 3)) {
      const uid = st.order[idx];
      for (const code of shuffle(rng, switches)) {
        for (const inPort of shuffle(rng, ['a', 'b'])) {
          const sw = replaceInline(cat, st, uid, code, inPort);
          const freed = st.pieces.find((p) => p.uid === uid)!.code;
          const avail = { ...st.avail, [freed]: (st.avail[freed] ?? 0) + 1 };
          avail[code]--;
          const branch = piecePortPose(cat, sw, 'c');
          // a curve to straighten out, then up to two straights, then the buffer
          for (const len of shuffle(rng, [1, 2, 0])) {
            const a2 = { ...avail };
            const steps: ChainStep[] = [];
            let ok = true;
            for (let k = 0; k < len; k++) {
              const s = takeFrom(a2, pools.straight);
              if (!s) {
                ok = false;
                break;
              }
              steps.push({ code: s, inPort: 'a', outPort: 'b' });
            }
            if (!ok) continue;
            const buf = takeFrom(a2, [buffer]);
            if (!buf) continue;
            const chain = placeChain(cat, branch, steps);
            const { piece: bp } = placeAt(cat, chain.end, buf, 'a');
            if (!tryCommit(cat, st, [...withReplaced(st, [sw]), ...chain.pieces, bp])) continue;
            st.avail = a2;
            st.features.push('Siding with buffer stop');
            return true;
          }
        }
      }
    }
  }
  return false;
}

function addBridge(cat: Catalog, st: DecorState): boolean {
  // swap two consecutive raised straights for the self-supporting bridge
  if (!cat.has('VB') || (st.avail.VB ?? 0) < 1) return false;
  const byUid = new Map(st.pieces.map((p) => [p.uid, p]));
  for (let i = 0; i + 1 < st.order.length; i++) {
    const a = byUid.get(st.order[i]);
    const b = byUid.get(st.order[i + 1]);
    if (!a || !b) continue;
    const isS = (p: PlacedPiece) => cat.get(p.code).category === 'straight';
    if (!isS(a) || !isS(b) || a.z < 1 || b.z < 1) continue;
    const vb = replaceInline(cat, st, a.uid, 'VB', 'a');
    const next = st.pieces.filter((p) => p.uid !== b.uid).map((p) => (p.uid === a.uid ? vb : p));
    if (!tryCommit(cat, st, next)) continue;
    st.avail.VB--;
    st.avail[a.code] = (st.avail[a.code] ?? 0) + 1;
    st.avail[b.code] = (st.avail[b.code] ?? 0) + 1;
    st.order = st.order.filter((u) => u !== b.uid);
    st.features.push('Lift bridge on the raised section');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- scoring

function scoreCandidate(cat: Catalog, pieces: PlacedPiece[], owned: Counts, features: string[], word: TurnWord) {
  const v = validateLayout(cat, pieces, { owned });
  const trackOwned = Object.entries(owned).reduce((a, [c, n]) => a + (cat.has(c) && cat.get(c).isTrack ? n : 0), 0);
  const used = pieces.length;
  const breakdown: Record<string, number> = {};
  breakdown['Pieces used'] = Math.round(60 * Math.min(1, used / Math.max(1, trackOwned)));
  breakdown['Continuous running'] = v.running.onCycle.size > 0 ? 20 : -50;
  breakdown['Track features'] = features.length * 8;
  const maxZ = Math.max(0, ...pieces.map((p) => p.z + Math.max(...cat.get(p.code).ports.map((q) => q.z))));
  breakdown['Elevation'] = maxZ > 0 ? 8 : 0;
  const netTurn = word.reduce((a, b) => a + b, 0);
  breakdown['Crossover'] = netTurn === 0 ? 10 : 0;
  const rev = v.issues.filter((i) => i.rule === 'reverse-curve').length;
  breakdown['S-bends'] = -6 * rev;
  const warn = v.issues.filter((i) => i.severity === 'warning').length;
  breakdown['Warnings'] = -8 * warn;
  const unsupported = Object.values(v.supports.unsupported).reduce((a, b) => a + b, 0);
  breakdown['Unsupported joints'] = -6 * unsupported;
  const errors = v.issues.filter((i) => i.severity === 'error').length;
  breakdown['Errors'] = -100 * errors;
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown, issues: v.issues, valid: errors === 0 };
}

function describe(word: TurnWord, features: string[], maxZ: number): string {
  const net = word.reduce((a, b) => a + b, 0);
  const hasLeft = word.some((t) => t < 0);
  let shape = net === 0 ? 'Figure-8' : hasLeft ? 'Bent loop' : 'Oval loop';
  if (maxZ > 0 && net !== 0) shape += ' with hill';
  if (features.some((f) => f.includes('station'))) shape += ' + station';
  else if (features.some((f) => f.includes('Passing') || f.includes('Double'))) shape += ' + passing loop';
  if (features.some((f) => f.includes('Siding'))) shape += ' + siding';
  return shape;
}

// ---------------------------------------------------------------- driver

export function generateLayouts(cat: Catalog, opts: AutoGenOptions): Candidate[] {
  const owned = opts.owned;
  const rng = mulberry32(opts.seed ?? Date.now());
  const budgetMs = opts.timeBudgetMs ?? 2500;
  const t0 = Date.now();
  const pools = piecePools(cat);
  const nCurves = poolCount(owned, pools.curve);
  const nStraight = poolCount(owned, pools.straight);
  const nRamp = poolCount(owned, pools.ramp);
  const angle = cat.params.curveAngle;
  const perCircle = Math.round(360 / angle);
  const style = opts.style ?? 'any';
  if (nCurves < perCircle - 2) return [];
  const unit = cat.params.straight / 2;
  const rampUnits = Math.round(cat.params.rampLength / unit);
  const geom: LoopGeometry = {
    perCircle,
    unit,
    rampUnits: Math.abs(rampUnits * unit - cat.params.rampLength) < 0.5 ? rampUnits : 0,
    radius: cat.params.curveRadius,
    angle,
    tolerance: Math.min(cat.params.joinTolerance * 0.75, 9),
  };

  const words = closingWords(nCurves, angle, style !== 'loop').filter((w) => {
    const net = w.reduce((a, b) => a + b, 0);
    if (style === 'loop') return net !== 0;
    if (style === 'figure8') return net === 0;
    return true;
  });
  if (!words.length) return [];
  // mirror images too
  const allWords = [...words, ...words.filter((w) => w.some((t) => t < 0)).map((w) => w.map((t) => -t))];

  const results = new Map<string, Candidate>();
  let attempts = 0;
  while (Date.now() - t0 < budgetMs && attempts < 20000) {
    attempts++;
    const word = pick(rng, allWords);
    const net = word.reduce((a, b) => a + b, 0);
    // figure-8s need a raised crossing; loops get a hill sometimes when asked
    const maxPairs = Math.floor(nRamp / 2);
    let pairs = 0;
    if (net === 0) {
      if (maxPairs < 1) continue;
      pairs = randInt(rng, 1, Math.min(2, maxPairs));
    } else if (opts.wantElevation !== false && maxPairs > 0 && rng() < 0.5) {
      pairs = randInt(rng, 1, Math.min(2, maxPairs));
    }
    const plan = planLoop(rng, word, geom, { straight: nStraight, ramp: nRamp }, pairs);
    if (!plan) continue;
    const built = buildLoop(cat, pools, plan, owned);
    if (!built) continue;
    const base = validateLayout(cat, built.pieces);
    if (base.issues.some((i) => i.severity === 'error' || i.rule === 'open-end')) continue;

    // decorate
    const avail: Counts = { ...owned };
    for (const [c, n] of Object.entries(pieceCounts(built.pieces))) avail[c] -= n;
    const st: DecorState = { pieces: built.pieces, order: built.order, avail, features: [] };
    if (pairs > 0) addBridge(cat, st);
    if (opts.wantStation !== false && rng() < 0.8) addStation(cat, st, pools, rng, true) || addStation(cat, st, pools, rng, false);
    if (opts.wantSidings !== false) {
      if (rng() < 0.6) addSiding(cat, st, pools, rng);
      if (rng() < 0.7) addSpur(cat, st, pools, rng);
    }

    // fit the space
    let pieces = normalizeOrigin(cat, st.pieces);
    let b = layoutBounds(cat, pieces);
    const W = opts.maxWidth ?? Infinity;
    const D = opts.maxDepth ?? Infinity;
    if (b.width > W || b.height > D) {
      if (b.height <= W && b.width <= D) {
        pieces = normalizeOrigin(cat, rotateLayout(pieces, 90));
        b = layoutBounds(cat, pieces);
      } else continue;
    }
    // landscape orientation reads better
    if (b.height > b.width && b.width <= D && b.height <= W) {
      pieces = normalizeOrigin(cat, rotateLayout(pieces, 90));
      b = layoutBounds(cat, pieces);
    }

    const s = scoreCandidate(cat, pieces, owned, st.features, word);
    if (!s.valid) continue;
    const maxZ = Math.max(0, ...pieces.map((p) => p.z + Math.max(...cat.get(p.code).ports.map((q) => q.z))));
    const counts = pieceCounts(pieces);
    const sig = `${canonical(word)}|${Object.entries(counts)
      .sort()
      .map(([k, v]) => `${k}${v}`)
      .join(',')}|${st.features.sort().join(',')}`;
    const prev = results.get(sig);
    if (prev && prev.score >= s.score) continue;
    results.set(sig, {
      name: describe(word, st.features, maxZ),
      pieces,
      score: s.score,
      features: [...st.features, ...(maxZ > 0 ? [`Raised to level ${maxZ}`] : []), ...(net === 0 ? ['Crosses over itself'] : [])],
      breakdown: s.breakdown,
      issues: s.issues,
      width: Math.round(b.width),
      depth: Math.round(b.height),
      counts,
    });
  }

  // best first, but keep variety of shapes
  const sorted = [...results.values()].sort((a, b) => b.score - a.score);
  const want = opts.results ?? 6;
  const out: Candidate[] = [];
  const names = new Map<string, number>();
  for (const c of sorted) {
    const n = names.get(c.name) ?? 0;
    if (n >= 2) continue;
    names.set(c.name, n + 1);
    out.push(c);
    if (out.length >= want) break;
  }
  for (const c of sorted) {
    if (out.length >= want) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}
