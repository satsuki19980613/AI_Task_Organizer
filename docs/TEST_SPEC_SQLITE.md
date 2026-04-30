# SQLite 統一移行 & 習慣機能 — テスト仕様書

> ⚠️ **このファイルは SQLite 移行時（2026-04-21）のテスト仕様で、GTD 改修（2026-04-25）以降は履歴参照用。**
> 現行のテスト仕様は [`GTD_TEST_SPEC.md`](GTD_TEST_SPEC.md) を正とする。
> 以下のテーブル定義・テストケースの一部は GTD 改修で変更・削除された（`behavior_logs` 廃止、`habits` に `weekday` 追加、`tasks` に GTD カラム追加など）。

**対象**: tasks.json / projects.json / task_behavior_log.jsonl の SQLite 統合、および習慣（Habit）機能の新規追加（旧仕様）
**作成日**: 2026-04-21
**凍結日**: 2026-04-25
**前提**: 既存の T1〜T8（`TEST_SPEC.md`）はリグレッションテストとして全て通過すること

---

## スキーマ定義（テスト対象）

### tasks テーブル
```sql
CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    importance  TEXT NOT NULL DEFAULT 'high',
    urgency     TEXT NOT NULL DEFAULT 'high',
    category    TEXT NOT NULL DEFAULT 'life',
    tags        TEXT NOT NULL DEFAULT '[]',
    roadmap     TEXT NOT NULL DEFAULT '[]',
    checklist   TEXT NOT NULL DEFAULT '[]',
    notes       TEXT NOT NULL DEFAULT '',
    completed   INTEGER NOT NULL DEFAULT 0,
    deadline    TEXT,
    created_at  TEXT NOT NULL,
    project_id  TEXT,
    phase_id    TEXT
)
```

### projects テーブル
```sql
CREATE TABLE IF NOT EXISTS projects (
    id                 TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    goal               TEXT NOT NULL DEFAULT '',
    category           TEXT NOT NULL DEFAULT 'life',
    deadline           TEXT,
    tags               TEXT NOT NULL DEFAULT '[]',
    phases             TEXT NOT NULL DEFAULT '[]',
    current_phase      INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    next_step_history  TEXT NOT NULL DEFAULT '[]'
)
```

### behavior_logs テーブル
```sql
CREATE TABLE IF NOT EXISTS behavior_logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    task_id  TEXT NOT NULL DEFAULT '',
    action   TEXT NOT NULL
)
```

### habits テーブル
```sql
CREATE TABLE IF NOT EXISTS habits (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'life',
    tags        TEXT NOT NULL DEFAULT '[]',
    frequency   TEXT NOT NULL DEFAULT 'daily',
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
)
```

### habit_logs テーブル
```sql
CREATE TABLE IF NOT EXISTS habit_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id  TEXT NOT NULL,
    date      TEXT NOT NULL,
    done      INTEGER NOT NULL DEFAULT 1,
    UNIQUE(habit_id, date)
)
```

---

## T9: データ移行テスト

### T9-1: tasks.json からの移行

