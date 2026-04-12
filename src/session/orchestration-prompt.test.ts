import { describe, expect, test } from "bun:test";
import { buildOrchestrationPrompt, parseResultMetadata } from "./orchestration-prompt";

describe("buildOrchestrationPrompt", () => {
  const base = {
    message: "please test this",
    agentName: "Hanni",
    userName: "Yun",
  };

  test("includes agentName and userName in the prompt", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).toContain("Hanni");
    expect(result).toContain("Yun");
  });

  test("includes message at the end", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).toContain("please test this");
  });

  test("uses 'User' as default when userName is omitted", () => {
    const result = buildOrchestrationPrompt({ ...base, userName: undefined });
    expect(result).toContain("User");
  });

  test("includes repo info when repo is provided", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      repo: { name: "my-repo", github: "owner/my-repo", baseBranch: "main", linearWorkspaceId: "ws1", projectKeys: [] },
    });
    expect(result).toContain("my-repo");
    expect(result).toContain("owner/my-repo");
    expect(result).toContain("main");
  });

  test("includes subdir when repo has subdir", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      repo: { name: "mono", github: "owner/mono", baseBranch: "main", subdir: "apps/web", linearWorkspaceId: "ws1", projectKeys: [] },
    });
    expect(result).toContain("apps/web");
  });

  test("omits target repository section when no repo", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).not.toContain("Target Repository");
  });

  test("includes repo list when allRepos is provided", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      allRepos: [
        { name: "repo-a", github: "owner/repo-a", baseBranch: "main", linearWorkspaceId: "ws1", projectKeys: [] },
        { name: "repo-b", github: "owner/repo-b", baseBranch: "develop", linearWorkspaceId: "ws1", projectKeys: [] },
      ],
    });
    expect(result).toContain("repo-a");
    expect(result).toContain("repo-b");
    expect(result).toContain("Available Repositories");
  });

  test("omits repo list section when allRepos is empty", () => {
    const result = buildOrchestrationPrompt({ ...base, allRepos: [] });
    expect(result).not.toContain("Available Repositories");
  });

  test("includes thread history when threadContext is provided", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      threadContext: "past conversation content",
    });
    expect(result).toContain("Thread History");
    expect(result).toContain("past conversation content");
  });

  test("omits thread history section when threadContext is absent", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).not.toContain("Thread History");
  });

  test("includes linear team key when linearTeamKey is provided", () => {
    const result = buildOrchestrationPrompt({ ...base, linearTeamKey: "YUN" });
    expect(result).toContain("YUN");
  });

  test("omits team key when linearTeamKey is absent", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).not.toContain("Team key:");
  });

  test("returns a string", () => {
    const result = buildOrchestrationPrompt(base);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(100);
  });
});

describe("parseResultMetadata", () => {
  test("returns text as-is when there is no __RESULT__ block", () => {
    const text = "Work completed.";
    const result = parseResultMetadata(text);
    expect(result).toEqual({ resultText: "Work completed." });
    expect(result.issueIdentifier).toBeUndefined();
    expect(result.branch).toBeUndefined();
    expect(result.prUrl).toBeUndefined();
  });

  test("parses TICKET correctly", () => {
    const text = "Done!\n```\n__RESULT__\nTICKET: YUN-123\n```";
    const result = parseResultMetadata(text);
    expect(result.issueIdentifier).toBe("YUN-123");
  });

  test("parses BRANCH correctly", () => {
    const text = "Done!\n```\n__RESULT__\nBRANCH: hanni/my-feature\n```";
    const result = parseResultMetadata(text);
    expect(result.branch).toBe("hanni/my-feature");
  });

  test("parses PR URL correctly", () => {
    const text = "Done!\n```\n__RESULT__\nPR: https://github.com/owner/repo/pull/42\n```";
    const result = parseResultMetadata(text);
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");
  });

  test("parses TICKET, BRANCH, and PR together", () => {
    const text = [
      "Implementation complete!",
      "```",
      "__RESULT__",
      "TICKET: YUN-456",
      "BRANCH: hanni/fix-bug",
      "PR: https://github.com/owner/repo/pull/99",
      "```",
    ].join("\n");
    const result = parseResultMetadata(text);
    expect(result.issueIdentifier).toBe("YUN-456");
    expect(result.branch).toBe("hanni/fix-bug");
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/99");
  });

  test("removes __RESULT__ block from resultText", () => {
    const text = [
      "Implementation complete!",
      "```",
      "__RESULT__",
      "TICKET: YUN-789",
      "```",
    ].join("\n");
    const result = parseResultMetadata(text);
    expect(result.resultText).not.toContain("__RESULT__");
    expect(result.resultText).not.toContain("TICKET:");
    expect(result.resultText).toContain("Implementation complete!");
  });

  test("issueIdentifier is undefined when no TICKET", () => {
    const text = "```\n__RESULT__\nBRANCH: hanni/x\n```";
    const result = parseResultMetadata(text);
    expect(result.issueIdentifier).toBeUndefined();
    expect(result.branch).toBe("hanni/x");
  });

  test("returns empty resultText for empty string input", () => {
    const result = parseResultMetadata("");
    expect(result.resultText).toBe("");
  });
});
