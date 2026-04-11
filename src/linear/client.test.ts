import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { LinearClient } from "./client";

const TOKEN = "lin_api_test";

function makeResponse(data: unknown, errors?: { message: string }[]) {
  return new Response(JSON.stringify({ data, errors }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LinearClient", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fetchIssue returns mapped LinearIssue", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        issue: {
          id: "id-1",
          identifier: "YUN-1",
          title: "Test Issue",
          description: "desc",
          assignee: { id: "u1", name: "Alice" },
          team: { id: "t1" },
          project: { name: "MyProject" },
          labels: { nodes: [{ name: "bug" }] },
        },
      }),
    );

    const client = new LinearClient(TOKEN);
    const issue = await client.fetchIssue("id-1");

    expect(issue.id).toBe("id-1");
    expect(issue.identifier).toBe("YUN-1");
    expect(issue.title).toBe("Test Issue");
    expect(issue.assigneeId).toBe("u1");
    expect(issue.assigneeName).toBe("Alice");
    expect(issue.teamId).toBe("t1");
    expect(issue.projectName).toBe("MyProject");
    expect(issue.labels).toEqual(["bug"]);
  });

  it("fetchIssue handles null assignee and project", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        issue: {
          id: "id-2",
          identifier: "YUN-2",
          title: "No Assignee",
          description: null,
          assignee: null,
          team: { id: "t1" },
          project: null,
          labels: { nodes: [] },
        },
      }),
    );

    const client = new LinearClient(TOKEN);
    const issue = await client.fetchIssue("id-2");

    expect(issue.assigneeId).toBeNull();
    expect(issue.assigneeName).toBeNull();
    expect(issue.projectName).toBeNull();
    expect(issue.labels).toEqual([]);
  });

  it("fetchIssueByIdentifier includes stateName", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        issue: {
          id: "id-3",
          identifier: "YUN-3",
          title: "With State",
          description: null,
          assignee: null,
          team: { id: "t1" },
          project: null,
          labels: { nodes: [] },
          state: { name: "In Progress" },
        },
      }),
    );

    const client = new LinearClient(TOKEN);
    const issue = await client.fetchIssueByIdentifier("YUN-3");

    expect(issue.stateName).toBe("In Progress");
  });

  it("listRecentIssues returns mapped issues", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        issues: {
          nodes: [
            { id: "i1", identifier: "YUN-1", title: "A", state: { name: "Todo" } },
            { id: "i2", identifier: "YUN-2", title: "B", state: null },
          ],
        },
      }),
    );

    const client = new LinearClient(TOKEN);
    const issues = await client.listRecentIssues(2);

    expect(issues).toHaveLength(2);
    expect(issues[0].stateName).toBe("Todo");
    expect(issues[1].stateName).toBeUndefined();
  });

  it("createIssue returns id and identifier", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        issueCreate: { issue: { id: "new-id", identifier: "YUN-99" } },
      }),
    );

    const client = new LinearClient(TOKEN);
    const result = await client.createIssue({ title: "New Issue", teamId: "t1" });

    expect(result.id).toBe("new-id");
    expect(result.identifier).toBe("YUN-99");
  });

  it("getTeams returns team list", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        teams: {
          nodes: [
            { id: "t1", key: "YUN", name: "Yun Team" },
            { id: "t2", key: "SKY", name: "Sky Team" },
          ],
        },
      }),
    );

    const client = new LinearClient(TOKEN);
    const teams = await client.getTeams();

    expect(teams).toHaveLength(2);
    expect(teams[0].key).toBe("YUN");
  });

  it("getViewer returns viewer info", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ viewer: { id: "u1", name: "Hanni" } }),
    );

    const client = new LinearClient(TOKEN);
    const viewer = await client.getViewer();

    expect(viewer.id).toBe("u1");
    expect(viewer.name).toBe("Hanni");
  });

  it("fetchWorkflowStates returns states", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        team: {
          states: {
            nodes: [
              { id: "s1", name: "Todo", type: "unstarted" },
              { id: "s2", name: "Done", type: "completed" },
            ],
          },
        },
      }),
    );

    const client = new LinearClient(TOKEN);
    const states = await client.fetchWorkflowStates("t1");

    expect(states).toHaveLength(2);
    expect(states[0].name).toBe("Todo");
    expect(states[1].type).toBe("completed");
  });

  it("gql throws on API errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(null, [{ message: "Not found" }, { message: "Unauthorized" }]),
    );

    const client = new LinearClient(TOKEN);
    await expect(client.fetchIssue("bad-id")).rejects.toThrow(
      "Linear API error: Not found, Unauthorized",
    );
  });

  it("sends Authorization header with token", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ viewer: { id: "u1", name: "Test" } }),
    );

    const client = new LinearClient(TOKEN);
    await client.getViewer();

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(TOKEN);
  });

  it("updateToken changes the token used", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ viewer: { id: "u2", name: "Other" } }),
    );

    const client = new LinearClient(TOKEN);
    client.updateToken("new_token");
    await client.getViewer();

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe("new_token");
  });
});
