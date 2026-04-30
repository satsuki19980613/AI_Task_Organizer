# GTD 改修 — 実装計画・進捗管理

**作成日**: 2026-04-24
**対象**: [GTD_DESIGN.md](GTD_DESIGN.md) / [GTD_TEST_SPEC.md](GTD_TEST_SPEC.md)

---

## 進捗ステータスの記法

| 記号 | 意味 |
|------|-----|
| `[ ]` | 未着手 |
| `[~]` | 進行中 |
| `[x]` | 完了 |
| `[!]` | ブロック中（理由を備考欄に） |

---

## フェーズ一覧（依存関係）

```
Phase 0: 決定事項の最終確認・未決事項クローズ
    ↓
Phase 1: バックエンド基盤（スキーマ・マイグレーション）
    ↓
Phase 2: 削除（レポート・プロジェクトAI・旧プロンプト）
    ↓
Phase 3: バックエンド API 新規実装（分類・下書き・今日/明日・レビュー）
    ↓
Phase 4: フロントエンド書き換え（チャット / マトリクス / 各タブ）
    ↓
Phase 5: 習慣機能のフォーム化・weekday 対応
    ↓
Phase 6: 週次レビュー画面
    ↓
Phase 7: 統合テスト・E2E
    ↓
Phase 8: ドキュメント最終更新・リリース
```

Phase 4 と 5 は疎結合なので並行可能。それ以外は原則順次。

---

## Phase 0: 未決事項クローズ ✅ 完了（2026-04-24）

**目的**: 実装着手前に残論点の方針確定。

- [x] **0.1** 週次レビュー完了記録の保存先 — **決定**: `archive.db` に `weekly_reviews` テーブル新規追加（GTD_DESIGN.md Sect.2.6）
- [x] **0.2** `scheduled_for` の自動リセットタイミング — **決定**: 初回アクセス時の lazy rollover。`data/state.json` の `last_rollover_date` で1日1回ガード（GTD_DESIGN.md Sect.4.6）
- [x] **0.3** 既存プロジェクトUIの扱い — **決定**: UIは完全削除。データは `data/projects.json` を凍結保存、API は 501 Not Implemented（GTD_DESIGN.md Sect.8.5, 8.6, 10.2）
- [x] **0.4** 下書きの保存期間 — **決定**: 7日。`DRAFT_RETENTION_DAYS=7`、GET `/api/drafts` 先頭で遅延削除（GTD_DESIGN.md Sect.4.7）
- [x] **0.5** 2分ルールタスクの deadline 設定 — **決定**: 今日固定（GTD_DESIGN.md Sect.3 フロー図内）

**完了条件**: 上記5項目の決定内容を GTD_DESIGN.md に反映済み。Sect.11 は決定済み一覧として機能。

---

## Phase 1: バックエンド基盤 ✅ コード実装完了（2026-04-24）

> 備考: 本Phaseはコード実装まで。実データへの `scripts/migrate_to_gtd.py` 実行は Phase 2 着手前に別途手動実施する。

### 1.1 設定追加 ✅
- [x] `config.py` に以下を追加
  - [x] `URGENCY_THRESHOLD_DAYS = 3`
  - [x] `CALENDAR_MIGRATION_DAYS = 1`
  - [x] `DRAFT_RETENTION_DAYS = 7`
  - [x] `STATE_FILE = os.path.join(DATA_DIR, 'state.json')`
  - [x] `VALID_GTD_STATUS` セット
  - [x] `CLASSIFY_QUESTIONS` 辞書

### 1.2 DB スキーマ変更 ✅
- [x] `db.py` の `init_db()` 修正
  - [x] `tasks` に GTD カラム7個（`gtd_status`, `is_draft`, `scheduled_date`, `scheduled_for`, `waiting_for`, `is_two_minute`, `completed_at`）を ALTER TABLE で追加
  - [x] `habits` に `weekday INTEGER` カラム追加（ALTER TABLE）
  - [x] `behavior_logs` テーブル DROP（init_db 内で DROP IF EXISTS、冪等）
  - [x] `weekly_reviews` テーブル新規追加（CREATE TABLE IF NOT EXISTS）
