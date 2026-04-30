# GTD v2 — 実装ロードマップ

**作成日**: 2026-04-25
**対象**: [GTD_DESIGN.md](GTD_DESIGN.md) v2 / [GTD_TEST_SPEC.md](GTD_TEST_SPEC.md) v2 に基づく実装
**前提**: Phase 1（設計書書き直し）は完了済み

---

## 0. 進捗ステータスの記法

| 記号 | 意味 |
|------|-----|
| `[ ]` | 未着手 |
| `[~]` | 進行中 |
| `[x]` | 完了 |
| `[!]` | ブロック中（理由を備考欄に） |

---

## 1. AI モデル割当の方針

### 1.1 利用可能モデル

| モデル | 強み | 弱み | 用途の目安 |
|--------|------|------|-----------|
| **Opus 4.7 (1M context)** | 大規模なファイル横断、複雑な設計判断、リファクタの全体最適 | 速度・コスト | アーキテクチャ変更、複数ファイルにまたがる削除、large file 全面書き換え |
| **Opus 4.6** | Opus の標準速度版 | Opus 4.7 にやや劣る | Opus 4.7 が必要な場面の代替 |
| **Sonnet 4.6** | 速度と精度のバランス | 大規模文脈で散発的に取り違え | 単一ファイル実装、明確な仕様の API 追加、中規模リファクタ |
| **Haiku 4.5** | 高速・低コスト | 設計判断は不得手 | 定型コード、テストデータ生成、簡単な修正、日記/ブレインダンプ要約（既存） |

### 1.2 タスクの分類基準

各タスクには下記マークを付与:

- 🟣 **Opus 4.7** — 1M context 推奨（main.js のような巨大ファイル横断、全面リファクタ）
- 🔵 **Opus 4.6** — 設計判断が混じるが文脈は中規模
- 🟢 **Sonnet 4.6** — 仕様明確で単一ファイルが中心
- 🟡 **Haiku 4.5** — 定型・小規模

### 1.3 v2 リファクタにおける割当方針

- **`gtd.py` / `app.py` の再構築** → 🔵 Opus 4.6 が中心。validation 関数群とプロジェクト state machine は設計判断が必要
- **`main.js` (4000行) の全面リファクタ** → 🟣 Opus 4.7 必須。マトリクス削除と3カラム再構築は全体最適が必要
- **DB マイグレーション** → 🟢 Sonnet 4.6。SQL は仕様明確
- **テストシナリオ実行** → 🟡 Haiku 4.5（実行と結果記録のみ）+ 失敗時のデバッグは 🔵 Opus 4.6

---

## 2. フェーズ全体図

```
Phase 1: 設計書書き直し          [完了]    🟣 Opus 4.7
   ↓
Phase 2: DB スキーマ + 移行        [完了]  🟢 Sonnet 4.6
   ↓
Phase 3: バックエンド変更         [完了]   🔵 Opus 4.6
   3.1 gtd.py
   3.2 app.py エンドポイント
   3.3 AI プロンプト更新
   ↓
Phase 4: フロントエンド変更       [完了]   🟣 Opus 4.7（巨大ファイル横断）
   4.1 マトリクス・ウィザード削除
   4.2 3カラムレイアウト構築
   4.3 D&D + バリデーション
   4.4 GTDワークフロー図（右ペイン）
   4.5 プロジェクト UI
   4.6 カテゴリ管理 UI
   4.7 朝/夜リセットボタン
   ↓
Phase 5: テスト & 動作確認        [~]     🟡 Haiku 4.5（実行）+ 🔵 Opus 4.6（デバッグ）
```

各フェーズの完了条件を満たして次に進む。Phase 4 の 4.4〜4.7 は 4.2 完了後に並行実装可能。

---

## 3. Phase 1: 設計書書き直し（完了 2026-04-25）

🟣 **Opus 4.7 (1M context)**

理由: 動画文字起こしの読解、過去ドキュメントの解釈、複数のユーザー判断の統合という大規模な文脈処理が必要。

