import { useMemo, useState } from 'react';
import { Catalog, angleDiff, MEASURING_GUIDE, TRACK_STANDARD, checkSpec, type PathDef, type PieceCategory, type PieceSpec } from '../core';
import { useStore, fmtLen } from './store';
import { LayoutPreview } from './TrackPieces';

const A = TRACK_STANDARD.curveAngle;

/** Starting points for common kinds of piece. Everything stays editable afterwards. */
export const TEMPLATES: { id: string; label: string; category: PieceCategory; paths?: PathDef[]; extra?: Partial<PieceSpec> }[] = [
  { id: 'straight', label: 'Straight', category: 'straight', paths: [{ from: 'a', to: 'b', length: 1 }] },
  { id: 'half', label: 'Half straight', category: 'straight', paths: [{ from: 'a', to: 'b', length: 0.5 }] },
  { id: 'curve', label: `Curve (${A}°)`, category: 'curve', paths: [{ from: 'a', to: 'b', turn: A }] },
  { id: 'curve45', label: 'Curve (45°)', category: 'curve', paths: [{ from: 'a', to: 'b', turn: 45 }] },
  { id: 'climb-curve', label: 'Climbing curve', category: 'ramp', paths: [{ from: 'a', to: 'b', turn: A, rise: 1 }] },
  { id: 'climb-straight', label: 'Climbing straight', category: 'ramp', paths: [{ from: 'a', to: 'b', length: 1.5, rise: 1 }] },
  {
    id: 'switch',
    label: 'Switch',
    category: 'switch',
    paths: [
      { from: 'a', to: 'b', length: 1 },
      { from: 'a', to: 'c', turn: A },
    ],
  },
  {
    id: 'offset',
    label: 'Offset switch',
    category: 'switch',
    paths: [
      { from: 'a', to: 'b', length: 1 },
      { from: 'a', to: 'c', offset: 1, length: 1 },
    ],
  },
  {
    id: 'wye',
    label: 'Y switch',
    category: 'switch',
    paths: [
      { from: 'a', to: 'b', turn: -A },
      { from: 'a', to: 'c', turn: A },
    ],
  },
  {
    id: 'fork3',
    label: '3-way fork',
    category: 'switch',
    paths: [
      { from: 'a', to: 'b', length: 1 },
      { from: 'a', to: 'c', turn: -A },
      { from: 'a', to: 'd', turn: A },
    ],
  },
  { id: 'crossing', label: 'Crossing', category: 'crossing', paths: crossingPaths(90) },
  {
    id: 'double',
    label: 'Two parallel lanes',
    category: 'station',
    paths: [
      { from: 'a', to: 'b', length: 1 },
      { from: 'c', to: 'd', length: 1, start: { lanes: 1 } },
    ],
  },
  { id: 'buffer', label: 'Buffer stop', category: 'buffer', paths: [{ from: 'a', length: 0.2 }] },
  { id: 'support', label: 'Support', category: 'support', extra: { supportLevel: 1 } },
];

/** Two straight paths of one straight each, crossing at their middles at `angle` degrees. */
export function crossingPaths(angle: number): PathDef[] {
  const r = (angle * Math.PI) / 180;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [
    { from: 'a', to: 'b', length: 1 },
    { from: 'c', to: 'd', length: 1, start: { along: round(0.5 - 0.5 * Math.cos(r)), side: round(-0.5 * Math.sin(r)), heading: angle } },
  ];
}

const CATEGORIES: PieceCategory[] = ['straight', 'curve', 'switch', 'ramp', 'buffer', 'crossing', 'station', 'bridge', 'support'];

type Shape = 'straight' | 'curve' | 'offset';
const shapeOf = (p: PathDef): Shape => (p.turn ? 'curve' : p.offset ? 'offset' : 'straight');

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  hint,
  width = 70,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  suffix?: string;
  hint?: string;
  width?: number;
}) {
  return (
    <label className="nf" title={hint}>
      <span>{label}</span>
      <span>
        <input
          type="number"
          step={step}
          value={value ?? ''}
          style={{ width }}
          onChange={(e) => onChange(e.target.value === '' ? undefined : +e.target.value)}
        />
        {suffix && <small> {suffix}</small>}
      </span>
    </label>
  );
}

