# VNote Copilot Instructions

## Architecture Overview
VNote is a Tauri desktop application with a React/TypeScript frontend and Rust backend. The frontend uses Vite for building and Tailwind CSS for styling with custom theme variables.

## Key Components
- **Frontend**: `src/` - React app with custom title bar, theme switching, and settings page
- **Backend**: `src-tauri/` - Minimal Rust setup, ready for Tauri commands
- **Config**: `tauri.conf.json` - Window settings (1280x960, no decorations, custom title bar)

## Development Workflow
- **Dev server**: `npm run tauri dev` (runs `npm run dev` then launches Tauri)
- **Build**: `npm run tauri build` (compiles TypeScript, builds Vite, then Tauri)
- **Frontend only**: `npm run dev` for Vite dev server

## Styling Conventions
- Use Tailwind CSS with custom color variables: `vnote-bg`, `vnote-card`, `vnote-border`, `vnote-hover`
- Dark mode: Toggle `dark` class on `document.documentElement`
- Custom title bar: Use `data-tauri-drag-region` for draggable areas, `data-tauri-drag-region="false"` for non-draggable
- Window controls: Use `@tauri-apps/api/window` for minimize/maximize/close

## AI Integration Pattern
- AI configs stored as array of objects: `{id, title, base_url, api_key, model, sort_order}`
- Support multiple providers (OpenAI, DeepSeek, etc.)
- Test connections before saving configs
- Display configs in settings with edit/delete actions

## Code Patterns
- Theme state: `'light' | 'dark'` with effect to apply classes
- Window checks: `const isTauri = Boolean(window.__TAURI_INTERNALS__)`
- Drag handling: `getCurrentWindow().startDragging()` on mousedown
- Settings tabs: `"general" | "model"` with conditional rendering

## File Structure Examples
- Frontend components: `src/App.tsx`, `src/SettingsPage.tsx`
- Rust entry: `src-tauri/src/main.rs` calls `vnote_lib::run()`
- Configs: `package.json` scripts, `tauri.conf.json` for app settings</content>
<parameter name="filePath">d:\workspace\rust\vnote\.github\copilot-instructions.md