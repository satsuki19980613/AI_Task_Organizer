# AI Task Organizer — 開発規約

このファイルはコードの秩序を維持するための規約を定めます。
改修時は必ずこのファイルを参照し、記載の方針に従ってください。
仕様の正は [`docs/GTD_DESIGN.md`](GTD_DESIGN.md)、テスト仕様の正は [`docs/GTD_TEST_SPEC.md`](GTD_TEST_SPEC.md)。

---

## ディレクトリ構成

```
AI_Task_Organizer/
├── config.py          # 全定数・設定値（マジックナンバー禁止）
├── db.py              # SQLite 操作（スキーマ定義・型変換のみ）
├── storage.py         # 永続化 I/O（tasks は SQLite、state.json は JSON、CLAUDE.md は単純ファイル）
├── gtd.py             # GTD ワークフローのヘルパー（urgency 計算 / deadline migration / draft 判定 / rollover）
├── app.py             # Flask ルート定義（薄いコントローラー）
├── requirements.txt   # Python 依存パッケージ
├── start.bat          # Windows 起動スクリプト（start.ps1 を呼ぶ）
├── start.ps1          # Python プロセス管理・ブラウザ起動
├── CLAUDE.md          # AI アシスタント用プロンプト仕様 & 開発者ガイド
├── scripts/
│   └── migrate_to_gtd.py   # GTD 改修ワンタイム移行スクリプト（冪等）
├── data/              # 永続データ（全ファイルは .gitignore 推奨）
│   ├── archive.db          # SQLite — tasks / projects / habits / archived_tasks /
│   │                        brain_dump_sessions / weekly_reviews / diary_entries / habit_logs
│   ├── projects.json       # 凍結データ（UI 削除済み・履歴参照のみ）
│   └── state.json          # rollover / 下書き掃除の last_*_date を保持
├── docs/              # 設計ドキュメント
│   ├── GTD_DESIGN.md           # 新仕様（正）
│   ├── GTD_IMPLEMENTATION_PLAN.md
│   ├── GTD_TEST_SPEC.md        # テスト仕様（正）
│   ├── CONVENTIONS.md          # このファイル
│   ├── SPEC.md                 # 旧仕様（履歴参照）
│   ├── TEST_SPEC.md            # 旧テスト（履歴参照）
│   └── TEST_SPEC_SQLITE.md     # SQLite 移行時の旧テスト（履歴参照）
├── static/
│   ├── css/style.css
│   ├── js/main.js
│   ├── icons/icon.svg
│   ├── manifest.json
│   └── sw.js
└── templates/
    └── index.html
```

> `analyze.py` / `data/tasks.json` / `data/task_behavior_log.jsonl` / `data/task_analysis_report.json` は GTD 改修で削除済み。

---

## 責務の分離ルール

### config.py
- **役割**: 全マジックナンバー・定数の唯一の定義場所
- **禁止**: ビジネスロジック、I/O 処理
- **追加ルール**: 数値・文字列リテラルを他の .py ファイルに直接書かない。
  新しい設定値が必要になったら必ず config.py に定義してからインポートする。

### db.py
- **役割**: SQLite の接続・スキーマ管理・行変換（`init_db` / `row_to_task_full` / `migrate_from_json`）
- **禁止**: Flask ルート、ファイル I/O、ビジネスロジック
- **追加ルール**: テーブル追加・カラム追加は `init_db()` 内の migration パターン（`ALTER TABLE` を try/except で吸収、`CREATE TABLE IF NOT EXISTS`）に従う。

### storage.py
- **役割**: tasks の SQLite I/O、`state.json` の JSON I/O、`CLAUDE.md` の読み書き
- **禁止**: Flask ルート、ビジネスロジック（GTD ロジックは gtd.py へ）
- **追加ルール**: ファイルパスは config.py からインポートする。

### gtd.py
- **役割**: GTD ワークフローに紐づく純粋関数群（`calculate_urgency` / `check_deadline_migration` / `check_is_draft` / `apply_gtd_defaults` / `rollover_scheduled_for` / `cleanup_old_drafts`）
- **禁止**: Flask ルート、HTTP 処理、AI 呼び出し
- **追加ルール**: 副作用ありの関数は `state.json` を介して 1 日 1 回ガードを必ず入れる（rollover / cleanup と同パターン）。

### app.py
- **役割**: Flask ルート定義（エンドポイントのマッピングと HTTP レスポンス）
- **禁止**: ビジネスロジックの肥大化（GTD 計算は gtd.py、永続化は storage.py / db.py へ）
- **追加ルール**: 新しいエンドポイントを追加するときは `# ── XXX API ──` のセクション区切りに従う。

### scripts/migrate_to_gtd.py
- **役割**: GTD 改修時のデータ移行（バックアップ → archive 退避 → スキーマ初期化 → state.json 初期化）
- **禁止**: アプリ起動時の自動実行
- **追加ルール**: 冪等性を維持する（`INSERT OR IGNORE`、`DROP IF EXISTS`、`CREATE IF NOT EXISTS`、`ALTER` は try/except で吸収）。

---

## マジックナンバー・ハードコード禁止

以下の値を .py ファイルに直書きすることを**禁止**します。
必ず `config.py` に定義してからインポートしてください。

