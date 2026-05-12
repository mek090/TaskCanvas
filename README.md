# TaskCanvas

[![CI](https://github.com/mek090/TaskCanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/mek090/TaskCanvas/actions/workflows/ci.yml)

A local-first visual todo app — Tauri 2 + React 19 + Rust + SQLite. Tasks live in a side list and on a free-form canvas you can drag, resize, and drop images into.

## Features

- **Tasks** — title, description, priority (low/medium/high), tags, due date, soft delete, version + sync_status fields, all UUID-keyed
- **Trash & purge** — soft-deleted tasks land in a Trash view. Restore from Trash, purge a single task (cleans linked board cards + attachments + image files), or empty the whole trash (also cleans orphan attachments)
- **Due dates** — date picker in composer / list / inspector; overdue and "due today" badges; sort by due date first or recently updated; dedicated Due filter
- **Canvas** — drag-and-drop layout for todo cards and pasted/dropped images, resize from the bottom-right, priority accent strip, completed-task styling
- **Image attachments** — Ctrl+V to paste, drag-drop image files; stored under `app_data_dir/images/` with the SQLite registry. 15 MB max per image; PNG / JPEG / WebP / GIF only
- **Backup / restore** — `.taskcanvas.zip` archive with `manifest.json`, per-entry SHA-256 checksums, transactional import that snapshots the live DB to `taskcanvas.sqlite3.bak-{timestamp}` before replacing it. Zip-slip safe (attachment paths are reduced to basenames; canonical-path check on export)
- **Undo toast** — 7-second window after deletes (tasks and canvas items) to undo
- **Confirm modal** — custom dialog for destructive actions (purge, empty trash, replace-and-import); focus-trapped, ESC and backdrop dismiss
- **Web demo fallback** — when launched outside Tauri (e.g. `npm run dev`), the same UI runs against a `localStorage` adapter so you can browse the UI without the desktop runtime

## Project layout

```
src/
  App.tsx                  state + business logic (composition root)
  main.tsx                 mount + re-export App
  lib/
    types.ts               domain types + constants
    dates.ts               due-date helpers + sort comparators
    files.ts               uuid / timestamp / fileToDataUrl / isTextEditingTarget
    api.ts                 isTauri + call<T> + localStorage adapter
  hooks/
    useToast.ts            toast state + 7s timer
    useConfirm.ts          confirm-modal state
  components/              13 presentational components (Sidebar, Topbar,
                           CanvasView, ListView, Inspector, Composer,
                           SearchToolbar, ConfirmDialog, Toast, EmptyState,
                           TipsCard, EditableInput, EditableTextarea)
  App.test.tsx             4 Vitest flow tests
  test/setup.ts            RTL + jest-dom + localStorage / clipboard mocks
src-tauri/src/
  lib.rs                   tauri::Builder + invoke_handler glue
  models.rs                Todo / BoardItem / Attachment / PurgeResult / *Input
  db.rs                    schema, migrations, conn(), init_db_inner()
  todos.rs                 CRUD + sort + trash + purge + orphan cleanup
  board.rs                 board_items CRUD
  attachments.rs           image save/load + parse_data_url + sanitize_file_name
  backup.rs                .taskcanvas.zip export/import + export_snapshot
  tests.rs                 23 unit + integration tests
```

## Develop

Install deps once:

```bash
npm install
```

### Frontend / web demo (no Rust needed)

```bash
npm run dev          # Vite dev server, runs the localStorage adapter
npm run build        # tsc + production bundle
npm run preview      # serve the production bundle locally
```

### Desktop app

Requires the Rust toolchain (`rustc`, `cargo`).

```bash
npm run tauri:dev    # dev shell against local Rust
npm run tauri:build  # release bundle (msi + nsis on Windows)
```

`tauri:build` pins `CARGO_BUILD_JOBS=1` and `[profile.release] codegen-units = 1`
to avoid `STATUS_STACK_BUFFER_OVERRUN` during parallel rustc on Windows.

On Linux you'll need the standard Tauri deps:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev build-essential \
  curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Test

```bash
npm test              # cargo test --lib (23 Rust tests)
npm run test:frontend # Vitest run (4 flow tests)
npm run typecheck     # tsc --noEmit
npm run lint:rust     # clippy --all-targets -- -D warnings
npm run fmt:rust:check
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on Ubuntu for every push to `main`.

## Data model

| Table | Purpose |
|---|---|
| `todos` | Task rows. Soft delete via `deleted_at`; per-row `version` + `sync_status` columns for future cloud sync |
| `attachments` | Local image registry. `local_path` points under `app_data_dir/images/`; canonicalized on read |
| `board_items` | Free-form layout: `x` / `y` / `width` / `height` / `z_index` + `item_type` ∈ {todo, image, note} + `ref_id` pointing into todos or attachments |
| `schema_migrations` | Records applied migrations |

A pre-migration backup (`taskcanvas.sqlite3.premigration-{timestamp}`) is taken automatically when any schema migration runs against a non-empty DB.

## Backup format

`*.taskcanvas.zip` layout:

```
manifest.json                # format, format_version, schema_version, app_version, exported_at, counts
checksums.json               # { "data/todos.json": "<sha256>", ... } — manifest itself is NOT checksummed
data/todos.json              # all todos including soft-deleted
data/board_items.json
data/attachments.json        # local_path rewritten to relative images/{basename}
images/{basename}            # one entry per attachment file
```

Import verifies each entry's SHA-256 against `checksums.json`, refuses format/schema versions newer than the current app, then atomically replaces all live rows inside a transaction.
