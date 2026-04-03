import { createLogger } from "../utils/logger";

const log = createLogger("pr");

async function run(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), ok: code === 0 };
}

export async function pushAndCreatePR(params: {
  worktreePath: string;
  branchName: string;
  issueIdentifier: string;
  issueTitle: string;
  baseBranch: string;
  github?: string;
  slackThread?: { channel: string; threadTs: string };
}): Promise<{ prUrl: string | null }> {
  const { worktreePath, branchName, issueIdentifier, issueTitle, baseBranch, github, slackThread } = params;

  // Skip push/PR for local-only repos
  if (!github) {
    log.info(`${issueIdentifier}: local-only repo, skipping push/PR`);
    return { prUrl: null };
  }

  // Check if there are any commits to push
  const { stdout: diff } = await run(
    ["git", "log", `origin/${baseBranch}..HEAD`, "--oneline"],
    worktreePath,
  );
  if (!diff) {
    log.warn(`${issueIdentifier}: no commits to push`);
    return { prUrl: null };
  }

  // Push
  const push = await run(["git", "push", "-u", "origin", branchName], worktreePath);
  if (!push.ok) {
    log.error(`${issueIdentifier}: push failed: ${push.stderr}`);
    return { prUrl: null };
  }
  log.info(`${issueIdentifier}: pushed ${branchName}`);

  // Check if PR already exists
  const existing = await run(["gh", "pr", "view", "--json", "url"], worktreePath);
  if (existing.ok) {
    try {
      const url = JSON.parse(existing.stdout).url;
      log.info(`${issueIdentifier}: PR already exists → ${url}`);
      return { prUrl: url };
    } catch {}
  }

  // Create draft PR
  const title = `[${issueIdentifier}] ${issueTitle}`;
  let body = `Automated PR by hanni for ${issueIdentifier}`;
  if (slackThread) {
    body += `\n\n<!-- slack-thread: ${slackThread.channel}/${slackThread.threadTs} -->`;
  }
  const pr = await run(
    [
      "gh", "pr", "create",
      "--draft",
      "--title", title,
      "--body", body,
      "--base", baseBranch,
      "--head", branchName,
    ],
    worktreePath,
  );

  if (pr.ok && pr.stdout) {
    log.info(`${issueIdentifier}: PR created → ${pr.stdout}`);
    return { prUrl: pr.stdout };
  }

  log.error(`${issueIdentifier}: PR creation failed: ${pr.stderr}`);
  return { prUrl: null };
}
