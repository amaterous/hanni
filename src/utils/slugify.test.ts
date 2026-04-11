import { describe, it, expect } from "bun:test";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("foo bar baz")).toBe("foo-bar-baz");
  });

  it("removes non-alphanumeric characters", () => {
    expect(slugify("fix: bug #123!")).toBe("fix-bug-123");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  it("collapses multiple separators into one hyphen", () => {
    expect(slugify("a--b___c")).toBe("a-b-c");
  });

  it("respects maxLen default (30)", () => {
    const long = "a".repeat(50);
    expect(slugify(long).length).toBeLessThanOrEqual(30);
  });

  it("respects custom maxLen", () => {
    expect(slugify("hello-world", 5)).toBe("hello");
  });

  it("removes trailing hyphen after truncation", () => {
    // "hello-world" truncated at 6 would give "hello-" → should strip trailing hyphen
    expect(slugify("hello-world", 6)).toBe("hello");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles Japanese text (non-ascii stripped)", () => {
    expect(slugify("バグ修正")).toBe("");
  });

  it("handles mixed alphanumeric and special chars", () => {
    expect(slugify("feat(auth): add login")).toBe("feat-auth-add-login");
  });
});
