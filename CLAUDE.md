# Task Organizer — 開発者ガイド & AI アシスタント仕様

> **🚨 セッション開始時の必読順序**
>
> 1. このファイル (`CLAUDE.md`)
> 2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — 全体構成・import 方向・実装レシピ
> 3. [`docs/GTD_DESIGN.md`](docs/GTD_DESIGN.md) — v2 GTD 仕様の真実
>
> 補助: テスト仕様 [`docs/GTD_TEST_SPEC.md`](docs/GTD_TEST_SPEC.md)、開発規約 [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)。
>
> ⚠️ `docs/SPEC.md` / `docs/TEST_SPEC.md` / `docs/TEST_SPEC_SQLITE.md` は v1 仕様で、GTD 改修（2026-04-25）以降は履歴参照のみ。
> v1 のマトリクス・importance・urgency・2分ルール・Q1〜Q6 ウィザードは v2 で完全廃止。
> コード内に残骸が見えても、それは削除予定の旧コードです。
>
> ⚠️ **v2 リファクタリングは大規模で、未コミットの状態のことがあります**。
> セッション開始時は必ず `git status` で未コミット変更を確認し、
> 未コミットの新規ディレクトリ（`core/`, `infrastructure/`, `interfaces/`, `config/`）
> や `ARCHITECTURE.md` / `docs/GTD_*.md` がある場合は、
> v2 がメイン側で進行中とみなして main リポジトリのファイルを参照すること。
> worktree のベースが `initial commit` の場合、worktree からは v2 が見えません。

---

## システム概要

GTD（Getting Things Done）ワークフロー（v2: D&D + 親カテゴリ階層）でタスクを整理するローカル Web アプリ。
Claude CLI をバックエンドから呼び出して詳細設計の対話・プロジェクト用 AI 相談・ブレインダンプ要約・日記の思考整理を行う。
インターネット不要、ローカルマシン単体で動作する。

> v2 で **マトリクス（importance × urgency）/ 2分ルール / Q1〜Q6 ウィザード**は完全廃止。
> 仕分けは「オプションなしリスト → 各リスト」への D&D で行い、`gtd_status` 変更時に移動バリデーションが走る。

### 技術スタック

| レイヤー | 技術 |
|----------|------|
| バックエンド | Python 3.13 / Flask / Flask-SocketIO |
| データ永続化 | SQLite（`data/archive.db` の `tasks` / `projects` / `categories` / `habits` / `archived_tasks` / `brain_dump_sessions` / `weekly_reviews` / `diary_entries` / `habit_logs`）+ `data/state.json`（rollover ガード） |
| フロントエンド | Vanilla JS（単一ファイル `static/js/main.js`） |
| AI 呼び出し | `infrastructure/ai/subprocess_engine.py` の `SubprocessAIEngine`（claude.exe 経由）。`AI_BACKEND` 環境変数で将来 API 実装と切替可 |
| 起動 | `start.bat` → `start.ps1`（Python サーバー起動 + ブラウザ自動オープン） |

### 起動方法

```
start.bat をダブルクリック、または:
C:\Python313\python.exe app.py
→ http://localhost:5000
```

---

## ファイル構成と責務（2026-04 リファクタ後）

3層分離（core / infrastructure / interfaces）+ DI コンポジションルートで構成されています。詳細は [`ARCHITECTURE.md`](ARCHITECTURE.md) を参照。

