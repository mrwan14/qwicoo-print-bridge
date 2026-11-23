# Qwicoo Print (print bridge)

A small Windows app (with a macOS build for testing) that prints Qwicoo kitchen tickets straight to the restaurant's thermal printer
(network or USB), with no browser, no print dialog and no one signed in. It reports the printer's
status (out of paper, cover open, offline) so cashiers get an alert. Spec and plan live in the
backend repo: `docs/specs/print-bridge.md`, `docs/plans/print-bridge.md`.

## How it works
1. A branch admin creates a pairing code in Qwicoo (Branch settings → Kitchen & printing → Paired printers).
2. The app exchanges the code for a device token (stored encrypted with Windows DPAPI) and picks a printer.
3. Every 3 s it pulls waiting tickets, draws each one exactly like the web ticket (so Arabic always
   works), turns it into a black-and-white image and sends ESC/POS bytes to the printer.
4. A ticket is acknowledged only when the printer took it and reports no problem. Every 10 s it
   reports the printer status; Qwicoo alerts staff after 30 s of a problem.

## Layout
- `src/core/`: no Electron: ESC/POS encoding, status parsing, image → raster, API client, print loop,
  ticket layout (copied from the frontend). Reusable by an Android app later.
- `src/main/`: Electron main process: ticket rendering, network (TCP 9100) and USB transports
  (Windows spooler RAW; CUPS `lp -o raw` on macOS), config, logs, tray, auto-update (Windows only).
- `src/renderer/`: the setup/status window (plain HTML/TS, Arabic + English).
- `test/`: Vitest, including a fake network printer that can run out of paper.

## Develop
```bash
npm install
npm test                 # unit + fake-printer tests
npm start                # run the app (unset ELECTRON_RUN_AS_NODE if your terminal sets it)
npx electron scripts/render-sample.cjs   # writes sample tickets to ./samples
python3 scripts/decode-bin.py samples/ticket-ar-80.bin out.png   # what the printer would print
npm run dist:win         # Windows installer in ./release (unsigned)
npm run dist:mac         # macOS .dmg (Apple Silicon) in ./release, ad-hoc signed, for testing
npm run virtual-printer  # pretend network printer on 127.0.0.1:9100; each ticket opens as a PNG
```
API base defaults to `https://api.qwicoo.com/api/v1`; override with `QWICOO_API_URL`.

## Test on a Mac without a printer
1. `npm run virtual-printer` and leave it running (keys: `p` paper out, `c` cover open, `o` offline, `r` ready).
2. `npm run dist:mac`, open `release/Qwicoo-Print-<version>-arm64.dmg`, drag the app to Applications.
3. To use a local backend, start the app from Terminal the first time; the server is saved when you pair:
   `QWICOO_API_URL=http://localhost:8010/api/v1 "/Applications/Qwicoo Print.app/Contents/MacOS/Qwicoo Print"`
   (To go back to production later, delete `~/Library/Application Support/Qwicoo Print/config.json`.)
4. In that window, pair with a code from Branch settings → Kitchen & printing, choose **Network printer**, IP `127.0.0.1`, port `9100`.
5. Place an order: the ticket opens as an image. Press `p` in the virtual printer and Qwicoo alerts staff after ~30 s.

A real USB printer on a Mac: add it in System Settings → Printers & Scanners (any driver, e.g. "Generic"),
then pick it under **USB printer**. The Mac build is unsigned by Apple and doesn't auto-update; it's for
testing until we buy an Apple Developer ID.

## Release
Tag `vX.Y.Z` on main: CI builds the installer and publishes it to GitHub Releases. Installed apps check
daily and install at a quiet moment (no tickets waiting). The installer is unsigned for the pilot
(Windows SmartScreen: "More info" → "Run anyway"); buy a code-signing certificate before wider rollout.

Real-hardware checks are in [docs/b0-hardware-test.md](docs/b0-hardware-test.md).
