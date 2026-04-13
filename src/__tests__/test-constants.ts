// Shared constants for test files.
// Keep values here — each magic string lives in exactly one place.

// ── Identifiers ────────────────────────────────────────────────────────────
export const TEST_WS_ID = "ws1";
export const TEST_WS_ID_ALT = "ws-1";
export const TEST_WS_ID_KNOWN = "ws-known";
export const TEST_ISSUE_ID = "issue-1";
export const TEST_ISSUE_YUN_1 = "YUN-1";
export const TEST_ISSUE_YUN_2 = "YUN-2";
export const TEST_ISSUE_YUN_3 = "YUN-3";
export const TEST_ISSUE_YUN_42 = "YUN-42";
export const TEST_ISSUE_YUN_99 = "YUN-99";
export const TEST_ISSUE_YUN_123 = "YUN-123";
export const TEST_ISSUE_SKY_12 = "SKY-12";
export const TEST_ISSUE_SKY_99 = "SKY-99";
export const TEST_SESSION_ID = "sess-123";
export const TEST_SLACK_TEAM_ID = "T123";
export const TEST_SLACK_USER_ID = "U123";
export const TEST_SLACK_BOT_USER_ID = "U_BOT";
export const TEST_SLACK_CHANNEL_ID = "C123";
export const TEST_SLACK_THREAD_KEY = `${TEST_SLACK_CHANNEL_ID}:thread-1`;

// ── Credentials (fake, test-only) ─────────────────────────────────────────
export const TEST_LINEAR_API_KEY = "lin_api_test";
export const TEST_SLACK_BOT_TOKEN = "xoxb-test-token";
export const TEST_SLACK_SIGNING_SECRET = "test-signing-secret";
export const TEST_WEBHOOK_SECRET = "secret";

// ── Paths ──────────────────────────────────────────────────────────────────
export const TEST_REPOS_DIR = "/repos";
export const TEST_WORKTREES_DIR = "/worktrees";
export const TEST_LOGS_DIR = "/logs";
export const TEST_REPO_PATH = "/repos/myrepo";
export const TEST_CONFIG_PATH = "/cfg.json";

// ── Repository / GitHub ───────────────────────────────────────────────────
export const TEST_REPO_NAME = "myrepo";
export const TEST_REPO_GITHUB = "owner/myrepo";
export const TEST_BASE_BRANCH = "main";
export const TEST_REPO_IQ_TEST = "iq-test";
export const TEST_REPO_GITHUB_IQ_TEST = "yuppppppppppqi/iq-test";
export const TEST_REPO_PICOLI = "picoli.site";
export const TEST_REPO_THREAD_SPARK = "thread-spark";
export const TEST_REPO_CORTEX_LAB = "cortex-lab";

// ── Models ────────────────────────────────────────────────────────────────
export const TEST_MODEL_SONNET = "claude-sonnet-4-6";
export const TEST_MODEL_HAIKU = "claude-haiku-4-5-20251001";
export const TEST_MODEL_OPUS = "claude-opus-4-6";

// ── Server ────────────────────────────────────────────────────────────────
export const TEST_SERVER_PORT = 3000;
export const TEST_WEBHOOK_PATH = "/webhook";
