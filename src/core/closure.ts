/**
 * Exact track closure: find a run of straights, curves and ramps that leads from one open end to another.
 *
 * Every point a layout can reach is a sum of whole straights (length S, in six headings) plus whole curve chords
 * (length R, in six headings turned by half a curve). S and R don't divide into each other, so a path closes only
 * when the curves alone account for the curve part of the gap and the straights for the rest. So: for each
 * sequence of left/right curves ("turn word") that ends at the right heading, take away what its curves cover, check
 * that what remains is a whole number of straights on the straight lattice, and find straight counts for the runs
 * between curves that make it up (a small breadth-first search). Climbing pieces have a curve's plan shape, so a
 * change of level just makes some of the curves ramps.
 */
import { normDeg, type Pose, type Vec } from './geometry';
import type { Catalog } from './catalog';
import type { Counts } from './inventory';
import { placeChain, type ChainStep } from './build';
import { portsMate, type PlacedPiece } from './layout';

export interface ClosurePools {
  straight: string[];
  curve: string[];
  /** Climbing curves by the way they turn while going up (+1 entered at 'a' like a right curve, -1 left). */
  rampByTurn: Record<number, string[]>;
}

export interface ClosureOptions {
  /** Most curves to try in the connecting track. */
  maxCurves?: number;
  /** Highest level the track may climb to. */
  maxLevel?: number;
  /** Also try climbing over and back down by this many levels (to bridge over track in the way). */
  hills?: number[];
  /** Random source, so different calls find different shapes. */
  rng?: () => number;
  /** Most turn words to try. */
  maxWords?: number;
}

interface Move {
  dx: number;
  dy: number;
  turn: number;
}

interface Word {
  turns: number[];
  /** Curve-chord displacement, starting at heading 0. */
  cx: number;
  cy: number;
  /** Heading of each straight run: before the first curve, then after each curve. */
  runs: number[];
  /** Total heading change. */
  net: number;
}

const rot = (v: Vec, deg: number): Vec => {
  const a = (deg * Math.PI) / 180;
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
};

/** Measure how one piece moves the end of the track, entered at `inPort`. */
function measure(cat: Catalog, code: string, inPort: string, outPort: string): Move | undefined {
  if (!cat.has(code)) return undefined;
  const { end } = placeChain(cat, { x: 0, y: 0, dir: 0, z: 0 }, [{ code, inPort, outPort }]);
  return { dx: end.x, dy: end.y, turn: normDeg(end.dir + 180) - 180 };
}

const wordCache = new WeakMap<Catalog, { key: string; words: Word[] }>();

function turnWords(cat: Catalog, right: Move, left: Move, maxCurves: number): Word[] {
  const key = `${maxCurves}|${right.dx},${right.dy},${right.turn}|${left.dx},${left.dy},${left.turn}`;
  const hit = wordCache.get(cat);
  if (hit && hit.key === key) return hit.words;
  const words: Word[] = [];
  const rec = (turns: number[], x: number, y: number, heading: number, runs: number[]) => {
    words.push({ turns: [...turns], cx: x, cy: y, runs: [...runs], net: normDeg(heading) });
    if (turns.length === maxCurves) return;
    for (const t of [1, -1]) {
      const m = t > 0 ? right : left;
      const d = rot({ x: m.dx, y: m.dy }, heading);
      turns.push(t);
      runs.push(heading + m.turn);
      rec(turns, x + d.x, y + d.y, heading + m.turn, runs);
      runs.pop();
      turns.pop();
    }
  };
  rec([], 0, 0, 0, [0]);
  wordCache.set(cat, { key, words });
  return words;
}

