# GTD v2 — テスト仕様書

**作成日**: 2026-04-25
**対象**: [GTD_DESIGN.md](GTD_DESIGN.md) v2 に基づく全面改訂
**前バージョン**: 2026-04-24 (v1)
**テスト実行者**: Claude Code (automated) / 開発者 (manual)

---

## 0. 構成概要

| レイヤー | テスト対象 | 形式 |
|---------|-----------|------|
| Backend API | Flask ルート、移動バリデーション、rollover、プロジェクト状態遷移、カテゴリ階層 | curl / pytest |
| Logic | `gtd.validate_move()`, `gtd.rollover_*()`, カテゴリ階層、プロジェクトstatus | py_compile + 単体 |
| Frontend | 3カラムD&D仕分け、GTDワークフロー図、プロジェクト管理、カテゴリ管理、見込み時間 | 手動（ブラウザ） |
| Migration | v1 → v2 マイグレーション、冪等性、データ保全 | 手動実行＋検証 |
| Regression | ブレインダンプ・日記・週次レビュー・習慣（変更なし機能） | 手動 + curl |

---

## 1. データモデル & マイグレーション (T1)

### T1-1: スキーマ整合性

| ID | テストケース | 期待結果 |
|----|-------------|---------|
| T1-1-1 | マイグレーション後の `tasks` テーブル | `estimate_minutes`, `category_id`, `project_sort_order` カラムが存在 |
| T1-1-2 | マイグレーション後の `projects` テーブル | `status`, `completion_condition`, `period_start`, `period_end`, `archived` カラムが存在 |
| T1-1-3 | `categories` テーブル新規作成 | テーブル存在、`is_system=1` の親カテゴリ5件が初期データとして存在 |
| T1-1-4 | 新規タスク作成 | `gtd_status='inbox'`, `is_draft=true`, `estimate_minutes=NULL`, `category_id=NULL`, `created_at` 自動付与 |
| T1-1-5 | v1 既存タスクの保全 | マイグレーション前のレコード件数 = マイグレーション後のレコード件数（破壊なし） |
| T1-1-6 | v1 既存 projects の処理 | 全レコードが `status='archived', archived=1` に設定 |
| T1-1-7 | v1 旧 `category` 文字列 → `category_id` 移行 | work→cat_work, learning→cat_input, social→cat_session、それ以外→cat_work |

### T1-2: マイグレーションスクリプト (`scripts/migrate_to_gtd_v2.py`)

| ID | テストケース | 期待結果 |
|----|-------------|---------|
| T1-2-1 | 初回実行 | 終了コード 0、標準出力に「migrated N tasks, M projects」表示 |
| T1-2-2 | バックアップ作成 | `archive_pre_v2_YYYYMMDD.db` がコピーされている |
| T1-2-3 | 冪等性: 2回連続実行 | 2回目も終了コード 0、ALTER TABLE は失敗せず（try/except で吸収）、CREATE は IF NOT EXISTS |
| T1-2-4 | state.json 更新 | `last_manual_rollover` キーが追加（既存値があれば保持） |
| T1-2-5 | 旧フィールド残置確認 | `importance`, `urgency`, `is_two_minute`, `phase_id`, `category` カラムは削除されていない |

### T1-3: v1 から v2 への ID 整合性

| ID | ケース | 期待結果 |
|----|--------|---------|
| T1-3-1 | v1 で作成済みタスクの id | v2 で同じ id で取得できる |
| T1-3-2 | アーカイブされたタスク | `archived_tasks` テーブルから引き続き取得できる |
| T1-3-3 | 既存 archive.db の習慣・週次レビュー記録 | 全件保持されている |

---

## 2. カテゴリ階層 (T2)

### T2-1: カテゴリ CRUD

