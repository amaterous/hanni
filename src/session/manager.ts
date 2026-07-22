import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { HanniConfig, SessionInfo, SessionResult, RepositoryConfig } from "../types";
import type { LinearIssue } from "../linear/types";
import { LinearClient } from "../linear/client";
import { ensureRepo } from "../git/repo-manager";
import { createWorktree } from "../git/worktree";
import { routeToRepository } from "../routing/router";
import { runModelSession, type RunModelSessionFn } from "./runner";
import { pushAndCreatePR } from "../post-session/pr-creator";
import { updateTicketAfterSession } from "../post-session/ticket-updater";
import { buildOrchestrationPrompt, parseResultMetadata } from "./orchestration-prompt";
import { createLogger } from "../utils/logger";
import { DEFAULT_MAX_CONCURRENT_SESSIONS, SESSION_MAX_TURNS, LINEAR_MCP_PACKAGE } from "../constants";

const log = createLogger("session");

type McpServers = Record<string, { command: string; args: string[]; env?: Record<string, string> }>;

function buildLinearMcpServers(apiKey: string): McpServers {
  return {
    linear: {
      command: "npx",
      args: ["-y", LINEAR_MCP_PACKAGE, "--token", apiKey],
    },
  };
}

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private running = 0;
  private persistPath: string;
  private readonly maxConcurrent: number;
  private readonly runModelSessionFn: RunModelSessionFn;
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private config: HanniConfig,
    runSessionOverride?: RunModelSessionFn,
  ) {
    this.maxConcurrent = parseInt(
      process.env.MAX_CONCURRENT_SESSIONS ?? String(DEFAULT_MAX_CONCURRENT_SESSIONS),
      10,
    );
    this.persistPath = join(config.paths.logs, "sessions.json");
    this.runModelSessionFn = runSessionOverride ?? runModelSession;
    this.loadFromDisk();
  }

  getSessions(): Map<string, SessionInfo> {
    return this.sessions;
  }

  getActiveWorktreePaths(): Set<string> {
    const paths = new Set<string>();
    for (const [, info] of this.sessions) {
      if (info.status === "running" && info.worktreePath) paths.add(info.worktreePath);
    }
    return paths;
  }

  hasSession(issueId: string): boolean {
    for (const [, info] of this.sessions) {
      if (info.issueId === issueId) return true;
    }
    return false;
  }

  getSessionBySlackThread(channel: string, threadTs: string): SessionInfo | undefined {
    const key = `${channel}:${threadTs}`;
    for (const [, info] of this.sessions) {
      if (info.slackThreadKey === key) return info;
    }
    return undefined;
  }

  getLinearClient(workspaceId: string): LinearClient {
    const ws = this.config.linear.workspaces[workspaceId];
    if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
    return new LinearClient(ws.apiKey);
  }

  abortSession(issueIdentifier: string): boolean {
    const controller = this.abortControllers.get(issueIdentifier);
    if (!controller) return false;
    controller.abort();
    log.info(`Abort signal sent to session ${issueIdentifier}`);
    return true;
  }

  async handleNewIssue(
    issue: LinearIssue,
    workspaceId: string,
    agentSessionId?: string,
    overrideRepo?: RepositoryConfig,
    slackThread?: { channel: string; threadTs: string },
  ): Promise<SessionResult | null> {
    if (this.hasSession(issue.id)) {
      log.debug(`Session already exists for ${issue.identifier}, skipping duplicate`);
      return null;
    }

    if (this.running >= this.maxConcurrent) {
      log.warn(`Max concurrent sessions (${this.maxConcurrent}) reached, skipping ${issue.identifier}`);
      return null;
    }

    const repo = overrideRepo ?? routeToRepository(issue, this.config.repositories, workspaceId);
    if (!repo) {
      log.error(`No repo found for ${issue.identifier}`);
      return null;
    }

    // Register immediately to prevent duplicate webhooks from racing through
    const placeholder: SessionInfo = {
      sessionId: "",
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      status: "running",
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(issue.identifier, placeholder);
    this.saveToDisk();

    this.running++;
    try {
      return await this.executeSession(issue, repo, workspaceId, agentSessionId, slackThread);
    } finally {
      this.running--;
    }
  }

  async handleComment(
    issueId: string,
    commentBody: string,
    commentUserId: string,
    workspaceId: string,
    agentSessionId?: string,
  ): Promise<void> {
    // Find existing session by issueId
    let sessionInfo: SessionInfo | undefined;
    for (const [, info] of this.sessions) {
      if (info.issueId === issueId) {
        sessionInfo = info;
        break;
      }
    }

    if (!sessionInfo) {
      log.debug(`No session found for issue ${issueId}, ignoring comment`);
      return;
    }

    // Don't resume if hanni posted the comment (avoid infinite loop)
    const ws = this.config.linear.workspaces[workspaceId];
    if (ws?.viewerId && commentUserId === ws.viewerId) {
      return;
    }

    if (sessionInfo.status === "running") {
      log.warn(`Session ${sessionInfo.issueIdentifier} is still running, ignoring comment`);
      return;
    }

    log.info(`Resuming session ${sessionInfo.issueIdentifier} with comment`);

    if (!sessionInfo.worktreePath || !sessionInfo.issueIdentifier) {
      log.warn(`Session missing worktreePath or issueIdentifier, cannot resume`);
      return;
    }

    const client = this.getLinearClient(workspaceId);

    this.running++;
    try {
      // Try to resume, but fall back to a fresh session if the conversation is gone (e.g. after restart)
      let result;
      try {
        result = await this.runModelSessionFn(this.config, {
          prompt: commentBody,
          cwd: sessionInfo.worktreePath,
          model: this.config.claude.model,
          fallbackModel: this.config.claude.fallbackModel,
          thinking: this.config.claude.thinking,
          effort: this.config.claude.effort,
          resumeSessionId: sessionInfo.sessionId,
          logsDir: this.config.paths.logs,
          issueIdentifier: sessionInfo.issueIdentifier,
        });
      } catch (resumeErr) {
        log.warn(`${sessionInfo.issueIdentifier}: resume failed, starting fresh session: ${resumeErr}`);
        result = await this.runModelSessionFn(this.config, {
          prompt: commentBody,
          cwd: sessionInfo.worktreePath,
          model: this.config.claude.model,
          fallbackModel: this.config.claude.fallbackModel,
          thinking: this.config.claude.thinking,
          effort: this.config.claude.effort,
          logsDir: this.config.paths.logs,
          issueIdentifier: sessionInfo.issueIdentifier,
        });
      }

      if (result.sessionId) {
        sessionInfo.sessionId = result.sessionId;
      }
      sessionInfo.status = "idle";
      this.saveToDisk();

      // Post Claude's response — use postAgentActivity to avoid Comment webhook loop
      if (result.resultText) {
        if (agentSessionId) {
          await client.postAgentActivity(agentSessionId, "response", result.resultText).catch((err) => {
            log.warn(`${sessionInfo!.issueIdentifier}: failed to post response activity: ${err}`);
          });
        } else if (sessionInfo.issueId) {
          await client.createComment(sessionInfo.issueId, result.resultText);
        }
      }

      // Push any new commits (silently — only comment if there's a new PR)
      const repo = this.config.repositories.find((r) => r.name === sessionInfo!.repo);
      if (repo && sessionInfo.worktreePath && sessionInfo.branch && sessionInfo.issueIdentifier) {
        const { prUrl } = await pushAndCreatePR({
          worktreePath: sessionInfo.worktreePath,
          branchName: sessionInfo.branch,
          issueIdentifier: sessionInfo.issueIdentifier,
          issueTitle: sessionInfo.issueIdentifier,
          baseBranch: repo.baseBranch,
          github: repo.github,
        });

        if (prUrl) {
          sessionInfo.prUrl = prUrl;
          this.saveToDisk();
          // Use postAgentActivity if available (avoids triggering a Comment webhook loop)
          if (agentSessionId) {
            await client.postAgentActivity(agentSessionId, "action", `**PR:** ${prUrl}`).catch((err) => {
              log.warn(`${sessionInfo!.issueIdentifier}: failed to post PR activity: ${err}`);
            });
          } else if (sessionInfo.issueId) {
            await client.createComment(sessionInfo.issueId, `**PR:** ${prUrl}`);
          }
        }
      }
    } catch (err) {
      log.error(`${sessionInfo.issueIdentifier}: handleComment error:`, err);
      // Report error to Agent Session so Linear doesn't show "Did Not Respond"
      if (agentSessionId) {
        await client.postAgentActivity(agentSessionId, "error", `An error occurred: ${err}`).catch((e) => {
          log.warn(`${sessionInfo.issueIdentifier}: failed to post error activity: ${e}`);
        });
      }
    } finally {
      this.running--;
    }
  }

  /**
   * New action-based flow: Claude decides what to do (ticket, branch, PR, or just run a command).
   * Replaces the rigid pipeline of handleNewIssue → executeSession for Slack-initiated tasks.
   */
  async runAction(params: {
    message: string;
    threadContext?: string;
    repo?: RepositoryConfig;
    slackThread: { channel: string; threadTs: string };
    userName?: string;
    linearWorkspaceId?: string;
    linearApiKey?: string;
  }): Promise<SessionResult> {
    const { message, threadContext, repo, slackThread, userName, linearApiKey } = params;
    const sessionKey = `slack:${slackThread.channel}:${slackThread.threadTs}`;

    // Check for existing session in this thread
    const existing = this.getSessionBySlackThread(slackThread.channel, slackThread.threadTs);
    if (existing?.status === "running") {
      log.warn(`Session already running in thread ${sessionKey}`);
      return { costUsd: 0, resultText: "Still working on the previous task. Please wait!" };
    }

    if (this.running >= this.maxConcurrent) {
      log.warn(`Max concurrent sessions (${this.maxConcurrent}) reached`);
      return { costUsd: 0, resultText: "At capacity right now. Please try again later." };
    }

    const prompt = buildOrchestrationPrompt({
      message,
      threadContext,
      repo,
      allRepos: this.config.repositories,
      agentName: this.config.agent.name,
      userName,
    });

    const mcpServers = linearApiKey ? buildLinearMcpServers(linearApiKey) : undefined;

    const sessionInfo: SessionInfo = {
      sessionId: "",
      status: "running",
      createdAt: new Date().toISOString(),
      slackThreadKey: `${slackThread.channel}:${slackThread.threadTs}`,
    };

    if (repo) {
      const repoPath = await ensureRepo(repo, this.config.paths.repos);
      const wt = await createWorktree({
        repoPath,
        worktreesDir: this.config.paths.worktrees,
        issueIdentifier: sessionKey.replace(/[:/]/g, "-"),
        issueTitle: message.slice(0, 50),
        baseBranch: repo.baseBranch,
      });
      sessionInfo.worktreePath = wt.worktreePath;
      sessionInfo.branch = wt.branchName;
      sessionInfo.repo = repo.name;
    }

    this.sessions.set(sessionKey, sessionInfo);
    this.saveToDisk();

    const cwd = sessionInfo.worktreePath
      ? (repo?.subdir ? join(sessionInfo.worktreePath, repo.subdir) : sessionInfo.worktreePath)
      : this.config.paths.repos;

    this.running++;
    try {
      const result = await this.runModelSessionFn(this.config, {
        prompt,
        cwd,
        model: this.config.claude.model,
        fallbackModel: this.config.claude.fallbackModel,
        thinking: this.config.claude.thinking,
        effort: this.config.claude.effort,
        logsDir: this.config.paths.logs,
        issueIdentifier: sessionKey.replace(/[:/]/g, "-"),
        maxTurns: SESSION_MAX_TURNS,
        mcpServers,
      });

      const parsed = parseResultMetadata(result.resultText);
      this.applyRunResult(sessionInfo, result, parsed);

      return {
        issueIdentifier: parsed.issueIdentifier,
        branch: parsed.branch,
        prUrl: parsed.prUrl,
        uploadFiles: parsed.uploadFiles,
        costUsd: result.costUsd,
        resultText: parsed.resultText,
      };
    } catch (err) {
      log.error(`Action session error:`, err);
      sessionInfo.status = "idle";
      this.saveToDisk();
      return { costUsd: 0, resultText: "An error occurred..." };
    } finally {
      this.running--;
    }
  }

  private async executeSession(
    issue: LinearIssue,
    repo: RepositoryConfig,
    workspaceId: string,
    agentSessionId?: string,
    slackThread?: { channel: string; threadTs: string },
  ): Promise<SessionResult> {
    const client = this.getLinearClient(workspaceId);
    const ws = this.config.linear.workspaces[workspaceId]!;

    if (agentSessionId) {
      await client.postAgentActivity(agentSessionId, "action", `Working on **${repo.name}** repository...`).catch((err) => {
        log.warn(`${issue.identifier}: failed to post initial activity: ${err}`);
      });
    }

    const repoPath = await ensureRepo(repo, this.config.paths.repos);
    const { worktreePath, branchName } = await createWorktree({
      repoPath,
      worktreesDir: this.config.paths.worktrees,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      baseBranch: repo.baseBranch,
    });

    const cwd = repo.subdir ? join(worktreePath, repo.subdir) : worktreePath;

    const sessionInfo: SessionInfo = {
      sessionId: "",
      worktreePath,
      repo: repo.name,
      branch: branchName,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      status: "running",
      createdAt: new Date().toISOString(),
      slackThreadKey: slackThread ? `${slackThread.channel}:${slackThread.threadTs}` : undefined,
    };
    this.sessions.set(issue.identifier, sessionInfo);
    const abortController = new AbortController();
    this.abortControllers.set(issue.identifier, abortController);
    this.saveToDisk();

    if (agentSessionId) {
      await client.postAgentActivity(agentSessionId, "action", `Running Claude on branch \`${branchName}\`...`).catch((err) => {
        log.warn(`${issue.identifier}: failed to post branch activity: ${err}`);
      });
    }

    const issueMessage = [
      `Linear チケット ${issue.identifier}: ${issue.title}`,
      issue.description ?? "",
    ].filter(Boolean).join("\n\n");

    const prompt = buildOrchestrationPrompt({
      message: issueMessage,
      repo,
      allRepos: this.config.repositories,
      agentName: this.config.agent.name,
      userName: this.config.agent.ownerName ?? "User",
    });

    const result = await this.runModelSessionFn(this.config, {
      prompt,
      cwd,
      model: this.config.claude.model,
      fallbackModel: this.config.claude.fallbackModel,
      thinking: this.config.claude.thinking,
      effort: this.config.claude.effort,
      logsDir: this.config.paths.logs,
      issueIdentifier: issue.identifier,
      maxTurns: 100,
      mcpServers: buildLinearMcpServers(ws.apiKey),
    });

    const parsed = parseResultMetadata(result.resultText);
    this.applyRunResult(sessionInfo, result, parsed);

    if (ws.inReviewStateId) {
      await updateTicketAfterSession({
        linearClient: client,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        branchName: parsed.branch ?? branchName,
        prUrl: parsed.prUrl ?? null,
        inReviewStateId: ws.inReviewStateId,
        agentName: this.config.agent.name,
      });
    }

    if (agentSessionId) {
      if (parsed.resultText) {
        await client.postAgentActivity(agentSessionId, "response", parsed.resultText).catch((err) => {
          log.warn(`${issue.identifier}: failed to post result activity: ${err}`);
        });
      }
      const parts = [];
      if (parsed.prUrl) parts.push(`**PR:** ${parsed.prUrl}`);
      if (parsed.branch) parts.push(`**Branch:** \`${parsed.branch}\``);
      parts.push(`(cost: $${result.costUsd.toFixed(2)})`);
      await client.postAgentActivity(agentSessionId, "action", parts.join(" ")).catch((err) => {
        log.warn(`${issue.identifier}: failed to post summary activity: ${err}`);
      });
    }

    this.abortControllers.delete(issue.identifier);
    log.info(`${issue.identifier} done: cost=$${result.costUsd.toFixed(2)} pr=${parsed.prUrl ?? "none"}`);

    return {
      issueIdentifier: parsed.issueIdentifier ?? issue.identifier,
      branch: parsed.branch ?? branchName,
      prUrl: parsed.prUrl,
      costUsd: result.costUsd,
      resultText: parsed.resultText,
    };
  }

  private applyRunResult(
    sessionInfo: SessionInfo,
    result: { sessionId: string; costUsd: number },
    parsed: { issueIdentifier?: string; branch?: string; prUrl?: string },
  ): void {
    sessionInfo.sessionId = result.sessionId;
    sessionInfo.status = "idle";
    sessionInfo.costUsd = result.costUsd;
    if (parsed.issueIdentifier) sessionInfo.issueIdentifier = parsed.issueIdentifier;
    if (parsed.branch) sessionInfo.branch = parsed.branch;
    if (parsed.prUrl) sessionInfo.prUrl = parsed.prUrl;
    this.saveToDisk();
  }

  private saveToDisk() {
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(this.sessions);
    writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }

  private loadFromDisk() {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw);
      for (const [key, val] of Object.entries(data)) {
        const session = val as SessionInfo;
        // Reset stale "running" sessions — process is gone after restart
        if (session.status === "running") {
          session.status = "idle";
        }
        this.sessions.set(key, session);
      }
      log.info(`Loaded ${this.sessions.size} sessions from disk`);
    } catch {
      log.warn("Failed to load sessions from disk");
    }
  }
}