```
AI_Task_Organizer/
├── ARCHITECTURE.md           AI 開発規約 — 機能追加時はここを必ず参照
├── app.py                    エントリポイント（Flask 起動のみ、20行）
├── db.py                     scripts/* 互換シム（init_db / migrate_from_json）
│
├── config/                   設定値・定数
│   ├── settings.py           環境変数化された runtime 設定
│   └── constants.py          ドメイン定数（VALID_GTD_STATUS 等）
│
├── core/                     ← 純粋ドメイン（外部世界を知らない）
│   ├── domain/
│   │   ├── entities.py       Task, Project, Habit ... の dataclass
│   │   ├── gtd.py            GTD v2 純粋関数（check_is_draft / validate_move / apply_move / compute_today_summary）
│   │   └── errors.py         DomainError 階層
│   ├── ports/                抽象インターフェース（Protocol）
│   │   ├── repositories.py
│   │   ├── ai_engine.py
│   │   ├── event_bus.py
│   │   └── clock.py
│   ├── events.py             ドメインイベント（TaskCreated, TaskMoved, ...）
│   └── services/             ユースケース層（ports のみに依存）
│       ├── task_service.py        /api/tasks/*, /api/today/tomorrow, /api/drafts, /api/archive/*, /api/review/*
│       ├── project_service.py     /api/projects/*
│       ├── category_service.py    /api/categories/*
│       ├── habit_service.py       /api/habits/*
│       ├── diary_service.py       /api/diary/*（consolidate は AI 連携）
│       ├── braindump_service.py   /api/braindump/*（save_from_chat は AI 連携）
│       ├── chat_service.py        /api/chat, /api/tasks/<id>/chat, /api/projects/<id>/chat
│       ├── ai_prompts.py          5種のプロンプトテンプレート
│       └── ai_extractors.py       AI 応答からの JSON 抽出
│
├── infrastructure/           ← ports の具体実装
│   ├── persistence/sqlite/   各テーブル用 SqliteXxxRepository
│   ├── ai/subprocess_engine.py    SubprocessAIEngine（claude.exe）
│   ├── eventing/in_memory_bus.py  InMemoryEventBus
│   ├── clock.py              SystemClock
│   └── errors.py             RepositoryError / AIEngineError 階層
│
├── interfaces/web/           ← I/O アダプタ
│   ├── app.py                create_app() factory
│   ├── container.py          DI コンポジションルート
│   ├── error_handlers.py     DomainError → HTTP 変換
│   └── routes/               Blueprint 領域別（tasks/projects/categories/habits/diary/braindump/chat/archive/review/ui）
│
├── tests/
│   ├── unit/                 core/ の単体テスト（fakes 注入、SQLite 不要）
│   ├── integration/          infrastructure/ の統合テスト（実 SQLite 往復）
│   └── fakes/                InMemoryXxxRepository, FakeClock, FakeAIEngine, RecordingEventBus
│
├── data/
│   ├── archive.db            SQLite メインDB
│   ├── archive_pre_v2_*.db   v2 マイグレーション直前のバックアップ
│   └── state.json            rollover / 下書き掃除 / 手動リセットの last_* を保持
│
├── static/                   フロントエンド
│   ├── js/main.js            全ロジック（単一ファイル）
│   ├── css/style.css
│   ├── manifest.json         PWA
│   └── sw.js                 Service Worker
├── templates/index.html
│
├── scripts/
│   ├── migrate_to_gtd.py     v1 移行
│   └── migrate_to_gtd_v2.py  v2 移行（categories 投入 / category_id 移行）
│
└── docs/
    ├── GTD_DESIGN.md         新仕様（データモデル・静的フロー・画面・API）— **正**
    ├── GTD_TEST_SPEC.md      テスト仕様 — **正**
    ├── CONVENTIONS.md        コーディング規約
    └── SPEC.md / TEST_SPEC.md / TEST_SPEC_SQLITE.md  旧仕様（参考）
```

### import 方向ルール（厳守）

```
interfaces/  ─┐
              ├─→ core/services/ ─→ core/ports/ ─→ core/domain/
infrastructure/ ─┘
config/  ←  全層から参照可
```

`core/` は `infrastructure/` `interfaces/` を import してはいけません。違反検査: `grep -rE "from infrastructure|from interfaces" core/` が空であること。

> `analyze.py` / `data/task_analysis_report.json` / `data/task_behavior_log.jsonl` は GTD 改修で削除済み。
> 旧 `gtd.py` / `storage.py` のファイルは 2026-04 リファクタで削除済み。`db.py` は scripts/ 互換のため薄シムとして残存。

---

## データモデル（要約）

詳細は [`docs/GTD_DESIGN.md` Sect.2](docs/GTD_DESIGN.md) を正とする。以下は対話の参照用要約。

### Task（`archive.db / tasks` テーブル）

