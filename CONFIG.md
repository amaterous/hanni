# 設定ファイル管理ガイド

## デプロイの仕組み

```
ローカル infra/docker/ → tar → SCP → VM ~/github-runners/ → docker build → コンテナ起動
```

## 何を変えたいか → どこを編集するか

| 変更したい内容 | 編集すべきファイル | 備考 |
|---|---|---|
| Linear ステータス ID、ワークスペース設定など | `infra/docker/hanni-config.json` | デプロイ時に VM へ上書きされる。**これが正** |
| OAuth トークン類 | `infra/docker/hanni-tokens.json` | gitignore 済み。VM 上で直接更新も可 |
| ソースコード | `hanni/src/` | コミット → デプロイで反映 |
| プロンプト・挙動 | `hanni/src/session/orchestration-prompt.ts` | コミット → デプロイで反映 |

## 罠：変えても意味がないファイル

| ファイル | なぜ意味がないか |
|---|---|
| `hanni/config.json` | gitignore 済み・デプロイ bundle から除外される。直接デプロイには使われない |
| VM 上の `~/github-runners/hanni-config.json` | デプロイのたびにローカルの `infra/docker/hanni-config.json` で上書きされる |
| コンテナ内の `/opt/hanni/config.json` | VM 上の `hanni-config.json` の volume mount。VM 側を変えないと次のデプロイで消える |

## デプロイで保持されるもの（Docker volume）

| データ | volume 名 |
|---|---|
| clone 済みリポジトリ | `hanni-repos` |
| worktree | `hanni-worktrees` |
| ログ | `hanni-logs` |
| hanni の Claude 設定 (`~/.claude/`) | `hanni-claude` |

config.json と tokens.json は volume ではなく **bind mount**（`~/github-runners/hanni-config.json`）なので、デプロイで上書きされる点に注意。

## Linear ステータス ID（現在の設定）

| ワークスペース | ステータス | state ID |
|---|---|---|
| YunWorkspace | From Hanni ♡ | `ceb5b4fb-92ce-4c4f-9bee-c6c7dc8ee440` |
| SKY | From Hanni ♡ | `6112713d-21d2-4ab4-a78f-6b948bec7c30` |
