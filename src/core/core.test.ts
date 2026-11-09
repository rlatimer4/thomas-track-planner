import { describe, expect, it } from 'vitest';
import {
  BUILTIN_KITS,
  bridgeCrossings,
  checkSpec,
  fromLegacyCustom,
  makeLayoutFile,
  mergePieces,
  newLayout,
  parseLayoutFile,
  parsePartsFile,
  makePartsFile,
  type PieceSpec,
  DEFAULT_PARAMS,
  operationalChecks,
  type Connectivity,
  type PlacedPiece,
  angleDiff,
  Catalog,
  analyzeRunning,
  attachPose,
  closingWords,
  computeConnectivity,
  countLoops,
  drawOrder,
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
  const half = [R, R, R, ...Array(straights).fill(S)];
  return placeChain(cat, startPose(), [...half, ...half]).pieces;
}

describe('catalog', () => {
  it('builds ports for every track piece', () => {
    for (const t of cat.trackPieces()) expect(t.ports.length).toBeGreaterThan(0);
  });

  it('6 standard curves (60° each) make a circle', () => {
    const { end } = placeChain(cat, startPose(), Array(6).fill(R));
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
    const one = new Catalog({ ...DEFAULT_PARAMS, engineCount: 1 });
    const v = validateLayout(one, oval());
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

  it('allows a raised crossing with two levels of headroom', () => {
    const a = placeChain(cat, startPose(), [S]).pieces;
    const over = (level: number) => placeChain(cat, startPose(100, -100, 90, level), [S]).pieces.map((p) => ({ ...p, uid: 'other' }));
    const two = validateLayout(cat, [...a, ...over(2)]);
    expect(two.issues.some((i) => i.rule === 'overlap' || i.rule === 'headroom')).toBe(false);
    const one = validateLayout(cat, [...a, ...over(1)]);
    expect(one.issues.some((i) => i.rule === 'overlap')).toBe(false);
    expect(one.issues.some((i) => i.rule === 'headroom')).toBe(true);
  });

  it('flags shortages against inventory', () => {
    const v = validateLayout(cat, oval(), { owned: { C: 5, S1: 4 } });
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
    worldPorts(
      cat,
      all.find((x) => x.uid === p.uid)!,
    ).find((q) => q.port === port)!.z;

  it('AL turns left and AR turns right while climbing, by one curve each', () => {
    const al = placeChain(cat, startPose(), [step('AL')]);
    const ar = placeChain(cat, startPose(), [step('AR')]);
    expect(Math.round(angleDiff(al.end.dir, 0))).toBe(-60);
    expect(Math.round(angleDiff(ar.end.dir, 0))).toBe(60);
    expect(al.end.z).toBe(1);
    expect(ar.end.z).toBe(1);
    // same plan shape as a C curve
    const c = placeChain(cat, startPose(), [R]);
    expect(ar.end.x).toBeCloseTo(c.end.x);
    expect(ar.end.y).toBeCloseTo(c.end.y);
  });

  it('going down a ramp turns the other way', () => {
    const down = placeChain(cat, startPose(0, 0, 0, 1), [step('AL', 'rev')]);
    expect(Math.round(angleDiff(down.end.dir, 0))).toBe(60);
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

  it('the bucket is a 4-way crossing at level 4 and has no track of its own underneath', () => {
    const t = cat.get('BKT');
    expect(t.ports.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const p of t.ports) expect(p.z, p.id).toBe(4);
    expect(t.routes.a).toEqual(['b']);
    expect(t.routes.c).toEqual(['d']);
    // attached by a top corner, it still stands on the floor
    expect(placeAt(cat, startPose(), 'BKT', 'a').piece.z).toBe(0);
  });

  it('the bucket tracks run corner to corner 120° apart, and the tunnel bisects that angle', () => {
    const t = cat.get('BKT');
    const port = (id: string) => t.ports.find((p) => p.id === id)!;
    const S1 = cat.params.straight;
    const half = (Math.sqrt(3) / 4) * S1;
    const short = S1 / 2;
    // ends sit on the four corners of the footprint (the tunnel runs along x, across the short side)
    for (const [id, x, y] of [
      ['a', 0, -half],
      ['b', short, half],
      ['c', 0, half],
      ['d', short, -half],
    ] as const) {
      expect(port(id).x, id).toBeCloseTo(x);
      expect(port(id).y, id).toBeCloseTo(y);
    }
    // each top track is as long as a standard straight
    expect(Math.hypot(port('b').x - port('a').x, port('b').y - port('a').y)).toBeCloseTo(S1);
    expect(Math.hypot(port('d').x - port('c').x, port('d').y - port('c').y)).toBeCloseTo(S1);
    // the top tracks are 120° apart and the tunnel (heading 0) bisects that angle
    const ab = port('b').dir;
    const cd = port('d').dir;
    expect(Math.abs(angleDiff(ab, cd))).toBeCloseTo(120);
    expect(Math.abs(angleDiff(ab, 0))).toBeCloseTo(60);
    expect(Math.abs(angleDiff(cd, 0))).toBeCloseTo(60);
    // the solid body is the √3 : 1 footprint
    expect(t.bodyRect!.h / t.bodyRect!.w).toBeGreaterThan(1.5);
  });

  it('a bucket standing over track as a tunnel has no open ends, is not disconnected and is not a bridge', () => {
    const S1 = cat.params.straight;
    const track = placeChain(cat, startPose(-S1 / 4, 0, 0), [S]).pieces;
    const bucket: PlacedPiece = { uid: 'bucket', code: 'BKT', x: 0, y: 0, rot: 0, z: 0 };
    const v = validateLayout(cat, [...track, bucket], { owned: { S1: 1, BKT: 1 } });
    expect(v.issues.filter((i) => i.uids.includes('bucket')).map((i) => i.rule)).toEqual([]);
    expect(v.counts.BKT).toBe(1);
    expect(bridgeCrossings(cat, [...track, bucket])).toHaveLength(0);
    // build onto its top and the rest of that top track counts as open again
    const onTop = placeAt(
      cat,
      worldPorts(cat, bucket).find((p) => p.port === 'a')!,
      'S1',
      'a',
    ).piece;
    const v2 = validateLayout(cat, [...track, bucket, onTop]);
    expect(v2.issues.some((i) => i.rule === 'open-end' && i.uids.includes('bucket'))).toBe(true);
  });

  it('pieces draw lowest first by the highest point they reach, so the bucket covers a ramp beside it', () => {
    const bucket: PlacedPiece = { uid: 'bucket', code: 'BKT', x: 0, y: 0, rot: 0, z: 0 };
    const ramp: PlacedPiece = { uid: 'ramp', code: 'AL', x: -100, y: 0, rot: 0, z: 0 };
    const floor: PlacedPiece = { uid: 'floor', code: 'S1', x: -300, y: 0, rot: 0, z: 0 };
    // added after the bucket, and on the same base, the ramp and the straight still draw underneath it
    expect(drawOrder(cat, [bucket, ramp, floor]).map((p) => p.uid)).toEqual(['floor', 'ramp', 'bucket']);
  });

  it('the lid and the bucket are separate pieces in the inventory', () => {
    const lid = placeAt(cat, startPose(0, 0, 0, 1), 'XB', 'a').piece;
    const bucket = placeAt(cat, startPose(2000, 0), 'BKT', 'a').piece;
    const v = validateLayout(cat, [lid, bucket], { owned: { XB: 1, BKT: 1 } });
    expect(v.counts).toEqual({ XB: 1, BKT: 1 });
    expect(v.issues.some((i) => i.rule === 'shortage')).toBe(false);
  });

  it('the bucket stands over two tracks side by side, but not over track outside its tunnel', () => {
    const bucket: PlacedPiece = { uid: 'bucket', code: 'BKT', x: 0, y: 0, rot: 0, z: 0 };
    const S1 = cat.params.straight;
    const lane = cat.params.parallelSpacing;
    const under = (y: number) => placeChain(cat, startPose(-S1 / 4, y, 0), [S]).pieces;
    const overlaps = (pieces: PlacedPiece[]) => validateLayout(cat, [bucket, ...pieces]).issues.some((i) => i.rule === 'overlap');
    // one track through the middle, or two tracks one lane apart, fit underneath
    expect(overlaps(under(0))).toBe(false);
    expect(overlaps([...under(-lane / 2), ...under(lane / 2)])).toBe(false);
    // a third track, or a track a full lane off-centre, hits the tunnel's side walls
    expect(overlaps([...under(-lane), ...under(0), ...under(lane)])).toBe(true);
    expect(overlaps(under(lane))).toBe(true);
    // track running across the bucket sideways hits it at ground level and at level 2
    expect(overlaps(placeChain(cat, startPose(S1 / 4, -S1, 90), [S, S]).pieces)).toBe(true);
    expect(overlaps(placeChain(cat, startPose(S1 / 4, -S1, 90, 2), [S, S]).pieces)).toBe(true);
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

/** Wire pieces together by hand (geometry ignored) to test running logic. */
function wired(codes: Record<string, string>, joins: [string, string][]): { pieces: PlacedPiece[]; conn: Connectivity } {
  const pieces = Object.entries(codes).map(([uid, code]) => ({ uid, code, x: 0, y: 0, rot: 0, z: 0 }));
  const links = new Map<string, { uid: string; port: string }>();
  for (const [a, b] of joins) {
    const [ua, pa] = a.split('.');
    const [ub, pb] = b.split('.');
    links.set(`${ua}:${pa}`, { uid: ub, port: pb });
    links.set(`${ub}:${pb}`, { uid: ua, port: pa });
  }
  return { pieces, conn: { links, open: [], ports: [] } };
}
const rules = (cat2: Catalog, w: ReturnType<typeof wired>) => operationalChecks(cat2, w.pieces, w.conn);
const catWith = (over: Partial<typeof DEFAULT_PARAMS>) => new Catalog({ ...DEFAULT_PARAMS, ...over });

// an oval: ring of four straights
const ring = (ids: string[]) => ids.map((id, i) => [`${id}.b`, `${ids[(i + 1) % ids.length]}.a`] as [string, string]);

describe('operating checks', () => {
  it('1. trains on an oval can’t turn around; a dogbone with two balloons can', () => {
    const oval1 = wired({ a: 'S1', b: 'S1', c: 'S1', d: 'S1' }, ring(['a', 'b', 'c', 'd']));
    const r1 = rules(cat, oval1).find((i) => i.rule === 'direction-change')!;
    expect(r1.message).toMatch(/can’t turn around/);
    // stem s between switches w1 and w2, each with a balloon (x1, x2)
    const dogbone = wired({ s: 'S1', w1: 'TR', w2: 'TR', x1: 'C', x2: 'C' }, [
      ['w1.a', 's.a'],
      ['s.b', 'w2.a'],
      ['w1.b', 'x1.a'],
      ['x1.b', 'w1.c'],
      ['w2.b', 'x2.a'],
      ['x2.b', 'w2.c'],
    ]);
    const r2 = rules(cat, dogbone).find((i) => i.rule === 'direction-change')!;
    expect(r2.message).toMatch(/can turn around/);
    expect(r2.uids).toContain('s');
    // with two engines, turning trains can meet head-on
    expect(rules(cat, dogbone).some((i) => i.rule === 'head-on')).toBe(true);
  });

  it('2. a switch facing the wrong way leaves track unreachable', () => {
    // oval with switch w on it; spur: w.c -> t -> w2.b, w2.a -> buffer z1; w2.c -> p -> buffer z2
    // trains reach z1 through w2 (trailing), but p is only reachable by reversing at z1
    const w = wired({ a: 'S1', b: 'S1', c: 'S1', w: 'TR', t: 'S1', w2: 'TL', z1: 'BS1', p: 'S1', z2: 'BS1' }, [
      ...ring(['a', 'b', 'c']).slice(0, 2),
      ['c.b', 'w.a'],
      ['w.b', 'a.a'],
      ['w.c', 't.a'],
      ['t.b', 'w2.b'],
      ['w2.a', 'z1.a'],
      ['w2.c', 'p.a'],
      ['p.b', 'z2.a'],
    ]);
    const u = rules(cat, w).find((i) => i.rule === 'unreachable');
    expect(u?.uids.sort()).toEqual(['p', 'z2']);
  });

  it('3. junctions are flagged as conflict points with two engines, not with one', () => {
    const passing = wired({ a: 'S1', b: 'S1', c: 'S1', w1: 'TR', w2: 'TL', m1: 'S1', m2: 'S1', l1: 'S1', l2: 'S1' }, [
      ['a.b', 'b.a'],
      ['b.b', 'c.a'],
      ['c.b', 'w1.a'],
      ['w1.b', 'm1.a'],
      ['m1.b', 'm2.a'],
      ['m2.b', 'w2.b'],
      ['w1.c', 'l1.a'],
      ['l1.b', 'l2.a'],
      ['l2.b', 'w2.c'],
      ['w2.a', 'a.a'],
    ]);
    const two = rules(cat, passing);
    expect(two.find((i) => i.rule === 'conflict-points')?.uids.sort()).toEqual(['w1', 'w2']);
    // a long enough passing loop gives the second engine somewhere to wait
    expect(two.some((i) => i.rule === 'capacity')).toBe(false);
    expect(rules(catWith({ engineCount: 1 }), passing).some((i) => i.rule === 'conflict-points')).toBe(false);
    // a plain oval has nowhere to pass
    const oval1 = wired({ a: 'S1', b: 'S1', c: 'S1', d: 'S1' }, ring(['a', 'b', 'c', 'd']));
    expect(rules(cat, oval1).some((i) => i.rule === 'capacity')).toBe(true);
  });

  it('4. sidings and passing loops must hold a train', () => {
    const siding = (n: number) => {
      const codes: Record<string, string> = { a: 'S1', b: 'S1', c: 'S1', w: 'TR', z: 'BS1' };
      const joins: [string, string][] = [...ring(['a', 'b', 'c']).slice(0, 2), ['c.b', 'w.a'], ['w.b', 'a.a']];
      let prev = 'w.c';
      for (let i = 0; i < n; i++) {
        codes[`s${i}`] = 'S1';
        joins.push([prev, `s${i}.a`]);
        prev = `s${i}.b`;
      }
      joins.push([prev, 'z.a']);
      return wired(codes, joins);
    };
    expect(rules(cat, siding(1)).some((i) => i.rule === 'short-siding')).toBe(true); // 21 cm < 25 cm
    expect(rules(cat, siding(2)).some((i) => i.rule === 'short-siding')).toBe(false);
    // offset switches back to back: a passing place with no room at all
    const mini = wired({ a: 'S1', b: 'S1', c: 'S1', pr: 'PR', pl: 'PL' }, [
      ['a.b', 'b.a'],
      ['b.b', 'c.a'],
      ['c.b', 'pr.a'],
      ['pr.b', 'pl.b'],
      ['pr.c', 'pl.c'],
      ['pl.a', 'a.a'],
    ]);
    expect(rules(cat, mini).some((i) => i.rule === 'short-passing-loop')).toBe(true);
  });

  it('5. stop pieces on a ramp or next to a junction are flagged', () => {
    const onRamp = wired({ r: 'AL', s: 'CS2', t: 'S1' }, [
      ['r.b', 's.a'],
      ['s.b', 't.a'],
    ]);
    expect(rules(cat, onRamp).some((i) => i.rule === 'stop-on-grade')).toBe(true);
    const byJunction = wired({ a: 'S1', b: 'S1', w: 'TR', s: 'CS2' }, [
      ['a.b', 'b.a'],
      ['b.b', 'w.a'],
      ['w.b', 's.a'],
      ['s.b', 'a.a'],
    ]);
    expect(rules(cat, byJunction).some((i) => i.rule === 'stop-near-junction')).toBe(true);
  });

  it('6. parallel tracks closer than an engine is wide are flagged', () => {
    const a = placeChain(cat, startPose(), [S]).pieces;
    const near = placeChain(cat, startPose(0, 50), [S]).pieces;
    const far = placeChain(cat, startPose(0, 80), [S]).pieces;
    expect(validateLayout(cat, [...a, ...near]).issues.some((i) => i.rule === 'too-close')).toBe(true);
    expect(validateLayout(cat, [...a, ...far]).issues.some((i) => i.rule === 'too-close')).toBe(false);
  });

  it('8. pieces not joined to the main layout are flagged', () => {
    const w = wired({ a: 'S1', b: 'S1', c: 'S1', d: 'S1', lone: 'S1' }, ring(['a', 'b', 'c', 'd']));
    expect(rules(cat, w).find((i) => i.rule === 'disconnected')?.uids).toEqual(['lone']);
  });

  it('switches that must be set are flagged when trailing derails', () => {
    const passing = wired({ a: 'S1', w1: 'TR', w2: 'TL', l1: 'S1', l2: 'S1', m: 'S1' }, [
      ['a.b', 'w1.a'],
      ['w1.b', 'm.a'],
      ['m.b', 'w2.b'],
      ['w1.c', 'l1.a'],
      ['l1.b', 'l2.a'],
      ['l2.b', 'w2.c'],
      ['w2.a', 'a.a'],
    ]);
    expect(rules(cat, passing).some((i) => i.rule === 'trailing-switch')).toBe(false);
    expect(rules(catWith({ trailingPushThrough: 0 }), passing).some((i) => i.rule === 'trailing-switch')).toBe(true);
  });

  it('footprint is checked against the space', () => {
    const v = validateLayout(cat, oval(), { space: { width: 500, depth: 900 } });
    const f = v.issues.find((i) => i.rule === 'footprint');
    expect(f?.message).toMatch(/turn it 90°/);
    expect(validateLayout(cat, oval(), { space: { width: 2000, depth: 2000 } }).issues.some((i) => i.rule === 'footprint')).toBe(false);
  });
});

describe('running analysis', () => {
  it('a spur ending in a buffer is a dead end but the loop still runs', () => {
    const half = [R, R, R, S, S];
    const { pieces } = placeChain(cat, startPose(), [...half, R, R, R, step('TR'), S]);
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

  it('GLK80 has 23 track pieces, and the bridge is a support', () => {
    const k = BUILTIN_KITS.find((x) => x.id === 'GLK80')!;
    const track = Object.entries(k.pieces).filter(([c]) => cat.get(c).isTrack);
    const n = track.reduce((a, [, v]) => a + v, 0);
    expect(n).toBe(23);
    expect(cat.get('VB').category).toBe('support');
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

describe('earlier track generations', () => {
  const closes = (code: string, n: number) => {
    const { end } = placeChain(cat, startPose(), Array(n).fill(step(code)));
    expect(Math.hypot(end.x, end.y), code).toBeLessThan(1e-6);
    expect(Math.round(end.dir) % 360, code).toBe(0);
  };

  it('45° curves: 8 make a circle', () => {
    for (const code of ['CS', 'CL', 'C1', 'LC-09']) closes(code, 8);
  });

  it('the 2009 half curve C2 is half a C1: 16 make a circle', () => {
    closes('C2', 16);
  });

  it('CL runs outside CS, and each switch branches on its own curve', () => {
    expect(cat.get('CL').ports.find((p) => p.id === 'b')!.y).toBeGreaterThan(cat.get('CS').ports.find((p) => p.id === 'b')!.y);
    const branch = (sw: string) => cat.get(sw).ports.find((p) => p.id === 'c')!;
    const end = (c: string) => cat.get(c).ports.find((p) => p.id === 'b')!;
    for (const [sw, curve] of [
      ['TRS', 'CS'],
      ['TRL', 'CL'],
    ]) {
      expect(branch(sw).x, sw).toBeCloseTo(end(curve).x);
      expect(branch(sw).y, sw).toBeCloseTo(end(curve).y);
    }
    // left switches mirror the right ones
    expect(branch('TLS').y).toBeCloseTo(-branch('TRS').y);
  });

  it('Y switches split evenly left and right', () => {
    for (const code of ['YS', 'YL', 'Y', 'Y2']) {
      const [b, c] = ['b', 'c'].map((id) => cat.get(code).ports.find((p) => p.id === id)!);
      expect(b.y, code).toBeCloseTo(-c.y);
      expect(b.x, code).toBeCloseTo(c.x);
    }
  });

  it('short straights are fractions of S1', () => {
    const len = (code: string) => cat.get(code).ports.find((p) => p.id === 'b')!.x;
    expect(len('S2') / len('S1')).toBeCloseTo(0.5);
    expect(len('S4') / len('S1')).toBeCloseTo(0.25);
    expect(len('S8') / len('S1')).toBeCloseTo(0.125);
  });

  it('ramps and climbing curves rise one level', () => {
    for (const code of ['E1', 'ES1', 'ES7', 'EL', 'ER', 'ECR', 'EC3', 'AL-09']) {
      const b = cat.get(code).ports.find((p) => p.id === 'b')!;
      expect(b.z, code).toBe(1);
    }
  });

  it('every kit lists at least one track piece and kit ids are unique', () => {
    const ids = BUILTIN_KITS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of BUILTIN_KITS)
      expect(
        Object.keys(k.pieces).some((c) => cat.get(c).isTrack),
        k.id,
      ).toBe(true);
  });

  it('original-generation pieces whose printed code clashes with later track end in -09', () => {
    const old = cat.all().filter((t) => !t.custom && t.description.includes('2009–2013'));
    expect(old.length).toBeGreaterThan(0);
    for (const t of old) if (['S1', 'S2', 'S4', 'T2', 'E2'].includes(t.code.replace(/-09$/, ''))) expect(t.code).toMatch(/-09$/);
  });

  it('a raised joint can stand on a riser block', () => {
    const span = placeChain(cat, startPose(0, 0, 0, 1), [S]).pieces;
    const v = validateLayout(cat, span, { owned: { S1: 1, RB1: 2 } });
    expect(v.supports.unsupported).toEqual({});
    expect(v.supports.used).toEqual({ RB1: 2 });
  });
});

describe('autogen', () => {
  it('finds closing curve words', () => {
    const words = closingWords(8, 60, true);
    expect(words.some((w) => w.length === 6 && w.every((t) => t === 1))).toBe(true);
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

  it('counts a bridge crossing wherever track passes over track with headroom, whichever piece is on top', () => {
    const S1 = cat.params.straight;
    const flat = placeChain(cat, startPose(-S1, 0, 0), [S, S]).pieces;
    const over = (level: number) => placeChain(cat, startPose(0, -S1, 90, level), [S, S]).pieces;
    expect(bridgeCrossings(cat, [...flat, ...over(2)])).toHaveLength(1);
    // same crossing with the pieces listed the other way round
    expect(bridgeCrossings(cat, [...over(2), ...flat])).toHaveLength(1);
    // one level isn't enough headroom, so it isn't a bridge
    expect(bridgeCrossings(cat, [...flat, ...over(1)])).toHaveLength(0);
    expect(bridgeCrossings(cat, oval())).toHaveLength(0);
  });

  it('prefers layouts with bridges and height', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 3000, seed: 11, results: 5 });
    expect(res.length).toBeGreaterThan(0);
    expect(res.some((c) => c.breakdown['Bridge crossings'] > 0)).toBe(true);
    expect(res[0].breakdown['Height']).toBeGreaterThan(0);
    for (const c of res) expect(c.breakdown['Compact']).toBeGreaterThan(0);
  }, 20000);

  it('uses more of the pieces when asked to use all of them', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const avg = (useAll: boolean) => {
      const res = generateLayouts(cat, { owned, timeBudgetMs: 2500, seed: 5, results: 4, useAll });
      return res.reduce((a, c) => a + c.pieces.length, 0) / Math.max(1, res.length);
    };
    expect(avg(true)).toBeGreaterThan(avg(false));
  }, 20000);

  it('climbs to level 4 and runs over the top of the bucket, and uses the lid forks as track', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 3000, seed: 1, results: 8, useAll: true });
    const features = res.flatMap((c) => c.features);
    expect(features).toContain('Runs over the top of the track bucket');
    expect(features.some((f) => /Balloon loop on the bucket lid|Second loop from the bucket lid fork/.test(f))).toBe(true);
    for (const c of res) {
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
      // over the bucket means a bucket top track is joined at both ends
      if (c.features.includes('Runs over the top of the track bucket')) {
        const b = c.pieces.find((p) => p.code === 'BKT')!;
        const conn = computeConnectivity(cat, c.pieces);
        expect(['a', 'b', 'c', 'd'].filter((q) => conn.links.has(`${b.uid}:${q}`))).toHaveLength(2);
      }
    }
  }, 20000);

  it('can use the bucket, the lid and a second loop', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 3000, seed: 2, results: 8, useAll: true });
    const features = res.flatMap((c) => c.features);
    const uses = (code: string) => res.some((c) => c.pieces.some((p) => p.code === code));
    expect(uses('BKT') || uses('XB') || features.includes('Second loop through the middle')).toBe(true);
    for (const c of res) expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
  }, 20000);

  it('counts independent loops, treating separate routes through one piece separately', () => {
    expect(countLoops(cat, oval())).toBe(1);
    // an oval with an offset-switch double-track section is 2 loops
    const ring = placeChain(cat, startPose(), [step('PR'), S, step('PL', 'rev'), R, R, R, S, S, S, R, R, R]).pieces;
    const lane = placeChain(
      cat,
      worldPorts(cat, ring[0]).find((p) => p.port === 'c')!,
      [S],
    ).pieces;
    const all = [...ring, ...lane];
    expect(validateLayout(cat, all).issues.filter((i) => i.rule === 'open-end')).toEqual([]);
    expect(countLoops(cat, all)).toBe(2);
  });

  it('builds layouts with several loops when asked for many loops', () => {
    const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
    const res = generateLayouts(cat, { owned, timeBudgetMs: 3000, seed: 1, results: 4, manyLoops: true });
    expect(res.length).toBeGreaterThan(0);
    expect(Math.max(...res.map((c) => countLoops(cat, c.pieces)))).toBeGreaterThanOrEqual(3);
    for (const c of res) expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
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

describe('piece definitions (paths)', () => {
  const P = DEFAULT_PARAMS;
  it('an offset path ends one lane over, facing the same way', () => {
    const c = cat.get('PR').ports.find((q) => q.id === 'c')!;
    expect(c.x).toBeCloseTo(P.straight);
    expect(c.y).toBeCloseTo(P.parallelSpacing);
    expect(c.dir).toBeCloseTo(0);
  });

  it('a custom 60° crossing is built from two straight paths', () => {
    const spec: PieceSpec = {
      code: 'X60',
      name: '60° crossing',
      category: 'crossing',
      description: '',
      color: '#000',
      paths: [
        { from: 'a', to: 'b' },
        { from: 'c', to: 'd', start: { along: 0.25, side: -0.433, heading: 60 } },
      ],
    };
    expect(checkSpec(spec)).toEqual([]);
    const t = new Catalog(DEFAULT_PARAMS, [spec]).get('X60');
    expect(t.ports.map((q) => q.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(t.routes.a).toEqual(['b']);
    expect(t.routes.c).toEqual(['d']);
  });

  it('flags paths that share an end but don’t meet there', () => {
    const bad: PieceSpec = {
      code: 'BAD',
      name: 'Bad',
      category: 'switch',
      description: '',
      color: '#000',
      paths: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b', turn: 60 },
      ],
    };
    expect(checkSpec(bad).some((e) => e.includes('End "b"'))).toBe(true);
    expect(checkSpec({ ...bad, paths: [{ from: 'a', to: 'b', turn: 60, offset: 1 }] }).some((e) => e.includes('turn or an offset'))).toBe(
      true,
    );
  });

  it('climbing pieces can start raised and climb several levels', () => {
    const spec: PieceSpec = {
      code: 'UP2',
      name: 'Big climb',
      category: 'ramp',
      description: '',
      color: '#000',
      paths: [{ from: 'a', to: 'b', length: 2, level: 1, rise: 2 }],
    };
    const t = new Catalog(DEFAULT_PARAMS, [spec]).get('UP2');
    expect(t.ports.find((q) => q.id === 'a')!.z).toBe(1);
    expect(t.ports.find((q) => q.id === 'b')!.z).toBe(3);
    expect(t.ports.find((q) => q.id === 'b')!.x).toBeCloseTo(2 * P.straight);
  });

  it('old custom pieces are converted to paths', () => {
    const spec = fromLegacyCustom({ code: 'C45', name: '45° curve', kind: 'curve', angle: 45 });
    expect(spec.paths).toEqual([{ from: 'a', to: 'b', turn: 45, radius: 1 }]);
    const c = new Catalog(DEFAULT_PARAMS, [{ code: 'C45', name: '45° curve', kind: 'curve', angle: 45 }]);
    expect(c.has('C45')).toBe(true);
  });

  it('the bridge holds both ends of a straight two levels up', () => {
    const span = placeChain(cat, startPose(0, 0, 0, 2), [S]).pieces;
    const v = validateLayout(cat, span, { owned: { S1: 1, VB: 1 } });
    expect(v.supports.unsupported).toEqual({});
    expect(v.supports.used).toEqual({ VB: 1 });
  });
});

describe('sharing', () => {
  const mine: PieceSpec = {
    code: 'MY2',
    name: 'Half straight',
    category: 'straight',
    description: '',
    color: '#000',
    paths: [{ from: 'a', to: 'b', length: 0.5 }],
    custom: true,
  };

  it('merges pieces: adds new ones, keeps or replaces conflicts, never overrides built-ins', () => {
    const builtins = new Set(
      cat
        .all()
        .filter((t) => !t.custom)
        .map((t) => t.code),
    );
    const changed = { ...mine, paths: [{ from: 'a', to: 'b', length: 0.25 }] };
    const r1 = mergePieces([mine], [changed, { ...mine, code: 'MY4' }, { ...mine, code: 'C' }], builtins);
    expect(r1.added).toEqual(['MY4']);
    expect(r1.conflicts.sort()).toEqual(['C', 'MY2']);
    expect(r1.merged.find((p) => p.code === 'MY2')!.paths![0].length).toBe(0.5);
    const r2 = mergePieces([mine], [changed], builtins, true);
    expect(r2.merged.find((p) => p.code === 'MY2')!.paths![0].length).toBe(0.25);
    expect(mergePieces([mine], [mine], builtins).unchanged).toEqual(['MY2']);
  });

  it('layout files carry the custom pieces they use', () => {
    const c2 = new Catalog(DEFAULT_PARAMS, [mine]);
    const layout = { ...newLayout('x'), pieces: placeChain(c2, startPose(), [step('S1'), step('MY2')]).pieces };
    const file = makeLayoutFile(layout, c2);
    expect(file.pieces.map((p) => p.code)).toEqual(['MY2']);
    const back = parseLayoutFile(JSON.stringify(file));
    expect(back.pieces[0].paths).toEqual(mine.paths);
    expect(back.layout.pieces.length).toBe(2);
    // older files without piece definitions still load
    expect(parseLayoutFile(JSON.stringify({ format: 'track-planner-layout', version: 1, layout })).pieces).toEqual([]);
  });

  it('parts files round-trip pieces and custom kits', () => {
    const kit = { id: 'MYKIT', name: 'Mine', pieces: { MY2: 4 }, custom: true };
    const back = parsePartsFile(JSON.stringify(makePartsFile([mine], [...BUILTIN_KITS, kit])));
    expect(back.pieces[0].code).toBe('MY2');
    expect(back.kits.map((k) => k.id)).toEqual(['MYKIT']);
    expect(() => parsePartsFile('{"format":"other"}')).toThrow();
  });
});
