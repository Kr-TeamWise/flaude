# Flaude

An agentic workspace for Claude -- build AI agent teams and manage client work from a single desktop app.

## Features

- **Agent Creation** -- Define custom AI agents with specific roles, instructions, and capabilities powered by Claude.
- **Team Building** -- Compose agents into collaborative teams that work together on complex tasks.
- **Chat** -- Converse with individual agents or entire teams in a unified chat interface.
- **Client Management** -- Organize work by client with dedicated workspaces and context.
- **Meeting Recording and Transcription** -- Record meetings and generate transcripts using Whisper for automatic note-taking.
- **Discord / Slack Integration** -- Connect your agent teams to Discord and Slack for real-time collaboration.

## Screenshots

<!-- Add screenshots here -->

## Quick Start

### Prerequisites

- A Claude subscription (API key)
- Node.js 18+
- Rust and Tauri prerequisites ([setup guide](https://tauri.app/start/prerequisites/))
- Python 3.11+
- PostgreSQL

### Development Setup

**1. Clone the repository**

```bash
git clone https://github.com/conscience-technology/flaude.git
cd flaude
```

**2. Start the server**

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

**3. Start the app**

```bash
cd app
npm install
npm run tauri dev
```

The desktop app will launch and connect to the local Django server.

## Tech Stack

| Layer       | Technology              |
|-------------|-------------------------|
| Desktop App | Tauri                   |
| Frontend    | React, TypeScript       |
| Backend     | Django, Django REST Framework |
| Database    | PostgreSQL              |
| Transcription | Whisper               |
| AI          | Claude (Anthropic API)  |

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

Copyright (c) 2026 Conscience Technology
