import { useState } from 'react';
import { type CustomPieceDef, type PieceCategory } from '../core';
import { useStore, fmtLen } from './store';
import { LayoutPreview } from './TrackPieces';

const CATEGORY_LABEL: Record<PieceCategory, string> = {
  straight: 'Straights',
  curve: 'Curves',
  switch: 'Switches',
  ramp: 'Ramps',
  buffer: 'Buffers',
  crossing: 'Crossings',
  station: 'Stations',
  bridge: 'Bridges',
  support: 'Supports',
};

export function CatalogView() {
  const { catalog: cat, owned, units, update } = useStore();
  const [adding, setAdding] = useState(false);
  const groups = new Map<PieceCategory, ReturnType<typeof cat.all>>();
  for (const t of cat.all()) (groups.get(t.category) ?? groups.set(t.category, []).get(t.category)!).push(t);

  const removeCustom = (code: string) => {
    if (!confirm(`Delete custom piece ${code}? Layouts using it will no longer load it.`)) return;
    update((s) => ({ ...s, customPieces: s.customPieces.filter((c) => c.code !== code) }));
  };

  return (
    <div className="page">
      <section>
        <h2>Track catalog</h2>
        <p className="muted">
          Every piece the planner knows, with how it connects. Green dots are connectors, and arrows show which way each end faces. Any end
          can join any other end at the same level: TrackMaster connectors are not male/female. Pieces marked <em>estimated</em> have
          approximate geometry. You can calibrate sizes in Settings.
        </p>
        {[...groups.entries()].map(([cg, list]) => (
          <div key={cg}>
            <h3>{CATEGORY_LABEL[cg]}</h3>
            <div className="catalog-grid">
              {list.map((t) => (
                <div key={t.code} className="card piece-card">
                  <div className="piece-art">
                    {t.isTrack ? (
                      <LayoutPreview cat={cat} pieces={[{ uid: t.code, code: t.code, x: 0, y: 0, rot: 0, z: 0 }]} size={90} showPorts />
                    ) : (
                      <div className="support-art" style={{ background: t.color }}>
                        L{t.supportLevel}
                      </div>
                    )}
                  </div>
                  <div>
                    <strong>{t.code}</strong> · {t.name}
                    {t.approximate && <span className="badge">estimated</span>}
                    {t.custom && <span className="badge custom">custom</span>}
                  </div>
                  <div className="muted small">{t.description}</div>
                  <div className="small">
                    {t.isTrack ? (
                      <>
                        {t.ports.length} end{t.ports.length > 1 ? 's' : ''}
                        {t.length ? ` · ${fmtLen(t.length, units)} long` : ''}
                        {t.category === 'ramp' &&
                          ` · climbs ${Math.max(...t.ports.map((p) => p.z)) - Math.min(...t.ports.map((p) => p.z))} level`}
                        {t.category !== 'ramp' &&
                          Math.max(...t.ports.map((p) => p.z)) > 0 &&
                          ` · top at level ${Math.max(...t.ports.map((p) => p.z))}`}
                        {t.supportedPorts?.length ? ' · supports its own top joint' : ''}
                      </>
                    ) : t.category === 'support' && t.supportLevel ? (
                      <>Holds track at level {t.supportLevel}</>
                    ) : (
                      <>Support part</>
                    )}
                    {' · '}you own {owned[t.stockCode] ?? 0}
                    {t.stockCode !== t.code && ` (same piece as ${t.stockCode})`}
                  </div>
                  {t.custom && (
                    <button className="link danger" onClick={() => removeCustom(t.code)}>
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {adding ? <PieceEditor onDone={() => setAdding(false)} /> : <button onClick={() => setAdding(true)}>+ Add a custom piece</button>}
      </section>
    </div>
  );
}

function PieceEditor({ onDone }: { onDone: () => void }) {
  const { catalog: cat, update, units } = useStore();
  const p = cat.params;
  const toUnit = (mm: number) => +(units === 'cm' ? mm / 10 : mm / 25.4).toFixed(1);
  const fromUnit = (v: number) => (units === 'cm' ? v * 10 : v * 25.4);
  const [d, setD] = useState<CustomPieceDef>({
    code: '',
    name: '',
    kind: 'straight',
    length: p.straight,
    radius: p.curveRadius,
    angle: p.curveAngle,
    hand: 'right',
    levels: 1,
  });
  const save = () => {
    const code = d.code.trim().toUpperCase();
    if (!code || !d.name.trim()) return alert('Code and name are required.');
    if (cat.has(code)) return alert('That code is already used.');
    update((s) => ({ ...s, customPieces: [...s.customPieces, { ...d, code, name: d.name.trim() }] }));
    onDone();
  };
  return (
    <div className="card editor">
      <h3>New custom piece</h3>
      <label>
        Code <input value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} placeholder="e.g. S2" />
      </label>
      <label>
        Name <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Half straight" />
      </label>
      <label>
        Kind
        <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as CustomPieceDef['kind'] })}>
          <option value="straight">Straight</option>
          <option value="curve">Curve</option>
          <option value="switch">Switch</option>
          <option value="ramp">Ramp</option>
          <option value="buffer">Buffer stop</option>
          <option value="support">Support</option>
        </select>
      </label>
      {['straight', 'ramp', 'switch'].includes(d.kind) && (
        <label>
          Length ({units}){' '}
          <input type="number" step="0.1" value={toUnit(d.length!)} onChange={(e) => setD({ ...d, length: fromUnit(+e.target.value) })} />
        </label>
      )}
      {['curve', 'switch'].includes(d.kind) && (
        <>
          <label>
            Radius ({units}){' '}
            <input type="number" step="0.1" value={toUnit(d.radius!)} onChange={(e) => setD({ ...d, radius: fromUnit(+e.target.value) })} />
          </label>
          <label>
            Angle (°) <input type="number" value={d.angle} onChange={(e) => setD({ ...d, angle: +e.target.value })} />
          </label>
        </>
      )}
      {d.kind === 'switch' && (
        <label>
          Branch
          <select value={d.hand} onChange={(e) => setD({ ...d, hand: e.target.value as 'left' | 'right' })}>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>
      )}
      {(d.kind === 'ramp' || d.kind === 'support') && (
        <label>
          {d.kind === 'ramp' ? 'Levels climbed' : 'Holds at level'}{' '}
          <input type="number" min={1} max={4} value={d.levels} onChange={(e) => setD({ ...d, levels: +e.target.value })} />
        </label>
      )}
      <div className="row">
        <button className="primary" onClick={save}>
          Add piece
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
