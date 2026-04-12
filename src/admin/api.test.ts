import { describe, expect, test, mock, beforeEach } from "bun:test";

// Mock fs module before importing api
const mockReadFileSync = mock((_path: unknown, _enc?: unknown) => "{}");
const mockWriteFileSync = mock((_path: unknown, _data: unknown) => undefined);
const mockReaddirSync = mock((_path: unknown) => [] as string[]);
const mockExistsSync = mock((_path: unknown) => false);

mock.module("fs", () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  readdirSync: mockReaddirSync,
  existsSync: mockExistsSync,
}));

import { handleAdminAPI } from "./api";
import type { HanniConfig, SessionInfo } from "../types";

// ── Test constants ─────────────────────────────────────────────────────────
const WS_ID = "ws1";
const WS_NAME = "YunWorkspace";
const LINEAR_API_KEY = "lin_api_test";
const IN_REVIEW_STATE_ID = "state-1";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const CONFIG_PATH = "/cfg.json";
const PATHS = { repos: "/repos", worktrees: "/worktrees", logs: "/logs" } as const;
// ──────────────────────────────────────────────────────────────────────────

// Helper: create a minimal HanniConfig
function makeConfig(overrides: Partial<HanniConfig> = {}): HanniConfig {
  return {
    provider: "claude",
    agent: { name: "Hanni" },
    server: { port: 3000, webhookPath: "/webhook" },
    linear: {
      webhookSecret: "secret",
      workspaces: {
        [WS_ID]: {
          name: WS_NAME,
          apiKey: LINEAR_API_KEY,
          inReviewStateId: IN_REVIEW_STATE_ID,
        },
      },
    },
    repositories: [],
    claude: { model: CLAUDE_MODEL, fallbackModel: CLAUDE_FALLBACK_MODEL },
    paths: PATHS,
    ...overrides,
  };
}

// Helper: make a Request
function makeReq(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Helper: read handleAsync response body
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return JSON.parse(text);
}

beforeEach(() => {
  mockReadFileSync.mockClear();
  mockWriteFileSync.mockClear();
  mockReaddirSync.mockClear();
  mockExistsSync.mockClear();
  // Default: readFileSync returns empty object (for persistConfig)
  mockReadFileSync.mockImplementation((_path: unknown, _enc?: unknown) => "{}");
});

describe("handleAdminAPI — unknown routes", () => {
  test("returns null for unknown path", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/unknown");
    const url = new URL("http://localhost/unknown");
    const result = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    expect(result).toBeNull();
  });

  test("POST /api/config returns null (undefined endpoint)", async () => {
    const config = makeConfig();
    const req = makeReq("POST", "/api/config");
    const url = new URL("http://localhost/api/config");
    const result = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    expect(result).toBeNull();
  });
});

describe("GET /api/config", () => {
  test("returns config as JSON", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/api/config");
    const url = new URL("http://localhost/api/config");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    expect(res).not.toBeNull();
    const body = await res!.json() as Record<string, unknown>;
    expect(body.provider).toBe("claude");
    expect(body.agent).toEqual({ name: "Hanni" });
  });

  test("masks openai.apiKey as *****", async () => {
    const config = makeConfig({
      openai: { apiKey: "secret-key", model: "gpt-4o" },
    });
    const req = makeReq("GET", "/api/config");
    const url = new URL("http://localhost/api/config");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    const body = await res!.json() as { openai: { apiKey: string } };
    expect(body.openai.apiKey).toBe("*****");
  });

  test("returns workspaces with hasToken field", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/api/config");
    const url = new URL("http://localhost/api/config");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    const body = await res!.json() as { workspaces: { id: string; hasToken: boolean }[] };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]!.id).toBe(WS_ID);
    expect(body.workspaces[0]!.hasToken).toBe(true);
  });
});

describe("GET /api/sessions", () => {
  test("returns empty array when sessions map is empty", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/api/sessions");
    const url = new URL("http://localhost/api/sessions");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    const body = await res!.json();
    expect(body).toEqual([]);
  });

  test("returns sessions list", async () => {
    const config = makeConfig();
    const sessions = new Map<string, SessionInfo>();
    sessions.set("YUN-1:thread-1", {
      sessionId: "session-1",
      issueIdentifier: "YUN-1",
      status: "idle",
      createdAt: new Date().toISOString(),
      slackThreadKey: "C123:thread-1",
    });
    const req = makeReq("GET", "/api/sessions");
    const url = new URL("http://localhost/api/sessions");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map(sessions));
    const body = await res!.json() as { key: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.key).toBe("YUN-1:thread-1");
  });
});

