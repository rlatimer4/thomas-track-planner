/**
 * Kit definitions. Contents are taken from the "What's Included" section of each
 * set's printed instructions. Counts are by piece code, so differently coloured
 * copies of the same code (e.g. orange and blue S1) are combined.
 */
export interface Kit {
  id: string;
  name: string;
  /** Manufacturer model number, if known. */
  model?: string;
  year?: number;
  pieces: Record<string, number>;
  /** Non-track contents, listed for reference only. */
  extras?: string[];
  source?: string;
  custom?: boolean;
}

export const BUILTIN_KITS: Kit[] = [
  {
    id: 'GLK80',
    name: 'Talking Thomas & Percy Train Set',
    model: 'GLK80',
    year: 2020,
    pieces: {
      C: 6,
      CU4: 1,
      CS2: 1,
      TL: 1,
      TR: 2,
      PR: 1,
      PL: 1,
      S1: 2,
      TU4: 1,
      AL: 4,
      BS1: 1,
      DOCK: 1,
      LS: 1,
      VB: 1,
      RR1: 2,
      RS2: 4,
      D1: 2,
    },
    extras: [
      'Talking Thomas (motorized)',
      'Talking Percy (motorized)',
      'Bulstrode the boat',
      'Cargo cars ×2',
      'Blue Mountain / Henry’s Tunnel',
      'Green Line and Blue Line signs',
      'Crate and boulder cargo',
      'Sticker sheet',
    ],
    source: 'GLK80 instruction sheet, “What’s Included”',
  },
  {
    id: 'HNP81',
    name: 'Connect & Build Track Bucket',
    model: 'HNP81',
    year: 2023,
    pieces: {
      CHT: 1,
      AL: 3,
      ES3: 5,
      AR1: 1,
      AR: 1,
      C: 3,
      TR: 2,
      TL: 1,
      BT1: 1,
      S1: 4,
      RRT: 1,
      SWB: 1,
      XB: 1,
      BKT: 1,
      BS2: 1,
      RS1: 4,
      RS2: 6,
      RS3: 4,
      D1: 7,
    },
    extras: ['Billboard', 'Sticker sheet'],
    source: 'HNP81 instruction sheet, “What’s Included”',
  },
];
