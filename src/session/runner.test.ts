import { describe, it, expect, beforeEach } from "bun:test";
import { runModelSession } from "./runner";

// Tests inject a mock runner via the optional _runSession parameter, avoiding
// mock.module() and the cross-file module-cache interference it causes.

const defaultResult = {
  sessionId: "sess-1",
  success: true,
  costUsd: 0.01,
  durationMs: 500,
  resultText: "done",
};

describe("runModelSession", () => {
  it("delegates all params to runClaudeSession and returns its result", async () => {
    let received: any;
    const mockRunner = async (params: any) => { received = params; return defaultResult; };

    const params = {
      prompt: "do thing",
      cwd: "/tmp",
      model: "claude-opus",
      fallbackModel: "claude-haiku",
      logsDir: "/logs",
      issueIdentifier: "YUN-1",
    };

    const result = await runModelSession({} as any, params, mockRunner);
    expect(received).toEqual(params);
    expect(result).toEqual(defaultResult);
  });

  it("ignores _config — does not pass it to runClaudeSession", async () => {
    let received: any;
    const mockRunner = async (params: any) => { received = params; return defaultResult; };

    await runModelSession({ server: { port: 9999 } } as any, {
      prompt: "x",
      cwd: "/",
      model: "m",
      fallbackModel: "f",
      logsDir: "/l",
      issueIdentifier: "X-1",
    }, mockRunner);
    expect(received).not.toHaveProperty("server");
  });

  it("passes optional maxTurns and resumeSessionId", async () => {
    let received: any;
    const mockRunner = async (params: any) => { received = params; return defaultResult; };

    await runModelSession({} as any, {
      prompt: "test",
      cwd: "/tmp",
      model: "m",
      fallbackModel: "f",
      logsDir: "/l",
      issueIdentifier: "X-2",
      maxTurns: 10,
      resumeSessionId: "prev-123",
    }, mockRunner);

    expect(received.maxTurns).toBe(10);
    expect(received.resumeSessionId).toBe("prev-123");
  });

  it("passes mcpServers when provided", async () => {
    let received: any;
    const mockRunner = async (params: any) => { received = params; return defaultResult; };

    const mcpServers = { myServer: { command: "node", args: ["srv.js"] } };
    await runModelSession({} as any, {
      prompt: "test",
      cwd: "/tmp",
      model: "m",
      fallbackModel: "f",
      logsDir: "/l",
      issueIdentifier: "X-3",
      mcpServers,
    }, mockRunner);

    expect(received.mcpServers).toEqual(mcpServers);
  });

  it("propagates errors from runClaudeSession", async () => {
    const mockRunner = async () => { throw new Error("session failed"); };

    await expect(
      runModelSession({} as any, {
        prompt: "x",
        cwd: "/",
        model: "m",
        fallbackModel: "f",
        logsDir: "/l",
        issueIdentifier: "X-4",
      }, mockRunner),
    ).rejects.toThrow("session failed");
  });
});
