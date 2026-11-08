import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  angleDiff,
  attachPose,
  computeConnectivity,
  dirVec,
  layoutBounds,
  layoutToSvg,
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
  const { catalog: cat, owned, currentLayout, saveLayout, update, layouts, units } = useStore();
  const [pieces, setPiecesRaw] = useState<PlacedPiece[]>(currentLayout.pieces);
  const [past, setPast] = useState<PlacedPiece[][]>([]);
  const [future, setFuture] = useState<PlacedPiece[][]>([]);
  const [sel, setSel] = useState<Selection>(null);
  const [lastPlaced, setLastPlaced] = useState<{
    uid: string;
    target: WorldPort | { x: number; y: number; dir: number; z: number };
    inPort: string;
  } | null>(null);
  const [view, setView] = useState<View>({ tx: 300, ty: 250, s: 0.5 });
  const [labels, setLabels] = useState(true);
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
    setLastPlaced(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((h) => [...h, pieces]);
    setPiecesRaw(future[0]);
    setFuture((f) => f.slice(1));
    setSel(null);
  };

  const validation = useMemo(() => validateLayout(cat, pieces, { owned }), [cat, pieces, owned]);
  const openPorts = validation.conn.open;
  const problemUids = useMemo(() => {
    const s = new Set<string>();
    for (const i of validation.issues) if (i.severity === 'error') i.uids.forEach((u) => s.add(u));
    return s;
  }, [validation]);

  const selectedPort: WorldPort | undefined =
    sel?.kind === 'port' ? openPorts.find((p) => p.uid === sel.uid && p.port === sel.port) : undefined;
  const selectedPiece = sel?.kind === 'piece' ? pieces.find((p) => p.uid === sel.uid) : undefined;

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
    const uid = sel?.kind === 'piece' ? sel.uid : lastPlaced?.uid;
    if (!uid) return;
    // after deleting, select the open end it was attached to so building can continue
    const mates = worldPorts(cat, pieces.find((p) => p.uid === uid)!)
      .map((wp) => validation.conn.links.get(portKey(wp)))
      .filter(Boolean);
    setPieces((ps) => ps.filter((p) => p.uid !== uid));
    setLastPlaced(null);
    setSel(mates[0] ? { kind: 'port', uid: mates[0]!.uid, port: mates[0]!.port } : null);
  };

  const rotateSelected = (deg: number) => {
    if (!selectedPiece) return;
    const pts = worldSamples(cat, selectedPiece).flat();
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    const r = rotate({ x: selectedPiece.x - c.x, y: selectedPiece.y - c.y }, deg);
    setPieces((ps) =>
      ps.map((p) => (p.uid === selectedPiece.uid ? { ...p, x: c.x + r.x, y: c.y + r.y, rot: (p.rot + deg + 360) % 360 } : p)),
    );
  };

  const raiseSelected = (dz: number) => {
    if (!selectedPiece) return;
    setPieces((ps) => ps.map((p) => (p.uid === selectedPiece.uid ? { ...p, z: Math.max(-3, p.z + dz) } : p)));
  };

  const clearAll = () => {
    if (pieces.length && !confirm('Remove all pieces from this layout?')) return;
    setPieces([]);
    setSel(null);
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

  // ------------------------------------------------------------ pointer handling
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'pan'; startX: number; startY: number; view: View }
    | { kind: 'drag'; uid: string; start: { x: number; y: number }; orig: PlacedPiece; moved: boolean; before: PlacedPiece[] }
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
    gesture.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, view };
  };

  const onPieceDown = (e: React.PointerEvent, uid: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const orig = pieces.find((p) => p.uid === uid)!;
    setSel({ kind: 'piece', uid });
    gesture.current = { kind: 'drag', uid, start: toWorld(e.clientX, e.clientY), orig, moved: false, before: pieces };
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
      setPiecesRaw((ps) => ps.map((p) => (p.uid === g.uid ? { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy } : p)));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'drag' && g.moved) {
      setPiecesRaw(pieces.map((p) => (p.uid === g.uid ? snap(p) : p)));
      setPast((h) => [...h.slice(-MAX_HISTORY), g.before]);
      setFuture([]);
    } else if (g?.kind === 'pan' && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) {
      setSel(null);
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
      else if (e.key === 'Escape') setSel(null);
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
      JSON.stringify({ format: 'track-planner-layout', version: 1, layout: { ...currentLayout, pieces } }, null, 2),
      'Track layout',
      'json',
    );
  const exportSvg = () => saveTextFile(`${currentLayout.name.replace(/[^\w-]+/g, '_')}.svg`, layoutToSvg(cat, pieces), 'SVG image', 'svg');
  const importJson = async () => {
    const text = await openTextFile('Track layout', 'json');
    if (!text) return;
    try {
      const data = JSON.parse(text);
      const l: Layout = data.layout ?? data;
      if (!Array.isArray(l.pieces)) throw new Error('No pieces');
      const unknown = l.pieces.filter((p) => !cat.has(p.code)).map((p) => p.code);
      if (unknown.length) throw new Error(`Unknown piece codes: ${[...new Set(unknown)].join(', ')}`);
      const imported: Layout = { ...newLayout(l.name ?? 'Imported layout'), pieces: l.pieces };
      update((s) => ({ ...s, layouts: [...s.layouts, imported], currentLayoutId: imported.id }));
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
  const sortedPieces = useMemo(() => [...pieces].sort((a, b) => a.z - b.z), [pieces]);
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
        <button onClick={() => rotateSelected(45)} disabled={!selectedPiece} title="Rotate selected 45° (R)">
          Rotate
        </button>
        <button onClick={() => raiseSelected(1)} disabled={!selectedPiece} title="Raise selected one level">
          Up
        </button>
        <button onClick={() => raiseSelected(-1)} disabled={!selectedPiece} title="Lower selected one level">
          Down
        </button>
        <button onClick={removeSelected} disabled={!selectedPiece && !lastPlaced} title="Delete selected (Del)">
          Remove
        </button>
        <button onClick={clearAll} title="Remove all pieces">
          Clear
        </button>
        <span className="sep" />
        <button onClick={() => fit()} title="Zoom to fit">
          Fit
        </button>
        <label className="check">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Codes
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
            {selectedPort
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
              {sortedPieces.map((p) => (
                <TrackPiece
                  key={p.uid}
                  cat={cat}
                  piece={p}
                  labels={labels}
                  selected={sel?.kind === 'piece' && sel.uid === p.uid}
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
