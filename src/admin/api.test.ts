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

// Helper: create a minimal HanniConfig
function makeConfig(overrides: Partial<HanniConfig> = {}): HanniConfig {
  return {
    provider: "claude",
    agent: { name: "Hanni" },
    server: { port: 3000, webhookPath: "/webhook" },
    linear: {
      webhookSecret: "secret",
      workspaces: {
        ws1: {
          name: "YunWorkspace",
          apiKey: "lin_api_test",
          inReviewStateId: "state-1",
        },
      },
    },
    repositories: [],
    claude: { model: "claude-3-5-sonnet", fallbackModel: "claude-3-haiku" },
    paths: { repos: "/repos", worktrees: "/worktrees", logs: "/logs" },
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
  test("未知のパスは null を返す", () => {
    const config = makeConfig();
    const req = makeReq("GET", "/unknown");
    const url = new URL("http://localhost/unknown");
    const result = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    expect(result).toBeNull();
  });

  test("POST /api/config は null を返す（未定義エンドポイント）", () => {
    const config = makeConfig();
    const req = makeReq("POST", "/api/config");
    const url = new URL("http://localhost/api/config");
    const result = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    expect(result).toBeNull();
  });
});

describe("GET /api/config", () => {
  test("config を JSON で返す", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/api/config");
    const url = new URL("http://localhost/api/config");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    expect(res).not.toBeNull();
    const body = await res!.json() as Record<string, unknown>;
    expect(body.provider).toBe("claude");
    expect(body.agent).toEqual({ name: "Hanni" });
  });

  test("openai.apiKey が **** にマスクされる", async () => {
    const config = makeConfig({
      openai: { apiKey: "secret-key", model: "gpt-4o" },
    });
    const req = makeReq("GET", "/api/config");
    const url = new URL("http://localhost/api/config");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    const body = await res!.json() as { openai: { apiKey: string } };
    expect(body.openai.apiKey).toBe("*****");
  });

  test("workspaces が hasToken 付きで返る", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/api/config");
    const url = new URL("http://localhost/api/config");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    const body = await res!.json() as { workspaces: { id: string; hasToken: boolean }[] };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]!.id).toBe("ws1");
    expect(body.workspaces[0]!.hasToken).toBe(true);
  });
});

describe("GET /api/sessions", () => {
  test("空のセッションマップ → 空配列", async () => {
    const config = makeConfig();
    const req = makeReq("GET", "/api/sessions");
    const url = new URL("http://localhost/api/sessions");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    const body = await res!.json();
    expect(body).toEqual([]);
  });

  test("セッションが返る", async () => {
    const config = makeConfig();
    const sessions = new Map<string, SessionInfo>();
    sessions.set("YUN-1:thread-1", {
      issueIdentifier: "YUN-1",
      issueTitle: "Fix bug",
      slackThreadTs: "thread-1",
      slackChannelId: "C123",
      workspaceId: "ws1",
      startedAt: new Date().toISOString(),
    } as SessionInfo);
    const req = makeReq("GET", "/api/sessions");
    const url = new URL("http://localhost/api/sessions");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map(sessions));
    const body = await res!.json() as { key: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.key).toBe("YUN-1:thread-1");
  });
});

describe("DELETE /api/repositories/:name", () => {
  test("存在するリポジトリを削除する", async () => {
    const config = makeConfig({
      repositories: [
        { name: "my-repo", github: "owner/my-repo", baseBranch: "main", linearWorkspaceId: "ws1", projectKeys: [] },
      ],
    });
    // persistConfig reads the configPath
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: config.repositories, linear: config.linear })
    );
    const req = makeReq("DELETE", "/api/repositories/my-repo");
    const url = new URL("http://localhost/api/repositories/my-repo");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body).toEqual({ ok: true });
    expect(config.repositories).toHaveLength(0);
  });

  test("存在しないリポジトリ → 404", async () => {
    const config = makeConfig({ repositories: [] });
    const req = makeReq("DELETE", "/api/repositories/nonexistent");
    const url = new URL("http://localhost/api/repositories/nonexistent");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map());
    expect(res).not.toBeNull();
    const body = await res!.json() as { error: string };
    expect(body.error).toBe("Not found");
  });
});