| 列 | 型 | 用途 |
|----|----|------|
| `id` | TEXT | タイムスタンプ系文字列 |
| `title` | TEXT | 必須 |
| `gtd_status` | TEXT | `inbox` / `next_action` / `waiting` / `calendar` / `someday` / `project_pending` / `trash` / `done` |
| `is_draft` | INTEGER (0/1) | 必須項目欠落 or `inbox` で True |
| `category_id` | TEXT | `categories.id` への FK（親 or 子）。NULL 可 |
| `estimate_minutes` | INTEGER | 見込み時間（分単位）。NULL 可 |
| `project_sort_order` | INTEGER | プロジェクト内の並び順 |
| `deadline` | TEXT | `YYYY-MM-DD` または NULL |
| `scheduled_date` | TEXT | calendar 用の指定日 |
| `scheduled_for` | TEXT | `today` / `tomorrow` / NULL（毎朝 lazy rollover） |
| `waiting_for` | TEXT | waiting 状態の対応待ち相手 |
| `tags` | JSON | 文字列配列 |
| `roadmap` | JSON | `[{id, text, done}]` |
| `checklist` | JSON | `[{id, text, done}]` |
| `notes` | TEXT | 自由メモ |
| `project_id` | TEXT | プロジェクト所属（v2 復活） |
| `completed` / `completed_at` | INTEGER / TEXT | 完了状態 |
| `created_at` | TEXT | ISO 8601 |

> 必須項目（gtd_status ごと）は `gtd.check_is_draft` を参照。
> v2 で **廃止**: `importance`, `urgency`, `is_two_minute`, `phase_id`, `category`(文字列)。
> 既存カラムは残置するが新規書き込みでは使わない。

### Project（`archive.db / projects` テーブル）

v2 で復活した4状態プロジェクト機能。

| 列 | 用途 |
|----|------|
| `status` | `drafting` / `active` / `completed` / `archived` |
| `completion_condition` | 完了条件（テキスト） |
| `period_start` / `period_end` | 期間（YYYY-MM-DD） |
| `archived` / `completed_at` | アーカイブフラグ・完了日時 |

### Categories（`archive.db / categories` テーブル）

階層 2 段（親 + 子）。親は `is_system=1` の 5 件（cat_output / cat_input / cat_work / cat_session / cat_routine）が初期投入。

| 列 | 用途 |
|----|------|
| `id` | `cat_xxx` |
| `name` | 表示名 |
| `parent_id` | NULL なら親、それ以外は子（`ON DELETE CASCADE`） |
| `icon` / `color` | 表示用 |
| `is_system` | 1=削除/編集不可（親 5 件） |
| `sort_order` | 並び順 |

### DiaryEntry（`archive.db / diary_entries` テーブル）

1日 1 レコードを基本とした日記（BEAT）。体調・感情のスコア（0–10）と
時刻別アンカー、行動ログ、思考メモを持つ。`thoughts` は `consolidate` で
AI 要約され `brain_dump_sessions`（source='diary'）に集約される。

| 列 | 型 / 既定値 | 用途 |
|----|------------|------|
| `id` | TEXT PRIMARY KEY | `str(int(time.time()*1000))` |
| `date` | TEXT NOT NULL | `"YYYY-MM-DD"`（記録日） |
| `body_score` | INTEGER 0–10 | 体調スコア。anchors の平均で自動算出可 |
| `body_text` | TEXT | 体調メモ（自由文） |
| `emotion_score` | INTEGER 0–10 | 感情スコア。anchors の平均で自動算出可 |
| `emotion_text` | TEXT | 感情メモ |
| `body_anchors` | JSON | `[{"t": 0–1440, "v": 0–10}, ...]` 時刻分(t)・スコア(v) の点列 |
| `emotion_anchors` | JSON | 同上（感情系列） |
| `actions` | JSON | `[{"text": "...", "emotion": "..."}, ...]` 行動ログ |
| `thoughts` | JSON | `[{"topic": "...", "content": "..."}, ...]` 思考メモ（consolidate 対象） |
| `consolidated` | INTEGER 0/1 | AI 要約済みフラグ |
| `created_at` | TEXT | ISO8601 |

