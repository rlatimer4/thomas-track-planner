import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BUILTIN_KITS,
  Catalog,
  DEFAULT_PARAMS,
  EMPTY_INVENTORY,
  inventoryTotals,
  newLayout,
  type Counts,
  type CustomPieceDef,
  type GeometryParams,
  type Inventory,
  type Kit,
  type Layout,
} from '../core';
import { localStorageAdapter, type StorageAdapter } from './platform';

export type Units = 'cm' | 'in';

export interface Space {
  width: number;
  depth: number;
}

export interface PersistedState {
  version: 2;
  /** Floor/table space the layout should fit in, mm (null = not set). */
  space: Space | null;
  params: GeometryParams;
  customPieces: CustomPieceDef[];
  customKits: Kit[];
  inventory: Inventory;
  layouts: Layout[];
  currentLayoutId?: string;
  units: Units;
}

const KEY = 'track-planner-state';

function initialState(storage: StorageAdapter): PersistedState {
  const saved = storage.load<Omit<PersistedState, 'version'> & { version: number }>(KEY);
  if (saved && (saved.version === 1 || saved.version === 2)) {
    // version 1 assumed one level of headroom; engines need two
    const params = { ...DEFAULT_PARAMS, ...saved.params };
    if (saved.version === 1) params.clearanceLevels = DEFAULT_PARAMS.clearanceLevels;
    return {
      ...saved,
      version: 2,
      space: saved.space ?? null,
      params,
      layouts: saved.layouts?.length ? saved.layouts : [newLayout('My first layout')],
    };
  }
  const first = newLayout('My first layout');
  return {
    version: 2,
    space: null,
    params: DEFAULT_PARAMS,
    customPieces: [],
    customKits: [],
    // start with the user's two sets so the app is useful immediately
    inventory: { ...EMPTY_INVENTORY, kits: { GLK80: 1, HNP81: 1 } },
    layouts: [first],
    currentLayoutId: first.id,
    units: 'cm',
  };
}

interface Store extends PersistedState {
  catalog: Catalog;
  kits: Kit[];
  owned: Counts;
  currentLayout: Layout;
  update: (fn: (s: PersistedState) => PersistedState) => void;
  saveLayout: (l: Layout) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children, storage = localStorageAdapter }: { children: ReactNode; storage?: StorageAdapter }) {
  const [state, setState] = useState<PersistedState>(() => initialState(storage));

  useEffect(() => {
    const t = setTimeout(() => storage.save(KEY, state), 250);
    return () => clearTimeout(t);
  }, [state, storage]);

  const catalog = useMemo(() => {
    try {
      return new Catalog(state.params, state.customPieces);
    } catch {
      return new Catalog(DEFAULT_PARAMS, []);
    }
  }, [state.params, state.customPieces]);
  const kits = useMemo(() => [...BUILTIN_KITS, ...state.customKits], [state.customKits]);
  const owned = useMemo(() => inventoryTotals(state.inventory, kits), [state.inventory, kits]);
  const currentLayout = state.layouts.find((l) => l.id === state.currentLayoutId) ?? state.layouts[0];

  const update = useCallback((fn: (s: PersistedState) => PersistedState) => setState(fn), []);
  const saveLayout = useCallback(
    (l: Layout) =>
      setState((s) => {
        const exists = s.layouts.some((x) => x.id === l.id);
        const next = { ...l, updatedAt: Date.now() };
        return { ...s, layouts: exists ? s.layouts.map((x) => (x.id === l.id ? next : x)) : [...s.layouts, next] };
      }),
    [],
  );

  const value: Store = { ...state, catalog, kits, owned, currentLayout, update, saveLayout };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/** Format a length in mm for display. */
export function fmtLen(mm: number, units: Units): string {
  return units === 'cm' ? `${(mm / 10).toFixed(mm < 1000 ? 1 : 0)} cm` : `${(mm / 25.4).toFixed(1)} in`;
}

export function parseLen(v: number, units: Units): number {
  return units === 'cm' ? v * 10 : v * 25.4;
}
