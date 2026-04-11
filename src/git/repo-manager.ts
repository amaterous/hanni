import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { RepositoryConfig } from "../types";
import { createLogger } from "../utils/logger";

const log = createLogger("git");

async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Read stdout and stderr in parallel to avoid deadlock
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr}`);
  }
  return stdout.trim();
}

export async function ensureRepo(
  repo: RepositoryConfig,
  reposDir: string,
): Promise<string> {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(reposDir)) {
    mkdirSync(reposDir, { recursive: true });
  }

  if (!existsSync(repoPath)) {
    if (!repo.github) {
      // Local-only repo (e.g. _default workspace)
      log.info(`Creating local repo ${repoPath}`);
      mkdirSync(repoPath, { recursive: true });
      await run(["git", "init"], repoPath);
      await run(["git", "commit", "--allow-empty", "-m", "init"], repoPath);
    } else {
      log.info(`Cloning ${repo.github} → ${repoPath}`);
      await run([
        "git",
        "clone",
        `https://github.com/${repo.github}.git`,
        repoPath,
      ]);
    }
  } else if (repo.github) {
    log.info(`Fetching ${repo.name}`);
    await run(["git", "fetch", "origin", repo.baseBranch], repoPath);
  }

  return repoPath;
}

export { run };