/** Fewest straights in the given headings (0..5, sixths of a turn) adding up to axial (a, b); undefined if over `budget`. */
function straightCounts(a: number, b: number, dirs: Set<number>, budget: number): number[] | undefined {
  const AX: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  const start = '0,0';
  const goal = `${a},${b}`;
  if (goal === start) return [0, 0, 0, 0, 0, 0];
  const prev = new Map<string, [string, number]>([[start, ['', -1]]]);
  let frontier = [[0, 0]];
  for (let depth = 0; depth < budget && frontier.length; depth++) {
    const next: number[][] = [];
    for (const [x, y] of frontier)
      for (const k of dirs) {
        const nx = x + AX[k][0];
        const ny = y + AX[k][1];
        const key = `${nx},${ny}`;
        if (prev.has(key) || Math.abs(nx) > budget || Math.abs(ny) > budget) continue;
        prev.set(key, [`${x},${y}`, k]);
        if (key === goal) {
          const counts = [0, 0, 0, 0, 0, 0];
          let cur = key;
          while (cur !== start) {
            const [p, kk] = prev.get(cur)!;
            counts[kk]++;
            cur = p;
          }
          return counts;
        }
        next.push([nx, ny]);
      }
    frontier = next;
  }
  return undefined;
}

/** Choose which curves climb (+1) or descend (-1) so the level changes by `dz`, with an optional hill on the way. */
function planClimbs(rng: () => number, n: number, startZ: number, dz: number, hill: number, maxLevel: number): number[] | undefined {
  const ups = Math.max(dz, 0) + hill;
  const downs = Math.max(-dz, 0) + hill;
  if (ups + downs > n) return undefined;
  const idx = [...Array(n).keys()]
    .sort(() => rng() - 0.5)
    .slice(0, ups + downs)
    .sort((x, y) => x - y);
  const climbs = Array(n).fill(0);
  let z = startZ;
  let u = ups;
  let d = downs;
  for (const i of idx) {
    // climb first where we can, so a hill goes up before it comes down
    const canUp = u > 0 && z < maxLevel;
    const canDown = d > 0 && z > 0 && (u === 0 || z + u - d > startZ + dz || rng() < 0.3);
    const up = canUp && (!canDown || u >= d || rng() < 0.5);
    if (!up && !canDown) return undefined;
    climbs[i] = up ? 1 : -1;
    z += climbs[i];
    if (up) u--;
    else d--;
  }
  return z === startZ + dz ? climbs : undefined;
}

const take = (avail: Counts, codes: string[], prefer: (c: string) => number) =>
  [...codes].sort((x, y) => prefer(x) - prefer(y)).find((c) => (avail[c] ?? 0) > 0);

/**
 * Track from the open end `from` (outward-facing, as a port is) to the open end `to`, using only pieces in `avail`.
 * Returns the pieces (not yet checked against the rest of the layout) and what they use, or undefined.
 */
