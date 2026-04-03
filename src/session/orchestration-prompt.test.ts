import { describe, expect, test } from "bun:test";
import { buildOrchestrationPrompt, parseResultMetadata } from "./orchestration-prompt";

describe("buildOrchestrationPrompt", () => {
  const base = {
    message: "テストしてみて",
    agentName: "Hanni",
    userName: "Yun",
  };

  test("agentName と userName がプロンプトに含まれる", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).toContain("Hanni");
    expect(result).toContain("Yun");
  });

  test("message が末尾に含まれる", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).toContain("テストしてみて");
  });

  test("userName が未指定のとき「Yun」がデフォルト", () => {
    const result = buildOrchestrationPrompt({ ...base, userName: undefined });
    // fallback: "Yun" as default name in prompt
    expect(result).toContain("Yun");
  });

  test("repo が指定されるとリポジトリ情報が含まれる", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      repo: { name: "my-repo", github: "owner/my-repo", baseBranch: "main" },
    });
    expect(result).toContain("my-repo");
    expect(result).toContain("owner/my-repo");
    expect(result).toContain("main");
  });

  test("repo に subdir があると含まれる", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      repo: { name: "mono", github: "owner/mono", baseBranch: "main", subdir: "apps/web" },
    });
    expect(result).toContain("apps/web");
  });

  test("repo なしのときリポジトリセクションは含まれない", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).not.toContain("作業対象リポジトリ");
  });

  test("allRepos が指定されるとリポジトリ一覧が含まれる", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      allRepos: [
        { name: "repo-a", github: "owner/repo-a", baseBranch: "main" },
        { name: "repo-b", github: "owner/repo-b", baseBranch: "develop" },
      ],
    });
    expect(result).toContain("repo-a");
    expect(result).toContain("repo-b");
    expect(result).toContain("使えるリポジトリ一覧");
  });

  test("allRepos が空配列のときリポジトリ一覧セクションは含まれない", () => {
    const result = buildOrchestrationPrompt({ ...base, allRepos: [] });
    expect(result).not.toContain("使えるリポジトリ一覧");
  });

  test("threadContext が指定されると会話履歴が含まれる", () => {
    const result = buildOrchestrationPrompt({
      ...base,
      threadContext: "過去の会話内容です",
    });
    expect(result).toContain("スレッドの会話履歴");
    expect(result).toContain("過去の会話内容です");
  });

  test("threadContext なしのとき会話履歴セクションは含まれない", () => {
    const result = buildOrchestrationPrompt(base);
    expect(result).not.toContain("スレッドの会話履歴");
  });

  test("linearTeamKey が指定されるとチームキーがプロンプトに含まれる", () => {
    const result = buildOrchestrationPrompt({ ...base, linearTeamKey: "YUN" });
    expect(result).toContain("YUN");
  });

  test("linearTeamKey なしのときチームキー部分が省略される", () => {
    const result = buildOrchestrationPrompt(base);
    // フルワークフローのステップ1は存在するが、チームキー括弧部分はない
    expect(result).not.toContain("チームキー:");
  });

  test("返り値は string", () => {
    const result = buildOrchestrationPrompt(base);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(100);
  });
});

describe("parseResultMetadata", () => {
  test("__RESULT__ ブロックなしのときテキストをそのまま返す", () => {
    const text = "作業が完了しました。";
    const result = parseResultMetadata(text);
    expect(result).toEqual({ resultText: "作業が完了しました。" });
    expect(result.issueIdentifier).toBeUndefined();
    expect(result.branch).toBeUndefined();
    expect(result.prUrl).toBeUndefined();
  });

  test("TICKET を正しくパースする", () => {
    const text = "完了！\n```\n__RESULT__\nTICKET: YUN-123\n```";
    const result = parseResultMetadata(text);
    expect(result.issueIdentifier).toBe("YUN-123");
  });

  test("BRANCH を正しくパースする", () => {
    const text = "完了！\n```\n__RESULT__\nBRANCH: hanni/my-feature\n```";
    const result = parseResultMetadata(text);
    expect(result.branch).toBe("hanni/my-feature");
  });

  test("PR URL を正しくパースする", () => {
    const text = "完了！\n```\n__RESULT__\nPR: https://github.com/owner/repo/pull/42\n```";
    const result = parseResultMetadata(text);
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");
  });

  test("TICKET・BRANCH・PR を全部パースする", () => {
    const text = [
      "実装が完了しました！",
      "```",
      "__RESULT__",
      "TICKET: YUN-456",
      "BRANCH: hanni/fix-bug",
      "PR: https://github.com/owner/repo/pull/99",
      "```",
    ].join("\n");
    const result = parseResultMetadata(text);
    expect(result.issueIdentifier).toBe("YUN-456");
    expect(result.branch).toBe("hanni/fix-bug");
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/99");
  });

  test("__RESULT__ ブロックが resultText から除去される", () => {
    const text = [
      "実装が完了しました！",
      "```",
      "__RESULT__",
      "TICKET: YUN-789",
      "```",
    ].join("\n");
    const result = parseResultMetadata(text);
    expect(result.resultText).not.toContain("__RESULT__");
    expect(result.resultText).not.toContain("TICKET:");
    expect(result.resultText).toContain("実装が完了しました！");
  });

  test("TICKET なしのとき issueIdentifier は undefined", () => {
    const text = "```\n__RESULT__\nBRANCH: hanni/x\n```";
    const result = parseResultMetadata(text);
    expect(result.issueIdentifier).toBeUndefined();
    expect(result.branch).toBe("hanni/x");
  });

  test("空文字列でも resultText を返す", () => {
    const result = parseResultMetadata("");
    expect(result.resultText).toBe("");
  });
});
