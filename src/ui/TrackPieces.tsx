import { memo } from 'react';
import {
  LEVEL_COLORS,
  applyTransform,
  dirVec,
  drawOrder,
  worldPorts,
  worldSamples,
  type Catalog,
  type PlacedPiece,
  type Sample,
  type SupportJoint,
} from '../core';

function pathD(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
}

/** Offset a polyline sideways by `d` (positive = right of travel in y-down coords). */
function offset(samples: Sample[], d: number) {
  return samples.map((s, i) => {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: s.x - (dy / len) * d, y: s.y + (dx / len) * d };
  });
}

export const levelColor = (z: number) => LEVEL_COLORS[Math.max(0, Math.min(LEVEL_COLORS.length - 1, Math.round(z)))];

interface PieceProps {
  cat: Catalog;
  piece: PlacedPiece;
  selected?: boolean;
  problem?: boolean;
  dimmed?: boolean;
  labels?: boolean;
  onPointerDown?: (e: React.PointerEvent, uid: string) => void;
}

export const TrackPiece = memo(function TrackPiece({ cat, piece, selected, problem, dimmed, labels, onPointerDown }: PieceProps) {
  const t = cat.get(piece.code);
  const tw = cat.params.trackWidth;
  const paths = worldSamples(cat, piece);
  const maxZ = Math.max(...paths.flat().map((s) => s.z));
  return (
    <g
      className="piece"
      data-uid={piece.uid}
      data-code={piece.code}
      opacity={dimmed ? 0.35 : 1}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, piece.uid) : undefined}
      style={{ cursor: onPointerDown ? 'pointer' : undefined }}
    >
      {t.bodyRect && (
        <polygon
          points={[
            [t.bodyRect.x, t.bodyRect.y],
            [t.bodyRect.x + t.bodyRect.w, t.bodyRect.y],
            [t.bodyRect.x + t.bodyRect.w, t.bodyRect.y + t.bodyRect.h],
            [t.bodyRect.x, t.bodyRect.y + t.bodyRect.h],
          ]
            .map(([x, y]) => applyTransform(piece, { x, y }))
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ')}
          fill={t.bodyRect.zMax > 1 ? '#cbd5e1' : '#e2e8f0'}
          stroke="#94a3b8"
          strokeWidth={3}
        />
      )}
      {t.bodyRect?.tunnel &&
        [-1, 1].map((side) => {
          const r = t.bodyRect!;
          const y = side * r.tunnel!;
          const a = applyTransform(piece, { x: r.x, y });
          const b = applyTransform(piece, { x: r.x + r.w, y });
          // dashed edges of the tunnel opening underneath
          return <line key={side} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#64748b" strokeWidth={3} strokeDasharray="10 8" />;
        })}
      {paths
        .map((s, i) => ({ s, i }))
        // draw the lowest paths first so a tunnel shows underneath the crossing
        .sort((a, b) => a.s[0].z - b.s[0].z)
        .map(({ s, i }) => {
          const d = pathD(s);
          return (
            <g key={i}>
              {/* outline: shows selection/problems, and keeps crossings readable */}
              <path
                d={d}
                fill="none"
                stroke={selected ? '#f59e0b' : problem ? '#ef4444' : '#ffffff'}
                strokeWidth={tw + (selected || problem ? 14 : 6)}
              />
              {maxZ > 0.01 && <path d={d} fill="none" stroke={levelColor(maxZ)} strokeWidth={tw + 4} opacity={0.85} />}
              <path d={d} fill="none" stroke={t.color} strokeWidth={tw} />
              <path d={d} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={tw * 0.78} strokeDasharray="3 7" />
              <path d={pathD(offset(s, tw * 0.2))} fill="none" stroke="#e5e7eb" strokeWidth={2.5} />
              <path d={pathD(offset(s, -tw * 0.2))} fill="none" stroke="#e5e7eb" strokeWidth={2.5} />
            </g>
          );
        })}
      {t.category === 'buffer' && (
        <circle
          cx={paths[0][paths[0].length - 1].x}
          cy={paths[0][paths[0].length - 1].y}
          r={tw * 0.45}
          fill="#dc2626"
          stroke="#fff"
          strokeWidth={3}
        />
      )}
      {labels && (
        <text
          x={paths[0][Math.floor(paths[0].length / 2)].x}
          y={paths[0][Math.floor(paths[0].length / 2)].y}
          className="piece-label"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {piece.code}
        </text>
      )}
    </g>
  );
});

