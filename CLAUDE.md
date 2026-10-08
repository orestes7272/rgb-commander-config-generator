# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RGB Commander Studio: a browser app for designing RGBcommander `.rgba` lighting files for Ultimarc LED boards (mainly the I-PAC Ultimate I/O), published to a folder that Syncthing carries to an arcade cabinet. It ships as a Docker image (Unraid), and as a Linux AppImage. The README covers deployment and the RGBcommander format facts in detail.

## Commands

No dependencies, no bundler, no linter config. Node >= 22.2 (CI and the image use Node 24).

```sh
npm test                                   # node --test test/*.test.js
node --test test/api.test.js               # one suite
node --test --test-name-pattern="publish" test/api.test.js   # tests matching a name
npm run dev                                # http://localhost:8080, data in .dev/config, output in .dev/output
npm run desktop                            # desktop launcher (own window, quits when it closes)
npm run appimage                           # dist/RGB_Commander_Studio-<version>-<arch>.AppImage (ARCH=aarch64 for ARM)
npm run icon                               # regenerate public/icon-256.png
docker build -t rgb-commander-studio .
```

The API tests start a real server with `start({ PORT: '0', DATA_DIR, OUTPUT_DIR })` on temp folders. There are no automated UI tests: check UI changes in a browser with `npm run dev`.

## Architecture

**Shared core.** `public/js/core/` (file format, board wiring, colours, layouts, effects, gradients) is imported by both the browser and the server (`server/api.js` imports `../public/js/core/*.js`). Keep it environment-neutral: no DOM, no `node:` modules. Validation (`sanitizeProject`, `sanitizeLayout`) lives there too, and the server re-runs it on every write.

**Data model.** A scheme ("project", id `p_…`) stores frames as `{ id, ms, pins }`, where `pins` is the raw array of LED pin values (96 for the Ultimate I/O) exactly as they go into the file. Button colours are derived, not stored: the panel layout maps each control to pins via `resolveWiring` in `core/boards.js`. On the Ultimate I/O, ports 1–16 are wired R,G,B and ports 17–32 are B,G,R. Read and write a control's colour with `getControlColor` / `setControlColor` (`core/project.js`) rather than indexing `pins` directly.

**`.rgba` constraints** (verified against RGBcommander 0.4.0.5, see README):
- Values are bytes, so 0–255, including frame delays.
- A frame's `ms` may be up to 60000. `exportFrames` / `splitDelay` splits long holds into repeated ≤255 ms frames on export.
- Output is tab-indented with CRLF line endings.
- On import, short frames are repeated across all pins (`expandToPins`), the way the daemon plays them.
- File names are limited to letters, digits, `-` and `_`. `OFF`, `RANDOM` and `STATIC` are reserved.
- `test/fixtures/*.rgba` must stay byte-exact; `.gitattributes` marks `*.rgba -text`.

**Server** (`server/`, Node built-ins only; the Dockerfile copies just `package.json`, `server/` and `public/`):
- `index.js`: `createHandler` / `start`.
  - Host check when bound to loopback (blocks DNS rebinding for the desktop app).
  - Optional basic auth; `/api/health` is always open.
  - Same-origin check on `/api/*`.
  - Static files are served with a strict CSP (`script-src 'self'`): no inline scripts and no CDN assets.
- `http.js`: a tiny `Router` (`router.add(method, '/api/x/:id', handler)`). Handlers return JSON. `throw new HttpError(status, message, extra)` merges `extra` (e.g. `{ code: 'conflict' }`) into the error body, and the client branches on `code`.
- `api.js`: every route. Data in `DATA_DIR` is `projects/<id>.json`, `layout.json`, `settings.json` and `backups/`.
  - **Publish status** comes from formatting-independent content hashes. `projectHash` vs `fileHash` vs the stored `publishedHash` gives `unpublished` / `published` / `changed` / `foreign`.
  - **Publishing over a file this scheme didn't write** returns 409 `code: 'exists'` unless `overwrite: true` is sent.
  - **Replaced or deleted output files** are backed up first (`BACKUPS_PER_FILE`).
  - **Saving a scheme** uses an optimistic `rev`. A mismatch returns 409 `code: 'conflict'`; `?force=1` overrides it.
- `storage.js`: `writeFileAtomic` writes through `.syncthing.<name>.<rand>.tmp` temp files, which Syncthing never syncs, so a half-written file can't reach the cabinet.
- `config.js`:
  - `OUTPUT_DIR` set (the container): the output folder is fixed.
  - Unset (dev/desktop): it can be changed in Settings (`outputDirEditable`).
  - Without env vars, data and output default to `.dev/`. The Docker image sets `/config` and `/output`.
- `system.js`: when started as root, chowns the data/output folders to `PUID:PGID` and then drops privileges. `permissionAdvice` turns EACCES into an actionable message (`code: 'not-writable'`).
- `desktop.js`: the AppImage entry point (`packaging/appimage/AppRun` runs it with the bundled Node). Starts the server on 127.0.0.1:47821 with `RCS_DESKTOP=1`, reuses an already-running copy (found via `/api/health`) and opens an app window. The page pings `api/desktop/ping` every 5 s (`hooks.onPing`/`onBye`), and the process exits once pings stop.

**Frontend** (`public/js/`, plain ES modules loaded by `index.html`):
- `main.js`: hash router (`#/editor/<id>`, `#/layout`, `#/files`, `#/settings`). Views in `views/` are classes with `mount(root, arg)` / `unmount()`; the editor also has `open(id)` for switching schemes without remounting.
- `store.js`: the singleton state and event bus (`store.on(topic, fn)` / `emit`).
  - Debounced autosave of the scheme and layout.
  - Undo/redo from snapshots.
  - Frame edits go through `store.changeFrames(fn)`. Wrap drags in `beginGesture()` / `endGesture()` so a drag is one undo step.
- `api.js`: fetch wrapper. URLs are relative (`api/...`, no leading slash) so the app works behind a reverse-proxy sub-path.
- `dom.js`: `h('tag#id.class', props, ...children)` element builder (style objects accept `--custom-props`) and the inline SVG icon set. `ui/` holds reusable widgets (colour picker, panel SVG, timeline, dialogs).
- Effects (`core/effects.js`) are a registry of `{ id, name, params[], run(ctx, p) }`. `run` returns `{ mode: 'insert' | 'replace', frames }`, and the effects dialog renders `params` generically. `STARTERS` seed new schemes. `core/gradient.js` is shared by the Gradient tool and the Gradient effect.
- Previews: LED values are PWM duty (linear light), so `ledToScreen` (`core/color.js`) converts them to sRGB. Playback adds `frameWriteMs` per frame to mimic the daemon's USB write time.

## Other folders

- `device/`: systemd path/service units and an installer that restart RGBcommander on the cabinet when Syncthing delivers files (the daemon only loads animations at startup).
- `unraid/`: an optional classic Unraid template. `docker-compose.yml` is the main install route.
- CI (`.github/workflows/`):
  - Pushes to `main`: tests, then the multi-arch image `ghcr.io/orestes7272/rgb-commander-config-generator` is published.
  - `v*` tags: AppImages for x86_64/aarch64 are built and attached to the release.
- `roms/` is gitignored and unrelated to the app (local game ROMs and a ROM-hack build kit). Never commit it.