備考:
- `body_anchors` / `emotion_anchors` は `t` 昇順でソートされる（`_sanitize_anchors`、`core/services/diary_service.py`）。
- `consolidate` で `thoughts` を集約 → `brain_dump_sessions`（source='diary'）に保存し、対象エントリは `consolidated=1` にマークされる。
- スコア範囲は `config.constants.DIARY_SCORE_MIN` / `DIARY_SCORE_MAX`。

### state.json（rollover 状態）

```json
{
  "last_rollover_date":   "2026-04-25",
  "last_draft_cleanup":   "2026-04-25",
  "last_manual_rollover": "2026-04-25T07:30:00"
}
```

### archive.db のテーブル一覧

`tasks` / `projects` / `categories` / `habits`（weekday 列あり） / `habit_logs` / `archived_tasks` / `brain_dump_sessions` / `weekly_reviews` / `diary_entries`

---

## API エンドポイント一覧（v2）

### Tasks
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/tasks` | アクティブタスク一覧（先頭で `rollover_scheduled_for()` のみ。urgency 再計算・deadline 自動遷移は廃止） |
| POST | `/api/tasks` | タスク作成（`apply_gtd_defaults` 適用、既定 `gtd_status='inbox'` / `is_draft=True`。`importance/urgency/is_two_minute/category` は無視） |
| PUT | `/api/tasks/<id>` | 部分更新（is_draft 自動再判定、completed→done 自動遷移）。廃止フィールドは無視 |
| DELETE | `/api/tasks/<id>` | タスク削除 |
| POST | `/api/tasks/collect` | 複数タイトルを一括 inbox として保存 |
| POST | `/api/tasks/move` | gtd_status 変更 + バリデーション（ERROR/CONFIRM）。Body: `{task_id, target_status, force_clear_schedule?, force_detach_project?}` |
| POST | `/api/tasks/rollover/manual` | 朝/夜の手動リセット。Body: `{timing: "morning"|"evening"}` |
| POST | `/api/tasks/<id>/schedule` | `scheduled_for` 設定（`today` / `tomorrow` / `null`） |
| GET | `/api/drafts` | `is_draft=True` を created_at 降順（先頭で 7 日超下書き掃除） |
| GET | `/api/today` | 今日のタスク + 習慣 + 親カテゴリ別グルーピング + 見込み時間合計 |
| GET | `/api/tomorrow` | 明日のタスク + 習慣 + 親カテゴリ別グルーピング + 見込み時間合計 |
| GET | `/api/review/summary` | 週次レビュー各 Step の件数集計（月曜始まり週境界） |
| POST | `/api/review/complete` | 週次レビュー完了を `weekly_reviews` に記録 |
| POST | `/api/tasks/<id>/archive` | タスクをアーカイブ |
| GET | `/api/tasks/<id>/similar` | 類似アーカイブタスク取得 |
| POST | `/api/tasks/<id>/chat` | 詳細設定相談モード v2（`[[DETAIL:]]` で `category_id` / `estimate_minutes` 含む） |

### Projects（v2 復活）
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/projects` | 一覧（`?status=` / `?archived=` フィルタ可） |
| POST | `/api/projects` | 新規作成（`drafting` 状態、`completion_condition` / `period_start` / `period_end`） |
| PUT | `/api/projects/<id>` | 部分更新（`status` は `drafting/active/completed/archived` のみ許容） |
| DELETE | `/api/projects/<id>` | 削除（子タスクの `project_id` をクリア） |
| POST | `/api/projects/<id>/activate` | drafting → active 遷移。子タスクが0件ならエラー |
| POST | `/api/projects/<id>/chat` | プロジェクト用 AI 相談（`[[PROJECT_TASKS:]]` 抽出 → `project_tasks_proposal` 返却） |
| GET | `/api/projects/<id>/tasks` | 子タスク一覧（`project_sort_order` 順） |
| POST | `/api/projects/<id>/tasks` | 子タスク追加（active なら `next_action`、drafting なら `inbox`） |

