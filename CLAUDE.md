# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VNote is an AI-powered video note-taking desktop app (Tauri 2). Users upload videos (optional subtitles), pick an AI model, and generate markdown notes, chapters, highlights, flashcards, mind maps, and a knowledge-base Q&A layer over those notes.

Frontend: `src/` (React 19, TypeScript, Vite 7, Tailwind CSS 4). Backend: `src-tauri/` (Rust, Tauri 2, SQLite via rusqlite + r2d2). Icons: Lucide React.

FFmpeg must be on PATH (TS→MP4 conversion and video frame capture). Verify with `ffmpeg -version`.

## Commands

```bash
npm install                 # install frontend deps
npm run tauri dev           # full app with hot reload (starts Vite then Tauri)
npm run dev                 # frontend only (Vite on http://127.0.0.1:5174)
npm run build               # tsc + vite build (also used as Tauri beforeBuildCommand)
npm run tauri build         # production desktop bundle
npm run test                # Vitest once
npm run test:watch          # Vitest watch
```

Run a single frontend test by file or name:

```bash
npm run test -- src/utils/markdownAssembler.test.ts
npm run test -- -t "formatTimestamp"
```

Rust tests (from `src-tauri/`):

```bash
cargo test
cargo test validation       # single crate test target / filter
```

No ESLint/Prettier script exists; do not add one unless asked. Match existing formatting.

Logs: `RUST_LOG=debug` overrides the default `info` filter. Files rotate daily under the data root `logs/` directory.

## Architecture

### Frontend ↔ backend

The UI talks to Rust exclusively via `invoke("command_name", payload)` (`@tauri-apps/api/core`) and `listen(eventName)` (`@tauri-apps/api/event`). Long-running work (note generation, chapter/highlight/flashcard/blueprint generation, chat, knowledge-base indexing, note initialization, TS conversion) returns a generation/request id; progress arrives as Tauri events named like `note-generation-{id}`, `chapter-generation-{id}`, `chat-{id}`, `blueprint-generation-{id}`, `note-initialization-{id}`, `ts-conversion-complete`.

Frontend generation UI state lives in a module-level map (`src/utils/noteGenerationState.ts`) so it survives tab switches without polling.

Detect the desktop shell with `Boolean(window.__TAURI_INTERNALS__)`. Guard all window / dialog / invoke calls behind that check.

### View routing

`currentView` in `NotesContext` (exposed via `useApp`) is one of:

`home` | `settings` | `note` | `collection` | `recent-notes` | `knowledge-base`

Constants: `VIEW_TYPES` in `src/types/index.ts`. Settings remembers the previous navigable view and returns to it. `NotePage`, `CollectionPage`, `RecentNotesPage`, and `KnowledgeBasePage` are lazy-loaded from `src/App.tsx`.

### State management

`AppProvider` nests domain providers. **Order matters** (outer providers are visible to inner ones):

`SidebarProvider` → `SettingsProvider` → `UploadProvider` → `NotesProvider` → `InitializationRuntimeProvider` → `CollectionsProvider` → `AppContextBridge`

`useApp()` is the backward-compatible facade. Prefer the split hooks in performance-sensitive components: `useSidebar`, `useSettings`, `useUpload`, `useNotes`, `useCollections`. `useApp` throws if used outside `AppProvider`.

Shared types live in `src/types/index.ts` (and `src/types/noteInitialization.ts`). They mirror the Rust structs in `src-tauri/src/db.rs`.

### Note page

`NotePage` is a video player + resizable content panel + floating chat window.

`NoteContentPanel` owns the tabbed generated artifacts. Tab ids: `summary` | `original` | `highlights` | `script` | `visual` | `custom` | `ai_note` | `flashcard` | `panoramic_blueprint` | `quicknotes` | `mindmap` | `canvas`.

A `Note` row stores those artifacts as nullable strings (JSON or markdown) plus `video_path`, `subtitle_path`, playback position, and suggested questions.

### Note initialization pipeline

Creating a note can enqueue an item-level initialization run (`note_initialization.rs`). Items (ASR, chapters, summaries, highlights, etc.) have dependencies, persist in `note_initialization_runs` / `note_initialization_items`, and do **not** auto-resume after app restart — the UI only shows persisted status. Runtime execution is owned by `InitializationRuntimeContext`. Missing subtitles can be produced via Bilibili BCut ASR (`bcut_asr.rs`).

### AI, RAG, knowledge base

