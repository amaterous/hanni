import type { BroConfig, SessionInfo } from "./types";
import type { LinearWebhookPayload } from "./linear/types";
import { verifyWebhookSignature } from "./webhook/signature";
import { handleAdminAPI } from "./admin/api";
import { createLogger } from "./utils/logger";

const log = createLogger("server");

export type WebhookHandler = (payload: LinearWebhookPayload) => Promise<void>;
export type SlackHandler = (req: Request) => Promise<Response>;

export function startServer(
  config: BroConfig,
  onWebhook: WebhookHandler,
  sessions: Map<string, SessionInfo>,
  configPath: string,
  onSlackEvent?: SlackHandler,
) {
  const devMode = process.env.BRO_DEV_MODE === "true";

  Bun.serve({
    port: config.server.port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return new Response("ok");
      }

      // Admin UI + API
      const adminRes = handleAdminAPI(req, url, config, configPath, sessions);
      if (adminRes) return adminRes;

      // Slack Events API
      if (req.method === "POST" && url.pathname === "/slack/events" && onSlackEvent) {
        return onSlackEvent(req);
      }

      if (req.method === "POST" && url.pathname === config.server.webhookPath) {
        const body = await req.text();

        if (!devMode) {
          // Accept Hookdeck relay token (Authorization: Bearer <token>)
          const hookdeckToken = config.linear.hookdeckRelayToken;
          const authHeader = req.headers.get("authorization") ?? "";
          const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
          const hookdeckOk = hookdeckToken && bearerToken === hookdeckToken;

          // Or accept direct Linear signature
          const signature =
            req.headers.get("linear-signature") ??
            req.headers.get("x-webhook-signature") ??
            "";
          const signatureOk = verifyWebhookSignature(body, signature, config.linear.webhookSecret);

          if (!hookdeckOk && !signatureOk) {
            log.warn("Invalid webhook signature");
            return new Response("Invalid signature", { status: 401 });
          }
        }

        let payload: LinearWebhookPayload;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Fire and forget — respond 200 immediately
        onWebhook(payload).catch((err) => {
          log.error("Webhook handler error:", err);
        });

        return new Response("ok");
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  log.info(`Listening on port ${config.server.port} (dev mode: ${devMode})`);
}
