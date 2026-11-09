/**
 * Operating checks: how trains actually run on a layout.
 *
 * A train "state" is (piece, port it entered through). From a state the train can leave
 * through any port the piece routes to; at a facing switch that's a choice. Running
 * analysis uses this directed graph:
 *
 * - Turning around: a train can reverse its direction of travel if it can reach the same
 *   piece entered from the opposite end (reversing loop, wye, ...).
 * - Reachability: starting on the main line in either direction, which pieces can a train
 *   get to, and from which direction?
 * - Conflicts: where routes merge or cross, and where engines can end up head-on.
 * - Segments: track between junctions, used for siding/passing-loop lengths and for how
 *   close stop pieces are to junctions.
 */
import type { Catalog, PieceType } from './catalog';
import { portKey, type Connectivity, type PlacedPiece } from './layout';
import { sccs, stateGraph, stateKey } from './graph';
import type { Issue } from './validate';

const fmtCm = (mm: number) => `${(mm / 10).toFixed(mm < 1000 ? 1 : 0)} cm`;

/** A piece is a junction if a train entering some end has a choice of exits. */
export const isJunction = (t: PieceType) => Object.values(t.routes).some((r) => r.length > 1);

/** The other end of a route through a non-junction piece, or undefined. */
function passThrough(t: PieceType, entry: string): string | undefined {
  const outs = t.routes[entry] ?? [];
  return outs.length === 1 ? outs[0] : undefined;
}

export interface Segment {
  /** Junction piece at the start (the walk began at one of its ends). */
  from: string;
  fromPort: string;
  /** Where it ends: a junction piece uid, or a buffer / open end. */
  to: string;
  toPort?: string;
  end: 'junction' | 'buffer' | 'open' | 'loop';
  pieces: string[];
  /** Track length between the junctions (junction pieces themselves excluded), mm. */
  length: number;
}

/** Walk the track leaving `uid` through `port` until the next junction, buffer or open end. */
export function walkSegment(cat: Catalog, byUid: Map<string, PlacedPiece>, conn: Connectivity, uid: string, port: string): Segment {
  const seg: Segment = { from: uid, fromPort: port, to: '', end: 'open', pieces: [], length: 0 };
  const seen = new Set<string>();
  let mate = conn.links.get(portKey({ uid, port }));
  while (mate) {
    const piece = byUid.get(mate.uid)!;
    const t = cat.get(piece.code);
    if (isJunction(t)) {
      Object.assign(seg, { to: mate.uid, toPort: mate.port, end: 'junction' });
      return seg;
    }
    if (seen.has(mate.uid)) {
      Object.assign(seg, { to: mate.uid, end: 'loop' });
      return seg;
    }
    seen.add(mate.uid);
    seg.pieces.push(mate.uid);
    if (t.category === 'buffer') {
      Object.assign(seg, { to: mate.uid, end: 'buffer' });
      return seg;
    }
    const out = passThrough(t, mate.port);
    if (!out) return seg;
    seg.length += t.routeLength[`${mate.port}>${out}`] ?? 0;
    mate = conn.links.get(portKey({ uid: mate.uid, port: out }));
  }
  return seg;
}

