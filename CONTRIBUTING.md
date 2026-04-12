# Contributing

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [git](https://git-scm.com)
- [GitHub CLI](https://cli.github.com) (`gh`)
- A Claude Max subscription (for running Claude sessions locally)
- A Linear workspace and Slack workspace for testing

## Local Setup

```bash
# 1. Clone and install
git clone https://github.com/yourname/hanni
cd hanni
bun install

# 2. Create config from example
cp config.example.jsonc config.json
# Fill in your Linear, Slack, and GitHub credentials

# 3. Start the server
bun run src/index.ts
```

The server starts on port `3460` by default (configurable via `HANNI_PORT`).

## Exposing Webhooks Locally

Slack and Linear need a public URL to deliver webhooks. Use [Hookdeck](https://hookdeck.com) or [ngrok](https://ngrok.com):

### Hookdeck (recommended)

```bash
# Install Hookdeck CLI
brew install hookdeck/hookdeck/hookdeck

# Forward webhooks to local server
hookdeck listen 3460 hanni
```

Set the forwarded URL as your Linear webhook URL and Slack Events API URL.

Set `HOOKDECK_RELAY_TOKEN` in your `config.json` or environment if using the relay mode.

### ngrok

```bash
ngrok http 3460
```

## Running Tests

```bash
bun test
```

Tests use Bun's built-in test runner. Most unit tests mock external services; integration tests require a real config.

To run a specific test file:

```bash
bun test src/webhook/handler.test.ts
```

## Testing with Slack

Set `HANNI_DEV_MODE=true` to skip Slack signature verification when sending test events locally:

```bash
HANNI_DEV_MODE=true bun run src/index.ts
```

You can also send a fake Slack event directly:

```bash
curl -X POST http://localhost:3460/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "event_callback",
    "team_id": "YOUR_TEAM_ID",
    "event": {
      "type": "app_mention",
      "text": "<@U_BOT_ID> hello",
      "user": "U_TEST",
      "channel": "C_TEST",
      "ts": "1234567890.000001"
    }
  }'
```

Using `"user": "U_TEST"` activates dry-run mode — responses are logged instead of posted to Slack.

## Code Style

- TypeScript with strict mode
- No `any` in production code (test mocks excepted)
- Logger: use `createLogger("component-name")` from `src/utils/logger.ts`
- Errors: always log before suppressing — `.catch((err) => { log.warn(...) })` not `.catch(() => {})`

## Commit Messages

```
feat: add support for multiple Linear workspaces
fix: handle missing worktree path on session resume
chore: update dependencies
```

No scope prefix required. Keep the subject line under 72 characters.

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Add tests for new behavior where practical
- Update README if you change environment variables or deployment steps
