# Contributing to Flaude

Thank you for your interest in contributing to Flaude. This guide will help you get started.

## Development Environment Setup

### Server (Django)

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### App (Tauri + React)

```bash
cd app
npm install
npm run tauri dev
```

Make sure you have the [Tauri prerequisites](https://tauri.app/start/prerequisites/) installed for your platform (Rust, system dependencies, etc.).

## Branch Strategy

- `main` -- stable release branch
- `develop` -- integration branch for upcoming release
- `feature/*` -- individual feature branches

All work should be done on a feature branch created from `develop`. When ready, open a pull request targeting `develop`. Releases are merged from `develop` into `main`.

## Pull Request Process

1. Create a feature branch from `develop` (e.g., `feature/agent-templates`).
2. Keep commits focused and write clear commit messages.
3. Ensure the app builds and the server runs without errors before opening a PR.
4. Open a pull request against `develop` with a brief description of the changes.
5. Address any review feedback promptly.

## Code Style

- **Python (server):** Follow PEP 8. Use type hints where practical.
- **TypeScript/React (app):** Follow the existing ESLint and Prettier configuration in the project.
- Keep functions short and well-named. Prefer clarity over cleverness.

## Reporting Issues

If you find a bug or have a feature request, please open a GitHub issue with a clear description and steps to reproduce (if applicable).
