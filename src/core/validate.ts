import { angleDiff, dist, type Vec } from './geometry';
import type { Catalog } from './catalog';
import { shortages, type Counts } from './inventory';
import {
  computeConnectivity,
  layoutBounds,
  pieceCounts,
  portKey,
  worldBlockers,
  worldSamples,
  type Connectivity,
  type PlacedPiece,
} from './layout';
import { operationalChecks } from './operations';
import { analyzeRunning, turnThrough, type RunAnalysis } from './graph';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  uids: string[];
  at?: Vec;
}

export interface SupportPlan {
  /** Raised joints needing a support, by level. */
  needed: Record<number, number>;
  /** Support pieces the plan uses. */
  used: Counts;
  /** Joints that could not be supported with owned pieces, by level. */
  unsupported: Record<number, number>;
}

export interface ValidationResult {
  issues: Issue[];
  conn: Connectivity;
  running: RunAnalysis;
  counts: Counts;
  supports: SupportPlan;
}

export const RULES: Record<string, { title: string; why: string }> = {
  overlap: { title: 'Overlapping track', why: 'Two pieces occupy the same space at the same height.' },
  headroom: {
    title: 'Not enough headroom',
    why: 'Track passes over other track without enough height for an engine underneath (set in Settings, default 2 levels).',
  },
  'too-close': {
    title: 'Tracks too close',
    why: 'Engines and cars are wider than the track; trains on these tracks would scrape each other.',
  },
  disconnected: { title: 'Disconnected track', why: 'Pieces that aren’t joined to the main layout can’t be reached by trains.' },
  'direction-change': { title: 'Turning trains', why: 'Whether an engine can reverse its direction of travel using the track alone.' },
  unreachable: { title: 'Unreachable track', why: 'No route from the main line leads here, usually because a switch faces the wrong way.' },
  'one-way-loop': {
    title: 'Loop reachable one way only',
    why: 'Trains running one direction can get into this loop, trains running the other way can’t.',
  },
  'conflict-points': {
    title: 'Junctions and crossings',
    why: 'Places where two trains’ paths meet; with more than one engine they can collide there.',
  },
  'head-on': { title: 'Head-on risk', why: 'Once a train turns around it runs against the others on the same track.' },
  capacity: { title: 'Too many engines', why: 'Each extra engine needs a passing loop, a long enough siding, or a stop to wait at.' },
  'trailing-switch': {
    title: 'Switches that must be set',
    why: 'Your settings say engines derail when going through a switch set against them.',
  },
  'short-siding': { title: 'Siding too short', why: 'A train left in the siding would stick out and block the main line.' },
  'short-passing-loop': { title: 'Passing loop too short', why: 'Neither track is long enough to hold a train clear of both switches.' },
  'stop-on-grade': {
    title: 'Stop on a slope',
    why: 'An engine stopped on or at the foot of a ramp may not have the grip to restart uphill.',
  },
  'stop-near-junction': { title: 'Stop close to a junction', why: 'A train waiting here sticks out across the junction and blocks it.' },
  footprint: { title: 'Doesn’t fit your space', why: 'The layout is bigger than the space set in Settings.' },
  'level-step': { title: 'Height mismatch', why: 'Two ends meet but at different heights; add a ramp.' },
  misaligned: { title: 'Ends almost meet', why: 'Two open ends are close but do not line up; the joint would be forced.' },
  'open-end': { title: 'Open track end', why: 'Trains run off the end. Connect it or finish it with a buffer stop.' },
  'no-loop': { title: 'No continuous loop', why: 'Motorized engines run best on a closed loop so they never stop at an end.' },
  shortage: { title: 'Not enough pieces', why: 'The layout uses more of a piece than your inventory has.' },
  supports: { title: 'Supports needed', why: 'Raised joints need supports; some cannot be covered by supports you own.' },
  'below-ground': { title: 'Below ground', why: 'Part of this piece would be under the floor.' },
  'off-ground': {
    title: 'Not on the floor',
    why: 'This piece stands on its own base (the bucket or the lid’s legs) so it must sit on the floor. Use ramps to reach its height.',
  },
  'bad-joint': { title: 'Pieces don’t fit together', why: 'These two pieces physically clash where they meet.' },
  'reverse-curve': { title: 'S-bend', why: 'Opposite curves back to back jerk trains sideways; a straight between them runs smoother.' },
  'switch-on-grade': { title: 'Switch next to a ramp', why: 'Points on or right at a grade are a common stall/derail spot.' },
  'steep-climb': { title: 'Long climb', why: 'Two ramps in a row climb steeply; small battery engines may stall.' },
  'trapped-section': { title: 'Dead-end section', why: 'From here a train can only reach a buffer or end and must stop.' },
};