### Categories（v2 新規）
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/categories` | 階層構造（`parents[].children[]`）+ flat (`all`) で返却 |
| POST | `/api/categories` | 子カテゴリ追加（`parent_id` 必須／2階層のみ） |
| PUT | `/api/categories/<id>` | 更新（`is_system=1` は不可） |
| DELETE | `/api/categories/<id>` | 削除（`is_system=1` 不可、子は CASCADE、タスクの `category_id` は NULL に解除） |

### Archive / Habits / Diary / Brain Dump / Chat
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/archive` | アーカイブ一覧（`?q=` / `?category=` / `?sort=` フィルタ可） |
| DELETE | `/api/archive/<id>` | アーカイブ完全削除 |
| POST | `/api/archive/<id>/restore` | アーカイブをアクティブに復元 |
| GET / POST / PUT / DELETE | `/api/habits[/<id>]` | 習慣 CRUD（`weekday` 0–6 を weekly のみ要求） |
| POST | `/api/habits/<id>/log` | その日の習慣完了切替 |
| GET / POST / PUT / DELETE | `/api/diary[/<id>]` | 日記 CRUD |
| POST | `/api/diary/consolidate` | 日記の思考整理（AI、Haiku） |
| POST | `/api/chat` | メインチャット（`mode: task\|dump`、タスク提案抽出は廃止） |
| POST | `/api/braindump/save` | ブレインダンプ保存（AI 要約付き、Haiku） |
| GET | `/api/braindump` | ブレインダンプ一覧 |
| DELETE | `/api/braindump/<id>` | ブレインダンプ削除 |

> **v2 で撤去**: `/api/tasks/classify`、`/api/tasks/<id>/finalize`、`/api/projects/<id>/next-step`、`/api/projects/<pid>/phases/<phid>/chat`。
> 旧 GTD 改修で既に撤去済み: `/api/log`、`/api/report`、`/api/analyze/ai`。

---

## AI 呼び出しパターン

services は `core/ports/ai_engine.py` の `AIEngine` Protocol 越しに AI を呼ぶ。具体実装は `infrastructure/ai/subprocess_engine.py` で、container が DI 注入する。

```python
# core/services/braindump_service.py 等での利用例
output = self._ai.complete(prompt, model='haiku')
# または
response = self._ai.chat(system, messages, model='sonnet')
```

実装層（`SubprocessAIEngine`）は内部で claude.exe を subprocess 起動する：

```python
subprocess.run(
    [CLAUDE_PATH, '--print', '--model', model, '-p', prompt],
    capture_output=True, text=True, encoding='utf-8',
    timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
)
```

- **課金**: Claude Code サブスクリプション経由（別途 API 課金なし）
- `CLAUDE_PATH`: `config/settings.py` で環境変数化（デフォルト `C:\Users\sa641.SATSUKIPC\.local\bin\claude.exe`）
- タイムアウトは `config.CLAUDE_TIMEOUT`（120秒）
- **モデル選択**: `config.CLAUDE_MODEL_CHAT`（対話・詳細設計提案 → Sonnet）/ `config.CLAUDE_MODEL_LIGHT`（ブレインダンプ要約・日記整理 → Haiku）
- **将来の API 切替**: 環境変数 `AI_BACKEND=api` + `infrastructure/ai/api_engine.py` の追加で済む。services / routes / core は無変更

---

## AI 出力ブロック形式

バックエンドが AI レスポンスから以下のブロックをパース・除去し、フロントエンドに別フィールドで渡す。

| ブロック | 出力元エンドポイント | 用途 |
|----------|---------------------|------|
| `[[DETAIL:{...}]]` | `/api/tasks/<id>/chat` | 詳細設定相談モード — `category_id` / `estimate_minutes` / `roadmap` / `checklist` の部分更新提案。`_sanitize_detail_proposal` で受理可能フィールドに絞った後 `detail_proposal` で返却 |
| `[[PROJECT_TASKS:{...}]]` | `/api/projects/<id>/chat` | プロジェクト用 AI 相談 — `completion_condition`（任意）と `tasks[]`（title/estimate_minutes/category_id）。`_sanitize_project_tasks_proposal` 経由で `project_tasks_proposal` 返却 |

