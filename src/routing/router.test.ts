import { describe, test, expect } from "bun:test";
import { routeToRepository } from "./router";
import type { LinearIssue } from "../linear/types";
import type { RepositoryConfig } from "../types";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "YUN-1",
    title: "Test issue",
    description: null,
    assigneeId: null,
    assigneeName: null,
    teamId: "team-1",
    projectName: null,
    labels: [],
    ...overrides,
  };
}

function makeRepo(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
  return {
    name: "my-repo",
    github: "org/my-repo",
    baseBranch: "main",
    linearWorkspaceId: "ws-1",
    projectKeys: [],
    ...overrides,
  };
}

const WS = "ws-1";

describe("routeToRepository", () => {
  describe("project match (step 1)", () => {
    test("routes to repo when projectName matches projectKeys exactly", () => {
      const issue = makeIssue({ projectName: "iq-test" });
      const repos = [
        makeRepo({ name: "iq-test", projectKeys: ["iq-test"] }),
        makeRepo({ name: "other", projectKeys: ["other"] }),
      ];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("iq-test");
    });

    test("project match is case-insensitive", () => {
      const issue = makeIssue({ projectName: "IQ-Test" });
      const repos = [makeRepo({ name: "iq-test", projectKeys: ["iq-test"] })];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("iq-test");
    });

    test("skips repos with empty projectKeys in step 1", () => {
      const issue = makeIssue({ projectName: "iq-test" });
      const repos = [
        makeRepo({ name: "catch-all", projectKeys: [] }),
        makeRepo({ name: "iq-test", projectKeys: ["iq-test"] }),
      ];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("iq-test");
    });
  });

  describe("keyword fallback (step 2)", () => {
    test("matches repo name appearing in issue title", () => {
      const issue = makeIssue({ title: "Fix bug in picoli dashboard" });
      const repos = [
        makeRepo({ name: "picoli", projectKeys: ["picoli"] }),
        makeRepo({ name: "other", projectKeys: ["other"] }),
      ];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("picoli");
    });

    test("matches projectKey appearing in issue description", () => {
      const issue = makeIssue({ title: "Fix something", description: "related to cortex-lab infra" });
      const repos = [
        makeRepo({ name: "infra", projectKeys: ["cortex-lab"] }),
      ];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("infra");
    });

    test("short keywords (<=2 chars) are ignored in keyword step", () => {
      // repo name "ab" (length 2) should not keyword-match even if it appears in title.
      // Give it a projectKey so it doesn't fall through as a catch-all.
      const issue = makeIssue({ title: "ab is mentioned here" });
      const repos = [
        makeRepo({ name: "ab", projectKeys: ["ab"] }), // projectKey also short
        makeRepo({ name: "other", projectKeys: ["other"] }),
      ];
      // Neither "ab" keyword matches (too short) nor project match (no projectName)
      // → null
      expect(routeToRepository(issue, repos, WS)).toBeNull();
    });
  });

  describe("catch-all fallback (step 3)", () => {
    test("uses the single repo with no projectKeys when no match", () => {
      const issue = makeIssue({ title: "Something unrelated" });
      const repos = [makeRepo({ name: "generic", projectKeys: [] })];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("generic");
    });

    test("does NOT use catch-all when multiple repos have empty projectKeys", () => {
      const issue = makeIssue({ title: "Something unrelated" });
      const repos = [
        makeRepo({ name: "generic-a", projectKeys: [] }),
        makeRepo({ name: "generic-b", projectKeys: [] }),
      ];
      // step 3 requires exactly one catch-all
      const result = routeToRepository(issue, repos, WS);
      // falls through to step 4 (_default) which also doesn't exist → null
      expect(result).toBeNull();
    });
  });

  describe("_default fallback (step 4)", () => {
    test("returns _default repo when nothing else matches", () => {
      const issue = makeIssue({ title: "Something completely unknown" });
      const repos = [
        makeRepo({ name: "specific", projectKeys: ["specific-key"] }),
        makeRepo({ name: "_default", projectKeys: [] }),
      ];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("_default");
    });
  });

  describe("workspace filtering", () => {
    test("ignores repos from other workspaces", () => {
      const issue = makeIssue({ projectName: "iq-test" });
      const repos = [
        makeRepo({ name: "iq-test", projectKeys: ["iq-test"], linearWorkspaceId: "ws-other" }),
      ];
      expect(routeToRepository(issue, repos, WS)).toBeNull();
    });

    test("only considers repos in the given workspace", () => {
      const issue = makeIssue({ title: "Something" });
      const repos = [
        makeRepo({ name: "wrong-ws", projectKeys: [], linearWorkspaceId: "ws-other" }),
        makeRepo({ name: "correct-ws", projectKeys: [], linearWorkspaceId: WS }),
      ];
      expect(routeToRepository(issue, repos, WS)?.name).toBe("correct-ws");
    });
  });

  describe("no match", () => {
    test("returns null when no repos in workspace", () => {
      const issue = makeIssue();
      expect(routeToRepository(issue, [], WS)).toBeNull();
    });

    test("returns null when no route can be determined", () => {
      const issue = makeIssue({ title: "Completely unique" });
      const repos = [
        makeRepo({ name: "repo-a", projectKeys: ["alpha"] }),
        makeRepo({ name: "repo-b", projectKeys: ["beta"] }),
      ];
      expect(routeToRepository(issue, repos, WS)).toBeNull();
    });
  });
});
