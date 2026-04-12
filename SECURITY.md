# Security

## Trust Model

hanni runs Claude Code with `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true`. This is **intentional** — hanni is a fully automated coding agent that needs unrestricted access to implement tickets end-to-end:

- Read and write arbitrary files in the repository
- Run shell commands (`git`, `gh`, `bun`, `npm`, etc.)
- Create branches, push commits, open PRs

**Treat hanni like a developer with full repository access.** Only expose it to trusted Slack workspaces and Linear organizations.

### What this means in practice

- **Never send untrusted user input directly to hanni.** Anyone who can @mention hanni in Slack can run arbitrary commands in the context of your deployment.
- **Restrict Slack access** to internal workspaces only. Do not make hanni available to external users.
- **Use separate deployment environments** for production vs. staging code operations.

## Credential Handling

hanni stores credentials in two files that are **never committed to git** (both are in `.gitignore`):

| File | Contents |
|------|----------|
| `config.json` | API keys (Linear, Slack), webhook secrets |
| `tokens.json` | OAuth tokens (Linear, OpenAI, Vercel) |

For production deployments, use environment variables instead of `config.json`. See the [deployment guide](README.md#deploy-in-5-minutes) for the full list.

The `CLAUDE_CODE_OAUTH_TOKEN` environment variable grants access to your Claude Max subscription. Rotate it if you suspect it has been compromised — run `./scripts/get-claude-token.sh` again to get a new one.

## GitHub Actions

The health-check workflow requires a `HANNI_SERVER_URL` secret in your GitHub repository settings:

```
Settings → Secrets and variables → Actions → New repository secret
Name: HANNI_SERVER_URL
Value: http://<your-server-ip>:<port>
```

Never hardcode server IPs or infrastructure details in workflow files.

## Reporting Security Issues

If you discover a security vulnerability, please open a [GitHub issue](../../issues) with the label `security`. For sensitive disclosures, describe the issue without including exploit details in the public issue.
