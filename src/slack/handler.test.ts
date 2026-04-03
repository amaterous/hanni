import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { createSlackHandler } from "./handler";
import { createHmac } from "crypto";
import type { BroConfig } from "../types";

const TEAM_ID = "T123";
const SIGNING_SECRET = "test-signing-secret";
const BOT_TOKEN = "xoxb-test-token";

function makeConfig(): BroConfig {
  return {
    agent: { name: "Hanni" },
    server: { port: 3000, webhookPath: "/webhook" },
    linear: { webhookSecret: "lin-secret", workspaces: {} },
    slack: {
      workspaces: {
        [TEAM_ID]: {
          name: "TestWorkspace",
          botToken: BOT_TOKEN,
          signingSecret: SIGNING_SECRET,
          defaultLinearWorkspaceId: "lin-ws-1",
        },
      },
    },
    repositories: [],
    claude: { model: "claude-sonnet-4-5", fallbackModel: "claude-haiku-4-5" },
    paths: { repos: "/tmp/repos", worktrees: "/tmp/worktrees", logs: "/tmp/logs" },
  } as unknown as BroConfig;
}

function makeSlackSignature(body: string, secret: string, timestamp: string): string {
  const basestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(basestring).digest("hex");
}

function makeRequest(body: string, signed = true, teamId = TEAM_ID): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signed ? makeSlackSignature(body, SIGNING_SECRET, timestamp) : "v0=invalidsig";
  return new Request("http://localhost/slack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    },
    body,
  });
}

const mockSessionManager = {
  runAction: mock(async () => ({
    resultText: "all done!",
    issueIdentifier: undefined,
    prUrl: undefined,
    branch: undefined,
  })),
};

describe("createSlackHandler", () => {
  let devModeSave: string | undefined;

  beforeEach(() => {
    devModeSave = process.env.BRO_DEV_MODE;
    mockSessionManager.runAction.mockClear();
  });

  afterEach(() => {
    if (devModeSave !== undefined) {
      process.env.BRO_DEV_MODE = devModeSave;
    } else {
      delete process.env.BRO_DEV_MODE;
    }
  });

  test("responds to url_verification challenge", async () => {
    process.env.BRO_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "url_verification", challenge: "test-challenge-xyz" });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { challenge: string };
    expect(json.challenge).toBe("test-challenge-xyz");
  });

  test("rejects invalid signature (non-dev mode)", async () => {
    delete process.env.BRO_DEV_MODE;
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "url_verification", challenge: "xyz" });
    const req = makeRequest(body, false); // invalid sig

    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  test("accepts valid signature (non-dev mode)", async () => {
    delete process.env.BRO_DEV_MODE;
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const req = makeRequest(body, true);

    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("returns 400 for invalid JSON body", async () => {
    process.env.BRO_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const req = makeRequest("not-json");

    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("returns ok for unknown event type", async () => {
    process.env.BRO_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "some_unknown_event" });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("returns ok for app_mention without matching workspace", async () => {
    process.env.BRO_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T_UNKNOWN",
      event: { type: "app_mention", text: "hello", user: "U123", channel: "C1", ts: "1234" },
    });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("returns ok immediately for app_mention (fire-and-forget)", async () => {
    process.env.BRO_DEV_MODE = "true";
    // Mock fetch so SlackClient calls don't fail
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messages: [], ts: "1111" })),
    );

    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: { type: "app_mention", text: "<@U_BOT> hello", user: "U_TEST", channel: "C1", ts: "1234", thread_ts: "1234" },
    });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    fetchSpy.mockRestore();
  });
});
