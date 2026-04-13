import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { mock as bunMock } from "bun:test";
import { constants as fsConstants } from "node:fs";
import {
  TEST_WS_ID,
  TEST_LINEAR_API_KEY,
  TEST_MODEL_SONNET,
  TEST_REPOS_DIR,
  TEST_WORKTREES_DIR,
  TEST_LOGS_DIR,
  TEST_REPO_NAME,
  TEST_REPO_GITHUB,
  TEST_REPO_PATH,
  TEST_BASE_BRANCH,
  TEST_ISSUE_ID,
  TEST_ISSUE_YUN_1,
  TEST_ISSUE_YUN_2,
  TEST_ISSUE_YUN_3,
  TEST_SESSION_ID,
} from "../__tests__/test-constants";

// ── mock function instances (module-level so resetMocks() can reference them) ─

const mockExistsSync = mock(() => false);
const mockReadFileSync = mock(() => "{}");
const mockWriteFileSync = mock(() => {});
const mockMkdirSync = mock(() => {});

const mockCreateComment = mock(async (_issueId: string, _body: string) => {});
const mockPostAgentActivity = mock(async (_opts: any) => {});
const MockLinearClient = mock(() => ({
  createComment: mockCreateComment,
  postAgentActivity: mockPostAgentActivity,
}));

const mockEnsureRepo = mock(async () => TEST_REPO_PATH);
const mockCreateWorktree = mock(async () => ({
  worktreePath: `${TEST_WORKTREES_DIR}/abc`,
  branchName: "hanni/feature-branch",
}));
const mockRouteToRepository = mock(() => null);

const mockRunModelSession = mock(async (_config: any, _params: any) => ({
  sessionId: TEST_SESSION_ID,
  success: true,
  costUsd: 0.05,
  durationMs: 500,
  resultText: "Done",
}));

const mockPushAndCreatePR = mock(async () => ({ prUrl: null as string | null }));

// orchestration-prompt is NOT mocked — real pure functions are used to avoid
// module-mock bleed into src/session/orchestration-prompt.test.ts

const mockLog = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
};

// ── register module mocks + import in beforeAll ───────────────────────────────
// Registering mock.module inside beforeAll (not at module-load time) prevents
// the ./runner mock from leaking into runner.test.ts's module-level imports,
// which would cause runner.test.ts to capture the spy rather than the real fn.

let SessionManager: Awaited<typeof import("./manager")>["SessionManager"];

beforeAll(async () => {
  bunMock.module("fs", () => ({
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    constants: fsConstants,
  }));

  bunMock.module("../linear/client", () => ({
    LinearClient: MockLinearClient,
  }));

  bunMock.module("../git/repo-manager", () => ({
    ensureRepo: mockEnsureRepo,
  }));

  bunMock.module("../git/worktree", () => ({
    createWorktree: mockCreateWorktree,
  }));

  bunMock.module("../routing/router", () => ({
    routeToRepository: mockRouteToRepository,
  }));

  // No module mock needed for the session runner — DI via constructor is used instead.

  bunMock.module("../post-session/pr-creator", () => ({
    pushAndCreatePR: mockPushAndCreatePR,
  }));

  bunMock.module("../utils/logger", () => ({
    createLogger: mock(() => mockLog),
  }));

  ({ SessionManager } = await import("./manager"));
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    paths: { logs: TEST_LOGS_DIR, repos: TEST_REPOS_DIR, worktrees: TEST_WORKTREES_DIR },
    linear: {
      workspaces: {
        [TEST_WS_ID]: { apiKey: TEST_LINEAR_API_KEY, inReviewStateId: "state-1", viewerId: "viewer-1" },
      },
    },
    claude: { model: TEST_MODEL_SONNET, fallbackModel: undefined },
    agent: { name: "hanni" },
    repositories: [
      {
        name: TEST_REPO_NAME,
        github: TEST_REPO_GITHUB,
        localPath: TEST_REPO_PATH,
        baseBranch: TEST_BASE_BRANCH,
      },
    ],
    ...overrides,
  } as any;
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_ISSUE_ID,
    identifier: TEST_ISSUE_YUN_1,
    title: "Test issue",
    description: "Fix something",
    ...overrides,
  } as any;
}

