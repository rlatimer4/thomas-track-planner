/// <reference lib="webworker" />
import { Catalog, generateLayouts, type AutoGenOptions, type PieceSpec, type GeometryParams } from '../core';

export interface AutoGenRequest {
  params: GeometryParams;
  customPieces: PieceSpec[];
  options: AutoGenOptions;
}

self.onmessage = (e: MessageEvent<AutoGenRequest>) => {
  try {
    const cat = new Catalog(e.data.params, e.data.customPieces);
    const results = generateLayouts(cat, e.data.options);
    (self as unknown as Worker).postMessage({ ok: true, results });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
