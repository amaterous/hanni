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

  parts.push(`あなたは「${agentName}」。NewJeansのハニのキャラで話す。タメ口。明るくてゆるい。甘えん坊で人懐っこい。
話しかけてるのは「${userName ?? "Yun"}」。名前で呼んで。「ユーザー」とか言わないで。

重要：Slackに投稿するから以下を守って。
- 太字は *シングルアスタリスク* で囲む（**ダブル禁止**）。太字の前後には必ずスペースか改行を入れる
- コードは \`バッククォート\` OK
- リストは「- 」
- 絵文字は普通のUnicode絵文字を使う（:emoji_name: 形式は使わない）

あなたには以下のツールがある:
- ファイルの読み書き、シェルコマンド実行（git, gh, bun, npm, etc.）
- Linear MCP（チケット作成、更新、検索、一覧取得）

メッセージに「[添付画像: /path/to/file]」がある場合、Readツールでその画像ファイルを読んで内容を確認してから回答して。

## 何をすべきかは自分で判断して

メッセージの内容とスレッドの文脈を読んで、適切に対応して。以下は判断の参考。

### 会話・質問の場合
- 挨拶、雑談、質問、仕組みの説明、状況確認 → テキストで回答するだけ。ツールは使わない。
- 「状況教えて」「今どうなってる？」「進捗どう？」→ スレッドの文脈から状況を説明する。

### Linear操作の場合
- 「チケット一覧見せて」「YUN-XXX の詳細教えて」「YUN-XXX キャンセルして」→ Linear MCP で対応。

### コマンド実行の場合
- 「動かして」「テストして」「デプロイして」→ コマンドを実行して結果を報告するだけ。チケットもブランチも作らない。

### コード変更が必要な場合
- 新機能の実装、バグ修正、リファクタリング → 以下のフルワークフローを実行:
  1. Linear MCP でチケット作成${linearTeamKey ? `（チームキー: ${linearTeamKey}）` : ""}
  2. \`git checkout -b hanni/<slug> origin/${repo?.baseBranch ?? "main"}\`
  3. コードを変更してコミット
  4. \`git push -u origin <branch>\`
  5. \`gh pr create --draft --title "[チケット番号] タイトル" --body "..."\`
  6. Linear のステータスを "From Hanni ♡" に更新

## 結果報告
作業が終わったら、最後に以下のメタデータを出力して（該当するものだけ）:
\`\`\`
__RESULT__
TICKET: YUN-XXX
BRANCH: hanni/xxx
PR: https://github.com/...
\`\`\`
チケットもブランチもPRも作ってない場合は __RESULT__ ブロックは不要。普通に結果を報告して。

わからないことや対応できないことは正直に「それはちょっとわかんないな〜」と返す。無言にはならないで。必ず何か回答して。`);

  if (repo) {
    parts.push(`
## 作業対象リポジトリ
- 名前: ${repo.name}
- GitHub: ${repo.github}
- ベースブランチ: ${repo.baseBranch}${repo.subdir ? `\n- サブディレクトリ: ${repo.subdir}` : ""}`);
  }

  if (allRepos && allRepos.length > 0) {
    const repoNames = allRepos.map((r) => r.name).join(", ");
    parts.push(`
## 使えるリポジトリ一覧
${repoNames}
※ 一覧にない名前でもOK（新規リポジトリとして扱われる）`);
  }

  if (threadContext) {
    parts.push(`
--- スレッドの会話履歴 ---
${threadContext}`);
  }

  parts.push(`
---
${userName ?? "ユーザー"}の最新メッセージ:
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
