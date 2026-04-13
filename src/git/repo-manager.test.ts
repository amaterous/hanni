import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

// Mock fs module
const mockExistsSync = mock((_path: string) => false);
const mockMkdirSync = mock(() => undefined);

mock.module("fs", () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

import { ensureRepo } from "./repo-manager";
import type { RepositoryConfig } from "../types";
import {
  TEST_WS_ID,
  TEST_REPOS_DIR,
  TEST_REPO_NAME,
  TEST_REPO_GITHUB,
  TEST_REPO_PATH,
  TEST_BASE_BRANCH,
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

const localRepo: RepositoryConfig = {
  name: TEST_REPO_NAME,
  github: "",
  baseBranch: TEST_BASE_BRANCH,
  linearWorkspaceId: TEST_WS_ID,
  projectKeys: [],
};

const githubRepo: RepositoryConfig = {
  name: TEST_REPO_NAME,
  github: TEST_REPO_GITHUB,
  baseBranch: TEST_BASE_BRANCH,
  linearWorkspaceId: TEST_WS_ID,
  projectKeys: [],
};

function resetMocks() {
  mockExistsSync.mockClear();
  mockMkdirSync.mockClear();
  spawnSpy.mockClear();
  spawnSpy.mockImplementation(() => makeSpawnResult("", "", 0) as any);
}

describe("ensureRepo - directory creation", () => {
  beforeEach(resetMocks);

  it("creates reposDir when it does not exist", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    await ensureRepo(localRepo, TEST_REPOS_DIR);

    expect(mockMkdirSync).toHaveBeenCalledWith(TEST_REPOS_DIR, { recursive: true });
  });

  it("does not create reposDir when it already exists", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === TEST_REPOS_DIR) return true;
      if (p === TEST_REPO_PATH) return true;
      return false;
    });

    await ensureRepo(githubRepo, TEST_REPOS_DIR);

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it("returns the correct repoPath", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    const result = await ensureRepo(localRepo, TEST_REPOS_DIR);

    expect(result).toBe(TEST_REPO_PATH);
  });
});

describe("ensureRepo - local-only repo (no github)", () => {
  beforeEach(resetMocks);

  it("creates directory and runs git init when repoPath does not exist", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    await ensureRepo(localRepo, TEST_REPOS_DIR);

    const initCall = spawnSpy.mock.calls.find(([cmd]) => cmd[0] === "git" && cmd[1] === "init");
    expect(initCall).toBeDefined();
    expect(initCall![1]).toMatchObject({ cwd: TEST_REPO_PATH });
  });

  it("runs git commit with --allow-empty after init", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    await ensureRepo(localRepo, TEST_REPOS_DIR);

    const commitCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "git" && cmd[1] === "commit",
    );
    expect(commitCall).toBeDefined();
    expect(commitCall![0]).toContain("--allow-empty");
    expect(commitCall![1]).toMatchObject({ cwd: TEST_REPO_PATH });
  });

  it("creates repoPath directory for local repo", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    await ensureRepo(localRepo, TEST_REPOS_DIR);

    expect(mockMkdirSync).toHaveBeenCalledWith(TEST_REPO_PATH, { recursive: true });
  });

  it("does nothing when repoPath already exists and no github", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === TEST_REPOS_DIR) return true;
      if (p === TEST_REPO_PATH) return true;
      return false;
    });

    await ensureRepo(localRepo, TEST_REPOS_DIR);

    expect(spawnSpy.mock.calls).toHaveLength(0);
  });
});

describe("ensureRepo - github repo", () => {
  beforeEach(resetMocks);

  it("clones when repoPath does not exist", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);

    await ensureRepo(githubRepo, TEST_REPOS_DIR);

    const cloneCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "git" && cmd[1] === "clone",
    );
    expect(cloneCall).toBeDefined();
    expect(cloneCall![0]).toContain(`https://github.com/${TEST_REPO_GITHUB}.git`);
    expect(cloneCall![0]).toContain(TEST_REPO_PATH);
  });

  it("fetches when repoPath already exists", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === TEST_REPOS_DIR) return true;
      if (p === TEST_REPO_PATH) return true;
      return false;
    });

    await ensureRepo(githubRepo, TEST_REPOS_DIR);

    const fetchCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "git" && cmd[1] === "fetch",
    );
    expect(fetchCall).toBeDefined();
    expect(fetchCall![0]).toEqual(["git", "fetch", "origin", TEST_BASE_BRANCH]);
    expect(fetchCall![1]).toMatchObject({ cwd: TEST_REPO_PATH });
  });

  it("does not clone when repoPath already exists", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === TEST_REPOS_DIR) return true;
      if (p === TEST_REPO_PATH) return true;
      return false;
    });

    await ensureRepo(githubRepo, TEST_REPOS_DIR);

    const cloneCall = spawnSpy.mock.calls.find(
      ([cmd]) => cmd[0] === "git" && cmd[1] === "clone",
    );
    expect(cloneCall).toBeUndefined();
  });

  it("throws when git command fails", async () => {
    mockExistsSync.mockImplementation((_p: string) => false);
    spawnSpy.mockImplementation(
      () => makeSpawnResult("", "fatal: repo not found", 128) as any,
    );

    await expect(ensureRepo(githubRepo, "/repos")).rejects.toThrow("Command failed");
  });
});
