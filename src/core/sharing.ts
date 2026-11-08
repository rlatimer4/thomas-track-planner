/**
 * Sharing custom pieces, kits and layouts as files.
 *
 * - A parts file holds custom pieces and custom kits.
 * - A layout file holds one layout plus the definitions of any custom pieces it uses, so it
 *   opens on another device that doesn't have those pieces yet.
 */
import { isLegacyCustom, fromLegacyCustom, type Catalog, type PieceSpec } from './catalog';
import type { Kit } from './kits';
import type { Layout } from './layout';

export const PARTS_FORMAT = 'track-planner-parts';
export const LAYOUT_FORMAT = 'track-planner-layout';

export interface PartsFile {
  format: typeof PARTS_FORMAT;
  version: 1;
  pieces: PieceSpec[];
  kits: Kit[];
}

export interface LayoutFile {
  format: typeof LAYOUT_FORMAT;
  version: 2;
  layout: Layout;
  /** Definitions of the custom pieces the layout uses. */
  pieces: PieceSpec[];
}

/** Stable JSON: object keys sorted at every depth, so key order doesn't matter. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** Compare definitions, ignoring the runtime-only `custom` flag. */
function canonical(spec: PieceSpec): string {
  const { custom: _c, ...rest } = spec;
  void _c;
  return stable(rest);
}

export const samePiece = (a: PieceSpec, b: PieceSpec) => canonical(a) === canonical(b);

export function makePartsFile(pieces: PieceSpec[], kits: Kit[]): PartsFile {
  return { format: PARTS_FORMAT, version: 1, pieces, kits: kits.filter((k) => k.custom) };
}

export function makeLayoutFile(layout: Layout, cat: Catalog): LayoutFile {
  const codes = new Set(layout.pieces.map((p) => p.code));
  const pieces = cat
    .all()
    .filter((t) => t.custom && codes.has(t.code))
    .map((t) => {
      // keep only the definition, not the resolved geometry
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
      return spec as PieceSpec;
    });
  return { format: LAYOUT_FORMAT, version: 2, layout, pieces };
}

const asPieces = (xs: unknown): PieceSpec[] =>
  Array.isArray(xs)
    ? xs.filter((x) => x && typeof x === 'object' && 'code' in x).map((x) => (isLegacyCustom(x) ? fromLegacyCustom(x) : (x as PieceSpec)))
    : [];

export function parsePartsFile(text: string): PartsFile {
  const data = JSON.parse(text);
  if (data?.format !== PARTS_FORMAT) throw new Error('This isn’t a track parts file.');
  return { format: PARTS_FORMAT, version: 1, pieces: asPieces(data.pieces), kits: Array.isArray(data.kits) ? data.kits : [] };
}

/** Accepts current layout files, older ones without piece definitions, and bare layouts. */
export function parseLayoutFile(text: string): LayoutFile {
  const data = JSON.parse(text);
  const layout: Layout | undefined = data?.layout ?? (Array.isArray(data?.pieces) && data?.id ? data : undefined);
  if (!layout || !Array.isArray(layout.pieces)) throw new Error('This file has no layout in it.');
  return { format: LAYOUT_FORMAT, version: 2, layout, pieces: data.layout ? asPieces(data.pieces) : [] };
}

export interface MergeResult<T> {
  merged: T[];
  added: string[];
  /** Same code, different definition. */
  conflicts: string[];
  unchanged: string[];
}

/**
 * Merge incoming custom pieces into the existing ones. Codes that already exist with a
 * different definition are conflicts: replaced if `replace` is set, otherwise kept as they are.
 * Built-in codes can't be overridden.
 */
export function mergePieces(
  existing: PieceSpec[],
  incoming: PieceSpec[],
  builtinCodes: Set<string>,
  replace = false,
): MergeResult<PieceSpec> {
  const byCode = new Map(existing.map((p) => [p.code, p]));
  const out: MergeResult<PieceSpec> = { merged: [], added: [], conflicts: [], unchanged: [] };
  for (const raw of incoming) {
    const p = { ...raw, custom: true };
    if (builtinCodes.has(p.code)) {
      out.conflicts.push(p.code);
      continue;
    }
    const cur = byCode.get(p.code);
    if (!cur) {
      byCode.set(p.code, p);
      out.added.push(p.code);
    } else if (samePiece(cur, p)) out.unchanged.push(p.code);
    else {
      out.conflicts.push(p.code);
      if (replace) byCode.set(p.code, p);
    }
  }
  out.merged = [...byCode.values()];
  return out;
}

export function mergeKits(existing: Kit[], incoming: Kit[], builtinIds: Set<string>, replace = false): MergeResult<Kit> {
  const byId = new Map(existing.map((k) => [k.id, k]));
  const out: MergeResult<Kit> = { merged: [], added: [], conflicts: [], unchanged: [] };
  for (const raw of incoming) {
    const k = { ...raw, custom: true };
    if (builtinIds.has(k.id)) {
      out.unchanged.push(k.id);
      continue;
    }
    const cur = byId.get(k.id);
    if (!cur) {
      byId.set(k.id, k);
      out.added.push(k.id);
    } else if (JSON.stringify(cur.pieces) === JSON.stringify(k.pieces) && cur.name === k.name) out.unchanged.push(k.id);
    else {
      out.conflicts.push(k.id);
      if (replace) byId.set(k.id, k);
    }
  }
  out.merged = [...byId.values()];
  return out;
}