- [x] `migrate_from_json()` から `behavior_logs` 参照を除去（DROP 後に参照すると落ちるため）
- [x] `row_to_task_full()` を GTD 対応（`is_draft`/`is_two_minute` を bool 化、`importance`/`category` の空文字は `None` で返却）

### 1.3 storage.py 拡張 ✅
- [x] `save_tasks()` を新スキーマ対応に更新（GTD 7カラム対応、`None` は DB 上で空文字格納）
- [x] `load_state()` / `save_state()` を追加（`data/state.json` の I/O）
- [x] 初期値: `{"last_rollover_date": null, "last_draft_cleanup": null}`

### 1.4 マイグレーションスクリプト ✅
- [x] `scripts/migrate_to_gtd.py` 新規作成
  - [x] `data/` 全体を `data_backup_YYYYMMDD/` にコピー（衝突時は連番サフィックス）
  - [x] 既存 `data/tasks.json` 全件 + `tasks` テーブル既存行 を `archive.db` の `archived_tasks` に退避
  - [x] `data/tasks.json` を `[]` に初期化、`tasks` テーブルも空に
  - [x] `data/task_analysis_report.json` 削除
  - [x] `data/task_behavior_log.jsonl` 削除
  - [x] DB 上の `behavior_logs` DROP
  - [x] `init_db()` 呼び出しで新スキーマ適用（habits.weekday、weekly_reviews）
  - [x] `data/state.json` 初期化
  - [x] 冪等性（2回目実行でエラーにならない設計：`INSERT OR IGNORE`、`DROP IF EXISTS`、`CREATE IF NOT EXISTS`、`ALTER` は try/except で吸収）
- [ ] 手動実行 & 検証（T1-2）← ユーザー側で実行

### 1.5 ヘルパー関数 ✅
- [x] 新規 `gtd.py` に以下を実装:
  - [x] `calculate_urgency(task) -> str`
  - [x] `check_deadline_migration(task) -> task`
  - [x] `check_is_draft(task) -> bool`（必須項目が揃っているか判定）
  - [x] `apply_gtd_defaults(task) -> task`（新規作成時のデフォルト付与）
  - [x] `rollover_scheduled_for()` — lazy rollover（state.json ガード）
  - [x] `cleanup_old_drafts()` — 7日超の下書き削除（state.json ガード）

**完了条件**: `py_compile` 5ファイル（config/db/storage/gtd/migrate_to_gtd）エラーなし ✅、ラウンドトリップ・スモーク確認済み ✅、`scripts/migrate_to_gtd.py` の手動実行は Phase 2 着手前に別途実施。

---

## Phase 2: 削除フェーズ ✅ 完了（2026-04-24）

### 2.1 ファイル削除 ✅
- [x] `analyze.py` 削除
- [x] `data/task_analysis_report.json` 削除（migrate_to_gtd.py で実施、確認済み）
- [x] `data/task_behavior_log.jsonl` 削除（同上、確認済み）

### 2.2 app.py からの削除 ✅
- [x] `log_event` ハンドラ（`/api/log`）削除
- [x] `get_report` ハンドラ（`/api/report`）削除
- [x] `analyze_ai` ハンドラ（`/api/analyze/ai`）削除
- [x] `from analyze import run_analysis` import 削除 (`ANALYSIS_FILE`, `PROJECT_HISTORY_LIMIT` も除去)
- [x] `api_chat` 内の `[[PROJECT:]]`, `[[HABIT:]]`, `[[TASK:]]` 抽出ロジック削除
- [x] `task_chat` 内の `[[UPDATE_STEP:]]` 抽出ロジック削除 + プロンプト簡素化
- [x] `project_next_step`, `phase_chat` を 501 Not Implemented に変更（`{"error": "project feature frozen in GTD refactor", "status": "not_implemented"}`）

