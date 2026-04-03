export interface LinearWebhookPayload {
  action: "create" | "update" | "remove" | "created" | "prompted";
  type: "Issue" | "Comment" | "IssueLabel" | "AgentSessionEvent";
  data: Record<string, unknown>;
  organizationId: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string;
  projectName: string | null;
  labels: string[];
}

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

// --- GraphQL Response Types ---

export interface GQLUser {
  id: string;
  name: string;
}

export interface GQLProject {
  name: string;
}

export interface GQLTeam {
  id: string;
  key?: string;
  name?: string;
}

export interface GQLState {
  name: string;
}

export interface GQLIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  assignee: GQLUser | null;
  team: GQLTeam;
  project: GQLProject | null;
  labels: { nodes: { name: string }[] };
  state?: GQLState | null;
}

export interface GQLIssueResponse {
  issue: GQLIssueNode;
}

export interface GQLIssuesResponse {
  issues: {
    nodes: GQLIssueNode[];
  };
}

export interface GQLTeamsResponse {
  teams: {
    nodes: GQLTeam[];
  };
}

export interface GQLViewerResponse {
  viewer: GQLUser;
}
