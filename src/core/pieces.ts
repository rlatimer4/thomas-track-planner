/**
 * Built-in pieces, described in standard units (see standards.ts):
 * lengths in straights (S), turns in degrees (+ right / − left), offsets in lanes,
 * heights in levels. Codes are the ones printed under each piece.
 */
import type { PathDef, PieceSpec } from './catalog';
import { TRACK_STANDARD } from './standards';

const A = TRACK_STANDARD.curveAngle; // 60°
/** Track bucket footprint, in straights: its corner-to-corner top tracks are one straight long and 120° apart. */
const BUCKET_SHORT = 0.5; // sin 30°: the side the tunnel crosses
const BUCKET_HALF = Math.sqrt(3) / 4; // half of the long side (cos 30° / 2)

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

/** Pieces of the current (2018+) track, described from the GLK80 and HNP81 sheets. */
const CURRENT_PIECES: PieceSpec[] = [
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
      'The storage bucket turned over: on its bottom (level 4) two tracks cross corner to corner with 120° between them, and a ground-level tunnel runs underneath along the line bisecting that 120° angle. Track can’t pass through its sides.',
    color: '#9ca3af',
    selfSupporting: true,
    approximate: true,
    // Each top track is one straight running between opposite corners, 120° from the other, so the footprint is
    // √3 times as long as it is wide. The tunnel (e→f) crosses the short way, half a straight.
    paths: [
      { from: 'a', to: 'b', level: 4, start: { side: -BUCKET_HALF, heading: 60 } },
      { from: 'c', to: 'd', level: 4, start: { side: BUCKET_HALF, heading: -60 } },
      { from: 'e', to: 'f', length: BUCKET_SHORT },
    ],
    body: { along: 0, side: -BUCKET_HALF, length: BUCKET_SHORT, width: 2 * BUCKET_HALF, zMin: 0, zMax: 4, tunnel: true },
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

// ==================================================================== earlier track generations
//
// The 2014–2019 grey track (codes CS, CL, S2, S4, YS, TLS…) uses 45° curves, so 8 make a circle:
// the instruction-sheet ovals are 8 CS curves plus straights. CL is the larger-radius 45° curve that
// runs alongside CS (the …L switches branch on a CL). Codes the 2018+ track also uses (S1, BS1, ES3,
// TU4, D1, RS1–RS3, RR1) are the same pieces and aren't repeated here.
//
// The original 2009–2013 TrackMaster track has older connectors; the 2014 sets include adaptors (HT)
// to join it. Its curves are also 45°. Where its printed codes clash with later pieces of a different
// shape (S1, S2, S4, T2, E2) or it has no printed code, the code here ends in "-09".
//
// None of these sizes are published and only the angles are confirmed by layout diagrams, so every
// piece is marked approximate: measure and adjust with a custom piece if yours differ.

const A45 = 45;
/** CS radius relative to R (the 60° C curve), estimated from the instruction drawings. */
const RS = 0.8;
/** CL radius relative to R, estimated: CL runs outside CS. */
const RL = 1.2;
const GREY = '#4b5563';
const DARK = '#334155';
const TAN = '#b8956a';

const approx = { approximate: true } as const;

const short = (
  code: string,
  name: string,
  length: number,
  description: string,
  color = GREY,
  extra: Partial<PieceSpec> = {},
): PieceSpec => ({
  code,
  name,
  category: 'straight',
  description,
  color,
  paths: [{ from: 'a', to: 'b', length }],
  ...approx,
  ...extra,
});

const arc = (
  code: string,
  name: string,
  turn: number,
  radius: number,
  description: string,
  color = GREY,
  extra: Partial<PieceSpec> = {},
): PieceSpec => ({
  code,
  name,
  category: 'curve',
  description,
  color,
  paths: [{ from: 'a', to: 'b', turn, radius }],
  ...approx,
  ...extra,
});

const points = (code: string, name: string, turn: number, radius: number, description: string, color = '#59616b'): PieceSpec => ({
  code,
  name,
  category: 'switch',
  description,
  color,
  paths: [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'c', turn, radius },
  ],
  ...approx,
});

