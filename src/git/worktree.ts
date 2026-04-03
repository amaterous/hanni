import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { slugify } from "../utils/slugify";
import { run } from "./repo-manager";
import { createLogger } from "../utils/logger";

const log = createLogger("worktree");

export async function createWorktree(params: {
  repoPath: string;
  worktreesDir: string;
  issueIdentifier: string;
  issueTitle: string;
  baseBranch: string;
}): Promise<{ worktreePath: string; branchName: string }> {
  const { repoPath, worktreesDir, issueIdentifier, issueTitle, baseBranch } = params;

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  const worktreePath = resolve(worktreesDir, issueIdentifier);
  const branchName = `hanni/${issueIdentifier.toLowerCase()}-${slugify(issueTitle)}`;

  if (existsSync(worktreePath)) {
    log.info(`Worktree ${issueIdentifier} already exists, reusing`);
    return { worktreePath, branchName };
  }

  // Fetch latest
  await run(["git", "fetch", "origin", baseBranch], repoPath);

  // Delete stale branch if it exists (from previous failed run)
  try {
    await run(["git", "branch", "-D", branchName], repoPath);
    log.info(`Deleted stale branch ${branchName}`);
  } catch {
    // Branch doesn't exist, that's fine
  }

  // Create worktree with new branch
  await run(
    ["git", "worktree", "add", worktreePath, "-b", branchName, `origin/${baseBranch}`],
    repoPath,
  );

  // Copy CLAUDE.md from repo root if worktree doesn't have one
  const repoClaudeMd = join(repoPath, "CLAUDE.md");
  const worktreeClaudeMd = join(worktreePath, "CLAUDE.md");
  if (existsSync(repoClaudeMd) && !existsSync(worktreeClaudeMd)) {
    copyFileSync(repoClaudeMd, worktreeClaudeMd);
    log.info(`Copied CLAUDE.md to worktree ${issueIdentifier}`);
  }

  // Install dependencies if package.json exists
  const pkgJson = join(worktreePath, "package.json");
  if (existsSync(pkgJson)) {
    log.info(`Installing dependencies for ${issueIdentifier}...`);
    await run(["bun", "install"], worktreePath);
    log.info(`Dependencies installed for ${issueIdentifier}`);
  }

  log.info(`Created worktree ${issueIdentifier} → ${branchName}`);
  return { worktreePath, branchName };
}