| ID | テストケース | 手順 | 期待結果 |
|----|-------------|------|----------|
| T9-1-1 | 既存タスクの移行完全性 | tasks.json に3件 → migrate_from_json() 実行 → SELECT COUNT(*) FROM tasks | 3件が tasks テーブルに存在する |
| T9-1-2 | タスクの全フィールド保持 | id, title, importance, urgency, category, tags, roadmap, checklist, notes, completed, deadline, created_at が一致 | 全フィールド値が JSON と一致する |
| T9-1-3 | tags の JSON 配列変換 | tags=["仕事","重要"] → DB格納 → SELECT | `'["仕事","重要"]'` として保存され、取得時に配列に戻る |
| T9-1-4 | roadmap の JSON 配列変換 | roadmap=[{text:"手順1",done:false}] → DB格納 → SELECT | 正しく配列に復元される |
| T9-1-5 | completed の int 変換 | completed=false → DB格納 | INTEGER 0 として保存される |
| T9-1-6 | completed=true の変換 | completed=true → DB格納 | INTEGER 1 として保存される |
| T9-1-7 | deadline=null の保存 | deadline=null → DB格納 | NULL として保存される |
| T9-1-8 | project_id / phase_id の保存 | project_id="proj_123", phase_id="456" → DB格納 → SELECT | 値が正確に保存・取得される |
| T9-1-9 | tasks.json が空の場合 | tasks.json = [] → migrate | エラーなし、tasks テーブルが空 |
| T9-1-10 | tasks.json が存在しない場合 | ファイルなし → migrate | エラーなし、tasks テーブルが空 |
| T9-1-11 | tasks.json が不正 JSON の場合 | 不正な内容 → migrate | エラーなし（スキップ）、tasks テーブルが空 |
| T9-1-12 | 移行後の重複防止 | 移行済みタスクを再度 migrate | INSERT OR IGNORE により重複しない |

---

### T9-2: projects.json からの移行

| ID | テストケース | 手順 | 期待結果 |
|----|-------------|------|----------|
| T9-2-1 | 既存プロジェクトの移行完全性 | projects.json に2件 → migrate | 2件が projects テーブルに存在する |
| T9-2-2 | phases の JSON 配列変換 | phases=[{id:"...",text:"フェーズ1",done:false}] → DB格納 → SELECT | 正しく配列に復元される |
| T9-2-3 | current_phase の int 変換 | current_phase=0 → DB格納 | INTEGER 0 として保存される |
| T9-2-4 | next_step_history の JSON 配列変換 | next_step_history=[{step:"..."}] → DB格納 → SELECT | 正しく配列に復元される |
| T9-2-5 | projects.json が存在しない場合 | ファイルなし → migrate | エラーなし |

---

### T9-3: task_behavior_log.jsonl からの移行

| ID | テストケース | 手順 | 期待結果 |
|----|-------------|------|----------|
| T9-3-1 | 既存ログの移行完全性 | JSONL に10行 → migrate | behavior_logs テーブルに10件 |
| T9-3-2 | ts / task_id / action の保持 | 各フィールドが正確に移行されているか | 全フィールド値が一致する |
| T9-3-3 | 不正な行のスキップ | JSONL に不正 JSON 1行 + 正常 5行 → migrate | 正常5行だけ移行される |
| T9-3-4 | JSONL ファイルが存在しない場合 | ファイルなし → migrate | エラーなし |

---

### T9-4: 移行後の整合性確認

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T9-4-1 | GET /api/tasks が移行後も同じ結果を返す | 移行前後でレスポンス配列の件数・内容が一致 |
| T9-4-2 | GET /api/projects が移行後も同じ結果を返す | 移行前後でレスポンス配列の件数・内容が一致 |
| T9-4-3 | tasks.json / projects.json / task_behavior_log.jsonl を削除しても動作する | 全 API が正常に動作する |

---

## T10: タスク API（SQLite バックエンド）

既存の T1-1 と同一の入出力仕様。以下はストレージ実装変更後の回帰確認。

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T10-1 | タスク作成 → DB確認 | `POST /api/tasks` → SQLite 直接 SELECT | tasks テーブルに1行挿入されている |
| T10-2 | タスク更新 → DB確認 | `PUT /api/tasks/{id}` → SQLite 直接 SELECT | 更新フィールドが DB に反映されている |
| T10-3 | タスク削除 → DB確認 | `DELETE /api/tasks/{id}` → SQLite 直接 SELECT | 行が削除されている |
| T10-4 | サーバー再起動後の永続性 | タスク作成 → サーバー再起動 → `GET /api/tasks` | タスクが残っている |
| T10-5 | completed フラグの bool 変換 | DB: completed=1 → `GET /api/tasks` | レスポンスで `completed: true`（bool 型）として返る |
| T10-6 | completed=0 の bool 変換 | DB: completed=0 → `GET /api/tasks` | レスポンスで `completed: false`（bool 型）として返る |
| T10-7 | tags / roadmap / checklist の復元 | DB に JSON 文字列 → `GET /api/tasks` | 配列型で返る |

