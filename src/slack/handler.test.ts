import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { createSlackHandler } from "./handler";
import { createHmac } from "crypto";
import type { HanniConfig } from "../types";
import {
  TEST_SLACK_TEAM_ID,
  TEST_SLACK_SIGNING_SECRET,
  TEST_SLACK_BOT_TOKEN,
  TEST_SERVER_PORT,
  TEST_WEBHOOK_PATH,
  TEST_SLACK_BOT_USER_ID,
} from "../__tests__/test-constants";

const TEAM_ID = TEST_SLACK_TEAM_ID;
const SIGNING_SECRET = TEST_SLACK_SIGNING_SECRET;
const BOT_TOKEN = TEST_SLACK_BOT_TOKEN;

function makeConfig(): HanniConfig {
  return {
    agent: { name: "Hanni" },
    server: { port: TEST_SERVER_PORT, webhookPath: TEST_WEBHOOK_PATH },
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
  } as unknown as HanniConfig;
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
    devModeSave = process.env.HANNI_DEV_MODE;
    mockSessionManager.runAction.mockClear();
  });

  afterEach(() => {
    if (devModeSave !== undefined) {
      process.env.HANNI_DEV_MODE = devModeSave;
    } else {
      delete process.env.HANNI_DEV_MODE;
    }
  });

  test("responds to url_verification challenge", async () => {
    process.env.HANNI_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "url_verification", challenge: "test-challenge-xyz" });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { challenge: string };
    expect(json.challenge).toBe("test-challenge-xyz");
  });

  test("rejects invalid signature (non-dev mode)", async () => {
    delete process.env.HANNI_DEV_MODE;
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "url_verification", challenge: "xyz" });
    const req = makeRequest(body, false); // invalid sig

    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  test("accepts valid signature (non-dev mode)", async () => {
    delete process.env.HANNI_DEV_MODE;
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const req = makeRequest(body, true);

    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("returns 400 for invalid JSON body", async () => {
    process.env.HANNI_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const req = makeRequest("not-json");

    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("returns ok for unknown event type", async () => {
    process.env.HANNI_DEV_MODE = "true";
    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({ type: "some_unknown_event" });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("returns ok for app_mention without matching workspace", async () => {
    process.env.HANNI_DEV_MODE = "true";
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

  test("downloads non-image attachments (PDF) and passes [Attached file:] path to the session", async () => {
    process.env.HANNI_DEV_MODE = "true";
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: RequestInfo | URL) => {
      if (String(url).includes("files.slack.com")) {
        return new Response(Buffer.from("%PDF-1.4 test"), {
          headers: { "Content-Type": "application/pdf" },
        });
      }
      return new Response(JSON.stringify({ ok: true, messages: [], ts: "1111" }));
    }) as unknown as typeof fetch);

    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: {
        type: "app_mention",
        text: `<@${TEST_SLACK_BOT_USER_ID}> このPDF要約して`,
        user: "U_TEST",
        channel: "C1",
        ts: "1234",
        thread_ts: "1234",
        files: [
          {
            id: "FPDF1",
            mimetype: "application/pdf",
            url_private: "https://files.slack.com/files-pri/T1-FPDF1/paper.pdf",
            name: "paper.pdf",
          },
        ],
      },
    });

    const res = await handler(makeRequest(body));
    expect(res.status).toBe(200);

    // handleMention is fire-and-forget — poll until runAction is called
    const deadline = Date.now() + 3000;
    while (mockSessionManager.runAction.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(mockSessionManager.runAction.mock.calls.length).toBe(1);
    const params = (mockSessionManager.runAction.mock.calls[0] as unknown as [{ message: string }])[0];
    expect(params.message).toContain("このPDF要約して");
    expect(params.message).toMatch(/\[Attached file: \/tmp\/[^\]]*paper\.pdf\]/);

    fetchSpy.mockRestore();
  });

  test("returns ok immediately for app_mention (fire-and-forget)", async () => {
    process.env.HANNI_DEV_MODE = "true";
    // Mock fetch so SlackClient calls don't fail
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messages: [], ts: "1111" })),
    );

    const handler = createSlackHandler(mockSessionManager as any, makeConfig());
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: { type: "app_mention", text: `<@${TEST_SLACK_BOT_USER_ID}> hello`, user: "U_TEST", channel: "C1", ts: "1234", thread_ts: "1234" },
    });
    const req = makeRequest(body);

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    fetchSpy.mockRestore();
  });
});
