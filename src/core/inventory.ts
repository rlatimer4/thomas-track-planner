import type { Kit } from './kits';

/** What the user owns: whole kits plus loose pieces (which may be negative to record losses). */
export interface Inventory {
  kits: Record<string, number>;
  loose: Record<string, number>;
}

export const EMPTY_INVENTORY: Inventory = { kits: {}, loose: {} };

export type Counts = Record<string, number>;

export function addCounts(a: Counts, b: Counts, factor = 1): Counts {
  const out: Counts = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v * factor;
  return out;
}

/** Flatten an inventory into total piece counts. Unknown kits are ignored. */
export function inventoryTotals(inv: Inventory, kits: Kit[]): Counts {
  let totals: Counts = {};
  const byId = new Map(kits.map((k) => [k.id, k]));
  for (const [id, qty] of Object.entries(inv.kits)) {
    const kit = byId.get(id);
    if (kit && qty > 0) totals = addCounts(totals, kit.pieces, qty);
  }
  totals = addCounts(totals, inv.loose);
  for (const k of Object.keys(totals)) if (totals[k] <= 0) delete totals[k];
  return totals;
}

export function setKitQty(inv: Inventory, kitId: string, qty: number): Inventory {
  const kits = { ...inv.kits };
  if (qty <= 0) delete kits[kitId];
  else kits[kitId] = qty;
  return { ...inv, kits };
}

export function adjustLoose(inv: Inventory, code: string, delta: number): Inventory {
  const loose = { ...inv.loose, [code]: (inv.loose[code] ?? 0) + delta };
  if (loose[code] === 0) delete loose[code];
  return { ...inv, loose };
}

/** Pieces used beyond what is owned. */
export function shortages(used: Counts, owned: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(used)) {
    const short = v - (owned[k] ?? 0);
    if (short > 0) out[k] = short;
  }
  return out;
}
