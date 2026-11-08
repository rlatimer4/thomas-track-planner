import { describe, expect, it } from 'vitest';
import {
  BUILTIN_KITS,
  angleDiff,
  Catalog,
  analyzeRunning,
  attachPose,
  closingWords,
  computeConnectivity,
  generateLayouts,
  inventoryTotals,
  placeAt,
  placeChain,
  startPose,
  step,
  validateLayout,
  worldPorts,
  type ChainStep,
} from './index';

const cat = new Catalog();
const R: ChainStep = step('C', 'fwd');
const L: ChainStep = step('C', 'rev');
const S: ChainStep = step('S1');

function oval(straights = 2) {
  const half = [R, R, R, R, ...Array(straights).fill(S)];
  return placeChain(cat, startPose(), [...half, ...half]).pieces;
}

describe('catalog', () => {
  it('builds ports for every track piece', () => {
    for (const t of cat.trackPieces()) expect(t.ports.length).toBeGreaterThan(0);
  });

  it('8 curves make a circle', () => {
    const { end } = placeChain(cat, startPose(), Array(8).fill(R));
    expect(Math.hypot(end.x, end.y)).toBeLessThan(1e-6);
    expect(Math.round(end.dir) % 360).toBe(0);
  });

  it('switch straight leg equals a straight', () => {
    const tr = cat.get('TR');
    const s1 = cat.get('S1');
    const b = tr.ports.find((p) => p.id === 'b')!;
    const sb = s1.ports.find((p) => p.id === 'b')!;
    expect(b.x).toBeCloseTo(sb.x);
    expect(b.y).toBeCloseTo(sb.y);
  });

  it('offset switches pair back to back', () => {
    const pr = placeAt(cat, startPose(), 'PR', 'a');
    const prB = pr.ports.find((p) => p.port === 'b')!;
    const pl = placeAt(cat, prB, 'PL', 'b');
    const conn = computeConnectivity(cat, [pr.piece, pl.piece]);
    // a-ends stay open, b and c both mate
    expect(conn.open.map((p) => p.port).sort()).toEqual(['a', 'a']);
  });
});

describe('placement', () => {
  it('attachPose mates ports exactly', () => {
    const s = placeAt(cat, startPose(), 'S1', 'a');
    const b = s.ports.find((p) => p.port === 'b')!;
    const pose = attachPose(cat, b, 'C', 'b');
    const c = worldPorts(cat, { uid: 'x', code: 'C', ...pose }).find((p) => p.port === 'b')!;
    expect(c.x).toBeCloseTo(b.x);
    expect(c.y).toBeCloseTo(b.y);
    expect(angleDiff(c.dir, b.dir + 180)).toBeCloseTo(0);
  });
});