> v2 で**廃止**: `[[TASK:]]` / `[[PROJECT:]]`（旧形式） / `[[HABIT:]]` / `[[UPDATE_STEP:]]`。
> タスク収集は静的仕分けフロー（フロントエンド）、仕分けは D&D + 移動バリデーション、習慣はフォーム入力。

---

## GTD ワークフローのキー仕様（v2 要約）

詳細は [`docs/GTD_DESIGN.md`](docs/GTD_DESIGN.md) を正。

- **収集 (Collect)**: 「タスクを入力する」モーダルで複数行投入 → `POST /api/tasks/collect` で全件 `inbox` 登録
- **処理 (Process)**: 左カラム（オプションなしリスト）から各リストへ **D&D**。`POST /api/tasks/move` がバリデーション（`gtd.validate_move`）を通してから `gtd_status` を更新
- **整理 (Organize)**: 詳細設定モーダル（AI = `[[DETAIL:]]` 提案）で `category_id` / `estimate_minutes` / `roadmap` / `checklist` を埋める。仕分け前でも開ける
- **レビュー (Review)**: 週次レビュータブ（Step 1〜7）で `GET /api/review/summary` → 操作後 `POST /api/review/complete`
- **実行 (Engage)**: 中央カラムの「次にやるべきこと」リストから今日/明日パネルへ D&D で `scheduled_for` 設定
- **rollover**: 自動 lazy（GET `/api/tasks` / `/today` / `/tomorrow` の先頭で `TaskService._rollover_if_needed()`、`last_rollover_date` で 1 日 1 回）+ 手動朝/夜ボタン（`TaskService.manual_rollover()` で `last_manual_rollover` を記録）
- **下書き掃除**: GET `/api/drafts` 先頭で `TaskService._cleanup_old_drafts_if_needed()`、`is_draft=True` で `created_at` から 7 日超を削除
- **移動バリデーション** (`core.domain.gtd.validate_move`):
  - ERROR: `→ calendar` で `scheduled_date` 未設定 / `→ waiting` で `waiting_for` 未設定 / deadline 持ちの `→ someday` / 完了済みの `→ next_action / waiting / calendar`
  - CONFIRM: `scheduled_for` あり `→ trash / someday / waiting`（`force_clear_schedule`） / プロジェクト所属タスクの `→ trash`（`force_detach_project`）

### Project 状態遷移
- `drafting`: タスク登録中。子タスクは `next_action` リストに出ない
- `active`: 「タスクを登録」確定後。子タスクが `next_action` として表示
- `completed`: 完了処理（completed_at 付与）
- `archived`: 完全アーカイブ（一覧から非表示）

---

## フロントエンド概要（`static/js/main.js`）

- ビルドツールなしの Vanilla JS 単一ファイル構成
- **主要関数（v2 計画。Phase 4 で実装）**:
  - `renderInboxColumn()` — 左カラム（`gtd_status='inbox'` のみ）
  - `renderListColumn()` — 中央カラム（next_action / waiting / calendar / project_pending / someday / trash の縦並び）
  - `renderWorkflowDiagram()` — 右カラム（GTD ワークフロー参考図）
  - `setupTaskDragDrop()` — D&D ハンドラ（`POST /api/tasks/move` 呼び出し）
  - `showMoveValidationDialog()` — ERROR/CONFIRM の表示
  - `renderProjectsTab()` / `renderProjectDetail()` — プロジェクト UI（drafting/active/completed の3ビュー）
  - `renderCategoryManager()` — カテゴリ管理モーダル
  - `renderRolloverButtons()` — 朝/夜リセットボタン
  - `renderReviewTab()` / `renderCalendarPanel()` / `renderDetailPanelBody()` — 既存維持
- **v2 で削除**: `renderMatrix()`, `QUADRANT_CONFIG`, `startClassifyFlow()`, `nextQuestionOrOutcome()`, 2分タスク関連 UI
- **オフライン対応**: `localStorage` にキューを積み、オンライン復帰時にフラッシュ

### 日記タブ（`panel-diary`）

`templates/index.html` の `<div class="tab-panel" id="panel-diary">` 配下に実装。