function resetMocks() {
  mockExistsSync.mockReset();
  mockExistsSync.mockImplementation(() => false);
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockCreateComment.mockReset();
  mockPostAgentActivity.mockReset();
  MockLinearClient.mockReset();
  MockLinearClient.mockImplementation(() => ({
    createComment: mockCreateComment,
    postAgentActivity: mockPostAgentActivity,
  }));
  mockEnsureRepo.mockReset();
  mockEnsureRepo.mockImplementation(async () => TEST_REPO_PATH);
  mockCreateWorktree.mockReset();
  mockCreateWorktree.mockImplementation(async () => ({
    worktreePath: `${TEST_WORKTREES_DIR}/abc`,
    branchName: "hanni/feature-branch",
  }));
  mockRouteToRepository.mockReset();
  mockRouteToRepository.mockImplementation(() => null);
  mockRunModelSession.mockReset();
  mockRunModelSession.mockImplementation(async () => ({
    sessionId: TEST_SESSION_ID,
    success: true,
    costUsd: 0.05,
    durationMs: 0,
    resultText: "Done",
  }));
  mockPushAndCreatePR.mockReset();
  mockPushAndCreatePR.mockImplementation(async () => ({ prUrl: null }));
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("SessionManager", () => {
  describe("constructor / loadFromDisk", () => {
    it("starts with empty sessions when file does not exist", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => false);
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.getSessions().size).toBe(0);
    });

    it("loads sessions from disk when file exists", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: {
            sessionId: "s1",
            status: "idle",
            issueId: TEST_ISSUE_ID,
            issueIdentifier: TEST_ISSUE_YUN_1,
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.getSessions().size).toBe(1);
    });

    it("resets stale 'running' sessions to 'idle' on load", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_2]: {
            sessionId: "s2",
            status: "running",
            issueId: "issue-2",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const session = sm.getSessions().get(TEST_ISSUE_YUN_2);
      expect(session?.status).toBe("idle");
    });

    it("handles corrupt JSON gracefully", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() => "INVALID JSON{{{");
      // Should not throw
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.getSessions().size).toBe(0);
    });
  });

  describe("hasSession", () => {
    it("returns false when no sessions exist", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.hasSession(TEST_ISSUE_ID)).toBe(false);
    });

    it("returns true when issue is tracked", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: { sessionId: "s1", status: "idle", issueId: TEST_ISSUE_ID, createdAt: "2025-01-01T00:00:00Z" },
        }),
      );
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.hasSession(TEST_ISSUE_ID)).toBe(true);
    });

    it("returns false for unknown issueId", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: { sessionId: "s1", status: "idle", issueId: TEST_ISSUE_ID, createdAt: "2025-01-01T00:00:00Z" },
        }),
      );
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.hasSession("unknown-id")).toBe(false);
    });
  });

  describe("getSessionBySlackThread", () => {
    it("returns undefined when no sessions match", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(sm.getSessionBySlackThread("C123", "1234.5678")).toBeUndefined();
    });

    it("returns session matching channel + threadTs", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "slack:C123:1234.5678": {
            sessionId: "s1",
            status: "idle",
            slackThreadKey: "C123:1234.5678",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const found = sm.getSessionBySlackThread("C123", "1234.5678");
      expect(found).toBeDefined();
      expect(found?.slackThreadKey).toBe("C123:1234.5678");
    });
  });

  describe("getLinearClient", () => {
    it("returns a LinearClient for known workspace", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const client = sm.getLinearClient(TEST_WS_ID);
      expect(client).toBeDefined();
      expect(MockLinearClient).toHaveBeenCalled();
    });

    it("throws for unknown workspace", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      expect(() => sm.getLinearClient("unknown")).toThrow("Unknown workspace: unknown");
    });

    it("uses apiKey for LinearClient", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      sm.getLinearClient(TEST_WS_ID);
      expect(MockLinearClient).toHaveBeenCalledWith(TEST_LINEAR_API_KEY);
    });
  });

  describe("handleNewIssue", () => {
    it("returns null when MAX_CONCURRENT reached", async () => {
      resetMocks();
      process.env.MAX_CONCURRENT_SESSIONS = "2";
      const config = makeConfig();
      const repo = config.repositories[0];
      mockRouteToRepository.mockImplementation(() => repo);

      // Hang runModelSession so running never decrements
      let resolveHang: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() => hangPromise.then(() => ({ sessionId: "s", success: true, costUsd: 0, durationMs: 0, resultText: "" })));

      const sm = new SessionManager(config, mockRunModelSession);

      // Kick off 2 sessions (MAX_CONCURRENT = 2) without awaiting
      sm.handleNewIssue(makeIssue({ id: "i1", identifier: TEST_ISSUE_YUN_1 }), TEST_WS_ID);
      sm.handleNewIssue(makeIssue({ id: "i2", identifier: TEST_ISSUE_YUN_2 }), TEST_WS_ID);

      // 3rd should be rejected
      const result = await sm.handleNewIssue(makeIssue({ id: "i3", identifier: TEST_ISSUE_YUN_3 }), TEST_WS_ID);
      expect(result).toBeNull();

      resolveHang!();
      delete process.env.MAX_CONCURRENT_SESSIONS;
    });

    it("returns null when no repo found", async () => {
      resetMocks();
      mockRouteToRepository.mockImplementation(() => null);
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const result = await sm.handleNewIssue(makeIssue(), TEST_WS_ID);
      expect(result).toBeNull();
    });

    it("uses overrideRepo when provided", async () => {
      resetMocks();
      const config = makeConfig();
      const overrideRepo = { ...config.repositories[0], name: "override-repo" };

      const sm = new SessionManager(config, mockRunModelSession);
      const result = await sm.handleNewIssue(makeIssue(), TEST_WS_ID, undefined, overrideRepo);

      expect(result).not.toBeNull();
      expect(mockRouteToRepository).not.toHaveBeenCalled();
    });

    it("runs executeSession and returns result", async () => {
      resetMocks();
      const config = makeConfig();
      mockRouteToRepository.mockImplementation(() => config.repositories[0]);
      // Return actual __RESULT__ format so parseResultMetadata can extract fields
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: TEST_SESSION_ID,
        success: true,
        costUsd: 0.05,
        durationMs: 0,
        resultText: "Done!\n```\n__RESULT__\nPR: https://github.com/owner/myrepo/pull/1\nBRANCH: hanni/feature-branch\n```",
      }));

      const sm = new SessionManager(config, mockRunModelSession);
      const result = await sm.handleNewIssue(makeIssue(), TEST_WS_ID);

      expect(result).not.toBeNull();
      expect(result?.costUsd).toBe(0.05);
      expect(result?.prUrl).toBe("https://github.com/owner/myrepo/pull/1");
    });

    it("saves session to disk after execution", async () => {
      resetMocks();
      const config = makeConfig();
      mockRouteToRepository.mockImplementation(() => config.repositories[0]);

      const sm = new SessionManager(config, mockRunModelSession);
      await sm.handleNewIssue(makeIssue(), TEST_WS_ID);

      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });

  describe("handleComment", () => {
    it("does nothing when no session found for issue", async () => {
      resetMocks();
      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      await sm.handleComment("unknown-issue", "body", "user-1", TEST_WS_ID);
      expect(mockRunModelSession).not.toHaveBeenCalled();
    });

    it("ignores comment from hanni itself (viewerId match)", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: {
            sessionId: "s1",
            status: "idle",
            issueId: TEST_ISSUE_ID,
            issueIdentifier: TEST_ISSUE_YUN_1,
            worktreePath: `${TEST_WORKTREES_DIR}/abc`,
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      // viewer-1 is the viewerId in ws1 config
      await sm.handleComment(TEST_ISSUE_ID, "body", "viewer-1", TEST_WS_ID);
      expect(mockRunModelSession).not.toHaveBeenCalled();
    });

    it("ignores comment when session is still running", async () => {
      resetMocks();
      // loadFromDisk resets "running" → "idle", so we need to create a live running session
      let resolveHang!: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() =>
        hangPromise.then(() => ({ sessionId: "s", success: true, costUsd: 0, durationMs: 0, resultText: "" })),
      );

      const config = makeConfig();
      mockRouteToRepository.mockImplementation(() => config.repositories[0]);

      const sm = new SessionManager(config, mockRunModelSession);
      // Start handleNewIssue without awaiting — session status becomes "running"
      sm.handleNewIssue(makeIssue({ id: TEST_ISSUE_ID, identifier: TEST_ISSUE_YUN_1 }), TEST_WS_ID);

      // Now handleComment should see status "running" and bail out
      mockRunModelSession.mockClear();
      await sm.handleComment(TEST_ISSUE_ID, "body", "other-user", TEST_WS_ID);
      expect(mockRunModelSession).not.toHaveBeenCalled();

      resolveHang();
    });

    it("resumes session with comment", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      const OLD_SESSION = "old-session";
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: {
            sessionId: OLD_SESSION,
            status: "idle",
            issueId: TEST_ISSUE_ID,
            issueIdentifier: TEST_ISSUE_YUN_1,
            worktreePath: `${TEST_WORKTREES_DIR}/abc`,
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      await sm.handleComment(TEST_ISSUE_ID, "fix the bug", "other-user", TEST_WS_ID);

      expect(mockRunModelSession).toHaveBeenCalledTimes(1);
      const callArgs = mockRunModelSession.mock.calls[0][1];
      expect(callArgs.prompt).toBe("fix the bug");
      expect(callArgs.resumeSessionId).toBe(OLD_SESSION);
    });

    it("posts resultText as Linear comment", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: {
            sessionId: "s1",
            status: "idle",
            issueId: TEST_ISSUE_ID,
            issueIdentifier: TEST_ISSUE_YUN_1,
            worktreePath: `${TEST_WORKTREES_DIR}/abc`,
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: "s2",
        success: true,
        costUsd: 0.01,
        durationMs: 0,
        resultText: "Here is the answer",
      }));

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      await sm.handleComment(TEST_ISSUE_ID, "tell me something", "other-user", TEST_WS_ID);

      expect(mockCreateComment).toHaveBeenCalledWith(TEST_ISSUE_ID, "Here is the answer");
    });

    it("falls back to fresh session when resume fails", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: {
            sessionId: "dead-session",
            status: "idle",
            issueId: TEST_ISSUE_ID,
            issueIdentifier: TEST_ISSUE_YUN_1,
            worktreePath: `${TEST_WORKTREES_DIR}/abc`,
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );

      let callCount = 0;
      mockRunModelSession.mockImplementation(async (_config: any, opts: any) => {
        callCount++;
        if (callCount === 1) throw new Error("session not found");
        return { sessionId: "new-session", success: true, durationMs: 0, costUsd: 0.01, resultText: "Fresh start" };
      });

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      await sm.handleComment(TEST_ISSUE_ID, "hello", "other-user", TEST_WS_ID);

      expect(callCount).toBe(2);
      // Second call should NOT have resumeSessionId
      const secondCallArgs = mockRunModelSession.mock.calls[1][1];
      expect(secondCallArgs.resumeSessionId).toBeUndefined();
    });

    it("creates PR comment when pushAndCreatePR returns prUrl", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      const config = makeConfig();
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          [TEST_ISSUE_YUN_1]: {
            sessionId: "s1",
            status: "idle",
            issueId: TEST_ISSUE_ID,
            issueIdentifier: TEST_ISSUE_YUN_1,
            worktreePath: `${TEST_WORKTREES_DIR}/abc`,
            repo: TEST_REPO_NAME,
            branch: "hanni/feature",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      mockPushAndCreatePR.mockImplementation(async () => ({
        prUrl: `https://github.com/${TEST_REPO_GITHUB}/pull/42`,
      }));

      const sm = new SessionManager(config, mockRunModelSession);
      await sm.handleComment(TEST_ISSUE_ID, "push please", "other-user", TEST_WS_ID);

      // Should have created two comments: result + PR URL
      expect(mockCreateComment).toHaveBeenCalledTimes(2);
      const prComment = mockCreateComment.mock.calls[1][1];
      expect(prComment).toContain(`https://github.com/${TEST_REPO_GITHUB}/pull/42`);
    });
  });

  describe("runAction", () => {
    it("returns busy message when same thread already running", async () => {
      resetMocks();
      // loadFromDisk resets "running" → "idle", so start a live runAction instead
      let resolveHang!: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() =>
        hangPromise.then(() => ({ sessionId: "s", success: true, costUsd: 0, durationMs: 0, resultText: "" })),
      );

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      // Start runAction without awaiting — session status becomes "running"
      sm.runAction({ message: "task", slackThread: { channel: "C123", threadTs: "1234.5678" } });

      const result = await sm.runAction({
        message: "do something",
        slackThread: { channel: "C123", threadTs: "1234.5678" },
      });

      expect(result.resultText).toContain("Still working");
      resolveHang();
    });

    it("returns busy message when MAX_CONCURRENT reached", async () => {
      resetMocks();
      process.env.MAX_CONCURRENT_SESSIONS = "2";

      let resolveHang: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() =>
        hangPromise.then(() => ({ sessionId: "s", success: true, costUsd: 0, durationMs: 0, resultText: "" })),
      );

      const sm = new SessionManager(makeConfig(), mockRunModelSession);

      // Fill up capacity
      sm.runAction({ message: "task1", slackThread: { channel: "C1", threadTs: "t1" } });
      sm.runAction({ message: "task2", slackThread: { channel: "C2", threadTs: "t2" } });

      const result = await sm.runAction({
        message: "task3",
        slackThread: { channel: "C3", threadTs: "t3" },
      });

      expect(result.resultText).toContain("capacity");
      resolveHang!();
      delete process.env.MAX_CONCURRENT_SESSIONS;
    });

    it("runs session without repo (scratch directory)", async () => {
      resetMocks();
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: TEST_SESSION_ID,
        success: true,
        costUsd: 0.01,
        durationMs: 0,
        resultText: "All done",
      }));

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const result = await sm.runAction({
        message: "just answer this question",
        slackThread: { channel: "C999", threadTs: "9999.0000" },
      });

      expect(result.resultText).toBe("All done");
      expect(mockEnsureRepo).not.toHaveBeenCalled();
      expect(mockCreateWorktree).not.toHaveBeenCalled();
    });

    it("creates worktree when repo is provided", async () => {
      resetMocks();
      const config = makeConfig();
      const repo = config.repositories[0];

      const sm = new SessionManager(config, mockRunModelSession);
      await sm.runAction({
        message: "code task",
        repo,
        slackThread: { channel: "C123", threadTs: "1111.2222" },
      });

      expect(mockEnsureRepo).toHaveBeenCalledWith(repo, config.paths.repos);
      expect(mockCreateWorktree).toHaveBeenCalled();
    });

    it("passes linearApiKey as MCP server config", async () => {
      resetMocks();

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      await sm.runAction({
        message: "create a ticket",
        slackThread: { channel: "C123", threadTs: "1111.2222" },
        linearApiKey: "lin_api_my_key",
      });

      const callArgs = mockRunModelSession.mock.calls[0][1];
      expect(callArgs.mcpServers).toBeDefined();
      expect(callArgs.mcpServers!.linear.env!.LINEAR_API_TOKEN).toBe("lin_api_my_key");
    });

    it("returns error message when runModelSession throws", async () => {
      resetMocks();
      mockRunModelSession.mockImplementation(async () => {
        throw new Error("Claude exploded");
      });

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const result = await sm.runAction({
        message: "something",
        slackThread: { channel: "C123", threadTs: "1111.2222" },
      });

      expect(result.resultText).toContain("error");
    });

    it("parses structured result fields from model output", async () => {
      resetMocks();
      // Use actual __RESULT__ format so real parseResultMetadata can extract fields
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: "s-new",
        success: true,
        costUsd: 0.12,
        durationMs: 0,
        resultText: "Clean result\n```\n__RESULT__\nTICKET: YUN-99\nBRANCH: hanni/yun-99-fix\nPR: https://github.com/owner/repo/pull/99\n```",
      }));

      const sm = new SessionManager(makeConfig(), mockRunModelSession);
      const result = await sm.runAction({
        message: "fix issue YUN-99",
        slackThread: { channel: "C123", threadTs: "1111.2222" },
      });

      expect(result.issueIdentifier).toBe("YUN-99");
      expect(result.branch).toBe("hanni/yun-99-fix");
      expect(result.prUrl).toBe("https://github.com/owner/repo/pull/99");
      expect(result.resultText).toBe("Clean result");
      expect(result.costUsd).toBe(0.12);
    });
  });
});

// Restore module mocks (fs, linear/client, etc.) so they don't bleed into other test files
afterAll(() => {
  mock.restore();
});

