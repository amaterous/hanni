import { mkdirSync } from "fs";
import { join } from "path";
import type { HanniConfig, RepositoryConfig, SlackWorkspaceConfig } from "../types";
import type { SessionManager } from "../session/manager";
import { SlackClient, verifySlackSignature } from "./client";
import { formatForSlack } from "./chat";
import { takeScreenshot } from "../utils/screenshot";
import { runModelSession } from "../session/runner";
import { createLogger } from "../utils/logger";
import { type SlackFile, downloadSlackImage } from "./image-utils";
import {
  SLACK_MESSAGE_CHAR_LIMIT,
  SLACK_URL_INFER_MAX_TURNS,
  SCREENSHOT_KEYWORDS_RE,
  DOMAIN_EXTENSION_RE,
} from "../constants";

const log = createLogger("slack");

/** Dry-run client that logs instead of posting to Slack */
function createDryRunClient(): SlackClient {
  return {
    postMessage: async (_ch: string, text: string) => {
      log.info(`[TEST] hanni says: ${text}`);
      return undefined;
    },
    addReaction: async () => {},
    getThreadMessages: async () => [],
    getUserName: async () => "TestUser",
    uploadFile: async (params: { filename: string }) => {
      log.info(`[TEST] hanni uploaded: ${params.filename}`);
      return true;
    },
  } as unknown as SlackClient;
}

interface SlackEventPayload {
  type: "url_verification" | "event_callback";
  challenge?: string;
  team_id?: string;
  event?: {
    type: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    files?: SlackFile[];
  };
}

/**
 * Try to verify the request against all known Slack workspace signing secrets.
 * Returns the matching team_id or null if none match.
 */
function verifyAnyWorkspace(
  workspaces: Record<string, SlackWorkspaceConfig>,
  signature: string,
  timestamp: string,
  body: string,
): string | null {
  for (const [teamId, ws] of Object.entries(workspaces)) {
    if (verifySlackSignature(ws.signingSecret, signature, timestamp, body)) {
      return teamId;
    }
  }
  return null;
}

