import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { HanniConfig, RepositoryConfig } from "../types";
import type { SessionInfo } from "../types";
import type { SessionManager } from "../session/manager";
import { LinearClient } from "../linear/client";
import { createLogger } from "../utils/logger";
import { LINEAR_API_URL } from "../constants";

const log = createLogger("admin");

export async function handleAdminAPI(
  req: Request,
  url: URL,
  config: HanniConfig,
  configPath: string,
  sessions: Map<string, SessionInfo>,
  sessionManager?: SessionManager,
): Promise<Response | null> {
  const path = url.pathname;

  // GET /admin — serve UI
  if (req.method === "GET" && path === "/admin") {
    const html = readFileSync(new URL("./ui.html", import.meta.url).pathname, "utf-8");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // GET /api/config — full config (secrets redacted)
  if (req.method === "GET" && path === "/api/config") {
    const safe = {
      provider: config.provider ?? "claude",
      agent: config.agent,
      server: config.server,
      repositories: config.repositories,
      claude: config.claude,
      openai: config.openai ? { ...config.openai, apiKey: config.openai.apiKey ? "*****" : "" } : undefined,
      paths: config.paths,
      workspaces: Object.entries(config.linear.workspaces).map(([id, ws]) => ({
        id,
        name: ws.name,
        viewerId: ws.viewerId ?? null,
        inReviewStateId: ws.inReviewStateId,
        hasToken: !!ws.apiKey,
      })),
    };
    return Response.json(safe);
  }

  // GET /api/sessions — active sessions
  if (req.method === "GET" && path === "/api/sessions") {
    const list = Array.from(sessions.entries()).map(([key, s]) => ({ key, ...s }));
    return Response.json(list);
  }

  // POST /api/repositories — add repo
  if (req.method === "POST" && path === "/api/repositories") {
    const body = (await req.json()) as RepositoryConfig;
    if (!body.name || !body.github || !body.linearWorkspaceId) {
      return Response.json({ error: "name, github, linearWorkspaceId required" }, { status: 400 });
    }
    body.baseBranch ??= "main";
    body.projectKeys ??= [];
    config.repositories.push(body);
    persistConfig(config, configPath);
    log.info(`Added repository: ${body.name}`);
    return Response.json({ ok: true });
  }

  // PUT /api/repositories/:name — update repo
  if (req.method === "PUT" && path.startsWith("/api/repositories/")) {
    const name = decodeURIComponent(path.split("/api/repositories/")[1]!);
    const body = (await req.json()) as Partial<RepositoryConfig>;
    const idx = config.repositories.findIndex((r) => r.name === name);
    if (idx === -1) return Response.json({ error: "Not found" }, { status: 404 });
    Object.assign(config.repositories[idx]!, body);
    persistConfig(config, configPath);
    log.info(`Updated repository: ${name}`);
    return Response.json({ ok: true });
  }

  // DELETE /api/repositories/:name
  if (req.method === "DELETE" && path.startsWith("/api/repositories/")) {
    const name = decodeURIComponent(path.split("/api/repositories/")[1]!);
    const idx = config.repositories.findIndex((r) => r.name === name);
    if (idx === -1) return Response.json({ error: "Not found" }, { status: 404 });
    config.repositories.splice(idx, 1);
    persistConfig(config, configPath);
    log.info(`Deleted repository: ${name}`);
    return Response.json({ ok: true });
  }

  // PUT /api/workspaces/:id — update workspace (inReviewStateId etc)
  if (req.method === "PUT" && path.startsWith("/api/workspaces/")) {
    const id = path.split("/api/workspaces/")[1]!;
    const body = (await req.json()) as { inReviewStateId?: string };
    const ws = config.linear.workspaces[id];
    if (!ws) return Response.json({ error: "Not found" }, { status: 404 });
    if (body.inReviewStateId) ws.inReviewStateId = body.inReviewStateId;
    persistConfig(config, configPath);
    log.info(`Updated workspace: ${ws.name}`);
    return Response.json({ ok: true });
  }

  // POST /api/setup-project — auto-setup: create Linear project + link repo
  if (req.method === "POST" && path === "/api/setup-project") {
    const body = (await req.json()) as {
      name: string;
      github: string;
      workspaceId: string;
      baseBranch?: string;
      subdir?: string;
    };
    if (!body.name || !body.github || !body.workspaceId) {
      return Response.json({ error: "name, github, workspaceId required" }, { status: 400 });
    }

    const ws = config.linear.workspaces[body.workspaceId];
    if (!ws) return Response.json({ error: "Unknown workspace" }, { status: 404 });

    // 1. Create Linear project via API
    const linearRes = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ws.apiKey },
      body: JSON.stringify({
        query: `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { id name } } }`,
        variables: { input: { name: body.name, teamIds: [] } },
      }),
    });
    const linearData = (await linearRes.json()) as {
      data?: { projectCreate: { success: boolean; project: { id: string; name: string } } };
      errors?: { message: string }[];
    };

    if (linearData.errors?.length) {
      return Response.json({ error: linearData.errors[0]!.message }, { status: 400 });
    }

    const projectName = linearData.data?.projectCreate?.project?.name ?? body.name;

    // 2. Add repository to config
    const repoConfig = {
      name: body.name.toLowerCase().replace(/\s+/g, "-"),
      github: body.github,
      baseBranch: body.baseBranch ?? "main",
      linearWorkspaceId: body.workspaceId,
      projectKeys: [projectName],
      ...(body.subdir && { subdir: body.subdir }),
    };

    // Check if already exists
    const existing = config.repositories.find((r) => r.name === repoConfig.name);
    if (existing) {
      // Add project key if not present
      if (!existing.projectKeys.includes(projectName)) {
        existing.projectKeys.push(projectName);
      }
    } else {
      config.repositories.push(repoConfig);
    }

    persistConfig(config, configPath);
    log.info(`Setup project: ${body.name} → ${body.github}`);
    return Response.json({ ok: true, project: projectName, repo: repoConfig.name });
  }

  // GET /api/logs — list all ticket logs
  if (req.method === "GET" && path === "/api/logs") {
    const logsDir = config.paths.logs;
    if (!existsSync(logsDir)) return Response.json([]);
    const tickets = readdirSync(logsDir).filter((d) => /^[A-Z]+-\d+$/.test(d));
    const logs = tickets.map((ticket) => {
      const ticketDir = join(logsDir, ticket);
      const files = readdirSync(ticketDir).filter((f) => f.endsWith(".json")).sort().reverse();
      const sessions = files.map((f) => {
        try {
          const raw = readFileSync(join(ticketDir, f), "utf-8").trim();
          const data = JSON.parse(raw);
          return {
            file: f,
            costUsd: data.total_cost_usd ?? 0,
            durationMs: data.duration_ms ?? 0,
            turns: data.num_turns ?? 0,
            result: data.result ?? "",
            sessionId: data.session_id ?? "",
            timestamp: f.replace("session-", "").replace(".json", ""),
          };
        } catch {
          return { file: f, costUsd: 0, durationMs: 0, turns: 0, result: "(parse error)", sessionId: "", timestamp: "" };
        }
      });
      return { ticket, sessions };
    }).sort((a, b) => {
      const aTs = a.sessions[0]?.timestamp ?? "";
      const bTs = b.sessions[0]?.timestamp ?? "";
      return bTs.localeCompare(aTs);
    });
    return Response.json(logs);
  }

  // GET /api/logs/:ticket — get specific ticket logs
  if (req.method === "GET" && path.startsWith("/api/logs/")) {
    const ticket = decodeURIComponent(path.split("/api/logs/")[1]!);
    if (!/^[A-Z]+-\d+$/.test(ticket)) {
      return Response.json({ error: "Invalid ticket ID" }, { status: 400 });
    }
    const ticketDir = join(config.paths.logs, ticket);
    if (!existsSync(ticketDir)) return Response.json({ error: "Not found" }, { status: 404 });
    const files = readdirSync(ticketDir).filter((f) => f.endsWith(".json")).sort().reverse();
    const sessions = files.map((f) => {
      try {
        const raw = readFileSync(join(ticketDir, f), "utf-8").trim();
        const data = JSON.parse(raw);
        return {
          file: f,
          costUsd: data.total_cost_usd ?? 0,
          durationMs: data.duration_ms ?? 0,
          turns: data.num_turns ?? 0,
          model: Object.keys(data.modelUsage ?? {})[0] ?? "unknown",
          result: data.result ?? "",
          sessionId: data.session_id ?? "",
          timestamp: f.replace("session-", "").replace(".json", ""),
        };
      } catch {
        return { file: f, costUsd: 0, durationMs: 0, turns: 0, model: "unknown", result: "(parse error)", sessionId: "", timestamp: "" };
      }
    });
    return Response.json({ ticket, sessions });
  }

  // PUT /api/agent — update agent name
  if (req.method === "PUT" && path === "/api/agent") {
    const body = (await req.json()) as { name?: string };
    if (body.name) config.agent.name = body.name;
    persistConfig(config, configPath);
    return Response.json({ ok: true });
  }

  // GET /api/linear/tickets — fetch assigned actionable tickets from all workspaces
  if (req.method === "GET" && path === "/api/linear/tickets") {
    const results: { workspaceId: string; workspaceName: string; issues: unknown[] }[] = [];
    for (const [wsId, ws] of Object.entries(config.linear.workspaces)) {
      try {
        const client = new LinearClient(ws.apiKey);
        const issues = await client.listAssignedIssues(100);
        results.push({ workspaceId: wsId, workspaceName: ws.name, issues });
      } catch (err) {
        log.error(`Failed to fetch tickets for workspace ${ws.name}:`, err);
        results.push({ workspaceId: wsId, workspaceName: ws.name, issues: [] });
      }
    }
    return Response.json(results);
  }

  // POST /api/sessions/bulk — trigger sessions for multiple issues
  if (req.method === "POST" && path === "/api/sessions/bulk" && sessionManager) {
    const body = (await req.json()) as { issues: { identifier: string; workspaceId: string }[] };
    if (!Array.isArray(body.issues) || body.issues.length === 0) {
      return Response.json({ error: "issues array required" }, { status: 400 });
    }

    const queued: string[] = [];
    const skipped: string[] = [];

    for (const item of body.issues) {
      const ws = config.linear.workspaces[item.workspaceId];
      if (!ws) { skipped.push(item.identifier); continue; }

      try {
        const client = new LinearClient(ws.apiKey);
        const issue = await client.fetchIssueByIdentifier(item.identifier);
        // Fire and forget — don't await so we can queue all quickly
        sessionManager.handleNewIssue(issue, item.workspaceId).catch((err) => {
          log.error(`Bulk session error for ${item.identifier}:`, err);
        });
        queued.push(item.identifier);
        log.info(`Bulk-queued session for ${item.identifier}`);
      } catch (err) {
        log.error(`Failed to start session for ${item.identifier}:`, err);
        skipped.push(item.identifier);
      }
    }

    return Response.json({ ok: true, queued, skipped });
  }

  return null;
}

function persistConfig(config: HanniConfig, configPath: string) {
  let current: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    current = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse ${configPath} for saving: ${err}`);
  }
  current.agent = config.agent;
  current.repositories = config.repositories;
  current.claude = config.claude;
  for (const [id, ws] of Object.entries(config.linear.workspaces)) {
    if (current.linear.workspaces[id]) {
      current.linear.workspaces[id].inReviewStateId = ws.inReviewStateId;
    }
  }
  writeFileSync(configPath, JSON.stringify(current, null, 2));
}
