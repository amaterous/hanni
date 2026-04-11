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
export const SCREENSHOT_KEYWORDS_RE = /(スクショ|screenshot|スクリーンショット)/i;
export const DOMAIN_EXTENSION_RE = /\.(?:site|com|net|org|dev|app|io)/;