### 2.3 CLAUDE.md の更新 ✅
- [x] "Task Creation Flow" セクション削除
- [x] "Project Creation Flow" セクション削除
- [x] "Habit Creation Flow" セクション削除
- [x] "Example Flow" セクション削除
- [x] "詳細設定相談モード" セクションを追加（[[DETAIL:...]] 出力仕様、Example Flow 付き）
- [x] "AI 呼び出しパターン" / "AI 出力ブロック形式" を新方針に更新
- [x] "API エンドポイント一覧" を更新（削除されたエンドポイント明示、501 表示、Phase 3 追加予定記載）
- [x] "分析スコアリング" / "改修時チェックリスト" を GTD 版に更新

### 2.4 フロントエンド削除 ✅
- [x] `static/js/main.js` のレポートタブ関連コード削除（`renderReportPanel` / `buildReportHTML` / `initReportCharts` / `reportCharts` / タブハンドラ / ボタンハンドラ）
- [x] `static/js/main.js` の `logEvent` を no-op 化（呼び出し元多数のため関数シグネチャのみ残置）
- [x] `templates/index.html` のレポートタブ HTML 削除（`#panel-report`、タブボタン）
- [x] `static/css/style.css` のレポート関連スタイル削除（`.report-*`, `.attention-*`, `.chart-*`, `.ai-result-*` およびメディアクエリ）
- [x] Chart.js の読み込み削除（`<script src="chart.js">`）

**完了条件**: ✅ 全項目パス、`py_compile` 通過、主要エンドポイントの疎通確認 OK、旧パターンは「禁止事項の説明」「削除済みの注釈」「旧仕様書（docs/CONVENTIONS.md 等、Phase 8 更新予定）」にのみ残存。

---

## Phase 3: バックエンド API 新規実装 ✅ 完了（2026-04-25）

### 3.1 タスク CRUD の拡張 ✅
- [x] POST `/api/tasks` — `apply_gtd_defaults()` + `check_is_draft()` 適用、urgency 自動計算
- [x] PUT `/api/tasks/<id>` — 更新後に `check_is_draft()` / `calculate_urgency()` 実行、gtd_status バリデーション、`completed=True` 遷移時に `completed_at` / `gtd_status='done'` を自動付与
- [x] GET `/api/tasks` — 先頭で `rollover_scheduled_for()`、全タスクに `check_deadline_migration()` と urgency 再計算を適用、差分があれば永続化

### 3.2 新規エンドポイント ✅
- [x] POST `/api/tasks/collect` — 複数タイトル一括 inbox 作成（空文字列除外、201 返却）
- [x] POST `/api/tasks/classify` — 分類結果の一括反映（不正 gtd_status は 400、urgency / is_draft 再計算）
- [x] POST `/api/tasks/<id>/finalize` — 必須項目揃いで is_draft=false、不足なら 400 + `missing` リスト
- [x] POST `/api/tasks/<id>/schedule` — scheduled_for 設定（today / tomorrow / null のみ許可）
- [x] GET `/api/drafts` — 先頭で `cleanup_old_drafts()`、is_draft=true を created_at 降順で返却
- [x] GET `/api/today` — 先頭で `rollover_scheduled_for()`、scheduled_for='today' or scheduled_date=today のタスク + daily/weekly(該当曜日) 習慣
- [x] GET `/api/tomorrow` — 明日分、同じロジック
- [x] POST `/api/review/complete` — `weekly_reviews` テーブルに記録（月曜始まり週境界を自動算出）
- [x] GET `/api/review/summary` — drafts / next_actions / waiting / someday / trash / next_week_calendar / this_week_done を集計

### 3.3 詳細相談チャットの改修 ✅
- [x] POST `/api/tasks/<id>/chat` — 新プロンプト（docs/GTD_DESIGN.md Sect.7.2）、旧 `[[TASK:]]`/`[[UPDATE_STEP:]]` は明示的に禁止
- [x] `[[DETAIL:{...}]]` 抽出ロジック + `_sanitize_detail_proposal()` でフィールド制限、`detail_proposal` フィールドで返却

**完了条件**: ✅ Flask test_client による疎通 66/66 PASS、py_compile 通過、主要ケース（deadline migration 冪等、finalize の missing 判定、2分ルール、waiting への classify）すべて期待通り。

---

