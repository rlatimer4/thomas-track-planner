import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  angleDiff,
  attachPose,
  computeConnectivity,
  dirVec,
  drawOrder,
  layoutBounds,
  layoutToSvg,
  makeLayoutFile,
  mergePieces,
  parseLayoutFile,
  newLayout,
  placeAt,
  portKey,
  RULES,
  rotate,
  validateLayout,
  worldPorts,
  worldSamples,
  type Issue,
  type Layout,
  type PlacedPiece,
  type PieceType,
  type WorldPort,
} from '../core';
import { useStore, fmtLen } from './store';
import { LayoutPreview, TrackPiece, levelColor } from './TrackPieces';
import { openTextFile, saveTextFile } from './platform';

type Selection = { kind: 'port'; uid: string; port: string } | { kind: 'piece'; uid: string } | null;
interface View {
  tx: number;
  ty: number;
  s: number;
}

const MAX_HISTORY = 200;

export function Builder() {
  const { catalog: cat, owned, currentLayout, saveLayout, update, layouts, units, space, customPieces } = useStore();
  // pieces whose definition is gone (e.g. a deleted custom piece) are left out rather than breaking the view
  const [pieces, setPiecesRaw] = useState<PlacedPiece[]>(() => currentLayout.pieces.filter((p) => cat.has(p.code)));
  const [past, setPast] = useState<PlacedPiece[][]>([]);
  const [future, setFuture] = useState<PlacedPiece[][]>([]);
  const [sel, setSel] = useState<Selection>(null);
  // several pieces selected at once (box select, Shift+click, Ctrl+A)
  const [group, setGroup] = useState<string[]>([]);
  const [boxMode, setBoxMode] = useState(false);
  const [box, setBox] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [lastPlaced, setLastPlaced] = useState<{
    uid: string;
    target: WorldPort | { x: number; y: number; dir: number; z: number };
    inPort: string;
  } | null>(null);
  const [view, setView] = useState<View>({ tx: 300, ty: 250, s: 0.5 });
  const [labels, setLabels] = useState(true);
  const [showFootprint, setShowFootprint] = useState(false);
  const [onlyOwned, setOnlyOwned] = useState(true);
  const [panel, setPanel] = useState<'issues' | 'parts' | null>(typeof window !== 'undefined' && window.innerWidth > 900 ? 'issues' : null);
  const [focusIssue, setFocusIssue] = useState<Issue | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // keep the stored layout in sync (debounced)
  useEffect(() => {
    const t = setTimeout(() => saveLayout({ ...currentLayout, pieces }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces]);

  // event handlers are re-created every render, so `pieces` here is always current
  const setPieces = (next: PlacedPiece[] | ((p: PlacedPiece[]) => PlacedPiece[])) => {
    const value = typeof next === 'function' ? next(pieces) : next;
    if (value === pieces) return;
    setPast((h) => [...h.slice(-MAX_HISTORY), pieces]);
    setFuture([]);
    setPiecesRaw(value);
  };

  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [pieces, ...f]);
    setPiecesRaw(past[past.length - 1]);
    setPast((h) => h.slice(0, -1));
    setSel(null);
    setGroup([]);
    setLastPlaced(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((h) => [...h, pieces]);
    setPiecesRaw(future[0]);
    setFuture((f) => f.slice(1));
    setSel(null);
    setGroup([]);
  };

  const validation = useMemo(() => validateLayout(cat, pieces, { owned, space: space ?? undefined }), [cat, pieces, owned, space]);
  const openPorts = validation.conn.open;
  const problemUids = useMemo(() => {
    const s = new Set<string>();
    for (const i of validation.issues) if (i.severity === 'error') i.uids.forEach((u) => s.add(u));
    return s;
  }, [validation]);

  const selectedPort: WorldPort | undefined =
    sel?.kind === 'port' ? openPorts.find((p) => p.uid === sel.uid && p.port === sel.port) : undefined;
  const selectedPiece = sel?.kind === 'piece' ? pieces.find((p) => p.uid === sel.uid) : undefined;
  const groupSet = new Set(group.filter((u) => pieces.some((p) => p.uid === u)));
  /** Pieces the edit tools act on: the multi-selection, or the single selected piece. */
  const selectedUids = groupSet.size ? [...groupSet] : selectedPiece ? [selectedPiece.uid] : [];
  const isSelected = (uid: string) => groupSet.has(uid) || (sel?.kind === 'piece' && sel.uid === uid);
  const selectOnly = (uids: string[]) => {
    setLastPlaced(null);
    if (uids.length === 1) {
      setGroup([]);
      setSel({ kind: 'piece', uid: uids[0] });
    } else {
      setGroup(uids);
      setSel(null);
    }
  };
  const centreOf = (p: PlacedPiece) => {
    const pts = worldSamples(cat, p).flat();
    return { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length };
  };

  // ------------------------------------------------------------ view helpers
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - view.tx) / view.s, y: (clientY - r.top - view.ty) / view.s };
    },
    [view],
  );

  const fit = useCallback(
    (which: PlacedPiece[] = pieces) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!which.length) {
        setView({ tx: r.width / 2, ty: r.height / 2, s: 0.5 });
        return;
      }
      const b = layoutBounds(cat, which);
      const pad = 60;
      const s = Math.min((r.width - 2 * pad) / Math.max(b.width, 200), (r.height - 2 * pad) / Math.max(b.height, 200), 2);
      setView({ s, tx: r.width / 2 - (b.minX + b.width / 2) * s, ty: r.height / 2 - (b.minY + b.height / 2) * s });
    },
    [cat, pieces],
  );

  useEffect(() => {
    fit(currentLayout.pieces);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ editing
  const exitPortFor = (t: PieceType, inPort: string) => t.routes[inPort]?.[0];

  const place = (code: string) => {
    const t = cat.get(code);
    let target: { x: number; y: number; dir: number; z: number };
    if (selectedPort) target = selectedPort;
    else if (!pieces.length) target = { x: 0, y: 0, dir: 0, z: 0 };
    else {
      // drop free near the middle of the screen
      const r = svgRef.current!.getBoundingClientRect();
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      target = { ...c, dir: 0, z: 0 };
    }
    const inPort = t.ports[0].id;
    const { piece } = placeAt(cat, target, code, inPort);
    setPieces((ps) => [...ps, piece]);
    setLastPlaced({ uid: piece.uid, target, inPort });
    const exit = exitPortFor(t, inPort);
    setSel(exit ? { kind: 'port', uid: piece.uid, port: exit } : { kind: 'piece', uid: piece.uid });
  };

  /** Re-attach the last placed piece through its next port (turns curves left/right, flips switches and ramps). */
  const turnLast = () => {
    if (!lastPlaced) return;
    const piece = pieces.find((p) => p.uid === lastPlaced.uid);
    if (!piece) return;
    const t = cat.get(piece.code);
    if (t.ports.length < 2) return;
    const idx = t.ports.findIndex((p) => p.id === lastPlaced.inPort);
    const inPort = t.ports[(idx + 1) % t.ports.length].id;
    const pose = attachPose(cat, lastPlaced.target, piece.code, inPort);
    const next = { ...piece, ...pose };
    setPieces((ps) => ps.map((p) => (p.uid === piece.uid ? next : p)));
    setLastPlaced({ ...lastPlaced, inPort });
    const exit = exitPortFor(t, inPort);
    if (exit) setSel({ kind: 'port', uid: piece.uid, port: exit });
  };

  const removeSelected = () => {
    if (groupSet.size) {
      setPieces((ps) => ps.filter((p) => !groupSet.has(p.uid)));
      setGroup([]);
      setSel(null);
      setLastPlaced(null);
      return;
    }
    const uid = sel?.kind === 'piece' ? sel.uid : lastPlaced?.uid;
    if (!uid) return;
    // after deleting, select the open end it was attached to so building can continue
    const mates = worldPorts(
      cat,
      pieces.find((p) => p.uid === uid)!,
    )
      .map((wp) => validation.conn.links.get(portKey(wp)))
      .filter(Boolean);
    setPieces((ps) => ps.filter((p) => p.uid !== uid));
    setLastPlaced(null);
    setSel(mates[0] ? { kind: 'port', uid: mates[0]!.uid, port: mates[0]!.port } : null);
  };

  const rotateSelected = (deg: number) => {
    if (!selectedUids.length) return;
    const chosen = new Set(selectedUids);
    // turn the whole selection about its middle
    const pts = pieces.filter((p) => chosen.has(p.uid)).flatMap((p) => worldSamples(cat, p).flat());
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    setPieces((ps) =>
      ps.map((p) => {
        if (!chosen.has(p.uid)) return p;
        const r = rotate({ x: p.x - c.x, y: p.y - c.y }, deg);
        return { ...p, x: c.x + r.x, y: c.y + r.y, rot: (p.rot + deg + 360) % 360 };
      }),
    );
  };

  const raiseSelected = (dz: number) => {
    if (!selectedUids.length) return;
    const chosen = new Set(selectedUids);
    setPieces((ps) => ps.map((p) => (chosen.has(p.uid) ? { ...p, z: Math.max(-3, p.z + dz) } : p)));
  };

  const clearAll = () => {
    if (pieces.length && !confirm('Remove all pieces from this layout?')) return;
    setPieces([]);
    setSel(null);
    setGroup([]);
    setLastPlaced(null);
  };

  // snap a dragged piece onto a nearby open end
  const snap = (piece: PlacedPiece): PlacedPiece => {
    // open ends of everything else, ignoring the dragged piece (it may already count as joined)
    const others = computeConnectivity(
      cat,
      pieces.filter((p) => p.uid !== piece.uid),
    ).open;
    let best: { d: number; pose: Omit<PlacedPiece, 'uid' | 'code'> } | undefined;
    for (const mine of worldPorts(cat, piece)) {
      for (const o of others) {
        const d = Math.hypot(o.x - mine.x, o.y - mine.y);
        if (d > 40) continue;
        if (Math.abs(angleDiff(mine.dir, o.dir + 180)) > 25) continue;
        if (!best || d < best.d) best = { d, pose: attachPose(cat, o, piece.code, mine.port) };
      }
    }
    return best ? { ...piece, ...best.pose } : piece;
  };

  // snap a dragged group by sliding it so one of its open ends meets a nearby open end of the rest
  const snapGroup = (all: PlacedPiece[], uids: Set<string>): PlacedPiece[] => {
    const others = computeConnectivity(
      cat,
      all.filter((p) => !uids.has(p.uid)),
    ).open;
    const ownOpen = computeConnectivity(
      cat,
      all.filter((p) => uids.has(p.uid)),
    ).open;
    let best: { d: number; dx: number; dy: number } | undefined;
    for (const mine of ownOpen)
      for (const o of others) {
        const d = Math.hypot(o.x - mine.x, o.y - mine.y);
        if (d > 40 || Math.abs(angleDiff(mine.dir, o.dir + 180)) > 25) continue;
        if (!best || d < best.d) best = { d, dx: o.x - mine.x, dy: o.y - mine.y };
      }
    if (!best) return all;
    const { dx, dy } = best;
    return all.map((p) => (uids.has(p.uid) ? { ...p, x: p.x + dx, y: p.y + dy } : p));
  };

  // ------------------------------------------------------------ pointer handling
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'pan'; startX: number; startY: number; view: View }
    | {
        kind: 'drag';
        uids: Set<string>;
        start: { x: number; y: number };
        orig: Map<string, PlacedPiece>;
        moved: boolean;
        before: PlacedPiece[];
      }
    | { kind: 'box'; start: { x: number; y: number }; add: boolean; onPiece?: string }
    | { kind: 'pinch'; dist: number; mid: { x: number; y: number }; view: View }
    | null
  >(null);

  const onBackgroundDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view };
      return;
    }
    if (boxMode || e.shiftKey) {
      const start = toWorld(e.clientX, e.clientY);
      gesture.current = { kind: 'box', start, add: e.ctrlKey || e.metaKey };
      setBox({ a: start, b: start });
      return;
    }
    gesture.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, view };
  };

  const onPieceDown = (e: React.PointerEvent, uid: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Shift/Ctrl/Cmd+click adds or removes a piece from the selection
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const current = selectedUids;
      selectOnly(current.includes(uid) ? current.filter((u) => u !== uid) : [...current, uid]);
      gesture.current = null;
      return;
    }
    // in Select mode a drag that starts on an unselected piece draws a box, like one started on empty space
    if (boxMode && !groupSet.has(uid)) {
      const start = toWorld(e.clientX, e.clientY);
      gesture.current = { kind: 'box', start, add: false, onPiece: uid };
      setBox({ a: start, b: start });
      return;
    }
    // dragging a piece of the multi-selection moves all of it; otherwise just this piece
    const uids = groupSet.has(uid) ? new Set(groupSet) : new Set([uid]);
    if (!groupSet.has(uid)) {
      setGroup([]);
      setSel({ kind: 'piece', uid });
    }
    const orig = new Map(pieces.filter((p) => uids.has(p.uid)).map((p) => [p.uid, p] as const));
    gesture.current = { kind: 'drag', uids, start: toWorld(e.clientX, e.clientY), orig, moved: false, before: pieces };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svgRef.current!.getBoundingClientRect();
      const k = d / g.dist;
      const s = Math.min(4, Math.max(0.05, g.view.s * k));
      const mx = g.mid.x - r.left;
      const my = g.mid.y - r.top;
      setView({ s, tx: mx - ((mx - g.view.tx) / g.view.s) * s, ty: my - ((my - g.view.ty) / g.view.s) * s });
    } else if (g.kind === 'pan') {
      setView({ ...g.view, tx: g.view.tx + e.clientX - g.startX, ty: g.view.ty + e.clientY - g.startY });
    } else if (g.kind === 'drag') {
      const w = toWorld(e.clientX, e.clientY);
      const dx = w.x - g.start.x;
      const dy = w.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * view.s < 4) return;
      g.moved = true;
      setPiecesRaw((ps) =>
        ps.map((p) => {
          const o = g.orig.get(p.uid);
          return o ? { ...o, x: o.x + dx, y: o.y + dy } : p;
        }),
      );
    } else if (g.kind === 'box') {
      setBox({ a: g.start, b: toWorld(e.clientX, e.clientY) });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'drag' && g.moved) {
      setPiecesRaw(g.uids.size === 1 ? pieces.map((p) => (g.uids.has(p.uid) ? snap(p) : p)) : snapGroup(pieces, g.uids));
      setPast((h) => [...h.slice(-MAX_HISTORY), g.before]);
      setFuture([]);
    } else if (g?.kind === 'pan' && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) {
      setSel(null);
      setGroup([]);
    } else if (g?.kind === 'box' && box && g.onPiece && Math.hypot(box.b.x - box.a.x, box.b.y - box.a.y) * view.s < 4) {
      // a click (not a drag) on a piece selects it
      selectOnly([g.onPiece]);
      setBox(null);
    } else if (g?.kind === 'box' && box) {
      // select the pieces whose middle is inside the box
      const x0 = Math.min(box.a.x, box.b.x);
      const x1 = Math.max(box.a.x, box.b.x);
      const y0 = Math.min(box.a.y, box.b.y);
      const y1 = Math.max(box.a.y, box.b.y);
      const inside = pieces
        .filter((p) => {
          const c = centreOf(p);
          return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
        })
        .map((p) => p.uid);
      const next = g.add ? [...new Set([...selectedUids, ...inside])] : inside;
      if (next.length) selectOnly(next);
      else {
        setSel(null);
        setGroup([]);
      }
      setBox(null);
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const k = Math.exp(-e.deltaY * 0.0015);
    const s = Math.min(4, Math.max(0.05, view.s * k));
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView({ s, tx: mx - ((mx - view.tx) / view.s) * s, ty: my - ((my - view.ty) / view.s) * s });
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (e.key.toLowerCase() === 'f' || e.key === ' ') {
        e.preventDefault();
        turnLast();
      } else if (e.key.toLowerCase() === 'r') rotateSelected(e.shiftKey ? -45 : 45);
      else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectOnly(pieces.map((p) => p.uid));
      } else if (e.key === 'Escape') {
        setSel(null);
        setGroup([]);
        setBox(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------ layouts
  const switchLayout = (id: string) => update((s) => ({ ...s, currentLayoutId: id }));
  const createLayout = () => {
    const l = newLayout(`Layout ${layouts.length + 1}`);
    update((s) => ({ ...s, layouts: [...s.layouts, l], currentLayoutId: l.id }));
  };
  const duplicateLayout = () => {
    const l: Layout = { ...newLayout(`${currentLayout.name} copy`), pieces };
    update((s) => ({ ...s, layouts: [...s.layouts, l], currentLayoutId: l.id }));
  };
  const deleteLayout = () => {
    if (!confirm(`Delete "${currentLayout.name}"?`)) return;
    update((s) => {
      const rest = s.layouts.filter((l) => l.id !== currentLayout.id);
      const keep = rest.length ? rest : [newLayout('My layout')];
      return { ...s, layouts: keep, currentLayoutId: keep[0].id };
    });
  };
  const rename = (name: string) => saveLayout({ ...currentLayout, name, pieces });

  const exportJson = () =>
    saveTextFile(
      `${currentLayout.name.replace(/[^\w-]+/g, '_')}.track.json`,
      JSON.stringify(makeLayoutFile({ ...currentLayout, pieces }, cat), null, 2),
      'Track layout',
      'json',
    );
  const exportSvg = () => saveTextFile(`${currentLayout.name.replace(/[^\w-]+/g, '_')}.svg`, layoutToSvg(cat, pieces), 'SVG image', 'svg');
  const importJson = async () => {
    const text = await openTextFile('Track layout', 'json');
    if (!text) return;
    try {
      const file = parseLayoutFile(text);
      // bring in any custom pieces the layout needs; existing pieces with the same code are kept
      const builtins = new Set(
        cat
          .all()
          .filter((t) => !t.custom)
          .map((t) => t.code),
      );
      const merge = mergePieces(customPieces, file.pieces, builtins);
      const known = new Set([...builtins, ...merge.merged.map((p) => p.code)]);
      const unknown = [...new Set(file.layout.pieces.filter((p) => !known.has(p.code)).map((p) => p.code))];
      if (unknown.length) throw new Error(`It uses pieces this app doesn't know: ${unknown.join(', ')}.`);
      const imported: Layout = { ...newLayout(file.layout.name ?? 'Imported layout'), pieces: file.layout.pieces };
      update((s) => ({ ...s, customPieces: merge.merged, layouts: [...s.layouts, imported], currentLayoutId: imported.id }));
      const notes = [
        merge.added.length ? `Added custom pieces: ${merge.added.join(', ')}.` : '',
        merge.conflicts.length ? `Kept your own version of: ${merge.conflicts.join(', ')} (the file's version differs).` : '',
      ].filter(Boolean);
      if (notes.length) alert(notes.join('\n'));
    } catch (err) {
      alert(`Could not import: ${(err as Error).message}`);
    }
  };

  // ------------------------------------------------------------ render
  const used = validation.counts;
  const palette = cat
    .trackPieces()
    .filter((t) => !onlyOwned || (owned[t.stockCode] ?? 0) > 0)
    .sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
  const sortedPieces = useMemo(() => drawOrder(cat, pieces), [cat, pieces]);
  const errors = validation.issues.filter((i) => i.severity === 'error').length;
  const warnings = validation.issues.filter((i) => i.severity === 'warning').length;
  const bounds = layoutBounds(cat, pieces);
  const focusUids = new Set(focusIssue?.uids ?? []);

  return (
    <div className="builder">
      <div className="toolbar" role="toolbar">
        <select value={currentLayout.id} onChange={(e) => switchLayout(e.target.value)} aria-label="Layout">
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <input className="name" value={currentLayout.name} onChange={(e) => rename(e.target.value)} aria-label="Layout name" />
        <button onClick={createLayout} title="New layout">
          New
        </button>
        <button onClick={duplicateLayout} title="Duplicate layout">
          Copy
        </button>
        <button onClick={deleteLayout} title="Delete layout">
          Delete
        </button>
        <span className="sep" />
        <button onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button onClick={turnLast} disabled={!lastPlaced} title="Turn the last piece: left/right, or another switch leg (F)">
          Turn
        </button>
        <button onClick={() => rotateSelected(45)} disabled={!selectedUids.length} title="Rotate selected 45° (R)">
          Rotate
        </button>
        <button onClick={() => raiseSelected(1)} disabled={!selectedUids.length} title="Raise selected one level">
          Up
        </button>
        <button onClick={() => raiseSelected(-1)} disabled={!selectedUids.length} title="Lower selected one level">
          Down
        </button>
        <button onClick={removeSelected} disabled={!selectedUids.length && !lastPlaced} title="Delete selected (Del)">
          Remove
        </button>
        <button onClick={clearAll} title="Remove all pieces">
          Clear
        </button>
        <button
          className={boxMode ? 'active' : ''}
          aria-pressed={boxMode}
          onClick={() => setBoxMode((b) => !b)}
          title="Box select: drag over pieces to select them (or Shift+drag at any time). Ctrl+drag adds to the selection; Ctrl+A selects all."
        >
          Select
        </button>
        <span className="sep" />
        <button onClick={() => fit()} title="Zoom to fit">
          Fit
        </button>
        <label className="check">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Codes
        </label>
        <label className="check">
          <input type="checkbox" checked={showFootprint} onChange={(e) => setShowFootprint(e.target.checked)} /> Footprint
        </label>
        <span className="sep" />
        <button onClick={exportJson}>Export</button>
        <button onClick={importJson}>Import</button>
        <button onClick={exportSvg}>SVG</button>
      </div>

      <div className="builder-body">
        <aside className="palette" aria-label="Pieces">
          <div className="palette-head">
            <strong>Pieces</strong>
            <label className="check small">
              <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} /> owned only
            </label>
          </div>
          <div className="palette-hint">
            {groupSet.size
              ? `${groupSet.size} pieces selected: drag one to move them all, R to rotate, Del to remove.`
              : boxMode
                ? 'Drag a box over the pieces to select.'
                : selectedPort
                  ? `Adding at the selected end (level ${selectedPort.z}).`
                  : pieces.length
                    ? 'Tap a green end to attach, or a piece to move it.'
                    : 'Tap a piece to start.'}
          </div>
          <div className="palette-list">
            {palette.map((t) => {
              const have = owned[t.stockCode] ?? 0;
              const left = have - (used[t.stockCode] ?? 0);
              return (
                <button
                  key={t.code}
                  className={`palette-item ${left <= 0 ? 'none-left' : ''}`}
                  onClick={() => place(t.code)}
                  title={t.description}
                >
                  <PieceIcon cat={cat} t={t} />
                  <span className="pi-code">{t.code}</span>
                  <span className="pi-name">{t.name}</span>
                  <span className={`pi-count ${left < 0 ? 'neg' : ''}`}>{have ? `${left}/${have}` : '—'}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="canvas-wrap">
          <svg
            ref={svgRef}
            className="canvas"
            onPointerDown={onBackgroundDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onWheel={onWheel}
            data-testid="canvas"
          >
            <defs>
              <pattern id="grid" width={100} height={100} patternUnits="userSpaceOnUse">
                <path d="M100 0H0V100" fill="none" stroke="var(--grid)" strokeWidth={1.5} />
              </pattern>
            </defs>
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
              <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#grid)" />
              {showFootprint && pieces.length > 0 && <Footprint bounds={bounds} space={space} scale={view.s} units={units} />}
              {sortedPieces.map((p) => (
                <TrackPiece
                  key={p.uid}
                  cat={cat}
                  piece={p}
                  labels={labels}
                  selected={isSelected(p.uid)}
                  problem={problemUids.has(p.uid) || focusUids.has(p.uid)}
                  onPointerDown={onPieceDown}
                />
              ))}
              {openPorts.map((p) => {
                const isSel = selectedPort && p.uid === selectedPort.uid && p.port === selectedPort.port;
                const d = dirVec(p.dir);
                const r = 16 / Math.max(view.s, 0.3);
                return (
                  <g
                    key={`${p.uid}:${p.port}`}
                    className="port"
                    data-port={`${p.uid}:${p.port}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSel({ kind: 'port', uid: p.uid, port: p.port });
                      setGroup([]);
                      setLastPlaced(null);
                    }}
                  >
                    <circle cx={p.x} cy={p.y} r={r * 1.6} fill="transparent" />
                    <circle cx={p.x} cy={p.y} r={r} fill={isSel ? '#f59e0b' : '#22c55e'} stroke="#fff" strokeWidth={3 / view.s} />
                    <line
                      x1={p.x}
                      y1={p.y}
                      x2={p.x + d.x * r * 1.8}
                      y2={p.y + d.y * r * 1.8}
                      stroke={isSel ? '#f59e0b' : '#22c55e'}
                      strokeWidth={5 / Math.max(view.s, 0.3)}
                    />
                    {p.z !== 0 && (
                      <text x={p.x} y={p.y} className="port-z" fontSize={r * 1.1} textAnchor="middle" dominantBaseline="central">
                        {p.z}
                      </text>
                    )}
                  </g>
                );
              })}
              {box && (
                <rect
                  x={Math.min(box.a.x, box.b.x)}
                  y={Math.min(box.a.y, box.b.y)}
                  width={Math.abs(box.b.x - box.a.x)}
                  height={Math.abs(box.b.y - box.a.y)}
                  fill="rgba(59,130,246,0.1)"
                  stroke="#3b82f6"
                  strokeWidth={2 / view.s}
                  strokeDasharray={`${8 / view.s} ${6 / view.s}`}
                  pointerEvents="none"
                />
              )}
              {focusIssue?.at && (
                <circle
                  cx={focusIssue.at.x}
                  cy={focusIssue.at.y}
                  r={60}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={6}
                  strokeDasharray="12 8"
                />
              )}
            </g>
          </svg>
          <div className="canvas-status">
            <span>{pieces.length} pieces</span>
            {pieces.length > 0 && (
              <span>
                {fmtLen(bounds.width, units)} × {fmtLen(bounds.height, units)}
              </span>
            )}
            <span className={errors ? 'bad' : warnings ? 'warn' : 'good'}>
              {errors
                ? `${errors} error${errors > 1 ? 's' : ''}`
                : warnings
                  ? `${warnings} warning${warnings > 1 ? 's' : ''}`
                  : pieces.length
                    ? 'All good'
                    : ''}
            </span>
            {validation.running.loopCount > 0 && (
              <span>
                {validation.running.loopCount} loop{validation.running.loopCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="legend">
              {[0, 1, 2, 3].map((z) => (
                <span key={z}>
                  <i style={{ background: levelColor(z) }} /> L{z}
                </span>
              ))}
            </span>
          </div>
          <div className="panel-toggle">
            <button className={panel === 'issues' ? 'on' : ''} onClick={() => setPanel(panel === 'issues' ? null : 'issues')}>
              Checks{errors + warnings ? ` (${errors + warnings})` : ''}
            </button>
            <button className={panel === 'parts' ? 'on' : ''} onClick={() => setPanel(panel === 'parts' ? null : 'parts')}>
              Parts
            </button>
          </div>
        </div>

        {panel && (
          <aside className="side-panel">
            {panel === 'issues' ? (
              <IssueList issues={validation.issues} onFocus={setFocusIssue} focused={focusIssue} />
            ) : (
              <PartsList used={used} owned={owned} supports={validation.supports} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Dashed outline of the area the layout covers, with its size, and the user's space for comparison. */
function Footprint({
  bounds: b,
  space,
  scale,
  units,
}: {
  bounds: ReturnType<typeof layoutBounds>;
  space: { width: number; depth: number } | null;
  scale: number;
  units: 'cm' | 'in';
}) {
  const fs = 15 / Math.max(scale, 0.05);
  const gap = 30 / Math.max(scale, 0.05);
  const sw = 2 / Math.max(scale, 0.05);
  const fits = space && b.width <= space.width + 0.5 && b.height <= space.depth + 0.5;
  const fitsRotated = space && b.height <= space.width + 0.5 && b.width <= space.depth + 0.5;
  const spaceColor = fits ? '#16a34a' : fitsRotated ? '#d97706' : '#dc2626';
  return (
    <g className="footprint" pointerEvents="none">
      {space && (
        <>
          <rect
            x={b.minX}
            y={b.minY}
            width={space.width}
            height={space.depth}
            fill={spaceColor}
            fillOpacity={0.05}
            stroke={spaceColor}
            strokeWidth={sw}
            strokeDasharray={`${sw * 6} ${sw * 4}`}
          />
          <text x={b.minX + space.width} y={b.minY + space.depth + fs * 1.4} fontSize={fs} textAnchor="end" fill={spaceColor}>
            Your space {fmtLen(space.width, units)} × {fmtLen(space.depth, units)}
            {fits ? ' — fits' : fitsRotated ? ' — fits if turned 90°' : ' — too small'}
          </text>
        </>
      )}
      <rect x={b.minX} y={b.minY} width={b.width} height={b.height} fill="none" stroke="#0ea5e9" strokeWidth={sw} />
      {/* width along the top */}
      <line x1={b.minX} y1={b.minY - gap} x2={b.maxX} y2={b.minY - gap} stroke="#0ea5e9" strokeWidth={sw} />
      <line x1={b.minX} y1={b.minY - gap * 1.4} x2={b.minX} y2={b.minY - gap * 0.6} stroke="#0ea5e9" strokeWidth={sw} />
      <line x1={b.maxX} y1={b.minY - gap * 1.4} x2={b.maxX} y2={b.minY - gap * 0.6} stroke="#0ea5e9" strokeWidth={sw} />
      <text x={(b.minX + b.maxX) / 2} y={b.minY - gap - fs * 0.4} fontSize={fs} textAnchor="middle" fill="#0369a1" fontWeight={700}>
        {fmtLen(b.width, units)}
      </text>
      {/* depth along the left */}
      <line x1={b.minX - gap} y1={b.minY} x2={b.minX - gap} y2={b.maxY} stroke="#0ea5e9" strokeWidth={sw} />
      <line x1={b.minX - gap * 1.4} y1={b.minY} x2={b.minX - gap * 0.6} y2={b.minY} stroke="#0ea5e9" strokeWidth={sw} />
      <line x1={b.minX - gap * 1.4} y1={b.maxY} x2={b.minX - gap * 0.6} y2={b.maxY} stroke="#0ea5e9" strokeWidth={sw} />
      <text
        x={b.minX - gap - fs * 0.4}
        y={(b.minY + b.maxY) / 2}
        fontSize={fs}
        textAnchor="middle"
        fill="#0369a1"
        fontWeight={700}
        transform={`rotate(-90 ${b.minX - gap - fs * 0.4} ${(b.minY + b.maxY) / 2})`}
      >
        {fmtLen(b.height, units)}
      </text>
    </g>
  );
}

function PieceIcon({ cat, t }: { cat: ReturnType<typeof useStore>['catalog']; t: PieceType }) {
  const piece: PlacedPiece = {
    uid: `icon-${t.code}`,
    code: t.code,
    x: 0,
    y: 0,
    rot: t.category === 'straight' || t.category === 'ramp' || t.category === 'bridge' ? 0 : 0,
    z: 0,
  };
  return (
    <span className="pi-icon">
      <LayoutPreview cat={cat} pieces={[piece]} size={40} />
    </span>
  );
}

function IssueList({ issues, onFocus, focused }: { issues: Issue[]; onFocus: (i: Issue | null) => void; focused: Issue | null }) {
  if (!issues.length)
    return <p className="muted">No problems found. Every end is connected, nothing overlaps, and you have enough pieces.</p>;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="issues">
      <h3>Checks</h3>
      <ul>
        {sorted.map((i, n) => (
          <li
            key={n}
            className={`issue ${i.severity} ${focused === i ? 'focused' : ''}`}
            onMouseEnter={() => onFocus(i)}
            onMouseLeave={() => onFocus(null)}
            onClick={() => onFocus(focused === i ? null : i)}
          >
            <span className="sev">{i.severity}</span>
            <div>
              <strong>{RULES[i.rule]?.title ?? i.rule}</strong>
              <div>{i.message}</div>
              <div className="why">{RULES[i.rule]?.why}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PartsList({
  used,
  owned,
  supports,
}: {
  used: Record<string, number>;
  owned: Record<string, number>;
  supports: ReturnType<typeof validateLayout>['supports'];
}) {
  const { catalog: cat } = useStore();
  const rows = Object.entries(used).sort();
  const supportRows = Object.entries(supports.used).sort();
  return (
    <div className="parts">
      <h3>Parts used</h3>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Piece</th>
            <th>Used</th>
            <th>Own</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([code, n]) => (
            <tr key={code} className={n > (owned[code] ?? 0) ? 'short' : ''}>
              <td>{code}</td>
              <td>{cat.has(code) ? cat.get(code).name : code}</td>
              <td>{n}</td>
              <td>{owned[code] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(supports.needed).length > 0 && (
        <>
          <h3>Supports</h3>
          <p className="muted">
            Raised joints:{' '}
            {Object.entries(supports.needed)
              .map(([l, n]) => `${n} at level ${l}`)
              .join(', ')}
            .
          </p>
          {supportRows.length > 0 && <p className="muted">Uses: {supportRows.map(([c, n]) => `${n}× ${c}`).join(', ')}.</p>}
        </>
      )}
    </div>
  );
}