- Chat / generation models: `AiConfig` `{id, title, base_url, api_key, model, reasoning_effort, sort_order, is_default, concurrent_limit, request_timeout, rate_limit}`. `reasoning_effort`: `off` | `low` | `medium` | `high` | `xhigh` | `max` | `ultra`.
- Embeddings and rerankers are separate config tables (same shape minus the extra AI fields).
- Per-config API keys are stored in the OS keyring (`keyring_manager.rs`, service prefix `com.leica.vnote`). SQLite keeps the placeholder `***MIGRATED***`.
- `ai_pool.rs` is the shared HTTP/streaming client: per-config concurrency slots, abort flags, retries, reasoning-effort headers.
- Per-note RAG (`rag.rs`) embeds subtitle chunks into `subtitle_chunks` and is used by in-note chat (`chat.rs`) when `use_rag` is true.
- Cross-note knowledge base (`knowledge_base/`) indexes note content into `knowledge_chunks`, supports search plus standard/agent chat sessions.

Prompts for generation/chat live in `src-tauri/src/prompts.rs`. User-editable prompt templates are `prompt_configs`.

### Persistence and files

SQLite file: `{data_root}/db/vnote.db` (WAL, foreign keys, pool size 10). Schema: `src-tauri/src/sql/init.sql`.

`data_root` (`storage_paths.rs`) is `<exe>/data` if writable, otherwise the OS app-data directory. Per-note assets: `{data_root}/notes/{note_id}/` (`chapter_screenshots`, `ai_note_screenshots`, `assist_screenshots`, `subtitle`). Cache and logs sit beside `db/` and `notes/`.

IDs are snowflake strings (`snowflake.rs`).

### Video playback

Custom URI scheme `video-stream://` (`video_server.rs`) serves local files with HTTP Range (max 10 MB per response). CSP in `tauri.conf.json` allows `http://video-stream.localhost` and `http://asset.localhost`. Player is Plyr; TS files are converted to MP4 with ffmpeg (`convert_ts_to_mp4` / `start_ts_conversion`).

### Window / theme / tray

Window starts `visible: false` (min 1024×700), is sized to ~90% of the primary monitor in `run()`, and is shown from React via `invoke("show_window")`. Windows builds strip native decorations and use a custom title bar: `data-tauri-drag-region` for drag, `data-tauri-drag-region="false"` on interactive controls, `getCurrentWindow()` for min/max/close.

Theme is `'light' | 'dark'`, applied as the `dark` class on `document.documentElement`, persisted through `get_app_settings` / `set_theme`. Default is dark.

Optional tray: close hides the window instead of quitting. Single-instance plugin focuses the existing window.

Settings tabs: `"general" | "model" | "prompt" | "data-management" | "initialization-management"`.

### Styling

Tailwind 4 `@theme` tokens in `src/index.css`: `vnote-bg`, `vnote-card`, `vnote-border`, `vnote-hover`, plus surface/accent/glass variants. Merge classes with `cn` (`src/utils/cn.ts`). Glass panels go through `useGlassBg("card" | "panel" | "modal" | "input" | "menu")` so background-image mode stays consistent. Prefer existing tokens over new hardcoded colors.

### Backend module map

| Module | Role |
|---|---|
| `lib.rs` | App builder, most `#[tauri::command]`s, tray, export |
| `db.rs` | All SQLite access |
| `note_generation.rs` / `chapter.rs` / `highlight_generation.rs` / `flashcard_generation.rs` / `blueprint_generation.rs` / `subtitle_optimizer.rs` | Artifact generators |
| `note_initialization.rs` | Orchestrates those generators as a DAG |
| `chat.rs` + `rag.rs` | In-note streaming chat |
| `knowledge_base/` | Cross-note index, search, agent chat |
| `ai_pool.rs` | Shared LLM HTTP + abort |
| `validation.rs` | Command input checks |
| `data_management.rs` | Scan / cleanup of on-disk caches |

### Code style (from AGENTS.md)

- TypeScript + JSX, 2-space indent, double quotes, semicolons.
- Components `PascalCase.tsx`; hooks `useXxx`; utils `camelCase.ts`; constants `UPPER_SNAKE_CASE`.
- Import order: React → third-party → local → styles. Use `import type` for types.
- `tsconfig` is `strict` with `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`.
- Tests: `*.test.ts(x)` next to source; Vitest + Testing Library + fast-check; jsdom + global `vi` (`src/test/setup.ts`). Mock `@tauri-apps/*` with `vi.mock`.
- Tauri calls: `try/catch` and `console.warn` / `console.error`.
