import { angleDiff, dist, type Vec } from './geometry';
import type { Catalog } from './catalog';
import { shortages, type Counts } from './inventory';
import { computeConnectivity, pieceCounts, portKey, worldSamples, type Connectivity, type PlacedPiece } from './layout';
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
  'level-step': { title: 'Height mismatch', why: 'Two ends meet but at different heights; add a ramp.' },
  misaligned: { title: 'Ends almost meet', why: 'Two open ends are close but do not line up; the joint would be forced.' },
  'open-end': { title: 'Open track end', why: 'Trains run off the end. Connect it or finish it with a buffer stop.' },
  'no-loop': { title: 'No continuous loop', why: 'Motorized engines run best on a closed loop so they never stop at an end.' },
  shortage: { title: 'Not enough pieces', why: 'The layout uses more of a piece than your inventory has.' },
  supports: { title: 'Supports needed', why: 'Raised joints need supports; some cannot be covered by supports you own.' },
  'reverse-curve': { title: 'S-bend', why: 'Opposite curves back to back jerk trains sideways; a straight between them runs smoother.' },
  'switch-on-grade': { title: 'Switch next to a ramp', why: 'Points on or right at a grade are a common stall/derail spot.' },
  'steep-climb': { title: 'Long climb', why: 'Two ramps in a row climb steeply; small battery engines may stall.' },
  'reversing-loop': { title: 'Reversing loop', why: 'A train can come back along the same track facing the other way. Fine for battery engines, but watch for head-on meets.' },
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
    const selfSupported = [port.uid, mate?.uid].some((u) => u && cat.get(byUid.get(u)!.code).selfSupporting);
    if (selfSupported) continue;
    needed[level] = (needed[level] ?? 0) + 1;
  }
  const avail: Counts = { ...(owned ?? {}) };
  const used: Counts = {};
  const take = (req: Counts): boolean => {
    if (!owned) return true;
    if (Object.entries(req).some(([c, n]) => (avail[c] ?? 0) < n)) return false;
    for (const [c, n] of Object.entries(req)) {
      avail[c] -= n;
      used[c] = (used[c] ?? 0) + n;
    }
    return true;
  };
  const options: Record<number, Counts[]> = {
    1: [{ RR1: 1 }, { RS1: 2, D1: 1 }],
    2: [{ RS2: 2, D1: 1 }, { RS1: 4, D1: 1 }],
    3: [{ RS3: 2, D1: 1 }],
  };
  // custom supports: a single piece holding the exact level
  for (const s of cat.supports())
    if (s.custom && s.supportLevel) (options[s.supportLevel] ??= []).unshift({ [s.code]: 1 });
  const unsupported: Record<number, number> = {};
  for (const level of Object.keys(needed)
    .map(Number)
    .sort((a, b) => b - a)) {
    for (let i = 0; i < needed[level]; i++) {
      const ok = (options[level] ?? []).some((o) => take(o));
      if (!ok) unsupported[level] = (unsupported[level] ?? 0) + 1;
    }
  }
  return { needed, used, unsupported };
}

export interface ValidateOptions {
  /** Owned piece totals; when given, shortages and supports are checked. */
  owned?: Counts;
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

  // ---- overlap (sample-based)
  const cell = params.trackWidth;
  const minGap = params.trackWidth * 0.85;
  const grid = new Map<string, { uid: string; x: number; y: number; z: number }[]>();
  const all = pieces.map((p) => ({ p, samples: worldSamples(cat, p).flat() }));
  for (const { p, samples } of all)
    for (const s of samples) {
      const k = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push({ uid: p.uid, ...s });
    }
  // joints between each pair of linked pieces
  const joints = new Map<string, Vec[]>();
  for (const port of conn.ports) {
    const mate = conn.links.get(portKey(port));
    if (!mate) continue;
    const key = port.uid < mate.uid ? `${port.uid}|${mate.uid}` : `${mate.uid}|${port.uid}`;
    (joints.get(key) ?? joints.set(key, []).get(key)!).push(port);
  }
  const nearJoint = (key: string, a: Vec, b: Vec) =>
    (joints.get(key) ?? []).some((j) => dist(j, a) < params.trackWidth && dist(j, b) < params.trackWidth);
  const reported = new Set<string>();
  for (const { p, samples } of all) {
    for (const s of samples) {
      const cx = Math.floor(s.x / cell);
      const cy = Math.floor(s.y / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const o of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (o.uid <= p.uid) continue;
            const key = `${p.uid}|${o.uid}`;
            if (reported.has(key)) continue;
            if (Math.abs(o.z - s.z) >= params.clearanceLevels - 1e-6) continue;
            if (dist(o, s) >= minGap) continue;
            if (nearJoint(key, s, o)) continue;
            reported.add(key);
            issues.push(issue('overlap', 'error', 'Pieces overlap.', [p.uid, o.uid], s));
          }
    }
  }

  // ---- inventory
  const counts = pieceCounts(pieces);
  if (opts.owned) {
    const short = shortages(counts, opts.owned);
    for (const [code, n] of Object.entries(short)) {
      const uids = pieces.filter((p) => p.code === code).map((p) => p.uid);
      issues.push(issue('shortage', 'error', `Uses ${n} more ${cat.get(code).name} (${code}) than you own.`, uids));
    }
  }

  // ---- supports
  const supports = planSupports(cat, pieces, conn, opts.owned);
  for (const [level, n] of Object.entries(supports.unsupported)) {
    issues.push(
      issue('supports', 'warning', `${n} raised joint${n > 1 ? 's' : ''} at level ${level} without a support you own.`, []),
    );
  }

  // ---- running analysis
  const running = analyzeRunning(cat, pieces, conn);
  const trackPieces = pieces.filter((p) => cat.get(p.code).isTrack);
  if (trackPieces.length > 0 && running.onCycle.size === 0) {
    issues.push(issue('no-loop', 'warning', 'There is no closed loop, so engines will always reach an end.', []));
  }
  if (running.hasReversingLoop) issues.push(issue('reversing-loop', 'info', 'Contains a reversing loop.', []));
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
      if (t.category === 'curve' && u.category === 'curve') {
        const pIn = t.ports.find((x) => x.id !== port.id)!.id;
        const qOut = u.ports.find((x) => x.id !== mate.port)!.id;
        const a = turnThrough(cat, p, pIn, port.id);
        const b = turnThrough(cat, q, mate.port, qOut);
        if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > 1 && Math.abs(b) > 1)
          issues.push(issue('reverse-curve', 'info', 'Curves turn opposite ways back to back.', [p.uid, q.uid], at));
      }
      const cats = [t.category, u.category];
      if (cats.includes('switch') && cats.includes('ramp'))
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
