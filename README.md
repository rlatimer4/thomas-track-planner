# Track Planner

A desktop layout planner for **Thomas & Friends motorized (TrackMaster-style) plastic track**. It:

- keeps a **catalog** of track pieces and how their ends connect,
- tracks **your collection**: whole kits (for example GLK80 and HNP81) plus loose pieces,
- lets you **build layouts** that snap together on screen, checking every joint as you go, and
- **auto-designs layouts** from the pieces you own, following basic railroad design rules.

It runs as a desktop app (Windows/macOS/Linux via [Tauri 2](https://tauri.app)) and in any browser. The UI is touch-friendly and
the design logic has no platform dependencies, so the same code can later ship as an iOS/Android app (Tauri mobile).

> Fan-made, unofficial tool. Not affiliated with Mattel, Fisher-Price or Gullane. Thomas & Friends and TrackMaster are trademarks of
> their owners. No official artwork is used: pieces are drawn as simple diagrams.

## Using it

| Tab | What it does |
| --- | --- |
| **Build** | Tap a piece in the palette to add it. New pieces attach to the selected (orange) open end, and the next end is selected automatically, so you can keep tapping. **Turn** (or `F`) re-attaches the last piece the other way: a curve turns left instead of right, a ramp goes down instead of up, a switch is entered by a different leg. Tap a green end to build from it. Drag a piece to move it; it snaps when an end comes near another. To work on several pieces, Shift+drag a box around them (or turn on **Select** and drag), Shift+click to add or remove one, or `Ctrl+A` for all; then drag, rotate, raise or remove them together. `R` rotates, `Del` removes, `Ctrl+Z`/`Ctrl+Shift+Z` undo and redo. |
| **Auto design** | Choose a shape (any, loops only, figure-8), the features you want (sidings, station, hills) and, optionally, the space you have. It generates and ranks layouts. Hover the score to see how it was worked out. **Open in builder** to edit one. |
| **My track** | Set how many of each kit you own, or adjust loose pieces with + / − (negative numbers record lost pieces). You can also define your own kits. |
| **Catalog** | Every piece with its ends and paths. Add, edit, copy and share custom pieces and kits. See [Adding new track pieces](docs/ADDING_PIECES.md). |
| **Settings** | Units (cm/in); your space; trains (engines running at once, longest train, engine width, headroom, how switches behave); track geometry calibration. |

The **Checks** panel updates as you build. Hover or tap a check to highlight the pieces involved.

| Check | What it looks for |
| --- | --- |
| Overlap, height mismatch, ends almost meet, open ends | Pieces in the same space, joints at different heights, forced joints, track that runs off the end |
| Headroom | Track passing over other track less than 2 levels above it (engines need 2; adjustable) |
| Tracks too close | Tracks at the same level nearer than an engine is wide, so trains would scrape |
| Disconnected track | Pieces not joined to the rest of the layout |
| Turning trains | Whether an engine can turn around (reversing loop, wye), and which track does it |
| Unreachable track, loop reachable one way only | Track a train on the main line can't get to, usually a switch facing the wrong way, and loops that can only be entered in one direction |
| Junctions and crossings, head-on risk, too many engines | Where trains' paths meet; turning trains running into others; more engines than places to pass or wait |
| Siding too short, passing loop too short | Sidings and passing loops that can't hold your longest train clear of the switches |
| Stop on a slope, stop close to a junction | Stop pieces (CS2, Brendam Docks, station) on or next to a ramp, or where a waiting train blocks a junction |
| Switches that must be set | Only if engines derail when going through a switch set against them (Settings) |
| Doesn't fit your space | The layout is bigger than the space set in Settings (it says if turning it 90° would fit) |
| Shortages, supports, S-bends, switches on ramps, long climbs, dead-end sections | Pieces and supports you don't have, and track design rules |

**Parts** shows a bill of materials, including the supports needed for raised track. **Footprint** draws the area the layout
covers with its width and depth, next to your space if you've set one. The exported SVG includes the footprint too.

Layouts and inventory are saved automatically on the device. **Export/Import** moves layouts as `.track.json` files, and **SVG**
saves a printable drawing.

## Track system model

The track standard is in `src/core/standards.ts`, and every piece is described against it (see
[Adding new track pieces](docs/ADDING_PIECES.md)):

- **Curves turn 60°**, so 6 make a circle. This matches the GLK80/HNP81 layout diagrams, where each half-circle is 3 curves, and
  the TrackMaster curve packs.
- **Switches:** the straight leg is one straight and the branch is one standard curve. **Offset switches** (`PR`/`PL`) shift one
  lane sideways and end parallel, which is how the GLK80 loading station is fed.
- **Pieces are paths.** Each way through a piece is described by how it turns (degrees), its length (in straights), any
  sideways offset (in lanes) and how much it climbs (in levels).
- **Units** (Settings → calibration; defaults are estimates, not published figures): straight S = 21 cm, curve radius R = 20 cm,
  lane = 7 cm.
- **Connectors** are genderless: any end joins any other end at the same height.
- **Joint play.** Real toy track has a little slack. Ends within 12 mm and 4° count as connected (configurable). The auto designer
  only closes loops within 9 mm.

### Elevation

Height is counted in **levels**. Ground is level 0, and each support height is one level.

| Piece | Elevation behaviour |
| --- | --- |
| `AL` | Climbing curve: same shape as a `C` curve, rises one level and turns **left** on the way up (so **right** on the way down) |
| `AR` | Mirror image of `AL`: turns **right** going up, **left** going down |
| `AR1` | Like `AR`, but its rock base also holds up the joint at the top, so no support is needed there. It doesn't fit against the bucket lid |
| `RR1` | Rock-style pier for level 1. Stands on its own; does not stack |
| `RS1`, `RS2`, `RS3` | Supports for levels 1, 2 and 3. Used in pairs (one column each side) with a `D1` deck under the joint. They stack: two `RS1` equal one `RS2`, and `RS2` + `RS1` reach level 3 |
| `XB` | Bucket lid: a 3-way fork (left, straight, right) standing one level up on its own legs. Ramp up to it |
| `BKT` | Track bucket, turned over: two tracks cross corner to corner on its bottom at level 4, 120° apart, and a tunnel underneath, along the line bisecting that 120° angle, lets it stand over two of your own ground tracks side by side (it has no track of its own) |
| `VB` | Vicarstown lift bridge: carries a straight at level 2, holding both of its ends, so track can pass underneath |

How it's checked:
- Joints connect only at the same level; otherwise it's a **height mismatch**.
- Track may cross over other track that's at least two levels lower, which is the headroom an engine needs (configurable). The bucket is solid apart from its tunnel, so track can't pass
  through its sides at any height below its top.
- Every raised joint needs supports stacked to its height unless a self-supporting piece (`AR1`'s top, the bridge, the lid,
  the bucket) holds it. For each joint the planner picks the combination using the fewest pieces you own: an `RR1` pier (level 1 only),
  or two stacked columns of `RS` supports plus a `D1` deck. The **Parts** panel shows supports needed per level and which of yours are used.
- The bucket and the lid always sit on the floor. A piece that would go below ground is an error.
- The auto designer climbs and descends on climbing curves in balanced pairs, up to level 3, and never puts a switch right next
  to one.

### Kits included

Contents are taken from each set's printed instructions ("What's Included"):

| Kit | Track pieces |
| --- | --- |
| **GLK80** Talking Thomas & Percy Train Set | C ×6, CU4, CS2, TL, TR ×2, PR, PL, S1 ×2, TU4, AL ×4, BS1, Brendam Docks curve, loading station, Vicarstown bridge, supports RR1 ×2, RS2 ×4, D1 ×2 |
| **HNP81** Connect & Build Track Bucket | CHT, AL ×3, ES3 ×5, AR1, AR, C ×3, TR ×2, TL, BT1, S1 ×4, RRT, junction base, bucket lid (3-way fork), bucket (120° crossing + tunnel), BS2, supports RS1 ×4, RS2 ×6, RS3 ×4, D1 ×7 |

Pieces whose shape couldn't be confirmed from the instructions (for example the `PR`/`PL` offset, the station and the junction
base) are marked **estimated** in the catalog. Measure yours and calibrate in Settings, or add a custom piece.

Another 86 sets are included from their instruction sheets, by model number (full contents in `src/core/kits.ts`). Where a sheet
has no "What's Included" list, the kit is counted from the labelled pieces in its track layout, and the kit's source says so.

| Track | Sets |
| --- | --- |
| **2018+** (60° `C` curves) | FXX64, FXX65, FXX66, FXX69, GFJ76, GGL75, GDV43/GLK09, GHK83, GLL14, GPD84, GPD88 |
| **2014–2019** (45° `CS`/`CL` curves) | BDP11, BDP14/CJM95, BDP15, BHY49, BHY57, BHY58, CCF24, CCP27, CCP30, CDB57, CDB59, CDB60, CDB61, CDB66, CDB68, CHD21, CHX94/DPM62, CHY03, CHY06, DFM51, DFM53, DFM54, DFM61, DFN23, DFN29, DVF71, DVF73, DVF75, FBK07, FBK08, FBK47, FBK48, FBK52, FGR22/FPM59, FJK24, FJK25, FJK49, FJK50, FJL38, FJL40, FJL41, FJL44, GBN45, GPB49, BDP32, CCP26, CCP29 |
| **2009–2013** original TrackMaster (45° `C1` curves) | BBP07, BDP10, R9485, R9488, R9490, R9491, R9629, T0210, T0211, T0212, T0787, Y2024, Y8756, Y8757, R9633, V1578, V1579, V6453, V6753, V7624, V7625, V8902, V8903, V8904, W3078, W3542, X0464, X5346/Y1700 |

### Earlier track generations

- **2014–2019 track** uses 45° curves (8 make a circle): `CS`, and `CL` on a larger radius. Its switches branch on one of them
  (`TLS`/`TRS` on a CS, `TLL`/`TRL` on a CL, `YS`/`YL` both ways). `S2`, `S4` and `S8` are half, quarter and eighth straights.
  `E…`/`ES…` are ramps and `EC…`/`EL`/`ER` climbing curves, each counted as one level. Codes it shares with the 2018+ track (`S1`,
  `BS1`, `ES3`, `TU4`, `D1`, `RS1`–`RS3`, `RR1`) are the same pieces.
- **2009–2013 track** has older connectors: the 2014 sets include `HT` adaptors to join it. Its curves are also 45°. Where its
  printed code clashes with a later piece of a different shape, or it has no printed code, its code here ends in `-09` (for
  example `S1-09`, `T2-09`, `AL-09`).
- All of these are marked **estimated**: the angles come from the layout diagrams, but radii, ramp heights and short-straight
  lengths are estimates. Auto design only uses pieces shaped like the standard 60° pieces, so 45° track is for the builder.
- Play-feature track without a printed code (stations, tunnel bases, docks) isn't modelled; it's listed under each kit's extras.

## How auto design works

1. **Main line.** All curves turn by the standard angle (60°, or whatever the C curve is defined as), and straight-like pieces
   (straights, switch legs, station lanes) are multiples of half a straight. So a closed loop is a sequence of left/right curves (a "turn word") plus straight runs at known
   headings. For each turn word, the generator solves for run lengths that cancel the curves' offset (within the joint play) and
   picks from your inventory. Loops turn 360° in total. Figure-8s turn 0° and must cross on a raised section.
2. **Elevation.** Some curves of the loop become climbing curves (`AL`/`AR`/`AR1`), in a balanced up/down sequence that never
   goes below ground or above level 3. A right-hand bend can climb on an `AR` or descend on an `AL`, and vice versa.
   Raised straights use support-tab pieces (`TU4`, `ES3`, `CU4`) when available.
3. **Decoration.** Straights on the finished loop are swapped for same-length pieces: offset-switch double track, the two-lane
   station, passing loops (switch pairs joined by a short search for connecting track) and sidings ending in buffer stops.
4. **Checking and ranking.** Every candidate goes through the same validator as the builder and is scored. Interesting,
   compact layouts rank highest:
   - **Bridge crossings** score most: 30 points for each place track passes over other track with enough headroom (up to 3).
   - **Height:** 10 points per level the layout climbs to, plus up to 30 for how much of the track is raised.
   - **Compact:** up to 45 points for how densely the track fills its footprint.
   - Continuous running, features (station, sidings, passing loops) and pieces used add to it. S-bends, warnings and
     unsupported joints count against it.

   Figure-8s and hills are tried often so there are plenty to choose from. Results are de-duplicated, and the shapes are
   varied. Hover a result's score to see its breakdown. The weights are `SCORE_WEIGHTS` in `src/core/autogen.ts`.

The railroad rules it follows: continuous running on a closed main loop, no open ends (sidings end in buffers), crossings only with
grade separation, gentle grades and no switches on ramps, straights between opposite curves where possible, passing places so two
engines can meet, supports for raised track, and only pieces you own, in the space you have.

## Development

```bash
npm install
npm run dev          # browser at http://localhost:1420
npm test             # unit tests (core logic)
npm run build        # production web build in dist/
```

Desktop app (needs Rust; on Linux also `libwebkit2gtk-4.1-dev`, see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)):

