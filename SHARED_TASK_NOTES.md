# Shared Task Notes

## Goal
`bun test` が全テストパスするユニットテスト環境を構築する。1ファイルずつ進める。

## 完了済み (275テスト、全パス)
- `src/utils/slugify.test.ts`, `src/webhook/signature.test.ts`, `src/slack/parser.test.ts`
- `src/routing/router.test.ts`, `src/slack/client.test.ts`, `src/utils/logger.test.ts`
- `src/linear/client.test.ts`, `src/session/prompts.test.ts`, `src/webhook/handler.test.ts`
- `src/slack/chat.test.ts`, `src/slack/handler.test.ts`, `src/linear/auth-flow.test.ts`
- `src/linear/oauth.test.ts`, `src/git/worktree.test.ts`, `src/git/repo-manager.test.ts`
- `src/post-session/pr-creator.test.ts` (11テスト)
- `src/session/orchestration-prompt.test.ts` (21テスト) — 純粋関数、外部依存なし
- `src/admin/api.test.ts` (18テスト) — fs mock + handleAsync ストリーム読み取り
- `src/session/manager.test.ts` (31テスト) — SessionManager の全メソッドをカバー
- `src/openai/oauth.test.ts` (27テスト) — createPkcePair/buildAuthUrl/isExpired/applyCodexDefaults + fetch mock
- `src/session/claude-runner.test.ts` (8テスト) — mock.module で `@anthropic-ai/claude-agent-sdk` をモック、async generator パターン

## 次の候補

1. **`src/openai/import-codex-auth.ts`** — `decodeJwtExp` / `findCodexAuthPath` が純粋関数として取り出せる。fs + env mock で実装可能
2. **`src/session/runner.ts`** — `runModelSession` は `runClaudeSession` の薄いラッパー。mock.module で claude-runner をモック
3. **`src/utils/screenshot.ts`** — playwright 依存。`mock.module("playwright", ...)` でモック可能

## 注意
- テスト設定不要。`bun test` はゼロコンフィグで動く
- `src/config.ts` はファイルシステム依存強いので後回し
- fetch は `spyOn(globalThis, "fetch")` を使う
- **fetch spy の呼び出し確認**: 同一 describe 内に複数テストがある場合、`calls[0]` は最初のテストの呼び出しを指すことがある。`calls[calls.length - 1]` を使うか、`fetchSpy.mockClear()` を `beforeEach` に入れること
- fs モジュールは `mock.module("fs", ...)` でモック可能（worktree.test.ts のパターン参照）
- **handleAsync パターン（admin/api.ts）**: Response は ReadableStream に包まれるため `res.text()` → `JSON.parse()` で読む。`readBody` ヘルパーが便利
- **Bun.spawn spy パターン（repo-manager.test.ts で確立）**:
  - `spyOn(Bun, "spawn").mockImplementation(() => makeSpawnResult(...) as any)`
  - スパイは**1回だけ**作成し、`mockRestore()` は呼ばない
  - `beforeEach` で `spawnSpy.mockClear()` + `spawnSpy.mockImplementation(...)` するだけでリセット可能
  - `makeSpawnResult(stdout, stderr, code)` は `new Response(stdout).body!` を使う
- **mock.module 汚染問題（manager.test.ts で発覚）**:
  - `mock.restore()` は spyOn を復元するが `mock.module` を復元しない（Bun の制限）
  - 他のテストファイルが同じモジュールをテストする場合（e.g. `./orchestration-prompt`）、そのモジュールを `mock.module` でモックしないこと
  - 代わりに実際の純粋関数を使うか、mock する必要がある場合は `afterAll(() => mock.restore())` を追加（spyOn のみ復元されるが一応入れる）
  - 実際の関数を使う場合は `__RESULT__` フォーマットの文字列を返すようにする
- **mock.module の二重呼び出し禁止（claude-runner.test.ts で発覚）**:
  - 同一テストファイル内で `mock.module` を2回呼ぶと、2回目以降は既存の import binding が上書きされ、他のテストが壊れる
  - 対策: `mock.module` は1回だけ。可変な `let mockImpl` 変数を使って `beforeEach` で差し替える
  - async generator を返す場合: `async function*` 関数を `mockImpl` に格納し、mock 内で `mockImpl()` を呼ぶ
