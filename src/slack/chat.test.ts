import { describe, test, expect } from "bun:test";
import { formatForSlack } from "./chat";

describe("formatForSlack", () => {
  test("plain text passes through unchanged", () => {
    expect(formatForSlack("hello world").trim()).toBe("hello world");
  });

  test("converts markdown bold to Slack bold", () => {
    const result = formatForSlack("**bold text**");
    expect(result).toContain("*bold text*");
  });

  test("preserves inline code", () => {
    const result = formatForSlack("use `bun test` to run tests");
    expect(result).toContain("`bun test`");
  });

  test("converts markdown link to Slack link format", () => {
    const result = formatForSlack("[click here](https://example.com)");
    expect(result).toContain("<https://example.com|click here>");
  });

  test("converts headers by stripping # prefix", () => {
    const result = formatForSlack("# Title");
    expect(result).toContain("Title");
    expect(result).not.toContain("# Title");
  });

  test("converts unordered lists", () => {
    const result = formatForSlack("- item one\n- item two");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
  });

  test("empty string returns empty string", () => {
    expect(formatForSlack("")).toBe("");
  });

  test("converts code block", () => {
    const result = formatForSlack("```\nconst x = 1;\n```");
    expect(result).toContain("const x = 1;");
  });

  test("italic text is preserved", () => {
    const result = formatForSlack("_italic_");
    expect(result).toContain("italic");
  });

  test("text with no markdown is returned as-is (trimmed)", () => {
    const text = "ごめん、うまく返せなかった〜 もう一回言ってみて！";
    expect(formatForSlack(text).trim()).toBe(text);
  });
});
