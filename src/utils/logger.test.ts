import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createLogger } from "./logger";

describe("createLogger", () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.BRO_DEBUG;
  });

  it("info logs to console", () => {
    const log = createLogger("test");
    log.info("hello world");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("[INFO]");
    expect(line).toContain("[test]");
    expect(line).toContain("hello world");
  });

  it("warn logs with WARN level", () => {
    const log = createLogger("comp");
    log.warn("something wrong");
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("[WARN]");
    expect(line).toContain("something wrong");
  });

  it("error logs with ERROR level", () => {
    const log = createLogger("comp");
    log.error("oops");
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("[ERROR]");
    expect(line).toContain("oops");
  });

  it("debug does not log when BRO_DEBUG is not set", () => {
    const log = createLogger("comp");
    log.debug("secret");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("debug logs when BRO_DEBUG is set", () => {
    process.env.BRO_DEBUG = "1";
    const log = createLogger("comp");
    log.debug("verbose stuff");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("[DEBUG]");
    expect(line).toContain("verbose stuff");
  });

  it("includes extra string args in output", () => {
    const log = createLogger("comp");
    log.info("msg", "extra1", "extra2");
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("extra1");
    expect(line).toContain("extra2");
  });

  it("formats Error args by message", () => {
    const log = createLogger("comp");
    log.error("failed", new Error("boom"));
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("boom");
  });

  it("component name appears in log line", () => {
    const log = createLogger("my-service");
    log.info("ping");
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toContain("[my-service]");
  });
});