function PathRow({
  path,
  index,
  onChange,
  onRemove,
}: {
  path: PathDef;
  index: number;
  onChange: (p: PathDef) => void;
  onRemove: () => void;
}) {
  const { params, units } = useStore();
  const shape = shapeOf(path);
  const [elsewhere, setElsewhere] = useState(!!path.start);
  const setShape = (s: Shape) => {
    const { turn: _t, offset: _o, radius: _r, ...rest } = path;
    void [_t, _o, _r];
    if (s === 'curve') onChange({ ...rest, turn: A, length: undefined });
    else if (s === 'offset') onChange({ ...rest, offset: 1, length: rest.length ?? 1 });
    else onChange({ ...rest, length: rest.length ?? 1 });
  };
  const mm = (v: number, unit: number) => fmtLen(v * unit, units);
  return (
    <div className="path-row card">
      <div className="path-head">
        <strong>Path {index + 1}</strong>
        <label className="nf">
          <span>From end</span>
          <input value={path.from} style={{ width: 50 }} onChange={(e) => onChange({ ...path, from: e.target.value.trim() })} />
        </label>
        <label className="nf">
          <span>To end</span>
          <input
            value={path.to ?? ''}
            placeholder="dead end"
            style={{ width: 70 }}
            onChange={(e) => onChange({ ...path, to: e.target.value.trim() || undefined })}
          />
        </label>
        <label className="nf">
          <span>Shape</span>
          <select value={shape} onChange={(e) => setShape(e.target.value as Shape)}>
            <option value="straight">Straight</option>
            <option value="curve">Curve (turns)</option>
            <option value="offset">Offset (shifts sideways)</option>
          </select>
        </label>
        <button className="link danger" onClick={onRemove} aria-label={`Remove path ${index + 1}`}>
          Remove
        </button>
      </div>
      <div className="path-fields">
        {shape === 'curve' ? (
          <>
            <NumberField
              label="Turn"
              value={path.turn}
              suffix="° (+right / −left)"
              onChange={(v) => onChange({ ...path, turn: v })}
              hint={`A standard curve turns ${A}°.`}
            />
            <NumberField
              label="Radius"
              value={path.radius ?? 1}
              step={0.05}
              suffix={`× R (${mm(path.radius ?? 1, params.curveRadius)})`}
              onChange={(v) => onChange({ ...path, radius: v === 1 ? undefined : v })}
            />
          </>
        ) : (
          <NumberField
            label="Length"
            value={path.length ?? 1}
            step={0.05}
            suffix={`× S (${mm(path.length ?? 1, params.straight)})`}
            onChange={(v) => onChange({ ...path, length: v })}
          />
        )}
        {shape === 'offset' && (
          <NumberField
            label="Offset"
            value={path.offset}
            step={0.5}
            suffix={`lanes, +right (${mm(path.offset ?? 0, params.parallelSpacing)})`}
            onChange={(v) => onChange({ ...path, offset: v })}
          />
        )}
        <NumberField label="Starts at level" value={path.level ?? 0} onChange={(v) => onChange({ ...path, level: v || undefined })} />
        <NumberField label="Climbs" value={path.rise ?? 0} suffix="levels" onChange={(v) => onChange({ ...path, rise: v || undefined })} />
        <label className="check small">
          <input
            type="checkbox"
            checked={elsewhere}
            onChange={(e) => {
              setElsewhere(e.target.checked);
              if (!e.target.checked) onChange({ ...path, start: undefined });
            }}
          />{' '}
          Starts away from the piece’s first end
        </label>
      </div>
      {elsewhere && (
        <div className="path-fields">
          <NumberField
            label="Along"
            value={path.start?.along}
            step={0.05}
            suffix="× S"
            onChange={(v) => onChange({ ...path, start: { ...path.start, along: v } })}
          />
          <NumberField
            label="Sideways"
            value={path.start?.side}
            step={0.05}
            suffix="× S (+right)"
            onChange={(v) => onChange({ ...path, start: { ...path.start, side: v } })}
          />
          <NumberField
            label="or lanes"
            value={path.start?.lanes}
            step={1}
            suffix="lanes (+right)"
            onChange={(v) => onChange({ ...path, start: { ...path.start, lanes: v } })}
          />
          <NumberField
            label="Heading"
            value={path.start?.heading}
            suffix="° (+right)"
            onChange={(v) => onChange({ ...path, start: { ...path.start, heading: v } })}
          />
        </div>
      )}
    </div>
  );
}

function blankSpec(): PieceSpec {
  return {
    code: '',
    name: '',
    category: 'straight',
    description: '',
    color: '#7c3aed',
    paths: [{ from: 'a', to: 'b', length: 1 }],
    custom: true,
  };
}