| ID | 操作 | 期待結果 |
|----|------|---------|
| T2-1-1 | `GET /api/categories` | 5つの親カテゴリ + 全子カテゴリが階層構造で返る `{parents: [{id, name, children: [...]}]}` |
| T2-1-2 | `POST /api/categories` で `parent_id=cat_work, name="メール対応"` | 201 + 子カテゴリ作成成功 |
| T2-1-3 | `POST /api/categories` で `parent_id=null, name="個人"` | 201 + 親カテゴリ追加成功 |
| T2-1-4 | `PUT /api/categories/cat_work` で改名 | 400 (`is_system=1` は変更不可) |
| T2-1-5 | `DELETE /api/categories/cat_work` | 400 (`is_system=1` は削除不可) |
| T2-1-6 | ユーザー作成カテゴリの削除 | 200。子カテゴリも CASCADE で削除 |
| T2-1-7 | 削除されたカテゴリを使用中のタスク | `category_id` が NULL に更新される（FK は ON DELETE SET NULL ではなく、明示的にクリア） |

### T2-2: カテゴリ階層バリデーション

| ID | ケース | 期待結果 |
|----|--------|---------|
| T2-2-1 | 親カテゴリの parent_id を別の親に変更 | 400 (親は親のまま) |
| T2-2-2 | 子カテゴリを孫にする（多段階） | 400 (2階層のみサポート) |
| T2-2-3 | 自己参照 (`parent_id = self.id`) | 400 |

---

## 3. 移動バリデーション (T3)

### T3-1: ERROR レベル（D&D 拒否）

| ID | 入力 | 期待結果 |
|----|------|---------|
| T3-1-1 | `→ calendar` で `scheduled_date=NULL` | `{ok: false, level: "error", error: "...日付を設定...", missing: ["scheduled_date"]}` |
| T3-1-2 | `→ waiting` で `waiting_for=NULL` | `{ok: false, level: "error", error: "...相手を入力...", missing: ["waiting_for"]}` |
| T3-1-3 | `deadline` あり、`→ someday` | `{ok: false, level: "error", error: "期限を解除..."}` |
| T3-1-4 | `completed=true` で `→ next_action` | `{ok: false, level: "error", error: "...アーカイブから復元..."}` |
| T3-1-5 | エラー時のDB更新 | 拒否されたタスクは `gtd_status` が変わらない（永続化されない） |

### T3-2: CONFIRM レベル

| ID | 入力 | 期待結果 |
|----|------|---------|
| T3-2-1 | `scheduled_for='today'` で `→ trash` | `{ok: false, level: "confirm", error: "予定を解除...?", force_param: "force_clear_schedule"}` |
| T3-2-2 | force_param 付きで再送 | 200、`scheduled_for` クリアされ `gtd_status='trash'` に |
| T3-2-3 | プロジェクト子タスクを単独で `→ trash` | confirm（プロジェクトから外す） |

### T3-3: 正常移動

| ID | 操作 | 期待結果 |
|----|------|---------|
| T3-3-1 | `inbox → next_action` | 200, `gtd_status='next_action'`, `is_draft=true`（必須項目なし） |
| T3-3-2 | `inbox → trash`（保管庫） | 200, `gtd_status='trash'` |
| T3-3-3 | `someday → inbox`（オプションなしに戻す） | 200, `gtd_status='inbox'`, `is_draft=true` |
| T3-3-4 | `trash → inbox` | 200（レビューで戻すケース） |
| T3-3-5 | エラー時の永続化 | 失敗時はDBに変更が残らない（ロールバック挙動） |

### T3-4: バリデーション関数の単体テスト

| ID | 入力 | 期待 |
|----|------|------|
| T3-4-1 | `validate_move({status:inbox}, "calendar")` ※ scheduled_date 未設定 | `{ok: false, level: "error"}` |
| T3-4-2 | `validate_move({status:inbox, scheduled_date:"2026-05-01"}, "calendar")` | `{ok: true}` |
| T3-4-3 | `validate_move({status:next_action, deadline:"2026-05-01"}, "someday")` | `{ok: false, level: "error"}` |

---

## 4. rollover（手動 + 自動） (T4)

### T4-1: 自動 rollover（lazy）