describe('validation', () => {
  it('a closed oval has no open ends or overlaps', () => {
    const v = validateLayout(cat, oval());
    expect(v.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(v.running.onCycle.size).toBeGreaterThan(0);
    expect(v.running.loopCount).toBe(1);
  });

  it('reports open ends on a broken loop', () => {
    const pieces = oval().slice(1);
    const v = validateLayout(cat, pieces);
    expect(v.issues.filter((i) => i.rule === 'open-end').length).toBe(2);
    expect(v.issues.some((i) => i.rule === 'no-loop')).toBe(true);
  });

  it('flags overlaps', () => {
    const a = placeChain(cat, startPose(), [S]).pieces;
    const b = placeChain(cat, startPose(100, 0, 90), [S]).pieces.map((p) => ({ ...p, uid: 'other' }));
    const v = validateLayout(cat, [...a, ...b]);
    expect(v.issues.some((i) => i.rule === 'overlap')).toBe(true);
  });

  it('allows a raised crossing', () => {
    const a = placeChain(cat, startPose(), [S]).pieces;
    const b = placeChain(cat, startPose(100, -100, 90, 1), [S]).pieces.map((p) => ({ ...p, uid: 'other' }));
    const v = validateLayout(cat, [...a, ...b]);
    expect(v.issues.some((i) => i.rule === 'overlap')).toBe(false);
  });

  it('flags shortages against inventory', () => {
    const v = validateLayout(cat, oval(), { owned: { C: 6, S1: 4 } });
    expect(v.issues.some((i) => i.rule === 'shortage')).toBe(true);
  });

  it('flags S-bends', () => {
    const pieces = placeChain(cat, startPose(), [R, L]).pieces;
    const v = validateLayout(cat, pieces);
    expect(v.issues.some((i) => i.rule === 'reverse-curve')).toBe(true);
  });

  it('a ramp up and down needs supports at the top', () => {
    const pieces = placeChain(cat, startPose(), [step('AL'), S, step('AL', 'rev')]).pieces;
    const v = validateLayout(cat, pieces, { owned: { AL: 2, S1: 1 } });
    expect(v.supports.needed[1]).toBe(2);
    expect(v.issues.some((i) => i.rule === 'supports')).toBe(true);
    const ok = validateLayout(cat, pieces, { owned: { AL: 2, S1: 1, RR1: 2 } });
    expect(ok.issues.some((i) => i.rule === 'supports')).toBe(false);
  });
});

describe('running analysis', () => {
  it('a spur ending in a buffer is a dead end but the loop still runs', () => {
    const half = [R, R, R, R, S, S];
    const { pieces } = placeChain(cat, startPose(), [...half, R, R, R, R, step('TR'), S]);
    const sw = pieces[pieces.length - 2];
    const c = worldPorts(cat, sw).find((p) => p.port === 'c')!;
    const buf = placeAt(cat, c, 'BS1', 'a').piece;
    const all = [...pieces, buf];
    const v = validateLayout(cat, all);
    expect(v.issues.filter((i) => i.rule === 'open-end')).toEqual([]);
    const run = analyzeRunning(cat, all);
    expect(run.loopPieces.has(buf.uid)).toBe(false);
  });
});

describe('kits and inventory', () => {
  it('every kit piece exists in the catalogue', () => {
    for (const k of BUILTIN_KITS) for (const code of Object.keys(k.pieces)) expect(cat.has(code), `${k.id}:${code}`).toBe(true);
  });

  it('GLK80 has 25 track pieces counting the bridge as two halves', () => {
    const k = BUILTIN_KITS.find((x) => x.id === 'GLK80')!;
    const track = Object.entries(k.pieces).filter(([c]) => cat.get(c).isTrack);
    const n = track.reduce((a, [c, v]) => a + (c === 'VB' ? 2 : v), 0);
    expect(n).toBe(25);
  });

  it('HNP81 has 23 track pieces plus the junction base and lid', () => {
    const k = BUILTIN_KITS.find((x) => x.id === 'HNP81')!;
    const n = Object.entries(k.pieces)
      .filter(([c]) => cat.get(c).isTrack && !['SWB', 'XB', 'BS2'].includes(c))
      .reduce((a, [, v]) => a + v, 0);
    expect(n).toBe(23);
  });

  it('totals combine kits and loose pieces', () => {
    const t = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: { S1: 2, C: -1 } }, BUILTIN_KITS);
    expect(t.S1).toBe(2 + 4 + 2);
    expect(t.C).toBe(6 + 3 - 1);
  });
});

describe('autogen', () => {
  it('finds closing curve words', () => {
    const words = closingWords(10, 45, true);
    expect(words.some((w) => w.length === 8 && w.every((t) => t === 1))).toBe(true);
  });

  it('generates valid layouts from the two kits', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 3000, seed: 42, results: 5 });
    expect(res.length).toBeGreaterThan(0);
    for (const c of res) {
      const v = validateLayout(cat, c.pieces, { owned });
      expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(v.issues.filter((i) => i.rule === 'open-end')).toEqual([]);
      expect(v.running.onCycle.size).toBeGreaterThan(0);
    }
  }, 20000);

  it('respects the space limit', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 1500, seed: 7, maxWidth: 1400, maxDepth: 900 });
    for (const c of res) {
      expect(c.width).toBeLessThanOrEqual(1400);
      expect(c.depth).toBeLessThanOrEqual(900);
    }
  }, 20000);

  it('generates a figure-8 when asked and ramps are available', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 4000, seed: 3, style: 'figure8' });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].features).toContain('Crosses over itself');
  }, 20000);
});