export function operationalChecks(cat: Catalog, pieces: PlacedPiece[], conn: Connectivity): Issue[] {
  const params = cat.params;
  const issues: Issue[] = [];
  const add = (rule: string, severity: Issue['severity'], message: string, uids: string[], at?: { x: number; y: number }) =>
    issues.push({ rule, severity, message, uids, at });
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const track = pieces.filter((p) => cat.get(p.code).isTrack);
  if (!track.length) return issues;
  const typeOf = (uid: string) => cat.get(byUid.get(uid)!.code);
  const portPos = (uid: string, port: string) => conn.ports.find((w) => w.uid === uid && w.port === port);

  // ------------------------------------------------------------------ disconnected sections (8)
  const parent = new Map(track.map((p) => [p.uid, p.uid]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const [k, mate] of conn.links) {
    const uid = k.split(':')[0];
    if (parent.has(uid) && parent.has(mate.uid)) parent.set(find(uid), find(mate.uid));
  }
  const groups = new Map<string, string[]>();
  for (const p of track) (groups.get(find(p.uid)) ?? groups.set(find(p.uid), []).get(find(p.uid))!).push(p.uid);
  const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length);
  const mainGroup = new Set(sortedGroups[0]);
  // a free-standing piece with nothing joined to it (the bucket standing over track as a tunnel) isn't track a
  // train should reach
  const standing = (uid: string) => !!typeOf(uid).body && ![...conn.links.keys()].some((k) => k.startsWith(`${uid}:`));
  for (const g of sortedGroups.slice(1).filter((g) => !(g.length === 1 && standing(g[0]))))
    add('disconnected', 'warning', `${g.length} piece${g.length > 1 ? 's are' : ' is'} not joined to the rest of the layout.`, g);

  // ------------------------------------------------------------------ state graph
  const { nodes, edges } = stateGraph(cat, pieces, conn);
  const comps = sccs(nodes, edges).filter((c) => c.length > 1 || (edges.get(c[0]) ?? []).includes(c[0]));
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((k) => compOf.set(k, i)));

  // ------------------------------------------------------------------ turning around (1)
  // A piece entered from opposite ends within one strongly connected set: a train can come back
  // over it the other way, i.e. it has turned around.
  const reversing = new Set<string>();
  for (const p of track) {
    const t = cat.get(p.code);
    for (const a of t.ports)
      for (const b of t.routes[a.id] ?? []) {
        const ca = compOf.get(stateKey({ uid: p.uid, port: a.id }));
        const cb = compOf.get(stateKey({ uid: p.uid, port: b }));
        if (ca !== undefined && ca === cb) reversing.add(p.uid);
      }
  }
  const hasLoop = comps.length > 0;
  if (hasLoop) {
    if (reversing.size)
      add('direction-change', 'info', 'Trains can turn around: a reversing loop or wye lets an engine come back the other way.', [
        ...reversing,
      ]);
    else
      add(
        'direction-change',
        'info',
        'Trains can’t turn around: every engine keeps going the same way round. Add a reversing loop or a wye to turn trains.',
        [],
      );
  }

  // ------------------------------------------------------------------ reachability (2)
  // Start on the main line (largest running set) facing either way, then see what a train can reach.
  const mainComp = comps.filter((c) => mainGroup.has(c[0].split('>')[0])).sort((a, b) => b.length - a.length)[0];
  const reach = new Set<string>();
  if (mainComp) {
    const start: string[] = [];
    for (const k of mainComp) {
      start.push(k);
      // the same track facing the other way: enter through the exit end instead
      const [uid, port] = k.split('>');
      const t = typeOf(uid);
      const out = passThrough(t, port);
      if (out) start.push(stateKey({ uid, port: out }));
    }
    const queue = [...start];
    start.forEach((k) => reach.add(k));
    while (queue.length) {
      const k = queue.pop()!;
      for (const n of edges.get(k) ?? [])
        if (!reach.has(n)) {
          reach.add(n);
          queue.push(n);
        }
    }
    const unreachable: string[] = [];
    const oneWay: string[] = [];
    for (const p of track) {
      if (!mainGroup.has(p.uid)) continue; // reported as disconnected
      const t = cat.get(p.code);
      const entered = t.ports.filter((q) => reach.has(stateKey({ uid: p.uid, port: q.id })));
      if (entered.length === 0) unreachable.push(p.uid);
      else if (t.ports.length === 2 && entered.length === 1 && t.category !== 'buffer') {
        // only matters on track that's part of a loop (sidings are naturally one-way in)
        const onLoop = t.ports.some((q) => compOf.has(stateKey({ uid: p.uid, port: q.id })));
        if (onLoop) oneWay.push(p.uid);
      }
    }
    if (unreachable.length)
      add(
        'unreachable',
        'warning',
        `${unreachable.length} piece${unreachable.length > 1 ? 's' : ''} can’t be reached by a train running on the main line. Check which way the switches face.`,
        unreachable,
      );
    if (oneWay.length)
      add(
        'one-way-loop',
        'warning',
        `${oneWay.length} piece${oneWay.length > 1 ? 's' : ''} of a loop can only be entered running one way; trains going the other way can’t get in.`,
        oneWay,
      );
  }

  // ------------------------------------------------------------------ segments (4, 5)
  const segments: Segment[] = [];
  const seenSeg = new Set<string>();
  for (const p of track) {
    const t = cat.get(p.code);
    if (!isJunction(t)) continue;
    for (const q of t.ports) {
      const seg = walkSegment(cat, byUid, conn, p.uid, q.id);
      const key = [`${seg.from}:${seg.fromPort}`, `${seg.to}:${seg.toPort ?? ''}`].sort().join('|');
      if (seg.end === 'junction' && seenSeg.has(key)) continue;
      seenSeg.add(key);
      segments.push(seg);
    }
  }
  const L = params.trainLength;
  for (const seg of segments.filter((s) => s.end === 'buffer')) {
    if (seg.length < L)
      add(
        'short-siding',
        'warning',
        `Siding holds ${fmtCm(seg.length)} of track; your train is ${fmtCm(L)}, so it would stick out over the switch.`,
        [seg.from, ...seg.pieces],
        portPos(seg.from, seg.fromPort),
      );
  }
  // passing loops: two or more separate routes between the same pair of junctions
  const byPair = new Map<string, Segment[]>();
  for (const seg of segments.filter((s) => s.end === 'junction' && s.to !== s.from)) {
    const key = [seg.from, seg.to].sort().join('|');
    (byPair.get(key) ?? byPair.set(key, []).get(key)!).push(seg);
  }
  const passingLoops = [...byPair.values()].filter((g) => g.length >= 2);
  for (const g of passingLoops) {
    // the passing tracks are the two shortest routes between the switches (any other route is the rest of the main line);
    // at least one of them must hold a train clear of both switches
    const [first, second] = [...g].sort((a, b) => a.length - b.length);
    const longest = Math.max(first.length, second.length);
    if (longest < L)
      add(
        'short-passing-loop',
        'warning',
        `Passing loop is only ${fmtCm(longest)} long; a ${fmtCm(L)} train can’t fit clear of the switches, so trains can’t pass here.`,
        [first.from, first.to, ...first.pieces, ...second.pieces],
        portPos(first.from, first.fromPort),
      );
  }

  // stop pieces (5): not on a grade, and far enough from a junction that a waiting train doesn't block it
  for (const p of track) {
    const t = cat.get(p.code);
    if (!t.stop) continue;
    const neighbours = t.ports
      .map((q) => conn.links.get(portKey({ uid: p.uid, port: q.id })))
      .filter((m): m is NonNullable<typeof m> => !!m);
    if (t.category === 'ramp' || neighbours.some((m) => typeOf(m.uid).category === 'ramp'))
      add('stop-on-grade', 'warning', `${t.name} is on or next to a ramp; an engine stopped here may not restart uphill.`, [
        p.uid,
        ...neighbours.map((m) => m.uid),
      ]);
    // distance from the middle of the stop piece to the nearest junction, each way
    for (const q of t.ports) {
      const seg = walkSegment(cat, byUid, conn, p.uid, q.id);
      const half = (t.routeLength[`${(t.routes[q.id] ?? [])[0]}>${q.id}`] ?? 0) / 2;
      if (seg.end === 'junction' && seg.length + half < L) {
        add(
          'stop-near-junction',
          'info',
          `A train waiting at ${t.name} would block the junction ${fmtCm(seg.length + half)} away (train is ${fmtCm(L)}).`,
          [p.uid, seg.to],
        );
        break;
      }
    }
  }

  // ------------------------------------------------------------------ conflicts (3)
  if (params.engineCount >= 2 && mainComp) {
    const conflicts: string[] = [];
    for (const p of track) {
      const t = cat.get(p.code);
      // ends that lead to the same exit = routes merging; two separate routes in one piece = crossing
      const merging = t.ports.some((exit) => {
        const intoExit = t.ports.filter((q) => (t.routes[q.id] ?? []).includes(exit.id));
        return intoExit.filter((q) => reach.has(stateKey({ uid: p.uid, port: q.id }))).length >= 2;
      });
      // separate routes in use at the same level (routes on different levels pass over each other, so they don't count)
      const usedRoutes = t.ports.filter((q) => reach.has(stateKey({ uid: p.uid, port: q.id })));
      const routesByLevel = new Map<number, Set<string>>();
      for (const q of usedRoutes)
        (routesByLevel.get(q.z) ?? routesByLevel.set(q.z, new Set()).get(q.z)!).add([q.id, ...(t.routes[q.id] ?? [])].sort().join());
      const crossing = t.category === 'crossing' && [...routesByLevel.values()].some((r) => r.size >= 2);
      if (merging || crossing) conflicts.push(p.uid);
    }
    if (conflicts.length)
      add(
        'conflict-points',
        'info',
        `${conflicts.length} junction${conflicts.length > 1 ? 's/crossings where' : '/crossing where'} two trains’ paths meet. With ${params.engineCount} engines, watch for collisions there.`,
        conflicts,
      );
    if (reversing.size)
      add(
        'head-on',
        'warning',
        `With ${params.engineCount} engines, a train that turns around can run head-on into another one coming the other way.`,
        [...reversing],
      );
    // somewhere for each extra engine to wait or pass: passing loops, sidings, stop pieces
    const places =
      passingLoops.length +
      segments.filter((s) => s.end === 'buffer' && s.length >= L).length +
      track.filter((p) => cat.get(p.code).stop).length;
    if (params.engineCount > 1 + places)
      add(
        'capacity',
        'warning',
        `${params.engineCount} engines but only ${places} place${places === 1 ? '' : 's'} to pass or wait; a faster engine will catch up with a slower one.`,
        [],
      );
  }

  // trailing through switches set against you
  if (!params.trailingPushThrough && mainComp) {
    const risky = track.filter((p) => {
      const t = cat.get(p.code);
      if (!isJunction(t)) return false;
      // ends with a single route into a shared exit: arriving there needs the switch set for you
      return t.ports.some((q) => {
        const outs = t.routes[q.id] ?? [];
        if (outs.length !== 1) return false;
        const shared = t.ports.filter((r) => (t.routes[r.id] ?? []).includes(outs[0])).length >= 2;
        return shared && reach.has(stateKey({ uid: p.uid, port: q.id }));
      });
    });
    if (risky.length)
      add(
        'trailing-switch',
        'warning',
        `${risky.length} switch${risky.length > 1 ? 'es' : ''} must be set for an arriving train, or it will derail (trailing through points set against it).`,
        risky.map((p) => p.uid),
      );
  }

  return issues;
}