---

## T11: プロジェクト API（SQLite バックエンド）

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T11-1 | プロジェクト作成 → DB確認 | `POST /api/projects` → SQLite 直接 SELECT | projects テーブルに1行挿入されている |
| T11-2 | phases の JSON 往復 | phases を含む POST → `GET /api/projects` | phases が配列型で返る |
| T11-3 | プロジェクト更新 → DB確認 | `PUT /api/projects/{id}` → SQLite 直接 SELECT | 更新内容が DB に反映されている |
| T11-4 | プロジェクト削除 → 関連タスク削除 | `DELETE /api/projects/{id}` → `GET /api/tasks` | 関連タスクが tasks テーブルから消えている |
| T11-5 | サーバー再起動後の永続性 | プロジェクト作成 → 再起動 → `GET /api/projects` | プロジェクトが残っている |
| T11-6 | フェーズの current_task_id 更新 | フェーズ付きプロジェクトのタスクを作成 | phases[n].current_task_id が更新される |

---

## T12: 行動ログ API（SQLite バックエンド）

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T12-1 | ログ記録 → DB確認 | `POST /api/log` → SELECT FROM behavior_logs | 1行挿入されている |
| T12-2 | action 欠落 | body に action なし | 400 + `{"error":"missing action"}` |
| T12-3 | 連続ログ記録 | 10回 POST | behavior_logs に10行追加 |
| T12-4 | task_id 空文字 | task_id="" → POST | `{"ok":true}`、DB に空文字で保存 |
| T12-5 | ログの ts フォーマット | 記録後 SELECT ts | `'YYYY-MM-DDTHH:MM:SS'` 形式 |
| T12-6 | サーバー再起動後のログ保持 | ログ記録 → 再起動 → analyze.py 実行 | ログが分析に反映されている |

---

## T13: 習慣 CRUD API

### T13-1: 習慣の作成・取得・更新・削除

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T13-1-1 | 習慣一覧取得（空） | `GET /api/habits` | `[]` を返す |
| T13-1-2 | 習慣作成 — 最小フィールド | `POST /api/habits` body: `{"title":"朝の読書","category":"learning"}` | 201、`id`・`created_at`・`active:true`・`frequency:"daily"`・`tags:[]` が自動付与 |
| T13-1-3 | 習慣作成 — 全フィールド | title, category, tags, frequency, notes 全指定 | 指定値が全て返る |
| T13-1-4 | 習慣作成 — タイトル空 | body: `{"title":""}` | 400 + `{"error":"title is required"}` |
| T13-1-5 | 習慣作成 — 不正 category | category="invalid" | 400 + `{"error":"invalid category"}` |
| T13-1-6 | 習慣作成 — importance/urgency は設定不可 | body に importance/urgency 含む | 無視される（固定値: high/low） |
| T13-1-7 | 習慣一覧取得（複数） | 3件作成後 `GET /api/habits` | 3件が返る（active=true のみ） |
| T13-1-8 | 習慣更新 | `PUT /api/habits/{id}` body: `{"title":"夜の読書"}` | 更新後の習慣が返る |
| T13-1-9 | 習慣更新 — 存在しない ID | `PUT /api/habits/INVALID` | 404 |
| T13-1-10 | 習慣の一時停止 | `PUT /api/habits/{id}` body: `{"active":false}` | `active:false` になる、`GET /api/habits` に出なくなる |
| T13-1-11 | 習慣の再開 | active=false → `PUT /api/habits/{id}` body: `{"active":true}` | `GET /api/habits` に再び表示される |
| T13-1-12 | 習慣の削除 | `DELETE /api/habits/{id}` | `{"ok":true}`、一覧から消える |
| T13-1-13 | 習慣削除 → habit_logs も削除 | habits + habit_logs あり → DELETE | habit_logs テーブルからも当該 habit_id の行が削除される |
| T13-1-14 | サーバー再起動後の永続性 | 習慣作成 → 再起動 → `GET /api/habits` | 習慣が残っている |