## Phase 4: フロントエンド書き換え（タスク系） ✅ 完了（2026-04-25）

### 4.1 チャットタブ ✅
- [x] 初期画面: タスク/頭の整理ボタン + 下書き件数カード（`#btn-collect-tasks` / `#btn-open-dump` / `.drafts-card`）
- [x] 下書きカードクリック → 該当タスクの詳細設定画面遷移（`renderChatWelcome` で動的生成、クリックで `openDetailSettings`）

### 4.2 タスク収集UI ✅
- [x] 複数テキストボックス入力（`#collect-rows` 内に動的に行を生成）
- [x] ⊕ ボタンで追加 / Enter キーでも追加
- [x] 「次へ：仕分け」ボタン → `POST /api/tasks/collect` で一括登録、`startClassifyFlow()` 起動

### 4.3 静的仕分けフロー ✅
- [x] Q1〜Q6 の分岐UIコンポーネント（`#classify-backdrop` モーダル + `nextQuestionOrOutcome()` 純関数）
- [x] 戻るボタン（answers 配列を pop して再描画、回答保持）
- [x] 仕分け完了後 POST `/api/tasks/classify`、is_draft=true があれば自動で詳細設定モーダルを起動

### 4.4 詳細設定モーダル ✅
- [x] next_action / calendar / waiting ごとの必須フォーム切替（`toggleDsStatusFields()` で deadline / scheduled_date / waiting_for を切り替え）
- [x] AI チャット領域（`/api/tasks/<id>/chat` 呼出 → `[[DETAIL:]]` 抽出 → `applyDetailProposal()` でフォームへ反映）
- [x] 「決定」ボタンの活性制御（`updateDsFinalizeButton()` + `dsMissingFields()`）
- [x] モーダル閉じ = 自動保存（`closeDetailSettings(true)` → `saveDetailSettingsDraft()` で is_draft=true のまま PUT）

### 4.5 マトリクスタブ ✅
- [x] `getVisibleTasks()` を `is_draft=false && gtd_status='next_action'` フィルタに書換
- [x] マトリクス/リストビュー切替（リストはタスク重要度・期限で並び替え）
- [x] 右サイドに今日/明日パネル（`.daily-panel` flex 配置、`switchDailyTab()` で切替）
- [x] D&D で `scheduled_for` 設定（`scheduleTaskToSlot()` → `POST /api/tasks/<id>/schedule`、マトリクスに残す）

### 4.6 カレンダータブ / 待機中タブ / いつかタブ ✅
- [x] 各ステータスの一覧表示（`renderStatusListTab(status)` で gtd_status 別に描画）
- [x] 基本的な操作（編集 → 詳細モーダル / 完了 → done+archive / 次にやるへ昇格 / ゴミ箱）

### 4.7 週次レビュー（先取り実装）✅
- [x] 7 ステップカード一覧 + 件数バッジ（`/api/review/summary` から取得）
- [x] ステップ別タスク表示 + アクション（昇格・完了・ゴミ箱・復元・完全削除）
- [x] 完了ボタン → `POST /api/review/complete`

**完了条件**: ✅ JS 構文チェック通過（node --check）、Flask test_client で 8/8 主要エンドポイント疎通、HTML レンダリングで 12/12 GTD UI 要素確認、py_compile 通過。

---

## Phase 5: 習慣機能（フォーム化・weekday）✅ 完了（2026-04-25）

### 5.1 DB / API ✅
- [x] `habits` テーブルに weekday カラム（Phase 1 で実施済み）
- [x] POST `/api/habits` — weekday バリデーション追加（weekly のとき 0〜6 必須、daily は NULL に強制）
- [x] PUT `/api/habits/<id>` — weekday 更新対応 + frequency 変更時の整合性チェック
- [x] GET `/api/habits` — レスポンスに weekday を含める（`row_to_habit` 経由で自動）
- [x] GET `/api/today` / `/api/tomorrow` — `_habits_for_date()` で daily 常時 + weekly は曜日一致時のみ