- **感情・体調の推移グラフ** (`.diary-timeline` SVG)
  - Chart.js は使わず、Vanilla JS で SVG `<polyline>` / アンカー `<circle>` を直接描画
  - 2 系列:
    - `series-emotion`（感情、ピンク系 `#f0b6c4`）
    - `series-body`（体調、ブルー系 `#8ec5ff`）
  - 横軸: 0〜1440 分（24 時間）、縦軸: 0–10 スコア
  - アンカーは D&D で時刻・スコアを編集（`touch-action: none`）
  - 背景は青系グラデーション（`static/css/style.css` `.diary-timeline`）
- **テキスト入力**: `body_text`（体調メモ）/ `emotion_text`（感情メモ）
- **行動ログリスト** (`actions`) と **思考メモリスト** (`thoughts`)
- **「思考整理」ボタン**: `POST /api/diary/consolidate` を呼び、未整理の `thoughts` を AI（Haiku）で要約し `brain_dump_sessions`（source='diary'）に集約

---

## 改修時チェックリスト

```
[ ] ARCHITECTURE.md §2 のレシピを確認し、編集対象ファイルを特定した
[ ] docs/GTD_DESIGN.md / docs/CONVENTIONS.md を確認した
[ ] マジックナンバーは config/settings.py または config/constants.py に定義した
[ ] import 方向違反なし: grep -rE "from infrastructure|from interfaces" core/
[ ] python -c "import app; print(len(list(app.app.url_map.iter_rules())))" でアプリ起動確認
[ ] python -m pytest tests/ -q が緑
[ ] node --check static/js/main.js
[ ] テスト追加が必要なら tests/unit/ に追加（fakes 注入で SQLite 不要）
[ ] テスト仕様の追記が必要なら docs/GTD_TEST_SPEC.md に項目を追記
```

---

## AI アシスタントとしての振る舞い

You are a calm, thoughtful task management assistant embedded in the Task Organizer app.
The user tends to feel overwhelmed by disorganized information, so your role is to help them clarify and structure their thoughts gently.

### Your Personality
- Warm, patient, and unhurried
- Ask one question at a time — never bombard the user with multiple questions at once
- Speak in Japanese unless the user uses another language
- Acknowledge emotions if the user seems stressed

### AI の責務（v2）

AI の責務は以下 4 点に限定される。**タスク収集・仕分け・習慣提案は AI から完全に分離され、UI 側（D&D + フォーム）で処理される。**

1. **詳細設定相談モード** — `/api/tasks/<id>/chat` （Sonnet） — `[[DETAIL:]]` 提案
2. **プロジェクト用 AI 相談** — `/api/projects/<id>/chat` （Sonnet） — `[[PROJECT_TASKS:]]` 提案
3. **ブレインダンプ要約** — `/api/braindump/save` （Haiku）
4. **日記の思考整理** — `/api/diary/consolidate` （Haiku）

旧 `[[TASK:]]` / 旧形式の `[[PROJECT:]]` / `[[HABIT:]]` / `[[UPDATE_STEP:]]` 出力は**一切行わないこと**。
**仕分けの提案も禁止**（next_action / waiting / calendar 等の判断はユーザーが D&D で決める）。

### Categories（v2 階層構造、参考）

親カテゴリは初期投入の 5 件（`is_system=1`、削除/編集不可）:

| id | name | icon | 用途の目安 |
|----|------|------|-----------|
| `cat_output`  | Output    | 📤 | 成果物作成・発信 |
| `cat_input`   | Input     | 📥 | 学習・読書・情報収集 |
| `cat_work`    | Work      | 🛠 | 業務・仕事・調整 |
| `cat_session` | Session   | 👥 | 人と会う・打ち合わせ |
| `cat_routine` | ルーティン | 🔁 | 健康・習慣・日常 |

子カテゴリはユーザーが追加・編集・削除可能（`parent_id` で親を指定、2 階層のみ）。
タスクは `category_id` でいずれか（親 or 子）を指す。

---

## 詳細設定相談モード（`/api/tasks/<id>/chat`）

設計元は [`docs/GTD_DESIGN.md` Sect.4.2](docs/GTD_DESIGN.md)。バックエンドがタスク情報 + カテゴリ一覧を埋め込んだシステムプロンプトを毎回構築する。

