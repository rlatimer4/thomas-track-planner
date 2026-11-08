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
| **Build** | Tap a piece in the palette to add it. New pieces attach to the selected (orange) open end, and the next end is selected automatically, so you can keep tapping. **Turn** (or `F`) re-attaches the last piece the other way: a curve turns left instead of right, a ramp goes down instead of up, a switch is entered by a different leg. Tap a green end to build from it. Drag a piece to move it; it snaps when an end comes near another. `R` rotates, `Del` removes, `Ctrl+Z`/`Ctrl+Shift+Z` undo and redo. |
| **Auto design** | Choose a shape (any, loops only, figure-8), the features you want (sidings, station, hills) and, optionally, the space you have. It generates and ranks layouts. Hover the score to see how it was worked out. **Open in builder** to edit one. |
| **My track** | Set how many of each kit you own, or adjust loose pieces with + / − (negative numbers record lost pieces). You can also define your own kits. |
| **Catalog** | Every piece with its connectors, size and description. You can add custom pieces (straight, curve, switch, ramp, buffer, support). |
| **Settings** | Units (cm/in) and track geometry calibration. |

The **Checks** panel lists problems live: overlaps, height mismatches, open ends, ends that almost meet, pieces you don't have
enough of, raised joints without supports, S-bends, switches on ramps, long climbs and dead-end sections. **Parts** shows a bill of
materials, including the supports needed for raised track.

Layouts and inventory are saved automatically on the device. **Export/Import** moves layouts as `.track.json` files, and **SVG**
saves a printable drawing.

## Track system model

- **Connectors.** TrackMaster ends are genderless: any end joins any other end at the same height.
- **Geometry** (Settings → calibration; defaults are estimates, not published figures):
  standard straight `S1` 21 cm, curve `C` radius 20 cm turning 45° (8 make a circle), ramp `AL` 31.5 cm rising one level.
  Switches' straight legs equal a straight, and their branches equal a curve, so switches can replace straights anywhere.
  `PR`/`PL` offset switches shift the branch sideways by the lane spacing and end parallel, which is how the GLK80 loading station
  is fed.
- **Elevation** is counted in levels. Track may cross over other track that is at least one level lower (configurable). Raised
  joints need a support: a riser pier (`RR1`) for level 1, or a pair of supports (`RS1`/`RS2`/`RS3`) with a `D1` deck. Two stacked
  `RS1`s make a level-2 support. The lift bridge (`VB`) and the bucket lid (`XB`) support themselves.
- **Joint play.** Real toy track has a little slack. Ends within 12 mm and 4° count as connected (configurable). The auto designer
  only closes loops within 9 mm.

### Kits included

Contents are taken from each set's printed instructions ("What's Included"):

| Kit | Track pieces |
| --- | --- |
| **GLK80** Talking Thomas & Percy Train Set | C ×6, CU4, CS2, TL, TR ×2, PR, PL, S1 ×2, TU4, AL ×4, BS1, Brendam Docks curve, loading station, Vicarstown bridge, supports RR1 ×2, RS2 ×4, D1 ×2 |
| **HNP81** Connect & Build Track Bucket | CHT, AL ×3, ES3 ×5, AR1, AR, C ×3, TR ×2, TL, BT1, S1 ×4, RRT, junction base, bucket crossing lid, BS2, supports RS1 ×4, RS2 ×6, RS3 ×4, D1 ×7 |

Pieces whose shape couldn't be confirmed from the instructions (for example the `PR`/`PL` offset, the station, the junction base
and the bucket lid) are marked **estimated** in the catalog. Measure yours and calibrate in Settings, or add a custom piece.

## How auto design works

1. **Main line.** All curves turn by the same angle, and straight-like pieces (straights, switch legs, station lanes, ramps) are
   multiples of half a straight. So a closed loop is a sequence of left/right curves (a "turn word") plus straight runs at known
   headings. For each turn word, the generator solves for run lengths that cancel the curves' offset (within the joint play) and
   picks from your inventory. Loops turn 360° in total. Figure-8s turn 0° and must cross on a raised section.
2. **Elevation.** Ramps are placed as a balanced up/down sequence that never goes below ground and at most two levels up.
   Raised straights use support-tab pieces (`TU4`, `ES3`, `CU4`) when available, and two raised straights can become the lift
   bridge.
3. **Decoration.** Straights on the finished loop are swapped for same-length pieces: offset-switch double track, the two-lane
   station, passing loops (switch pairs joined by a short search for connecting track) and sidings ending in buffer stops.
4. **Checking and ranking.** Every candidate goes through the same validator as the builder and is scored on: pieces used,
   continuous running, features, elevation and crossings. S-bends, warnings and unsupported joints count against it. Results are
   de-duplicated, and the shapes are varied.

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
  geometry.ts   2D math, turtle paths
  catalog.ts    piece definitions built from calibration parameters
  kits.ts       kit contents
  inventory.ts  owned kits + loose pieces
  layout.ts     placed pieces, ports, connectivity
  graph.ts      train-running analysis (loops, dead ends, reversing loops)
  validate.ts   checks and support planning
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
