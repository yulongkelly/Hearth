> **Work in progress** — this project is under active development. Features, setup steps, and this README will change as things stabilise. Feedback and contributions welcome at any stage.

# 🔥 Hearth — Your Home AI

<p align="center">
  <strong>A personal AI assistant that lives on your machine, speaks on every channel, and never phones home.</strong>
</p>

<p align="center">
  Built to be safe and accessible for everyone — you don't need to be a developer to run your own AI assistant.
</p>

<p align="center">
  <strong>Privacy and safety first, always.</strong> Your data never leaves your machine. Every sensitive action requires your approval.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runs%20locally-100%25-brightgreen?style=for-the-badge" alt="100% local">
  <img src="https://img.shields.io/badge/LLM-Ollama-blue?style=for-the-badge" alt="Ollama">
  <img src="https://img.shields.io/badge/stack-Next.js%2015-black?style=for-the-badge&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/storage-AES--256--GCM-orange?style=for-the-badge" alt="AES-256-GCM">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#integrations">Integrations</a> ·
  <a href="#memory">Memory</a> ·
  <a href="#privacy--security">Privacy</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

**Hearth** connects your AI brain to every tool and channel you already use — Gmail, Calendar, Plaid, Telegram, Discord, Slack, and more — while keeping every byte of data on your own machine. No cloud LLM. No data leaving your device. Just your assistant, running at home.

---

## Why Hearth?

Most AI assistants are cloud-first: your emails, messages, and bank data travel to someone else's server before the model ever sees them. Hearth flips this. The model runs locally via [Ollama](https://ollama.com), credentials are AES-256-GCM encrypted on disk, and a privacy-tagging policy ensures sensitive data is **never** routed to any external model — even if you add one later.

---

## Features

- 🏠 **Fully local** — Ollama runs on-device; no cloud LLM ever touches your data
- 📬 **Multi-channel** — reads and sends via Gmail, Telegram, Discord, Slack, Matrix, Mattermost, WeChat, QQ, and IMAP/SMTP email
- 🏦 **Finance** — Plaid integration reads bank transactions across accounts
- 📅 **Calendar** — Google Calendar queries across multiple accounts
- 🔐 **Approval gate** — destructive actions (`send_email`, `send_message`, `create_workflow`) pause and require your confirmation before executing
- 🧠 **Semantic memory** — facts are embedded via Ollama, semantically retrieved per query, and deduplicated at cosine similarity ≥ 0.85
- 🔌 **LLM-guided API registration** — the assistant discovers and connects arbitrary REST APIs through conversation; credentials stored locally
- ⚙️ **Workflow engine** — chain tool calls and in-process actions into reusable, runnable workflows
- 🔒 **Encrypted storage** — all credentials and message logs use AES-256-GCM; key stored in OS keychain via `keytar`
- 🧩 **Adapter pattern** — swap or add LLM backends (Ollama, OpenAI-compat) without touching the tool loop

---

## Architecture

Hearth uses a strict three-layer design so channel bots, business logic, and data connectors never bleed into each other.

```
🗣️  MONKEY LAYER  — Channel Agents
    Telegram · Discord · Slack · Matrix · Mattermost · WeChat · QQ · Email
    Input/output only — no decisions, no tool calls

          ↓ forward message / ↑ reply

🧠  BUTLER LAYER  — Unified Brain  (Next.js API routes)
    TaskBuilder → Policy → Executor
    Single decision point: intent classification, privacy tagging, approval gating

          ↓ call connector / ↑ data

🔧  CONNECTOR LAYER  — Tools & Data Sources
    Gmail · Calendar · Plaid · Memory · Custom HTTP APIs
    No personality, no dialogue — called only by the Executor
```

### Chat request flow

```
Browser → POST /api/chat
  → inject memory (hearth.md + user profile + top-5 semantic retrieval)
  → tool loop (max 5 iterations):
      adapter.chat() → tool_call?
        → buildTask() → enforcePolicy() → requireApproval()? → executeTool()
      no tool_call → emit tool_history → stream final response
  → flush memory queue (semantic dedup → write to disk)
```

---

## Quick Start

