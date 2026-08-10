import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { loadConfig } from "./config";
import { startServer } from "./server";
import { SessionManager } from "./session/manager";
import { createWebhookHandler } from "./webhook/handler";
import { createSlackHandler } from "./slack/handler";
import { formatForSlack } from "./slack/chat";
import { SlackClient } from "./slack/client";
import { LinearClient } from "./linear/client";
import { createLogger } from "./utils/logger";
import { cleanupStaleWorktrees } from "./git/worktree";
import { HEARTBEAT_INTERVAL_MS, SCHEDULER_CHECK_INTERVAL_MS, SLACK_MESSAGE_CHAR_LIMIT, WORKTREE_CLEANUP_INTERVAL_MS, WORKTREE_MAX_AGE_DAYS } from "./constants";

const log = createLogger("hanni");

async function main() {
  const config = loadConfig();
  log.info(`Starting ${config.agent.name}...`);

  // Expose config.json secrets to the process env so Bash tool calls inside
  // Claude sessions (vercel CLI, Stripe API scripts, etc.) can see them —
  // same mechanism as GH_TOKEN/CLAUDE_CODE_OAUTH_TOKEN.
  if (config.vercel?.token) process.env.VERCEL_TOKEN = config.vercel.token;
  if (config.stripe?.secretKey) process.env.STRIPE_SECRET_KEY_LIVE = config.stripe.secretKey;
  for (const [suffix, key] of Object.entries(config.stripe?.additionalAccounts ?? {})) {
    process.env[`STRIPE_SECRET_KEY_LIVE_${suffix.toUpperCase()}`] = key;
  }

  // Validate Claude authentication
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!hasApiKey && !hasOAuthToken) {
    log.warn("Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set — Claude sessions will fail");
    log.warn("Set CLAUDE_CODE_OAUTH_TOKEN to use your Claude Max plan (run: printenv CLAUDE_CODE_OAUTH_TOKEN)");
  } else {
    log.info(`Claude auth: ${hasOAuthToken ? "CLAUDE_CODE_OAUTH_TOKEN (Max plan)" : "ANTHROPIC_API_KEY"}`);
  }

  // Resolve viewer IDs for each workspace (to filter webhooks)
  for (const [wsId, ws] of Object.entries(config.linear.workspaces)) {
    if (!ws.viewerId) {
      try {
        const client = new LinearClient(ws.apiKey);
        const viewer = await client.getViewer();
        ws.viewerId = viewer.id;
        log.info(`[${ws.name}] viewer: ${viewer.name} (${viewer.id})`);
      } catch (err) {
        log.error(`[${ws.name}] Failed to get viewer:`, err);
      }
    }
  }

  // Create session manager
  const sessionManager = new SessionManager(config);

  // Create webhook handler
  const handler = createWebhookHandler(sessionManager, config);

  // Create Slack handler (if configured)
  const slackHandler = config.slack?.workspaces
    ? createSlackHandler(sessionManager, config)
    : undefined;

  if (slackHandler && config.slack?.workspaces) {
    const wsNames = Object.values(config.slack.workspaces).map((w) => w.name).join(", ");
    log.info(`Slack integration enabled (${wsNames})`);
  }

  // Clean up stale worktrees (each carries ~2GB of node_modules) on startup and periodically
  const runWorktreeCleanup = () => {
    try {
      const removed = cleanupStaleWorktrees({
        worktreesDir: config.paths.worktrees,
        reposDir: config.paths.repos,
        maxAgeDays: WORKTREE_MAX_AGE_DAYS,
        activeWorktreePaths: sessionManager.getActiveWorktreePaths(),
      });
      if (removed > 0) log.info(`Worktree cleanup: removed ${removed} stale worktree(s)`);
    } catch (err) {
      log.error("Worktree cleanup failed:", err);
    }
  };
  runWorktreeCleanup();
  setInterval(runWorktreeCleanup, WORKTREE_CLEANUP_INTERVAL_MS);

  // Start server
  const configPath = "./config.json";
  startServer(config, handler, sessionManager.getSessions(), configPath, slackHandler, sessionManager);

  // Slack heartbeat: set bot status to 🟢 on startup and every 5 min
  if (config.slack?.workspaces) {
    const slackClients: SlackClient[] = [];
    for (const ws of Object.values(config.slack.workspaces)) {
      if (ws.botToken) slackClients.push(new SlackClient(ws.botToken));
    }
    if (slackClients.length > 0) {
      const setOnline = () => slackClients.forEach((c) => c.setPresence("auto"));
      await setOnline();
      setInterval(setOnline, HEARTBEAT_INTERVAL_MS);
      log.info(`Slack presence heartbeat started (${slackClients.length} workspace(s), every 5min)`);
    }
  }

  // Scheduled jobs (generic cron-like system)
  if (config.schedule?.jobs?.length && config.slack?.workspaces) {
    for (const job of config.schedule.jobs) {
      const wsConfig = config.slack.workspaces[job.slackWorkspaceId];
      if (!wsConfig?.botToken) {
        log.warn(`[scheduler:${job.name}] No botToken for workspace ${job.slackWorkspaceId}`);
        continue;
      }

      const jobClient = new SlackClient(wsConfig.botToken);
      const jobRepo = job.repo ? config.repositories.find((r) => r.name === job.repo) : undefined;
      const lastFiredPath = join(config.paths.logs, `scheduler-${job.name}-last-fired.txt`);
      const readLastFired = () => {
        try { return readFileSync(lastFiredPath, "utf-8").trim(); } catch { return null; }
      };

      const checkAndFire = async () => {
        const now = new Date();
        const todayUtc = now.toISOString().slice(0, 10);
        const utcTotalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        const targetTotalMinutes = job.utcHour * 60 + (job.utcMinute ?? 0);
        if (utcTotalMinutes < targetTotalMinutes || readLastFired() === todayUtc) return;

        try {
          mkdirSync(dirname(lastFiredPath), { recursive: true });
          writeFileSync(lastFiredPath, todayUtc, "utf-8");
          log.info(`[scheduler:${job.name}] Firing for ${todayUtc}`);
          // Skip initMessage if empty (post directly to channel instead of thread reply)
          const initTs = job.initMessage && job.initMessage.trim()
            ? await jobClient.postMessage(job.channel, job.initMessage)
            : "";
          if (initTs === undefined) {
            log.error(`[scheduler:${job.name}] Failed to post initial message`);
            return;
          }
          // Baseline for the postResult=fallback check. Jobs without an initMessage
          // have no message to compare against, so fall back to the wall clock —
          // Slack ts values are unix seconds, so they are directly comparable.
          const startTs = (Date.now() / 1000).toFixed(6);

          const result = await sessionManager.runAction({
            message: job.message,
            repo: jobRepo,
            slackThread: { channel: job.channel, threadTs: initTs || "" },
            userName: "scheduler",
            linearWorkspaceId: wsConfig.defaultLinearWorkspaceId,
            linearApiKey: wsConfig.linearApiKey,
          });

          // Post the result to the channel (not the thread) — without this the job
          // only ever posts initMessage, and the digest reaches Slack only when the
          // session happens to call chat.postMessage itself (silent misses 2026-07-28).
          // Jobs whose script posts to Slack on its own opt out with postResult: false;
          // "fallback" posts only when the session left the channel silent.
          let skipReason: string | undefined;
          if (job.postResult === false) {
            skipReason = "postResult disabled — script posts to Slack itself";
          } else if (job.postResult === "fallback") {
            const posted = await jobClient.hasMessageAfter(job.channel, initTs || startTs);
            if (posted === undefined) {
              skipReason = "postResult=fallback could not read channel history — skipping to avoid a duplicate";
            } else if (posted) {
              skipReason = "postResult=fallback — session already posted to the channel";
            } else {
              log.warn(`[scheduler:${job.name}] Session posted nothing — falling back to resultText`);
            }
          }

          if (skipReason) {
            log.info(`[scheduler:${job.name}] ${skipReason}`);
          } else if (result.resultText) {
            const formatted = formatForSlack(result.resultText);
            const truncated = formatted.length > SLACK_MESSAGE_CHAR_LIMIT
              ? formatted.slice(0, SLACK_MESSAGE_CHAR_LIMIT) + "..."
              : formatted;
            log.info(`[scheduler:${job.name}] Posting result (${truncated.length} chars) → ch:${job.channel}`);
            await jobClient.postMessage(job.channel, truncated);
          } else {
            log.warn(`[scheduler:${job.name}] Session returned no resultText — nothing posted`);
          }
        } catch (err) {
          log.error(`[scheduler:${job.name}] Failed:`, err);
        }
      };

      void checkAndFire();
      setInterval(() => { void checkAndFire(); }, SCHEDULER_CHECK_INTERVAL_MS);

      log.info(`[scheduler:${job.name}] Scheduled at UTC ${job.utcHour}:${String(job.utcMinute ?? 0).padStart(2, "0")} → ch:${job.channel}`);
    }
  } else {
    // A config.json deployed without `schedule` silently kills all jobs (e.g. daily
    // news stopped 2026-07-18 after a deploy overwrote server config) — make it loud
    log.warn("[scheduler] No scheduled jobs configured — if jobs used to run, config.json may have been overwritten without its `schedule` section");
  }

  log.info(`${config.agent.name} is ready — admin: http://localhost:${config.server.port}/admin`);
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
