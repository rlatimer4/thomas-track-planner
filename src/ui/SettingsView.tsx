import { DEFAULT_PARAMS, type GeometryParams } from '../core';
import { useStore, type Units } from './store';

type Field = { key: keyof GeometryParams; label: string; help: string; unit: 'len' | 'deg' | 'count' | 'bool' };

const RUNNING: Field[] = [
  { key: 'engineCount', label: 'Engines running at once', help: 'Used to check for collisions and places to pass or wait.', unit: 'count' },
  { key: 'trainLength', label: 'Longest train', help: 'Engine plus cars. Sidings and passing loops must hold it.', unit: 'len' },
  { key: 'vehicleWidth', label: 'Engine width', help: 'Widest engine or car. Tracks closer than this are flagged.', unit: 'len' },
  {
    key: 'clearanceLevels',
    label: 'Engine headroom (levels)',
    help: 'How many levels a track must be above another for engines to pass underneath.',
    unit: 'count',
  },
  {
    key: 'trailingPushThrough',
    label: 'Engines push through switches set against them',
    help: 'Untick if an engine arriving from a switch’s branch derails when the switch is set the other way.',
    unit: 'bool',
  },
];

const FIELDS: Field[] = [
  { key: 'straight', label: 'Straight length (S1)', help: 'End-to-end length of a standard straight.', unit: 'len' },
  { key: 'curveRadius', label: 'Curve radius (C)', help: 'Radius to the middle of the track on a standard curve.', unit: 'len' },
  { key: 'curveAngle', label: 'Curve angle', help: 'How far one curve turns. 45° means 8 curves make a circle.', unit: 'deg' },
  {
    key: 'rampLength',
    label: 'Straight ramp length',
    help: 'Default floor length for custom straight ramps. (AL/AR/AR1 are climbing curves shaped like a C curve.)',
    unit: 'len',
  },
  {
    key: 'parallelSpacing',
    label: 'Parallel track spacing',
    help: 'Distance between the two lanes after an offset switch (PR/PL).',
    unit: 'len',
  },
  { key: 'trackWidth', label: 'Track width', help: 'Width of the track bed, used to detect overlaps.', unit: 'len' },
  { key: 'levelHeight', label: 'Level height', help: 'Height of one elevation level.', unit: 'len' },
  { key: 'joinTolerance', label: 'Joint play', help: 'How far apart two ends can be and still click together.', unit: 'len' },
  { key: 'angleTolerance', label: 'Joint angle play', help: 'How much two ends can be twisted and still click together.', unit: 'deg' },
];

function FieldRow({ f }: { f: Field }) {
  const { params, units, update } = useStore();
  const conv = (mm: number) => +(units === 'cm' ? mm / 10 : mm / 25.4).toFixed(2);
  const unconv = (v: number) => (units === 'cm' ? v * 10 : v * 25.4);
  const set = (v: number) => {
    if (!isFinite(v) || v < 0 || (v === 0 && f.unit !== 'bool')) return;
    update((s) => ({ ...s, params: { ...s.params, [f.key]: v } }));
  };
  return (
    <label className="setting">
      <span>
        {f.label}
        <small className="muted">{f.help}</small>
      </span>
      <span>
        {f.unit === 'bool' ? (
          <input type="checkbox" checked={!!params[f.key]} onChange={(e) => set(e.target.checked ? 1 : 0)} />
        ) : (
          <>
            <input
              type="number"
              step={f.unit === 'len' ? 0.1 : 1}
              value={f.unit === 'len' ? conv(params[f.key]) : params[f.key]}
              onChange={(e) => set(f.unit === 'len' ? unconv(+e.target.value) : +e.target.value)}
            />{' '}
            {f.unit === 'len' ? units : f.unit === 'deg' ? '°' : ''}
          </>
        )}
      </span>
    </label>
  );
}

function SpaceRow() {
  const { space, units, update } = useStore();
  const conv = (mm: number) => +(units === 'cm' ? mm / 10 : mm / 25.4).toFixed(1);
  const unconv = (v: number) => (units === 'cm' ? v * 10 : v * 25.4);
  const setSpace = (s2: { width: number; depth: number } | null) => update((s) => ({ ...s, space: s2 }));
  return (
    <label className="setting">
      <span>
        My space
        <small className="muted">Floor or table area for the layout. Shown with the footprint and used by Auto design.</small>
      </span>
      <span>
        <input type="checkbox" checked={!!space} onChange={(e) => setSpace(e.target.checked ? { width: 2000, depth: 1500 } : null)} />{' '}
        {space && (
          <span className="dims">
            <input
              type="number"
              aria-label="space width"
              value={conv(space.width)}
              onChange={(e) => +e.target.value > 0 && setSpace({ ...space, width: unconv(+e.target.value) })}
            />{' '}
            ×{' '}
            <input
              type="number"
              aria-label="space depth"
              value={conv(space.depth)}
              onChange={(e) => +e.target.value > 0 && setSpace({ ...space, depth: unconv(+e.target.value) })}
            />{' '}
            {units}
          </span>
        )}
      </span>
    </label>
  );
}

export function SettingsView() {
  const { units, update } = useStore();

  return (
    <div className="page">
      <section>
        <h2>Settings</h2>
        <label>
          Units
          <select value={units} onChange={(e) => update((s) => ({ ...s, units: e.target.value as Units }))}>
            <option value="cm">Centimetres</option>
            <option value="in">Inches</option>
          </select>
        </label>
      </section>
      <section>
        <h3>Space and trains</h3>
        <div className="settings-grid">
          <SpaceRow />
          {RUNNING.map((f) => (
            <FieldRow key={f.key} f={f} />
          ))}
        </div>
      </section>
      <section>
        <h3>Track geometry calibration</h3>
        <p className="muted">
          The manufacturer does not publish track dimensions, so these defaults are estimates. Measure your own pieces and enter the numbers
          here; every piece, layout check and auto design updates to match.
        </p>
        <div className="settings-grid">
          {FIELDS.map((f) => (
            <FieldRow key={f.key} f={f} />
          ))}
        </div>
        <button onClick={() => update((s) => ({ ...s, params: DEFAULT_PARAMS }))}>Reset all settings to defaults</button>
      </section>
      <section>
        <h3>Data</h3>
        <p className="muted">Your inventory and layouts are saved on this device automatically.</p>
        <button
          className="danger"
          onClick={() => {
            if (confirm('Erase all layouts, inventory and custom pieces?')) {
              localStorage.clear();
              location.reload();
            }
          }}
        >
          Reset all data
        </button>
      </section>
    </div>
  );
}
