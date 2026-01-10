# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VNote is an AI-powered video note-taking desktop application built with Tauri 2. Users upload videos with optional subtitles, select an AI model, and generate markdown notes from video content.

## Commands

```bash
# Development (full Tauri app with hot reload)
npm run tauri dev

# Frontend only (Vite dev server on port 5174)
npm run dev

# Production build
npm run tauri build
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS 4
- **Backend**: Rust, Tauri 2
- **Icons**: Lucide React

## Architecture

### State Management
Global state via React Context (`src/context/AppContext.tsx`). Manages sidebar, folders, notes, stats, AI configs, and view routing. Currently uses mock data.

### View Routing
Three views controlled by `currentView` state: `"home"` | `"settings"` | `"note"`

### Tauri Integration
- Custom title bar with `data-tauri-drag-region` for draggable areas
- Use `data-tauri-drag-region="false"` on interactive elements (buttons)
- Window initially hidden, shown after React mounts via `invoke("show_window")`
- Tauri detection: `Boolean(window.__TAURI_INTERNALS__)`

### Theme System
- Dark mode default, toggle via `dark` class on `document.documentElement`
- Custom Tailwind variables: `vnote-bg`, `vnote-card`, `vnote-border`, `vnote-hover`

### AI Configuration
Array of configs: `{id, title, base_url, api_key, model, sort_order}`. Supports multiple providers (OpenAI, DeepSeek, etc.).

## Key Patterns

```typescript
// Theme toggle
document.documentElement.classList.add("dark"); // or remove()

// Window controls
import { getCurrentWindow } from "@tauri-apps/api/window";
getCurrentWindow().minimize();
getCurrentWindow().toggleMaximize();
getCurrentWindow().close();

// Drag handling for custom title bar
const handleMouseDown = (e: React.MouseEvent) => {
  if (e.target.closest('[data-tauri-drag-region="false"]')) return;
  getCurrentWindow().startDragging();
};
```
