import { useState } from 'react';
import {
  BUILTIN_KITS,
  TRACK_STANDARD,
  makePartsFile,
  mergeKits,
  mergePieces,
  parsePartsFile,
  type PieceCategory,
  type PieceSpec,
  type PieceType,
} from '../core';
import { useStore, fmtLen } from './store';
import { LayoutPreview } from './TrackPieces';
import { MeasuringGuide, PieceEditor } from './PieceEditor';
import { openTextFile, saveTextFile } from './platform';

const CATEGORY_LABEL: Record<PieceCategory, string> = {
  straight: 'Straights',
  curve: 'Curves',
  switch: 'Switches and forks',
  ramp: 'Climbing pieces',
  buffer: 'Buffers',
  crossing: 'Crossings',
  station: 'Stations',
  bridge: 'Bridges',
  support: 'Supports',
};

/** The definition part of a resolved piece (what the editor and files work with). */
export function specOf(t: PieceType): PieceSpec {
  const {
    ports: _p,
    samples: _s,
    blockers: _b,
    stockCode: _st,
    routes: _r,
    routeLength: _rl,
    bodyRect: _br,
    isTrack: _i,
    length: _l,
    ...spec
  } = t;
  void [_p, _s, _b, _st, _r, _rl, _br, _i, _l];
  return structuredClone(spec);
}

/** Short summary of how a piece changes the track: e.g. "a→b: straight ×1", "a→c: turns 60° right". */
function describePaths(t: PieceType): string[] {
  return (t.paths ?? []).map((p) => {
    const parts: string[] = [];
    if (p.turn)
      parts.push(
        `turns ${Math.abs(p.turn)}° ${p.turn > 0 ? 'right' : 'left'}${p.radius && p.radius !== 1 ? ` (radius ×${p.radius})` : ''}`,
      );
    else if (p.offset)
      parts.push(`shifts ${Math.abs(p.offset)} lane${Math.abs(p.offset) !== 1 ? 's' : ''} ${p.offset > 0 ? 'right' : 'left'}`);
    else parts.push(`straight ×${p.length ?? 1}`);
    if (p.rise) parts.push(`climbs ${p.rise}`);
    if (p.level) parts.push(`at level ${p.level}`);
    return `${p.from}→${p.to ?? 'end'}: ${parts.join(', ')}`;
  });
}

