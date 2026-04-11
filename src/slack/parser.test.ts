import { describe, it, expect } from "bun:test";
import { parseSlackMention } from "./parser";
import type { RepositoryConfig } from "../types";

const repos: RepositoryConfig[] = [
  {
    name: "iq-test",
    github: "yuppppppppppqi/iq-test",
    baseBranch: "main",
    linearWorkspaceId: "ws1",
    projectKeys: ["YUN"],
  },
  {
    name: "picoli.site",
    github: "yuppppppppppqi/picoli.site",
    baseBranch: "main",
    linearWorkspaceId: "ws1",
    projectKeys: ["YUN"],
  },
  {
    name: "thread-spark",
    github: "yuppppppppppqi/thread-spark",
    baseBranch: "main",
    linearWorkspaceId: "ws1",
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
    const result = parseSlackMention("<@U123456> SKY-12", repos);
    expect(result.type).toBe("resume");
    expect(result.issueIdentifier).toBe("SKY-12");
    expect(result.taskDescription).toBeUndefined();
  });

  it("parses task with repo name followed by space", () => {
    const result = parseSlackMention(
      "<@U123456> iq-test トップページ修正して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: "iq-test",
      taskDescription: "トップページ修正して",
    });
  });

  it("parses task with repo name followed by の", () => {
    const result = parseSlackMention(
      "<@U123456> iq-testのトップページ修正して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: "iq-test",
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
      repoName: "picoli.site",
      taskDescription: "のバグ直して",
    });
  });

  it("parses task with dotted repo name directly followed by の", () => {
    const result = parseSlackMention(
      "<@U123456> picoli.siteのバグ直して",
      repos,
    );
    expect(result).toEqual({
      type: "task",
      repoName: "picoli.site",
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
