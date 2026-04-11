export interface HanniConfig {
  provider?: "claude" | "openai";
  agent: {
    name: string;
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

export interface ScheduledJob {
  name: string;             // ジョブ識別子（重複チェックファイル名に使用）
  utcHour: number;
  utcMinute?: number;       // デフォルト: 0
  slackWorkspaceId: string; // Slack team_id
  channel: string;
  repo?: string;            // repositories の name（省略時はリポジトリなしで実行）
  message: string;          // Claude に渡すメッセージ
  initMessage?: string;     // Slack 初期投稿メッセージ（デフォルト: "⏰ 実行中〜"）
}

export interface SessionResult {
  issueIdentifier?: string;
  branch?: string;
  prUrl?: string;
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
