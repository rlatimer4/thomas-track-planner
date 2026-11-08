/**
 * Built-in pieces, described in standard units (see standards.ts):
 * lengths in straights (S), turns in degrees (+ right / − left), offsets in lanes,
 * heights in levels. Codes are the ones printed under each piece.
 */
import type { PathDef, PieceSpec } from './catalog';
import { TRACK_STANDARD } from './standards';

const A = TRACK_STANDARD.curveAngle; // 60°

const through: PathDef = { from: 'a', to: 'b' }; // one standard straight
const curve: PathDef = { from: 'a', to: 'b', turn: A }; // one standard curve (right when entered at a)

const straight = (code: string, name: string, description: string, color: string, extra: Partial<PieceSpec> = {}): PieceSpec => ({
  code,
  name,
  category: 'straight',
  description,
  color,
  paths: [through],
  ...extra,
});

const curved = (code: string, name: string, description: string, color: string, extra: Partial<PieceSpec> = {}): PieceSpec => ({
  code,
  name,
  category: 'curve',
  description,
  color,
  paths: [curve],
  ...extra,
});

const support = (
  code: string,
  name: string,
  level: number,
  description: string,
  color: string,
  extra: Partial<PieceSpec> = {},
): PieceSpec => ({
  code,
  name,
  category: 'support',
  description,
  color,
  supportLevel: level,
  ...extra,
});

