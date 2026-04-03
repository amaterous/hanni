import { readFileSync, existsSync, writeFileSync } from "fs";
import type { BroConfig } from "./types";

const DEFAULT_TOKENS_PATH = "./tokens.json";

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
 */
function buildConfigFromEnv(): BroConfig | null {
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

  const port = parseInt(process.env.HANNI_PORT ?? "3460", 10);

  // Parse repositories from env (JSON array) or use empty
  let repositories: BroConfig["repositories"] = [];
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
    server: { port, webhookPath: "/webhook" },
    linear: {
      webhookSecret: linearWebhookSecret!,
      workspaces: {
        [linearWorkspaceId!]: {
          name: process.env.LINEAR_WORKSPACE_NAME ?? "workspace",
          apiKey: linearApiToken!,
          inReviewStateId: linearInReviewStateId!,
        },
      },
    },
    slack: {
      workspaces: {
        [slackTeamId!]: {
          name: process.env.SLACK_WORKSPACE_NAME ?? "workspace",
          botToken: slackBotToken!,
          signingSecret: slackSigningSecret!,
          defaultLinearWorkspaceId: process.env.SLACK_LINEAR_WORKSPACE_ID ?? linearWorkspaceId!,
          linearApiKey: linearApiToken!,
        },
      },
    },
    repositories,
    claude: {
      model: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
      fallbackModel: process.env.CLAUDE_FALLBACK_MODEL ?? "claude-haiku-4-5-20251001",
    },
    paths: { repos: "./repos", worktrees: "./worktrees", logs: "./logs" },
  };
}

export function loadConfig(configPath = "./config.json", tokensPath = DEFAULT_TOKENS_PATH): BroConfig {
  // Try env vars first (Railway / Fly.io)
  const envConfig = buildConfigFromEnv();
  if (envConfig) return envConfig;

  // Fall back to config.json
  const raw = readFileSync(configPath, "utf-8");
  const config: BroConfig = JSON.parse(raw);

  // Merge tokens.json if present (OpenAI / Vercel only)
  if (existsSync(tokensPath)) {
    const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
    if (tokens.vercel?.token) {
      config.vercel = { ...config.vercel, token: tokens.vercel.token };
    }
    if (tokens.openai?.apiKey && config.openai) {
      config.openai.apiKey = tokens.openai.apiKey;
    }
    if (tokens.openai?.oauth && config.openai) {
      config.openai.oauth = { ...config.openai.oauth, ...tokens.openai.oauth };
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
  config.server.webhookPath ??= "/webhook";
  config.agent ??= { name: "hanni" };
  config.paths ??= { repos: "./repos", worktrees: "./worktrees", logs: "./logs" };

  return config;
}

/**
 * Save config.json (e.g. after adding a new repository dynamically).
 * No-op when running from env vars.
 */
export function saveConfig(config: BroConfig, configPath = "./config.json") {
  if (!existsSync(configPath)) return;
  const raw = readFileSync(configPath, "utf-8");
  const existing = JSON.parse(raw);
  existing.repositories = config.repositories;
  writeFileSync(configPath, JSON.stringify(existing, null, 2));
}

/**
 * Save tokens to tokens.json. No-op when running from env vars.
 */
export function saveTokens(config: BroConfig, tokensPath = DEFAULT_TOKENS_PATH) {
  const tokens: any = { vercel: {}, openai: {} };

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

  writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
}