const wye = (code: string, name: string, turn: number, radius: number, description: string, color = '#59616b'): PieceSpec => ({
  code,
  name,
  category: 'switch',
  description,
  color,
  paths: [
    { from: 'a', to: 'b', turn: -turn, radius },
    { from: 'a', to: 'c', turn, radius },
  ],
  ...approx,
});

const incline = (code: string, name: string, description: string, color = DARK): PieceSpec => ({
  code,
  name,
  category: 'ramp',
  description,
  color,
  paths: [{ from: 'a', to: 'b', rise: 1 }],
  ...approx,
});

const climb = (code: string, name: string, turn: number, radius: number, description: string, color = DARK): PieceSpec => ({
  code,
  name,
  category: 'ramp',
  description,
  color,
  paths: [{ from: 'a', to: 'b', turn, radius, rise: 1 }],
  ...approx,
});

const crossing = (code: string, name: string, size: number, description: string, color = GREY): PieceSpec => ({
  code,
  name,
  category: 'crossing',
  description,
  color,
  paths: [
    { from: 'a', to: 'b', length: size },
    { from: 'c', to: 'd', length: size, start: { along: size / 2, side: -size / 2, heading: 90 } },
  ],
  ...approx,
});

const deck = (code: string, name: string, description: string, color = '#9ca3af'): PieceSpec =>
  support(code, name, 0, description, color, approx);

