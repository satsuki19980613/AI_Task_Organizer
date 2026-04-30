# AI Task Organizer — 完全仕様書

> ⚠️ **このファイルは旧仕様（2026-04-22 時点）です。GTD 改修（2026-04-25）以降は履歴参照用。**
> 現行仕様の正は [`GTD_DESIGN.md`](GTD_DESIGN.md)、テスト仕様の正は [`GTD_TEST_SPEC.md`](GTD_TEST_SPEC.md)。
> 以下の内容は `analyze.py` / 行動ログ / `[[TASK:]]` / `[[PROJECT:]]` / `[[HABIT:]]` / `[[UPDATE_STEP:]]` / プロジェクト UI など、
> GTD 改修で廃止された機能を含む。コードを読む際の起点としては GTD_DESIGN.md を使うこと。

> 対象読者: AI アシスタント・開発者  
> 最終更新: 2026-04-22 (旧仕様書としての凍結日: 2026-04-25)

---

## 目次

1. [システム概要](#1-システム概要)
2. [ファイル構成と責務](#2-ファイル構成と責務)
3. [データ永続化](#3-データ永続化)
4. [データモデル](#4-データモデル)
5. [API エンドポイント仕様](#5-api-エンドポイント仕様)
6. [AI 呼び出し仕様](#6-ai-呼び出し仕様)
7. [フロントエンド仕様](#7-フロントエンド仕様)
8. [分析スコアリング](#8-分析スコアリング)
9. [Service Worker とキャッシュ](#9-service-worker-とキャッシュ)
10. [既知の実装上の注意点](#10-既知の実装上の注意点)
11. [改修時チェックリスト](#11-改修時チェックリスト)

---

## 1. システム概要

アイゼンハワーマトリクス（重要度×緊急度）でタスクを整理するローカル Web アプリ。  
Claude CLI をバックエンドから `subprocess.run` で呼び出し、AI 対話・タスク生成・分析コメントを行う。  
インターネット不要、ローカルマシン単体で動作する。

### 技術スタック

| レイヤー | 技術・詳細 |
|----------|-----------|
| バックエンド | Python 3.13 / Flask / Flask-SocketIO |
| データ永続化（アクティブ） | `data/tasks.json`（タスク）、`data/projects.json`（プロジェクト） |
| データ永続化（SQLite） | `data/archive.db`（アーカイブ・習慣・ブレインダンプ・行動ログ） |
| フロントエンド | Vanilla JS 単一ファイル `static/js/main.js` / Chart.js（CDN） |
| AI 呼び出し | `subprocess.run([claude.exe, '--print', '-p', prompt])` |
| 起動 | `start.bat` → `start.ps1` → Python サーバー + ブラウザ自動オープン |
| PWA | `static/sw.js`（Service Worker）、`static/manifest.json` |

### 起動方法

```
start.bat をダブルクリック、または:
C:\Python313\python.exe app.py
→ http://localhost:5000
```

---

## 2. ファイル構成と責務

```
AI_Task_Organizer/
├── config.py        全定数・パス・閾値（マジックナンバーはここだけ）
├── db.py            SQLite スキーマ定義・行変換関数
├── storage.py       JSON ファイル I/O（tasks/projects/CLAUDE.md）
├── app.py           Flask ルート定義（薄いコントローラー）
├── analyze.py       タスク分析・スコア計算・レポート生成
├── CLAUDE.md        AI アシスタント用プロンプト仕様（load_system_prompt() で読込）
├── data/
│   ├── tasks.json              アクティブタスク一覧
│   ├── projects.json           プロジェクト一覧
│   ├── archive.db              アーカイブ・習慣・ブレインダンプ・行動ログ（SQLite）
│   ├── task_behavior_log.jsonl 旧形式ログ（migrate_from_json() で取込済）
│   └── task_analysis_report.json 直近の分析レポートキャッシュ
├── static/
│   ├── js/main.js   フロントエンド全ロジック（~2900行、単一ファイル）
│   ├── css/style.css
│   ├── sw.js        Service Worker（現バージョン: task-organizer-v10）
│   ├── manifest.json
│   └── icons/icon.svg
├── templates/index.html
└── docs/
    ├── SPEC.md          （このファイル）
    ├── CONVENTIONS.md   開発規約
    └── TEST_SPEC.md     テスト仕様
```

### 各モジュールの役割と禁止事項

| ファイル | 役割 | 禁止 |
|---------|------|------|
| `config.py` | 定数定義のみ | ビジネスロジック、I/O |
| `db.py` | SQLite スキーマ・行変換 | Flask ルート、JSON I/O、ビジネスロジック |
| `storage.py` | JSON ファイル読み書き | DB 操作、Flask ルート |
| `app.py` | HTTP エンドポイント | ビジネスロジックの肥大化 |
| `analyze.py` | 分析・スコア計算 | Flask ルート、HTTP 処理 |

---

## 3. データ永続化

### 二重構造の理解（重要）

このアプリは **JSON ファイル** と **SQLite** の二層構造を持つ。混同しないこと。

| データ | ストレージ | 読み書き関数 |
|--------|-----------|-------------|
| アクティブタスク | `data/tasks.json` | `storage.load_tasks()` / `storage.save_tasks()` |
| プロジェクト | `data/projects.json` | `storage.load_projects()` / `storage.save_projects()` |
| アーカイブタスク | `archive.db → archived_tasks` | 直接 SQLite |
| 習慣 | `archive.db → habits` | 直接 SQLite |
| 習慣ログ | `archive.db → habit_logs` | 直接 SQLite |
| ブレインダンプ | `archive.db → brain_dump_sessions` | 直接 SQLite |
| 行動ログ | `archive.db → behavior_logs` | 直接 SQLite |

### migrate_from_json() の挙動（重要）

起動時に毎回 `migrate_from_json()` が実行される。この関数は `tasks.json` から `tasks` テーブルへ `INSERT OR IGNORE` する。**アーカイブ済みタスクを再インポートしないよう、`archived_tasks` に存在する ID はスキップする**処理が実装済み。

```python
archived_ids = set(r[0] for r in conn.execute('SELECT id FROM archived_tasks').fetchall())
for t in tasks:
    if t['id'] in archived_ids:
        continue  # アーカイブ済みは tasks テーブルに戻さない
    conn.execute('INSERT OR IGNORE INTO tasks ...', ...)
```

### SQLite テーブル一覧

#### tasks テーブル
`tasks.json` の正規化ミラー。メインの読み書きは JSON ファイル側で行うが、`migrate_from_json()` で同期される。

```sql
CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    importance  TEXT NOT NULL DEFAULT 'high',
    urgency     TEXT NOT NULL DEFAULT 'high',
    category    TEXT NOT NULL DEFAULT 'life',
    tags        TEXT NOT NULL DEFAULT '[]',      -- JSON 配列文字列
    roadmap     TEXT NOT NULL DEFAULT '[]',      -- JSON 配列文字列
    checklist   TEXT NOT NULL DEFAULT '[]',      -- JSON 配列文字列
    notes       TEXT NOT NULL DEFAULT '',
    completed   INTEGER NOT NULL DEFAULT 0,
    deadline    TEXT,                            -- YYYY-MM-DD または NULL
    created_at  TEXT NOT NULL,
    project_id  TEXT,
    phase_id    TEXT
)
```

#### archived_tasks テーブル
アーカイブされたタスクの永続保存。

```sql
CREATE TABLE archived_tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    importance  TEXT NOT NULL DEFAULT 'high',
    urgency     TEXT NOT NULL DEFAULT 'high',
    category    TEXT NOT NULL DEFAULT 'life',
    tags        TEXT NOT NULL DEFAULT '[]',
    roadmap     TEXT NOT NULL DEFAULT '[]',
    checklist   TEXT NOT NULL DEFAULT '[]',
    notes       TEXT NOT NULL DEFAULT '',
    archived_at TEXT NOT NULL,
    deadline    TEXT
)
```

#### habits テーブル
習慣の定義情報。

```sql
CREATE TABLE habits (
    id          TEXT PRIMARY KEY,    -- 'habit_' + タイムスタンプ
    title       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'life',
    tags        TEXT NOT NULL DEFAULT '[]',
    frequency   TEXT NOT NULL DEFAULT 'daily',  -- 'daily' | 'weekly'
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
)
```

#### habit_logs テーブル
習慣の完了記録。日付×習慣の UNIQUE 制約。

```sql
CREATE TABLE habit_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id  TEXT NOT NULL,
    date      TEXT NOT NULL,      -- YYYY-MM-DD
    done      INTEGER NOT NULL DEFAULT 1,
    UNIQUE(habit_id, date)        -- UPSERT で使用
)
```

`INSERT ... ON CONFLICT(habit_id, date) DO UPDATE SET done = excluded.done` でトグル。

#### brain_dump_sessions テーブル
ブレインダンプ会話の保存（AI 要約・テーマ分類付き）。

```sql
CREATE TABLE brain_dump_sessions (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    summary        TEXT NOT NULL DEFAULT '',
    theme_category TEXT NOT NULL DEFAULT 'その他',
    sub_theme      TEXT NOT NULL DEFAULT '',
    date           TEXT NOT NULL,
    raw_messages   TEXT NOT NULL DEFAULT '[]',  -- JSON 配列
    created_at     TEXT NOT NULL
)
```

#### behavior_logs テーブル
ユーザーの行動ログ（分析スコアリングに使用）。

```sql
CREATE TABLE behavior_logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,      -- ISO 8601
    task_id  TEXT NOT NULL DEFAULT '',
    action   TEXT NOT NULL      -- 'sidebar_open' | 'task_chat_sent' | 'task_created'
)
```

---

## 4. データモデル

### Task（`data/tasks.json` の各要素）

```json
{
  "id":          "1713600000000",
  "title":       "タスク名",
  "importance":  "high",
  "urgency":     "low",
  "category":    "work",
  "deadline":    "2026-04-20",
  "tags":        ["タグ1", "タグ2"],
  "roadmap":     [{"id": "1713600001000", "text": "ステップ1", "done": false}],
  "checklist":   [{"id": "1713600002000", "text": "準備物", "done": false}],
  "notes":       "自由メモ",
  "completed":   false,
  "created_at":  "2026-04-20T10:00:00",
  "project_id":  "proj_1713600000000",
  "phase_id":    "1713600000001"
}
```

**フィールド制約:**
- `importance`: `"high"` または `"low"` のみ
- `urgency`: `"high"` または `"low"` のみ
- `category`: `"work"` / `"health"` / `"life"` / `"learning"` / `"social"` / `"admin"` のみ
- `deadline`: `"YYYY-MM-DD"` 文字列または `null`
- `roadmap[].id`: タイムスタンプ系文字列（`app.py` での作成時は自動付与されない→フロントエンドが付与）
- `project_id` / `phase_id`: プロジェクト紐付き時のみ存在、なければキー自体がないか `null`

### Project（`data/projects.json` の各要素）

```json
{
  "id":                "proj_1713600000000",
  "title":             "プロジェクト名（20字以内）",
  "goal":              "ゴールの説明（1〜2文）",
  "category":          "learning",
  "deadline":          "2026-10-01",
  "tags":              ["タグ"],
  "phases":            [
    {
      "id":              "1713600000001",
      "text":            "フェーズ名（10字以内）",
      "done":            false,
      "notes":           "",
      "current_task_id": null
    }
  ],
  "current_phase":     0,
  "created_at":        "2026-04-20T10:00:00",
  "next_step_history": [{"step": "今日のスモールステップ内容"}]
}
```

- `phases[].current_task_id`: そのフェーズで現在進行中のタスク ID（タスク作成時に自動セット）
- フェーズは順序が重要（`current_phase` インデックスで現在地を管理）

### Habit（`/api/habits` レスポンスの各要素）

```json
{
  "id":             "habit_1713600000000",
  "title":          "習慣のタイトル",
  "category":       "health",
  "tags":           [],
  "frequency":      "daily",
  "notes":          "",
  "created_at":     "2026-04-20T10:00:00",
  "active":         true,
  "importance":     "high",
  "urgency":        "low",
  "today_done":     false,
  "week_done":      {
    "2026-04-21": true,
    "2026-04-22": null,
    "2026-04-23": null,
    "2026-04-24": null,
    "2026-04-25": null
  },
  "current_streak": 3,
  "rate_30d":       0.733
}
```

- `week_done`: 月〜金の 5 日分のみ（キー = ISO 日付、値 = `true`/`false`/`null`）
  - `true`: 完了済み、`false`: 明示的に未完了、`null`: 記録なし
- `importance`/`urgency` は固定値（`"high"`/`"low"`）— DB には存在せず `row_to_habit()` で付与
- `today_done`/`week_done`/`current_streak`/`rate_30d` は GET 時に動的計算されてレスポンスに含まれる

### habitAsTask（フロントエンド変換）

マトリクス・今日のタスクタブで習慣をタスクカードとして表示するための変換。

> **重要な設計上の制約**: 習慣カードはタスクカードと同じ見た目で表示されるが、クリックしても詳細パネルは開かない。これは意図した仕様。
> - 習慣には詳細パネルが存在しない（roadmap/checklist/notes 等がない）
> - 習慣の完了操作はチェックボックスのみで行う
> - 習慣カードは 🔁 バッジと `cursor: default` で視覚的に区別される
> - アクティブタスクが 0 件の場合、マトリクスには習慣カードのみが表示される。この状態でカードをクリックしても詳細パネルは開かない（バグではない）

```js
function habitAsTask(h) {
  return {
    id:         h.id,
    title:      h.title,
    importance: h.importance || 'high',
    urgency:    h.urgency    || 'low',
    category:   h.category,
    tags:       h.tags || [],
    deadline:   null,
    roadmap:    [],
    checklist:  [],
    completed:  h.today_done === true,  // 今日の完了状態
    _isHabit:   true,                   // 習慣フラグ（必須）
  };
}
```

`_isHabit: true` フラグにより、チェックボックス操作時に `patchTask()` ではなく `toggleHabitDone()` が呼ばれる。

---

## 5. API エンドポイント仕様

### タスク系

| メソッド | パス | 説明 | リクエスト | レスポンス |
|----------|------|------|-----------|-----------|
| GET | `/api/tasks` | アクティブタスク一覧 | — | Task[] |
| POST | `/api/tasks` | タスク作成 | Task（部分可） | Task, 201 |
| PUT | `/api/tasks/<id>` | タスク部分更新 | 更新フィールドのみ | Task |
| DELETE | `/api/tasks/<id>` | タスク削除 | — | `{"ok": true}` |
| POST | `/api/tasks/<id>/archive` | アーカイブ | — | `{"ok": true, "archived_at": "..."}` |
| GET | `/api/tasks/<id>/similar` | 類似アーカイブタスク | — | ArchivedTask[]（最大5件） |
| POST | `/api/tasks/<id>/chat` | タスク詳細チャット | `{"messages": [...]}` | `{"response": "...", "step_updates": [...]}` |

**POST /api/tasks 自動付与フィールド:**
- `id`: `str(int(time.time() * 1000))`（ミリ秒タイムスタンプ）
- `created_at`: `time.strftime('%Y-%m-%dT%H:%M:%S')`
- デフォルト値: `completed=false`, `roadmap=[]`, `checklist=[]`, `tags=[]`, `notes=""`, `deadline=null`, `importance="high"`, `urgency="high"`

### アーカイブ系

| メソッド | パス | 説明 | クエリパラメータ |
|----------|------|------|----------------|
| GET | `/api/archive` | アーカイブ一覧 | `q`（タイトル検索）, `category`, `sort`（newest/oldest/title） |
| DELETE | `/api/archive/<id>` | アーカイブ完全削除 | — |
| POST | `/api/archive/<id>/restore` | アーカイブをアクティブに復元 | — |

### プロジェクト系

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/projects` | プロジェクト一覧 |
| POST | `/api/projects` | プロジェクト作成（フェーズに id/done/notes/current_task_id 自動付与） |
| PUT | `/api/projects/<id>` | プロジェクト更新 |
| DELETE | `/api/projects/<id>` | プロジェクト削除（関連タスクも削除） |
| POST | `/api/projects/<id>/next-step` | 今日のスモールステップ提案チャット |
| POST | `/api/projects/<pid>/phases/<phid>/chat` | フェーズチャット（`[[TASK:...]]` 出力あり） |

### 習慣系

| メソッド | パス | 説明 | 備考 |
|----------|------|------|------|
| GET | `/api/habits` | アクティブ習慣一覧 | `today_done`/`week_done`/`current_streak`/`rate_30d` 付き |
| POST | `/api/habits` | 習慣作成 | — |
| PUT | `/api/habits/<id>` | 習慣更新 | — |
| DELETE | `/api/habits/<id>` | 習慣削除（ログも削除） | — |
| POST | `/api/habits/<id>/log` | 完了記録 | `{"date": "YYYY-MM-DD", "done": true/false}` |
| GET | `/api/habits/<id>/logs` | ログ履歴 | `?days=90`（デフォルト） |
| GET | `/api/habits/<id>/stats` | 統計情報 | streak/rate_7d/rate_30d/rate_90d |

**POST /api/habits/\<id\>/log の挙動:**
- `UPSERT`（`ON CONFLICT DO UPDATE`）で同じ日付のレコードを上書き
- フロントエンドの `toggleHabitDone()` からのみ呼ばれる

### チャット・分析系

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/chat` | メインチャット（`mode: "task"` または `"dump"`） |
| POST | `/api/braindump/save` | ブレインダンプ保存（AI 要約・テーマ分類付き） |
| GET | `/api/braindump` | ブレインダンプ一覧 |
| DELETE | `/api/braindump/<id>` | ブレインダンプ削除 |
| POST | `/api/log` | 行動ログ記録 |
| GET | `/api/report` | タスク分析レポート生成・取得 |
| POST | `/api/analyze/ai` | 分析レポートへの AI コメント取得 |

---

## 6. AI 呼び出し仕様

### 実行パターン

```python
result = subprocess.run(
    [CLAUDE_PATH, '--print', '--model', CLAUDE_MODEL_CHAT, '-p', prompt],
    capture_output=True, text=True, encoding='utf-8',
    timeout=CLAUDE_TIMEOUT,               # 120秒（config.py）
    creationflags=subprocess.CREATE_NO_WINDOW,
)
response_text = result.stdout.strip()
```

- `CLAUDE_PATH`: `C:\Users\sa641.SATSUKIPC\.local\bin\claude.exe`
- 課金: Claude Code サブスクリプション経由（API 課金なし）
- タイムアウト時: `subprocess.TimeoutExpired` → 固定メッセージを返す
- モデル: `CLAUDE_MODEL_CHAT`（Sonnet / 対話・分析） / `CLAUDE_MODEL_LIGHT`（Haiku / JSON抽出）を `config.py` で定義

### AI 出力ブロック形式

AI レスポンスに含まれる構造化ブロックは `app.py` でパース・除去される。

#### [[TASK:{...}]]

```
[[TASK:{"title":"...","importance":"high","urgency":"low","category":"work","deadline":"2026-04-20","tags":["タグ"],"roadmap":[{"text":"ステップ1"}],"checklist":[{"text":"準備物"}]}]]
```

- 出力元: `/api/chat`（タスクモード）、`/api/projects/.../phases/.../chat`
- パース後: `task_proposals` 配列としてフロントエンドに渡す
- バリデーション: `category` / `importance` / `urgency` は無効値をデフォルトに置換

#### [[PROJECT:{...}]]

```
[[PROJECT:{"title":"...","goal":"...","category":"learning","deadline":"2026-10-01","phases":[{"text":"フェーズ1"}],"tags":[]}]]
```

- 出力元: `/api/chat`（タスクモード）
- パース後: `project_proposals` 配列としてフロントエンドに渡す

#### [[HABIT:{...}]]

```
[[HABIT:{"title":"...","category":"health","frequency":"daily","tags":[],"notes":""}]]
```

- 出力元: `/api/chat`（タスクモード）
- パース後: `habit_proposals` 配列としてフロントエンドに渡す

#### [[UPDATE_STEP:{...}]]

```
[[UPDATE_STEP:{"index": 0, "text": "新しいステップテキスト"}]]
```

- 出力元: `/api/tasks/<id>/chat`
- パース後: DB を即時更新し、`step_updates` 配列としてフロントエンドに渡す
- `index` は 0 始まりのロードマップインデックス

### チャットコンテキスト構築

各エンドポイントでのプロンプト構築:

```python
# system + context + 会話履歴（最新 N 件）+ "アシスタント:" で終端
prompt_parts = [system, context, '\n\n--- 会話 ---\n']
for msg in messages[-CHAT_HISTORY_LIMIT:]:
    role = 'ユーザー' if msg['role'] == 'user' else 'アシスタント'
    prompt_parts.append(f'\n{role}: {msg["content"]}')
prompt_parts.append('\nアシスタント:')
```

| エンドポイント | 履歴上限 | システムプロンプト源 |
|---------------|---------|-------------------|
| `/api/chat` | 20 | `CLAUDE.md`（`load_system_prompt()`) |
| `/api/tasks/<id>/chat` | 20 | `CLAUDE.md` + タスク詳細コンテキスト |
| `/api/projects/<id>/next-step` | 10 | `CLAUDE.md` + プロジェクト情報 |
| `/api/projects/.../phases/.../chat` | 20 | `CLAUDE.md` + フェーズ情報 |
| `/api/braindump/save` | 40 | 固定の要約プロンプト |
| `/api/analyze/ai` | — | 固定の分析プロンプト |

---

## 7. フロントエンド仕様

### グローバル状態変数

```js
let allTasks        = [];         // アクティブタスク配列
let allHabits       = [];         // 習慣配列（today_done/week_done 付き）
let allProjects     = [];         // プロジェクト配列
let currentTaskId   = null;       // 詳細パネルで開いているタスク ID
let drilldownQ      = null;       // ドリルダウン中の象限 ('q1'|'q2'|'q3'|'q4'|null)
let tasksSubView    = 'matrix';   // 現在のサブビュー
let isOnline        = navigator.onLine;
```

チャット履歴:
```js
const chatHistories     = { task: [], dump: [] };   // メインチャット
const taskChatHistories = {};    // タスク詳細チャット（key: taskId）
const projectChatHistories = {}; // プロジェクトチャット
const phaseChatHistories   = {}; // フェーズチャット
```

### 主要関数一覧

| 関数 | 説明 |
|------|------|
| `renderMatrix()` | マトリクスビュー再描画（habits も quadrant に含む） |
| `renderTodayView()` | 今日のタスクビュー再描画（習慣も simple card として含む） |
| `renderProjectView()` | プロジェクトビュー再描画 |
| `renderHabitView()` | 習慣タブビュー描画（ヒートマップグリッド＋アナリティクス） |
| `buildMatrixCard(task)` | マトリクス用カード DOM 生成 |
| `buildTodayCard(task)` | 今日のタスク用カード DOM 生成 |
| `switchTasksSubView(view)` | サブビュー切替（4ビュー: matrix/today/project/habit） |
| `habitAsTask(h)` | 習慣オブジェクト → タスク互換オブジェクト変換 |
| `toggleHabitDone(habitId, done)` | 習慣の完了トグル（API + ローカル状態 + 全ビュー再描画） |
| `patchTask(id, data)` | `PUT /api/tasks/<id>` で部分更新 |
| `openDetailPanel(taskId)` | 詳細サイドパネルを開く |
| `taskQuadrant(task)` | タスクの象限を返す（'q1'〜'q4'） |

### 習慣完了の状態同期（重要）

```js
async function toggleHabitDone(habitId, done) {
  // 1. API 更新
  await apiFetch(`/api/habits/${habitId}/log`, { method: 'POST', body: ... });
  // 2. ローカル状態更新
  const h = allHabits.find(x => x.id === habitId);
  if (h) {
    h.today_done = done;
    h.week_done[todayStr()] = done;
    h.current_streak = done ? (h.current_streak || 0) + 1 : Math.max(0, ...);
  }
  // 3. 全ビュー再描画
  renderMatrix();
  renderTodayView();
  // 4. 習慣タブが表示中なら習慣ビューも更新
  const habitView = document.getElementById('tasks-view-habit');
  if (habitView && !habitView.classList.contains('hidden')) renderHabitView();
}
```

習慣タブ側のマス目クリックハンドラー（`tasks-view-habit` への event delegation）も同様に `renderMatrix()` と `renderTodayView()` を呼ぶ（2026-04-22 修正済み）。

### サブビュー切替の CSS 要件

4 つのサブビューすべてに `hidden` クラスの CSS ルールが必要。`style.css` に以下が定義済み:

```css
#tasks-view-today.hidden   { display: none; }
#tasks-view-matrix.hidden  { display: none; }
#tasks-view-project.hidden { display: none; }
#tasks-view-habit          { height: 100%; overflow-y: auto; padding: 12px 14px; }
#tasks-view-habit.hidden   { display: none; }
```

`#tasks-view-habit.hidden` が定義されていないと、`classList.toggle('hidden', ...)` が CSS 的に無効になり、切替が機能しない。

### マトリクスカードの習慣フラグ

```js
function buildMatrixCard(task) {
  const isHabit = !!task._isHabit;
  // ...
  card.querySelector('.task-checkbox').addEventListener('change', async e => {
    if (isHabit) {
      await toggleHabitDone(task.id, e.target.checked);
      // ← renderMatrix/renderTodayView は toggleHabitDone 内で呼ばれる
    } else {
      await patchTask(task.id, { completed: e.target.checked });
      renderMatrix();
      if (currentTaskId === task.id) openDetailPanel(task.id);
    }
  });
  card.addEventListener('click', e => {
    if (e.target.matches('.task-checkbox')) return;
    if (isHabit) return;  // 習慣カードはパネルを開かない
    openDetailPanel(task.id);
  });
}
```

### オフライン対応

```js
// localStorage キー
const LS_OFFLINE_Q   = 'to_offline_q';   // オフライン操作キュー
const LS_TASKS_CACHE = 'to_tasks_c';     // タスクキャッシュ
const LS_CHATS       = 'to_chats';       // チャット履歴
const LS_TASK_CHATS  = 'to_task_chats';  // タスクチャット履歴
```

オフライン時の操作（create/update/delete/archive）は `localStorage` のキューに積まれ、オンライン復帰時に `_flushOfflineQ()` で一括送信される。

---

## 8. 分析スコアリング

### 優先度統合式

```
P = D + A × (1 - D) × λ

D : 期限緊急度 (0〜1)  ← 双曲型: 1 / (max(days_remaining, 0) + 1)
A : 回避スコア (0〜1)  ← エンゲージメント × 未進捗 × 経過日数
λ : 回避感度パラメータ = 0.7（config.AVOIDANCE_LAMBDA）
```

### 期限緊急度 D

```python
def _deadline_urgency(deadline_str, today):
    if not deadline_str: return 0.1   # 期限なしは低め固定
    days_remaining = (dl - today).days
    return min(1.0, 1.0 / (max(days_remaining, 0) + 1))
```

### 回避スコア A

```python
def _avoidance_score(task_events, progress_rate, days_old):
    open_count = count(action == 'sidebar_open')
    chat_count = count(action == 'task_chat_sent')

    raw_engagement = open_count + chat_count * 2
    engagement = 1 - exp(-raw_engagement / ENGAGEMENT_SATURATION)   # ENGAGEMENT_SATURATION=5

    avoidance_raw = engagement * (1 - progress_rate) * log(days_old + 2)

    A = 2 / (1 + exp(-avoidance_raw / AVOIDANCE_SIGMOID_DIVISOR)) - 1  # DIVISOR=3
    return max(0.0, min(1.0, A))
```

### フラグ判定

| フラグ | 条件 |
|--------|------|
| `high_avoidance` | A > 0.5 AND 進捗 < 30% AND 作成から5日超 |
| `deadline_critical` | 期限まで3日以内 AND D > 0.25 |

### 優先度レベル

| 値 | 条件 |
|----|------|
| `high` | P >= 0.7 |
| `medium` | P >= 0.4 |
| `low` | P < 0.4 |

---

## 9. Service Worker とキャッシュ

```js
const CACHE = 'task-organizer-v10';  // バージョン変更でキャッシュ強制無効化

const PRECACHE = ['/', '/static/css/style.css', '/static/js/main.js',
                  '/static/manifest.json', '/static/icons/icon.svg'];
```

### キャッシュ戦略

| リクエスト | 戦略 |
|-----------|------|
| クロスオリジン（CDN 等） | ネットワークのみ、失敗は 408 |
| `GET /api/tasks` | ネットワーク優先・成功時キャッシュ、失敗時 `[]` を返す |
| その他 `/api/*` | ネットワークのみ、オフライン時 503 JSON |
| 同一オリジン静的リソース | キャッシュ優先・バックグラウンド更新 |

**`main.js` や `style.css` を変更した場合は `CACHE` バージョンを上げること。**  
ユーザーは Ctrl+Shift+R（ハードリフレッシュ）でも強制更新できる。

---

## 10. 既知の実装上の注意点

### アーカイブ後の再表示問題（解決済み）

- **原因**: `migrate_from_json()` が起動のたびに `tasks.json` から `INSERT OR IGNORE` するため、`tasks.json` に残っているアーカイブ済みタスクが `tasks` テーブルに再挿入されていた
- **対処**: `archived_ids` チェックを追加済み（`db.py:148-151`）
- **データ修復**: `DELETE FROM tasks WHERE id IN (SELECT id FROM archived_tasks)` を実行済み

### 習慣タブ UI の漏れ問題（解決済み）

- **原因**: `#tasks-view-habit.hidden { display: none; }` の CSS ルールが未定義だった
- **対処**: `style.css` に追記済み

### 習慣カードをクリックしても詳細パネルが開かない（仕様）

- **現象**: マトリクス・今日のタスクタブで習慣カード（🔁 バッジ付き）をクリックしても詳細パネルが開かない
- **原因**: `buildMatrixCard` / `buildTodayCard` は `_isHabit: true` のカードに対して `if (isHabit) return;` で早期リターンする（意図した動作）
- **混同しやすいケース**: アクティブタスクが 0 件の場合、マトリクスには習慣カードしか表示されない。この状態でカードをクリックしても詳細パネルが開かないため、詳細パネル自体が壊れているように見える。タスクを新規作成すると正常に動作する
- **関連 CSS**: `.matrix-card.habit-card, .today-card.habit-card { cursor: default; }`

### 習慣完了のビュー同期問題（解決済み）

- **原因**: 習慣タブのマス目クリックハンドラーが `renderMatrix()`/`renderTodayView()` を呼んでいなかった
- **対処**: 2026-04-22 に `renderMatrix()` と `renderTodayView()` の呼び出しを追加済み（`main.js:2770-2771`）

### `const isHabit` 二重宣言（解決済み）

- **原因**: `buildTodayCard()` 内に `const isHabit = !!task._isHabit;` が 2 箇所あり `SyntaxError` が発生、全 JS が動作不能に
- **対処**: 重複宣言を削除済み（`main.js:684` のみ）

---

## 11. 改修時チェックリスト

```
[ ] docs/CONVENTIONS.md を確認した
[ ] マジックナンバーは config.py に定義した
[ ] python -m py_compile config.py db.py storage.py app.py analyze.py
[ ] python analyze.py  （エラーなく完了する）
[ ] サーバー起動して GET /api/tasks → 200
[ ] GET /api/habits → 200（today_done/week_done/current_streak/rate_30d 付き）
[ ] GET /api/report → 200（分析レポートが返る）
[ ] main.js を変更した場合: static/sw.js の CACHE バージョンを上げた
[ ] style.css を変更した場合: static/sw.js の CACHE バージョンを上げた
[ ] 習慣完了をマトリクス・今日のタスク・習慣タブそれぞれで動作確認した
[ ] アーカイブしたタスクがマトリクス・今日のタスクに再表示されないことを確認した
```
