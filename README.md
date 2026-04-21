# Hearth — Local AI Personal Assistant

> Privacy-first AI assistant. All processing happens on your machine via Ollama. Your data never leaves your computer.

## Prerequisites

- [Node.js 20+](https://nodejs.org) — download and install first
- [Ollama](https://ollama.com) — already installed ✓

## Setup (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Start the web app (dev mode)
npm run dev:web

# Open http://localhost:3000 in your browser
```

## Run as Desktop App (Electron)

Open two terminals:

```bash
# Terminal 1 — Next.js server
npm run dev:web

# Terminal 2 — Electron desktop window
npm run dev:electron
```

Or run both together:
```bash
npm run dev
```

## First Time Setup

1. Open the app at http://localhost:3000
2. Go to **Models** tab
3. Download a model (Llama 3.2 3B recommended — 2GB, runs on any machine)
4. Go to **Chat** tab and start talking

## Project Structure

```
hearth/
├── electron/           # Electron main process
│   ├── main.js         # Window management, Next.js server lifecycle
│   └── preload.js      # Context bridge (minimal)
├── src/
│   ├── app/            # Next.js App Router pages
│   │   ├── page.tsx    # Dashboard
│   │   ├── chat/       # AI Chat
│   │   ├── models/     # Model management
│   │   ├── settings/   # Settings
│   │   └── api/        # API routes → Ollama proxy
│   ├── components/
│   │   ├── chat/       # ChatInterface, MessageItem
│   │   ├── layout/     # Sidebar navigation
│   │   ├── models/     # ModelManager
│   │   └── ui/         # shadcn/ui components
│   └── lib/
│       ├── ollama.ts   # Ollama client + recommended models
│       ├── types.ts    # Shared TypeScript types
│       └── utils.ts    # Helpers (formatBytes, cn, etc.)
└── public/
    └── manifest.json   # PWA manifest (mobile access)
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Electron 34 |
| Frontend | Next.js 14 + Tailwind CSS + shadcn/ui |
| AI engine | Ollama (local models) |
| Storage | localStorage (Phase 1) |
| Mobile | PWA via browser |

## Build for Distribution

```bash
npm run dist
```

Outputs `.exe` (Windows) or `.dmg` (macOS) to `dist/`.

## Roadmap

- **v1.0** (now) — Chat + Model management + Electron app
- **v1.1** — Gmail integration (IMAP/OAuth)
- **v1.2** — Google Calendar + Dashboard
- **v1.3** — Setup Wizard, auto-update
- **v2.0** — Plugin system

## License

MIT
