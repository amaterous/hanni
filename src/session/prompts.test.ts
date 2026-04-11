import { describe, expect, test } from "bun:test";
import { buildHanniSystemPrompt } from "./prompts";

describe("buildHanniSystemPrompt", () => {
  test("returns a non-empty string", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp/workspace" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("injects workspaceDir into output", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/home/user/project" });
    expect(result).toContain("/home/user/project");
  });

  test("different workspaceDir yields different output", () => {
    const a = buildHanniSystemPrompt({ workspaceDir: "/dir-a" });
    const b = buildHanniSystemPrompt({ workspaceDir: "/dir-b" });
    expect(a).not.toBe(b);
    expect(a).toContain("/dir-a");
    expect(b).toContain("/dir-b");
  });

  test("contains expected identity section", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp" });
    expect(result).toContain("Hanni");
  });

  test("contains tool guidelines", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp" });
    expect(result).toContain("read");
    expect(result).toContain("write");
    expect(result).toContain("exec");
  });

  test("contains workspace section header", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp" });
    expect(result).toContain("Workspace");
  });

  test("does not start or end with whitespace (trimmed)", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp" });
    expect(result).toBe(result.trim());
  });

  test("contains reasoning format instructions", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp" });
    expect(result).toContain("<think>");
  });

  test("contains mission section", () => {
    const result = buildHanniSystemPrompt({ workspaceDir: "/tmp" });
    expect(result).toContain("Mission");
  });
});