export function findClosure(
  cat: Catalog,
  pools: ClosurePools,
  from: Pose,
  to: Pose,
  avail: Counts,
  opts: ClosureOptions = {},
): { pieces: PlacedPiece[]; used: Counts }[] {
  const rng = opts.rng ?? Math.random;
  const maxCurves = opts.maxCurves ?? 7;
  const maxLevel = opts.maxLevel ?? 4;
  const S = pools.straight.find((c) => cat.has(c));
  const C = pools.curve.find((c) => cat.has(c));
  if (!S || !C) return [];
  const sMove = measure(cat, S, 'a', 'b')!;
  const right = measure(cat, C, 'a', 'b')!;
  const left = measure(cat, C, 'b', 'a')!;
  const step = Math.abs(right.turn);
  if (Math.abs(360 / step - Math.round(360 / step)) > 1e-6 || Math.round(360 / step) !== 6) return [];
  const sLen = Math.hypot(sMove.dx, sMove.dy);
  const sDir = (Math.atan2(sMove.dy, sMove.dx) * 180) / Math.PI;
  const tol = Math.min(cat.params.joinTolerance * 0.6, 7);
  const straightsOwned = pools.straight.reduce((a, c) => a + Math.max(0, avail[c] ?? 0), 0);
  const curvesOwned = pools.curve.reduce((a, c) => a + Math.max(0, avail[c] ?? 0), 0);
  const rampsOwned = (t: number) => (pools.rampByTurn[t] ?? []).reduce((a, c) => a + Math.max(0, avail[c] ?? 0), 0);

  // arrive facing into `to`
  const need = normDeg(to.dir + 180 - from.dir);
  const gap = rot({ x: to.x - from.x, y: to.y - from.y }, -from.dir);
  const dz = Math.round(to.z - from.z);
  const words = turnWords(cat, right, left, maxCurves).filter(
    (w) => Math.abs(normDeg(w.net - need + 180) - 180) < 0.01 && w.turns.length >= Math.abs(dz),
  );
  // shuffle, then prefer shorter words a little
  const order = words.map((w) => ({ w, k: w.turns.length + rng() * 4 })).sort((a, b) => a.k - b.k);
  const out: { pieces: PlacedPiece[]; used: Counts }[] = [];
  let tried = 0;
  for (const { w } of order) {
    if (tried++ > (opts.maxWords ?? 300) || out.length) break;
    // what the straights have to cover, in the straight lattice (relative to the first run's heading)
    const r = rot({ x: gap.x - w.cx, y: gap.y - w.cy }, -sDir);
    const b = r.y / (sLen * Math.sin(Math.PI / 3));
    const a = r.x / sLen - b * Math.cos(Math.PI / 3);
    const ai = Math.round(a);
    const bi = Math.round(b);
    const err = Math.hypot((a - ai) * sLen + (b - bi) * sLen * 0.5, (b - bi) * sLen * Math.sin(Math.PI / 3));
    if (err > tol) continue;
    const kOf = (h: number) => ((Math.round(normDeg(h) / 60) % 6) + 6) % 6;
    // each run's straights point along its heading: a whole number of sixths of a turn
    const runK = w.runs.map(kOf);
    const counts = straightCounts(ai, bi, new Set(runK), straightsOwned);
    if (!counts) continue;
    if (w.turns.length === 0 && counts.every((n) => n === 0)) continue;
    for (const hill of opts.hills ?? [0]) {
      const climbs = planClimbs(rng, w.turns.length, Math.round(from.z), dz, hill, maxLevel);
      if (!climbs) continue;
      // enough of each kind of piece?
      const needRamp: Record<number, number> = { 1: 0, [-1]: 0 };
      w.turns.forEach((t, i) => climbs[i] && (needRamp[t * climbs[i]] += 1));
      const plainCurves = climbs.filter((c) => c === 0).length;
      if (needRamp[1] > rampsOwned(1) || needRamp[-1] > rampsOwned(-1) || plainCurves > curvesOwned) continue;
      // lay out runs: put each heading's straights into one run of that heading (random choice)
      const perRun = w.runs.map(() => 0);
      counts.forEach((n, k) => {
        if (!n) return;
        const runs = runK.map((rk, i) => (rk === k ? i : -1)).filter((i) => i >= 0);
        perRun[runs[Math.floor(rng() * runs.length)]] += n;
      });
      const left2 = { ...avail };
      const steps: ChainStep[] = [];
      let z = Math.round(from.z);
      let ok = true;
      const addStraights = (n: number) => {
        for (let k = 0; k < n && ok; k++) {
          const code = take(left2, pools.straight, (c) => (z > 0 && (c === 'TU4' || c === 'ES3') ? -1 : c === 'S1' ? 0 : 1));
          if (!code) ok = false;
          else {
            left2[code]--;
            steps.push({ code, inPort: 'a', outPort: 'b' });
          }
        }
      };
      addStraights(perRun[0]);
      w.turns.forEach((t, i) => {
        if (!ok) return;
        const climb = climbs[i];
        if (climb) {
          const code = take(left2, pools.rampByTurn[t * climb] ?? [], () => 0);
          if (!code) return void (ok = false);
          left2[code]--;
          steps.push(climb > 0 ? { code, inPort: 'a', outPort: 'b' } : { code, inPort: 'b', outPort: 'a' });
          z += climb;
        } else {
          const code = take(left2, pools.curve, (c) => (z > 0 && c === 'CU4' ? -1 : c === 'C' ? 0 : 1));
          if (!code) return void (ok = false);
          left2[code]--;
          steps.push({ code, inPort: t > 0 ? 'a' : 'b', outPort: t > 0 ? 'b' : 'a' });
        }
        addStraights(perRun[i + 1]);
      });
      if (!ok || !steps.length) continue;
      const { pieces, end } = placeChain(cat, from, steps);
      if (!portsMate(end, to, cat.params)) continue;
      const used: Counts = {};
      for (const s of steps) used[s.code] = (used[s.code] ?? 0) + 1;
      out.push({ pieces, used });
      break;
    }
  }
  return out;
}