```bash
# 習慣作成の例
curl -s -X POST http://localhost:5000/api/habits \
  -H "Content-Type: application/json" \
  -d '{"title":"朝30分読書","category":"learning","tags":["読書"]}'
```

---

## T14: 習慣ログ API（今日の達成記録）

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T14-1 | 今日の達成を記録 | `POST /api/habits/{id}/log` body: `{"date":"2026-04-21","done":true}` | `{"ok":true}`、habit_logs に1行挿入 |
| T14-2 | 今日の達成を取り消し | `POST /api/habits/{id}/log` body: `{"date":"2026-04-21","done":false}` | habit_logs の該当行が done=0 に更新 |
| T14-3 | 同じ日に2回 POST（done:true → done:false） | 連続2回 POST | UPSERT により最新値で上書き（重複行が生まれない） |
| T14-4 | 過去の日付を記録 | date="2026-04-01" → POST | 正常に記録される |
| T14-5 | 存在しない habit_id | `POST /api/habits/INVALID/log` | 404 |
| T14-6 | date フォーマット不正 | date="2026/04/21" | 400 + `{"error":"invalid date format"}` |
| T14-7 | date 欠落 | body に date なし | 400 + `{"error":"date is required"}` |
| T14-8 | 習慣ログ一覧取得 | `GET /api/habits/{id}/logs?days=30` | 直近30日分の `[{date, done}, ...]` が返る |
| T14-9 | logs の日付降順 | 複数日記録後 `GET /api/habits/{id}/logs` | date 降順で返る |
| T14-10 | 記録のない日は含まれない | 10日中3日記録 → GET | 3件のみ返る（done=false の行も含む） |

---

## T15: 継続率計算テスト

継続率 API または内部ロジックの単体テスト。

### T15-1: `calculate_continuity_rate(habit_id, days)`

| ID | 入力条件 | 期待出力 |
|----|---------|----------|
| T15-1-1 | 30日間、全日達成 | `rate: 1.0` (100%) |
| T15-1-2 | 30日間、15日達成 | `rate: 0.5` (50%) |
| T15-1-3 | 30日間、ログなし | `rate: 0.0` (0%) |
| T15-1-4 | 作成から5日、3日達成 | `rate: 0.6` (作成日以降で計算) |
| T15-1-5 | done=false の記録は未達成扱い | done=false を10件 → 30日計算 | 達成0件として計算 |
| T15-1-6 | days=7 で直近7日のみ集計 | 30日ログあり、直近7日を指定 | 直近7日のみ集計 |

### T15-2: 連続達成日数（ストリーク）計算

| ID | 入力条件 | 期待出力 |
|----|---------|----------|
| T15-2-1 | 今日まで連続5日達成 | `current_streak: 5` |
| T15-2-2 | 今日未記録、昨日まで連続3日 | `current_streak: 3`（今日は未チェックでも継続扱い） |
| T15-2-3 | 昨日未達成（done=false） | `current_streak: 0` |
| T15-2-4 | ログなし | `current_streak: 0` |
| T15-2-5 | 過去最長ストリークの記録 | 10日連続 → 2日休み → 5日連続 | `best_streak: 10`, `current_streak: 5` |
| T15-2-6 | 全日達成でベストと現在が一致 | 30日連続 | `best_streak == current_streak == 30` |

### T15-3: `GET /api/habits/{id}/stats` — 統計 API

