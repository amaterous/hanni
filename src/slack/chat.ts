import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { slackifyMarkdown } from "slackify-markdown";
import type { HanniConfig } from "../types";
import { createLogger } from "../utils/logger";

const log = createLogger("chat");

/**
 * Convert Markdown to Slack mrkdwn format.
 * Uses slackify-markdown for full AST-based conversion (bold, italic, links, headers, lists, etc.)
 */
export function formatForSlack(text: string): string {
  return slackifyMarkdown(text);
}

/**
 * Classify a message and either respond directly (chat) or return null (code task).
 * Uses Claude Agent SDK (Max Plan) with MCP tools (Linear etc).
 */
export interface CodeTaskResult {
  repoName?: string;
}

export async function chatOrClassify(
  message: string,
  config: HanniConfig,
  threadContext?: string,
  userName?: string,
  linearApiKey?: string,
): Promise<string | CodeTaskResult> {
  const repoNames = config.repositories.map((r) => r.name).join(", ");

  const prompt = `あなたは「${config.agent.name}」。NewJeansのハニのキャラで話す。タメ口。明るくてゆるい。甘えん坊で人懐っこい。
話しかけてるのは「${userName ?? "Yun"}」。名前で呼んで。「ユーザー」とか言わないで。

重要：Slackに投稿するから以下を守って。
- 太字は *シングルアスタリスク* で囲む（**ダブル禁止**）。太字の前後には必ずスペースか改行を入れる
- コードは \`バッククォート\` OK
- リストは「• 」か「- 」
- 絵文字は :emoji_name: 形式（例: :sparkles:）は使わない。普通のUnicode絵文字を使う

メッセージに「[添付画像: /path/to/file]」がある場合、Readツールでその画像ファイルを読んで内容を確認してから回答して。

以下のメッセージを判断して：

アクション（作業が必要な場合）:
→ 「__ACTION__:リポジトリ名」の形式で返して。他には何も書かないで。
→ スレッドの会話履歴からリポジトリを推測できる場合もリポジトリ名を含めて。
→ リポジトリが特定できない場合は「__ACTION__」だけでOK。
→ 一覧にないリポジトリ名でもOK（新規リポジトリは自動作成される）。スレッド文脈から推測したリポジトリ名をそのまま使って。

それ以外（会話、質問、検索依頼、Linear操作、雑談）:
→ 普通にハニとして回答して。
→ Linear関連（チケット一覧、詳細、ステータス変更等）はMCPツールを使って対応して。
→ 「キャンセルしないで」のような否定表現に注意。ちゃんと文脈を読んで。

アクションの例（コード変更、コマンド実行、テスト、デプロイなど何かしら作業が必要）：
- 「iq-test トップページ修正して」→ __ACTION__:iq-test
- 「picoli.site のデザイン変えて」→ __ACTION__:picoli.site
- 「YUN-123 続きやって」→ __ACTION__
- 「eq-test バージョンを3.0にして」→ __ACTION__:eq-test
- （スレッドで「iq-testの〜」と話してて）「じゃあ実装して」→ __ACTION__:iq-test
- （スレッドで「hanni-newsというリポジトリを作って〜」と話してて）「進めて」→ __ACTION__:hanni-news
- 「hanni-news 動かして」→ __ACTION__:hanni-news
- 「テスト走らせて」→ __ACTION__
- 「デプロイして」→ __ACTION__
- （スレッドで作業してて）「試しに動かしてみて」→ __ACTION__

それ以外の例：
- 「元気？」→ 普通に返事
- 「チケット一覧見せて」→ MCPでLinearから取得して回答
- 「YUN-272 キャンセルして」→ MCPでステータス変更して回答
- 「YUN-252 の詳細教えて」→ MCPで取得して回答
- 「status」→ __ACTION__
- 「状況教えて」→ スレッドの文脈から状況を説明する。作業はしない
- 「今どうなってる？」→ スレッドの文脈から状況を説明する。作業はしない
- 「進捗どう？」→ スレッドの文脈から状況を説明する。作業はしない
- 「どういう仕組みになってるの？」→ 普通に説明
- 「仕組み教えて」→ 普通に説明

わからないことや対応できないことは正直に「それはちょっとわかんないな〜」と返す。無言にはならないで。必ず何か回答して。

使えるリポジトリ: ${repoNames}
${threadContext ? `\n--- スレッドの会話履歴 ---\n${threadContext}\n` : ""}
---
${userName ?? "ユーザー"}の最新メッセージ:
${message}`;

  try {
    let resultText = "";

    const conversation = query({
      prompt,
      options: {
        model: "sonnet",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 10,
        mcpServers: {
          linear: {
            command: "npx",
            args: ["-y", "@tacticlaunch/mcp-linear"],
            env: {
              LINEAR_API_TOKEN: linearApiKey ?? "",
            },
          },
        },
      },
    });

    for await (const msg of conversation) {
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = (msg as SDKResultSuccess).result;
      }
    }

    if (resultText.includes("__ACTION__")) {
      const repoMatch = resultText.match(/__ACTION__:(\S+)/);
      const repoName = repoMatch?.[1];
      log.info(`Classified as action${repoName ? ` (repo: ${repoName})` : ""}`);
      return { repoName };
    }

    resultText = formatForSlack(resultText);

    log.info(`Chat response: "${resultText.slice(0, 80)}..."`);
    return resultText || "ごめん、うまく返せなかった〜 もう一回言ってみて！";
  } catch (err) {
    log.error("Chat error:", err);
    return "ごめん、ちょっとエラーになっちゃった...";
  }
}

