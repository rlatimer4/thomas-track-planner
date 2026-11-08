import { angleDiff } from './geometry';
import type { Catalog } from './catalog';
import { computeConnectivity, portKey, type Connectivity, type PlacedPiece } from './layout';

/**
 * Running analysis. A train "state" is a piece plus the port it entered through.
 * From a state the train may leave through any port the piece routes to (switch
 * choice), arriving at the mated piece's port. Leaving through an unconnected
 * port means running off the end of the track.
 */
export interface State {
  uid: string;
  port: string;
}

export const stateKey = (s: State) => `${s.uid}>${s.port}`;

export interface RunAnalysis {
  /** States from which a train can keep running forever (it can reach a cycle). */
  canRunForever: Set<string>;
  /** States that lie on some cycle. */
  onCycle: Set<string>;
  /** Pieces that are part of at least one continuous loop. */
  loopPieces: Set<string>;
  /** True if some piece can be traversed in both directions by the same train without reversing. */
  hasReversingLoop: boolean;
  /** Number of independent loops (cycle rank of the undirected track graph). */
  loopCount: number;
}

export function successors(cat: Catalog, byUid: Map<string, PlacedPiece>, conn: Connectivity, s: State): State[] | 'off-end' | 'buffer' {
  const piece = byUid.get(s.uid)!;
  const t = cat.get(piece.code);
  const outs = t.routes[s.port] ?? [];
  if (outs.length === 0) return 'buffer';
  const next: State[] = [];
  let offEnd = false;
  for (const out of outs) {
    const mate = conn.links.get(portKey({ uid: s.uid, port: out }));
    if (mate) next.push(mate);
    else offEnd = true;
  }
  if (next.length === 0 && offEnd) return 'off-end';
  return next;
}

/** Tarjan SCC over the state graph. */
function sccs(nodes: string[], edges: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  // iterative to avoid recursion limits on big layouts
  for (const root of nodes) {
    if (idx.has(root)) continue;
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
    idx.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const succ = edges.get(top.v) ?? [];
      if (top.i < succ.length) {
        const w = succ[top.i++];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
        }
        if (low.get(top.v) === idx.get(top.v)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== top.v);
          out.push(comp);
        }
      }
    }
  }
  return out;
}

export function analyzeRunning(cat: Catalog, pieces: PlacedPiece[], conn = computeConnectivity(cat, pieces)): RunAnalysis {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const nodes: string[] = [];
  const edges = new Map<string, string[]>();
  for (const p of pieces) {
    const t = cat.get(p.code);
    if (!t.isTrack) continue;
    for (const port of t.ports) {
      const s = { uid: p.uid, port: port.id };
      const k = stateKey(s);
      nodes.push(k);
      const succ = successors(cat, byUid, conn, s);
      edges.set(k, Array.isArray(succ) ? succ.map(stateKey) : []);
    }
  }
  const comps = sccs(nodes, edges);
  const onCycle = new Set<string>();
  for (const c of comps) {
    if (c.length > 1) c.forEach((k) => onCycle.add(k));
    else if ((edges.get(c[0]) ?? []).includes(c[0])) onCycle.add(c[0]);
  }
  // reverse reachability from cycle states
  const rev = new Map<string, string[]>();
  for (const [a, bs] of edges) for (const b of bs) (rev.get(b) ?? rev.set(b, []).get(b)!).push(a);
  const canRunForever = new Set(onCycle);
  const queue = [...onCycle];
  while (queue.length) {
    const k = queue.pop()!;
    for (const a of rev.get(k) ?? [])
      if (!canRunForever.has(a)) {
        canRunForever.add(a);
        queue.push(a);
      }
  }
  const loopPieces = new Set<string>();
  for (const k of onCycle) loopPieces.add(k.split('>')[0]);

  // Reversing loop: within one SCC, the same piece is entered from two different ports
  // that lead in opposite directions along the same route.
  let hasReversingLoop = false;
  for (const c of comps) {
    if (c.length < 2) continue;
    const seen = new Map<string, string[]>();
    for (const k of c) {
      const [uid, port] = k.split('>');
      (seen.get(uid) ?? seen.set(uid, []).get(uid)!).push(port);
    }
    for (const [uid, ports] of seen) {
      const t = cat.get(byUid.get(uid)!.code);
      // two entry ports that route to each other = travelling both ways along that route
      if (ports.some((a) => ports.some((b) => a !== b && (t.routes[a] ?? []).includes(b)))) {
        hasReversingLoop = true;
        break;
      }
    }
    if (hasReversingLoop) break;
  }

  // cycle rank of undirected multigraph: E - V + components (counting only track pieces)
  const trackPieces = pieces.filter((p) => cat.get(p.code).isTrack);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  trackPieces.forEach((p) => parent.set(p.uid, p.uid));
  let edgesCount = 0;
  for (const [k, mate] of conn.links) {
    const uid = k.split(':')[0];
    if (uid < mate.uid) {
      edgesCount++;
      parent.set(find(uid), find(mate.uid));
    }
  }
  // internal routes inside multi-path pieces (switches) don't add loops by themselves
  const comps2 = new Set(trackPieces.map((p) => find(p.uid))).size;
  const loopCount = Math.max(0, edgesCount - trackPieces.length + comps2);

  return { canRunForever, onCycle, loopPieces, hasReversingLoop, loopCount };
}

/** Signed heading change when travelling through a 2-port piece from port `inPort`. */
export function turnThrough(cat: Catalog, piece: PlacedPiece, inPort: string, outPort: string): number {
  const t = cat.get(piece.code);
  const a = t.ports.find((p) => p.id === inPort)!;
  const b = t.ports.find((p) => p.id === outPort)!;
  return angleDiff(b.dir, a.dir + 180);
}