| ID | テストケース | 期待レスポンスキー |
|----|-------------|-----------------|
| T15-3-1 | 統計レスポンス構造 | `rate_7d`, `rate_30d`, `rate_90d`, `current_streak`, `best_streak`, `total_done` が全て存在する |
| T15-3-2 | total_done の計算 | done=true のログが7件 → `total_done: 7` |
| T15-3-3 | 存在しない habit_id | `GET /api/habits/INVALID/stats` | 404 |

---

## T16: 習慣 × マトリクス表示テスト（フロントエンド）

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T16-1 | 習慣がマトリクスの Q2 に表示される | 習慣作成後にマトリクスを確認 | Q2（重要・非緊急）エリアに習慣カードが表示される |
| T16-2 | 習慣カードの外観がタスクと区別できる | 習慣カードに習慣専用のバッジ or スタイルがある | タスクカードとビジュアル的に区別できる |
| T16-3 | 習慣カードに今日の達成チェックボタンが表示 | 習慣カード上に「今日やった」ボタンがある | クリックで `/api/habits/{id}/log` が呼ばれる |
| T16-4 | 今日達成済みの習慣カードは達成状態を示す | チェック後 | カードのスタイルが変わる（例: 緑のチェックマーク） |
| T16-5 | active=false の習慣はマトリクスに出ない | 習慣を一時停止 | Q2 から消える |
| T16-6 | 習慣カードをクリックするとサイドバーが開く | クリック | 習慣の詳細サイドバーが開く |

---

## T17: 習慣タブ（タスクパネル内）テスト

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T17-1 | 「習慣」サブタブが存在する | タスクパネルに「習慣」タブがある | タブクリックで習慣一覧が表示される |
| T17-2 | 習慣一覧の表示 | 習慣3件 → 習慣タブを開く | 3件がリスト表示される |
| T17-3 | 習慣の追加ボタン | 「＋ 習慣を追加」クリック | 習慣作成モーダルが開く |
| T17-4 | 習慣作成モーダルの入力項目 | モーダルを開く | title, category, tags, frequency, notes が入力できる |
| T17-5 | 習慣作成モーダルの送信 | 必須項目入力 → 「追加する」クリック | `POST /api/habits` が呼ばれ、一覧に追加される |
| T17-6 | 習慣一覧に継続率サマリーが表示される | 習慣タブを開く | 各習慣に「30日継続率 xx%」または「ストリーク x日」が表示される |
| T17-7 | 今日の達成チェック | 習慣タブで「今日やった」をクリック | 視覚的に達成状態が変わる |

---

## T18: 草グラフ（ヒートマップ）UI テスト

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T18-1 | 習慣サイドバーに草グラフが表示される | 習慣をクリック → サイドバー | 過去90日分のカレンダーグリッドが表示される |
| T18-2 | 達成日は緑色で表示される | done=true のログがある日 | 対応するマスが緑系のカラーで表示される |
| T18-3 | 未達成日（done=false）はグレーで表示 | done=false のログがある日 | グレーのマスで表示される |
| T18-4 | ログなしの日は薄グレーで表示 | 記録のない日 | 薄いグレーのマスで表示される |
| T18-5 | 現在のストリーク数が大きく表示される | ストリーク5日継続中 | 「🔥 5日連続」または同等の表示がある |
| T18-6 | 継続率（30日）が数値表示される | 30日中20日達成 | 「30日達成率 67%」が表示される |
| T18-7 | マスにホバーすると日付が表示される | グリッドのマスにホバー | ツールチップ or title 属性で日付が確認できる |
| T18-8 | 習慣を追加してもグラフは空から始まる | 新規習慣 → サイドバー | 全マスが薄グレー（ログなし状態） |

---

## T19: 今日のタスクタブ テスト

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T19-1 | 習慣が今日のタスクタブに表示される | deadline=今日のタスク + 習慣がある場合 | 両方が「今日のタスク」タブに表示される |
| T19-2 | 今日達成済みの習慣は区別して表示 | 習慣を今日達成済み → 今日タブを確認 | 達成済みの習慣はスタイルが変わる（例: チェック済みの見た目） |
| T19-3 | active=false の習慣は今日タブに出ない | 習慣を一時停止 → 今日タブ確認 | 今日タブに表示されない |