/** Small static drawing of a layout, for previews and catalogue thumbnails. */
export function LayoutPreview({
  cat,
  pieces,
  size = 200,
  labels = false,
  showPorts = false,
  labelPorts = false,
  supports,
  improvised = false,
}: {
  cat: Catalog;
  pieces: PlacedPiece[];
  size?: number;
  labels?: boolean;
  /** Raised joints to mark with their supports. */
  supports?: SupportJoint[];
  improvised?: boolean;
  showPorts?: boolean;
  labelPorts?: boolean;
}) {
  const pts = pieces.flatMap((p) => worldSamples(cat, p).flat());
  const pad = cat.params.trackWidth + (labelPorts ? 70 : showPorts ? 40 : 10);
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const sorted = drawOrder(cat, pieces);
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} width="100%" style={{ maxHeight: size }} role="img">
      {sorted.map((p) => (
        <TrackPiece key={p.uid} cat={cat} piece={p} labels={labels} />
      ))}
      {supports && <SupportMarks joints={supports} scale={size / Math.max(1, maxX - minX)} labels={false} improvised={improvised} />}
      {showPorts &&
        pieces.flatMap((p) =>
          worldPorts(cat, p).map((wp) => {
            const d = dirVec(wp.dir);
            return (
              <g key={`${p.uid}${wp.port}`}>
                <line x1={wp.x} y1={wp.y} x2={wp.x + d.x * 30} y2={wp.y + d.y * 30} stroke="#16a34a" strokeWidth={6} />
                <circle cx={wp.x} cy={wp.y} r={11} fill="#22c55e" stroke="#fff" strokeWidth={3} />
                {(wp.z !== 0 || labelPorts) && (
                  <text x={wp.x - d.x * 34} y={wp.y - d.y * 34 - 18} fontSize={22} textAnchor="middle" className="port-label">
                    {labelPorts ? wp.port : ''}
                    {wp.z !== 0 ? `${labelPorts ? ' ' : ''}L${wp.z}` : ''}
                  </text>
                )}
              </g>
            );
          }),
        )}
    </svg>
  );
}

/** Marker under each raised joint: the supports placed there, a grey dot if it holds itself up, red if unsupported. */
export function SupportMarks({
  joints,
  scale,
  labels = true,
  improvised = false,
}: {
  joints: SupportJoint[];
  scale: number;
  /** Text under each marker (off for small previews). */
  labels?: boolean;
  /** Joints without a support are to be propped up with something else: amber, not red. */
  improvised?: boolean;
}) {
  const r = 9 / Math.max(scale, 0.3);
  const font = 13 / Math.max(scale, 0.3);
  return (
    <g className="support-marks" pointerEvents="none">
      {joints.map((j, i) => {
        if (j.self) return <circle key={i} cx={j.x} cy={j.y} r={r * 0.55} fill="#94a3b8" stroke="#fff" strokeWidth={2 / scale} />;
        const label = j.uses
          ? Object.entries(j.uses)
              .sort(([a], [b]) => (a === 'D1' ? 1 : b === 'D1' ? -1 : a.localeCompare(b)))
              .map(([c, n]) => (n > 1 ? `${c}×${n}` : c))
              .join(' + ')
          : improvised
            ? `L${j.level}: improvise`
            : `L${j.level}: no support`;
        const color = j.uses ? '#0284c7' : improvised ? '#d97706' : '#dc2626';
        return (
          <g key={i}>
            <rect x={j.x - r} y={j.y - r} width={2 * r} height={2 * r} rx={r * 0.3} fill={color} stroke="#fff" strokeWidth={2 / scale} />
            <text x={j.x} y={j.y} fontSize={r * 1.3} textAnchor="middle" dominantBaseline="central" fill="#fff" fontWeight={700}>
              {j.uses ? j.level : '!'}
            </text>
            {labels && (
              <text
                x={j.x}
                y={j.y + r + font * 0.9}
                fontSize={font}
                textAnchor="middle"
                fill={color}
                stroke="#fff"
                strokeWidth={3 / scale}
                paintOrder="stroke"
                fontWeight={600}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