describe("POST /api/repositories", () => {
  test("バリデーション失敗 → 400", async () => {
    const config = makeConfig();
    const req = makeReq("POST", "/api/repositories", { name: "x" }); // missing github, linearWorkspaceId
    const url = new URL("http://localhost/api/repositories");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res) as { error: string };
    expect(body.error).toContain("required");
  });

  test("有効なボディ → リポジトリ追加", async () => {
    const config = makeConfig();
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: [], linear: config.linear })
    );
    const req = makeReq("POST", "/api/repositories", {
      name: "new-repo",
      github: "owner/new-repo",
      linearWorkspaceId: "ws1",
    });
    const url = new URL("http://localhost/api/repositories");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.repositories).toHaveLength(1);
    expect(config.repositories[0]!.name).toBe("new-repo");
    expect(config.repositories[0]!.baseBranch).toBe("main"); // default
  });
});

describe("PUT /api/repositories/:name", () => {
  test("存在しないリポジトリ → 404", async () => {
    const config = makeConfig({ repositories: [] });
    const req = makeReq("PUT", "/api/repositories/missing", { baseBranch: "develop" });
    const url = new URL("http://localhost/api/repositories/missing");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res) as { error: string };
    expect(body.error).toBe("Not found");
  });

  test("存在するリポジトリを更新する", async () => {
    const config = makeConfig({
      repositories: [
        { name: "my-repo", github: "owner/my-repo", baseBranch: "main", linearWorkspaceId: "ws1", projectKeys: [] },
      ],
    });
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: config.repositories, linear: config.linear })
    );
    const req = makeReq("PUT", "/api/repositories/my-repo", { baseBranch: "develop" });
    const url = new URL("http://localhost/api/repositories/my-repo");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.repositories[0]!.baseBranch).toBe("develop");
  });
});

describe("PUT /api/workspaces/:id", () => {
  test("存在しないワークスペース → 404", async () => {
    const config = makeConfig();
    const req = makeReq("PUT", "/api/workspaces/nonexistent", { inReviewStateId: "s1" });
    const url = new URL("http://localhost/api/workspaces/nonexistent");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res) as { error: string };
    expect(body.error).toBe("Not found");
  });

  test("ワークスペースの inReviewStateId を更新する", async () => {
    const config = makeConfig();
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: [], linear: config.linear })
    );
    const req = makeReq("PUT", "/api/workspaces/ws1", { inReviewStateId: "new-state" });
    const url = new URL("http://localhost/api/workspaces/ws1");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.linear.workspaces["ws1"]!.inReviewStateId).toBe("new-state");
  });
});

describe("PUT /api/agent", () => {
  test("エージェント名を更新する", async () => {
    const config = makeConfig();
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ agent: config.agent, repositories: [], linear: config.linear })
    );
    const req = makeReq("PUT", "/api/agent", { name: "NewName" });
    const url = new URL("http://localhost/api/agent");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await readBody(res);
    expect(body).toEqual({ ok: true });
    expect(config.agent.name).toBe("NewName");
  });
});

describe("GET /api/logs", () => {
  test("logsDir が存在しない → 空配列", async () => {
    const config = makeConfig();
    mockExistsSync.mockImplementation((_p: unknown) => false);
    const req = makeReq("GET", "/api/logs");
    const url = new URL("http://localhost/api/logs");
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("チケットディレクトリ一覧を返す", async () => {
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
    const res = handleAdminAPI(req, url, config, "/cfg.json", new Map())!;
    const body = await res.json() as { ticket: string }[];
    // "OTHER" はフィルタされて YUN-* のみ
    expect(body.map((b) => b.ticket).sort()).toEqual(["YUN-1", "YUN-2"]);
  });
});
