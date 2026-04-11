import type { LinearWebhookPayload } from "../linear/types";
import type { HanniConfig } from "../types";
import type { SessionManager } from "../session/manager";
import { createLogger } from "../utils/logger";

const log = createLogger("webhook");

export function createWebhookHandler(
  sessionManager: SessionManager,
  config: HanniConfig,
): (payload: LinearWebhookPayload) => Promise<void> {
  return async (payload) => {
    const workspaceId = payload.organizationId;
    const ws = config.linear.workspaces[workspaceId];

    if (!ws) {
      log.debug(`Ignoring webhook from unknown workspace ${workspaceId}`);
      return;
    }

    // Handle Agent Session events
    if (payload.type === "AgentSessionEvent") {
      const agentSession = (payload as any).agentSession as {
        id: string;
        issue?: { id: string; identifier: string; title: string; description?: string; teamId?: string; team?: { id: string } };
        comment?: { body: string };
        status?: string;
      };
      const agentActivity = (payload as any).agentActivity as {
        signal?: string;
        content?: { body: string };
      } | undefined;

      if (payload.action === "created" && agentSession.issue) {
        const issue = agentSession.issue;
        const client = sessionManager.getLinearClient(workspaceId);

        // Check if this is a comment-triggered session (resume) or a new assignment
        const isCommentTriggered = !!agentSession.comment?.body;
        const existingSession = sessionManager.hasSession(issue.id);

        if (isCommentTriggered && existingSession) {
          // Comment on existing ticket → resume previous session
          const commentBody = agentSession.comment!.body;
          log.info(`Agent session from comment: ${issue.identifier} → resume (${commentBody.slice(0, 50)}...)`);

          await client.postAgentActivity(agentSession.id, "thought", "Resuming...").catch(() => {});

          await sessionManager.handleComment(
            issue.id,
            commentBody,
            "",
            workspaceId,
            agentSession.id,
          );
          return;
        }

        // New assignment
        if (sessionManager.hasSession(issue.id)) {
          log.debug(`Session already exists for ${issue.identifier}, skipping duplicate AgentSession webhook`);
          return;
        }

        log.info(`Agent session created: ${issue.identifier} (session: ${agentSession.id})`);

        await client.postAgentActivity(agentSession.id, "thought", "Starting work...").catch((err) => {
          log.warn(`Failed to post initial activity: ${err}`);
        });

        const fullIssue = await client.fetchIssue(issue.id);
        await sessionManager.handleNewIssue(fullIssue, workspaceId, agentSession.id);
        return;
      }

      if (payload.action === "prompted" && agentSession.issue) {
        // User sent a follow-up prompt or stop signal
        if (agentActivity?.signal === "stop") {
          log.info(`Stop signal for ${agentSession.issue.identifier}`);
          // TODO: abort running session
          return;
        }

        // Resume with the prompt content
        const promptBody = agentActivity?.content?.body;
        if (promptBody && agentSession.issue) {
          log.info(`Agent prompt for ${agentSession.issue.identifier}: ${promptBody.slice(0, 50)}...`);
          await sessionManager.handleComment(
            agentSession.issue.id,
            promptBody,
            "",
            workspaceId,
            agentSession.id,
          );
        }
        return;
      }
    }

    // Handle regular Issue webhooks (fallback for non-agent-session flows)
    if (payload.type === "Issue") {
      const data = payload.data as {
        id?: string;
        assigneeId?: string;
        assignee?: { id?: string };
      };

      const assigneeId = data.assigneeId ?? data.assignee?.id;

      if (!ws.viewerId || assigneeId !== ws.viewerId) {
        return;
      }

      if (payload.action === "create" || payload.action === "update") {
        const issueId = data.id as string;

        if (sessionManager.hasSession(issueId)) {
          log.debug(`Session already exists for ${issueId}, skipping duplicate webhook`);
          return;
        }

        log.info(`New issue assigned: ${issueId}`);

        const client = sessionManager.getLinearClient(workspaceId);
        const issue = await client.fetchIssue(issueId);

        await sessionManager.handleNewIssue(issue, workspaceId);
      }
    }

    // Handle comments (resume session)
    if (payload.type === "Comment" && payload.action === "create") {
      const data = payload.data as {
        issueId?: string;
        body?: string;
        userId?: string;
      };

      if (data.issueId && data.body) {
        await sessionManager.handleComment(
          data.issueId,
          data.body,
          data.userId ?? "",
          workspaceId,
        );
      }
    }
  };
}
