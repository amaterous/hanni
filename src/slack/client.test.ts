import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createHmac } from "crypto";
import { verifySlackSignature, SlackClient } from "./client";

function makeSlackSignature(secret: string, timestamp: string, body: string): string {
  const basestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(basestring).digest("hex");
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

// ── verifySlackSignature ───────────────────────────────────────────────────

describe("verifySlackSignature", () => {
  it("returns true for valid signature with fresh timestamp", () => {
    const ts = nowTs();
    const body = "payload=test";
    const sig = makeSlackSignature("secret", ts, body);
    expect(verifySlackSignature("secret", sig, ts, body)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    const ts = nowTs();
    const body = "payload=test";
    const sig = makeSlackSignature("correct-secret", ts, body);
    expect(verifySlackSignature("wrong-secret", sig, ts, body)).toBe(false);
  });

  it("returns false for tampered body", () => {
    const ts = nowTs();
    const sig = makeSlackSignature("secret", ts, "original");
    expect(verifySlackSignature("secret", sig, ts, "tampered")).toBe(false);
  });

  it("returns false for timestamp older than 5 minutes", () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 301);
    const body = "payload=test";
    const sig = makeSlackSignature("secret", staleTs, body);
    expect(verifySlackSignature("secret", sig, staleTs, body)).toBe(false);
  });

  it("returns false for future timestamp beyond 5 minutes", () => {
    const futureTs = String(Math.floor(Date.now() / 1000) + 301);
    const body = "payload=test";
    const sig = makeSlackSignature("secret", futureTs, body);
    expect(verifySlackSignature("secret", sig, futureTs, body)).toBe(false);
  });

  it("returns false for mismatched length signature", () => {
    const ts = nowTs();
    expect(verifySlackSignature("secret", "v0=tooshort", ts, "body")).toBe(false);
  });

  it("accepts timestamp within 5 minutes (boundary: 299s)", () => {
    const ts = String(Math.floor(Date.now() / 1000) - 299);
    const body = "payload=ok";
    const sig = makeSlackSignature("secret", ts, body);
    expect(verifySlackSignature("secret", sig, ts, body)).toBe(true);
  });
});

// ── SlackClient ────────────────────────────────────────────────────────────

describe("SlackClient", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, ts: "111.222" }),
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("postMessage", () => {
    it("returns ts on success", async () => {
      const client = new SlackClient("xoxb-token");
      const ts = await client.postMessage("C123", "hello");
      expect(ts).toBe("111.222");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("includes thread_ts when provided", async () => {
      const client = new SlackClient("xoxb-token");
      await client.postMessage("C123", "reply", "999.000");
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.thread_ts).toBe("999.000");
    });

    it("returns undefined when Slack responds ok=false", async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
        }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new SlackClient("xoxb-token");
      const ts = await client.postMessage("CBAD", "hello");
      expect(ts).toBeUndefined();
    });
  });

  describe("getUserName", () => {
    it("returns display_name from profile", async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              user: { real_name: "Real Name", profile: { display_name: "Display" } },
            }),
        }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new SlackClient("xoxb-token");
      const name = await client.getUserName("U123");
      expect(name).toBe("Display");
    });

    it("falls back to user.real_name when display_name is empty", async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              user: { real_name: "Real Name", profile: { display_name: "" } },
            }),
        }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new SlackClient("xoxb-token");
      const name = await client.getUserName("U123");
      expect(name).toBe("Real Name");
    });

    it("caches results — second call does not fetch again", async () => {
      const client = new SlackClient("xoxb-token");
      await client.getUserName("U123");
      await client.getUserName("U123");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to userId when profile is missing", async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, user: {} }),
        }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new SlackClient("xoxb-token");
      const name = await client.getUserName("U_FALLBACK");
      expect(name).toBe("U_FALLBACK");
    });
  });

  describe("addReaction", () => {
    it("calls reactions.add endpoint", async () => {
      const client = new SlackClient("xoxb-token");
      await client.addReaction("C123", "111.222", "white_check_mark");
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe("https://slack.com/api/reactions.add");
    });
  });

  describe("getThreadMessages", () => {
    it("returns messages array on success", async () => {
      const messages = [
        { user: "U1", text: "hello" },
        { user: "U2", text: "world" },
      ];
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, messages }),
        }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new SlackClient("xoxb-token");
      const result = await client.getThreadMessages("C123", "111.222");
      expect(result).toEqual(messages);
    });

    it("returns [] on API error", async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
        }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new SlackClient("xoxb-token");
      const result = await client.getThreadMessages("CBAD", "111.222");
      expect(result).toEqual([]);
    });
  });
});
