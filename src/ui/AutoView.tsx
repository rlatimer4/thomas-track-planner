import { useEffect, useRef, useState } from 'react';
import { newLayout, RULES, type AutoGenOptions, type Candidate, type LayoutStyle } from '../core';
import { useStore, fmtLen, parseLen } from './store';
import { LayoutPreview } from './TrackPieces';
import type { AutoGenRequest } from './autogen.worker';

const PRINCIPLES = [
  ['Continuous running', 'Every layout has a closed main loop, so motorized engines keep running without stopping at an end.'],
  ['No open ends', 'Every track end connects to another piece. Sidings end in a buffer stop.'],
  ['Grade separation', 'Track only crosses itself on a raised section (ramps up and over), never at the same level.'],
  ['Gentle grades', 'Ramps climb at most two levels and come back down. Switches are never placed directly on a ramp.'],
  ['Easements', 'Curves that turn opposite ways back to back (S-bends) are penalized; a straight between them runs smoother.'],
  ['Passing places', 'Offset switches form double-track sections and the two-lane station so two engines can pass or wait.'],
  ['Support check', 'Raised joints are matched against the supports you own (piers and support pairs with a deck).'],
  ['Uses what you own', 'Only pieces in your inventory are used, and the space limit is respected.'],
];

export function AutoView({ onOpen }: { onOpen: () => void }) {
  const { catalog: cat, params, customPieces, owned, units, update, space } = useStore();
  const [style, setStyle] = useState<LayoutStyle>('any');
  const toUnits = (mm: number) => Math.round(units === 'cm' ? mm / 10 : mm / 25.4);
  const [limit, setLimit] = useState(!!space);
  const [w, setW] = useState(space ? toUnits(space.width) : units === 'cm' ? 200 : 78);
  const [d, setD] = useState(space ? toUnits(space.depth) : units === 'cm' ? 150 : 60);
  const [sidings, setSidings] = useState(true);
  const [elevation, setElevation] = useState(true);
  const [station, setStation] = useState(true);
  const [seconds, setSeconds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const generate = () => {
    worker.current?.terminate();
    const wk = new Worker(new URL('./autogen.worker.ts', import.meta.url), { type: 'module' });
    worker.current = wk;
    setBusy(true);
    setError(null);
    const options: AutoGenOptions = {
      owned,
      style,
      wantSidings: sidings,
      wantElevation: elevation,
      wantStation: station,
      maxWidth: limit ? parseLen(w, units) : undefined,
      maxDepth: limit ? parseLen(d, units) : undefined,
      results: 8,
      timeBudgetMs: seconds * 1000,
      seed: Math.floor(Math.random() * 1e9),
    };
    wk.onmessage = (e) => {
      setBusy(false);
      if (e.data.ok) setResults(e.data.results);
      else setError(e.data.error);
      wk.terminate();
    };
    wk.onerror = (e) => {
      setBusy(false);
      setError(e.message);
    };
    wk.postMessage({ params, customPieces, options } satisfies AutoGenRequest);
  };

  const open = (c: Candidate) => {
    const l = { ...newLayout(`${c.name}`), pieces: c.pieces };
    update((s) => ({ ...s, layouts: [...s.layouts, l], currentLayoutId: l.id }));
    onOpen();
  };

  return (
    <div className="page">
      <section>
        <h2>Auto design</h2>
        <p className="muted">Generates layouts from the pieces you own, following basic railroad design rules.</p>
        <div className="card options">
          <label>
            Shape
            <select value={style} onChange={(e) => setStyle(e.target.value as LayoutStyle)}>
              <option value="any">Any</option>
              <option value="loop">Loops only</option>
              <option value="figure8">Figure-8 (crosses over itself)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={sidings} onChange={(e) => setSidings(e.target.checked)} /> Sidings & passing loops
          </label>
          <label className="check">
            <input type="checkbox" checked={station} onChange={(e) => setStation(e.target.checked)} /> Station
          </label>
          <label className="check">
            <input type="checkbox" checked={elevation} onChange={(e) => setElevation(e.target.checked)} /> Hills & bridges
          </label>
          <label className="check">
            <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} /> Fit in a space
          </label>
          {limit && (
            <span className="dims">
              <input type="number" value={w} min={20} onChange={(e) => setW(+e.target.value)} aria-label="width" /> ×{' '}
              <input type="number" value={d} min={20} onChange={(e) => setD(+e.target.value)} aria-label="depth" /> {units}
            </span>
          )}
          <label>
            Search time
            <select value={seconds} onChange={(e) => setSeconds(+e.target.value)}>
              <option value={2}>Quick (2 s)</option>
              <option value={3}>Normal (3 s)</option>
              <option value={8}>Thorough (8 s)</option>
            </select>
          </label>
          <button className="primary" onClick={generate} disabled={busy}>
            {busy ? 'Designing…' : results ? 'Generate again' : 'Generate layouts'}
          </button>
        </div>
        {error && <p className="bad">Error: {error}</p>}
        {results && results.length === 0 && (
          <p className="warn">
            No layout could be built. A loop needs at least 8 curves (or 6 plus straights), and more straights and curves allow more shapes.
            Try removing the space limit or adding pieces.
          </p>
        )}
        {results && results.length > 0 && (
          <div className="results">
            {results.map((c, i) => (
              <div key={i} className="card result">
                <LayoutPreview cat={cat} pieces={c.pieces} size={220} />
                <div className="result-head">
                  <strong>{c.name}</strong>
                  <span
                    className="score"
                    title={Object.entries(c.breakdown)
                      .map(([k, v]) => `${k}: ${v > 0 ? '+' : ''}${v}`)
                      .join('\n')}
                  >
                    {Math.round(c.score)} pts
                  </span>
                </div>
                <div className="muted small">
                  {c.pieces.length} pieces · {fmtLen(c.width, units)} × {fmtLen(c.depth, units)}
                </div>
                <ul className="features">
                  {c.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {c.issues
                    .filter((x) => x.severity !== 'error')
                    .map((x, n) => (
                      <li key={`i${n}`} className={x.severity}>
                        {RULES[x.rule]?.title ?? x.rule}: {x.message}
                      </li>
                    ))}
                </ul>
                <button className="primary" onClick={() => open(c)}>
                  Open in builder
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3>Design rules used</h3>
        <dl className="principles">
          {PRINCIPLES.map(([t, d2]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d2}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