### 5.2 フロントエンド ✅
- [x] タスクタブ内「習慣」サブタブ（既存）
- [x] 新規作成フォーム（title / category / frequency / weekday / tags / notes）— `#habit-form-backdrop` モーダル
- [x] frequency=weekly 選択時のみ weekday プルダウン表示（`toggleHabitWeekdayField()`）
- [x] 既存の habits 一覧は維持
- [x] チャットタブの習慣作成フロー削除（empty state のチャット誘導文言を「＋ 習慣を追加」ボタンに差し替え）

### 5.3 今日/明日パネルへの習慣表示 ✅
- [x] daily は常時表示（`_habits_for_date()` 内 `freq == 'daily'` 分岐）
- [x] weekly は weekday 一致時のみ表示（同関数 `weekday != target_weekday` で continue）
- [x] マトリクスへは表示しない（`getVisibleTasks()` は tasks のみ、habit-list / daily-panel に分離）

**完了条件**: ✅ Flask test_client による 23/23 PASS（POST/PUT weekday 検証、today/tomorrow フィルタ、frequency 変更整合性）、py_compile / node --check 通過。

---

## Phase 6: 週次レビュー画面 ✅ 完了（2026-04-25）

> 大半は Phase 4.7 で先取り実装済み。Phase 6 は仕上げ・検証・round-trip 補強のみ。

### 6.1 UI ✅
- [x] 「週次レビュー」タブ新設（`#panel-review`、`.tab-btn[data-tab="review"]`）
- [x] Step 1〜7 のカード表示（件数バッジ付、`renderReviewTab` が `/api/review/summary` から件数取得）
- [x] 各Step展開時のリスト + アクションボタン（`renderReviewStepDetail` + `buildReviewActions`）

### 6.2 API 連携 ✅
- [x] GET `/api/review/summary` で件数取得（drafts / next_actions / waiting / someday / trash / next_week_calendar / this_week_done + week_start/week_end）
- [x] 各アクション（昇格・完了・削除・復元）の実装（`handleReviewAction` で edit / done+archive / promote / someday / trash / restore / delete を分岐）
- [x] POST `/api/review/complete` でレビュー完了記録（`completeWeeklyReview`、成功後に `renderReviewTab()` を呼んで件数を再取得）

**完了条件**: ✅ Flask test_client 32/32 PASS（T9-1 summary、T9-2-1 someday→promote、T9-2-2 trash→DELETE、T9-2-3 trash→restore、T9-2-4 waiting→resolve、T9-3-1 complete 記録、T9-3-2 同週2回 OK、T9-3-3 月-日週境界）、py_compile / node --check 通過。

---

## Phase 7: 統合テスト ✅ 完了（2026-04-25）

> Flask test_client + subprocess.run モックによる自動スモークで T1〜T12 を網羅。`scripts/smoke_phase7.py` を都度作成 → 99/99 PASS を確認 → 削除（残置しない方針）。ブラウザコンソールエラー確認のみユーザー側で手動実施。

- [x] **7.1** T1〜T10 自動検証（Flask test_client） — 99/99 のうち T1-1, T2-1, T3-1〜4, T4-1〜2, T5-1〜2, T6-1〜3, T7-1〜3, T8-1, T9-1〜3, T10-1〜2 全て PASS
- [x] **7.2** T11 E2E シナリオをバックエンド経路で再現 — T11-1（収集→仕分け→各タブ反映）/ T11-2（2分ルール即実行→archive）/ T11-3（下書き保留→importance保持→deadline入力で確定）/ T11-4（期限切迫→calendar 自動遷移）/ T11-5（weekly 習慣の曜日配置）全て PASS
- [x] **7.3** T12 回帰テスト — braindump/save・braindump 一覧・diary 作成・diary/consolidate（source='diary' 記録）全て PASS（subprocess.run はモックで JSON 応答固定）
- [ ] **7.4** ブラウザ DevTools コンソールエラー確認 — **ユーザー側で手動実施**（http://localhost:5000 でタスク/カレンダー/待機中/いつか/週次レビュー/習慣タブを巡回し、Console に赤エラーが出ないこと、ネットワークパネルで 4xx/5xx が想定外に出ないことを確認）
- [x] **7.5** `python -m py_compile config.py db.py storage.py gtd.py app.py` — エラーなし、`node --check static/js/main.js` も OK
- [x] **7.6** 旧パターン grep — `app.py` で `analyze|behavior_log|\[\[TASK:|\[\[PROJECT:|\[\[HABIT:|\[\[UPDATE_STEP:` をヒットさせると 3 箇所（L616, L646, L794）が残存するが、いずれも「禁止指示プロンプト文」または「廃止コメント」であり抽出ロジックは無し（OK）

