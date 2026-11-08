import { useState } from 'react';
import { adjustLoose, setKitQty, type Kit } from '../core';
import { useStore } from './store';
import { LayoutPreview } from './TrackPieces';

export function InventoryView() {
  const { kits, inventory, owned, catalog: cat, update } = useStore();
  const [showAddKit, setShowAddKit] = useState(false);

  const setKit = (id: string, qty: number) => update((s) => ({ ...s, inventory: setKitQty(s.inventory, id, qty) }));
  const loose = (code: string, d: number) => update((s) => ({ ...s, inventory: adjustLoose(s.inventory, code, d) }));
  const removeKit = (id: string) => {
    if (!confirm('Delete this custom kit?')) return;
    update((s) => ({ ...s, customKits: s.customKits.filter((k) => k.id !== id), inventory: setKitQty(s.inventory, id, 0) }));
  };

  const all = cat.all();
  const trackTotal = all.filter((t) => t.isTrack).reduce((a, t) => a + (owned[t.code] ?? 0), 0);
  const supportTotal = all.filter((t) => !t.isTrack).reduce((a, t) => a + (owned[t.code] ?? 0), 0);

  return (
    <div className="page">
      <section>
        <h2>My kits</h2>
        <p className="muted">Add the sets you own. Their pieces are added to your collection.</p>
        <div className="kit-grid">
          {kits.map((k) => {
            const qty = inventory.kits[k.id] ?? 0;
            const n = Object.entries(k.pieces).reduce((a, [c, v]) => a + (cat.has(c) && cat.get(c).isTrack ? v : 0), 0);
            return (
              <div key={k.id} className={`card kit ${qty ? 'owned' : ''}`}>
                <div className="kit-head">
                  <div>
                    <strong>{k.name}</strong>
                    <div className="muted small">
                      {k.model && <>Model {k.model} · </>}
                      {n} track pieces{k.custom && ' · custom'}
                    </div>
                  </div>
                  <Stepper value={qty} onChange={(v) => setKit(k.id, v)} label={`${k.name} quantity`} />
                </div>
                <div className="chips">
                  {Object.entries(k.pieces).map(([code, v]) => (
                    <span key={code} className="chip" title={cat.has(code) ? cat.get(code).name : code}>
                      {v}× {code}
                    </span>
                  ))}
                </div>
                {k.extras && <div className="muted small">Also: {k.extras.join(', ')}</div>}
                {k.custom && (
                  <button className="link danger" onClick={() => removeKit(k.id)}>
                    Delete kit
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {showAddKit ? <KitEditor onDone={() => setShowAddKit(false)} /> : <button onClick={() => setShowAddKit(true)}>+ Define a kit</button>}
      </section>

      <section>
        <h2>All pieces</h2>
        <p className="muted">
          You own {trackTotal} track pieces and {supportTotal} supports. Use + and − to add loose pieces or record lost ones.
        </p>
        <table className="inv-table">
          <thead>
            <tr>
              <th />
              <th>Code</th>
              <th>Piece</th>
              <th>From kits</th>
              <th>Loose</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {all.map((t) => {
              const total = owned[t.code] ?? 0;
              const l = inventory.loose[t.code] ?? 0;
              return (
                <tr key={t.code} className={total ? '' : 'zero'}>
                  <td className="thumb">
                    {t.isTrack ? (
                      <LayoutPreview cat={cat} pieces={[{ uid: t.code, code: t.code, x: 0, y: 0, rot: 0, z: 0 }]} size={32} />
                    ) : (
                      <span className="swatch" style={{ background: t.color }} />
                    )}
                  </td>
                  <td>{t.code}</td>
                  <td>{t.name}</td>
                  <td>{Math.max(0, total - l)}</td>
                  <td>
                    <Stepper value={l} min={-99} onChange={(v) => loose(t.code, v - l)} label={`Loose ${t.code}`} />
                  </td>
                  <td>
                    <strong>{total}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, label }: { value: number; onChange: (v: number) => void; min?: number; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="decrease" disabled={value <= min}>
        −
      </button>
      <span className="val">{value}</span>
      <button onClick={() => onChange(value + 1)} aria-label="increase">
        +
      </button>
    </span>
  );
}

function KitEditor({ onDone }: { onDone: () => void }) {
  const { catalog: cat, update, kits } = useStore();
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [pieces, setPieces] = useState<Record<string, number>>({});
  const save = () => {
    const id = (model || name).trim().replace(/\s+/g, '-').toUpperCase() || `KIT${Date.now()}`;
    if (kits.some((k) => k.id === id)) return alert('A kit with that model/name already exists.');
    const clean = Object.fromEntries(Object.entries(pieces).filter(([, v]) => v > 0));
    if (!name.trim() || !Object.keys(clean).length) return alert('Give the kit a name and at least one piece.');
    const kit: Kit = { id, name: name.trim(), model: model.trim() || undefined, pieces: clean, custom: true };
    update((s) => ({ ...s, customKits: [...s.customKits, kit] }));
    onDone();
  };
  return (
    <div className="card editor">
      <h3>New kit</h3>
      <label>
        Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Track expansion pack" />
      </label>
      <label>
        Model number <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="optional, e.g. ABC12" />
      </label>
      <div className="kit-pieces">
        {cat.all().map((t) => (
          <div key={t.code} className="kp">
            <span>
              <strong>{t.code}</strong> {t.name}
            </span>
            <Stepper value={pieces[t.code] ?? 0} onChange={(v) => setPieces({ ...pieces, [t.code]: v })} label={t.code} />
          </div>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={save}>
          Save kit
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
