import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { query, type SDKResultSuccess, type SDKResultError, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../utils/logger";

const log = createLogger("claude");

export interface ClaudeSessionResult {
  sessionId: string;
  success: boolean;
  costUsd: number;
  durationMs: number;
  resultText: string;
}

export async function runClaudeSession(params: {
  prompt: string;
  cwd: string;
  model: string;
  fallbackModel: string;
  resumeSessionId?: string;
  logsDir: string;
  issueIdentifier: string;
  maxTurns?: number;
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}): Promise<ClaudeSessionResult> {
  const { prompt, cwd, model, fallbackModel, resumeSessionId, logsDir, issueIdentifier, maxTurns, mcpServers } = params;

  // Ensure logs directory
  const issueLogDir = join(logsDir, issueIdentifier);
  mkdirSync(issueLogDir, { recursive: true });
  const logFile = join(issueLogDir, `session-${Date.now()}.json`);

  log.info(`Starting Claude session for ${issueIdentifier} (resume: ${!!resumeSessionId})`);

  const startTime = Date.now();

  let sessionId = "";
  let costUsd = 0;
  let success = false;
  let resultText = "";

  try {
    const conversation = query({
      prompt,
      options: {
        cwd,
        model,
        fallbackModel: fallbackModel || undefined,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        resume: resumeSessionId,
        ...(maxTurns ? { maxTurns } : {}),
        ...(mcpServers ? { mcpServers } : {}),
      },
    });

    // Consume all messages, keep the last result
    let lastResult: SDKResultSuccess | SDKResultError | undefined;
    const messages: SDKMessage[] = [];

    for await (const message of conversation) {
      messages.push(message);
      if (message.type === "result") {
        lastResult = message as SDKResultSuccess | SDKResultError;
      }
    }

    const durationMs = Date.now() - startTime;

    // Save messages to log file
    appendFileSync(logFile, JSON.stringify(messages, null, 2));

    if (lastResult) {
      sessionId = lastResult.session_id;
      costUsd = lastResult.total_cost_usd;
      success = lastResult.subtype === "success";
      resultText = lastResult.subtype === "success" ? (lastResult as SDKResultSuccess).result : "";

      log.info(
        `Session ${issueIdentifier} completed: success=${success} cost=$${costUsd.toFixed(2)} duration=${durationMs}ms`,
      );
    } else {
      log.error(`Session ${issueIdentifier} produced no result message`);
    }

    return { sessionId, success, costUsd, durationMs, resultText };
  } catch (err) {
    log.error(`Session ${issueIdentifier} error:`, err);
    return { sessionId, success: false, costUsd: 0, durationMs: Date.now() - startTime, resultText: "" };
  }
}