| ID | ケース | 期待結果 |
|----|--------|---------|
| T4-1-1 | 翌日アクセス時の `GET /api/tasks` | `scheduled_for='today'` → NULL、`scheduled_for='tomorrow'` → `'today'` |
| T4-1-2 | 同日2回目のアクセス | rollover はスキップ（`last_rollover_date` 一致） |
| T4-1-3 | check_deadline_migration が動かないこと | `next_action` で `deadline=明日` のタスクが `calendar` に**遷移しない** |

### T4-2: 手動 rollover

| ID | エンドポイント | 期待結果 |
|----|--------------|---------|
| T4-2-1 | `POST /api/tasks/rollover/manual` body `{"timing": "morning"}` | 200, `last_manual_rollover` 更新, scheduled_for 更新 |
| T4-2-2 | 同日2回押下 | 2回目も成功するが、自動 rollover の `last_rollover_date` が同日のため scheduled_for 変更は実質発生しない |
| T4-2-3 | timing=invalid | 400 |
| T4-2-4 | 自動 rollover 後に手動押下 | 押下時刻だけ `last_manual_rollover` が更新される（scheduled_for は変化なし） |

### T4-3: rollover 廃止仕様の確認

| ID | 確認項目 | 期待結果 |
|----|---------|---------|
| T4-3-1 | `gtd.calculate_urgency` 関数 | **存在しない** |
| T4-3-2 | `gtd.check_deadline_migration` 関数 | **存在しない** |
| T4-3-3 | `is_two_minute` 関連の処理 | コードベースに存在しない（`grep -r "is_two_minute" gtd.py app.py` でヒットなし） |

---

## 5. AI 詳細設定相談 (T5)

### T5-1: `[[DETAIL:]]` 出力（v2 拡張）

| ID | ケース | 期待結果 |
|----|--------|---------|
| T5-1-1 | category 提案 | `[[DETAIL:{"category_id":"cat_work"}]]` 末尾、response から除去 |
| T5-1-2 | サブカテゴリ提案 | `[[DETAIL:{"category_id":"cat_user_001"}]]`（ユーザー追加カテゴリも対象） |
| T5-1-3 | estimate_minutes 提案 | `[[DETAIL:{"estimate_minutes":30}]]` |
| T5-1-4 | 複数フィールド | `[[DETAIL:{"category_id":"...","roadmap":[...],"estimate_minutes":...}]]` |
| T5-1-5 | 旧 `[[TASK:]]` 形式 | **返らない**（プロンプトから削除済み） |
| T5-1-6 | AI が仕分け判定を提案 | しない（プロンプトで明示禁止） |

### T5-2: フロントエンドの適用

| ID | ケース | 期待結果 |
|----|--------|---------|
| T5-2-1 | `[[DETAIL:{"estimate_minutes":30}]]` 受信 | 詳細フォームの「見込み時間」入力欄に 30 が反映 |
| T5-2-2 | `[[DETAIL:{"category_id":"cat_work"}]]` 受信 | 親カテゴリ Work が選択され、サブカテゴリは null |
| T5-2-3 | サブカテゴリ id 受信 | 親が自動展開され、サブが選択される |

### T5-3: モデル選択

| ID | ケース | 期待結果 |
|----|--------|---------|
| T5-3-1 | `/api/tasks/<id>/chat` | subprocess に `--model sonnet` |
| T5-3-2 | `/api/projects/<id>/chat` | subprocess に `--model sonnet` |
| T5-3-3 | `/api/braindump/save` / `/api/diary/consolidate` | `--model haiku` |

---

## 6. プロジェクト機能 (T6)

### T6-1: プロジェクト作成

| ID | 操作 | 期待結果 |
|----|------|---------|
| T6-1-1 | `POST /api/projects` body `{name, completion_condition, period_start, period_end}` | 201, `status='drafting'`, `archived=0` で作成 |
| T6-1-2 | プロジェクト化リストのタスク → 「プロジェクト化」ボタン | 元タスクの title がプロジェクト名に。元タスクは**削除**される |
| T6-1-3 | name 空欄 | 400 |
| T6-1-4 | completion_condition 空欄 | 201（任意フィールド） |