export function PieceEditor({ initial, editing, onDone }: { initial?: PieceSpec; editing?: boolean; onDone: () => void }) {
  const { params, customPieces, catalog, update } = useStore();
  const [spec, setSpec] = useState<PieceSpec>(() => structuredClone(initial ?? blankSpec()));
  const [crossAngle, setCrossAngle] = useState(90);
  const [showGuide, setShowGuide] = useState(false);
  const set = (patch: Partial<PieceSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const paths = spec.paths ?? [];
  const isSupport = spec.category === 'support';

  const errors = useMemo(() => {
    const e = checkSpec(spec, params);
    const code = spec.code.trim().toUpperCase();
    if (!editing && code && catalog.has(code)) e.unshift(`The code ${code} is already used.`);
    return e;
  }, [spec, params, editing, catalog]);

  const preview = useMemo(() => {
    if (isSupport || !paths.length) return null;
    try {
      const cat = new Catalog(params, [{ ...spec, code: '__PREVIEW__' }]);
      if (!cat.has('__PREVIEW__')) return null;
      return cat;
    } catch {
      return null;
    }
  }, [spec, params, isSupport, paths.length]);

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setSpec((s) => ({
      ...s,
      category: t.category,
      paths: t.paths ? structuredClone(t.paths) : undefined,
      supportLevel: undefined,
      pairedSupport: undefined,
      stackable: undefined,
      jointsHeld: undefined,
      ...t.extra,
    }));
  };

  const save = () => {
    if (errors.length) return;
    const clean: PieceSpec = { ...spec, code: spec.code.trim().toUpperCase(), name: spec.name.trim(), custom: true };
    if (clean.category === 'support') delete clean.paths;
    update((s) => ({
      ...s,
      customPieces: editing ? s.customPieces.map((c) => (c.code === clean.code ? clean : c)) : [...s.customPieces, clean],
    }));
    onDone();
  };

  const ends = [...new Set(paths.flatMap((p) => [p.from, p.to].filter(Boolean) as string[]))];
  const nextEnd = () => 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !ends.includes(c)) ?? 'z';

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Piece editor">
      <div className="modal piece-editor">
        <div className="modal-head">
          <h3>{editing ? `Edit ${spec.code}` : 'New custom piece'}</h3>
          <button onClick={onDone} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="editor-grid">
          <div className="editor-form">
            <div className="row wrap">
              <label className="nf">
                <span>Start from</span>
                <select value="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Template">
                  <option value="">Choose a template…</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {spec.category === 'crossing' && paths.length === 2 && (
                <NumberField
                  label="Crossing angle"
                  value={crossAngle}
                  suffix="°"
                  onChange={(v) => {
                    setCrossAngle(v ?? 90);
                    if (v) set({ paths: crossingPaths(v) });
                  }}
                />
              )}
            </div>
            <div className="row wrap">
              <label className="nf">
                <span>Code</span>
                <input
                  value={spec.code}
                  disabled={editing}
                  style={{ width: 90 }}
                  placeholder="e.g. S2"
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                />
              </label>
              <label className="nf grow">
                <span>Name</span>
                <input value={spec.name} placeholder="e.g. Half straight" onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="nf">
                <span>Type</span>
                <select value={spec.category} onChange={(e) => set({ category: e.target.value as PieceCategory })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nf">
                <span>Colour</span>
                <input type="color" value={spec.color} onChange={(e) => set({ color: e.target.value })} />
              </label>
            </div>
            <label className="nf">
              <span>Description</span>
              <input
                value={spec.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What it is and where it’s from"
              />
            </label>

            {isSupport ? (
              <div className="row wrap">
                <NumberField label="Holds track at level" value={spec.supportLevel} onChange={(v) => set({ supportLevel: v })} />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!spec.pairedSupport}
                    onChange={(e) => set({ pairedSupport: e.target.checked || undefined, stackable: e.target.checked || undefined })}
                  />{' '}
                  Used in pairs under a D1 deck, and stackable
                </label>
                <NumberField
                  label="Joints it holds"
                  value={spec.jointsHeld ?? 1}
                  onChange={(v) => set({ jointsHeld: v && v > 1 ? v : undefined })}
                />
              </div>
            ) : (
              <>
                <h4>Paths</h4>
                <p className="muted small">
                  One path for each way a train can go through the piece. Paths sharing an end form a switch or fork; ends are named with
                  letters.
                </p>
                {paths.map((p, i) => (
                  <PathRow
                    key={i}
                    path={p}
                    index={i}
                    onChange={(np) => set({ paths: paths.map((q, j) => (j === i ? np : q)) })}
                    onRemove={() => set({ paths: paths.filter((_, j) => j !== i) })}
                  />
                ))}
                <div className="row wrap">
                  <button onClick={() => set({ paths: [...paths, { from: paths[0]?.from ?? 'a', to: nextEnd(), turn: A }] })}>
                    + Branch from the same end
                  </button>
                  <button onClick={() => set({ paths: [...paths, { from: nextEnd(), to: undefined, length: 1, start: { lanes: 1 } }] })}>
                    + Separate path
                  </button>
                </div>
                <h4>Features</h4>
                <div className="row wrap">
                  <label className="check">
                    <input type="checkbox" checked={!!spec.stop} onChange={(e) => set({ stop: e.target.checked || undefined })} /> Has a
                    stop lever
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!spec.selfSupporting}
                      onChange={(e) => set({ selfSupporting: e.target.checked || undefined })}
                    />{' '}
                    Holds itself up when raised
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!spec.approximate}
                      onChange={(e) => set({ approximate: e.target.checked || undefined })}
                    />{' '}
                    Sizes are estimates
                  </label>
                </div>
                <div className="row wrap">
                  <label className="nf">
                    <span>Ends it supports itself</span>
                    <input
                      value={(spec.supportedPorts ?? []).join(', ')}
                      placeholder="e.g. b"
                      style={{ width: 90 }}
                      onChange={(e) => set({ supportedPorts: splitList(e.target.value) })}
                    />
                  </label>
                  <label className="nf">
                    <span>Can’t join</span>
                    <input
                      value={(spec.cannotJoin ?? []).join(', ')}
                      placeholder="codes, e.g. XB"
                      style={{ width: 120 }}
                      onChange={(e) => set({ cannotJoin: splitList(e.target.value, true) })}
                    />
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="editor-side">
            <div className="card preview">
              {preview ? (
                <LayoutPreview
                  cat={preview}
                  pieces={[{ uid: 'pv', code: '__PREVIEW__', x: 0, y: 0, rot: 0, z: 0 }]}
                  size={220}
                  showPorts
                  labelPorts
                />
              ) : (
                <div className="muted small">
                  {isSupport ? 'Supports are counted, not drawn.' : 'Fix the problems below to see a preview.'}
                </div>
              )}
              {preview && <PreviewFacts cat={preview} />}
            </div>
            {errors.length > 0 && (
              <ul className="errors">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <button className="link" onClick={() => setShowGuide(!showGuide)}>
              {showGuide ? 'Hide' : 'Show'} how to measure a piece
            </button>
            {showGuide && <MeasuringGuide />}
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted small">{customPieces.length} custom piece(s) saved</span>
          <button onClick={onDone}>Cancel</button>
          <button className="primary" onClick={save} disabled={errors.length > 0}>
            {editing ? 'Save changes' : 'Add piece'}
          </button>
        </div>
      </div>
    </div>
  );
}

function splitList(v: string, upper = false): string[] | undefined {
  const xs = v
    .split(/[,\s]+/)
    .map((x) => (upper ? x.trim().toUpperCase() : x.trim()))
    .filter(Boolean);
  return xs.length ? xs : undefined;
}

function PreviewFacts({ cat }: { cat: Catalog }) {
  const { units } = useStore();
  const t = cat.get('__PREVIEW__');
  return (
    <ul className="facts small">
      {Object.entries(t.routeLength)
        .filter(([k]) => k.split('>')[0] < k.split('>')[1])
        .map(([k, len]) => {
          const [a, b] = k.split('>');
          const pa = t.ports.find((p) => p.id === a)!;
          const pb = t.ports.find((p) => p.id === b)!;
          const turn = Math.round(angleDiff(pb.dir, pa.dir + 180));
          return (
            <li key={k}>
              {a}→{b}: {fmtLen(len, units)}
              {turn ? `, turns ${turn > 0 ? 'right' : 'left'} ${Math.abs(turn)}°` : ''}
              {pb.z !== pa.z ? `, climbs ${pb.z - pa.z} level${Math.abs(pb.z - pa.z) > 1 ? 's' : ''}` : ''}
            </li>
          );
        })}
      {t.ports
        .filter((p) => !Object.values(t.routes).some((r) => r.includes(p.id)) && !(t.routes[p.id]?.length ?? 0))
        .map((p) => (
          <li key={p.id}>{p.id}: dead end</li>
        ))}
    </ul>
  );
}

export function MeasuringGuide() {
  return (
    <dl className="guide small">
      {MEASURING_GUIDE.map((g) => (
        <div key={g.title}>
          <dt>{g.title}</dt>
          <dd>{g.text}</dd>
        </div>
      ))}
    </dl>
  );
}
