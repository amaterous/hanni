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
  thinking?: boolean;
  effort?: "low" | "medium" | "high" | "max";
}): Promise<ClaudeSessionResult> {
  const { prompt, cwd, model, fallbackModel, resumeSessionId, logsDir, issueIdentifier, maxTurns, mcpServers, thinking, effort } = params;

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
        // bypassPermissions is intentional: hanni is a fully automated coding agent
        // that needs unrestricted file/shell access to implement tickets end-to-end.
        // Never run hanni with untrusted input — treat it like a developer with full
        // repo access. See SECURITY.md for the trust model.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        resume: resumeSessionId,
        ...(maxTurns ? { maxTurns } : {}),
        ...(mcpServers ? { mcpServers } : {}),
        ...(thinking ? { thinking: { type: "enabled" as const } } : {}),
        ...(effort ? { effort } : {}),
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

    // Save structured log: prompt + metadata + all SDK messages
    const logEntry = {
      prompt,
      startedAt: new Date(startTime).toISOString(),
      model,
      resumeSessionId: resumeSessionId ?? null,
      sessionId,
      success,
      costUsd,
      durationMs,
      resultText,
      messages,
    };
    appendFileSync(logFile, JSON.stringify(logEntry, null, 2));

    return { sessionId, success, costUsd, durationMs, resultText };
  } catch (err) {
    log.error(`Session ${issueIdentifier} error:`, err);
    return { sessionId, success: false, costUsd: 0, durationMs: Date.now() - startTime, resultText: "" };
  }
}
