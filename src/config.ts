import { readFileSync, existsSync, writeFileSync } from "fs";
import type { HanniConfig } from "./types";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_FALLBACK_MODEL,
  DEFAULT_PORT,
  DEFAULT_WEBHOOK_PATH,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_PATHS,
  DEFAULT_CONFIG_FILE,
  DEFAULT_TOKENS_FILE,
} from "./constants";

const DEFAULT_TOKENS_PATH = DEFAULT_TOKENS_FILE;

/**
 * Build config from environment variables (for Railway / Fly.io deployment).
 * Falls back to config.json if env vars are not set.
 *
 * Required env vars:
 *   LINEAR_WEBHOOK_SECRET
 *   LINEAR_API_TOKEN
 *   LINEAR_WORKSPACE_ID
 *   LINEAR_IN_REVIEW_STATE_ID
 *   SLACK_BOT_TOKEN
 *   SLACK_SIGNING_SECRET
 *   SLACK_TEAM_ID
 *
 * Optional env vars:
 *   HANNI_PORT              (default: 3460)
 *   GITHUB_TOKEN            (for gh CLI in sessions)
 *   HANNI_REPOS             (JSON array of RepositoryConfig)
 *   HOOKDECK_RELAY_TOKEN    (if using Hookdeck to relay webhooks)
 *   LINEAR_WORKSPACE_NAME   (display name for the workspace, default: "workspace")
 *   SLACK_WORKSPACE_NAME    (display name for the workspace, default: "workspace")
 *   SLACK_LINEAR_WORKSPACE_ID (Linear workspace ID for Slack chat mode)
 *   CLAUDE_MODEL            (default: claude-sonnet-4-20250514)
 *   CLAUDE_FALLBACK_MODEL   (default: claude-haiku-4-5-20251001)
 *   MAX_CONCURRENT_SESSIONS (default: 8)
 */
function buildConfigFromEnv(): HanniConfig | null {
  const linearWebhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  const linearApiToken = process.env.LINEAR_API_TOKEN;
  const linearWorkspaceId = process.env.LINEAR_WORKSPACE_ID;
  const linearInReviewStateId = process.env.LINEAR_IN_REVIEW_STATE_ID;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const slackTeamId = process.env.SLACK_TEAM_ID;

  // If none of the required env vars are set, fall back to config.json
  if (!linearWebhookSecret && !linearApiToken && !slackBotToken) return null;

  // Validate required env vars
  const missing: string[] = [];
  if (!linearWebhookSecret) missing.push("LINEAR_WEBHOOK_SECRET");
  if (!linearApiToken) missing.push("LINEAR_API_TOKEN");
  if (!linearWorkspaceId) missing.push("LINEAR_WORKSPACE_ID");
  if (!linearInReviewStateId) missing.push("LINEAR_IN_REVIEW_STATE_ID");
  if (!slackBotToken) missing.push("SLACK_BOT_TOKEN");
  if (!slackSigningSecret) missing.push("SLACK_SIGNING_SECRET");
  if (!slackTeamId) missing.push("SLACK_TEAM_ID");
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const port = parseInt(process.env.HANNI_PORT ?? String(DEFAULT_PORT), 10);

  // Parse repositories from env (JSON array) or use empty
  let repositories: HanniConfig["repositories"] = [];
  if (process.env.HANNI_REPOS) {
    try {
      repositories = JSON.parse(process.env.HANNI_REPOS);
    } catch {
      throw new Error("HANNI_REPOS must be a valid JSON array");
    }
  }

  return {
    agent: { name: "hanni" },
    provider: "claude",
    server: { port, webhookPath: DEFAULT_WEBHOOK_PATH },
    linear: {
      webhookSecret: linearWebhookSecret!,
      hookdeckRelayToken: process.env.HOOKDECK_RELAY_TOKEN,
      workspaces: {
        [linearWorkspaceId!]: {
          name: process.env.LINEAR_WORKSPACE_NAME ?? DEFAULT_WORKSPACE_NAME,
          apiKey: linearApiToken!,
          inReviewStateId: linearInReviewStateId!,
        },
      },
    },
    slack: {
      workspaces: {
        [slackTeamId!]: {
          name: process.env.SLACK_WORKSPACE_NAME ?? DEFAULT_WORKSPACE_NAME,
          botToken: slackBotToken!,
          signingSecret: slackSigningSecret!,
          defaultLinearWorkspaceId: process.env.SLACK_LINEAR_WORKSPACE_ID ?? linearWorkspaceId!,
          linearApiKey: linearApiToken!,
        },
      },
    },
    repositories,
    claude: {
      model: process.env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL,
      fallbackModel: process.env.CLAUDE_FALLBACK_MODEL ?? DEFAULT_CLAUDE_FALLBACK_MODEL,
    },
    paths: { ...DEFAULT_PATHS },
  };
}