export function createSlackHandler(
  sessionManager: SessionManager,
  config: HanniConfig,
) {
  const slack = config.slack!;
  const workspaces = slack.workspaces;

  // Pre-create clients for each workspace that has a bot token
  const clients = new Map<string, SlackClient>();
  for (const [teamId, ws] of Object.entries(workspaces)) {
    if (ws.botToken) {
      clients.set(teamId, new SlackClient(ws.botToken));
    }
  }

  return async (req: Request): Promise<Response> => {
    const body = await req.text();

    // Verify signature (skip in dev mode)
    const devMode = process.env.HANNI_DEV_MODE === "true";
    let verifiedTeamId: string | null = null;
    if (!devMode) {
      const signature = req.headers.get("x-slack-signature") ?? "";
      const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
      verifiedTeamId = verifyAnyWorkspace(workspaces, signature, timestamp, body);
      if (!verifiedTeamId) {
        log.warn("Invalid Slack signature (no workspace matched)");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    let payload: SlackEventPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // URL verification challenge (used when setting up Events API URL)
    if (payload.type === "url_verification") {
      log.info(`URL verification challenge from team ${verifiedTeamId ?? payload.team_id ?? "unknown"}`);
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Determine team_id from verification or payload
    const teamId = verifiedTeamId ?? payload.team_id;

    // Event callback
    if (payload.type === "event_callback" && payload.event?.type === "app_mention") {
      if (!teamId) {
        log.warn("No team_id in event payload");
        return new Response("ok");
      }

      const wsConfig = workspaces[teamId];
      if (!wsConfig) {
        log.warn(`Unknown Slack workspace: ${teamId}`);
        return new Response("ok");
      }

      const client = clients.get(teamId);
      if (!client) {
        log.warn(`No bot token configured for workspace ${wsConfig.name} (${teamId})`);
        return new Response("ok");
      }

      const event = payload.event;
      const threadTs = event.thread_ts ?? event.ts;
      const isTest = event.user === "U_TEST";

      // Use dry-run client for test mode (logs instead of posting to Slack)
      const activeClient = isTest ? createDryRunClient() : client;

      if (!isTest) {
        client.addReaction(event.channel, event.ts, "eyes").catch((err) => {
          log.warn(`Failed to add 'eyes' reaction: ${err}`);
        });
      }

      // Download attached images to temp files
      const imagePaths: string[] = [];
      const imageFiles = (event.files ?? []).filter((f) =>
        f.mimetype?.startsWith("image/"),
      );
      if (imageFiles.length > 0) {
        const tmpDir = join("/tmp", `hanni-images-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
        for (const file of imageFiles) {
          try {
            const filePath = await downloadSlackImage(file, tmpDir, wsConfig.botToken!);
            if (filePath) {
              imagePaths.push(filePath);
              log.info(`Downloaded image: ${file.name} → ${filePath} (via ${file.thumb_1024 ? "thumb_1024" : file.thumb_720 ? "thumb_720" : "url_private"})`);
            }
          } catch (err) {
            log.error(`Failed to download image ${file.name}:`, err);
          }
        }
      }

      // Fire and forget
      handleMention(event.text, event.channel, threadTs, event.ts, event.user, activeClient, sessionManager, config, wsConfig, imagePaths).catch(
        (err) => log.error("Slack handler error:", err),
      );

      return new Response("ok");
    }

    return new Response("ok");
  };
}

/**
 * Fetch thread history, resolve user names, and download images from the thread.
 * Returns { threadContext, imagePaths } — imagePaths includes the initial paths plus
 * any new images found in earlier thread messages.
 */
async function gatherThreadContext(
  client: SlackClient,
  channel: string,
  threadTs: string,
  initialImagePaths: string[],
  botToken: string | undefined,
): Promise<{ threadContext: string; imagePaths: string[] }> {
  const threadMessages = await client.getThreadMessages(channel, threadTs);

  // Build text context from the last 200 messages
  const contextLines: string[] = [];
  for (const m of threadMessages.slice(-200)) {
    const name = await client.getUserName(m.user);
    const cleaned = m.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    contextLines.push(`${name}: ${cleaned}`);
  }

  // Download images attached to earlier thread messages (dedup against already-downloaded ones)
  const imagePaths = [...initialImagePaths];
  if (botToken) {
    const existingNames = new Set(imagePaths.map((p) => p.split("/").pop() ?? ""));
    const threadTmpDir = join("/tmp", `hanni-thread-images-${Date.now()}`);
    let threadTmpDirCreated = false;
    for (const msg of threadMessages) {
      if (!msg.files) continue;
      for (const file of msg.files) {
        if (!file.mimetype?.startsWith("image/")) continue;
        if (existingNames.has(file.name)) continue;
        try {
          if (!threadTmpDirCreated) {
            mkdirSync(threadTmpDir, { recursive: true });
            threadTmpDirCreated = true;
          }
          const filePath = await downloadSlackImage(file as SlackFile, threadTmpDir, botToken);
          if (filePath) {
            imagePaths.push(filePath);
            existingNames.add(file.name);
            log.info(`Downloaded thread image: ${file.name} → ${filePath} (via ${file.thumb_1024 ? "thumb_1024" : file.thumb_720 ? "thumb_720" : "url_private"})`);
          }
        } catch (err) {
          log.error(`Failed to download thread image ${file.name}:`, err);
        }
      }
    }
  }

  return { threadContext: contextLines.join("\n"), imagePaths };
}

/**
 * Handle a screenshot request. Returns true if the screenshot flow ran (caller should return early).
 * Slack formats URLs as <http://example.com|example.com> — we extract the real URL before matching.
 */
async function handleScreenshotCommand(
  rawText: string,
  threadContext: string,
  client: SlackClient,
  config: HanniConfig,
  channel: string,
  threadTs: string,
): Promise<boolean> {
  // Strip [Attached image: ...] lines before matching keywords to avoid false positives on image filenames
  const rawTextWithoutImagePaths = rawText.replace(/\[Attached image:[^\]]+\]/g, "");
  if (!rawTextWithoutImagePaths.match(SCREENSHOT_KEYWORDS_RE)) return false;

  // Slack wraps URLs as <https://example.com|label> — extract the bare URL
  const textForUrlMatch = rawText.replace(/<(https?:\/\/[^|>]+)\|?[^>]*>/g, "$1");
  // Match explicit https:// URLs or bare domain names (e.g. example.com/path)
  const urlMatch = textForUrlMatch.match(
    new RegExp(`(https?:\\/\\/[^\\s]+|[\\w.-]+${DOMAIN_EXTENSION_RE.source}[^\\s]*)`, "i"),
  );

  let url: string | null = null;

  if (urlMatch) {
    // URL was provided explicitly — use it directly
    const rawUrl = urlMatch[1]!;
    url = rawUrl.startsWith("http") ? rawUrl.replace(/^http:\/\//, "https://") : `https://${rawUrl}`;
  } else {
    // No URL in message — ask Claude to infer it from context
    await client.postMessage(channel, "Looking up the URL...", threadTs);
    try {
      const repoList = config.repositories.map((r) => `${r.name}: ${r.github}`).join("\n");
      const inferResult = await runModelSession(config, {
        prompt: `Infer the URL of the page the user wants to take a screenshot of.

Message: "${rawText}"
${threadContext ? `\nThread context:\n${threadContext}` : ""}

Known repositories:
${repoList}

To identify the URL, try:
1. Guess the Vercel deployment URL from the repo or project name (e.g. project-name.vercel.app)
2. Check for GitHub Pages or a custom domain
3. Use gh or Vercel CLI if needed

Output only the identified URL wrapped in __URL__ tags. Example: __URL__https://example.com/pricing__URL__
If you cannot determine the URL, output __URL__UNKNOWN__URL__.`,
        cwd: config.paths.repos,
        model: config.claude.model,
        fallbackModel: config.claude.fallbackModel,
        logsDir: config.paths.logs,
        issueIdentifier: `screenshot-${Date.now()}`,
        maxTurns: SLACK_URL_INFER_MAX_TURNS,
      });
      const urlTagMatch = inferResult.resultText.match(/__URL__(.+?)__URL__/);
      if (urlTagMatch && urlTagMatch[1] !== "UNKNOWN") {
        url = urlTagMatch[1]!;
      }
    } catch (err) {
      log.error("URL inference failed:", err);
    }
  }

  if (!url) {
    await client.postMessage(channel, "Couldn't figure out the URL. Can you share it directly?", threadTs);
    return true;
  }

  await client.postMessage(channel, `Taking a screenshot of ${url}...`, threadTs);
  try {
    const image = await takeScreenshot(url);
    const hostname = new URL(url).hostname;
    const uploaded = await client.uploadFile({
      channel,
      threadTs,
      filename: `screenshot-${hostname}.png`,
      content: image,
      title: hostname,
    });
    if (!uploaded) {
      await client.postMessage(channel, "Screenshot taken but upload failed...", threadTs);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Screenshot failed:", err);
    await client.postMessage(channel, `Couldn't take the screenshot...\n\`\`\`${errMsg}\`\`\``, threadTs);
  }
  return true;
}

async function handleMention(
  text: string,
  channel: string,
  threadTs: string,
  messageTs: string,
  userId: string,
  client: SlackClient,
  sessionManager: SessionManager,
  config: HanniConfig,
  wsConfig: SlackWorkspaceConfig,
  initialImagePaths: string[] = [],
) {
  try {
    // Strip bot mention to get raw message
    let rawText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (!rawText && initialImagePaths.length === 0) {
      await client.postMessage(channel, "Hmm?", threadTs);
      return;
    }

    // Fetch thread history and collect all images (including from earlier messages)
    const { threadContext, imagePaths } = await gatherThreadContext(
      client, channel, threadTs, initialImagePaths, wsConfig.botToken,
    );

    // Append image file paths so Claude can read them
    if (imagePaths.length > 0) {
      const imageNote = imagePaths.map((p) => `[Attached image: ${p}]`).join("\n");
      rawText = rawText ? `${rawText}\n\n${imageNote}` : imageNote;
    }

    // Screenshot command — handle before Claude (fast & cheap, no LLM needed)
    const screenshotHandled = await handleScreenshotCommand(
      rawText, threadContext, client, config, channel, threadTs,
    );
    if (screenshotHandled) return;

    // All other messages go to Claude — Claude decides everything
    // (chat, code task, ops, Linear operations, etc.)
    log.info(`[${wsConfig.name}] Message: "${rawText.slice(0, 80)}"`);

    const userName = await client.getUserName(userId);

    // Try to infer repo from message text (simple keyword match against known repos)
    let repo: RepositoryConfig | undefined;
    for (const r of config.repositories) {
      if (rawText.toLowerCase().includes(r.name.toLowerCase())) {
        repo = r;
        break;
      }
    }

    try {
      const result = await sessionManager.runAction({
        message: rawText,
        threadContext,
        repo,
        slackThread: { channel, threadTs },
        userName,
        linearWorkspaceId: wsConfig.defaultLinearWorkspaceId,
        linearApiKey: wsConfig.linearApiKey,
      });

      // Post result to Slack
      if (result.resultText) {
        const formatted = formatForSlack(result.resultText);
        const truncated = formatted.length > SLACK_MESSAGE_CHAR_LIMIT
          ? formatted.slice(0, SLACK_MESSAGE_CHAR_LIMIT) + "..."
          : formatted;
        log.info(`[${wsConfig.name}] Hanni says: "${truncated.slice(0, 120)}${truncated.length > 120 ? "..." : ""}"`);
        await client.postMessage(channel, truncated, threadTs);
      }

      // Add structured info if Claude created ticket/branch/PR
      const metaParts: string[] = [];
      if (result.issueIdentifier) metaParts.push(`*${result.issueIdentifier}*`);
      if (result.prUrl) metaParts.push(`*PR:* ${result.prUrl}`);
      if (result.branch) metaParts.push(`*Branch:* \`${result.branch}\``);
      if (metaParts.length > 0) {
        await client.postMessage(channel, metaParts.join("\n"), threadTs);
      }

      // Upload files Claude wants to share in Slack
      if (result.uploadFiles && result.uploadFiles.length > 0) {
        for (const f of result.uploadFiles) {
          log.info(`[${wsConfig.name}] Uploading file to Slack: ${f.path}`);
          const ok = await client.uploadFileFromPath({
            channel,
            threadTs,
            filePath: f.path,
            initialComment: f.caption,
          });
          if (!ok) {
            await client.postMessage(channel, `ファイルのアップロードに失敗しちゃった... (${f.path})`, threadTs);
          }
        }
      }

      await client.addReaction(channel, messageTs, "white_check_mark");
    } catch (err) {
      log.error(`Failed to handle message:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      await client.postMessage(channel, `エラーが出ちゃった...\n\`\`\`${errMsg}\`\`\``, threadTs);
    }
  } catch (err) {
    log.error("handleMention unexpected error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await client.postMessage(channel, `エラーが出ちゃった...\n\`\`\`${errMsg}\`\`\``, threadTs).catch((e) => {
      log.warn(`Failed to post fallback error message to Slack: ${e}`);
    });
  }
}

