import { describe, it, expect } from "bun:test";
import { parseSlackMention } from "./parser";
import type { RepositoryConfig } from "../types";
import {
  TEST_WS_ID,
  TEST_BASE_BRANCH,
  TEST_REPO_IQ_TEST,
  TEST_REPO_GITHUB_IQ_TEST,
  TEST_REPO_PICOLI,
  TEST_REPO_THREAD_SPARK,
  TEST_ISSUE_SKY_12,
} from "../__tests__/test-constants";

const repos: RepositoryConfig[] = [
  {
    name: TEST_REPO_IQ_TEST,
    github: TEST_REPO_GITHUB_IQ_TEST,
    baseBranch: TEST_BASE_BRANCH,
    linearWorkspaceId: TEST_WS_ID,
    projectKeys: ["YUN"],
  },
  {
    name: TEST_REPO_PICOLI,
    github: "yuppppppppppqi/picoli.site",
    baseBranch: TEST_BASE_BRANCH,
    linearWorkspaceId: TEST_WS_ID,
    projectKeys: ["YUN"],
  },
  {
    name: TEST_REPO_THREAD_SPARK,
    github: "yuppppppppppqi/thread-spark",
    baseBranch: TEST_BASE_BRANCH,
    linearWorkspaceId: TEST_WS_ID,
    projectKeys: ["YUN"],
  },
];

describe("parseSlackMention", () => {
  it("returns status when text is empty after stripping mention", () => {
    expect(parseSlackMention("<@U123456>", repos)).toEqual({ type: "status" });
  });

  it("returns status for 'status' command", () => {
    expect(parseSlackMention("<@U123456> status", repos)).toEqual({
      type: "status",
    });
  });

  it("returns status for 'STATUS' (case-insensitive)", () => {
    expect(parseSlackMention("<@U123456> STATUS", repos)).toEqual({
      type: "status",
    });
  });

  it("parses resume command with issue identifier", () => {
    const result = parseSlackMention("<@U123456> YUN-81 続きやって", repos);
    expect(result).toEqual({
      type: "resume",
      issueIdentifier: "YUN-81",
      taskDescription: "続きやって",
    });
  });

  it("parses resume command with no extra text", () => {
    const result = parseSlackMention(`<@U123456> ${TEST_ISSUE_SKY_12}`, repos);
    expect(result.type).toBe("resume");
    expect(result.issueIdentifier).toBe(TEST_ISSUE_SKY_12);
    expect(result.taskDescription).toBeUndefined();
  });

  it("parses task with repo name followed by space", () => {
    const result = parseSlackMention(
      "<@U123456> iq-test トップページ修正して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: TEST_REPO_IQ_TEST,
      taskDescription: "トップページ修正して",
    });
  });

  it("parses task with repo name followed by Japanese particle (の)", () => {
    const result = parseSlackMention(
      "<@U123456> iq-testのトップページ修正して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: TEST_REPO_IQ_TEST,
      taskDescription: "トップページ修正して",
    });
  });

  it("parses task with dotted repo name (picoli.site)", () => {
    // regex consumes one char (space or の) after repo name, so "の" stays in description
    // when separated by space: "picoli.site のバグ直して" → space consumed, "の" remains
    const result = parseSlackMention(
      "<@U123456> picoli.site のバグ直して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: TEST_REPO_PICOLI,
      taskDescription: "のバグ直して",
    });
  });

  it("parses task with dotted repo name directly followed by Japanese particle (の)", () => {
    const result = parseSlackMention(
      "<@U123456> picoli.siteのバグ直して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: TEST_REPO_PICOLI,
      taskDescription: "バグ直して",
    });
  });

  it("falls back to full text as taskDescription when no repo matches", () => {
    const result = parseSlackMention("<@U123456> ホームページ直して", repos);
    expect(result).toEqual({
      type: "task",
      taskDescription: "ホームページ直して",
    });
  });

  it("handles multiple bot mention tags", () => {
    const result = parseSlackMention("<@U123> <@U456> status", repos);
    expect(result).toEqual({ type: "status" });
  });
});