---

## T20: エラーハンドリング・境界値テスト（習慣）

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T20-1 | habits テーブルなしで GET /api/habits | init_db() で自動作成される | エラーなし |
| T20-2 | habit_logs テーブルなしで POST /api/habits/{id}/log | init_db() で自動作成される | エラーなし |
| T20-3 | habit_logs が大量（365件）あっても正常動作 | 1年分のログ記録 → `GET /api/habits/{id}/stats` | 正常なレスポンス |
| T20-4 | frequency が不正値 | frequency="weekly2" | 400 + `{"error":"invalid frequency"}` |
| T20-5 | 削除済み習慣のログ取得 | 習慣を削除後 `GET /api/habits/{id}/logs` | 404 |

---

## T21: シナリオテスト（習慣 E2E）

### シナリオ D: 習慣の登録から草グラフ確認まで

```
1. 習慣タブを開く
2. 「＋ 習慣を追加」をクリック
3. タイトル「毎朝30分読書」、カテゴリー「learning」を入力して「追加する」
4. 習慣一覧に追加されたことを確認
5. マトリクスの Q2 に習慣カードが表示されることを確認
6. 習慣カードの「今日やった」をクリック
7. カードが達成済みスタイルに変わることを確認
8. 習慣をクリックしてサイドバーを開く
9. 草グラフで今日のマスが緑になっていることを確認
10. ストリーク「1日連続」が表示されることを確認
```

### シナリオ E: 5日間の継続率確認

```
1. 習慣を作成
2. POST /api/habits/{id}/log で 5日分（2026-04-17〜21）の done=true を記録
3. GET /api/habits/{id}/stats を呼ぶ
4. current_streak: 5, rate_7d >= 0.71 を確認
5. 習慣サイドバーの草グラフで5日分が緑になっていることを確認
```

### シナリオ F: 移行後の全機能動作確認

```
1. tasks.json と projects.json にデータがある状態でサーバーを起動
2. 移行処理が実行されることを確認（ログ or DB 確認）
3. GET /api/tasks が移行前と同じデータを返すことを確認
4. GET /api/projects が移行前と同じデータを返すことを確認
5. タスクを新規作成 → DB に挿入されることを確認
6. タスクをアーカイブ → archived_tasks テーブルに移動
7. GET /api/report が正常に動作することを確認
```

---

## テスト実行チェックリスト（追加分）

```
[ ] archive.db に tasks / projects / behavior_logs / habits / habit_logs テーブルが存在する
[ ] tasks.json / projects.json が空でもサーバーが起動する
[ ] tasks.json / projects.json が存在しなくてもサーバーが起動する
[ ] 移行処理は冪等である（2回実行しても重複データが生まれない）
[ ] python -m py_compile db.py storage.py app.py analyze.py が通る
[ ] python analyze.py がエラーなく完了する（behavior_logs テーブルから読み込む）
[ ] GET /api/tasks, GET /api/projects, GET /api/habits が 200 を返す
[ ] POST /api/habits → POST /api/habits/{id}/log → GET /api/habits/{id}/stats が動作する
```

---

## 優先テスト順序

1. **T9** (移行) — データ損失がないことを最初に確認
2. **T10〜T12** (既存 API の SQLite 回帰) — 移行後も既存機能が壊れていないこと
3. **T13〜T15** (習慣 CRUD + 継続率) — バックエンドの新機能
4. **T16〜T18** (習慣 UI + 草グラフ) — フロントエンドの新機能
5. **T19** (今日タブへの習慣表示) — 既存 UI との統合
6. **T20** (エラーハンドリング) — 堅牢性
7. **T21** (E2E シナリオ) — 統合動作