### T6-2: ドラフトタスクの追加

| ID | 操作 | 期待結果 |
|----|------|---------|
| T6-2-1 | `POST /api/projects/<id>/tasks` body `{title, estimate_minutes}` | 201, タスク作成、`project_id` 紐付け、`gtd_status='next_action'`, `is_draft=false` |
| T6-2-2 | drafting 状態のプロジェクトのタスク | `GET /api/tasks` の通常 next_action 一覧には**含まれない**（フィルタで除外） |
| T6-2-3 | プロジェクト詳細での子タスク取得 | `GET /api/projects/<id>/tasks` で全件取得可 |
| T6-2-4 | `project_sort_order` 自動割り振り | 既存タスクの最大値+10 が自動セット |

### T6-3: drafting → active 遷移

| ID | 操作 | 期待結果 |
|----|------|---------|
| T6-3-1 | `POST /api/projects/<id>/activate` | 200, `status='active'`、子タスクが next_action リストに表示 |
| T6-3-2 | 子タスク0件で activate | 400, `{error: "タスクを1件以上登録..."}` |
| T6-3-3 | active 状態で再 activate | 400 (既にactive) |
| T6-3-4 | active 後の `GET /api/tasks` | 子タスクが next_action として返る |

### T6-4: active 状態の追加タスク

| ID | 操作 | 期待結果 |
|----|------|---------|
| T6-4-1 | active プロジェクトに `POST /api/projects/<id>/tasks` | 201、即座に next_action として有効（drafting に戻らない） |
| T6-4-2 | active プロジェクトの「タスクを登録」ボタン | UI に表示されない |

### T6-5: プロジェクト用 AI 相談

| ID | ケース | 期待結果 |
|----|--------|---------|
| T6-5-1 | `POST /api/projects/<id>/chat` 通常会話 | response 文字列のみ、ブロック抽出なし |
| T6-5-2 | AI が `[[PROJECT_TASKS:{tasks:[...]}]]` 出力 | response から除去、`project_tasks_proposal` に格納して返却 |
| T6-5-3 | フロント: 提案を「決定」 | tasks 配列の各要素に対し `POST /api/projects/<id>/tasks` をループ実行 |
| T6-5-4 | `completion_condition` の更新提案 | `[[PROJECT_TASKS:{completion_condition:"..."}]]` で部分更新 |

### T6-6: プロジェクト3ビュー

| ID | ケース | 期待結果 |
|----|--------|---------|
| T6-6-1 | 進行中ビュー | `status='active'` & `period_start <= today` & `archived=0` のみ |
| T6-6-2 | 調整中ビュー | `status='drafting'` または `period_start > today` |
| T6-6-3 | 完了ビュー | `status='completed'` または `archived=1` |

### T6-7: プロジェクト完了

| ID | 操作 | 期待結果 |
|----|------|---------|
| T6-7-1 | `PUT /api/projects/<id>` body `{status:"completed"}` | `status='completed'`, `completed_at` 自動セット |
| T6-7-2 | 完了プロジェクトの子タスク | next_action から消え、done に自動遷移しない（タスクは個別管理） |

---

## 7. 見込み時間 (T7)

### T7-1: タスクへの設定

| ID | 操作 | 期待結果 |
|----|------|---------|
| T7-1-1 | `POST /api/tasks` body `{estimate_minutes: 30}` | 201, 30 が保存 |
| T7-1-2 | `PUT /api/tasks/<id>` で `estimate_minutes` 更新 | 200, 更新値が反映 |
| T7-1-3 | NULL 設定 | 200, NULL 反映 |
| T7-1-4 | 負数 (`estimate_minutes: -5`) | 400 |
| T7-1-5 | 文字列 (`estimate_minutes: "abc"`) | 400 |

### T7-2: 集計

| ID | ケース | 期待結果 |
|----|--------|---------|
| T7-2-1 | `GET /api/today` | 親カテゴリごとの合計 + 全体合計が含まれる |
| T7-2-2 | `estimate_minutes=NULL` のタスク | 0 として集計 |
| T7-2-3 | プロジェクト詳細 | 子タスクの合計時間が表示 |

