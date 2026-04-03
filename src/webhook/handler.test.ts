import { describe, expect, test, mock, beforeEach } from "bun:test";
import { createWebhookHandler } from "./handler";
import type { BroConfig } from "../types";

// Minimal config with one known workspace
const makeConfig = (viewerId = "viewer-1"): BroConfig =>
  ({
    linear: {
      workspaces: {
        "ws-known": {
          apiKey: "key",
          viewerId,
        },
      },
    },
  }) as unknown as BroConfig;

const makeMockLinearClient = () => ({
  postAgentActivity: mock(async () => {}),
  fetchIssue: mock(async (id: string) => ({ id, identifier: "YUN-1", title: "Test Issue" })),
});

const makeMockSessionManager = (hasSession = false) => ({
  getLinearClient: mock(() => makeMockLinearClient()),
  hasSession: mock((_id: string) => hasSession),
  handleNewIssue: mock(async () => {}),
  handleComment: mock(async () => {}),
});

describe("createWebhookHandler", () => {
  test("ignores webhook from unknown workspace", async () => {
    const sm = makeMockSessionManager();
    const handler = createWebhookHandler(sm as any, makeConfig());
    await handler({ organizationId: "ws-unknown", type: "Issue", action: "create", data: {} } as any);
    expect(sm.handleNewIssue).not.toHaveBeenCalled();
    expect(sm.handleComment).not.toHaveBeenCalled();
  });

  describe("AgentSessionEvent - created", () => {
    test("new assignment triggers handleNewIssue", async () => {
      const sm = makeMockSessionManager(false);
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "AgentSessionEvent",
        action: "created",
        agentSession: {
          id: "session-1",
          issue: { id: "issue-1", identifier: "YUN-1", title: "Do something" },
          // no comment
        },
      } as any);

      expect(sm.handleNewIssue).toHaveBeenCalledTimes(1);
      expect(sm.handleComment).not.toHaveBeenCalled();
    });

    test("comment-triggered on existing session resumes via handleComment", async () => {
      const sm = makeMockSessionManager(true); // hasSession = true
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "AgentSessionEvent",
        action: "created",
        agentSession: {
          id: "session-1",
          issue: { id: "issue-1", identifier: "YUN-1", title: "Do something" },
          comment: { body: "Please add tests" },
        },
      } as any);

      expect(sm.handleComment).toHaveBeenCalledTimes(1);
      const args = sm.handleComment.mock.calls[0];
      expect(args[0]).toBe("issue-1");
      expect(args[1]).toBe("Please add tests");
      expect(sm.handleNewIssue).not.toHaveBeenCalled();
    });

    test("comment-triggered but NO existing session falls through to handleNewIssue", async () => {
      const sm = makeMockSessionManager(false); // no existing session
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "AgentSessionEvent",
        action: "created",
        agentSession: {
          id: "session-1",
          issue: { id: "issue-1", identifier: "YUN-1", title: "Do something" },
          comment: { body: "Please add tests" },
        },
      } as any);

      expect(sm.handleNewIssue).toHaveBeenCalledTimes(1);
      expect(sm.handleComment).not.toHaveBeenCalled();
    });
  });

  describe("AgentSessionEvent - prompted", () => {
    test("stop signal does not call handleComment", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "AgentSessionEvent",
        action: "prompted",
        agentSession: {
          id: "session-1",
          issue: { id: "issue-1", identifier: "YUN-1", title: "Do something" },
        },
        agentActivity: { signal: "stop" },
      } as any);

      expect(sm.handleComment).not.toHaveBeenCalled();
    });

    test("prompt body triggers handleComment", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "AgentSessionEvent",
        action: "prompted",
        agentSession: {
          id: "session-2",
          issue: { id: "issue-2", identifier: "YUN-2", title: "Another issue" },
        },
        agentActivity: { content: { body: "follow-up prompt" } },
      } as any);

      expect(sm.handleComment).toHaveBeenCalledTimes(1);
      const args = sm.handleComment.mock.calls[0];
      expect(args[0]).toBe("issue-2");
      expect(args[1]).toBe("follow-up prompt");
    });
  });

  describe("Issue type", () => {
    test("skips if assignee does not match viewerId", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig("viewer-1"));

      await handler({
        organizationId: "ws-known",
        type: "Issue",
        action: "create",
        data: { id: "issue-3", assigneeId: "someone-else" },
      } as any);

      expect(sm.handleNewIssue).not.toHaveBeenCalled();
    });

    test("calls handleNewIssue when assigned to viewer", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig("viewer-1"));

      await handler({
        organizationId: "ws-known",
        type: "Issue",
        action: "create",
        data: { id: "issue-4", assigneeId: "viewer-1" },
      } as any);

      expect(sm.handleNewIssue).toHaveBeenCalledTimes(1);
    });

    test("uses assignee.id as fallback when assigneeId absent", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig("viewer-1"));

      await handler({
        organizationId: "ws-known",
        type: "Issue",
        action: "update",
        data: { id: "issue-5", assignee: { id: "viewer-1" } },
      } as any);

      expect(sm.handleNewIssue).toHaveBeenCalledTimes(1);
    });
  });

  describe("Comment type", () => {
    test("create comment triggers handleComment", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "Comment",
        action: "create",
        data: { issueId: "issue-6", body: "Nice work!", userId: "user-1" },
      } as any);

      expect(sm.handleComment).toHaveBeenCalledTimes(1);
      const args = sm.handleComment.mock.calls[0];
      expect(args[0]).toBe("issue-6");
      expect(args[1]).toBe("Nice work!");
    });

    test("comment without body is ignored", async () => {
      const sm = makeMockSessionManager();
      const handler = createWebhookHandler(sm as any, makeConfig());

      await handler({
        organizationId: "ws-known",
        type: "Comment",
        action: "create",
        data: { issueId: "issue-7" },
      } as any);

      expect(sm.handleComment).not.toHaveBeenCalled();
    });
  });
});
