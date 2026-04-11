import type { LinearIssue, WorkflowState, GQLIssueResponse, GQLIssuesResponse, GQLTeamsResponse, GQLViewerResponse } from "./types";
import { createLogger } from "../utils/logger";
import { LINEAR_API_URL } from "../constants";

const log = createLogger("linear");

export class LinearClient {
  constructor(private accessToken: string) {}

  updateToken(token: string) {
    this.accessToken = token;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`Linear API error: ${json.errors.map((e) => e.message).join(", ")}`);
    }
    return json.data!;
  }

  async fetchIssue(issueId: string): Promise<LinearIssue> {
    const data = await this.gql<GQLIssueResponse>(
      `query($id: String!) {
        issue(id: $id) {
          id identifier title description
          assignee { id name }
          team { id }
          project { name }
          labels { nodes { name } }
        }
      }`,
      { id: issueId },
    );

    return {
      id: data.issue.id,
      identifier: data.issue.identifier,
      title: data.issue.title,
      description: data.issue.description,
      assigneeId: data.issue.assignee?.id ?? null,
      assigneeName: data.issue.assignee?.name ?? null,
      teamId: data.issue.team.id,
      projectName: data.issue.project?.name ?? null,
      labels: data.issue.labels.nodes.map((l) => l.name),
    };
  }

  async fetchIssueByIdentifier(identifier: string): Promise<LinearIssue & { stateName?: string }> {
    const data = await this.gql<GQLIssueResponse>(
      `query($id: String!) {
        issue(id: $id) {
          id identifier title description
          assignee { id name }
          team { id }
          project { name }
          labels { nodes { name } }
          state { name }
        }
      }`,
      { id: identifier },
    );

    return {
      id: data.issue.id,
      identifier: data.issue.identifier,
      title: data.issue.title,
      description: data.issue.description,
      assigneeId: data.issue.assignee?.id ?? null,
      assigneeName: data.issue.assignee?.name ?? null,
      teamId: data.issue.team.id,
      projectName: data.issue.project?.name ?? null,
      labels: data.issue.labels.nodes.map((l) => l.name),
      stateName: data.issue.state?.name ?? undefined,
    };
  }

  async listRecentIssues(limit = 5): Promise<{ id: string; identifier: string; title: string; stateName?: string }[]> {
    const data = await this.gql<GQLIssuesResponse>(
      `query($first: Int!) {
        issues(first: $first, orderBy: updatedAt) {
          nodes { id identifier title state { name } }
        }
      }`,
      { first: limit },
    );
    return data.issues.nodes.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      stateName: i.state?.name ?? undefined,
    }));
  }

  async createIssue(input: {
    title: string;
    description?: string;
    teamId: string;
    assigneeId?: string;
    projectId?: string;
  }): Promise<{ id: string; identifier: string }> {
    const data = await this.gql<{
      issueCreate: { issue: { id: string; identifier: string } };
    }>(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          issue { id identifier }
        }
      }`,
      { input },
    );
    const issue = data.issueCreate.issue;
    log.info(`Created issue ${issue.identifier}`);
    return issue;
  }

  async getTeams(): Promise<{ id: string; key: string; name: string }[]> {
    const data = await this.gql<GQLTeamsResponse>(`query { teams { nodes { id key name } } }`);
    return data.teams.nodes as { id: string; key: string; name: string }[];
  }

  async updateIssueStatus(issueId: string, stateId: string): Promise<void> {
    await this.gql(
      `mutation($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      { id: issueId, stateId },
    );
    log.info(`Updated issue ${issueId} status`);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.gql(
      `mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }`,
      { issueId, body },
    );
    log.info(`Posted comment on ${issueId}`);
  }

  async fetchWorkflowStates(teamId: string): Promise<WorkflowState[]> {
    const data = await this.gql<{
      team: { states: { nodes: WorkflowState[] } };
    }>(
      `query($teamId: String!) {
        team(id: $teamId) {
          states { nodes { id name type } }
        }
      }`,
      { teamId },
    );
    return data.team.states.nodes;
  }

  async postAgentActivity(
    agentSessionId: string,
    type: "thought" | "action" | "response" | "error",
    body: string,
  ): Promise<void> {
    await this.gql(
      `mutation($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) { success }
      }`,
      {
        input: {
          agentSessionId,
          content: { type, body },
        },
      },
    );
    log.debug(`Posted activity on session ${agentSessionId}`);
  }

  async getViewer(): Promise<{ id: string; name: string }> {
    const data = await this.gql<GQLViewerResponse>(
      `query { viewer { id name } }`,
    );
    return data.viewer;
  }
}