| 成果物 | 状態 |
|-------|-----|
| `docs/GTD_DESIGN.md` | [x] 完了 |
| `docs/GTD_TEST_SPEC.md` | [x] 完了 |
| `docs/GTD_ROADMAP_v2.md` (本書) | [x] 完了 |
| `CLAUDE.md` 更新 | [ ] Phase 3 で更新（プロンプト変更と同時に） |

---

## 4. Phase 2: DB スキーマ + 移行スクリプト（完了 2026-04-25）

🟢 **Sonnet 4.6**

### 4.1 db.py 拡張

- [x] `tasks` テーブルに以下を ALTER TABLE で追加（try/except で冪等化）:
  - [x] `estimate_minutes INTEGER`
  - [x] `category_id TEXT`
  - [x] `project_sort_order INTEGER`
- [x] `projects` テーブルに以下を ALTER TABLE で追加:
  - [x] `status TEXT NOT NULL DEFAULT 'drafting'`
  - [x] `completion_condition TEXT`
  - [x] `period_start TEXT`
  - [x] `period_end TEXT`
  - [x] `archived INTEGER DEFAULT 0`
- [x] `categories` テーブルを CREATE TABLE IF NOT EXISTS で追加
- [x] 親カテゴリ5件の初期データを INSERT OR IGNORE で投入
- [x] `row_to_project_full()` 関数を新規追加（projects 行 → dict 変換）
- [x] `row_to_category()` 関数を新規追加

### 4.2 移行スクリプト `scripts/migrate_to_gtd_v2.py`

- [x] バックアップ: `archive.db` → `archive_pre_v2_YYYYMMDD.db`
- [x] `db.init_db()` 呼び出しで新スキーマ適用
- [x] 旧 `category` 文字列 → 新 `category_id` 移行（マッピング表に基づく）
- [x] 旧 `projects` レコード → 全件 `status='archived', archived=1` に設定
- [x] `data/state.json` に `last_manual_rollover` 追加（既存値保持）
- [x] 冪等性: 2回目実行でエラーなし
- [x] 標準出力で件数レポート

### 4.3 完了条件
- [x] `python scripts/migrate_to_gtd_v2.py` 実行で終了コード 0
- [x] 2回連続実行でも終了コード 0
- [x] バックアップファイルが作成されている

---

## 5. Phase 3: バックエンド変更（完了 2026-04-26）

🔵 **Opus 4.6**

### 5.1 gtd.py — v2 関数構成

#### 5.1.1 削除（v1 関数）

- [x] `calculate_urgency()` — 削除
- [x] `check_deadline_migration()` — 削除
- [x] `is_two_minute` 関連の分岐 — 削除

#### 5.1.2 維持（v1 → v2 で残す）

- [x] `rollover_scheduled_for()` — 維持（手動 / 自動共通の本体ロジック）
- [x] `cleanup_old_drafts()` — 維持
- [x] `apply_gtd_defaults()` — importance/urgency/is_two_minute の処理を削除済み

#### 5.1.3 新規実装

- [x] `validate_move(task, target_status, force_params) -> dict`
- [x] `apply_move(task, target_status, force_params) -> dict`
- [x] `manual_rollover(timing) -> dict`
- [x] `check_is_draft(task) -> bool` — category_id ベース
- [x] `compute_today_summary(tasks, habits, categories) -> dict`

### 5.2 app.py — エンドポイント変更

#### 5.2.1 廃止

- [x] `/api/tasks/classify` — 完全削除
- [x] `/api/tasks/<id>/finalize` — 完全削除
- [x] `/api/projects/<pid>/phases/<phid>/chat` — 完全削除（phase 概念廃止）

#### 5.2.2 変更

- [x] `GET /api/tasks` — `rollover_scheduled_for()` のみ実行（urgency/deadline_migration 廃止）
- [x] `POST /api/tasks` / `PUT /api/tasks/<id>` — importance/urgency/is_two_minute 無視
- [x] `GET /api/today` / `GET /api/tomorrow` — 親カテゴリグルーピング + estimate_minutes 合計
- [x] `POST /api/tasks/<id>/chat` — v2 プロンプト（estimate_minutes 追加、仕分け提案禁止）

#### 5.2.3 新規