export const BUILTIN_PIECES: PieceSpec[] = [
  // ------------------------------------------------------------------ straights: length 1
  straight('S1', 'Straight', 'Standard straight: the unit of length (S).', '#4b5563'),
  straight('TU4', 'Straight (support tabs)', 'Straight with side tabs that clip onto supports.', '#374151'),
  straight('ES3', 'Elevated straight', 'Straight designed to sit on supports in raised sections.', '#334155'),
  straight('BT1', 'Wide-bed straight', 'Straight with a wide bed; used for play features.', '#84cc16', { approximate: true }),
  straight('RRT', 'Flat-deck straight', 'Straight with a flat grey deck.', '#9ca3af', { approximate: true }),

  // ------------------------------------------------------------------ curves: turn 60°
  curved('C', 'Curve', `Standard curve: turns ${A}°, ${TRACK_STANDARD.curvesPerCircle} make a circle.`, '#4b5563'),
  curved('CU4', 'Curve (support tabs)', 'Standard curve with tabs that clip onto supports.', '#374151'),
  curved('CS2', 'Curve with stop', 'Standard curve with a built-in stop/go lever.', '#4b5563', { stop: true }),
  curved('CHT', 'Curve (raised)', 'Standard curve used at the top of raised sections.', '#334155', { approximate: true }),
  curved('DOCK', 'Brendam Docks curve', 'Standard curve with a stop lever, part of the GLK80 docks.', '#a16207', { stop: true }),

  // ------------------------------------------------------------------ switches: straight leg + one curve
  {
    code: 'TL',
    name: 'Switch, left',
    category: 'switch',
    description: `Points: straight through, or a branch turning ${A}° left.`,
    color: '#59616b',
    paths: [through, { from: 'a', to: 'c', turn: -A }],
  },
  {
    code: 'TR',
    name: 'Switch, right',
    category: 'switch',
    description: `Points: straight through, or a branch turning ${A}° right.`,
    color: '#59616b',
    paths: [through, { from: 'a', to: 'c', turn: A }],
  },
  {
    code: 'PL',
    name: 'Offset switch, left',
    category: 'switch',
    description: 'Points whose branch shifts one lane left and runs parallel. Pairs with PR around the loading station.',
    color: '#59616b',
    approximate: true,
    paths: [through, { from: 'a', to: 'c', offset: -TRACK_STANDARD.offsetLanes }],
  },
  {
    code: 'PR',
    name: 'Offset switch, right',
    category: 'switch',
    description: 'Points whose branch shifts one lane right and runs parallel. Pairs with PL around the loading station.',
    color: '#59616b',
    approximate: true,
    paths: [through, { from: 'a', to: 'c', offset: TRACK_STANDARD.offsetLanes }],
  },
  {
    code: 'SWB',
    name: 'Junction base (switch)',
    category: 'switch',
    description: 'Blue junction base with a switch lever (HNP81). Modelled as a right-hand switch.',
    color: '#2563eb',
    approximate: true,
    paths: [through, { from: 'a', to: 'c', turn: A }],
  },
  {
    code: 'XB',
    name: 'Bucket lid (3-way fork)',
    category: 'switch',
    description:
      'The bucket lid used as track: a 3-way fork standing one level up on its own legs. One end splits left, straight and right.',
    color: '#60a5fa',
    selfSupporting: true,
    approximate: true,
    paths: [
      { from: 'a', to: 'b', level: 1 },
      { from: 'a', to: 'c', turn: -A, level: 1 },
      { from: 'a', to: 'd', turn: A, level: 1 },
    ],
    body: { along: 0, side: -0.22, length: 0.85, width: 0.44, zMin: 0, zMax: 1 },
  },

  // ------------------------------------------------------------------ climbing curves: turn 60°, rise 1 level
  {
    code: 'AL',
    name: 'Climbing curve, left',
    category: 'ramp',
    description: `Climbs one level while turning ${A}° left (turns right on the way down).`,
    color: '#4b5563',
    paths: [{ from: 'a', to: 'b', turn: -A, rise: 1 }],
  },
  {
    code: 'AR',
    name: 'Climbing curve, right',
    category: 'ramp',
    description: `Climbs one level while turning ${A}° right (turns left on the way down).`,
    color: '#334155',
    paths: [{ from: 'a', to: 'b', turn: A, rise: 1 }],
  },
  {
    code: 'AR1',
    name: 'Climbing curve, right (rock base)',
    category: 'ramp',
    description:
      'Like AR, but its rock base also holds up the joint at the top, so no support is needed there. Does not fit against the bucket lid.',
    color: '#57534e',
    supportedPorts: ['b'],
    cannotJoin: ['XB'],
    paths: [{ from: 'a', to: 'b', turn: A, rise: 1 }],
  },

  // ------------------------------------------------------------------ buffers: dead end
  {
    code: 'BS1',
    name: 'Buffer stop',
    category: 'buffer',
    description: 'Ends a siding or spur so engines stop safely.',
    color: '#dc2626',
    paths: [{ from: 'a', length: 0.2 }],
  },
  {
    code: 'BS2',
    name: 'Buffer stop (wood)',
    category: 'buffer',
    description: 'Ends a siding or spur so engines stop safely.',
    color: '#a8a29e',
    paths: [{ from: 'a', length: 0.2 }],
  },

  // ------------------------------------------------------------------ stations and crossings
  {
    code: 'LS',
    name: 'Loading station (2 lanes)',
    category: 'station',
    description: 'Two parallel lanes one lane apart, with stop levers. Feed it with an offset switch (PR/PL) at each end.',
    color: '#6b7280',
    approximate: true,
    stop: true,
    paths: [through, { from: 'c', to: 'd', start: { lanes: 1 } }],
  },
  {
    code: 'BKT',
    name: 'Track bucket (crossing + tunnel)',
    category: 'crossing',
    description:
      'The storage bucket: a 4-way (90°) crossing on top at level 4, with a ground-level tunnel through it. Track can’t pass through its sides.',
    color: '#9ca3af',
    selfSupporting: true,
    approximate: true,
    paths: [
      { from: 'a', to: 'b', level: 4 },
      { from: 'c', to: 'd', level: 4, start: { along: 0.5, side: -0.5, heading: 90 } },
      { from: 'e', to: 'f' },
    ],
    body: { along: 0, side: -0.5, length: 1, width: 1, zMin: 0, zMax: 4, tunnel: true },
  },

  // ------------------------------------------------------------------ supports (counted against raised joints, not placed)
  support('RR1', 'Riser pier', 1, 'Rock-style pier that holds a joint one level up on its own. Does not stack.', '#9a3412'),
  support('RS1', 'Support, short', 1, 'Level-1 support, used in pairs under a D1 deck. Stackable: two RS1 equal one RS2.', '#991b1b', {
    pairedSupport: true,
    stackable: true,
  }),
  support('RS2', 'Support, medium', 2, 'Level-2 support, used in pairs under a D1 deck. Stackable with other supports.', '#991b1b', {
    pairedSupport: true,
    stackable: true,
  }),
  support('RS3', 'Support, tall', 3, 'Level-3 support, used in pairs under a D1 deck. Stackable with other supports.', '#991b1b', {
    pairedSupport: true,
    stackable: true,
  }),
  support('D1', 'Support deck', 0, 'Grey deck that bridges a pair of supports under a joint.', '#9ca3af'),
  support(
    'VB',
    'Vicarstown lift bridge',
    2,
    'Bridge that carries a straight two levels up, holding both of its ends, so track can pass underneath.',
    '#b91c1c',
    { jointsHeld: 2, approximate: true },
  ),
];
