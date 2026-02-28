# VYKE IDE

A lightweight, self-hosted web IDE powered by **Monaco Editor**, **FastAPI**, and **Ollama**.  
Write, run, and discuss code with a local AI — entirely in your browser, entirely on your machine.

---

## Features

- **Monaco Editor** — the same editor engine as VS Code, with syntax highlighting, bracket matching, and multi-tab support
- **AI Chat** — ask questions about your code using any Ollama model; the current file is automatically injected as context
- **AI Completion** — inline code suggestions triggered on pause or with `Ctrl+Space`
- **Code Runner** — execute Python, JavaScript, and Bash directly in the integrated terminal, with stdin pre-fill support for interactive programs
- **File Explorer** — browse and open any folder from your workspace; files open in individual tabs
- **Model Picker** — switch between Ollama models for chat and completion independently, without restarting
- **100% local** — no cloud, no telemetry, no API keys

---

## Prerequisites

**Ollama must be running on your machine before starting Vyke.**  
Vyke does not manage Ollama — it connects to it as an external service.

```bash
# Install Ollama — https://ollama.com
ollama serve

# Pull at least one model
ollama pull mistral-small3.2:24b   # chat
ollama pull qwen2.5-coder:7b       # code completion
```

> Any model available on [ollama.com/library](https://ollama.com/library) works.  
> Smaller models (3–8B) run well on CPU. GPU recommended for 14B+.

---

## Quick Start

### Option A — Docker (recommended)

```bash
git clone https://github.com/Asmokz/vyke-editor.git
cd vyke-editor

# Configure (copy and edit)
cp .env.example .env
# Edit VYKE_CHAT_MODEL, VYKE_CODE_MODEL, and WORKSPACE_PATH

docker compose up --build
```

Open [http://localhost:4242](http://localhost:4242)

**Linux note:** `host.docker.internal` is resolved automatically via `extra_hosts` in `docker-compose.yml`.  
**Mac / Windows:** Docker Desktop handles it natively.

---

### Option B — Native (Python venv)

```bash
git clone https://github.com/Asmokz/vyke-editor.git
cd vyke-editor

./setup.sh   # interactive wizard: port, Ollama URL, models
./start.sh   # starts the server
```

Open [http://localhost:4242](http://localhost:4242)

To reconfigure at any time: `./setup.sh`  
To edit config directly: `nano .env` then `./start.sh`

---

## Configuration

All options live in `.env` (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `VYKE_PORT` | `4242` | Port the server listens on |
| `VYKE_OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `VYKE_CHAT_MODEL` | `mistral-small3.2:24b` | Model for chat & explanations |
| `VYKE_CODE_MODEL` | `qwen2.5-coder:7b` | Model for inline completion |
| `VYKE_WORKSPACE` | `$HOME` | Root folder exposed in the file explorer (native) |
| `WORKSPACE_PATH` | `~` | Host folder mounted as workspace (Docker only) |

---

## Architecture

```
Browser
  └── Monaco Editor  (CDN)
  └── Fetch / Stream (HTTP)
        │
        ▼
  FastAPI  (uvicorn)
  ├── /api/chat        → streams tokens from Ollama
  ├── /api/complete    → single completion from Ollama
  ├── /api/run         → executes code in a subprocess, streams NDJSON
  ├── /api/browse      → lists workspace files
  └── /api/workspace/* → read / write files
        │
        ▼
  Ollama  (external, managed by you)
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save current file |
| `Ctrl+N` | New tab |
| `Ctrl+W` | Close current tab |
| `Ctrl+B` | Toggle file explorer |
| `Ctrl+Space` | Trigger AI completion |
| `F5` | Run code |
| `Tab` | Accept AI suggestion |
| `Esc` | Reject AI suggestion |

---

## Supported Languages

| Language | Syntax highlighting | AI completion | Code runner |
|---|---|---|---|
| Python | ✓ | ✓ | ✓ (`python3`) |
| JavaScript | ✓ | ✓ | ✓ (`node`) |
| Bash | ✓ | ✓ | ✓ (`bash`) |
| TypeScript | ✓ | ✓ | — |
| Markdown | ✓ | ✓ | — |
| JSON, HTML, CSS | ✓ | ✓ | — |

---

## Issues & Contributing

Found a bug or have a feature request?  
**[Open an issue on GitHub](https://github.com/Asmokz/vyke-editor/issues)** — all feedback is welcome.

When reporting a bug, please include:
- Your OS and browser version
- The Ollama version (`ollama --version`)
- The model(s) you are using
- Steps to reproduce

---

## License

MIT — do whatever you want with it.
