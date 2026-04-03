import type { RepositoryConfig } from "../types";

export interface ParsedSlackCommand {
  type: "task" | "resume" | "status";
  repoName?: string;
  taskDescription?: string;
  issueIdentifier?: string; // e.g. "YUN-81" for resume
}

/**
 * Parse a Slack mention text into a structured command.
 *
 * Examples:
 *   "@hanni iq-testのトップページ修正して"     → { type: "task", repoName: "iq-test", task: "トップページ修正して" }
 *   "@hanni YUN-81 続きやって"                → { type: "resume", issueIdentifier: "YUN-81" }
 *   "@hanni status"                           → { type: "status" }
 */
export function parseSlackMention(
  rawText: string,
  repositories: RepositoryConfig[],
): ParsedSlackCommand {
  // Remove the bot mention tag (Slack sends "<@U1234> text")
  const text = rawText.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!text) return { type: "status" };

  // "status" command
  if (/^status$/i.test(text)) {
    return { type: "status" };
  }

  // Resume: "YUN-81 続きやって" or "SKY-12 fix the bug"
  const resumeMatch = text.match(/^([A-Z]+-\d+)\s*(.*)/);
  if (resumeMatch) {
    return {
      type: "resume",
      issueIdentifier: resumeMatch[1],
      taskDescription: resumeMatch[2] || undefined,
    };
  }

  // Task: try to extract repo name from the beginning
  // Match repo names (e.g., "iq-test", "picoli.site", "thread-spark")
  const repoNames = repositories.map((r) => r.name);

  for (const name of repoNames) {
    // Check if text starts with repo name (case-insensitive)
    const pattern = new RegExp(`^${escapeRegex(name)}[\\sの](.*)`, "i");
    const match = text.match(pattern);
    if (match) {
      return {
        type: "task",
        repoName: name,
        taskDescription: match[1]!.trim(),
      };
    }
  }

  // No repo matched — use the entire text as task description
  // The handler will try to infer the repo or use a default
  return {
    type: "task",
    taskDescription: text,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