| 禁止例 | config.py 定数 |
|--------|----------------|
| `120` (タイムアウト秒) | `CLAUDE_TIMEOUT` |
| `20` (チャット履歴上限) | `CHAT_HISTORY_LIMIT` |
| `40` (ブレインダンプ履歴) | `DUMP_HISTORY_LIMIT` |
| `100` (エラー文字列切り捨て) | `ERROR_TEXT_LIMIT` |
| `5` (類似タスク件数) | `SIMILAR_TASKS_LIMIT` |
| `3` (urgency=high の deadline 日数) | `URGENCY_THRESHOLD_DAYS` |
| `1` (calendar 自動遷移閾値) | `CALENDAR_MIGRATION_DAYS` |
| `7` (下書き保持日数) | `DRAFT_RETENTION_DAYS` |
| `60` (日記要約に渡す最大件数) | `DIARY_CONSOLIDATE_LIMIT` |
| `{'work','health',...}` | `VALID_CATEGORIES` |
| `{'inbox','next_action',...}` | `VALID_GTD_STATUS` |
| Q1〜Q6 の質問文 | `CLASSIFY_QUESTIONS` |

---

## データファイル

- **場所**: すべて `data/` ディレクトリ以下
- **パス参照**: `config.py` の定数（`DB_FILE`, `STATE_FILE`, `PROJECTS_FILE` など）を使う
- **直接編集**: 開発・デバッグ目的での手動編集は許容するが、本番データのバックアップを推奨
- **.gitignore**: `data/` は機密データを含む可能性があるため gitignore を推奨

---

## フロントエンド (main.js)

- **現状**: `static/js/main.js` に全フロントエンドロジックが含まれる（単一ファイル構成、4000+ 行）
- **方針**: ビルドツール（webpack 等）なしで動作する構成を維持する。
  分割が必要になった場合は ES Modules + `<script type="module">` を検討する。
- **定数**: `CATEGORY_CONFIG`, `QUADRANT_CONFIG` はファイル先頭に定義済み。追加設定はここに加える。
- **スタイル**: CSS カスタムプロパティ（`var(--accent)` 等）を使い、カラーコードの直書きを避ける。
- **静的仕分けフロー**: Q1〜Q6 の分岐は `nextQuestionOrOutcome(answers)` という純関数として実装し、UI 側は描画のみに専念する（テスト容易性のため）。

---

## API 設計規約

### エンドポイント命名
```
GET    /api/{resource}              一覧取得
POST   /api/{resource}              新規作成
PUT    /api/{resource}/{id}         更新
DELETE /api/{resource}/{id}         削除
POST   /api/{resource}/{id}/{action} 特殊操作（archive / restore / classify / finalize / schedule など）
```

### レスポンス形式
- 成功: `jsonify(data)` + 適切なステータスコード（200/201）
- エラー: `jsonify({'error': 'message'}), 4xx`
- 操作成功: `jsonify({'ok': True})`
- バリデーション失敗（finalize 等）: `jsonify({'error': 'missing fields', 'missing': [...]}), 400`

### GTD 系エンドポイントの副作用ルール
- `GET /api/tasks` は「読み取り」と銘打つが、`rollover_scheduled_for()` / `check_deadline_migration()` / `calculate_urgency()` の差分があれば永続化する。冪等性は state.json と差分検査で担保。
- `GET /api/drafts` は先頭で `cleanup_old_drafts()` を実行する（同じく state.json でガード）。

---

## AI ブロック形式

AI (Claude) が出力する構造化データは以下の形式を使う。
フォーマットの追加・変更時は `CLAUDE.md` と `app.py` の両方を更新すること。

| ブロック | 用途 | パース場所 |
|----------|------|-----------|
| `[[DETAIL:{...}]]` | タスク詳細設計提案（category / roadmap / checklist の部分更新） | `task_chat` → `_sanitize_detail_proposal` → `detail_proposal` で返却 |

> 旧 `[[TASK:]]` / `[[PROJECT:]]` / `[[HABIT:]]` / `[[UPDATE_STEP:]]` は GTD 改修で**廃止**。フロントエンドの旧 proposal クリックハンドラ・`buildProposalHtml` 系・`FLOW_CONFIG` / `selectTaskType` / Milestone 関連も同時に削除済み。

---

## テスト

テスト仕様は [`docs/GTD_TEST_SPEC.md`](GTD_TEST_SPEC.md) を正とする。
機能追加時は対応するテストケースを GTD_TEST_SPEC.md に追記すること。

### 最低限確認すべきこと（改修後チェックリスト）
```
[ ] python -m py_compile config.py db.py storage.py gtd.py app.py
[ ] node --check static/js/main.js
[ ] GET  /api/tasks         → 200
[ ] POST /api/tasks         → 201（apply_gtd_defaults で必須フィールドが自動付与される）
[ ] GET  /api/drafts        → 200
[ ] GET  /api/today         → 200
[ ] GET  /api/review/summary → 200
[ ] GET  /api/archive       → 200
```

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-04-20 | 初版作成。責務分離リファクタリング（config/db/storage 分離、data/ ディレクトリ導入） |
| 2026-04-25 | GTD 改修に合わせて全面書き換え。analyze.py / tasks.json / behavior_log を削除、gtd.py / state.json / scripts/migrate_to_gtd.py / GTD 系定数群を追加。AI ブロックは `[[DETAIL:]]` のみに限定。 |