export function CatalogView() {
  const { catalog: cat, owned, units, update, customPieces, customKits } = useStore();
  const [editor, setEditor] = useState<{ spec?: PieceSpec; editing?: boolean } | null>(null);
  const [showStandard, setShowStandard] = useState(false);
  const groups = new Map<PieceCategory, PieceType[]>();
  for (const t of cat.all()) (groups.get(t.category) ?? groups.set(t.category, []).get(t.category)!).push(t);

  const removeCustom = (code: string) => {
    if (!confirm(`Delete custom piece ${code}? Layouts that use it will no longer show it.`)) return;
    update((s) => ({ ...s, customPieces: s.customPieces.filter((c) => c.code !== code) }));
  };
  const duplicate = (t: PieceType) => {
    const spec = specOf(t);
    let code = `${t.code}-2`;
    for (let i = 3; cat.has(code); i++) code = `${t.code}-${i}`;
    setEditor({ spec: { ...spec, code, name: `${spec.name} (copy)`, custom: true, stock: undefined } });
  };

  const exportParts = () =>
    saveTextFile('my-track-parts.trackparts.json', JSON.stringify(makePartsFile(customPieces, customKits), null, 2), 'Track parts', 'json');
  const importParts = async () => {
    const text = await openTextFile('Track parts', 'json');
    if (!text) return;
    try {
      const file = parsePartsFile(text);
      const builtins = new Set(
        cat
          .all()
          .filter((t) => !t.custom)
          .map((t) => t.code),
      );
      const builtinKits = new Set(BUILTIN_KITS.map((k) => k.id));
      let pieces = mergePieces(customPieces, file.pieces, builtins);
      let kits = mergeKits(customKits, file.kits, builtinKits);
      const clashes = [...pieces.conflicts.filter((c) => !builtins.has(c)), ...kits.conflicts];
      if (
        clashes.length &&
        confirm(`These already exist with different definitions: ${clashes.join(', ')}.\nReplace them with the file’s versions?`)
      ) {
        pieces = mergePieces(customPieces, file.pieces, builtins, true);
        kits = mergeKits(customKits, file.kits, builtinKits, true);
      }
      update((s) => ({ ...s, customPieces: pieces.merged, customKits: kits.merged }));
      const skippedBuiltin = pieces.conflicts.filter((c) => builtins.has(c));
      alert(
        [
          `Added ${pieces.added.length} piece(s) and ${kits.added.length} kit(s).`,
          skippedBuiltin.length ? `Skipped ${skippedBuiltin.join(', ')}: built-in codes can’t be replaced.` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (err) {
      alert(`Could not import: ${(err as Error).message}`);
    }
  };

  return (
    <div className="page">
      <section>
        <div className="page-head">
          <h2>Track catalog</h2>
          <div className="row wrap">
            <button className="primary" onClick={() => setEditor({})}>
              + New piece
            </button>
            <button
              onClick={exportParts}
              disabled={!customPieces.length && !customKits.length}
              title="Save your custom pieces and kits to a file"
            >
              Export my pieces & kits
            </button>
            <button onClick={importParts} title="Load pieces and kits from a file">
              Import pieces & kits
            </button>
          </div>
        </div>
        <p className="muted">
          Every piece is described by its paths: how each way through it turns, shifts sideways, and climbs. Green dots are the ends; any
          end joins any other end at the same level. Pieces marked <em>estimated</em> have approximate geometry.
        </p>
        <button className="link" onClick={() => setShowStandard(!showStandard)}>
          {showStandard ? 'Hide' : 'Show'} the track standard and how to measure pieces
        </button>
        {showStandard && <StandardPanel />}

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
                  {t.isTrack && (
                    <ul className="path-summary small">
                      {describePaths(t).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                  <div className="small">
                    {t.isTrack
                      ? `${t.ports.length} end${t.ports.length > 1 ? 's' : ''}${t.length ? ` · ${fmtLen(t.length, units)} long` : ''}`
                      : t.category === 'support' && t.supportLevel
                        ? `Holds track at level ${t.supportLevel}${t.jointsHeld ? `, ${t.jointsHeld} joints` : ''}`
                        : 'Support part'}
                    {' · '}you own {owned[t.stockCode] ?? 0}
                  </div>
                  <div className="row card-actions">
                    {t.custom ? (
                      <>
                        <button className="link" onClick={() => setEditor({ spec: specOf(t), editing: true })}>
                          Edit
                        </button>
                        <button className="link" onClick={() => duplicate(t)}>
                          Duplicate
                        </button>
                        <button className="link danger" onClick={() => removeCustom(t.code)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      <button className="link" onClick={() => duplicate(t)} title="Make an editable copy of this piece">
                        Copy as custom
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
      {editor && <PieceEditor initial={editor.spec} editing={editor.editing} onDone={() => setEditor(null)} />}
    </div>
  );
}

function StandardPanel() {
  const { params, units } = useStore();
  return (
    <div className="card standard">
      <h4>Track standard</h4>
      <ul className="small">
        <li>
          Curves turn {TRACK_STANDARD.curveAngle}°, so {TRACK_STANDARD.curvesPerCircle} make a circle. A switch branch is one standard
          curve.
        </li>
        <li>Offset switches (PR/PL) shift the track {TRACK_STANDARD.offsetLanes} lane sideways and end parallel.</li>
        <li>
          Climbing pieces rise {TRACK_STANDARD.climbPerPiece} level each. Engines need {params.clearanceLevels} levels of headroom.
        </li>
        <li>Turns and offsets are positive to the right of the direction of travel, negative to the left.</li>
        <li>
          Units (calibrate in Settings): S = {fmtLen(params.straight, units)} (one straight), R = {fmtLen(params.curveRadius, units)} (curve
          radius), lane = {fmtLen(params.parallelSpacing, units)}.
        </li>
      </ul>
      <h4>Measuring a piece</h4>
      <MeasuringGuide />
    </div>
  );
}
