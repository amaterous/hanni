import { describe, it, expect, mock, beforeEach } from "bun:test";

let mockRunClaudeSessionImpl: (params: any) => Promise<any>;

mock.module("./claude-runner", () => ({
  runClaudeSession: (params: any) => mockRunClaudeSessionImpl(params),
}));

const { runModelSession } = await import("./runner");

const defaultResult = {
  sessionId: "sess-1",
  success: true,
  costUsd: 0.01,
  durationMs: 500,
  resultText: "done",
};

describe("runModelSession", () => {
  beforeEach(() => {
    mockRunClaudeSessionImpl = async () => defaultResult;
  });

  it("delegates all params to runClaudeSession and returns its result", async () => {
    let received: any;
    mockRunClaudeSessionImpl = async (params) => {
      received = params;
      return defaultResult;
    };

    const params = {
      prompt: "do thing",
      cwd: "/tmp",
      model: "claude-opus",
      fallbackModel: "claude-haiku",
      logsDir: "/logs",
      issueIdentifier: "YUN-1",
    };

    const result = await runModelSession({} as any, params);
    expect(received).toEqual(params);
    expect(result).toEqual(defaultResult);
  });

  it("ignores _config — does not pass it to runClaudeSession", async () => {
    let received: any;
    mockRunClaudeSessionImpl = async (params) => {
      received = params;
      return defaultResult;
    };

    await runModelSession({ server: { port: 9999 } } as any, {
      prompt: "x",
      cwd: "/",
      model: "m",
      fallbackModel: "f",
      logsDir: "/l",
      issueIdentifier: "X-1",
    });
    expect(received).not.toHaveProperty("server");
  });

  it("passes optional maxTurns and resumeSessionId", async () => {
    let received: any;
    mockRunClaudeSessionImpl = async (params) => {
      received = params;
      return defaultResult;
    };

    await runModelSession({} as any, {
      prompt: "test",
      cwd: "/tmp",
      model: "m",
      fallbackModel: "f",
      logsDir: "/l",
      issueIdentifier: "X-2",
      maxTurns: 10,
      resumeSessionId: "prev-123",
    });

    expect(received.maxTurns).toBe(10);
    expect(received.resumeSessionId).toBe("prev-123");
  });

  it("passes mcpServers when provided", async () => {
    let received: any;
    mockRunClaudeSessionImpl = async (params) => {
      received = params;
      return defaultResult;
    };

    const mcpServers = { myServer: { command: "node", args: ["srv.js"] } };
    await runModelSession({} as any, {
      prompt: "test",
      cwd: "/tmp",
      model: "m",
      fallbackModel: "f",
      logsDir: "/l",
      issueIdentifier: "X-3",
      mcpServers,
    });

    expect(received.mcpServers).toEqual(mcpServers);
  });

  it("propagates errors from runClaudeSession", async () => {
    mockRunClaudeSessionImpl = async () => {
      throw new Error("session failed");
    };

    await expect(
      runModelSession({} as any, {
        prompt: "x",
        cwd: "/",
        model: "m",
        fallbackModel: "f",
        logsDir: "/l",
        issueIdentifier: "X-4",
      }),
    ).rejects.toThrow("session failed");
  });
});