**完了条件**: ✅ GTD_TEST_SPEC.md の自動化可能なテストは全 99 項目 PASS。手動 E2E（ブラウザでの操作実演）はユーザー側で逐次実施可能な状態。

---

## Phase 8: ドキュメント最終更新 ✅ 完了（2026-04-25）

- [x] **8.1** `CLAUDE.md` を新仕様に全面更新 — 改修進行中バナー削除、ファイル構成・データモデル・API 一覧・GTD ワークフロー要約を GTD 版に差し替え。AI 役割（[[DETAIL:]] のみ）を整理。
- [x] **8.2** `docs/CONVENTIONS.md` を新ファイル構成に更新 — `analyze.py` 削除と `gtd.py` / `state.json` / `scripts/migrate_to_gtd.py` の責務を反映。マジックナンバー表に GTD 系定数を追加。AI ブロック形式は `[[DETAIL:]]` のみに。
- [x] **8.3** `docs/SPEC.md` を履歴参照用としてヘッダーで明示（GTD_DESIGN.md を正とする旨を冒頭に記載）。本文は変更せず保存。
- [x] **8.4** `docs/TEST_SPEC.md` / `docs/TEST_SPEC_SQLITE.md` も同様に履歴参照用ヘッダーを付与し、`GTD_TEST_SPEC.md` を正と明示。
- [x] **8.5** 本ファイル（GTD_IMPLEMENTATION_PLAN.md）の全チェックを埋めて凍結。
- [x] **デッドコード整理** — `static/js/main.js` から `FLOW_CONFIG` / `selectTaskType` / `initMilestone` / `resetMilestone` / `updateMilestoneFromResponse` / `renderMilestone` / `milestoneState` / `buildProposalHtml` / `buildHabitProposalHtml` / `buildProjectProposalHtml` および 6 個の旧 proposal クリックハンドラ（`btn-confirm-task` / `btn-modify-task` / `btn-confirm-project` / `btn-modify-project` / `btn-confirm-habit` / `btn-modify-habit`）を削除。`appendMessage` のシグネチャを `(role, content)` に簡素化、`sendChatMessage` から旧プロポーザル抽出を除去。`templates/index.html` から `chat-milestone-panel` aside を削除。`node --check` / `py_compile` 通過。

---

## リスク・留意点

| リスク | 影響度 | 緩和策 |
|-------|-------|-------|
| 既存 `tasks.json` のデータ損失 | 高 | マイグレーション前に `data/` ディレクトリを `data_backup_YYYYMMDD/` にコピー |
| Claude CLI のモデル指定失敗 | 中 | `sonnet` / `haiku` エイリアスが効かない場合は正式ID（`claude-sonnet-4-6`）にフォールバック |
| フロント書き換え中の動作不良 | 中 | ブランチ分離（`git checkout -b gtd-refactor`）で作業、mainへのマージは Phase 7 完了後 |
| 週次レビュー画面の複雑化 | 中 | MVP として Step 1〜5 のみで着手、6〜7 は Phase 6.5 として分離可 |
| `check_deadline_migration` の副作用（GETで書き込み） | 低 | 明示的にログを出し、テスト T5-2-2 で冪等性を必ず確認 |

---

## ブランチ・コミット戦略（推奨）

```
main
 └── gtd-refactor          (Phase 1〜7 を集約)
      ├── Phase 1: feat(gtd): add schema & migration script
      ├── Phase 2: chore(gtd): remove analyze & old prompts
      ├── Phase 3: feat(gtd): add classify / draft / today APIs
      ├── Phase 4: feat(gtd): rewrite task frontend
      ├── Phase 5: feat(gtd): habit form + weekday
      ├── Phase 6: feat(gtd): weekly review
      └── Phase 7: test(gtd): integration & e2e
```

