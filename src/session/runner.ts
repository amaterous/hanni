import type { HanniConfig } from "../types";
import { runClaudeSession } from "./claude-runner";

export type ModelSessionResult = {
  sessionId: string;
  success: boolean;
  costUsd: number;
  durationMs: number;
  resultText: string;
};

export async function runModelSession(
  _config: HanniConfig,
  params: {
    prompt: string;
    cwd: string;
    model: string;
    fallbackModel: string;
    resumeSessionId?: string;
    logsDir: string;
    issueIdentifier: string;
    maxTurns?: number;
    mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  },
): Promise<ModelSessionResult> {
  return runClaudeSession(params);
}
