# TaskCanvas

Local-first visual todo app built with Tauri + React + Rust.

## Features in this scaffold

- Desktop app architecture with Tauri 2, React, TypeScript, Rust
- SQLite local database managed by Rust
- Todo CRUD with priority, tags, soft delete, version, sync_status
- Visual canvas with draggable/resizable todo cards
- Paste image with Ctrl+V
- Drag/drop image files onto the canvas
- Local image storage under the app data directory
- Attachment metadata in SQLite
- Export current snapshot JSON to clipboard
- Cloud-sync-ready schema: UUIDs, version, updated_at, sync_status, soft delete, attachment registry

## Project path

Windows: `E:\AI\task-canvas`

WSL: `/mnt/e/AI/task-canvas`

## Run frontend only

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. Tauri commands will only work inside the Tauri shell, so frontend-only mode is mainly for UI iteration.

## Run desktop app

Rust is required. In this environment `rustc` was not installed yet.

Install Rust in WSL if needed:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Install Tauri Linux dependencies if WSL/Linux build packages are missing:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Then run:

```bash
npm install
npm run tauri:dev
```

## Data model

- `todos`: task data, soft delete, sync_status, version
- `attachments`: image/file registry, local_path, MIME, size, future object-storage mapping
- `board_items`: canvas layout metadata: x/y/width/height/z_index and item refs

Future sync can push pending rows by `sync_status`, upload attachment files to Supabase Storage / S3 / Cloudflare R2, then mark rows synced.