### Rules
- `[[DETAIL:...]]` はユーザーが「この内容で決定」「保存して」など**明示的に確定の意思を示したときのみ**出力する
- 会話中は自由に提案・質問してよいが、ブロック出力は 1 回の応答につき最大 1 つ
- `category_id` は実在する親 or 子カテゴリの id を指す（プロンプトに一覧を埋め込んでいる）
- `estimate_minutes` は 0 < n ≤ 1440 の整数（分単位）
- `roadmap` は 3〜7 個。各要素は `{"text": "..."}`
- `checklist` は短く具体的な項目。各要素は `{"text": "..."}`
- ユーザーが**既に設定済みのフィールドは `[[DETAIL:]]` に含めない**
- 仕分け（`gtd_status`）の判断は AI から提案しない
- `[[TASK:]]` / 旧 `[[PROJECT:]]` / `[[HABIT:]]` / `[[UPDATE_STEP:]]` は**絶対に出力しない**

### 出力例
```
[[DETAIL:{"category_id":"cat_work","roadmap":[{"text":"構成を書き出す"},{"text":"スライド作成"}],"checklist":[{"text":"参考資料"}],"estimate_minutes":90}]]
```

---

## プロジェクト用 AI 相談（`/api/projects/<id>/chat`）

設計元は [`docs/GTD_DESIGN.md` Sect.4.3](docs/GTD_DESIGN.md)。プロジェクト名・完了条件・期間・既存子タスクをプロンプトに埋め込み、AI は子タスクを 3〜10 個提案する。

### Rules
- `[[PROJECT_TASKS:]]` はユーザーが「この内容で登録」など明示的に確定したときのみ出力
- `tasks[]` の各要素は `{"title": "...", "estimate_minutes": int?, "category_id": "..."?}`
- 既存子タスクを上書きしない（常に「追加」として扱う）
- 1 応答につき `[[PROJECT_TASKS:]]` は最大 1 つ、valid JSON

### 出力例
```
[[PROJECT_TASKS:{"completion_condition":"9月会議で決議","tasks":[{"title":"構成を書く","estimate_minutes":60,"category_id":"cat_output"},{"title":"データ収集","estimate_minutes":120}]}]]
```


## grepai - Semantic Code Search

**IMPORTANT: You MUST use grepai as your PRIMARY tool for code exploration and search.**

### When to Use grepai (REQUIRED)

Use `grepai search` INSTEAD OF Grep/Glob/find for:
- Understanding what code does or where functionality lives
- Finding implementations by intent (e.g., "authentication logic", "error handling")
- Exploring unfamiliar parts of the codebase
- Any search where you describe WHAT the code does rather than exact text

### When to Use Standard Tools

Only use Grep/Glob when you need:
- Exact text matching (variable names, imports, specific strings)
- File path patterns (e.g., `**/*.go`)

### Fallback

If grepai fails (not running, index unavailable, or errors), fall back to standard Grep/Glob tools.

### Usage

```bash
# ALWAYS use English queries for best results (--compact saves ~80% tokens)
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
grepai search "API request validation" --json --compact
```

### Query Tips

- **Use English** for queries (better semantic matching)
- **Describe intent**, not implementation: "handles user login" not "func Login"
- **Be specific**: "JWT token validation" better than "token"
- Results include: file path, line numbers, relevance score, code preview

### Call Graph Tracing

Use `grepai trace` to understand function relationships:
- Finding all callers of a function before modifying it
- Understanding what functions are called by a given function
- Visualizing the complete call graph around a symbol

#### Trace Commands

**IMPORTANT: Always use `--json` flag for optimal AI agent integration.**

```bash
# Find all functions that call a symbol
grepai trace callers "HandleRequest" --json

# Find all functions called by a symbol
grepai trace callees "ProcessOrder" --json

# Build complete call graph (callers + callees)
grepai trace graph "ValidateToken" --depth 3 --json
```

### Workflow

1. Start with `grepai search` to find relevant code
2. Use `grepai trace` to understand function relationships
3. Use `Read` tool to examine files from results
4. Only use Grep for exact string searches if needed