**Prerequisites:** [Node.js 20+](https://nodejs.org), [Ollama](https://ollama.com) running locally.

```bash
# 1. Clone and install
git clone https://github.com/you/hearth.git
cd hearth
npm install

# 2. Pull a model (Llama 3.2 recommended for tool use)
ollama pull llama3.2

# 3. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). That's it — no API keys, no accounts required to start chatting.

> **Tip:** For memory and semantic deduplication, also pull an embedding model:
> ```bash
> ollama pull nomic-embed-text
> ```

---

## Integrations

| Platform | Auth | Read | Send |
|---|---|---|---|
| Gmail | OAuth 2.0 (multi-account) | ✅ | ✅ |
| Google Calendar | OAuth 2.0 (multi-account) | ✅ | — |
| Plaid | Client ID + secret | ✅ transactions | — |
| Telegram | Bot token | ✅ | ✅ |
| Discord | Bot token | ✅ | ✅ |
| Slack | Bot + App token (Socket Mode) | ✅ | ✅ |
| Matrix | Access token + homeserver | ✅ | ✅ |
| Mattermost | Bot token + server URL | ✅ | ✅ |
| Email (IMAP/SMTP) | Username + password | ✅ | ✅ |
| WeChat | QR code scan | ✅ | ✅ |
| QQ | QR code scan | ✅ | ✅ |
| Custom HTTP APIs | Per-connection credentials | ✅ | ✅ |

Connect any integration by asking the assistant: *"Connect my Telegram"* — it will walk you through credential setup step by step.

---

## Memory

Hearth uses a three-tier memory system that separates static instructions, user profile facts, and learned knowledge:

```
~/.hearth/memory/
├── hearth.md       Static instructions — always loaded in full (you edit this)
├── user.txt        User profile facts — always loaded, trimmed to fit context budget
├── memory.txt      Learned facts — top-5 retrieved per query via cosine similarity
└── embeddings.json SHA-256 → float[] cache (computed once, reused on cache hit)
```

The assistant writes to memory automatically. Entries are validated (no transient time references, no JSON blobs, max 280 chars), debounced 5 seconds, then flushed with semantic deduplication — near-duplicate facts replace rather than stack.

---

## Privacy & Security

| Concern | Mechanism |
|---|---|
| LLM inference | 100% local via Ollama — no request ever leaves your machine |
| Credentials | AES-256-GCM encrypted at rest; key in OS keychain (`keytar`) with file fallback |
| Privacy tagging | Every tool call tagged `high / medium / low`; `high` data (emails, messages, bank) blocked from any cloud routing at policy layer |
| Approval gate | `send_email`, `send_*_message`, `create_workflow` require explicit user confirmation |
| File permissions | All credential files written at mode `0600` |
| localStorage | Capped at 50 conversations; 7-day-old hidden tool traces stripped automatically |

---

## File Layout

```
~/.hearth/                        # All sensitive data lives here, not in the repo
├── google-accounts.json          # OAuth tokens per Gmail/Calendar account
├── plaid-credentials.json        # Plaid client ID + secret
├── telegram-config.json          # Bot token
├── discord-config.json           # Bot token
├── slack-config.json             # Bot + App tokens
├── custom-connections.json       # LLM-registered HTTP APIs + credentials
├── *-messages.jsonl              # Per-platform message logs (encrypted per-line)
└── memory/
    ├── hearth.md                 # Your static instructions to the assistant
    ├── user.txt                  # Assistant-maintained user profile
    ├── memory.txt                # Assistant-maintained fact store
    └── embeddings.json           # Embedding cache

src/
├── app/api/                      # Next.js route handlers
│   ├── chat/                     # Main tool loop + streaming
│   ├── tools/                    # execute · action · approve · answers
│   ├── messaging/[platform]/     # Bot connect/disconnect/send/status
│   └── connections/              # Custom HTTP API registration
├── lib/
│   ├── butler/                   # task-builder · policy · executor
│   ├── adapters/                 # Per-platform bot singletons
│   ├── model-adapter.ts          # LLM backend abstraction
│   └── memory-*.ts               # Memory store · retrieval · validator
└── components/                   # React UI
```

---

## Roadmap

- [ ] **Monkey registry** — unify bot singletons so the same user across platforms lands in the same Butler session
- [ ] **Cloud routing** — gate low-privacy intent descriptions to a cloud model; raw data stays local
- [ ] **Voice interface** — wake-word + STT/TTS loop on desktop
- [ ] **iOS / Android companion** — push notifications from bot channels

---

## Contributing

Contributions welcome. Open an issue first for anything beyond a small fix so we can align on approach before you write code.

```bash
npm run dev        # dev server with hot reload
npm run build      # production build
npx tsc --noEmit   # type check
```

All credential files are gitignored. Never commit anything under `~/.hearth/`.

---

## License

MIT © 2026 — built with [Ollama](https://ollama.com), [Next.js](https://nextjs.org), and a deep distrust of cloud services.