main への merge は Phase 7 完了後、テストシナリオ T11 全成功を確認してから。

---

## 進捗サマリー

| Phase | 状態 | 完了日 | 備考 |
|-------|------|-------|------|
| 0 | `[x]` | 2026-04-24 | 未決5項目すべて決定、設計書に反映済み |
| 1 | `[x]` | 2026-04-24 | コード実装完了（config/db/storage/gtd/migrate スクリプト）。実データへの migrate 実行済み |
| 2 | `[x]` | 2026-04-24 | analyze.py 削除、app.py から log/report/analyze ハンドラ撤去、projects AI 系を 501、CLAUDE.md に詳細設定相談モード追加、フロントのレポートタブ/Chart.js 削除 |
| 3 | `[x]` | 2026-04-25 | タスク CRUD を GTD 統合（GET で rollover/deadline_migration/urgency 再計算、POST/PUT で is_draft 自動判定）。collect/classify/finalize/schedule/drafts/today/tomorrow/review/(summary\|complete) 9 エンドポイント追加。task_chat を [[DETAIL:]] モードに書換、`_sanitize_detail_proposal` 追加。Flask test_client 66/66 PASS |
| 4 | `[x]` | 2026-04-25 | 新タブ4つ（カレンダー/待機中/いつか/週次レビュー）+ 静的仕分けフロー(Q1-Q6) + 収集モーダル + 詳細設定モーダル(AI 相談込み) + 今日/明日パネル(D&D) を実装。マトリクスは is_draft=false && gtd_status=next_action フィルタ。プロジェクトサブタブ削除。週次レビュー UI も先取り実装。 |
| 5 | `[x]` | 2026-04-25 | habits API に weekday バリデーション追加（POST/PUT 双方）、frequency 変更時に weekday 整合性を強制。`#habit-form-backdrop` モーダル + `openHabitFormModal/saveHabitFromForm/toggleHabitWeekdayField` 実装。empty state のチャット誘導文言を撤去。Flask test_client 23/23 PASS（daily/weekly 作成・無効値拒否・today/tomorrow 曜日フィルタ・frequency 変更）。 |
| 6 | `[x]` | 2026-04-25 | Phase 4.7 で先取り実装済みの週次レビュー画面を検証・仕上げ。`completeWeeklyReview` 後に `renderReviewTab()` で summary 再取得を追加。Flask test_client 32/32 PASS（T9-1 summary 全件・週境界月-日、T9-2 promote/DELETE/restore/resolve、T9-3-1〜2 complete 記録 & 同週2回可）。 |
| 7 | `[x]` | 2026-04-25 | Flask test_client + subprocess モックで T1〜T12 自動スモーク 99/99 PASS（T1 スキーマ・T2 静的仕分け7パターン・T3 is_draft & 7日下書き削除冪等・T4 urgency・T5 deadline migration & 永続化冪等・T6 today/tomorrow & rollover・T7 habit weekday・T8 [[DETAIL:]]抽出・T9 review summary/操作/complete・T10 削除/凍結確認・T11 E2E5本・T12 braindump/diary 回帰）。py_compile / node --check / grep 旧パターン確認も完了。ブラウザ DevTools コンソールエラー確認のみユーザー側手動実施。 |
| 8 | `[x]` | 2026-04-25 | CLAUDE.md / docs/CONVENTIONS.md を GTD 版に全面更新。docs/SPEC.md / TEST_SPEC.md / TEST_SPEC_SQLITE.md は履歴参照用ヘッダーを付与し凍結。デッドコード整理（FLOW_CONFIG / Milestone 関連 4 関数 / selectTaskType / 3 つの proposal builder / 6 個の旧 proposal クリックハンドラ）を `static/js/main.js` から削除、`templates/index.html` から `chat-milestone-panel` を除去。`node --check` / `py_compile` 通過。 |

各フェーズ完了時にこの表を更新してください。

