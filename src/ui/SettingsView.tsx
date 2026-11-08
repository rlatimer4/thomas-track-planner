import { DEFAULT_PARAMS, type GeometryParams } from '../core';
import { useStore, type Units } from './store';

const FIELDS: { key: keyof GeometryParams; label: string; help: string; unit: 'len' | 'deg' | 'count' }[] = [
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
  {
    key: 'clearanceLevels',
    label: 'Clearance (levels)',
    help: 'How many levels one track must be above another to pass over it.',
    unit: 'count',
  },
  { key: 'joinTolerance', label: 'Joint play', help: 'How far apart two ends can be and still click together.', unit: 'len' },
  { key: 'angleTolerance', label: 'Joint angle play', help: 'How much two ends can be twisted and still click together.', unit: 'deg' },
];

export function SettingsView() {
  const { params, units, update } = useStore();
  const conv = (mm: number) => +(units === 'cm' ? mm / 10 : mm / 25.4).toFixed(2);
  const unconv = (v: number) => (units === 'cm' ? v * 10 : v * 25.4);
  const set = (key: keyof GeometryParams, v: number) => {
    if (!isFinite(v) || v <= 0) return;
    update((s) => ({ ...s, params: { ...s.params, [key]: v } }));
  };

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
        <h3>Track geometry calibration</h3>
        <p className="muted">
          The manufacturer does not publish track dimensions, so these defaults are estimates. Measure your own pieces and enter the numbers
          here; every piece, layout check and auto design updates to match.
        </p>
        <div className="settings-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="setting">
              <span>
                {f.label}
                <small className="muted">{f.help}</small>
              </span>
              <span>
                <input
                  type="number"
                  step={f.unit === 'len' ? 0.1 : 1}
                  value={f.unit === 'len' ? conv(params[f.key]) : params[f.key]}
                  onChange={(e) => set(f.key, f.unit === 'len' ? unconv(+e.target.value) : +e.target.value)}
                />{' '}
                {f.unit === 'len' ? units : f.unit === 'deg' ? '°' : ''}
              </span>
            </label>
          ))}
        </div>
        <button onClick={() => update((s) => ({ ...s, params: DEFAULT_PARAMS }))}>Reset to defaults</button>
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