function GEN2014_PIECES(): PieceSpec[] {
  return [
    // straights
    short('S2', 'Half straight', 0.5, 'Half a standard straight.'),
    short('S4', 'Quarter straight', 0.25, 'A quarter of a standard straight.'),
    short('S8', 'Short straight', 0.125, 'The shortest straight, about an eighth of S1.'),
    short('T2', 'Half straight (support tabs)', 0.5, 'Half straight with side tabs that clip onto supports.', DARK),
    short('TU2', 'Half straight (tabs)', 0.5, 'Half straight with side tabs.', DARK),
    short('WS2', 'Half straight (feature)', 0.5, 'Half straight in a play-feature style (W series).', '#a8a29e'),
    short('HT', 'Track adaptor', 0.25, 'Short adaptor that joins 2014+ track to the original (2009–2013) TrackMaster track.', '#64748b'),
    short('TA', 'Track adaptor', 0.25, 'Short adaptor that joins 2014+ track to the original (2009–2013) TrackMaster track.', '#64748b'),

    // 45° curves
    arc('CS', 'Curve, 45°', A45, RS, '45° curve: 8 make a circle.'),
    arc('CL', 'Large curve, 45°', A45, RL, '45° curve on a larger radius, running outside CS.'),
    arc('WCS', 'Curve, 45° (feature)', A45, RS, 'CS-shaped curve in a play-feature style (W series).', '#a8a29e'),

    // switches
    points('TLS', 'Switch, left (short)', -A45, RS, 'Points: straight through, or a branch turning 45° left on a CS curve.'),
    points('TRS', 'Switch, right (short)', A45, RS, 'Points: straight through, or a branch turning 45° right on a CS curve.'),
    points('TLL', 'Switch, left (large)', -A45, RL, 'Points: straight through, or a branch turning 45° left on a CL curve.'),
    points('TRL', 'Switch, right (large)', A45, RL, 'Points: straight through, or a branch turning 45° right on a CL curve.'),
    wye('YS', 'Y switch (short)', A45, RS, 'Y points: two CS curves, one turning left and one right.'),
    wye('YL', 'Y switch (large)', A45, RL, 'Y points: two CL curves, one turning left and one right.'),
    wye('Y', 'Y switch', A, 1, `Y points: two standard ${A}° curves, one turning left and one right.`),

    // crossing
    crossing('SX2', 'Crossing', 0.5, '90° crossing, about half a straight each way.'),

    // straight ramps: each climbs one level over a straight
    incline('E1', 'Ramp', 'Straight ramp that climbs one level.'),
    incline('E2', 'Ramp', 'Straight ramp that climbs one level.'),
    incline('ES1', 'Ramp', 'Straight ramp that climbs one level.'),
    incline('ES2', 'Ramp', 'Straight ramp that climbs one level.'),
    incline('ES5', 'Twisting ramp', 'Straight section bent to climb; the sheets note it is curved on purpose.'),
    incline('ES6', 'Ramp', 'Straight ramp that climbs one level.'),
    incline('ES7', 'Twisting ramp', 'Straight section bent to climb; the sheets note it is curved on purpose.'),
    incline('ES8', 'Twisting ramp', 'Straight section bent to climb; the sheets note it is curved on purpose.'),
    incline('EST', 'Twisting ramp', 'Straight section bent to climb; the sheets note it is curved on purpose.'),
    incline('WES1', 'Ramp (feature)', 'ES1-shaped ramp in a play-feature style (W series).', '#a8a29e'),

    // climbing curves
    climb('EL', 'Climbing curve, left (large)', -A45, RL, 'Climbs one level while turning 45° left on a CL radius.'),
    climb('ER', 'Climbing curve, right (large)', A45, RL, 'Climbs one level while turning 45° right on a CL radius.'),
    climb('WEL', 'Climbing curve, left (feature)', -A45, RL, 'EL-shaped climbing curve in a play-feature style (W series).', '#a8a29e'),
    climb('ECR', 'Climbing curve (large)', A45, RL, 'Long curve that climbs one level while turning 45°.'),
    climb('EC1', 'Climbing curve', A45, 1, 'Spiral curve that climbs one level while turning 45°.'),
    climb('EC2', 'Climbing curve', A45, 1, 'Spiral curve that climbs one level while turning 45°.'),
    climb('EC3', 'Climbing curve', A45, 1, 'Spiral curve that climbs one level while turning 45°.'),
    climb('EC4', 'Climbing curve', A45, 1, 'Curve that climbs one level while turning 45°; curved on purpose.'),
    climb('EC5', 'Climbing curve', A45, 1, 'Curve that climbs one level while turning 45°; curved on purpose.'),

    // supports
    support('RB1', 'Riser block', 1, 'Stand-alone riser that holds a joint one level up. Does not stack.', '#ca8a04', approx),
    support('RB2', 'Riser block, tall', 2, 'Stand-alone riser that holds a joint two levels up. Does not stack.', '#ca8a04', approx),
    support(
      'RR2',
      'Rock pier, level 2',
      2,
      'Rock-style pier that holds a joint two levels up on its own. Does not stack.',
      '#9a3412',
      approx,
    ),
    support(
      'RR3',
      'Rock pier, level 3',
      3,
      'Rock-style pier that holds a joint three levels up on its own. Does not stack.',
      '#9a3412',
      approx,
    ),
    support('RR6', 'Rock pier, level 6', 6, 'Tall rock-style pier for the top of a tower. Does not stack.', '#9a3412', approx),
    deck('RRC', 'Rock pier cap', 'Small rock wedge that tops a rock pier.', '#78716c'),
    deck('D2', 'Support deck', 'Deck that bridges a pair of supports under a joint.'),
    deck('D3', 'Support deck', 'Deck that bridges a pair of supports under a joint, used on spirals.'),
    deck('D4', 'Support deck', 'Deck that bridges a pair of supports under a joint.'),
    deck('DC', 'Deck connector', 'Small connector that holds a joint onto a deck or tower.'),
    deck('DK', 'Deck', 'Deck that sits under a raised joint.'),
  ];
}

