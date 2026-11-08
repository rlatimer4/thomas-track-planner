import type { Catalog } from './catalog';
import { layoutBounds, worldSamples, type PlacedPiece } from './layout';

export const LEVEL_COLORS = ['#475569', '#2563eb', '#7c3aed', '#c026d3', '#db2777'];

/** Stand-alone SVG drawing of a layout (for export/printing and previews). */
export function layoutToSvg(cat: Catalog, pieces: PlacedPiece[], opts: { labels?: boolean; margin?: number } = {}): string {
  const b = layoutBounds(cat, pieces);
  const m = opts.margin ?? 40;
  const w = Math.max(1, b.width + 2 * m);
  const h = Math.max(1, b.height + 2 * m);
  const tw = cat.params.trackWidth;
  const sorted = [...pieces].sort((a, b2) => a.z - b2.z);
  const parts: string[] = [];
  for (const p of sorted) {
    const t = cat.get(p.code);
    for (const path of worldSamples(cat, p)) {
      const d = path.map((s, i) => `${i ? 'L' : 'M'}${(s.x - b.minX + m).toFixed(1)},${(s.y - b.minY + m).toFixed(1)}`).join('');
      const z = Math.max(0, Math.round(Math.max(...path.map((s) => s.z))));
      parts.push(`<path d="${d}" fill="none" stroke="#fff" stroke-width="${tw + 6}" stroke-linecap="butt"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${LEVEL_COLORS[Math.min(z, LEVEL_COLORS.length - 1)]}" stroke-width="${tw}" stroke-linecap="butt" opacity="0.9"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${t.color}" stroke-width="${tw * 0.35}" stroke-dasharray="4 6"/>`);
    }
    if (opts.labels !== false && t.isTrack) {
      const mid = worldSamples(cat, p)[0];
      const s = mid[Math.floor(mid.length / 2)];
      parts.push(
        `<text x="${(s.x - b.minX + m).toFixed(1)}" y="${(s.y - b.minY + m + 5).toFixed(1)}" font-size="16" font-family="sans-serif" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${p.code}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${(w / 2).toFixed(0)}" height="${(h / 2).toFixed(0)}"><rect width="100%" height="100%" fill="#f8fafc"/>${parts.join('')}</svg>`;
}
