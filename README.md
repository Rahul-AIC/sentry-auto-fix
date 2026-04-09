# 🤖 Sentry Auto-Fix Agent

An AI-powered pipeline that automatically fixes Flutter app crashes reported by Sentry and opens Bitbucket Pull Requests.

## Architecture

```
Flutter App (User)
      ↓ crash
Sentry (Error Monitoring)
      ↓ webhook POST
┌──────────────────────────────────┐
│  This Agent (Node.js)            │
│                                  │
│  1. Parse Sentry payload         │
│  2. Fetch source from Bitbucket  │
│  3. Send to OpenAI (GPT-4o)     │
│  4. Create branch + PR           │
│  5. Notify via Slack             │
└──────────────────────────────────┘
      ↓ PR triggers
Bitbucket Pipelines (CI/CD)
      ↓
   Tests pass?
  YES → auto-merge → deploy
  NO  → notify you for manual review
```

## Setup

### 1. Clone and configure

```bash
git clone <this-repo>
cd sentry-auto-fix
cp .env.example .env
# Fill in all values in .env
npm install
```

### 2. Create tokens

| Token | Where | Permissions |
|-------|-------|-------------|
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens | `event:read`, `project:read` |
| `SENTRY_WEBHOOK_SECRET` | Sentry → Settings → Integrations → Webhooks | Auto-generated |
| `BITBUCKET_USERNAME` | Your Bitbucket username | — |
| `BITBUCKET_APP_PASSWORD` | Bitbucket → Settings → App passwords | `repository:write`, `pullrequest:write` |
| `OPENAI_API_KEY` | platform.openai.com → API Keys | — |

### 3. Configure Sentry Webhook

1. Go to **Sentry → Settings → Integrations → Internal Integrations** (or Webhooks)
2. Add webhook URL: `https://your-server.com/webhook/sentry`
3. Enable events: **Issue Created**, **Event Alert Triggered**
4. Copy the signing secret to `SENTRY_WEBHOOK_SECRET`

### 4. Run

```bash
# Development
npm run dev

# Production
npm start

# Docker
docker build -t sentry-auto-fix .
docker run -p 3000:3000 --env-file .env sentry-auto-fix
```

### 5. Copy the CI pipeline to your Flutter repo

Copy `bitbucket-pipelines.yml` into your Flutter repository. It handles:
- Running `flutter analyze` and `flutter test` on every PR
- Building APK on merge to main

### 6. Expose to the internet

Use any of:
- **ngrok** (dev): `ngrok http 3000`
- **Cloud Run** / **Railway** / **Fly.io** (production)
- Your own server behind a reverse proxy

## Safeguards

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_FILES_PER_FIX` | 3 | Max files the AI can modify per fix |
| `MAX_DIFF_LINES` | 100 | Reject fixes with too many changed lines |
| `AUTO_MERGE_ENABLED` | false | Whether to auto-merge passing PRs |
| `CONFIDENCE_THRESHOLD` | 0.8 | Below this → draft PR only |

## Project Structure

```
src/
├── server.js                  # Express app + webhook routes
├── config.js                  # Env config loader
├── logger.js                  # Winston logger
├── sentry/
│   ├── parser.js              # Parse Sentry payloads → structured data
│   └── verify.js              # HMAC signature verification
├── ai/
│   └── agent.js               # OpenAI prompt + response parsing
├── bitbucket/
│   └── service.js             # Bitbucket API: branches, commits, PRs
├── notifications/
│   └── slack.js               # Slack webhook notifications
└── pipeline/
    └── orchestrator.js        # Main pipeline tying everything together

bitbucket-pipelines.yml        # Bitbucket Pipelines template for your Flutter repo
```
