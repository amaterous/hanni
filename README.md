# hanni

**Drop a ticket, get a PR.**

Self-hosted AI coding agent that lives in Slack and Linear. Assign a ticket to hanni or mention @hanni in Slack — Claude autonomously implements it, opens a PR, and posts the result back to your thread.

No extra API billing. Runs entirely on your Claude Max plan.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/hanni)

---

## How it works

```
Assign a Linear ticket to hanni  — or —  @hanni implement dark mode
  ↓
Claude reads the ticket / thread
  ↓
branch → implements → opens PR → posts to Slack
```

Claude doesn't follow a fixed script. It reads the message and decides:

| Message | What hanni does |
|---|---|
| Question / chat | Replies in thread |
| "Run the tests" | Executes shell command, reports result |
| "What's the status of YUN-42?" | Fetches from Linear and explains |
| Ticket assigned to hanni | Implements and opens PR automatically |
| "Implement X" | Ticket → branch → code → PR |

---

## Deploy in 5 minutes

### 1. Deploy on Railway

Click the button above, then set these environment variables:

| Variable | Description |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | **Recommended.** Your Claude Max plan OAuth token — uses your existing subscription, no separate API billing. Get it with `./scripts/get-claude-token.sh`. |
| `ANTHROPIC_API_KEY` | Alternative if you don't have Claude Max. Uses pay-per-token API billing. Set one or the other, not both. |
| `LINEAR_WEBHOOK_SECRET` | From Linear → Settings → API → Webhooks |
| `LINEAR_API_TOKEN` | Linear Personal API Token (`lin_api_xxx`) |
| `LINEAR_WORKSPACE_ID` | Your Linear workspace ID |
| `LINEAR_IN_REVIEW_STATE_ID` | The "In Review" workflow state ID |
| `SLACK_BOT_TOKEN` | `xoxb-xxx` from your Slack app |
| `SLACK_SIGNING_SECRET` | From Slack app Basic Information |
| `SLACK_TEAM_ID` | Your Slack workspace ID (e.g. `T0XXXXXXX`) |
| `GITHUB_TOKEN` | Personal access token with repo scope |
| `MAX_CONCURRENT_SESSIONS` | Max parallel Claude sessions (default: `8`) |
| `HANNI_SERVER_URL` | *(GitHub Actions only)* Full URL of your server, e.g. `http://1.2.3.4:3460`. Used by the health-check workflow. Set as a [GitHub Actions secret](https://docs.github.com/en/actions/security-guides/encrypted-secrets). |

**Optional:**

| Variable | Description |
|---|---|
| `LINEAR_WORKSPACE_NAME` | Display name for the Linear workspace (default: `"workspace"`) |
| `SLACK_WORKSPACE_NAME` | Display name for the Slack workspace (default: `"workspace"`) |
| `SLACK_LINEAR_WORKSPACE_ID` | Linear workspace ID to use in Slack chat mode (defaults to `LINEAR_WORKSPACE_ID`) |
| `HOOKDECK_RELAY_TOKEN` | If using [Hookdeck](https://hookdeck.com) to relay webhooks locally |
| `CLAUDE_MODEL` | Claude model override (default: `claude-sonnet-4-20250514`) |
| `CLAUDE_FALLBACK_MODEL` | Fallback model (default: `claude-haiku-4-5-20251001`) |

### 2. Get your Claude token

```bash
# Run this locally (requires Claude Code to be installed and logged in)
./scripts/get-claude-token.sh
```

Paste the output as `CLAUDE_CODE_OAUTH_TOKEN`. This uses your Claude Max plan subscription — no separate API billing.

### 3. Create your Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From manifest**
2. Paste the contents of [`slack-manifest.json`](./slack-manifest.json)
3. Replace `YOUR_DOMAIN` with your Railway deployment URL
4. Install the app to your workspace
5. Copy **Bot User OAuth Token** (`xoxb-xxx`) → `SLACK_BOT_TOKEN`
6. Copy **Signing Secret** → `SLACK_SIGNING_SECRET`

### 4. Set up Linear webhook

1. Linear → Settings → API → Webhooks → **New webhook**
2. URL: `https://YOUR_RAILWAY_DOMAIN/webhook`
3. Events: **Issues** (created, updated), **Comments** (created)
4. Copy the secret → `LINEAR_WEBHOOK_SECRET`

### 5. Add repositories

Set `HANNI_REPOS` as a JSON array:

```json
[
  {
    "name": "my-repo",
    "github": "yourname/my-repo",
    "baseBranch": "main",
    "linearWorkspaceId": "YOUR_WORKSPACE_ID",
    "projectKeys": ["My Project"]
  }
]
```

---

## Architecture

```
Slack mention / Linear webhook
  ↓
Bun HTTP server (Railway)
  ↓
Session Manager
  - git worktree per task
  - max N concurrent sessions (default: 8, set via MAX_CONCURRENT_SESSIONS)
  ↓
Claude Agent SDK
  - Linear MCP (ticket operations)
  - bash (git, gh, bun, npm)
  - file read/write
  ↓
Results posted back to Slack
```

## Why hanni?

**Claude Max is all you need.** No per-seat SaaS fees. hanni uses your existing Claude Max plan subscription — the same one you use for Claude Code locally. One subscription, infinite tickets.

**Slack is the interface everyone already has.** No new tools to learn. Your whole team can assign work to hanni, check status, or just ask questions — from the app already open on their screen.

**Tickets don't pile up.** Assign a backlog ticket to hanni and it starts implementing. The bottleneck shifts from "someone needs to write this code" to "someone needs to review this PR."

**Code from your phone.** Slack and Linear are both mobile apps. Assign a ticket on your commute, hanni implements it while you're offline. Check the PR link when you get back to your desk.

**No classification layer.** Most AI agents classify messages into buckets ("chat" vs "code task") then run fixed scripts. hanni sends everything directly to Claude, which decides what to do based on the full thread context. This handles edge cases naturally — "run the tests", "what's blocking this PR?", and "implement dark mode" all get the right treatment without explicit rules.

**Self-hosted.** Runs on your own Railway instance. Your code and credentials stay on your infrastructure.

**Persistent sessions.** Sessions survive container restarts. Resume mid-task after a redeploy.

---

## Configuration

For advanced setups (multiple Linear workspaces, multiple Slack workspaces), use `config.json` instead of env vars. See [`config.example.jsonc`](./config.example.jsonc).

## Session recovery

Sessions survive container restarts — state is persisted to `logs/sessions.json`. If a session is stuck as "running" after a crash, it is automatically reset to "idle" on the next startup.

To manually resume a stuck session, restart the server. hanni will reload the session from disk and allow the next comment to resume it.

## Security

hanni runs Claude with full file and shell access (`bypassPermissions`). This is required for autonomous coding — treat it like a developer with full repo access.

- Only expose hanni to trusted Slack workspaces
- Credentials (`config.json`, `tokens.json`) are gitignored and never committed
- See [SECURITY.md](./SECURITY.md) for the full trust model and credential handling guide

## Local development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full local setup guide including Hookdeck webhook forwarding and test event examples.

```bash
cp config.example.jsonc config.json
# fill in your values

bun install
bun run src/index.ts
```