```bash
npm run desktop:dev     # run the desktop app
npm run desktop:build   # build an installer for this OS
```

The **Desktop builds** GitHub Action builds Windows, macOS and Linux installers. Run it from the Actions tab, or push a `v*` tag.

### Code layout

```
src/core/     platform-independent logic (no DOM, no React) — reusable on mobile
  standards.ts  the track standard (60° curves, lanes, levels, headroom) and measuring guide
  pieces.ts     built-in pieces, described as paths in standard units
  catalog.ts    path definitions → ends, routes and shapes, using the calibrated units
  geometry.ts   2D math, turtle paths
  kits.ts       kit contents
  inventory.ts  owned kits + loose pieces
  layout.ts     placed pieces, ports, connectivity
  graph.ts      train-running analysis (loops, dead ends, reversing loops)
  validate.ts   checks and support planning
  operations.ts running checks (turning, reachability, conflicts, siding lengths, stops)
  sharing.ts    parts files and layout files that carry their custom pieces
  autogen.ts    auto design
  svg.ts        SVG export
src/ui/       React UI (builder canvas, inventory, catalog, auto design, settings)
  platform.ts   storage and file dialogs (browser or Tauri), the only platform-specific code
src-tauri/    desktop shell (also the entry point for Tauri mobile)
```

### Going mobile later

The UI already uses pointer events (tap, drag, pinch-zoom) and moves the tabs and palette to the bottom on narrow screens. To
ship on phones, run `npx tauri android init` / `npx tauri ios init` (Tauri mobile uses the same `src-tauri` crate through
`lib.rs`). Storage and file access go through `src/ui/platform.ts`.
