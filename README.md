# VNote

AI-powered video note-taking desktop application built with Tauri 2.

## Features

- Upload videos with optional subtitles
- AI-powered note generation from video content
- Support for multiple video formats including TS (MPEG Transport Stream)
- RAG-based Q&A with video subtitles

## Prerequisites

### FFmpeg (Required for TS video support)

VNote requires FFmpeg to convert TS video files. Install it based on your operating system:

**Windows:**
1. Download FFmpeg from https://ffmpeg.org/download.html
2. Extract and add the `bin` folder to your system PATH
3. Verify installation: `ffmpeg -version`

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install ffmpeg
```

**Linux (Fedora):**
```bash
sudo dnf install ffmpeg
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run tauri dev

# Build for production
npm run tauri build
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Rust, Tauri 2
- **Database**: SQLite (via rusqlite)
