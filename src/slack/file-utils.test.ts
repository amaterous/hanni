import { describe, test, expect, afterEach, spyOn } from "bun:test";
import { downloadSlackFile } from "./file-utils";
import type { SlackFile } from "./image-utils";
import { SLACK_FILE_MAX_BYTES } from "../constants";

const TEST_DIR = "/tmp/hanni-file-utils-test";

function makeFile(overrides: Partial<SlackFile> = {}): SlackFile {
  return {
    id: "F123ABC",
    mimetype: "application/pdf",
    url_private: "https://files.slack.com/files-pri/T1-F123ABC/report.pdf",
    name: "report.pdf",
    ...overrides,
  };
}

// Recording writer injected instead of fs.writeFileSync — keeps these tests
// independent of the process-wide fs mock leaked by claude-runner.test.ts
function makeWriter() {
  const writes = new Map<string, Buffer>();
  const writeFile = ((path: string, data: Buffer) => {
    writes.set(path, data);
  }) as any;
  return { writes, writeFile };
}

describe("downloadSlackFile", () => {
  let fetchSpy: ReturnType<typeof spyOn> | null = null;

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
  });

  test("downloads a PDF with bot token auth and returns the local path", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 fake pdf content");
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdfBytes, { headers: { "Content-Type": "application/pdf" } }),
    );
    const { writes, writeFile } = makeWriter();

    const path = await downloadSlackFile(makeFile(), TEST_DIR, "xoxb-token", writeFile);

    expect(path).not.toBeNull();
    expect(writes.has(path!)).toBe(true);
    expect(writes.get(path!)!.toString()).toBe("%PDF-1.4 fake pdf content");
    // Auth header must be sent
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://files.slack.com/files-pri/T1-F123ABC/report.pdf");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-token");
  });

  test("keeps the original filename (sanitized) in the saved path", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("data"), { headers: { "Content-Type": "text/plain" } }),
    );
    const { writeFile } = makeWriter();

    const path = await downloadSlackFile(
      makeFile({ id: "F9", name: "../etc/pass wd?.txt", mimetype: "text/plain" }),
      TEST_DIR,
      "tok",
      writeFile,
    );

    expect(path).not.toBeNull();
    // Path stays inside TEST_DIR and dangerous chars are sanitized
    expect(path!.startsWith(TEST_DIR + "/")).toBe(true);
    expect(path!).not.toContain("..");
    expect(path!).not.toContain(" ");
    expect(path!).not.toContain("?");
    expect(path!.endsWith(".txt")).toBe(true);
  });

  test("returns null without fetching when file exceeds size limit", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("x"));
    const { writes, writeFile } = makeWriter();

    const path = await downloadSlackFile(
      makeFile({ size: SLACK_FILE_MAX_BYTES + 1 }),
      TEST_DIR,
      "tok",
      writeFile,
    );

    expect(path).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes.size).toBe(0);
  });

  test("returns null when Slack returns an HTML page (auth failure) for a non-HTML file", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!DOCTYPE html><html>login please</html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    const { writes, writeFile } = makeWriter();

    const path = await downloadSlackFile(makeFile(), TEST_DIR, "bad-token", writeFile);

    expect(path).toBeNull();
    expect(writes.size).toBe(0);
  });

  test("returns null on HTTP error", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 403 }),
    );
    const { writes, writeFile } = makeWriter();

    const path = await downloadSlackFile(makeFile(), TEST_DIR, "tok", writeFile);

    expect(path).toBeNull();
    expect(writes.size).toBe(0);
  });
});
