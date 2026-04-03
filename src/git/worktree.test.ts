import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock fs module
const mockExistsSync = mock((_path: string) => false);
const mockMkdirSync = mock(() => undefined);
const mockCopyFileSync = mock(() => undefined);

mock.module("fs", () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
}));

// Mock repo-manager's run
const mockRun = mock(async (_cmd: string[], _cwd?: string) => "");

mock.module("./repo-manager", () => ({
  run: mockRun,
}));

import { createWorktree } from "./worktree";

const baseParams = {
  repoPath: "/repos/myrepo",
  worktreesDir: "/worktrees",
  issueIdentifier: "YUN-42",
  issueTitle: "Add dark mode",
  baseBranch: "main",
};

describe("createWorktree - branchName", () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
    mockMkdirSync.mockClear();
    mockCopyFileSync.mockClear();
    mockRun.mockClear();
    // Default: worktreesDir exists, worktreePath does NOT exist, no CLAUDE.md, no package.json
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      return false;
    });
  });

  it("generates branch name from identifier and title", async () => {
    const result = await createWorktree(baseParams);
    expect(result.branchName).toBe("hanni/yun-42-add-dark-mode");
  });

  it("lowercases the issue identifier", async () => {
    const result = await createWorktree({ ...baseParams, issueIdentifier: "SKY-99" });
    expect(result.branchName).toStartWith("hanni/sky-99-");
  });

  it("slugifies special characters in title", async () => {
    const result = await createWorktree({ ...baseParams, issueTitle: "Fix: auth/login bug" });
    expect(result.branchName).toBe("hanni/yun-42-fix-auth-login-bug");
  });

  it("worktreePath is resolved from worktreesDir and identifier", async () => {
    const result = await createWorktree(baseParams);
    expect(result.worktreePath).toBe("/worktrees/YUN-42");
  });
});

describe("createWorktree - directory creation", () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
    mockMkdirSync.mockClear();
    mockCopyFileSync.mockClear();
    mockRun.mockClear();
  });

  it("creates worktreesDir when it does not exist", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    await createWorktree(baseParams);

    expect(mockMkdirSync).toHaveBeenCalledWith("/worktrees", { recursive: true });
  });

  it("does not create worktreesDir when it already exists", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      return false;
    });

    await createWorktree(baseParams);

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe("createWorktree - reuse existing worktree", () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
    mockMkdirSync.mockClear();
    mockRun.mockClear();
  });

  it("returns early without git commands when worktree already exists", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      if (p === "/worktrees/YUN-42") return true;
      return false;
    });

    const result = await createWorktree(baseParams);

    expect(result.worktreePath).toBe("/worktrees/YUN-42");
    expect(result.branchName).toBe("hanni/yun-42-add-dark-mode");
    // No git commands should be run
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("createWorktree - git commands", () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
    mockRun.mockClear();
    mockCopyFileSync.mockClear();
    // worktreesDir exists, worktreePath does NOT, no CLAUDE.md, no package.json
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      return false;
    });
    mockRun.mockImplementation(async () => "");
  });

  it("fetches origin before creating worktree", async () => {
    await createWorktree(baseParams);

    const calls = mockRun.mock.calls;
    const fetchCall = calls.find(
      ([cmd]) => cmd[0] === "git" && cmd[1] === "fetch",
    );
    expect(fetchCall).toBeDefined();
    expect(fetchCall![0]).toEqual(["git", "fetch", "origin", "main"]);
    expect(fetchCall![1]).toBe("/repos/myrepo");
  });

  it("creates worktree with correct branch name", async () => {
    await createWorktree(baseParams);

    const calls = mockRun.mock.calls;
    const addCall = calls.find(
      ([cmd]) => cmd[0] === "git" && cmd[1] === "worktree" && cmd[2] === "add",
    );
    expect(addCall).toBeDefined();
    expect(addCall![0]).toContain("-b");
    expect(addCall![0]).toContain("hanni/yun-42-add-dark-mode");
    expect(addCall![0]).toContain("origin/main");
    expect(addCall![1]).toBe("/repos/myrepo");
  });

  it("copies CLAUDE.md when repo has it but worktree does not", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      if (p === "/repos/myrepo/CLAUDE.md") return true;
      return false;
    });

    await createWorktree(baseParams);

    expect(mockCopyFileSync).toHaveBeenCalledWith(
      "/repos/myrepo/CLAUDE.md",
      "/worktrees/YUN-42/CLAUDE.md",
    );
  });

  it("does not copy CLAUDE.md when repo does not have one", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      return false; // no CLAUDE.md
    });

    await createWorktree(baseParams);

    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it("runs bun install when package.json exists in worktree", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      if (p === "/worktrees/YUN-42/package.json") return true;
      return false;
    });

    await createWorktree(baseParams);

    const installCall = mockRun.mock.calls.find(
      ([cmd]) => cmd[0] === "bun" && cmd[1] === "install",
    );
    expect(installCall).toBeDefined();
    expect(installCall![1]).toBe("/worktrees/YUN-42");
  });

  it("skips bun install when no package.json", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/worktrees") return true;
      return false;
    });

    await createWorktree(baseParams);

    const installCall = mockRun.mock.calls.find(
      ([cmd]) => cmd[0] === "bun" && cmd[1] === "install",
    );
    expect(installCall).toBeUndefined();
  });

  it("handles stale branch deletion failure gracefully", async () => {
    mockRun.mockImplementation(async (cmd: string[]) => {
      if (cmd[1] === "branch" && cmd[2] === "-D") {
        throw new Error("branch not found");
      }
      return "";
    });

    // Should not throw
    const result = await createWorktree(baseParams);
    expect(result.branchName).toBe("hanni/yun-42-add-dark-mode");
  });
});