const issue = (rule: string, severity: Severity, message: string, uids: string[], at?: Vec): Issue => ({
  rule,
  severity,
  message,
  uids,
  at,
});

/** Assign owned support pieces to raised joints. */
export function planSupports(cat: Catalog, pieces: PlacedPiece[], conn: Connectivity, owned?: Counts): SupportPlan {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const needed: Record<number, number> = {};
  const seen = new Set<string>();
  for (const port of conn.ports) {
    const k = portKey(port);
    if (seen.has(k)) continue;
    seen.add(k);
    const mate = conn.links.get(k);
    if (mate) seen.add(portKey(mate));
    const level = Math.round(port.z);
    if (level < 1) continue;
    const holds = (uid: string | undefined, portId: string | undefined) => {
      if (!uid || !portId) return false;
      const t = cat.get(byUid.get(uid)!.code);
      return !!t.selfSupporting || !!t.supportedPorts?.includes(portId);
    };
    const selfSupported = holds(port.uid, port.port) || holds(mate?.uid, mate?.port);
    if (selfSupported) continue;
    needed[level] = (needed[level] ?? 0) + 1;
  }
  const avail: Counts = { ...(owned ?? {}) };
  const used: Counts = {};
  const unsupported: Record<number, number> = {};
  const levels = Object.keys(needed)
    .map(Number)
    .sort((x, y) => y - x);
  if (!owned) return { needed, used, unsupported };

  // Supports stack: a column of support pieces whose levels add up to the joint's level.
  // Paired supports (RS1/RS2/RS3) stack, and need two columns plus a D1 deck. Piers (RR1) stand alone
  // at their own height and don't stack.
  const supportTypes = cat.supports().filter((t) => (t.supportLevel ?? 0) > 0);
  const paired = supportTypes.filter((t) => t.pairedSupport).sort((x, y) => y.supportLevel! - x.supportLevel!);
  const single = supportTypes.filter((t) => !t.pairedSupport).sort((x, y) => y.supportLevel! - x.supportLevel!);
  const deck = cat.has('D1') ? 'D1' : undefined;

  /** Fewest pieces of `types` (from `pool`) stacking to exactly `level`. */
  const column = (types: typeof supportTypes, pool: Counts, level: number): Counts | undefined => {
    let best: Counts | undefined;
    let bestN = Infinity;
    const pick: Counts = {};
    const rec = (i: number, left: number, n: number) => {
      if (n >= bestN) return;
      if (left === 0) {
        best = { ...pick };
        bestN = n;
        return;
      }
      if (i >= types.length) return;
      const t = types[i];
      const h = t.supportLevel!;
      const maxUse = Math.min(
        Math.floor(left / h),
        (pool[t.code] ?? 0) - (pick[t.code] ?? 0),
        t.stackable ? Infinity : n === 0 && h === left ? 1 : 0,
      );
      for (let k = maxUse; k >= 0; k--) {
        if (k) pick[t.code] = (pick[t.code] ?? 0) + k;
        rec(i + 1, left - k * h, n + k);
        if (k) {
          pick[t.code] -= k;
          if (!pick[t.code]) delete pick[t.code];
        }
      }
    };
    rec(0, level, 0);
    return best;
  };
  const merge = (a2: Counts, b2: Counts) => {
    const out = { ...a2 };
    for (const [c, n] of Object.entries(b2)) out[c] = (out[c] ?? 0) + n;
    return out;
  };
  const size = (c: Counts) => Object.values(c).reduce((x, y) => x + y, 0);

  for (const level of levels) {
    for (let i = 0; i < needed[level]; i++) {
      const options: Counts[] = [];
      const one = column(single, avail, level);
      if (one) options.push(one);
      if (deck && (avail[deck] ?? 0) > 0) {
        const first = column(paired, avail, level);
        if (first) {
          const rest = { ...avail };
          for (const [c, n] of Object.entries(first)) rest[c] -= n;
          const second = column(paired, rest, level);
          if (second) options.push(merge(merge(first, second), { [deck]: 1 }));
        }
      }
      // fewest pieces wins; a single pier wins a tie
      const choice = options.sort((x, y) => size(x) - size(y))[0];
      if (!choice) {
        unsupported[level] = (unsupported[level] ?? 0) + 1;
        continue;
      }
      for (const [c, n] of Object.entries(choice)) {
        avail[c] -= n;
        used[c] = (used[c] ?? 0) + n;
      }
    }
  }
  return { needed, used, unsupported };
}

