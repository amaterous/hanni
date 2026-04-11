import { mkdirSync } from "fs";
import { join } from "path";
import type { HanniConfig, RepositoryConfig, SlackWorkspaceConfig } from "../types";
import { saveConfig } from "../config";
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
        client.addReaction(event.channel, event.ts, "eyes").catch(() => {});
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
  imagePaths: string[] = [],
) {
 try {
  // Strip bot mention to get raw message
  let rawText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!rawText && imagePaths.length === 0) {
    await client.postMessage(channel, "なに〜？", threadTs);
    return;
  }

  // Fetch thread history for context (with real user names)
  const threadMessages = await client.getThreadMessages(channel, threadTs);
  const contextLines: string[] = [];
  for (const m of threadMessages.slice(-200)) {
    const name = await client.getUserName(m.user);
    const cleaned = m.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    contextLines.push(`${name}: ${cleaned}`);
  }

  // Also download images from other thread messages (not just the @mention event's attachments)
  if (wsConfig.botToken) {
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
          const filePath = await downloadSlackImage(file as SlackFile, threadTmpDir, wsConfig.botToken!);
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

  // Append image file paths so Claude can read them
  if (imagePaths.length > 0) {
    const imageNote = imagePaths
      .map((p) => `[添付画像: ${p}]`)
      .join("\n");
    rawText = rawText ? `${rawText}\n\n${imageNote}` : imageNote;
  }
  const threadContext = contextLines.join("\n");

  // Get current user's name
  const userName = await client.getUserName(userId);

  // Screenshot command — handle before Claude (fast & cheap, no LLM needed)
  // Slack formats URLs as <http://example.com|example.com> — extract the actual URL first
  const textForUrlMatch = rawText.replace(/<(https?:\/\/[^|>]+)\|?[^>]*>/g, "$1");
  // Strip [添付画像: ...] lines before matching screenshot keywords to avoid false positives
  // when the attached filename itself contains "screenshot"
  const rawTextWithoutImagePaths = rawText.replace(/\[添付画像:[^\]]+\]/g, "");
  const screenshotMatch = rawTextWithoutImagePaths.match(SCREENSHOT_KEYWORDS_RE);
  const urlMatch = textForUrlMatch.match(new RegExp(`(https?:\\/\\/[^\\s]+|[\\w.-]+${DOMAIN_EXTENSION_RE.source}[^\\s]*)`, "i"));
  if (screenshotMatch) {
    let url: string | null = null;

    if (urlMatch) {
      // URL が明示されている場合はそのまま使う
      const rawUrl = urlMatch[1]!;
      url = rawUrl.startsWith("http")
        ? rawUrl.replace(/^http:\/\//, "https://")
        : `https://${rawUrl}`;
    } else {
      // URL がない場合は Claude に推測させる
      await client.postMessage(channel, "URL調べるね〜", threadTs);
      try {
        const repoList = config.repositories.map((r) => `${r.name}: ${r.github}`).join("\n");
        const inferResult = await runModelSession(config, {
          prompt: `ユーザーがスクショを撮りたいページのURLを推測して。

メッセージ: "${rawText}"
${threadContext ? `\nスレッドの文脈:\n${threadContext}` : ""}

既知のリポジトリ:
${repoList}

URLを特定するために、以下を試して:
1. リポジトリ名やプロジェクト名からVercelのデプロイURLを推測（例: project-name.vercel.app）
2. GitHub Pagesやカスタムドメインの可能性を確認
3. 必要ならghコマンドやVercel CLIで調べる

最終的に特定したURLだけを __URL__ タグで囲んで出力して。例: __URL__https://example.com/pricing__URL__
URLが特定できない場合は __URL__UNKNOWN__URL__ と出力して。`,
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
      await client.postMessage(channel, "URLがわからなかった... URLを直接教えてもらえる？", threadTs);
      return;
    }

    await client.postMessage(channel, `${url} のスクショ撮るね〜`, threadTs);
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
        await client.postMessage(channel, "スクショは撮れたけどアップロードできなかった...", threadTs);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error("Screenshot failed:", err);
      await client.postMessage(channel, `スクショ撮れなかった...\n\`\`\`${errMsg}\`\`\``, threadTs);
    }
    return;
  }

  // All messages go to Claude — Claude decides everything
  // (chat, code task, ops, Linear operations, etc.)
  log.info(`[${wsConfig.name}] Message: "${rawText.slice(0, 80)}"`);

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
      // Truncate long results for Slack
      const formatted = formatForSlack(result.resultText);
      const truncated = formatted.length > SLACK_MESSAGE_CHAR_LIMIT
        ? formatted.slice(0, SLACK_MESSAGE_CHAR_LIMIT) + "..."
        : formatted;
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

    await client.addReaction(channel, messageTs, "white_check_mark");
  } catch (err) {
    log.error(`Failed to handle message:`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await client.postMessage(channel, `エラーが出ちゃった...\n\`\`\`${errMsg}\`\`\``, threadTs);
  }

 } catch (err) {
    log.error("handleMention unexpected error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await client.postMessage(channel, `エラーが出ちゃった...\n\`\`\`${errMsg}\`\`\``, threadTs).catch(() => {});
  }
}

async function createNewRepo(
  repoName: string,
  linearWorkspaceId: string,
  client: SlackClient,
  channel: string,
  threadTs: string,
  githubOwner: string,
): Promise<RepositoryConfig> {
  await client.postMessage(channel, `\`${repoName}\` は新しいリポジトリだね！作るね〜`, threadTs);

  // Create GitHub repo with initial commit via gh CLI
  const proc = Bun.spawn(
    ["gh", "repo", "create", `${githubOwner}/${repoName}`, "--private", "--clone=false", "--add-readme"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    if (stderr.includes("already exists")) {
      log.info(`GitHub repo already exists: ${githubOwner}/${repoName}`);
    } else {
      throw new Error(`gh repo create failed: ${stderr.trim()}`);
    }
  } else {
    log.info(`GitHub repo created: ${githubOwner}/${repoName}`);
  }

  return {
    name: repoName,
    github: `${githubOwner}/${repoName}`,
    baseBranch: "main",
    linearWorkspaceId,
    projectKeys: [],
  };
}