- [x] `POST /api/tasks/move`
- [x] `POST /api/tasks/rollover/manual`
- [x] `GET /api/categories` / `POST /api/categories` / `PUT /api/categories/<id>` / `DELETE /api/categories/<id>`
- [x] `GET /api/projects` / `POST /api/projects` / `PUT /api/projects/<id>` / `DELETE /api/projects/<id>`
- [x] `POST /api/projects/<id>/activate`
- [x] `POST /api/projects/<id>/chat` — `[[PROJECT_TASKS:]]` 形式
- [x] `POST /api/projects/<id>/tasks` / `GET /api/projects/<id>/tasks`

### 5.3 AI プロンプト更新

- [x] `/api/tasks/<id>/chat` — `[[DETAIL:]]` に category_id / estimate_minutes 対応
- [x] `/api/projects/<id>/chat` — `[[PROJECT_TASKS:]]` 新形式
- [x] `_sanitize_detail_proposal()` / `_sanitize_project_tasks_proposal()` 実装

### 5.4 config.py 更新

- [x] 削除: `LOG_FILE`, `ANALYSIS_FILE`, 分析スコアリング定数
- [x] 追加: `VALID_PROJECT_STATUS`, `MOVE_REQUIRED_FIELDS`, `MOVE_FORBIDDEN_TRANSITIONS`, `VALID_ROLLOVER_TIMING`

### 5.5 完了条件
- [x] `python -m py_compile config.py db.py storage.py gtd.py app.py` がエラーなし
- [x] サーバー起動して `GET /api/tasks` が 200
- [x] API スモーク 13/13 PASS（categories CRUD / tasks move / projects activate / rollover / today）

---

## 6. Phase 4: フロントエンド変更（完了 2026-04-26）

🟣 **Opus 4.7 (1M context)**

### 6.1 削除作業（main.js / index.html / style.css）

- [x] `renderMatrix()` / `QUADRANT_CONFIG` 削除
- [x] `startClassifyFlow()` / `nextQuestionOrOutcome()` / Q1〜Q6 モーダル削除
- [x] importance/urgency / is_two_minute 関連 UI 削除
- [x] index.html: マトリクス DOM 削除、`#task-board` に置換
- [x] style.css: マトリクス関連 CSS 削除

### 6.2 3カラムレイアウト構築

- [x] `#task-board` + `.task-board { display: grid }` CSS
- [x] `renderInboxColumn()` — 左カラム（inbox）
- [x] `renderListColumn()` — 中央カラム（6ステータス縦並び、折り畳み付き）
- [x] `renderWorkflowDiagram()` — 右カラム（GTDフロー参考図）

### 6.3 D&D + バリデーション

- [x] `setupTaskDragDrop()` — HTML5 API で gtd_status 変更
- [x] `showMoveConfirm()` — confirm レベル時の確認ダイアログ
- [x] `showMoveToast()` — error レベル時のトースト
- [x] 今日/明日パネルへの D&D（`scheduled_for`）は維持

### 6.4〜6.8 その他 UI

- [x] プロジェクトタブ復活（drafting/active/completed ビュー + AI チャット）
- [x] `openCategoryManager()` / `renderCategoryManager()` モーダル
- [x] 朝/夜リセットボタン（`doManualRollover()`）
- [x] タスク詳細パネルに見込み時間入力 + 今日/明日パネルのカテゴリ別合計表示
- [x] `project_pending` タスクからプロジェクト化ボタン

### 6.9 完了条件

- [x] `node --check static/js/main.js` がエラーなし
- [ ] ブラウザで主要操作が動く（コンソールに赤エラーなし） — **ユーザー側で手動確認**

---

## 7. Phase 5: テスト & 動作確認（進行中）

🟡 **Haiku 4.5（実行）** + 🔵 **Opus 4.6（デバッグ）**

### 7.1 自動テスト（Flask test_client）

- [x] T1（マイグレーション）: DB スキーマ + categories 初期投入確認
- [x] T2（カテゴリ CRUD）: POST / DELETE / is_system 保護確認
- [x] T3（移動バリデーション）: ERROR（calendar 日付なし）/ CONFIRM ケース
- [x] T4（rollover）: 手動 + 今日/明日グルーピング
- [x] T6（プロジェクト）: drafting 作成 / 子タスクなし activate エラー / 子タスクあり activate OK
- [x] API スモーク 13/13 PASS