### T7-3: AI 提案

| ID | ケース | 期待結果 |
|----|--------|---------|
| T7-3-1 | チャットで「30分くらいかかる」と発言 | AI が `[[DETAIL:{"estimate_minutes":30}]]` を返す |
| T7-3-2 | 既存 estimate_minutes を上書き提案 | 部分更新として扱われる |

---

## 8. 仕分け UI (T8)

### T8-1: 3カラムレイアウト

| ID | ケース | 期待結果 |
|----|--------|---------|
| T8-1-1 | タスクタブ表示 | 左/中央/右の3カラムが並ぶ |
| T8-1-2 | 左カラム | `gtd_status='inbox'` のタスクのみ |
| T8-1-3 | 中央カラム | next_action / waiting / calendar / project_pending / someday / trash の各リストが縦並び |
| T8-1-4 | 右カラム | GTDワークフロー図（SVG/HTML 静的） |
| T8-1-5 | リストの開閉 | ▼/▶ クリックで折り畳み |

### T8-2: D&D 動作

| ID | 操作 | 期待結果 |
|----|------|---------|
| T8-2-1 | 左 → 中央「次にやるべきこと」 | `POST /api/tasks/move` で `target_status='next_action'`、リストに追加表示 |
| T8-2-2 | 左 → 中央「カレンダー」（scheduled_date 未設定） | エラートースト「日付を設定してください」、移動失敗 |
| T8-2-3 | 中央のリスト間移動（someday → next_action） | 200, リストが切り替わる |
| T8-2-4 | 詳細サイドパネルから移動 | プルダウンで gtd_status 変更可 |

### T8-3: 中央カラムから今日/明日パネル

| ID | 操作 | 期待結果 |
|----|------|---------|
| T8-3-1 | 「次にやるべきこと」のタスクを今日パネルへ D&D | `scheduled_for='today'` 設定、タスクは中央リストに残る（消えない） |
| T8-3-2 | 今日パネルから戻す | `scheduled_for=NULL` |
| T8-3-3 | 親カテゴリでグルーピング | Output / Input / Work / Session / ルーティン |
| T8-3-4 | 見込み時間の合計 | カテゴリごと + 全体の合計が表示 |

### T8-4: 朝/夜リセットボタン

| ID | 操作 | 期待結果 |
|----|------|---------|
| T8-4-1 | 「☀️朝のリセット」ボタン押下 | `POST /api/tasks/rollover/manual {timing:"morning"}` 呼び出し、トースト「リセットしました」 |
| T8-4-2 | 「🌙夜のリセット」ボタン押下 | 同上、`timing="evening"` |
| T8-4-3 | リセット直後 | scheduled_for クリアされたタスクが中央リスト「次にやるべきこと」に表示 |

---

## 9. 廃止機能の確認 (T9)

### T9-1: マトリクス完全廃止

| ID | 確認項目 | 期待結果 |
|----|---------|---------|
| T9-1-1 | UI 上のマトリクスタブ | **存在しない** |
| T9-1-2 | `renderMatrix()` 関数 | **存在しない**（main.js に） |
| T9-1-3 | `QUADRANT_CONFIG` 定数 | **存在しない** |
| T9-1-4 | importance / urgency 入力UI | **存在しない** |

### T9-2: Q1〜Q6 ウィザード廃止

| ID | 確認項目 | 期待結果 |
|----|---------|---------|
| T9-2-1 | `POST /api/tasks/classify` | 404 |
| T9-2-2 | `POST /api/tasks/<id>/finalize` | 404 |
| T9-2-3 | `startClassifyFlow` 関数 | **存在しない** |
| T9-2-4 | `nextQuestionOrOutcome` 関数 | **存在しない** |
| T9-2-5 | `CLASSIFY_QUESTIONS` 定数 | **存在しない** |

### T9-3: 「すぐにやること」廃止

