# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An AI-powered Node.js agent that receives Sentry webhooks for Flutter app crashes, uses OpenAI (GPT-4o) to generate minimal code fixes, and opens Bitbucket PRs automatically. Slack notifications are sent at each step.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Development with --watch (auto-restart on changes)
npm start            # Production: node src/server.js
```

No test framework is configured. No linter is configured.

## Architecture

The pipeline flows linearly through these stages, orchestrated by `src/pipeline/orchestrator.js`:

1. **Webhook ingestion** (`src/server.js`): Express server receives POST at `/webhook/sentry`, verifies HMAC signature, responds 202 immediately, then processes async.
2. **Payload parsing** (`src/sentry/parser.js`): Extracts error info and app-level stack frames from Sentry's payload format. Filters out Flutter SDK/dart:core frames. Reverses frame order so crash point is first.
3. **Source fetching** (`src/bitbucket/service.js`): Uses Bitbucket REST API 2.0 via fetch to retrieve implicated source files from the target Bitbucket repo (configured via env vars, not this repo).
4. **AI fix generation** (`src/ai/agent.js`): Sends error context + source files to OpenAI with a structured JSON response format. Returns `{ confidence, explanation, fixes[] }`.
5. **Safeguard checks** (in orchestrator): Max files per fix, max diff lines, confidence threshold. Low confidence produces draft PRs.
6. **Branch + PR creation** (`src/bitbucket/service.js`): Creates branch `fix/sentry-{issueId}`, commits via multipart form API, opens PR. Bitbucket has no native labels — confidence signal is appended to PR description.
7. **Notifications** (`src/notifications/slack.js`): Slack webhook notifications for PR creation or skip/failure reasons.

A secondary webhook endpoint `/webhook/bitbucket` handles pipeline status notifications for auto-fix branches.

## Key Design Decisions

- **Deduplication**: In-memory `Set` of processed issue IDs in the orchestrator (capped at 10k entries). Also checks if a `fix/sentry-*` branch already exists.
- **Dart path normalization**: Sentry reports `package:myapp/foo.dart`, which gets mapped to `lib/foo.dart` for repo lookups. This happens both in the orchestrator (`resolveFilePaths`) and AI agent (`normalizeFilePath`).
- **The agent targets a separate Flutter repo**, not this repo. `BITBUCKET_WORKSPACE`/`BITBUCKET_REPO_SLUG` env vars point to the Flutter project being monitored.
- **ESM modules**: The project uses `"type": "module"` — all imports use ES module syntax.
- **No database**: All state is in-memory. The README notes Redis/DB for production.
- **Bitbucket API auth**: HTTP Basic with username + app password. PR responses use `pr.id` (not `number`) and `pr.links.html.href` (not `html_url`).

## Environment Variables

All config is loaded via `src/config.js` from `.env`. Required tokens: `SENTRY_WEBHOOK_SECRET`, `SENTRY_AUTH_TOKEN`, `BITBUCKET_USERNAME`, `BITBUCKET_APP_PASSWORD`, `OPENAI_API_KEY`. Also needs `BITBUCKET_WORKSPACE` and `BITBUCKET_REPO_SLUG`. See `.env.example` for the full list.

## CI Pipeline Note

`bitbucket-pipelines.yml` is **not for this repo** — it's a template meant to be copied into the target Flutter repo. It runs `flutter analyze`, `flutter test`, and builds APKs on merge to main.