export interface ValidateOptions {
  /** Owned piece totals; when given, shortages and supports are checked. */
  owned?: Counts;
  /** Available floor/table space in mm; when given, the footprint is checked against it. */
  space?: { width: number; depth: number };
}

export function validateLayout(cat: Catalog, pieces: PlacedPiece[], opts: ValidateOptions = {}): ValidationResult {
  const params = cat.params;
  const conn = computeConnectivity(cat, pieces);
  const issues: Issue[] = [];
  const byUid = new Map(pieces.map((p) => [p.uid, p]));

  // ---- open ends, height steps, misalignment
  const open = conn.open;
  const flagged = new Set<number>();
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i];
      const b = open[j];
      if (a.uid === b.uid) continue;
      const d = dist(a, b);
      if (d > params.trackWidth) continue;
      const facing = Math.abs(angleDiff(a.dir, b.dir + 180)) <= params.angleTolerance * 2;
      if (d <= params.joinTolerance && facing && Math.abs(a.z - b.z) > 0.01) {
        issues.push(issue('level-step', 'error', `Ends meet at different heights (level ${a.z} vs ${b.z}).`, [a.uid, b.uid], a));
      } else {
        issues.push(issue('misaligned', 'warning', `Ends are ${Math.round(d)} mm apart and don't line up.`, [a.uid, b.uid], a));
      }
      flagged.add(i).add(j);
    }
  }
  open.forEach((p, i) => {
    if (flagged.has(i)) return;
    issues.push(issue('open-end', 'warning', `Open end on ${cat.get(byUid.get(p.uid)!.code).name}.`, [p.uid], p));
  });

  // ---- overlap, headroom and side clearance (sample-based)
  // overlap: track beds in the same space (less than one level apart), including solid bodies;
  // headroom: track passing over other track less than `clearanceLevels` above it;
  // too close: tracks at the same level nearer than an engine is wide.
  const headroom = params.clearanceLevels;
  const reach = Math.max(params.trackWidth, params.vehicleWidth);
  const cell = reach;
  const minGap = params.trackWidth * 0.85;
  type Pt = { uid: string; x: number; y: number; z: number; body: boolean };
  const grid = new Map<string, Pt[]>();
  const all = pieces.map((p) => ({
    p,
    samples: [
      ...worldSamples(cat, p)
        .flat()
        .map((q) => ({ ...q, body: false })),
      ...worldBlockers(cat, p).map((q) => ({ ...q, body: true })),
    ],
  }));
  for (const { p, samples } of all)
    for (const q of samples) {
      const k = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push({ uid: p.uid, ...q });
    }
  // joints between each pair of linked pieces, and pieces within two joints of each other
  const joints = new Map<string, Vec[]>();
  const nbrs = new Map<string, Set<string>>();
  for (const port of conn.ports) {
    const mate = conn.links.get(portKey(port));
    if (!mate) continue;
    const key = port.uid < mate.uid ? `${port.uid}|${mate.uid}` : `${mate.uid}|${port.uid}`;
    (joints.get(key) ?? joints.set(key, []).get(key)!).push(port);
    (nbrs.get(port.uid) ?? nbrs.set(port.uid, new Set()).get(port.uid)!).add(mate.uid);
  }
  const nearJoint = (key: string, a: Vec, b: Vec) =>
    (joints.get(key) ?? []).some((j) => dist(j, a) < params.trackWidth && dist(j, b) < params.trackWidth);
  // tracks leaving the same switch run close together for a while; that's expected
  const closeNeighbours = (a: string, b: string) => {
    const na = nbrs.get(a) ?? new Set();
    if (na.has(b)) return true;
    for (const x of na) if ((nbrs.get(x) ?? new Set()).has(b)) return true;
    return false;
  };
  const found = new Map<string, { rule: 'overlap' | 'headroom' | 'too-close'; at: Vec; dz: number; d: number }>();
  const rank = { overlap: 3, headroom: 2, 'too-close': 1 } as const;
  for (const { p, samples } of all) {
    for (const s0 of samples) {
      const cx = Math.floor(s0.x / cell);
      const cy = Math.floor(s0.y / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const o of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (o.uid <= p.uid) continue;
            const key = `${p.uid}|${o.uid}`;
            const prev = found.get(key);
            if (prev?.rule === 'overlap') continue;
            const d = dist(o, s0);
            if (d >= reach) continue;
            const dz = Math.abs(o.z - s0.z);
            if (dz >= headroom - 1e-6 && !(s0.body || o.body)) continue;
            if (nearJoint(key, s0, o)) continue;
            let rule: 'overlap' | 'headroom' | 'too-close' | undefined;
            if (dz < 1 - 1e-6 && d < minGap) rule = 'overlap';
            else if (s0.body || o.body)
              continue; // a solid body only matters for direct overlap
            else if (closeNeighbours(p.uid, o.uid)) continue;
            else if (dz >= 1 - 1e-6) rule = 'headroom';
            else rule = 'too-close';
            if (!prev || rank[rule] > rank[prev.rule]) found.set(key, { rule, at: s0, dz, d });
          }
    }
  }
  for (const [key, f] of found) {
    const uids = key.split('|');
    if (f.rule === 'overlap') issues.push(issue('overlap', 'error', 'Pieces overlap.', uids, f.at));
    else if (f.rule === 'headroom')
      issues.push(
        issue('headroom', 'error', `Only ${Math.floor(f.dz + 1e-6)} level of headroom here; engines need ${headroom}.`, uids, f.at),
      );
    else
      issues.push(
        issue(
          'too-close',
          'warning',
          `Tracks are ${Math.round(f.d)} mm apart (centre to centre); engines are ${params.vehicleWidth} mm wide.`,
          uids,
          f.at,
        ),
      );
  }

  // ---- pieces under the floor, and free-standing pieces lifted off it
  for (const p of pieces) {
    const t = cat.get(p.code);
    if (t.body && Math.abs(p.z) > 0.01) {
      issues.push(issue('off-ground', 'error', `${t.name} is placed ${p.z > 0 ? 'above' : 'below'} the floor.`, [p.uid]));
      continue;
    }
    const low = Math.min(
      ...worldSamples(cat, p)
        .flat()
        .map((s) => s.z),
    );
    if (low < -0.01) issues.push(issue('below-ground', 'error', `${t.name} goes below ground.`, [p.uid]));
  }

  // ---- inventory
  const counts = pieceCounts(pieces, cat);
  if (opts.owned) {
    const short = shortages(counts, opts.owned);
    for (const [code, n] of Object.entries(short)) {
      const uids = pieces.filter((p) => cat.get(p.code).stockCode === code).map((p) => p.uid);
      issues.push(issue('shortage', 'error', `Uses ${n} more ${cat.has(code) ? cat.get(code).name : code} (${code}) than you own.`, uids));
    }
  }

  // ---- supports
  const supports = planSupports(cat, pieces, conn, opts.owned);
  for (const [level, n] of Object.entries(supports.unsupported)) {
    issues.push(issue('supports', 'warning', `${n} raised joint${n > 1 ? 's' : ''} at level ${level} without a support you own.`, []));
  }

  // ---- running analysis
  const running = analyzeRunning(cat, pieces, conn);
  const trackPieces = pieces.filter((p) => cat.get(p.code).isTrack);
  if (trackPieces.length > 0 && running.onCycle.size === 0) {
    issues.push(issue('no-loop', 'warning', 'There is no closed loop, so engines will always reach an end.', []));
  }
  if (running.onCycle.size > 0) {
    // pieces from which, in some direction, a train is forced to stop
    const trapped = new Set<string>();
    for (const p of trackPieces) {
      const t = cat.get(p.code);
      if (t.category === 'buffer') continue;
      for (const port of t.ports) {
        const k = `${p.uid}>${port.id}`;
        if (!running.canRunForever.has(k)) trapped.add(p.uid);
      }
    }
    // only report track that is not on any loop (spurs/sidings are expected to be dead ends)
    const offLoop = [...trapped].filter((u) => !running.loopPieces.has(u));
    if (offLoop.length && open.length > 0)
      issues.push(issue('trapped-section', 'info', `${offLoop.length} piece(s) lead only to a dead end.`, offLoop));
  }

  // ---- how trains run: turning, reachability, conflicts, siding lengths, stops, disconnected track
  issues.push(...operationalChecks(cat, pieces, conn));

  // ---- footprint against the available space
  if (opts.space && trackPieces.length) {
    const b = layoutBounds(cat, pieces);
    const { width: W, depth: D } = opts.space;
    if (b.width > W + 0.5 || b.height > D + 0.5) {
      const rotated = b.height <= W + 0.5 && b.width <= D + 0.5;
      issues.push(
        issue(
          'footprint',
          'warning',
          `Layout is ${Math.round(b.width / 10)} × ${Math.round(b.height / 10)} cm; your space is ${Math.round(W / 10)} × ${Math.round(D / 10)} cm.${rotated ? ' It fits if you turn it 90°.' : ''}`,
          [],
        ),
      );
    }
  }

  // ---- design rules on consecutive pieces
  const seenPairs = new Set<string>();
  for (const p of trackPieces) {
    const t = cat.get(p.code);
    for (const port of t.ports) {
      const mate = conn.links.get(portKey({ uid: p.uid, port: port.id }));
      if (!mate) continue;
      const pairKey = [p.uid, mate.uid].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const q = byUid.get(mate.uid)!;
      const u = cat.get(q.code);
      const at = { x: 0, y: 0 };
      const wp = conn.ports.find((w) => w.uid === p.uid && w.port === port.id);
      if (wp) Object.assign(at, { x: wp.x, y: wp.y });

      // reverse curves: travel from p (leaving via port) into q (entering via mate.port)
      // pieces that physically can't meet
      if (t.cannotJoin?.includes(u.stockCode) || u.cannotJoin?.includes(t.stockCode))
        issues.push(issue('bad-joint', 'error', `${t.code} can't connect directly to ${u.code}.`, [p.uid, q.uid], at));

      const turns = (x: typeof t) => x.ports.length === 2 && (x.category === 'curve' || x.category === 'ramp');
      if (turns(t) && turns(u)) {
        const pIn = t.ports.find((x) => x.id !== port.id)!.id;
        const qOut = u.ports.find((x) => x.id !== mate.port)!.id;
        const a = turnThrough(cat, p, pIn, port.id);
        const b = turnThrough(cat, q, mate.port, qOut);
        if (Math.abs(a) > 1 && Math.abs(b) > 1 && Math.sign(a) !== Math.sign(b))
          issues.push(issue('reverse-curve', 'info', 'Curves turn opposite ways back to back.', [p.uid, q.uid], at));
      }
      const cats = [t.category, u.category];
      // free-standing raised forks (the bucket lid) can only be reached by ramp, so they're exempt
      const sw = t.category === 'switch' ? t : u;
      if (cats.includes('switch') && cats.includes('ramp') && !sw.body)
        issues.push(issue('switch-on-grade', 'warning', 'Switch connects directly to a ramp.', [p.uid, q.uid], at));
      if (t.category === 'ramp' && u.category === 'ramp') {
        // only a problem if both climb the same way
        const pz = t.ports.find((x) => x.id === port.id)!.z;
        const pOther = t.ports.find((x) => x.id !== port.id)!.z;
        const qz = u.ports.find((x) => x.id === mate.port)!.z;
        const qOther = u.ports.find((x) => x.id !== mate.port)!.z;
        if (Math.sign(pz - pOther) === Math.sign(qOther - qz))
          issues.push(issue('steep-climb', 'info', 'Two ramps in a row make a long climb.', [p.uid, q.uid], at));
      }
    }
  }

  return { issues, conn, running, counts, supports };
}

export function issueSummary(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  };
}
