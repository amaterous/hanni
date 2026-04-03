import { loadConfig } from "./config";
import { startServer } from "./server";
import { SessionManager } from "./session/manager";
import { createWebhookHandler } from "./webhook/handler";
import { createSlackHandler } from "./slack/handler";
import { SlackClient } from "./slack/client";
import { startOpenAITokenRefresher } from "./openai/oauth";
import { LinearClient } from "./linear/client";
import { createLogger } from "./utils/logger";

const log = createLogger("hanni");

async function main() {
  const config = loadConfig();
  log.info(`Starting ${config.agent.name}...`);

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

  startOpenAITokenRefresher(config, () => {
    log.info("OpenAI tokens refreshed");
  });

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

  // Start server
  const configPath = "./config.json";
  startServer(config, handler, sessionManager.getSessions(), configPath, slackHandler);

  // Slack heartbeat: set bot status to 🟢 on startup and every 5 min
  if (config.slack?.workspaces) {
    const slackClients: SlackClient[] = [];
    for (const ws of Object.values(config.slack.workspaces)) {
      if (ws.botToken) slackClients.push(new SlackClient(ws.botToken));
    }
    if (slackClients.length > 0) {
      const setOnline = () => slackClients.forEach((c) => c.setPresence("auto"));
      await setOnline();
      setInterval(setOnline, 5 * 60 * 1000);
      log.info(`Slack presence heartbeat started (${slackClients.length} workspace(s), every 5min)`);
    }
  }

  log.info(`${config.agent.name} is ready — admin: http://localhost:${config.server.port}/admin`);
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
