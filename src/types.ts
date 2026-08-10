export interface HanniConfig {
  provider?: "claude" | "openai";
  agent: {
    name: string;
    ownerName?: string;
    slackHandle?: string;
    githubOwner?: string;
  };
  server: {
    port: number;
    webhookPath: string;
  };
  linear: {
    webhookSecret: string;
    hookdeckRelayToken?: string;
    workspaces: Record<string, WorkspaceConfig>;
  };
  slack?: SlackConfig;
  repositories: RepositoryConfig[];
  claude: {
    model: string;
    fallbackModel: string;
    thinking?: boolean;
    effort?: "low" | "medium" | "high" | "max";
  };
  openai?: {
    provider?: "openai" | "openai-codex";
    apiKey?: string;
    model: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    baseUrl?: string;
    endpointPath?: string;
    oauth?: {
      clientId: string;
      redirectUri: string;
      authUrl?: string;
      tokenUrl?: string;
      scope?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: string; // ISO
      accountId?: string;
    };
  };
  vercel?: VercelConfig;
  stripe?: StripeConfig;
  schedule?: {
    jobs?: ScheduledJob[];
  };
  paths: {
    repos: string;
    worktrees: string;
    logs: string;
  };
}

export interface SlackConfig {
  workspaces: Record<string, SlackWorkspaceConfig>; // keyed by Slack team_id
}

export interface SlackWorkspaceConfig {
  name: string;
  botToken: string;
  signingSecret: string;
  defaultLinearWorkspaceId: string; // Linear workspace to create tickets in
  linearApiKey?: string; // Linear API key for MCP in chat mode
}

export interface WorkspaceConfig {
  name: string;
  apiKey: string; // Linear Personal API Token
  inReviewStateId: string;
  viewerId?: string;
  // OAuth tokens — stored in tokens.json, merged at runtime
  accessToken?: string;
  refreshToken?: string;
}

export interface RepositoryConfig {
  name: string;
  github: string;
  baseBranch: string;
  linearWorkspaceId: string;
  projectKeys: string[];
  subdir?: string;
  vercel?: {
    projectId: string;
    orgId: string;
  };
  screenshotPaths?: string[];
}

export interface VercelConfig {
  token: string;
}

export interface StripeConfig {
  secretKey: string; // STRIPE_SECRET_KEY_LIVE
  // Extra accounts, exposed as STRIPE_SECRET_KEY_LIVE_<SUFFIX> (e.g. { "CL": "sk_live_..." })
  additionalAccounts?: Record<string, string>;
}

export interface ScheduledJob {
  name: string;             // Job identifier (also used as dedup filename)
  utcHour: number;
  utcMinute?: number;       // Default: 0
  slackWorkspaceId: string; // Slack team_id
  channel: string;
  repo?: string;            // Repository name from `repositories` (omit to run without a repo)
  message: string;          // Message passed to Claude
  initMessage?: string;     // Initial Slack post (default: "⏰ Running...")
  // Post the session's result to the channel (default: true). Set false when the
  // repo's own script always posts to Slack. Use "fallback" when the session is
  // expected to post itself but silence would be a failure — the result is then
  // posted only if nothing landed in the channel while the session ran.
  postResult?: boolean | "fallback";
}

export interface SessionResult {
  issueIdentifier?: string;
  branch?: string;
  prUrl?: string;
  uploadFiles?: Array<{ path: string; caption?: string }>;
  costUsd: number;
  resultText?: string;
  testsPassed?: boolean;
  testAttempts?: number;
}

export interface SessionInfo {
  sessionId: string;
  worktreePath?: string;
  repo?: string;
  branch?: string;
  issueId?: string;
  issueIdentifier?: string;
  status: "running" | "idle" | "done";
  createdAt: string;
  prUrl?: string;
  costUsd?: number;
  slackThreadKey?: string; // "channel:threadTs" — ties a Slack thread to this session
}
