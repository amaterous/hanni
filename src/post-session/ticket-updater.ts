import type { LinearClient } from "../linear/client";
import { createLogger } from "../utils/logger";

const log = createLogger("ticket");

export async function updateTicketAfterSession(params: {
  linearClient: LinearClient;
  issueId: string;
  issueIdentifier: string;
  branchName: string;
  prUrl: string | null;
  inReviewStateId: string;
  agentName: string;
}): Promise<void> {
  const { linearClient, issueId, issueIdentifier, branchName, prUrl, inReviewStateId, agentName } =
    params;

  try {
    await linearClient.updateIssueStatus(issueId, inReviewStateId);
    log.info(`${issueIdentifier} → In Review`);
  } catch (err) {
    log.error(`Failed to update status for ${issueIdentifier}:`, err);
  }

  const lines = [`## ${agentName} completed`];
  lines.push("");
  lines.push(`**Branch:** \`${branchName}\``);
  if (prUrl) {
    lines.push(`**PR:** ${prUrl}`);
  }

  try {
    await linearClient.createComment(issueId, lines.join("\n"));
  } catch (err) {
    log.error(`Failed to post comment on ${issueIdentifier}:`, err);
  }
}