| ID | 確認項目 | 期待結果 |
|----|---------|---------|
| T9-3-1 | `is_two_minute` フィールド | DBに残置だが UI 上は表示されない、新規書き込みなし |
| T9-3-2 | 中央カラムのリスト | inbox/next_action/waiting/calendar/project_pending/someday/trash の7つ（「すぐにやること」なし） |
| T9-3-3 | 2分タスクの自動 importance/urgency 設定 | 動作しない |

---

## 10. 回帰テスト (T10)

変更のない機能の動作確認。

### T10-1: ブレインダンプ

| ID | ケース | 期待結果 |
|----|--------|---------|
| T10-1-1 | `POST /api/braindump/save` | Haiku 呼び出し成功、要約と theme_category が返る |
| T10-1-2 | `GET /api/braindump` | 過去セッション全件返る |

### T10-2: 日記

| ID | ケース | 期待結果 |
|----|--------|---------|
| T10-2-1 | `POST /api/diary` | 既存通り、body_score / emotion_score 保存 |
| T10-2-2 | `POST /api/diary/consolidate` | Haiku 呼び出し、brain_dump_sessions に source='diary' で保存 |

### T10-3: 週次レビュー

| ID | ケース | 期待結果 |
|----|--------|---------|
| T10-3-1 | `GET /api/review/summary` | 各 Step の件数返却（v2 で Step 名が変わっても件数取得は機能） |
| T10-3-2 | `POST /api/review/complete` | weekly_reviews テーブルに記録 |
| T10-3-3 | someday/trash からオプションなしに戻すボタン | レビュー画面で利用可能 |

### T10-4: 習慣

| ID | ケース | 期待結果 |
|----|--------|---------|
| T10-4-1 | `POST /api/habits` (daily) | 201, 作成成功 |
| T10-4-2 | `POST /api/habits` (weekly, weekday=2) | 201, 作成成功 |
| T10-4-3 | weekly で weekday 未指定 | 400 |
| T10-4-4 | `GET /api/today` で習慣含まれる | daily + 該当曜日の weekly 両方が返る |

---

## 11. E2E シナリオ (T11)

### T11-1: ブレインダンプ → 仕分け → 実行（基本フロー）

```
シナリオ: ユーザーが日々のタスクを書き出して仕分け、実行する

1. 頭の整理タブでブレインダンプ → 「タスク化」ボタン
2. 5つのタスクが「オプションなし」リストに追加
3. 各タスクを D&D で仕分け:
   - タスクA → 次にやるべきこと
   - タスクB → カレンダー（先に日付モーダル → 日付入力）
   - タスクC → ゴミ箱
   - タスクD → いつかやる
   - タスクE → 依頼中（先に waiting_for 入力）
4. 「次にやるべきこと」リストから今日パネルへ D&D
5. 今日パネルでタスクA を完了 → done 表示
6. 朝/夜リセットボタンで未完了の scheduled_for をクリア

期待: D&D で全工程がスムーズ、AI 不使用、エラーなし
```

### T11-2: AI 詳細相談

```
1. オプションなしのタスク「年末調整」を右クリック → 詳細
2. AI チャット欄で「期限はいつごろまで？」
3. AI が「11月末〜12月初旬が一般的です」回答
4. 「30分でできそう」→ AI が `[[DETAIL:{"estimate_minutes":30}]]`
5. 「ステップを考えて」→ AI が roadmap 提案
6. 「決定」 → category_id, estimate_minutes, roadmap が保存

期待: AI は補助のみ、仕分け判断は AI が出さない
```

### T11-3: プロジェクト作成 → 稼働 → 完了

```
1. オプションなし「プレゼン準備」を D&D → プロジェクト化
2. プロジェクト化リストの「プレゼン準備」を右クリック → プロジェクト化
3. モーダル: completion_condition「会議で発表完了」、period 入力
4. プロジェクト作成（status=drafting）、元タスクは消滅
5. プロジェクト詳細パネルが開く
6. AIに相談 → 「[[PROJECT_TASKS:{tasks:[5件]}]]」提案
7. 決定 → 5タスクがドラフトとして登録
8. 「✅ タスクを登録」 → 確認ダイアログ → activate
9. status=active になり、5タスクが next_action に出現
10. 1タスクを完了 → next_action から消える、プロジェクトの「次のアクション」が次のタスクへ

期待: drafting 中は next_action に出ず、active 後は出る
```

