# BINGO — New Year Party 2027 (host-only, no backend)

A bingo web app for big parties. The host runs the game from a laptop (`/control`), the room watches a TV (`/display`), and players use **paper cards** printed from the app. Everything runs in the browser and works offline once it has loaded. There is no server, no login and no external services.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest, src/core)
npm run build      # production build -> dist/
npm run preview    # serve the built dist/ locally
```

Requires Node 18+.

## Deploy to Netlify

1. `npm run build`
2. Drag the `dist/` folder onto <https://app.netlify.com/drop> (or your site's **Deploys** page).

`public/_redirects` (`/* /index.html 200`) is copied into `dist/`, so `/control`, `/display`, etc. still work after a page refresh.

## Event-day flow

1. **`/` Library**: click **New game** (or import a backup).
2. **`/setup`**: set the event name, logo, card size, symbol set, prize rounds and number of cards. Check the **suspense estimator**, then press **Generate cards**. The settings are then **locked**. To change anything, use "Create a new game from these settings".
   Export the backup when prompted, so you can reprint identical cards on any machine.
3. **`/print`**: choose **Print** (browser print, A4) or **Export PDF** (vector, split into files every N pages).
4. **`/control`** on the laptop, then click **📺 Open TV screen**. Drag that window to the TV and press **Fullscreen** (the button hides after 3 s without mouse movement). Click the TV window once so its sound is allowed to play.
   With only one screen, use **🖥 Presenter mode** and toggle the control bar with `H`.

## Keyboard shortcuts (Control)

| Key | Action |
|---|---|
| `Space` | Draw a ball |
| `Ctrl+Z` | Undo the last draw (asks to confirm; also removes winners caused by that ball) |
| `P` | Pause / resume ("พักสักครู่" on the TV) |
| `N` | Next round |
| `R` | Reveal pending winners on the TV |
| `C` | Jump to the card checker |
| `H` | Show / hide the control bar (presenter mode) |
| `M` | Sound on / off |
| `?` | Shortcut list |
| `Esc` | Close dialogs / the rules popup on the TV |

## Adding logos, symbols and the brand colour

- **Event / company logo**: put files in `public/assets/brand/`. New games use `/assets/brand/event-logo.svg` (a placeholder is included, so replace it). `company-logo.png` is optional. You can also upload a logo on the Setup page.
- **Seagate product logos**: drop `exos.png`, `ironwolf.png`, `barracuda.png`, `firecuda.png`, `skyhawk.png`, `nytro.png` into `public/assets/symbols/seagate/`. Labels, Thai pronunciations (`speech`) and file names are in `manifest.json`.
  If an image is missing, the app shows a styled text badge with the label instead, so nothing breaks.
- **New bundled set**: create `public/assets/symbols/<id>/manifest.json` (same shape as the seagate one, `mode` = `columnLogo` or `image`) and add `<id>` to `public/assets/symbols/index.json`.
- **Upload in the UI**: Setup → *Manage symbol sets*. Create a set, upload PNG/SVG/WebP files, then edit labels and pronunciations. Images are stored in IndexedDB.
- **Brand colour**: edit `brandPrimary` in `src/themes/seagate.ts` (one hex value; every green in the theme is derived from it).
- **New theme**: copy `src/themes/blackGold.ts`, change the values, and add it to `THEMES` in `src/themes/index.ts`.
- **Text / wording**: every UI string is in `src/i18n/th.ts`.
- **Print layout** (cards per page, margins): `src/print/layouts.ts`.

## Symbol modes

| Mode | Card cells | Ball shown as |
|---|---|---|
| `number` | numbers, each column has its own range | number (letters B-I-N-G-O as headers) |
| `columnLogo` | numbers; the column header is a product logo (one logo per column, drag to reorder) | logo + number |
| `image` | images placed at random (pool = number of images) | image |

## Architecture

```
src/core/      pure logic + tests: rng (cyrb128→sfc32), cards, patterns (bitmasks), winners (Engine),
               game (reducer), estimate (Monte Carlo), verify (card checker), backup, symbols
src/state/     gameStore (reducer + localStorage), images (IndexedDB), symbolSets, sync (BroadcastChannel),
               publicState (what the TV may see), engine cache, backupIO
src/pages/     LibraryPage, SetupPage, PrintPage, ControlPage, DisplayPage
src/components/ CardView, Ball, SymbolView, Estimator, SymbolSetEditor, stage/ (TV stage, audio)
src/print/     layouts, pdfExport (jsPDF vector + embedded Thai font)
src/themes/    seagate, blackGold
src/workers/   estimate.worker.ts
```

- **Cards are never stored.** Card *n* is rebuilt from `(seed, n, attempt)`. The only extra data is a small map of card numbers that collided with an earlier card and were regenerated.
- **Check code**: 4 characters derived from hash(seed + card number), using an alphabet without O/0/I/1. A card whose number has been altered will fail the check.
- **Draws** use `crypto.getRandomValues` at the moment the host presses draw. They never use the seed and are never pre-generated.
- **The TV receives only `PublicState`**: unrevealed winners and card numbers are never sent. The "one away" count is public, but which cards are one away is not. `buildPublicState` also sanitizes the live overlays itself (defense in depth), and `src/state/publicState.test.ts` plays full games, including mid-reveal and deliberately buggy overlay input, asserting that no unrevealed winner or check code ever appears.
- All state changes go through one pure reducer (`src/core/game.ts`). The game is saved to localStorage on every change, so a refresh or browser restart resumes exactly where it left off.

## Dependencies

`react`, `react-dom`, `react-router-dom`, `jspdf`, `canvas-confetti`, `idb-keyval`, and dev-only: `vite`, `typescript`, `vitest`, `@vitejs/plugin-react`, type packages (`@types/node` is only for `vite.config.ts`, type-checked via `tsconfig.node.json` so Node globals stay out of the browser code). No other runtime dependencies. `html2canvas` (an optional jsPDF dependency, only used by `doc.html()`, which this app never calls) is aliased to a tiny stub in `vite.config.ts`, saving about 200 kB.

Fonts are bundled from Google Fonts' OFL repository: Sarabun, Kanit and Trirong (licences in `src/assets/fonts/OFL-*.txt`).

## Known limitations

- **Thai text in PDFs**: jsPDF does not do OpenType shaping. Plain Thai is drawn as vector text with the embedded Sarabun/Kanit font. Strings with *stacked* marks (an upper vowel plus a tone mark, e.g. ที่, เลี้ยง, น้ำ) are drawn as an image rendered by the browser instead, so they look correct but aren't selectable text. The image resolution is derived from the printed size: it targets 450 DPI and is never below 300 DPI (unit-tested). The Print page reports the lowest value after each export (≥ 451 DPI on the default layouts).
- The voice call-out needs a `th-TH` voice in the OS/browser (e.g. Windows "Microsoft Pattara/Premwadee", or Chrome's Google Thai). Without one, the voice toggle is disabled.
- Browsers block sound until the TV window has been clicked once ("คลิกที่จอเพื่อเปิดเสียง").
- If the Control window is closed, the TV keeps showing the last state and shows the "รอการเชื่อมต่อกับ host" badge.
- **Reveal / "show card" overlays are deliberately not persisted.** If Control is refreshed (or closed and reopened) mid-reveal, it sends a fresh snapshot and the TV goes back to the normal board. The winners stay revealed and appear in the winners hall, so press *Reveal* again if you want to replay the sequence. Replaying a timed sequence after an accidental refresh would surprise the room, and a stale overlay must never get stuck on the TV. The copy of the public state kept in localStorage (used when the TV is opened without Control) never contains overlays.

## QA checklist (run manually before the event)

- [ ] Print **one real page** (color and ink-saver). Check that the size is A4, nothing is cut off, the card number and code are legible, and the cut lines are in the right place.
- [ ] Export a PDF and open it. Check that the Thai text is correct (vowels and tone marks), the logos look sharp and the file size is reasonable. Try 1000 cards (should take a few seconds, split into files).
- [ ] Open `/control` + `/display` in two windows. Draw a ball and check that the TV animates and the board lights up.
- [ ] Refresh the TV mid-game: it should show the current state straight away. Refresh Control mid-game: nothing should be lost.
- [ ] Close Control: the TV shows the "waiting for host" badge.
- [ ] Presenter mode on a single screen: `H` toggles the bar, and no private info shows while it is hidden.
- [ ] Switch theme mid-game: the TV, Control and card preview all change.
- [ ] Card checker: a real winning card → ✅; a wrong code → ❌; a card that won an earlier round → ⚠️.
- [ ] Undo after a winning draw: the winner disappears.
- [ ] Play a **full 3-round game** (line → X → full card) including reveals.
- [ ] Export a backup, import it on another browser/machine, and check that the reprinted card #0001 is identical and the game continues.
- [ ] Test sound/voice on the venue's speakers, and check readability of the TV from the back of the room.
