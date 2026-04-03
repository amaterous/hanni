import { createLogger } from "../utils/logger";
import { createHmac, timingSafeEqual } from "crypto";

const log = createLogger("slack");

export class SlackClient {
  constructor(private botToken: string) {}

  async postMessage(channel: string, text: string, threadTs?: string): Promise<string | undefined> {
    const body: Record<string, string> = { channel, text };
    if (threadTs) body.thread_ts = threadTs;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!json.ok) {
      log.error(`Slack postMessage failed: ${json.error}`);
      return undefined;
    }
    return json.ts;
  }

  private userNameCache = new Map<string, string>();

  async getUserName(userId: string): Promise<string> {
    const cached = this.userNameCache.get(userId);
    if (cached) return cached;

    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${this.botToken}` },
    });
    const json = (await res.json()) as {
      ok: boolean;
      user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } };
    };
    const name = json.user?.profile?.display_name || json.user?.real_name || userId;
    this.userNameCache.set(userId, name);
    return name;
  }

  async getThreadMessages(channel: string, threadTs: string): Promise<{ user: string; text: string }[]> {
    const res = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=200`,
      {
        headers: { Authorization: `Bearer ${this.botToken}` },
      },
    );
    const json = (await res.json()) as { ok: boolean; messages?: { user: string; text: string }[]; error?: string };
    if (!json.ok) {
      log.error(`Slack conversations.replies failed: ${json.error}`);
      return [];
    }
    return json.messages ?? [];
  }

  async addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
    await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
  }

  /**
   * Upload a file (image) to a Slack channel/thread.
   * Uses the new 3-step external upload API (files.upload is deprecated).
   * Requires files:write scope.
   */
  async uploadFile(params: {
    channel: string;
    threadTs?: string;
    filename: string;
    content: Buffer;
    title?: string;
    initialComment?: string;
  }): Promise<boolean> {
    // Step 1: Get upload URL
    log.info(`uploadFile: step 1 getUploadURLExternal (${params.filename}, ${params.content.length} bytes)`);
    const urlRes = await fetch(
      `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(params.filename)}&length=${params.content.length}`,
      { headers: { Authorization: `Bearer ${this.botToken}` } },
    );
    const urlJson = (await urlRes.json()) as { ok: boolean; upload_url?: string; file_id?: string; error?: string };
    if (!urlJson.ok || !urlJson.upload_url || !urlJson.file_id) {
      log.error(`Slack getUploadURLExternal failed: ${urlJson.error}`);
      return false;
    }
    log.info(`uploadFile: step 1 done (file_id=${urlJson.file_id})`);

    // Step 2: Upload file content via POST (Slack expects POST, not PUT)
    log.info(`uploadFile: step 2 uploading to ${urlJson.upload_url.slice(0, 60)}...`);
    const putRes = await fetch(urlJson.upload_url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: params.content,
    });
    if (!putRes.ok) {
      log.error(`Slack file upload failed: ${putRes.status} ${await putRes.text()}`);
      return false;
    }
    log.info(`uploadFile: step 2 done`);

    // Step 3: Complete upload and share to channel/thread
    log.info(`uploadFile: step 3 completeUploadExternal (channel=${params.channel})`);
    const completeBody: Record<string, unknown> = {
      files: [{ id: urlJson.file_id, title: params.title ?? params.filename }],
      channel_id: params.channel,
    };
    if (params.threadTs) completeBody.thread_ts = params.threadTs;
    if (params.initialComment) completeBody.initial_comment = params.initialComment;

    const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(completeBody),
    });
    const completeJson = (await completeRes.json()) as { ok: boolean; error?: string };
    if (!completeJson.ok) {
      log.error(`Slack completeUploadExternal failed: ${completeJson.error}`);
      return false;
    }
    log.info(`uploadFile: done!`);
    return true;
  }

  /**
   * Set bot presence (green dot = "auto", grey = "away").
   * Requires users:write scope.
   */
  async setPresence(presence: "auto" | "away"): Promise<boolean> {
    const res = await fetch("https://slack.com/api/users.setPresence", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: `presence=${presence}`,
    });

    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      log.error(`Slack setPresence failed: ${json.error}`);
      return false;
    }
    return true;
  }
}

/**
 * Verify Slack request signature (HMAC-SHA256).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string,
): boolean {
  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const computed = "v0=" + createHmac("sha256", signingSecret).update(basestring).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}