export function loadConfig(configPath = DEFAULT_CONFIG_FILE, tokensPath = DEFAULT_TOKENS_PATH): HanniConfig {
  // Try env vars first (Railway / Fly.io)
  const envConfig = buildConfigFromEnv();
  if (envConfig) return envConfig;

  // Fall back to config.json
  const raw = readFileSync(configPath, "utf-8");
  let config: HanniConfig;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${err}`);
  }

  // Merge tokens.json if present (Linear OAuth, OpenAI, Vercel)
  if (existsSync(tokensPath)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tokens: any;
    try {
      tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
    } catch (err) {
      throw new Error(`Failed to parse ${tokensPath}: ${err}`);
    }
    if (tokens.vercel?.token) {
      config.vercel = { ...config.vercel, token: tokens.vercel.token };
    }
    if (tokens.openai?.apiKey && config.openai) {
      config.openai.apiKey = tokens.openai.apiKey;
    }
    if (tokens.openai?.oauth && config.openai) {
      config.openai.oauth = { ...config.openai.oauth, ...tokens.openai.oauth };
    }
    if (tokens.linear?.workspaces) {
      for (const [wsId, wsTokens] of Object.entries(tokens.linear.workspaces) as [string, { accessToken?: string; refreshToken?: string }][]) {
        if (config.linear.workspaces[wsId] && wsTokens) {
          if (wsTokens.accessToken) config.linear.workspaces[wsId].accessToken = wsTokens.accessToken;
          if (wsTokens.refreshToken) config.linear.workspaces[wsId].refreshToken = wsTokens.refreshToken;
        }
      }
    }
  }

  if (!config.server?.port) throw new Error("config: server.port is required");
  if (!config.linear?.webhookSecret) throw new Error("config: linear.webhookSecret is required");
  if (!config.linear?.workspaces || Object.keys(config.linear.workspaces).length === 0) {
    throw new Error("config: at least one linear workspace is required");
  }
  if (!config.repositories?.length) throw new Error("config: at least one repository is required");
  if (!config.claude?.model) throw new Error("config: claude.model is required");

  config.provider ??= "claude";
  config.server.webhookPath ??= DEFAULT_WEBHOOK_PATH;
  config.agent ??= { name: "hanni" };
  config.paths ??= { ...DEFAULT_PATHS };

  return config;
}

/**
 * Save config.json (e.g. after adding a new repository dynamically).
 * No-op when running from env vars.
 */
export function saveConfig(config: HanniConfig, configPath = "./config.json") {
  if (!existsSync(configPath)) return;
  const raw = readFileSync(configPath, "utf-8");
  let existing: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    existing = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${configPath} for saving: ${err}`);
  }
  existing.repositories = config.repositories;
  writeFileSync(configPath, JSON.stringify(existing, null, 2));
}

/**
 * Save tokens to tokens.json. No-op when running from env vars.
 */
export function saveTokens(config: HanniConfig, tokensPath = DEFAULT_TOKENS_PATH) {
  const tokens: any = { vercel: {}, openai: {}, linear: { workspaces: {} } };

  if (config.vercel?.token) {
    tokens.vercel.token = config.vercel.token;
  }
  if (config.openai?.apiKey) {
    tokens.openai.apiKey = config.openai.apiKey;
  }
  if (config.openai?.oauth) {
    tokens.openai.oauth = {
      accessToken: config.openai.oauth.accessToken,
      refreshToken: config.openai.oauth.refreshToken,
      expiresAt: config.openai.oauth.expiresAt,
      accountId: config.openai.oauth.accountId,
    };
  }
  for (const [wsId, ws] of Object.entries(config.linear.workspaces)) {
    if (ws.accessToken || ws.refreshToken) {
      tokens.linear.workspaces[wsId] = {
        ...(ws.accessToken && { accessToken: ws.accessToken }),
        ...(ws.refreshToken && { refreshToken: ws.refreshToken }),
      };
    }
  }

  writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
}
