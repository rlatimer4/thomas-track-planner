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
    // AL climbs turning left; AR going down (entered high) turns left too
    const pieces = placeChain(cat, startPose(), [step('AL'), S, step('AR', 'rev')]).pieces;
    const v = validateLayout(cat, pieces, { owned: { AL: 1, AR: 1, S1: 1 } });
    expect(v.supports.needed[1]).toBe(2);
    expect(v.issues.some((i) => i.rule === 'supports')).toBe(true);
    const ok = validateLayout(cat, pieces, { owned: { AL: 1, AR: 1, S1: 1, RR1: 2 } });
    expect(ok.issues.some((i) => i.rule === 'supports')).toBe(false);
  });
});

describe('elevation', () => {
  const levelOf = (p: { uid: string }, all: ReturnType<typeof placeChain>['pieces'], port: string) =>
    worldPorts(cat, all.find((x) => x.uid === p.uid)!).find((q) => q.port === port)!.z;

  it('AL turns left and AR turns right while climbing, by one curve each', () => {
    const al = placeChain(cat, startPose(), [step('AL')]);
    const ar = placeChain(cat, startPose(), [step('AR')]);
    expect(Math.round(angleDiff(al.end.dir, 0))).toBe(-45);
    expect(Math.round(angleDiff(ar.end.dir, 0))).toBe(45);
    expect(al.end.z).toBe(1);
    expect(ar.end.z).toBe(1);
    // same plan shape as a C curve
    const c = placeChain(cat, startPose(), [R]);
    expect(ar.end.x).toBeCloseTo(c.end.x);
    expect(ar.end.y).toBeCloseTo(c.end.y);
  });

  it('going down a ramp turns the other way', () => {
    const down = placeChain(cat, startPose(0, 0, 0, 1), [step('AL', 'rev')]);
    expect(Math.round(angleDiff(down.end.dir, 0))).toBe(45);
    expect(down.end.z).toBe(0);
  });

  it('three ramps climb to support level 3', () => {
    const { pieces, end } = placeChain(cat, startPose(), [step('AR'), S, step('AL'), S, step('AR')]);
    expect(end.z).toBe(3);
    expect(levelOf(pieces[1], pieces, 'a')).toBe(1);
  });

  it("AR1's rock base supports its own top joint", () => {
    const withAr = placeChain(cat, startPose(), [step('AR'), S]).pieces;
    const withAr1 = placeChain(cat, startPose(), [step('AR1'), S]).pieces;
    expect(validateLayout(cat, withAr).supports.needed[1]).toBe(2);
    expect(validateLayout(cat, withAr1).supports.needed[1]).toBe(1);
  });

  it('AR1 cannot join the bucket lid', () => {
    const { pieces } = placeChain(cat, startPose(), [step('AR1'), { code: 'XB', inPort: 'a', outPort: 'b' }]);
    const v = validateLayout(cat, pieces);
    expect(v.issues.some((i) => i.rule === 'bad-joint')).toBe(true);
    const ok = validateLayout(cat, placeChain(cat, startPose(), [step('AR'), { code: 'XB', inPort: 'a', outPort: 'b' }]).pieces);
    expect(ok.issues.some((i) => i.rule === 'bad-joint')).toBe(false);
  });

  it('the lid is a 3-way fork standing one level up', () => {
    const lid = placeAt(cat, startPose(0, 0, 0, 1), 'XB', 'a');
    expect(lid.ports.every((p) => p.z === 1)).toBe(true);
    expect(cat.get('XB').routes.a.sort()).toEqual(['b', 'c', 'd']);
    // joined straight from the floor it stays on the floor, and the joint is flagged
    const fromFloor = placeChain(cat, startPose(), [S, { code: 'XB', inPort: 'a', outPort: 'b' }]).pieces;
    expect(fromFloor[1].z).toBe(0);
    expect(validateLayout(cat, fromFloor).issues.some((i) => i.rule === 'level-step')).toBe(true);
    // ramp up to it and it fits
    const ramped = placeChain(cat, startPose(), [step('AR'), { code: 'XB', inPort: 'a', outPort: 'b' }]).pieces;
    expect(validateLayout(cat, ramped).issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateLayout(cat, ramped).issues.some((i) => i.rule === 'switch-on-grade')).toBe(false);
  });

  it('the bucket is a 4-way crossing at level 4 with a tunnel at ground level', () => {
    const bucket = placeAt(cat, startPose(), 'BKT', 'e').ports;
    for (const port of ['a', 'b', 'c', 'd']) expect(bucket.find((p) => p.port === port)!.z).toBe(4);
    expect(bucket.find((p) => p.port === 'f')!.z).toBe(0);
    expect(cat.get('BKT').routes.a).toEqual(['b']);
    expect(cat.get('BKT').routes.c).toEqual(['d']);
  });

  it('the lid and the bucket are separate pieces in the inventory', () => {
    const lid = placeAt(cat, startPose(0, 0, 0, 1), 'XB', 'a').piece;
    const bucket = placeAt(cat, startPose(2000, 0), 'BKT', 'e').piece;
    const v = validateLayout(cat, [lid, bucket], { owned: { XB: 1, BKT: 1 } });
    expect(v.counts).toEqual({ XB: 1, BKT: 1 });
    expect(v.issues.some((i) => i.rule === 'shortage')).toBe(false);
  });

  it('ground track can pass through the bucket tunnel but not through its sides', () => {
    const bucket = placeAt(cat, startPose(), 'BKT', 'e').piece;
    const S1 = cat.params.straight;
    // track joined to both tunnel mouths runs through underneath
    const before = placeChain(cat, startPose(-S1, 0, 0), [S]).pieces;
    const after = placeChain(cat, startPose(S1, 0, 0), [S]).pieces;
    const v = validateLayout(cat, [bucket, ...before, ...after]);
    expect(v.issues.some((i) => i.rule === 'overlap')).toBe(false);
    expect(v.conn.links.size).toBe(4);
    // straight running across the bucket sideways at ground level
    const across = placeChain(cat, startPose(S1 / 2 + 30, -S1, 90), [S, S]).pieces;
    expect(validateLayout(cat, [bucket, ...across]).issues.some((i) => i.rule === 'overlap')).toBe(true);
    // the same at level 4 (on top) is fine only if it lines up with the lid; at level 2 it hits the bucket
    const mid = placeChain(cat, startPose(S1 / 2 + 30, -S1, 90, 2), [S, S]).pieces;
    expect(validateLayout(cat, [bucket, ...mid]).issues.some((i) => i.rule === 'overlap')).toBe(true);
  });

  it('supports of each height are matched to raised joints', () => {
    const { pieces } = placeChain(cat, startPose(), [step('AR'), S, step('AL'), S, step('AR'), S]);
    const v = validateLayout(cat, pieces, { owned: { AR: 2, AL: 1, S1: 3, RR1: 2, RS2: 2, RS3: 2, D1: 2 } });
    expect(v.supports.needed).toEqual({ 1: 2, 2: 2, 3: 2 });
    // level 3: one RS3 pair; level 2: one RS2 pair; level 1: the two RR1 piers. Decks run out for the rest.
    expect(v.supports.used).toEqual({ RS3: 2, RS2: 2, RR1: 2, D1: 2 });
    expect(v.supports.unsupported).toEqual({ 3: 1, 2: 1 });
  });

  it('supports stack to reach higher joints', () => {
    // one raised joint at each level, measured on a lone straight placed up there
    const at = (level: number) => placeChain(cat, startPose(0, 0, 0, level), [S]).pieces;
    const plan = (level: number, owned: Record<string, number>) => validateLayout(cat, at(level), { owned }).supports;
    // two RS1 stacked equal an RS2: four RS1 + a deck hold a level-2 joint (both ends of the straight need one)
    expect(plan(2, { S1: 1, RS1: 8, D1: 2 }).unsupported).toEqual({});
    expect(plan(2, { S1: 1, RS1: 8, D1: 2 }).used).toEqual({ RS1: 8, D1: 2 });
    // RS2 + RS1 reach level 3
    expect(plan(3, { S1: 1, RS2: 4, RS1: 4, D1: 2 }).used).toEqual({ RS2: 4, RS1: 4, D1: 2 });
    // RR1 rock piers hold level 1 on their own but don't stack
    expect(plan(1, { S1: 1, RR1: 2 }).used).toEqual({ RR1: 2 });
    expect(plan(2, { S1: 1, RR1: 4 }).unsupported).toEqual({ 2: 2 });
    // not tall enough
    expect(plan(4, { S1: 1, RS3: 4, D1: 2 }).unsupported).toEqual({ 4: 2 });
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

  it('HNP81 has 23 track pieces plus the junction base, lid and bucket', () => {
    const k = BUILTIN_KITS.find((x) => x.id === 'HNP81')!;
    const n = Object.entries(k.pieces)
      .filter(([c]) => cat.get(c).isTrack && !['SWB', 'XB', 'BKT', 'BS2'].includes(c))
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