### T11-4: ゴミ箱からの復活

```
1. someday リストのタスクを D&D → ゴミ箱
2. 数日後、週次レビューでゴミ箱を確認
3. 「やっぱりやる」と判断 → タスクを D&D で オプションなし に戻す
4. 改めて仕分け → 次にやるべきこと

期待: ゴミ箱は削除ではなく保管。レビューで戻せる
```

### T11-5: カテゴリ階層管理

```
1. カテゴリ管理モーダルを開く
2. Work 配下に「会議準備」サブカテゴリを追加
3. 既存タスクの category を「会議準備」に変更
4. 今日パネルで Work グループ内に該当タスクが表示
5. 「会議準備」サブカテゴリを削除 → 該当タスクの category が NULL に

期待: 階層構造が UI で正しく表現
```

### T11-6: 移動バリデーション

```
1. タスクを D&D で「カレンダー」にドロップ
2. scheduled_date 未設定 → エラートースト「日付を設定してください」
3. 詳細パネルで scheduled_date を入力
4. 再度 D&D → 200 OK
5. scheduled_for=today のタスクを D&D で「ゴミ箱」にドロップ
6. 確認ダイアログ「予定を解除して移動しますか？」
7. 確認 → scheduled_for クリア + ゴミ箱へ

期待: ERROR / CONFIRM が正しく機能
```

---

## 12. テスト完了基準

以下を全て満たすこと:

- [ ] T1〜T10 の全項目がパス
- [ ] T11 の全シナリオが手動で完走、エラーなし
- [ ] `python -m py_compile config.py db.py storage.py gtd.py app.py` がエラーなし
- [ ] `node --check static/js/main.js` がエラーなし
- [ ] `grep -r "is_two_minute\|importance\|urgency\|calculate_urgency\|check_deadline_migration\|QUADRANT\|renderMatrix\|startClassifyFlow" app.py gtd.py` がヒットなし
- [ ] `grep -r "\[\[TASK:\|\[\[HABIT:\|\[\[PROJECT:\|\[\[UPDATE_STEP:" app.py` がヒットなし（旧 `[[PROJECT:]]` は v1 形式のもの。v2 の `[[PROJECT_TASKS:]]` は別物で OK）
- [ ] ブラウザで主要タブを一通り操作してエラーコンソールに赤表示なし
- [ ] サーバー起動して `GET /api/tasks` が 200 を返す
- [ ] `GET /api/categories` が初期5親カテゴリを返す

---

## 13. 実行方法

### 事前準備
```bash
# v1 → v2 マイグレーション（破壊的変更を含むため実行前にバックアップ確認）
C:/Python313/python.exe scripts/migrate_to_gtd_v2.py

# サーバー起動
start.bat
```

### 自動テスト（pytest 導入時の参考コマンド）
```bash
C:/Python313/python.exe -m pytest tests/ -v
```

### 手動 E2E テスト
- ブラウザで http://localhost:5000 を開く
- T11 のシナリオを順次実行
- 結果を `docs/GTD_ROADMAP_v2.md` の Phase 5 進捗欄に記録

---

## 14. 将来追加候補（v2 では実装しない）

| 項目 | 説明 |
|------|------|
| プロジェクト・テンプレート | 「定期会議」など繰り返しプロジェクトの雛形保存 |
| カテゴリの並び替えUI | 現状は sort_order 直接編集のみ |
| 見込み時間の自動学習 | 完了タスクの実時間データから AI が推定精度を改善 |
| プロジェクト間の依存関係 | プロジェクトの前後関係を可視化 |
| 週次レビューの AI 補助 | レビュー時に AI が振り返り質問を投げる |

これらは v3 以降の検討対象。
