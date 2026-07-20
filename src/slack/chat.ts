import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { slackifyMarkdown } from "slackify-markdown";
import type { HanniConfig } from "../types";
import { createLogger } from "../utils/logger";
import { SLACK_URL_INFER_MAX_TURNS, LINEAR_MCP_PACKAGE } from "../constants";

const log = createLogger("chat");

/**
 * Convert a markdown table block to a monospace code block.
 * Slack doesn't support tables — code blocks use fixed-width font so columns align.
 */
function tableToCodeBlock(tableText: string): string {
  const lines = tableText.trim().split("\n").map((l) => l.trim());

  // Parse cells, stripping leading/trailing pipes and whitespace
  const parseCells = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  const rows = lines
    .filter((l) => !/^\|[-| :]+\|$/.test(l)) // drop separator rows
    .map(parseCells);

  if (rows.length === 0) return tableText;

  // Calculate column widths
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: colCount }, (_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length)),
  );

  const formatRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();

  const [header, ...body] = rows;
  const separator = widths.map((w) => "─".repeat(w)).join("  ");

  const formatted = [
    formatRow(header!),
    separator,
    ...body.map(formatRow),
  ].join("\n");

  return "```\n" + formatted + "\n```";
}

/**
 * Convert Markdown to Slack mrkdwn format.
 * Tables are converted to monospace code blocks since Slack doesn't support them.
 * Uses slackify-markdown for everything else.
 */
export function formatForSlack(text: string): string {
  // Replace markdown table blocks before slackify-markdown processes them
  const withCodeTables = text.replace(
    /((?:^\|.+\|\n?)+)/gm,
    (match) => tableToCodeBlock(match) + "\n",
  );
  return slackifyMarkdown(withCodeTables);
}

/**
 * Classify a message and either respond directly (chat) or return null (code task).
 * Uses Claude Agent SDK (Max Plan) with MCP tools (Linear etc).
 */
export interface CodeTaskResult {
  repoName?: string;
}

export async function chatOrClassify(
  message: string,
  config: HanniConfig,
  threadContext?: string,
  userName?: string,
  linearApiKey?: string,
): Promise<string | CodeTaskResult> {
  const repoNames = config.repositories.map((r) => r.name).join(", ");

  const prompt = `You are "${config.agent.name}". You have a warm, casual, friendly personality — like a close friend who's also great at their job. Speak casually and directly.
You're talking with "${userName ?? "User"}". Address them by name. Don't say "the user".

Important: You're posting to Slack, so follow these formatting rules:
- Bold: use *single asterisks* (**double is not allowed**). Always put a space or newline before and after bold text.
- Code: use \`backticks\`
- Lists: "•" or "- " or numbered "1. 2. 3."
- Emoji: use regular Unicode emoji (not :emoji_name: format)

If a message contains "[Attached image: /path/to/file]", read the image file with the Read tool before responding.

Classify the following message:

Action (work is needed):
→ Reply with "__ACTION__:repo-name" format. Write nothing else.
→ If you can infer the repo from thread context, include it.
→ If no repo can be identified, just "__ACTION__".
→ Unknown repo names are OK (new repos are auto-created). Use the inferred repo name as-is.

Anything else (conversation, questions, search, Linear operations, small talk):
→ Respond normally as yourself.
→ For Linear (ticket list, details, status changes, etc.) use MCP tools.
→ Watch for negations like "don't cancel". Read context carefully.

IMPORTANT: You (this classifier) have no shell/Bash access and no Stripe/Vercel/GA4/DB credentials — only Linear MCP tools. Any question that needs live data from an external API or CLI (Stripe revenue/balance, Vercel deployment status, GA4 analytics, database queries, etc.) CANNOT be answered here and MUST be classified as __ACTION__ so it runs in a real session that has Bash + the actual credentials. Never say "I can't access that" — that's only true for this classifier, not for the real session. Classify it as ACTION and let the real session check.

Action examples (code changes, command execution, tests, deploy, live data lookups — anything requiring work):
- "fix the top page of iq-test" → __ACTION__:iq-test
- "change the design of picoli.site" → __ACTION__:picoli.site
- "continue YUN-123" → __ACTION__
- "update eq-test to version 3.0" → __ACTION__:eq-test
- (thread about iq-test) "implement it" → __ACTION__:iq-test
- (thread: "create a repo called hanni-news") "proceed" → __ACTION__:hanni-news
- "run hanni-news" → __ACTION__:hanni-news
- "run the tests" → __ACTION__
- "deploy" → __ACTION__
- (working in thread) "try running it" → __ACTION__
- "today's Stripe revenue?" / "今日のstripeの売上は？" → __ACTION__
- "how's the Vercel deploy looking?" → __ACTION__
- "check GA4 traffic for iq-test" → __ACTION__:iq-test

Non-action examples:
- "how are you?" → normal reply
- "show me the ticket list" → fetch from Linear MCP and reply
- "cancel YUN-272" → change status via MCP and reply
- "what's YUN-252 about?" → fetch via MCP and reply
- "status" → __ACTION__
- "what's the situation?" → explain from thread context, no work
- "how's it going?" → explain from thread context, no work
- "any progress?" → explain from thread context, no work
- "how does it work?" → explain normally
- "explain the setup" → explain normally

If you don't know something or can't help, just say "I'm not sure about that" honestly. Always respond — never stay silent.

Available repos: ${repoNames}
${threadContext ? `\n--- Thread History ---\n${threadContext}\n` : ""}
---
Latest message from ${userName ?? "User"}:
${message}`;

  try {
    let resultText = "";

    const conversation = query({
      prompt,
      options: {
        model: "sonnet",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: SLACK_URL_INFER_MAX_TURNS,
        mcpServers: {
          linear: {
            command: "npx",
            args: ["-y", LINEAR_MCP_PACKAGE],
            env: {
              LINEAR_API_TOKEN: linearApiKey ?? "",
            },
          },
        },
      },
    });

    for await (const msg of conversation) {
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = (msg as SDKResultSuccess).result;
      }
    }

    if (resultText.includes("__ACTION__")) {
      const repoMatch = resultText.match(/__ACTION__:(\S+)/);
      const repoName = repoMatch?.[1];
      log.info(`Classified as action${repoName ? ` (repo: ${repoName})` : ""}`);
      return { repoName };
    }

    resultText = formatForSlack(resultText);

    log.info(`Chat response: "${resultText.slice(0, 80)}..."`);
    return resultText || "Sorry, I couldn't respond. Please try again!";
  } catch (err) {
    log.error("Chat error:", err);
    return "Sorry, something went wrong...";
  }
}