describe("DELETE /api/repositories/:name", () => {
  test("deletes an existing repository", async () => {
    const config = makeConfig({
      repositories: [
        { name: "my-repo", github: "owner/my-repo", baseBranch: "main", linearWorkspaceId: WS_ID, projectKeys: [] },
      ],
    });
    // persistConfig reads the configPath
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: config.repositories, linear: config.linear })
    );
    const req = makeReq("DELETE", "/api/repositories/my-repo");
    const url = new URL("http://localhost/api/repositories/my-repo");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body).toEqual({ ok: true });
    expect(config.repositories).toHaveLength(0);
  });

  test("returns 404 for nonexistent repository", async () => {
    const config = makeConfig({ repositories: [] });
    const req = makeReq("DELETE", "/api/repositories/nonexistent");
    const url = new URL("http://localhost/api/repositories/nonexistent");
    const res = await handleAdminAPI(req, url, config, CONFIG_PATH, new Map());
    expect(res).not.toBeNull();
    const body = await res!.json() as { error: string };
    expect(body.error).toBe("Not found");
  });
});

describe("POST /api/repositories", () => {
  test("returns 400 on validation failure", async () => {
    const config = makeConfig();
    const req = makeReq("POST", "/api/repositories", { name: "x" }); // missing github, linearWorkspaceId
    const url = new URL("http://localhost/api/repositories");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res) as { error: string };
    expect(body.error).toContain("required");
  });

  test("adds repository on valid body", async () => {
    const config = makeConfig();
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: [], linear: config.linear })
    );
    const req = makeReq("POST", "/api/repositories", {
      name: "new-repo",
      github: "owner/new-repo",
      linearWorkspaceId: WS_ID,
    });
    const url = new URL("http://localhost/api/repositories");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.repositories).toHaveLength(1);
    expect(config.repositories[0]!.name).toBe("new-repo");
    expect(config.repositories[0]!.baseBranch).toBe("main"); // default
  });
});

describe("PUT /api/repositories/:name", () => {
  test("returns 404 for nonexistent repository", async () => {
    const config = makeConfig({ repositories: [] });
    const req = makeReq("PUT", "/api/repositories/missing", { baseBranch: "develop" });
    const url = new URL("http://localhost/api/repositories/missing");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res) as { error: string };
    expect(body.error).toBe("Not found");
  });

  test("updates an existing repository", async () => {
    const config = makeConfig({
      repositories: [
        { name: "my-repo", github: "owner/my-repo", baseBranch: "main", linearWorkspaceId: WS_ID, projectKeys: [] },
      ],
    });
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: config.repositories, linear: config.linear })
    );
    const req = makeReq("PUT", "/api/repositories/my-repo", { baseBranch: "develop" });
    const url = new URL("http://localhost/api/repositories/my-repo");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.repositories[0]!.baseBranch).toBe("develop");
  });
});

describe("PUT /api/workspaces/:id", () => {
  test("returns 404 for nonexistent workspace", async () => {
    const config = makeConfig();
    const req = makeReq("PUT", "/api/workspaces/nonexistent", { inReviewStateId: "s1" });
    const url = new URL("http://localhost/api/workspaces/nonexistent");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res) as { error: string };
    expect(body.error).toBe("Not found");
  });

  test("updates workspace inReviewStateId", async () => {
    const config = makeConfig();
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: [], linear: config.linear })
    );
    const req = makeReq("PUT", `/api/workspaces/${WS_ID}`, { inReviewStateId: "new-state" });
    const url = new URL(`http://localhost/api/workspaces/${WS_ID}`);
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.linear.workspaces[WS_ID]!.inReviewStateId).toBe("new-state");
  });
});

describe("PUT /api/agent", () => {
  test("updates agent name", async () => {
    const config = makeConfig();
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: [], linear: config.linear })
    );
    const req = makeReq("PUT", "/api/agent", { name: "NewName" });
    const url = new URL("http://localhost/api/agent");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.agent.name).toBe("NewName");
  });
});

describe("GET /api/logs", () => {
  test("returns empty array when logsDir does not exist", async () => {
    const config = makeConfig();
    mockExistsSync.mockImplementation((_p: unknown) => false);
    const req = makeReq("GET", "/api/logs");
    const url = new URL("http://localhost/api/logs");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("returns list of ticket directories", async () => {
    const config = makeConfig();
    mockExistsSync.mockImplementation((_p: unknown) => true);
    mockReaddirSync.mockImplementation((p: unknown) => {
      if (p === "/logs") return ["YUN-1", "OTHER", "YUN-2"] as unknown as string[];
      // ticket dirs
      return ["session-2024-01-01.json"] as unknown as string[];
    });
    mockReadFileSync.mockImplementation((_p: unknown, _enc?: unknown) =>
      JSON.stringify({ total_cost_usd: 0.5, duration_ms: 1000, num_turns: 5, result: "ok", session_id: "s1" })
    );
    const req = makeReq("GET", "/api/logs");
    const url = new URL("http://localhost/api/logs");
    const res = (await handleAdminAPI(req, url, config, CONFIG_PATH, new Map()))!;
    const body = await res.json() as { ticket: string }[];
    // "OTHER" is filtered out — only ticket-format entries (e.g. YUN-*) are returned
    expect(body.map((b) => b.ticket).sort()).toEqual(["YUN-1", "YUN-2"]);
  });
});
