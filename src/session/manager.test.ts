import { describe, it, expect, beforeEach, mock, afterAll } from "bun:test";
import { mock as bunMock } from "bun:test";

// ── mocks ────────────────────────────────────────────────────────────────────

const mockExistsSync = mock(() => false);
const mockReadFileSync = mock(() => "{}");
const mockWriteFileSync = mock(() => {});
const mockMkdirSync = mock(() => {});

bunMock.module("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

const mockCreateComment = mock(async () => {});
const mockPostAgentActivity = mock(async () => {});
const MockLinearClient = mock(() => ({
  createComment: mockCreateComment,
  postAgentActivity: mockPostAgentActivity,
}));

bunMock.module("../linear/client", () => ({
  LinearClient: MockLinearClient,
}));

const mockEnsureRepo = mock(async () => "/repos/myrepo");
bunMock.module("../git/repo-manager", () => ({
  ensureRepo: mockEnsureRepo,
}));

const mockCreateWorktree = mock(async () => ({
  worktreePath: "/worktrees/abc",
  branchName: "hanni/feature-branch",
}));
bunMock.module("../git/worktree", () => ({
  createWorktree: mockCreateWorktree,
}));

const mockRouteToRepository = mock(() => null);
bunMock.module("../routing/router", () => ({
  routeToRepository: mockRouteToRepository,
}));

const mockRunModelSession = mock(async () => ({
  sessionId: "sess-123",
  costUsd: 0.05,
  resultText: "Done",
}));
bunMock.module("./runner", () => ({
  runModelSession: mockRunModelSession,
}));

const mockPushAndCreatePR = mock(async () => ({ prUrl: null }));
bunMock.module("../post-session/pr-creator", () => ({
  pushAndCreatePR: mockPushAndCreatePR,
}));

// orchestration-prompt is NOT mocked — real pure functions are used to avoid
// module-mock bleed into src/session/orchestration-prompt.test.ts

const mockLog = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
};
bunMock.module("../utils/logger", () => ({
  createLogger: mock(() => mockLog),
}));

// ── import after mocks ────────────────────────────────────────────────────────

const { SessionManager } = await import("./manager");

// ── helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    paths: { logs: "/logs", repos: "/repos", worktrees: "/worktrees" },
    linear: {
      workspaces: {
        ws1: { apiKey: "lin_key", inReviewStateId: "state-1", viewerId: "viewer-1" },
      },
    },
    claude: { model: "claude-3-5-sonnet", fallbackModel: undefined },
    agent: { name: "hanni" },
    repositories: [
      {
        name: "myrepo",
        github: "owner/myrepo",
        localPath: "/repos/myrepo",
        baseBranch: "main",
      },
    ],
    ...overrides,
  } as any;
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "YUN-1",
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
  mockEnsureRepo.mockImplementation(async () => "/repos/myrepo");
  mockCreateWorktree.mockReset();
  mockCreateWorktree.mockImplementation(async () => ({
    worktreePath: "/worktrees/abc",
    branchName: "hanni/feature-branch",
  }));
  mockRouteToRepository.mockReset();
  mockRouteToRepository.mockImplementation(() => null);
  mockRunModelSession.mockReset();
  mockRunModelSession.mockImplementation(async () => ({
    sessionId: "sess-123",
    costUsd: 0.05,
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
      const sm = new SessionManager(makeConfig());
      expect(sm.getSessions().size).toBe(0);
    });

    it("loads sessions from disk when file exists", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": {
            sessionId: "s1",
            status: "idle",
            issueId: "issue-1",
            issueIdentifier: "YUN-1",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      const sm = new SessionManager(makeConfig());
      expect(sm.getSessions().size).toBe(1);
    });

    it("resets stale 'running' sessions to 'idle' on load", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-2": {
            sessionId: "s2",
            status: "running",
            issueId: "issue-2",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      const sm = new SessionManager(makeConfig());
      const session = sm.getSessions().get("YUN-2");
      expect(session?.status).toBe("idle");
    });

    it("handles corrupt JSON gracefully", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() => "INVALID JSON{{{");
      // Should not throw
      const sm = new SessionManager(makeConfig());
      expect(sm.getSessions().size).toBe(0);
    });
  });

  describe("hasSession", () => {
    it("returns false when no sessions exist", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig());
      expect(sm.hasSession("issue-1")).toBe(false);
    });

    it("returns true when issue is tracked", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": { sessionId: "s1", status: "idle", issueId: "issue-1", createdAt: "2025-01-01T00:00:00Z" },
        }),
      );
      const sm = new SessionManager(makeConfig());
      expect(sm.hasSession("issue-1")).toBe(true);
    });

    it("returns false for unknown issueId", () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": { sessionId: "s1", status: "idle", issueId: "issue-1", createdAt: "2025-01-01T00:00:00Z" },
        }),
      );
      const sm = new SessionManager(makeConfig());
      expect(sm.hasSession("unknown-id")).toBe(false);
    });
  });

  describe("getSessionBySlackThread", () => {
    it("returns undefined when no sessions match", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig());
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
      const sm = new SessionManager(makeConfig());
      const found = sm.getSessionBySlackThread("C123", "1234.5678");
      expect(found).toBeDefined();
      expect(found?.slackThreadKey).toBe("C123:1234.5678");
    });
  });

  describe("getLinearClient", () => {
    it("returns a LinearClient for known workspace", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig());
      const client = sm.getLinearClient("ws1");
      expect(client).toBeDefined();
      expect(MockLinearClient).toHaveBeenCalled();
    });

    it("throws for unknown workspace", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig());
      expect(() => sm.getLinearClient("unknown")).toThrow("Unknown workspace: unknown");
    });

    it("uses apiKey for LinearClient", () => {
      resetMocks();
      const sm = new SessionManager(makeConfig());
      sm.getLinearClient("ws1");
      expect(MockLinearClient).toHaveBeenCalledWith("lin_key");
    });
  });

  describe("handleNewIssue", () => {
    it("returns null when MAX_CONCURRENT reached", async () => {
      resetMocks();
      const config = makeConfig();
      const repo = config.repositories[0];
      mockRouteToRepository.mockImplementation(() => repo);

      // Hang runModelSession so running never decrements
      let resolveHang: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() => hangPromise.then(() => ({ sessionId: "s", costUsd: 0, resultText: "" })));

      const sm = new SessionManager(config);

      // Kick off 2 sessions (MAX_CONCURRENT = 2) without awaiting
      sm.handleNewIssue(makeIssue({ id: "i1", identifier: "YUN-1" }), "ws1");
      sm.handleNewIssue(makeIssue({ id: "i2", identifier: "YUN-2" }), "ws1");

      // 3rd should be rejected
      const result = await sm.handleNewIssue(makeIssue({ id: "i3", identifier: "YUN-3" }), "ws1");
      expect(result).toBeNull();

      resolveHang!();
    });

    it("returns null when no repo found", async () => {
      resetMocks();
      mockRouteToRepository.mockImplementation(() => null);
      const sm = new SessionManager(makeConfig());
      const result = await sm.handleNewIssue(makeIssue(), "ws1");
      expect(result).toBeNull();
    });

    it("uses overrideRepo when provided", async () => {
      resetMocks();
      const config = makeConfig();
      const overrideRepo = { ...config.repositories[0], name: "override-repo" };

      const sm = new SessionManager(config);
      const result = await sm.handleNewIssue(makeIssue(), "ws1", undefined, overrideRepo);

      expect(result).not.toBeNull();
      expect(mockRouteToRepository).not.toHaveBeenCalled();
    });

    it("runs executeSession and returns result", async () => {
      resetMocks();
      const config = makeConfig();
      mockRouteToRepository.mockImplementation(() => config.repositories[0]);
      // Return actual __RESULT__ format so parseResultMetadata can extract fields
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: "sess-123",
        costUsd: 0.05,
        resultText: "Done!\n```\n__RESULT__\nPR: https://github.com/owner/myrepo/pull/1\nBRANCH: hanni/feature-branch\n```",
      }));

      const sm = new SessionManager(config);
      const result = await sm.handleNewIssue(makeIssue(), "ws1");

      expect(result).not.toBeNull();
      expect(result?.costUsd).toBe(0.05);
      expect(result?.prUrl).toBe("https://github.com/owner/myrepo/pull/1");
    });

    it("saves session to disk after execution", async () => {
      resetMocks();
      const config = makeConfig();
      mockRouteToRepository.mockImplementation(() => config.repositories[0]);

      const sm = new SessionManager(config);
      await sm.handleNewIssue(makeIssue(), "ws1");

      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });

  describe("handleComment", () => {
    it("does nothing when no session found for issue", async () => {
      resetMocks();
      const sm = new SessionManager(makeConfig());
      await sm.handleComment("unknown-issue", "body", "user-1", "ws1");
      expect(mockRunModelSession).not.toHaveBeenCalled();
    });

    it("ignores comment from hanni itself (viewerId match)", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": {
            sessionId: "s1",
            status: "idle",
            issueId: "issue-1",
            issueIdentifier: "YUN-1",
            worktreePath: "/worktrees/abc",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );

      const sm = new SessionManager(makeConfig());
      // viewer-1 is the viewerId in ws1 config
      await sm.handleComment("issue-1", "body", "viewer-1", "ws1");
      expect(mockRunModelSession).not.toHaveBeenCalled();
    });

    it("ignores comment when session is still running", async () => {
      resetMocks();
      // loadFromDisk resets "running" → "idle", so we need to create a live running session
      let resolveHang!: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() =>
        hangPromise.then(() => ({ sessionId: "s", costUsd: 0, resultText: "" })),
      );

      const config = makeConfig();
      mockRouteToRepository.mockImplementation(() => config.repositories[0]);

      const sm = new SessionManager(config);
      // Start handleNewIssue without awaiting — session status becomes "running"
      sm.handleNewIssue(makeIssue({ id: "issue-1", identifier: "YUN-1" }), "ws1");

      // Now handleComment should see status "running" and bail out
      mockRunModelSession.mockClear();
      await sm.handleComment("issue-1", "body", "other-user", "ws1");
      expect(mockRunModelSession).not.toHaveBeenCalled();

      resolveHang();
    });

    it("resumes session with comment", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": {
            sessionId: "old-session",
            status: "idle",
            issueId: "issue-1",
            issueIdentifier: "YUN-1",
            worktreePath: "/worktrees/abc",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );

      const sm = new SessionManager(makeConfig());
      await sm.handleComment("issue-1", "fix the bug", "other-user", "ws1");

      expect(mockRunModelSession).toHaveBeenCalledTimes(1);
      const callArgs = mockRunModelSession.mock.calls[0][1];
      expect(callArgs.prompt).toBe("fix the bug");
      expect(callArgs.resumeSessionId).toBe("old-session");
    });

    it("posts resultText as Linear comment", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": {
            sessionId: "s1",
            status: "idle",
            issueId: "issue-1",
            issueIdentifier: "YUN-1",
            worktreePath: "/worktrees/abc",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: "s2",
        costUsd: 0.01,
        resultText: "Here is the answer",
      }));

      const sm = new SessionManager(makeConfig());
      await sm.handleComment("issue-1", "tell me something", "other-user", "ws1");

      expect(mockCreateComment).toHaveBeenCalledWith("issue-1", "Here is the answer");
    });

    it("falls back to fresh session when resume fails", async () => {
      resetMocks();
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation(() =>
        JSON.stringify({
          "YUN-1": {
            sessionId: "dead-session",
            status: "idle",
            issueId: "issue-1",
            issueIdentifier: "YUN-1",
            worktreePath: "/worktrees/abc",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );

      let callCount = 0;
      mockRunModelSession.mockImplementation(async (config, opts) => {
        callCount++;
        if (callCount === 1) throw new Error("session not found");
        return { sessionId: "new-session", costUsd: 0.01, resultText: "Fresh start" };
      });

      const sm = new SessionManager(makeConfig());
      await sm.handleComment("issue-1", "hello", "other-user", "ws1");

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
          "YUN-1": {
            sessionId: "s1",
            status: "idle",
            issueId: "issue-1",
            issueIdentifier: "YUN-1",
            worktreePath: "/worktrees/abc",
            repo: "myrepo",
            branch: "hanni/feature",
            createdAt: "2025-01-01T00:00:00Z",
          },
        }),
      );
      mockPushAndCreatePR.mockImplementation(async () => ({
        prUrl: "https://github.com/owner/myrepo/pull/42",
      }));

      const sm = new SessionManager(config);
      await sm.handleComment("issue-1", "push please", "other-user", "ws1");

      // Should have created two comments: result + PR URL
      expect(mockCreateComment).toHaveBeenCalledTimes(2);
      const prComment = mockCreateComment.mock.calls[1][1];
      expect(prComment).toContain("https://github.com/owner/myrepo/pull/42");
    });
  });

  describe("runAction", () => {
    it("returns busy message when same thread already running", async () => {
      resetMocks();
      // loadFromDisk resets "running" → "idle", so start a live runAction instead
      let resolveHang!: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() =>
        hangPromise.then(() => ({ sessionId: "s", costUsd: 0, resultText: "" })),
      );

      const sm = new SessionManager(makeConfig());
      // Start runAction without awaiting — session status becomes "running"
      sm.runAction({ message: "task", slackThread: { channel: "C123", threadTs: "1234.5678" } });

      const result = await sm.runAction({
        message: "do something",
        slackThread: { channel: "C123", threadTs: "1234.5678" },
      });

      expect(result.resultText).toContain("まだ前のタスク");
      resolveHang();
    });

    it("returns busy message when MAX_CONCURRENT reached", async () => {
      resetMocks();

      let resolveHang: () => void;
      const hangPromise = new Promise<void>((res) => { resolveHang = res; });
      mockRunModelSession.mockImplementation(() =>
        hangPromise.then(() => ({ sessionId: "s", costUsd: 0, resultText: "" })),
      );

      const sm = new SessionManager(makeConfig());

      // Fill up capacity
      sm.runAction({ message: "task1", slackThread: { channel: "C1", threadTs: "t1" } });
      sm.runAction({ message: "task2", slackThread: { channel: "C2", threadTs: "t2" } });

      const result = await sm.runAction({
        message: "task3",
        slackThread: { channel: "C3", threadTs: "t3" },
      });

      expect(result.resultText).toContain("いっぱいいっぱい");
      resolveHang!();
    });

    it("runs session without repo (scratch directory)", async () => {
      resetMocks();
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: "sess-123",
        costUsd: 0.01,
        resultText: "All done",
      }));

      const sm = new SessionManager(makeConfig());
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

      const sm = new SessionManager(config);
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

      const sm = new SessionManager(makeConfig());
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

      const sm = new SessionManager(makeConfig());
      const result = await sm.runAction({
        message: "something",
        slackThread: { channel: "C123", threadTs: "1111.2222" },
      });

      expect(result.resultText).toContain("エラー");
    });

    it("parses structured result fields from model output", async () => {
      resetMocks();
      // Use actual __RESULT__ format so real parseResultMetadata can extract fields
      mockRunModelSession.mockImplementation(async () => ({
        sessionId: "s-new",
        costUsd: 0.12,
        resultText: "Clean result\n```\n__RESULT__\nTICKET: YUN-99\nBRANCH: hanni/yun-99-fix\nPR: https://github.com/owner/repo/pull/99\n```",
      }));

      const sm = new SessionManager(makeConfig());
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

// Restore all module mocks so they don't bleed into other test files
afterAll(() => {
  mock.restore();
});
