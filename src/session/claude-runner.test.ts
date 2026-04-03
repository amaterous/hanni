import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import * as fs from "fs";

// Mock fs before importing the module
mock.module("fs", () => ({
  mkdirSync: mock(() => undefined),
  appendFileSync: mock(() => undefined),
  existsSync: mock(() => false),
  readFileSync: mock(() => ""),
}));

// Store the mock query function so we can replace it per-test
let mockQueryImpl: () => AsyncGenerator<any>;

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: any[]) => mockQueryImpl(),
}));

const { runClaudeSession } = await import("./claude-runner");

const defaultParams = {
  prompt: "test prompt",
  cwd: "/tmp/test",
  model: "claude-opus-4-6",
  fallbackModel: "claude-sonnet-4-6",
  logsDir: "/tmp/logs",
  issueIdentifier: "TEST-1",
};

async function* makeMessages(messages: any[]) {
  for (const m of messages) yield m;
}

describe("runClaudeSession", () => {
  beforeEach(() => {
    (fs.mkdirSync as any).mockClear?.();
    (fs.appendFileSync as any).mockClear?.();
  });

  it("returns success result when SDK emits a success result message", async () => {
    mockQueryImpl = () =>
      makeMessages([
        { type: "assistant", content: "hello" },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-abc",
          total_cost_usd: 0.05,
          result: "task done",
        },
      ]);

    const out = await runClaudeSession(defaultParams);

    expect(out.success).toBe(true);
    expect(out.sessionId).toBe("sess-abc");
    expect(out.costUsd).toBe(0.05);
    expect(out.resultText).toBe("task done");
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns success=false when SDK emits an error result message", async () => {
    mockQueryImpl = () =>
      makeMessages([
        {
          type: "result",
          subtype: "error",
          session_id: "sess-err",
          total_cost_usd: 0.01,
          error: "something went wrong",
        },
      ]);

    const out = await runClaudeSession(defaultParams);

    expect(out.success).toBe(false);
    expect(out.sessionId).toBe("sess-err");
    expect(out.costUsd).toBe(0.01);
    expect(out.resultText).toBe("");
  });

  it("returns success=false with empty sessionId when no result message emitted", async () => {
    mockQueryImpl = () =>
      makeMessages([
        { type: "assistant", content: "thinking..." },
        { type: "tool_use", name: "read_file" },
      ]);

    const out = await runClaudeSession(defaultParams);

    expect(out.success).toBe(false);
    expect(out.sessionId).toBe("");
    expect(out.costUsd).toBe(0);
    expect(out.resultText).toBe("");
  });

  it("returns success=false when query() throws", async () => {
    mockQueryImpl = () => {
      throw new Error("network error");
    };

    const out = await runClaudeSession(defaultParams);

    expect(out.success).toBe(false);
    expect(out.costUsd).toBe(0);
    expect(out.resultText).toBe("");
  });

  it("runs successfully with maxTurns and mcpServers provided", async () => {
    mockQueryImpl = () =>
      makeMessages([
        {
          type: "result",
          subtype: "success",
          session_id: "opts-sess",
          total_cost_usd: 0.03,
          result: "done with options",
        },
      ]);

    const mcpServers = { myServer: { command: "node", args: ["server.js"] } };
    const out = await runClaudeSession({ ...defaultParams, maxTurns: 5, mcpServers });

    expect(out.success).toBe(true);
    expect(out.sessionId).toBe("opts-sess");
    expect(out.resultText).toBe("done with options");
  });

  it("uses resumeSessionId when provided", async () => {
    mockQueryImpl = () =>
      makeMessages([
        {
          type: "result",
          subtype: "success",
          session_id: "resumed-sess",
          total_cost_usd: 0.02,
          result: "resumed result",
        },
      ]);

    const out = await runClaudeSession({ ...defaultParams, resumeSessionId: "prev-session-id" });

    expect(out.success).toBe(true);
    expect(out.sessionId).toBe("resumed-sess");
  });

  it("processes multiple non-result messages before the result", async () => {
    mockQueryImpl = () =>
      makeMessages([
        { type: "assistant", content: "step 1" },
        { type: "tool_use", name: "bash" },
        { type: "tool_result", content: "ok" },
        { type: "assistant", content: "step 2" },
        {
          type: "result",
          subtype: "success",
          session_id: "multi-sess",
          total_cost_usd: 0.1,
          result: "multi done",
        },
      ]);

    const out = await runClaudeSession(defaultParams);

    expect(out.success).toBe(true);
    expect(out.resultText).toBe("multi done");
    expect(out.sessionId).toBe("multi-sess");
  });

  it("uses last result message if multiple results are emitted", async () => {
    mockQueryImpl = () =>
      makeMessages([
        {
          type: "result",
          subtype: "error",
          session_id: "first-sess",
          total_cost_usd: 0,
          error: "oops",
        },
        {
          type: "result",
          subtype: "success",
          session_id: "last-sess",
          total_cost_usd: 0.3,
          result: "final",
        },
      ]);

    const out = await runClaudeSession(defaultParams);

    expect(out.success).toBe(true);
    expect(out.sessionId).toBe("last-sess");
    expect(out.resultText).toBe("final");
  });
});
