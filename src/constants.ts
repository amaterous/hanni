// API base URLs
export const SLACK_API_BASE = "https://slack.com/api";
export const LINEAR_API_URL = "https://api.linear.app/graphql";

// Timeouts & Intervals (ms)
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const SCHEDULER_CHECK_INTERVAL_MS = 60 * 1000;
export const SLACK_REPLAY_PROTECTION_SECONDS = 300;
export const SCREENSHOT_WAIT_MS = 3000;
export const SCREENSHOT_LOAD_TIMEOUT_MS = 30_000;

// Slack limits
export const SLACK_THREAD_FETCH_LIMIT = 200;
export const SLACK_MESSAGE_CHAR_LIMIT = 40000;
export const SLACK_URL_INFER_MAX_TURNS = 10;

// Session
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 8;

// Screenshot defaults
export const SCREENSHOT_DEFAULT_WIDTH = 1280;
export const SCREENSHOT_DEFAULT_HEIGHT = 800;

// Routing
export const FALLBACK_REPO_NAME = "_default";

// Server paths
export const SERVER_PATH_HEALTH = "/health";
export const SERVER_PATH_SLACK_EVENTS = "/slack/events";

// Regex
/** Matches screenshot-related keywords in Japanese (スクショ / スクリーンショット) and English. */
export const SCREENSHOT_KEYWORDS_RE = /(スクショ|screenshot|スクリーンショット)/i;
export const DOMAIN_EXTENSION_RE = /\.(?:site|com|net|org|dev|app|io)/;

// Claude models
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_CLAUDE_FALLBACK_MODEL = "claude-haiku-4-5-20251001";

// Session
export const SESSION_MAX_TURNS = 100;

// MCP
export const LINEAR_MCP_PACKAGE = "@tacticlaunch/mcp-linear";

// Default server config
export const DEFAULT_PORT = 3460;
export const DEFAULT_WEBHOOK_PATH = "/webhook";
export const DEFAULT_WORKSPACE_NAME = "workspace";

// Default paths (relative, used at startup)
export const DEFAULT_PATHS = { repos: "./repos", worktrees: "./worktrees", logs: "./logs" } as const;

// Default config / tokens file paths
export const DEFAULT_CONFIG_FILE = "./config.json";
export const DEFAULT_TOKENS_FILE = "./tokens.json";
