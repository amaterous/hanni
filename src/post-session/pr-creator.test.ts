import { describe, it, expect, spyOn, beforeEach } from "bun:test";
import { pushAndCreatePR } from "./pr-creator";
import {
  TEST_REPO_GITHUB,
  TEST_ISSUE_YUN_1,
  TEST_BASE_BRANCH,
  TEST_SLACK_CHANNEL_ID,
} from "../__tests__/test-constants";

// Helper to create a mock Bun.spawn result
function makeSpawnResult(stdout: string, stderr: string, code: number) {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(code),
  };
}

// Single spy created once — never restore, just clear between tests
const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
  () => makeSpawnResult("", "", 0) as any,
);

const baseParams = {
  worktreePath: `/repos/myrepo/worktrees/${TEST_ISSUE_YUN_1}`,
  branchName: `hanni/${TEST_ISSUE_YUN_1}`,
  issueIdentifier: TEST_ISSUE_YUN_1,
  issueTitle: "Test issue",
  baseBranch: TEST_BASE_BRANCH,
  github: TEST_REPO_GITHUB,
};

function resetSpy(responses: Array<{ stdout: string; stderr: string; code: number }> = []) {
  spawnSpy.mockClear();
  let callIndex = 0;
  spawnSpy.mockImplementation(() => {
    const r = responses[callIndex] ?? { stdout: "", stderr: "", code: 0 };
    callIndex++;
    return makeSpawnResult(r.stdout, r.stderr, r.code) as any;
  });
}

describe("pushAndCreatePR - no github", () => {
  beforeEach(() => resetSpy());

  it("returns prUrl: null and skips spawn when github is undefined", async () => {
    const result = await pushAndCreatePR({ ...baseParams, github: undefined });
    expect(result).toEqual({ prUrl: null });
    expect(spawnSpy.mock.calls).toHaveLength(0);
  });
});

describe("pushAndCreatePR - no commits to push", () => {
  beforeEach(() => resetSpy());

  it("returns prUrl: null when git log shows no diff", async () => {
    // git log returns empty stdout
    resetSpy([{ stdout: "", stderr: "", code: 0 }]);

    const result = await pushAndCreatePR(baseParams);
    expect(result).toEqual({ prUrl: null });
  });

  it("calls git log with correct args", async () => {
    resetSpy([{ stdout: "", stderr: "", code: 0 }]);

    await pushAndCreatePR(baseParams);

    const logCall = spawnSpy.mock.calls[0];
    expect(logCall[0]).toContain("git");
    expect(logCall[0]).toContain("log");
    expect(logCall[0]).toContain(`origin/${TEST_BASE_BRANCH}..HEAD`);
    expect(logCall[1]).toMatchObject({ cwd: baseParams.worktreePath });
  });
});

describe("pushAndCreatePR - push fails", () => {
  beforeEach(() => resetSpy());

  it("returns prUrl: null when push fails", async () => {
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 }, // git log
      { stdout: "", stderr: "error: failed to push", code: 1 }, // git push
    ]);

    const result = await pushAndCreatePR(baseParams);
    expect(result).toEqual({ prUrl: null });
  });
});

describe("pushAndCreatePR - PR already exists", () => {
  beforeEach(() => resetSpy());

  it("returns existing PR url without creating a new one", async () => {
    const existingUrl = `https://github.com/${TEST_REPO_GITHUB}/pull/42`;
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 }, // git log
      { stdout: "", stderr: "", code: 0 }, // git push
      { stdout: JSON.stringify({ url: existingUrl }), stderr: "", code: 0 }, // gh pr view
    ]);

    const result = await pushAndCreatePR(baseParams);
    expect(result).toEqual({ prUrl: existingUrl });
  });

  it("does not call gh pr create when PR already exists", async () => {
    const existingUrl = `https://github.com/${TEST_REPO_GITHUB}/pull/42`;
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 },
      { stdout: "", stderr: "", code: 0 },
      { stdout: JSON.stringify({ url: existingUrl }), stderr: "", code: 0 },
    ]);

    await pushAndCreatePR(baseParams);

    const createCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "create",
    );
    expect(createCall).toBeUndefined();
  });
});

describe("pushAndCreatePR - create new PR", () => {
  beforeEach(() => resetSpy());

  const newPrUrl = `https://github.com/${TEST_REPO_GITHUB}/pull/99`;

  it("creates draft PR and returns its url", async () => {
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 }, // git log
      { stdout: "", stderr: "", code: 0 }, // git push
      { stdout: "", stderr: "no PR found", code: 1 }, // gh pr view (not found)
      { stdout: newPrUrl, stderr: "", code: 0 }, // gh pr create
    ]);

    const result = await pushAndCreatePR(baseParams);
    expect(result).toEqual({ prUrl: newPrUrl });
  });

  it("includes --draft flag in gh pr create", async () => {
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 },
      { stdout: "", stderr: "", code: 0 },
      { stdout: "", stderr: "no PR found", code: 1 },
      { stdout: newPrUrl, stderr: "", code: 0 },
    ]);

    await pushAndCreatePR(baseParams);

    const createCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "gh" && cmd[2] === "create",
    );
    expect(createCall).toBeDefined();
    expect(createCall![0]).toContain("--draft");
  });

  it("sets PR title to [issueIdentifier] issueTitle", async () => {
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 },
      { stdout: "", stderr: "", code: 0 },
      { stdout: "", stderr: "no PR found", code: 1 },
      { stdout: newPrUrl, stderr: "", code: 0 },
    ]);

    await pushAndCreatePR(baseParams);

    const createCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "gh" && cmd[2] === "create",
    );
    expect(createCall).toBeDefined();
    const cmd = createCall![0] as string[];
    const titleIdx = cmd.indexOf("--title");
    expect(cmd[titleIdx + 1]).toBe(`[${TEST_ISSUE_YUN_1}] Test issue`);
  });

  it("includes slackThread comment in body when provided", async () => {
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 },
      { stdout: "", stderr: "", code: 0 },
      { stdout: "", stderr: "no PR found", code: 1 },
      { stdout: newPrUrl, stderr: "", code: 0 },
    ]);

    await pushAndCreatePR({
      ...baseParams,
      slackThread: { channel: TEST_SLACK_CHANNEL_ID, threadTs: "1234.567" },
    });

    const createCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "gh" && cmd[2] === "create",
    );
    expect(createCall).toBeDefined();
    const cmd = createCall![0] as string[];
    const bodyIdx = cmd.indexOf("--body");
    expect(cmd[bodyIdx + 1]).toContain(`${TEST_SLACK_CHANNEL_ID}/1234.567`);
  });

  it("returns prUrl: null when gh pr create fails", async () => {
    resetSpy([
      { stdout: "abc123 some commit", stderr: "", code: 0 },
      { stdout: "", stderr: "", code: 0 },
      { stdout: "", stderr: "no PR found", code: 1 },
      { stdout: "", stderr: "gh: not authenticated", code: 1 },
    ]);

    const result = await pushAndCreatePR(baseParams);
    expect(result).toEqual({ prUrl: null });
  });
});
