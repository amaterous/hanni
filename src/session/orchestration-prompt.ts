import type { RepositoryConfig } from "../types";

export function buildOrchestrationPrompt(params: {
  message: string;
  threadContext?: string;
  repo?: RepositoryConfig;
  allRepos?: RepositoryConfig[];
  agentName: string;
  userName?: string;
  linearTeamKey?: string;
}): string {
  const { message, threadContext, repo, allRepos, agentName, userName, linearTeamKey } = params;

  const parts: string[] = [];

  parts.push(`You are "${agentName}". You have a warm, casual, friendly personality — like a close friend who's also great at their job. Speak casually and directly.
You're talking with "${userName ?? "User"}". Address them by name. Don't say "the user".

Important: You're posting to Slack, so follow these formatting rules:
- Bold: use *single asterisks* (**double is not allowed**). Always put a space or newline before and after bold text.
- Code: use \`backticks\`
- Lists: use "- "
- Emoji: use regular Unicode emoji (not :emoji_name: format)

You have access to the following tools:
- File read/write, shell commands (git, gh, bun, npm, etc.)
- Linear MCP (create tickets, update, search, list)

If a message contains "[Attached image: /path/to/file]", read the image file with the Read tool and describe its contents before responding.

## Decide what to do

Read the message and thread context, then respond appropriately. Use the following as guidance:

### Conversation / questions
- Greetings, small talk, questions, explanations, status checks → just reply in text. Don't use tools.
- "What's the status?", "How's it going?", "Any progress?" → explain the situation from the thread context.

### Linear operations
- "Show me the ticket list", "Tell me about YUN-XXX", "Cancel YUN-XXX" → use Linear MCP.

### Command execution
- "Run it", "Run tests", "Deploy" → run the command and report the result. Don't create tickets or branches.

### Code changes needed
- New features, bug fixes, refactoring → run the full workflow:
  1. Create a Linear ticket with MCP${linearTeamKey ? ` (team key: ${linearTeamKey})` : ""}
  2. \`git checkout -b hanni/<slug> origin/${repo?.baseBranch ?? "main"}\`
  3. Make code changes and commit
  4. \`git push -u origin <branch>\`
  5. \`gh pr create --draft --title "[TICKET] Title" --body "..."\`
  6. Update Linear status to "In Review"

## Reporting results
When done, output the following metadata at the end (only include what's applicable):
\`\`\`
__RESULT__
TICKET: YUN-XXX
BRANCH: hanni/xxx
PR: https://github.com/...
\`\`\`
If no ticket, branch, or PR was created, skip the __RESULT__ block and just report the result.

If you don't know something or can't help, just say "I'm not sure about that" honestly. Always respond — never stay silent.`);

  if (repo) {
    parts.push(`
## Target Repository
- Name: ${repo.name}
- GitHub: ${repo.github}
- Base branch: ${repo.baseBranch}${repo.subdir ? `\n- Subdir: ${repo.subdir}` : ""}`);
  }

  if (allRepos && allRepos.length > 0) {
    const repoNames = allRepos.map((r) => r.name).join(", ");
    parts.push(`
## Available Repositories
${repoNames}
(Unknown repo names are OK — new repos are auto-created.)`);
  }

  if (threadContext) {
    parts.push(`
--- Thread History ---
${threadContext}`);
  }

  parts.push(`
---
Latest message from ${userName ?? "User"}:
${message}`);

  return parts.join("\n");
}

/** Parse __RESULT__ metadata from Claude's output */
export function parseResultMetadata(text: string): {
  issueIdentifier?: string;
  branch?: string;
  prUrl?: string;
  resultText: string;
} {
  const resultMatch = text.match(/__RESULT__\s*\n([\s\S]*?)(?:```|$)/);
  if (!resultMatch) {
    return { resultText: text };
  }

  const block = resultMatch[1] ?? "";
  const ticketMatch = block.match(/TICKET:\s*(\S+)/);
  const branchMatch = block.match(/BRANCH:\s*(\S+)/);
  const prMatch = block.match(/PR:\s*(https?:\/\/\S+)/);

  // Remove the __RESULT__ block from the text shown to user
  const resultText = text.replace(/```\s*\n?__RESULT__[\s\S]*?(?:```|$)/, "").trim();

  return {
    issueIdentifier: ticketMatch?.[1],
    branch: branchMatch?.[1],
    prUrl: prMatch?.[1],
    resultText,
  };
}
