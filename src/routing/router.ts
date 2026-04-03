import type { RepositoryConfig } from "../types";
import type { LinearIssue } from "../linear/types";
import { createLogger } from "../utils/logger";

const log = createLogger("router");

export function routeToRepository(
  issue: LinearIssue,
  repositories: RepositoryConfig[],
  workspaceId: string,
): RepositoryConfig | null {
  // Filter by workspace
  const candidates = repositories.filter((r) => r.linearWorkspaceId === workspaceId);

  log.info(`Routing ${issue.identifier}: project="${issue.projectName}", candidates=[${candidates.map(c => c.name).join(", ")}]`);

  // 1. If issue has a project, match by projectKeys
  if (issue.projectName) {
    for (const repo of candidates) {
      if (repo.projectKeys.length === 0) continue;
      const match = repo.projectKeys.some(
        (key) => key.toLowerCase() === issue.projectName!.toLowerCase(),
      );
      if (match) {
        log.info(`Routed ${issue.identifier} → ${repo.name} (project match: "${issue.projectName}")`);
        return repo;
      }
    }
  }

  // 2. Keyword fallback: check if any repo name or projectKeys appear in the title/description
  const searchText = `${issue.title} ${issue.description ?? ""}`.toLowerCase();
  for (const repo of candidates) {
    const keys = [repo.name, ...repo.projectKeys];
    if (keys.some(key => key.length > 2 && searchText.includes(key.toLowerCase()))) {
      log.info(`Routed ${issue.identifier} → ${repo.name} (keyword match)`);
      return repo;
    }
  }

  // 3. Fallback: if only one repo in workspace has no projectKeys (catch-all), use it
  const catchAll = candidates.filter((r) => r.projectKeys.length === 0);
  if (catchAll.length === 1) {
    const repo = catchAll[0]!;
    log.info(`Routed ${issue.identifier} → ${repo.name} (only generic candidate)`);
    return repo;
  }

  // 4. Last resort: use _default repo if configured
  const defaultRepo = repositories.find((r) => r.name === "_default" && r.linearWorkspaceId === workspaceId);
  if (defaultRepo) {
    log.info(`Routed ${issue.identifier} → _default`);
    return defaultRepo;
  }

  log.warn(`No repository matched for ${issue.identifier} (workspace: ${workspaceId}, project: "${issue.projectName}")`);
  return null;
}
