# Adding new track pieces

There are two ways to add a piece:

- **In the app.** Use the piece editor (**Catalog → + New piece**) for pieces you own that aren't in the catalog yet. Nothing needs
  installing, and you can share the result as a file.
- **In the code.** Add pieces to `src/core/pieces.ts` so everyone using the app gets them. This is how the GLK80 and HNP81 pieces
  are defined.

Both use the same description of a piece, so read [The track standard](#the-track-standard) and
[Describing a piece](#describing-a-piece) first.

## The track standard

Every piece follows these rules (defined in `src/core/standards.ts`). They were worked out from the GLK80 and HNP81 instruction
sheets and the TrackMaster curve packs.

| Rule | Value |
| --- | --- |
| Standard curve | Turns **60°**, so **6 make a circle** (2009–2019 track used 45° curves; see the README) |
| Switch | Straight leg = one standard straight; branch = one standard curve |
| Offset switch (PR/PL) | Shifts the track **one lane** sideways and ends parallel |
| Climbing piece | Rises **one level** |
| Headroom | Engines need **2 levels** to pass under other track |
| Ends | Genderless: any end joins any other end at the same level |
| Supports | RS1/RS2/RS3 hold levels 1/2/3, stack, and go in pairs under a D1 deck. RR1 holds level 1 alone and doesn't stack. The Vicarstown bridge holds both ends of a straight at level 2 |
| Direction | Turns, offsets and sideways positions are **positive to the right** of the direction of travel, **negative to the left** |

### Units

Pieces are described in standard units rather than millimetres. The manufacturer doesn't publish real sizes, so the units are
calibrated in **Settings**, and every piece rescales when you change them.

| Unit | Meaning | Default |
| --- | --- | --- |
| **S** | Length of one standard straight (S1) | 21 cm |
| **R** | Radius of a standard curve (C), measured to the middle of the track | 20 cm |
| **lane** | Distance between the two tracks after a PR/PL offset switch | 7 cm |
| **level** | Height of one support step | 6.5 cm |

## Describing a piece

A piece is a set of **paths**. A path is one way a train can travel through the piece, from one **end** to another. Ends are
named with letters (`a`, `b`, `c`…).

- Paths that **start at the same end** make a switch or fork: the train chooses one.
- Paths that **start at different ends** are independent, as in a crossing or a two-lane station.
- A path with **no end to finish at** is a dead end (a buffer stop).

Each path says how it changes the track:

| Field | What it means | Example |
| --- | --- | --- |
| `from` | End the path starts at | `'a'` |
| `to` | End it finishes at; leave it out for a dead end | `'b'` |
| `length` | Straight length, in S (default 1) | `0.5` = half straight |
| `turn` | Degrees turned along the path, `+` right / `−` left, on a standard-radius curve | `60`, `-60`, `45` |
| `radius` | Curve radius in R (default 1) | `1.5` = wide curve |
| `offset` | Sideways shift in lanes over `length`, ending parallel, `+` right / `−` left | `1` = like PR |
| `level` | Level the path starts at, above the piece's base (default 0) | `1` = the lid's fork |
| `rise` | Levels climbed from `from` to `to` (default 0) | `1` = AL/AR |
| `start` | Where the path starts if not at the piece's first end: `along` and `side` in S, or `lanes` sideways, and `heading` in degrees | `{ lanes: 1 }` |

Use either `turn` or `offset` on a path, not both.

Piece-wide settings:

| Setting | Use it for |
| --- | --- |
| `category` | `straight`, `curve`, `switch`, `ramp`, `buffer`, `crossing`, `station`, `bridge` or `support` (affects grouping and some checks) |
| `stop` | Has a stop/go lever where engines wait (CS2, Brendam Docks, station) |
| `selfSupporting` | Holds itself up when raised, so no supports are needed (bucket, lid) |
| `supportedPorts` | Ends whose joint the piece holds up itself (AR1's rock base holds `b`) |
| `cannotJoin` | Codes this piece physically can't connect to (AR1 can't join `XB`) |
| `body` | Solid block other track can't pass through, in S, between two levels, optionally with a tunnel (the bucket) |
| `supportLevel`, `pairedSupport`, `stackable`, `jointsHeld` | For supports: the level held, whether used in pairs with a D1 deck, whether they stack, and how many joints one holds |
| `approximate` | The sizes are estimates (shows an "estimated" badge) |

### Examples

```ts
// Half straight
{ from: 'a', to: 'b', length: 0.5 }

// Standard curve (turns right when entered at a; enter at b to turn left)
{ from: 'a', to: 'b', turn: 60 }

// Climbing curve, like AL: turns left going up, rises one level
{ from: 'a', to: 'b', turn: -60, rise: 1 }

// Right-hand switch: two paths from end a
[{ from: 'a', to: 'b' }, { from: 'a', to: 'c', turn: 60 }]

// Offset switch, like PR
[{ from: 'a', to: 'b' }, { from: 'a', to: 'c', offset: 1 }]

// 3-way fork standing one level up, like the bucket lid
[{ from: 'a', to: 'b', level: 1 }, { from: 'a', to: 'c', turn: -60, level: 1 }, { from: 'a', to: 'd', turn: 60, level: 1 }]

// 90° crossing: the second path starts half a straight along and half a straight to the left, heading 90°
[{ from: 'a', to: 'b' }, { from: 'c', to: 'd', start: { along: 0.5, side: -0.5, heading: 90 } }]

// Two parallel lanes one lane apart, like the loading station
[{ from: 'a', to: 'b' }, { from: 'c', to: 'd', start: { lanes: 1 } }]

// Buffer stop: a short dead end
{ from: 'a', length: 0.2 }
```

## Measuring a piece

1. **Length.** Measure a straight from the tip of one connector to the same point on the other end. Give other straights as a
   fraction of a standard one.
2. **Turn.** Count how many of the piece make a full circle and divide 360 by it: 6 → 60°, 8 → 45°, 12 → 30°.
3. **Radius.** Lay curves in a half circle and measure across between the track centres. Half of that is the radius. Standard
   curves are 1 × R.
4. **Offset.** For pieces that shift sideways and end parallel, count the shift in lanes (1 lane = the gap after a PR).
5. **Rise.** Count levels by support height: floor to the top of an RS1 is 1 level.
6. **Branches.** Add one path per way a train can go.

If your standard straight or curve measures differently from the defaults, change the units in **Settings** first. Every piece
uses them.

## Adding a piece in the app

1. Open **Catalog → + New piece**, or **Copy as custom** on a similar built-in piece.
2. Pick a template (straight, curve, climbing curve, switch, offset switch, Y, 3-way fork, crossing, two lanes, buffer, support),
   then adjust the paths.
3. Give it a code (as printed under the piece, if it has one) and a name.
4. Watch the preview: ends are labelled, and the summary lists each path's length, turn and climb. Any problems appear in red;
   for example, two paths that share an end must meet there at the same place, direction and level.
5. Click **Add piece**. Then add how many you own under **My track** (loose pieces), or define a kit that includes it.

Custom pieces can be edited, duplicated or deleted from their card in the Catalog.

### Sharing

- **Catalog → Export my pieces & kits** saves your custom pieces and kits as a `.trackparts.json` file. **Import pieces &
  kits** loads one. New pieces are added. If a piece with the same code already exists but is defined differently, you're asked
  whether to replace it. Built-in pieces can't be replaced.
- **Build → Export** saves a layout together with the definitions of any custom pieces it uses. Importing it on another device
  adds those pieces automatically. If that device already has a different piece with the same code, its own version is kept and
  you're told.

## Adding a built-in piece in code

1. Add the piece to `BUILTIN_PIECES` in `src/core/pieces.ts`, using the fields above. Use the constants in `TRACK_STANDARD`
   (for example `A` for the standard 60° curve) rather than raw numbers where the piece follows the standard:

   ```ts
   {
     code: 'S2',
     name: 'Half straight',
     category: 'straight',
     description: 'Half a standard straight.',
     color: '#4b5563',
     paths: [{ from: 'a', to: 'b', length: 0.5 }],
   },
   ```

2. If it comes in a set, add it to that kit in `src/core/kits.ts` (counts are by code).
3. Add a test in `src/core/core.test.ts` for anything unusual about it: where its ends are, which routes it allows, how it's
   supported. The test "every kit piece exists in the catalogue" already checks that kit codes match.
4. Run `npm test` and check the piece in **Catalog**.

Auto design uses new pieces automatically when they have the same shape as a standard straight, curve or climbing curve. Other
shapes are available in the builder and checked like any other piece.