### 7.2 手動 E2E（ブラウザで確認）

- [ ] T11-1: 収集（複数タイトル入力）→ inbox へ登録 → D&D で仕分け
- [ ] T11-2: 詳細設定 AI チャット → `[[DETAIL:]]` 提案適用
- [ ] T11-3: プロジェクト作成 → 子タスク AI 提案 → active → 完了
- [ ] T11-4: ゴミ箱 → 週次レビューから復元
- [ ] T11-5: カテゴリ追加 / 削除 / タスクへの割当
- [ ] T11-6: 朝/夜リセットボタン動作確認
- [ ] コンソールに赤エラーなし（全タブ巡回）

### 7.3 完了条件

- [ ] T11-1〜T11-6 全シナリオパス
- [ ] ブラウザ赤エラーなし
- [ ] ロードマップ全タスクが `[x]` 完了

---

## 8. リスクと緩和策

| リスク | 影響度 | 緩和策 |
|-------|-------|-------|
| main.js 4000行の同時編集で破壊的変更が混入 | 高 | Opus 4.7 で扱う、削除と追加を別コミットに分ける |
| マイグレーション失敗で既存データ損失 | 高 | 必ずバックアップ後に実行、冪等性を担保 |
| プロジェクト drafting/active のフィルタロジック誤り | 中 | T6 のテストを丁寧に通す |
| カテゴリ階層 UI の操作性 | 中 | 最初は最小限の UI（プルダウン2段）から始める |
| 旧 `[[TASK:]]` 形式の残存（プロンプト or パース） | 中 | T9-2 / T8-3 で grep チェック |
| v1 ユーザーデータが見えなくなる | 中 | importance/urgency 列は残置、UI から非表示にするだけ |

---

## 9. 各フェーズで Claude Code を起動するときの推奨設定

### 9.1 Phase 2（DB 移行）
```
モデル: Sonnet 4.6
プロンプト例: "Read scripts/migrate_to_gtd_v2.py — 設計書の Sect.9 に従って ALTER/CREATE/INSERT を実装してください"
注意: 冪等性を必ず確認すること
```

### 9.2 Phase 3（バックエンド）
```
モデル: Opus 4.6
プロンプト例: "GTD v2 設計書 Sect.5/6/7/8 を読んで gtd.py と app.py を v2 仕様に変更してください。
            CLAUDE.md も同時に更新します"
注意: 既存エンドポイントを壊さないよう、廃止と維持を明確に区別
```

### 9.3 Phase 4（フロントエンド）
```
モデル: Opus 4.7 (1M context)
プロンプト例: "GTD v2 設計書 Sect.7 と 12 に従い、main.js のマトリクス・ウィザードを削除し
            3カラム + D&D + プロジェクト UI に書き換えてください"
注意: 削除と新規追加を分けてコミット、各ステップで `node --check` を実行
```

### 9.4 Phase 5（テスト）
```
モデル: Haiku 4.5（実行）→ 失敗時 Opus 4.6（デバッグ）
プロンプト例: "GTD_TEST_SPEC.md の T1〜T10 の curl テストを順次実行し、結果を記録してください"
注意: 失敗が続く場合は Opus に切り替えて根本原因を調査
```

---

## 10. 完了報告フォーマット

各フェーズ完了時に以下を git commit メッセージ or PR で報告:

```
Phase N: <名称> 完了

成果物:
- 変更ファイル: <list>
- 新規ファイル: <list>
- 削除ファイル: <list>

確認:
- py_compile / node --check: ✅
- 関連テスト (TX-Y): ✅ N/M パス
- 手動動作確認: ✅ / ❌（理由）

次フェーズ: Phase N+1
```

---

## 11. 関連ドキュメント

- [GTD_DESIGN.md](GTD_DESIGN.md) — v2 設計仕様
- [GTD_TEST_SPEC.md](GTD_TEST_SPEC.md) — v2 テスト仕様
- [CONVENTIONS.md](CONVENTIONS.md) — コーディング規約
- [CLAUDE.md](../CLAUDE.md) — AI アシスタント仕様（Phase 3 で更新予定）