function GEN2009_PIECES(): PieceSpec[] {
  const old = 'Original 2009–2013 TrackMaster track: joins 2014+ track only through an adaptor (HT).';
  return [
    short('S1-09', 'Straight (2009)', 1, `Straight, printed S1. ${old}`, TAN),
    short('S2-09', 'Half straight (2009)', 0.5, `Half straight, printed S2. ${old}`, TAN),
    short('S4-09', 'Quarter straight (2009)', 0.25, `Quarter straight, printed S4. ${old}`, TAN),
    short('S6', 'Short straight (2009)', 1 / 6, `Short straight. ${old}`, TAN),
    short('STOP-09', 'Stop track (2009)', 1, `Straight with a stop/go lever. ${old}`, TAN, { stop: true }),
    arc('C1', 'Curve (2009)', A45, RS, `45° curve: 8 make a circle. ${old}`, TAN),
    arc('LC-09', 'Large curve (2009)', A45, RL, `45° curve on a larger radius. ${old}`, TAN),
    points('T1', 'Switch, left (2009)', -A45, RS, `Points: straight through, or a 45° branch to the left. ${old}`, TAN),
    points('T2-09', 'Switch, right (2009)', A45, RS, `Points: straight through, or a 45° branch to the right. Printed T2. ${old}`, TAN),
    points(
      'CFT-09',
      'Cargo-flip switch (2009)',
      A45,
      RS,
      `Switch whose branch tips the cargo car. Modelled as a right-hand switch. ${old}`,
      TAN,
    ),
    wye('Y2', 'Y switch (2009)', A45, RS, `Y points: two 45° curves, one left and one right. ${old}`, TAN),
    crossing('W4', 'Crossing (2009)', 0.5, `90° crossing. ${old}`, TAN),
    climb('AL-09', 'Ascending curve, left (2009)', -A45, RL, `Climbs one level while turning left. ${old}`, TAN),
    climb('AR-09', 'Ascending curve, right (2009)', A45, RL, `Climbs one level while turning right. Printed D2 on some sets. ${old}`, TAN),
    {
      code: 'RMP-09',
      name: 'Sloped straight (2009)',
      category: 'ramp',
      description: `Straight that climbs one level. ${old}`,
      color: TAN,
      paths: [{ from: 'a', to: 'b', rise: 1 }],
      ...approx,
    },
    arc('C2', 'Half curve (2009)', A45 / 2, RS, `Half of a C1 curve (22.5°). ${old}`, TAN),
    arc('CSTOP-09', 'Curve with stop (2009)', A45, RS, `C1-shaped curve with a stop/go lever. ${old}`, TAN, { stop: true }),
    {
      code: 'DB-09',
      name: 'Drawbridge (2009)',
      category: 'bridge',
      description: `Raise-and-lower drawbridge with its two ramps and a stop/go lever, about two straights long. ${old}`,
      color: '#57534e',
      stop: true,
      paths: [{ from: 'a', to: 'b', length: 2 }],
      ...approx,
    },
    {
      code: 'E2-09',
      name: 'Buffer stop (2009)',
      category: 'buffer',
      description: `Printed E2. ${old}`,
      color: '#dc2626',
      paths: [{ from: 'a', length: 0.2 }],
      ...approx,
    },
    support('R1-09', 'Short riser (2009)', 1, `Riser that holds a joint one level up. ${old}`, '#a16207', approx),
    support('R2-09', 'Tall riser (2009)', 2, `Riser that holds a joint two levels up. ${old}`, '#a16207', approx),
    support('R3-09', 'Riser, level 3 (2009)', 3, `Riser that holds a joint three levels up. ${old}`, '#a16207', approx),
    support('R4-09', 'Riser, level 4 (2009)', 4, `Riser that holds a joint four levels up. ${old}`, '#a16207', approx),
  ];
}

export const BUILTIN_PIECES: PieceSpec[] = [...CURRENT_PIECES, ...GEN2014_PIECES(), ...GEN2009_PIECES()];
