import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from "fs";
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

/**
 * Delete worktree directories older than maxAgeDays (by mtime), except those
 * currently in use by an active session. Each worktree carries a full
 * node_modules (~2GB), so without this the disk fills up (ENOSPC, 2026-07-21).
 */
export function cleanupStaleWorktrees(params: {
  worktreesDir: string;
  reposDir: string;
  maxAgeDays: number;
  activeWorktreePaths: Set<string>;
}): number {
  const { worktreesDir, reposDir, maxAgeDays, activeWorktreePaths } = params;
  if (!existsSync(worktreesDir)) return 0;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const name of readdirSync(worktreesDir)) {
    const path = resolve(worktreesDir, name);
    try {
      if (activeWorktreePaths.has(path)) continue;
      const st = statSync(path);
      if (!st.isDirectory() || st.mtimeMs > cutoff) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
      log.info(`Removed stale worktree ${name}`);
    } catch (err) {
      log.warn(`Failed to remove stale worktree ${name}: ${err}`);
    }
  }

  // Let git forget the deleted worktrees in each cloned repo
  if (removed > 0 && existsSync(reposDir)) {
    for (const repoName of readdirSync(reposDir)) {
      const repoPath = join(reposDir, repoName);
      if (!existsSync(join(repoPath, ".git"))) continue;
      run(["git", "worktree", "prune"], repoPath).catch((err) => {
        log.warn(`git worktree prune failed in ${repoName}: ${err}`);
      });
    }
  }

  return removed;
}
