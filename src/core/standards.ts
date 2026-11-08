/**
 * The track standard: the rules every piece in this system follows.
 *
 * Fisher-Price/Mattel don't publish a specification for the motorized (TrackMaster-style)
 * track, so this is derived from the sets' printed instructions and fan documentation:
 *
 * - Curves turn 60°, so 6 make a full circle. Each half-circle in the GLK80/HNP81 layout
 *   diagrams uses three curves, and the small loop round Brendam Docks is six pieces.
 *   TrackMaster curve packs list 60° curves; some older packs also had 45° curves.
 * - A switch's branch is one standard curve; its straight leg is one standard straight.
 * - Offset switches (PR/PL) move the track sideways by one lane and end parallel.
 * - Climbing pieces rise one level each. Two climbs (with a pier between) reach the level-2
 *   deck of the Vicarstown bridge, which the lower track passes under.
 * - Engines need two levels of headroom to pass under other track.
 * - Ends are genderless: any end joins any other end at the same level.
 * - Supports: RS1/RS2/RS3 hold levels 1/2/3, stack on each other, and are used in pairs
 *   under a D1 deck. RR1 rock piers hold level 1 on their own and don't stack.
 *
 * Lengths (straight, curve radius, lane spacing, level height) aren't published and are
 * calibrated in Settings; pieces are described in these units, so calibration changes
 * every piece consistently.
 */

export const TRACK_STANDARD = {
  /** Degrees turned by one standard curve. */
  curveAngle: 60,
  /** Standard curves in a full circle. */
  curvesPerCircle: 6,
  /** Levels climbed by one climbing piece. */
  climbPerPiece: 1,
  /** Levels of clearance an engine needs to pass under other track. */
  headroomLevels: 2,
  /** Lanes a PR/PL offset switch moves the track sideways. */
  offsetLanes: 1,
  /** Positive turns and offsets are to the right of the direction of travel. */
  handedness: 'positive = right',
} as const;

/** Units pieces are described in. Their sizes in mm are calibration settings. */
export const UNITS = {
  straight: 'S: length of one standard straight (S1)',
  radius: 'R: radius of a standard curve (C), measured to the track centre',
  lane: 'lane: distance between the two parallel tracks after an offset switch',
  level: 'level: height of one support step',
} as const;

/** Plain-language guide to measuring pieces, shown in the custom piece editor. */
export const MEASURING_GUIDE: { title: string; text: string }[] = [
  {
    title: 'Length',
    text: 'Measure a straight from the tip of one connector to the same point on the other end. Give other straights as a fraction of a standard straight (½, ¼…).',
  },
  {
    title: 'Turn',
    text: 'Count how many of the piece make a full circle and divide 360 by it: 6 → 60°, 8 → 45°, 12 → 30°. Turning right (clockwise seen from above) is positive, left is negative.',
  },
  {
    title: 'Radius',
    text: 'Lay curves in a half circle and measure across between track centres; half of that is the radius. Pieces with the standard radius use 1 (× R).',
  },
  {
    title: 'Offset',
    text: 'For pieces that shift the track sideways and end parallel (like PR/PL), give the shift in lanes: 1 lane is the gap between the two tracks after a PR.',
  },
  {
    title: 'Rise',
    text: 'Count levels by support height: a piece that climbs from the floor to the top of an RS1 rises 1 level.',
  },
  {
    title: 'Branches',
    text: 'Add one path for each way a train can go through the piece. Paths that start at the same end make a switch or fork; paths that start at different ends make a crossing.',
  },
];
