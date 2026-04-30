# GTD ワークフロー v2 — 設計仕様書

**作成日**: 2026-04-25（v2 全面改訂）
**前バージョン**: 2026-04-24 (v1) — Q1〜Q6 静的ウィザード方式、マトリクス中心
**対象**: AI Task Organizer の GTD 機能再設計（v1 を全面改訂）
**関連ドキュメント**:
- [GTD_TEST_SPEC.md](GTD_TEST_SPEC.md) — テスト仕様（v2）
- [GTD_ROADMAP_v2.md](GTD_ROADMAP_v2.md) — 実装ロードマップ（AIモデル割当付き）
- [CONVENTIONS.md](CONVENTIONS.md) — コーディング規約

---

## 0. v1 からの主要変更点

| 領域 | v1 (2026-04-24) | v2 (2026-04-25) |
|------|-----------------|-----------------|
| 仕分け方式 | Q1〜Q6 静的ウィザード（強制） | **D&D + GTDワークフロー図参考表示**（強制ではない） |
| マトリクス（4象限） | あり (importance × urgency) | **完全廃止** |
| importance / urgency | 必須項目 | **完全廃止** |
| 2分ルール (is_two_minute) | あり | **完全廃止** |
| 「すぐにやること」リスト | あり | **完全廃止** |
| カレンダー自動遷移 | あり (deadline ≤ 1日) | **完全廃止**（明示D&Dのみ） |
| rollover | lazy 自動のみ | **手動ボタン + 自動の併用** |
| カテゴリ | フラット 6種 (work/health/...) | **2階層構造**（親5種＋ユーザー子カテゴリ） |
| 見込み時間 | なし | **estimate_minutes 追加**（AI 提案対応） |
| プロジェクト機能 | 凍結（501） | **復活**（drafting/active/completed/archived） |
| AI 範囲 | 詳細設定相談（category/roadmap/checklist） | **拡張**（estimate_minutes / プロジェクトタスク一括提案 / 期限相談 / ゴミ箱判定 / 完了条件明確化） |
| 画面レイアウト | マトリクス中心 + 今日/明日サイドパネル | **3カラム**（オプションなし / 各リスト縦並び / GTDワークフロー図） |

> v1 設計書は git 履歴に残置。v2 では参照しないこと。

---

## 1. 設計思想

### 1.1 GTD ワークフローの 5 ステップ

```
把握する (Capture) → 見極める/整理する (Clarify/Organize)
       ↓                          ↓
  オプションなし              D&D で各リストへ仕分け
                                  ↓
                            選択する (Engage)
                                  ↓
                           今日/明日リストへ
                                  ↓
                       更新する (Reflect/Review) — 週次
```

### 1.2 設計原則

1. **AI は補助役**: 仕分けの判断は常にユーザーが行う。AI は category 推定・タスク分解・期限相談・完了条件明確化など、**詳細を埋める作業**だけを支援する
2. **強制ウィザードを排除**: v1 の Q1〜Q6 ウィザードを廃止。代わりに右ペインに GTDワークフロー図を**参考表示**し、ユーザーが見ながら D&D で仕分け
3. **ゴミ箱は保管庫**: trash も someday・waiting と同じく「いつでもオプションなしに戻せる」リストの1つ。削除はしない
4. **カレンダーは厳密**: 「その日にしかできない」もののみ。「その日までにやりたい」は next_action 扱い
5. **プロジェクトは2段階**: 「ドラフト中（タスク登録中）」と「稼働中（next_action 表示）」を明確に分離

---

## 2. データモデル

### 2.1 Task — 新スキーマ（v2）

`archive.db` の `tasks` テーブル:

```json
{
  "id":                "1745000000000",
  "title":             "プレゼン資料の作成",
  "gtd_status":        "inbox | next_action | waiting | calendar | someday | project_pending | trash | done",
  "is_draft":          true,
  "category_id":       "cat_work_001 | null",
  "estimate_minutes":  30,
  "deadline":          "2026-05-10 | null",
  "scheduled_date":    "2026-05-10 | null",
  "scheduled_for":     "today | tomorrow | null",
  "waiting_for":       "○○さんの返信 | null",
  "tags":              ["..."],
  "roadmap":           [{"id": "...", "text": "ステップ", "done": false}],
  "checklist":         [{"id": "...", "text": "準備物", "done": false}],
  "notes":             "",
  "project_id":        "proj_001 | null",
  "project_sort_order": 10,
  "completed":         false,
  "completed_at":      null,
  "created_at":        "2026-04-25T10:00:00"
}
```

### 2.2 廃止フィールド（v1 → v2）

| フィールド | 廃止理由 |
|-----------|---------|
| `importance` | マトリクス廃止に伴い不要 |
| `urgency` | 同上 |
| `is_two_minute` | 「すぐにやること」リスト廃止に伴い不要 |
| `phase_id` | プロジェクト v2 では phase の概念を使わない |

> 既存の DB カラムは残置（破壊的変更を避ける）。新規書き込みでは `NULL` 固定、UI からは参照しない。

### 2.3 新規フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `category_id` | TEXT | `categories` テーブルへの FK。NULL 可 |
| `estimate_minutes` | INTEGER | 見込み時間（分単位）。NULL 可 |
| `project_sort_order` | INTEGER | プロジェクト内の並び順（next_action 自動判定に使用） |

### 2.4 gtd_status 一覧（v2）

| status | 日本語表示 | 意味 | 必須項目 |
|--------|-----------|------|---------|
| `inbox` | オプションなし | 把握直後・未仕分け | title のみ |
| `next_action` | 次にやるべきこと | 今週中に着手 | title |
| `waiting` | 依頼中/連絡待ち | 他者の対応待ち | title, **waiting_for** |
| `calendar` | カレンダー | 「その日にしかできない」もの | title, **scheduled_date** |
| `someday` | いつかやる/多分やる | 来週以降 or 不確定 | title |
| `project_pending` | プロジェクト化 | プロジェクト登録待ちの種 | title |
| `trash` | ゴミ箱 | 一旦保留、レビューで戻せる | title |
| `done` | 完了 | 完了済み | title, completed_at |

### 2.5 Project — v2 復活

```sql
-- 既存 projects テーブルに以下を追加
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'drafting';
ALTER TABLE projects ADD COLUMN completion_condition TEXT;
ALTER TABLE projects ADD COLUMN period_start TEXT;
ALTER TABLE projects ADD COLUMN period_end TEXT;
ALTER TABLE projects ADD COLUMN archived INTEGER DEFAULT 0;
```

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT | `proj_xxxxx` |
| `name` | TEXT | プロジェクト名（元の project_pending タスクのタイトルが入る） |
| `completion_condition` | TEXT | 完了条件（動画準拠） |
| `period_start` | TEXT | YYYY-MM-DD（開始日） |
| `period_end` | TEXT | YYYY-MM-DD（終了日 = 期限） |
| `status` | TEXT | `drafting` / `active` / `completed` / `archived` |
| `created_at` | TEXT | ISO8601 |
| `completed_at` | TEXT | 完了時にセット |
| `archived` | INTEGER | 0/1（GET一覧でのフィルタ用） |

### 2.6 Project 状態遷移

```
[drafting]                    [active]                  [completed]
タスク登録中            「タスクを登録」確定後             完了条件達成
─────────                ─────────                  ─────────
子タスクあり (drafting)   子タスクが next_action 表示    子タスクは done
next_action に出ない      新規タスク追加 = 即active        ↓
       ↓                       ↓                     [archived]
    /activate                完了処理                  完全アーカイブ
```

### 2.7 Categories — 新規マスタテーブル

```sql
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT,                    -- NULL なら親カテゴリ
    icon        TEXT,                    -- 絵文字 or アイコン名
    color       TEXT,                    -- HEX color
    is_system   INTEGER DEFAULT 0,       -- 1 なら削除/改名不可
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);
```

### 2.8 初期データ（システム既定の親カテゴリ）

| id | name | icon | color | is_system | sort_order |
|----|------|------|-------|-----------|-----------|
| `cat_output` | Output | 📤 | #4F46E5 | 1 | 10 |
| `cat_input` | Input | 📥 | #059669 | 1 | 20 |
| `cat_work` | Work | 🛠 | #DC2626 | 1 | 30 |
| `cat_session` | Session | 👥 | #D97706 | 1 | 40 |
| `cat_routine` | ルーティン | 🔁 | #7C3AED | 1 | 50 |

子カテゴリは `parent_id` が上記のいずれかを指す。`is_system=0` で改名・削除可能。

### 2.9 Habit — 変更なし

v1 から変更なし（`weekday` カラムを含む）。

### 2.10 weekly_reviews — 変更なし

v1 から変更なし。

### 2.11 state.json — 変更あり

```json
{
  "last_rollover_date":   "2026-04-25",
  "last_draft_cleanup":   "2026-04-25",
  "last_manual_rollover": "2026-04-25T07:30:00"
}
```

`last_manual_rollover` を新規追加（手動リセットボタンの最終押下時刻）。

---

## 3. 仕分けフロー（v2）

### 3.1 動画準拠の GTD ワークフロー

ユーザーがオプションなしリストから各リストへ D&D する際の判断材料として、**右ペインにフローチャートを参考表示**する。強制ではない。

```
[オプションなし のタスク]
        ↓
Q1: やる必要がある？  → No → ゴミ箱
        ↓ Yes
Q2: 自分がやるべき？  → No → 依頼中/連絡待ち
        ↓ Yes
Q3: すぐ行動できる？  → No → プロジェクト化
        ↓ Yes
Q4: 特定の日付がある？ → Yes → カレンダー
        ↓ No
Q5: 早めにやるべき？
   ├─ 今週中    → 次にやるべきこと
   └─ 来週以降  → いつかやる/多分やる
```

> **重要**: v1 の Q1「2分以内？」は v2 では削除。「3分タスク」「すぐにやること」リスト・`is_two_minute` フラグを全廃止。

### 3.2 仕分け実装方針

- フロントエンド: `oプションなし` リストの各タスクが**ドラッグ可能**
- 右ペインの GTD ワークフロー図は静的 SVG/HTML で表示（インタラクティブではない）
- D&D で `gtd_status` が変更される際、**バリデーション**（後述 §5）が走る
- バリデーション失敗 → トースト or 確認ダイアログ
- 成功 → `POST /api/tasks/move` で `gtd_status` を更新

---

## 4. 詳細設定 & AI サポート

### 4.1 詳細設定モーダル（オプションなし段階で開ける）

タスクを右クリック or 詳細ボタンで詳細設定モーダルが開く。**仕分け前でも開ける**。

**入力フィールド**:
- title（必須）
- category_id（親カテゴリ + サブカテゴリ）
- deadline
- scheduled_date（calendar 用）
- waiting_for（waiting 用）
- estimate_minutes（見込み時間）
- tags
- notes
- roadmap, checklist

**AI 相談チャット欄**: 既存の `/api/tasks/<id>/chat` を使用。

### 4.2 AI 拡張プロンプト（v2）

```
あなたはタスクの詳細設計を手伝うアシスタントです。以下のタスクについて、
ユーザーの質問に答えながら、必要に応じて構造化情報を JSON で出力してください。

タスク情報:
- タイトル: {title}
- カテゴリ: {category_name or "未設定"}
- 期限: {deadline or "未設定"}
- 見込み時間: {estimate_minutes}分
- 状態: {gtd_status}

できること:
1. category（親カテゴリ + サブカテゴリ）の推定
2. roadmap（3〜7個のステップ）の提案
3. checklist（準備物）の提案
4. estimate_minutes（見込み時間）の提案
5. 期限が不明なときの一般情報の相談（例: 確定申告の期限など）
6. タスク分解の提案（複数タスクに分けたほうが良いか）
7. 「これは本当にやる必要がある？」と問いかける（ゴミ箱判定の補助）

提案を確定したい場合のみ、以下の形式で出力してください
（ユーザーが「決定」を押すまでは通常の会話を続けること）:

[[DETAIL:{"category_id":"cat_work","roadmap":[{"text":"ステップ1"}],
          "checklist":[{"text":"準備物1"}],"estimate_minutes":30}]]

※ [[DETAIL:]] は部分更新として扱われる。含めたいフィールドだけ含めて良い。
※ 1回の応答につき [[DETAIL:]] は最大1つ。valid JSON であること。
※ 仕分けの判断（next_action / waiting / calendar / someday / project_pending / trash）
  は AI から提案しない。仕分けは常にユーザーが決める。
```

### 4.3 プロジェクト用 AI 相談プロンプト

`/api/projects/<id>/chat` 用（drafting 状態の子タスク提案）:

```
あなたはプロジェクトのタスク設計を手伝うアシスタントです。
以下のプロジェクトについて、ユーザーの質問に答えながら、
プロジェクト内のタスクを 3〜10 個提案してください。

プロジェクト情報:
- 名前: {name}
- 完了条件: {completion_condition or "未設定"}
- 期間: {period_start} 〜 {period_end}
- 既存の子タスク: {existing_tasks}

できること:
1. 子タスクの提案（複数）
2. 完了条件のあいまいさをチェックして書き換え提案
3. 期間設定のアドバイス

提案を確定したい場合のみ、以下の形式で出力してください:

[[PROJECT_TASKS:{
  "completion_condition": "（必要なら更新）",
  "tasks": [
    {"title": "タスク1", "estimate_minutes": 30, "category_id": "cat_work"},
    {"title": "タスク2", "estimate_minutes": 60}
  ]
}]]

※ tasks 配列のみ部分更新も可能。
※ AI が勝手に既存タスクを上書きしない。常に「追加」として扱う。
※ valid JSON。
```

### 4.4 廃止プロンプト

- v1 の `[[TASK:]]` / `[[PROJECT:]]` (旧形式) / `[[HABIT:]]` / `[[UPDATE_STEP:]]` は **全て廃止**
- 仕分けに関する AI 提案も廃止

### 4.5 残るプロンプト

- `/api/braindump/save` — Haiku（既存のまま）
- `/api/diary/consolidate` — Haiku（既存のまま）

---

## 5. 移動時バリデーション

### 5.1 通知レベル

| レベル | 動作 |
|--------|------|
| 🚫 ERROR | D&D を拒否、トーストで理由表示 |
| ⚠️ CONFIRM | 確認ダイアログ「移動しますか？」 |
| ℹ️ INFO | 移動後にトーストで補足 |

### 5.2 ERROR レベル（D&D 拒否）

| 条件 | エラーメッセージ |
|------|----------------|
| `→ calendar` で `scheduled_date` 未設定 | 「カレンダーに入れるには日付を設定してください」 |
| `→ waiting` で `waiting_for` 未設定 | 「待っている相手を入力してください」 |
| `deadline` あり、`→ someday` | 「期限を解除してから移動してください」 |
| `completed=true` で `→ next_action / waiting / calendar` | 「完了済みはアーカイブから復元してください」 |

### 5.3 CONFIRM レベル（確認ダイアログ）

| 条件 | 確認文言 |
|------|---------|
| `scheduled_for` あり、`→ trash / someday / waiting` | 「予定を解除して移動しますか？」 |
| プロジェクトの子タスクを単独で `→ trash` | 「プロジェクトから外して移動しますか？」 |

### 5.4 破壊的操作の確認は不要

ゴミ箱は保管庫で削除ではないので、`roadmap` や `checklist` 記入済みのタスクを trash に入れる際の確認ダイアログは**不要**。レビューでいつでも戻せる。

### 5.5 実装

```python
# gtd.py
def validate_move(task: dict, target_status: str) -> dict:
    """
    Returns:
      {"ok": True}  # 移動OK
      {"ok": False, "error": "...", "level": "error|confirm"}  # 拒否 or 確認
      {"ok": True, "warning": "..."}  # 移動はOKだが補足あり
    """
```

---

## 6. rollover（手動 + 自動 併用）

### 6.1 自動 rollover（lazy）

v1 と同じ仕組み。`GET /api/tasks` / `/api/today` / `/api/tomorrow` の先頭で `last_rollover_date` を確認し、1日1回実行。

**動作**: `scheduled_for='today'` の未完了タスクを `scheduled_for=null` にクリア（next_action リストに戻る）。`scheduled_for='tomorrow'` は `'today'` に繰り上げ。

### 6.2 手動 rollover（朝/夜ボタン）

UI に「朝のリセット」「夜のリセット」ボタンを設置。

```python
def manual_rollover(timing: str):
    """
    timing: 'morning' or 'evening'
    両方とも動作は自動 rollover と同じ。
    state.json.last_manual_rollover に押下時刻を記録。
    自動 rollover の last_rollover_date も更新（重複実行を防ぐ）。
    """
```

> 動画では「期限切れタスクを名称変更/細分化リストに移動」する仕様だが、ユーザー判断により**そのリストは作らない**。手動リセットは scheduled_for クリアのみに留める。

### 6.3 削除する仕様（v1 → v2）

- ❌ `check_deadline_migration` 関数（next_action → calendar の自動遷移）
- ❌ `urgency` の自動再計算
- ❌ `is_two_minute` 関連処理

---

## 7. 画面構成

### 7.1 全体タブ構成（変更なし）

```
[タスク] [カレンダー] [待機中] [いつか]
[プロジェクト] [週次レビュー] [チャット] [頭の整理]
[日記] [アーカイブ]
```

> v2 で **プロジェクトタブを復活**。マトリクスタブは廃止し、タスクタブが新メインビュー。

### 7.2 タスクタブ — 3カラムレイアウト（v2 メイン）

```
┌──────────────────────────────────────────────────────────────┐
│ タスクタブ                                                    │
├──────────┬──────────────────────────┬───────────────────────┤
│ 左カラム  │ 中央カラム                │ 右カラム               │
│ ────     │ ──────                   │ ──────                │
│ オプショ  │ 各リスト（縦並び）         │ GTDワークフロー図       │
│ ンなし    │                          │ （参考表示、SVG）       │
│ (inbox)  │ ▼ 次にやるべきこと        │                        │
│          │   • タスクA               │ Q1: やる必要がある？     │
│ • タスク1 │   • タスクB               │  └ No → ゴミ箱          │
│ • タスク2 │ ▼ 依頼中/連絡待ち         │  └ Yes ↓               │
│ • タスク3 │   • 田中さんに依頼         │ Q2: 自分が？             │
│          │ ▼ カレンダー              │  └ No → 依頼中           │
│          │   • 5/10 健康診断         │  └ Yes ↓               │
│          │ ▼ プロジェクト化          │ Q3: すぐ行動？           │
│          │   • 来期予算策定           │  └ No → プロジェクト化   │
│          │ ▼ いつかやる              │  └ Yes ↓               │
│          │   • 本を読む              │ Q4: 特定日？             │
│          │ ▼ ゴミ箱                  │  └ Yes → カレンダー     │
│          │   • やめたタスク           │  └ No ↓                │
│          │                          │ Q5: 早め？               │
│          │                          │  └ 今週 → 次にやる       │
│          │                          │  └ 来週〜 → いつかやる   │
│          │                          │                        │
│ [🌙夜リセット] [☀️朝リセット]                                  │
└──────────┴──────────────────────────┴───────────────────────┘
```

- 左カラムから中央カラムの各リストへ D&D で仕分け
- 中央の各リストはトグル式（▼ で開閉）
- タスクをクリック → 詳細サイドパネル
- リストヘッダの件数表示

### 7.3 今日/明日 パネル

タスクタブとは別の場所（タブ内の別ペイン or 下部）に配置:

```
┌── 今日/明日 パネル ──┐
│ [今日][明日]          │
│ ───                  │
│ Output (1)            │
│ • 業務報告書          │
│ Input (0)             │
│ Work (2)              │
│ • メール返信          │
│ • 会議準備            │
│ Session (1)           │
│ • 1on1               │
│ ルーティン (1)         │
│ • 朝ラン (習慣)       │
│                      │
│ 合計見込み時間: 145分  │
└──────────────────────┘
```

- 中央カラムの「次にやるべきこと」から D&D で `scheduled_for` 設定
- 親カテゴリでグルーピング表示
- カテゴリごとの見込み時間と総合計を表示

### 7.4 プロジェクトタブ（復活）

3ビュー:
- **進行中**: `status='active'` & `period_start ≤ today` & `archived=0`
- **調整中**: `status='drafting'` または `period_start > today`
- **完了**: `status='completed' or archived=1`

```
┌── プロジェクト ──────────────────────────────┐
│ [進行中] [調整中] [完了]                      │
├──────────────────────────────────────────────┤
│ 進行中                                        │
│ ┌────────────────────────────────────────┐   │
│ │ 来期予算策定                            │   │
│ │ 期間: 2026-05-01 〜 2026-09-30          │   │
│ │ 完了条件: 9月会議で決議                  │   │
│ │ 次のアクション → 構成を書き出す          │   │
│ │ [詳細を開く]                           │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ 調整中                                        │
│ ┌────────────────────────────────────────┐   │
│ │ 新サービス検討（drafting）              │   │
│ │ ⚠ タスクが0件。タスクを登録してください。 │   │
│ │ [詳細を開く]                           │   │
│ └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

### 7.5 プロジェクト詳細パネル

```
┌── 来期予算策定 ─────────────────────────────┐
│ 状態: 🟡 タスク登録中 (drafting)             │
│ 完了条件: [_______________]                 │
│ 期間: [2026-05-01] 〜 [2026-09-30]           │
│                                              │
│ ── 子タスク（ドラフト） ───                   │
│ □ 構成を書き出す  30分  [編集][×]            │
│ □ データ収集      60分  [編集][×]            │
│                                              │
│ [+ タスクを追加]  [🤖 AIに相談]              │
│                                              │
│ ── AI チャット ─────                         │
│ [チャット欄]                                 │
│                                              │
│ [✅ タスクを登録（active化）]                │
└──────────────────────────────────────────────┘
```

active 状態では：
- 「✅ タスクを登録」ボタンは消失
- 子タスクは next_action と同様に表示・操作可能
- 「+ タスクを追加」で追加されたタスクは即 next_action として有効

### 7.6 日記タブ（`panel-diary`）

1日 1 レコードを基本に、体調・感情のスコアと時刻別アンカー、行動ログ、
思考メモを記録するタブ。`thoughts` は「思考整理」ボタンで Haiku に渡され、
`brain_dump_sessions`（source='diary'）に集約される。

```
┌──────────────────────────────────────────────────┐
│ 日記タブ（panel-diary）                            │
├──────────────────────────────────────────────────┤
│ 日付ナビ（前日/翌日、当日にジャンプ）                │
│ ────────────────────────────────                 │
│ 感情・体調の推移（SVG タイムライン、24h × score 0–10）│
│   - 感情ライン（ピンク #f0b6c4）                    │
│   - 体調ライン（ブルー #8ec5ff）                    │
│   - アンカー D&D で時刻・スコアを編集               │
│ ────────────────────────────────                 │
│ 体調スコア + 体調メモ（body_score / body_text）     │
│ 感情スコア + 感情メモ（emotion_score / emotion_text）│
│ 行動ログ（actions: [{text, emotion}]）              │
│ 思考メモ（thoughts: [{topic, content}]）            │
│ ────────────────────────────────                 │
│ [思考整理] → POST /api/diary/consolidate（Haiku）   │
└──────────────────────────────────────────────────┘
```

実装メモ:
- タイムライン描画は Chart.js を使わず、Vanilla JS で SVG `<polyline>` /
  アンカー `<circle>` を直接生成（`static/js/main.js`）。
- AI 要約モデル: `CLAUDE_MODEL_LIGHT`（Haiku）。プロンプトは
  `core/services/ai_prompts.py` の `diary_consolidate_prompt`。
- データモデル詳細は [CLAUDE.md](../CLAUDE.md) の「DiaryEntry」節を参照。

---

## 8. API 設計

### 8.1 新規エンドポイント

| メソッド | パス | 説明 |
|---------|------|-----|
| POST | `/api/tasks/move` | gtd_status 変更（バリデーション付き）。Body: `{"target_status": "..."}` |
| POST | `/api/tasks/rollover/manual` | 朝/夜リセット手動実行。Body: `{"timing": "morning|evening"}` |
| GET | `/api/categories` | カテゴリ一覧（階層構造で返却） |
| POST | `/api/categories` | カテゴリ追加 |
| PUT | `/api/categories/<id>` | カテゴリ更新（is_system=1 は不可） |
| DELETE | `/api/categories/<id>` | カテゴリ削除（is_system=1 は不可） |
| POST | `/api/projects/<id>/activate` | drafting → active 遷移 |
| POST | `/api/projects/<id>/chat` | プロジェクト用 AI 相談（[[PROJECT_TASKS:]] 抽出） |
| POST | `/api/projects/<id>/tasks` | プロジェクト子タスク追加 |
| GET | `/api/projects/<id>/tasks` | プロジェクト子タスク一覧 |

### 8.2 変更エンドポイント

| メソッド | パス | 変更内容 |
|---------|------|---------|
| GET | `/api/tasks` | `urgency` 再計算と `check_deadline_migration` を**廃止**。rollover のみ実行 |
| POST | `/api/tasks` | デフォルト `gtd_status='inbox'`、`importance/urgency/is_two_minute` フィールドは無視 |
| PUT | `/api/tasks/<id>` | importance/urgency/is_two_minute は無視。is_draft 自動再判定は category_id ベースに変更 |
| GET | `/api/today` / `/api/tomorrow` | 今日/明日のタスク + 親カテゴリでグルーピング、見込み時間合計を含む |
| POST | `/api/tasks/<id>/chat` | プロンプトを v2 に更新（[[DETAIL:]] に estimate_minutes 追加） |
| GET / POST / PUT / DELETE | `/api/projects[/<id>]` | 凍結解除。status/completion_condition/period_start/period_end を扱う |

### 8.3 廃止エンドポイント

| メソッド | パス | 理由 |
|---------|------|-----|
| POST | `/api/tasks/classify` | Q1〜Q6 ウィザード廃止 |
| POST | `/api/tasks/<id>/finalize` | is_draft 概念を移動時バリデーションに統合 |

> `/api/tasks/<id>/schedule`（scheduled_for 設定）は維持。

### 8.4 データ形式の変更

#### `POST /api/tasks/move`
```json
// Request
{
  "target_status": "next_action"
}

// Response (success)
{
  "ok": true,
  "task": { /* updated task */ }
}

// Response (validation error)
{
  "ok": false,
  "error": "カレンダーに入れるには日付を設定してください",
  "level": "error",
  "missing": ["scheduled_date"]
}

// Response (confirm needed)
{
  "ok": false,
  "error": "予定を解除して移動しますか？",
  "level": "confirm",
  "force_param": "force_clear_schedule"
}
```

確認後再送: `{"target_status": "trash", "force_clear_schedule": true}`

#### `POST /api/projects/<id>/activate`
```json
// Request: なし
// Response
{
  "ok": true,
  "project": { /* updated, status='active' */ },
  "activated_tasks": 5
}

// Error: 子タスクが0件
{
  "ok": false,
  "error": "タスクを1件以上登録してください"
}
```

---

## 9. マイグレーション

### 9.1 v1 → v2 マイグレーション戦略

破壊的変更を避けるため、**カラムは残置し新規書き込みを止める**方針:

```
1. 既存 archive.db を archive_pre_v2_YYYYMMDD.db にバックアップ
2. ALTER TABLE で新カラム追加:
   - tasks.estimate_minutes
   - tasks.category_id
   - tasks.project_sort_order
   - projects.status (default 'archived')
   - projects.completion_condition
   - projects.period_start
   - projects.period_end
   - projects.archived (default 1)
3. CREATE TABLE categories（既定の親カテゴリ5件を INSERT）
4. 既存タスクの category → category_id マッピング:
   work → cat_work, learning → cat_input,
   social → cat_session, それ以外 → cat_work
5. 既存 projects のレコードは status='archived' でアーカイブ
   （v1 で凍結中だったため）
6. data/state.json に last_manual_rollover を追加（既存があれば保持）
```

**冪等性**: スクリプトを2回実行してもエラーにならないよう全 ALTER を `try/except` で吸収、`INSERT OR IGNORE`、`CREATE TABLE IF NOT EXISTS`。

### 9.2 マイグレーションスクリプト

`scripts/migrate_to_gtd_v2.py` を新規作成。

### 9.3 旧フィールド処理

| フィールド | DB 上の扱い | 新規書き込み | 読み込み |
|-----------|------------|-------------|---------|
| `importance` | 残置 | しない（NULL） | UI で参照しない |
| `urgency` | 残置 | しない（NULL） | UI で参照しない |
| `is_two_minute` | 残置 | しない（NULL） | UI で参照しない |
| `phase_id` | 残置 | しない（NULL） | UI で参照しない |
| `category` (旧文字列) | 残置 | しない（NULL） | category_id を優先 |

---

## 10. config.py 追加・変更

```python
# v2 で削除
# URGENCY_THRESHOLD_DAYS    ← 削除
# CALENDAR_MIGRATION_DAYS   ← 削除
# CLASSIFY_QUESTIONS        ← 削除

# v2 で維持
DRAFT_RETENTION_DAYS = 7
STATE_FILE = os.path.join(DATA_DIR, 'state.json')

# v2 更新
VALID_GTD_STATUS = {
    'inbox', 'next_action', 'waiting', 'calendar',
    'someday', 'project_pending', 'trash', 'done',
}

# v2 新規
VALID_PROJECT_STATUS = {
    'drafting', 'active', 'completed', 'archived',
}

# 移動時バリデーション用
MOVE_REQUIRED_FIELDS = {
    'calendar': ['scheduled_date'],
    'waiting':  ['waiting_for'],
}

MOVE_FORBIDDEN_TRANSITIONS = {
    # current → target で deadline ありなら拒否
    'someday': {'when': 'has_deadline', 'message': '期限を解除してから移動してください'},
}

# AI モデル選択（既存）
CLAUDE_MODEL_CHAT  = 'sonnet'   # 詳細設計、プロジェクトタスク提案
CLAUDE_MODEL_LIGHT = 'haiku'    # ブレインダンプ、日記
```

---

## 11. 削除対象（v1 コード片の整理）

### 11.1 ファイル

なし（v1 の `analyze.py` は既に削除済み）

### 11.2 関数（gtd.py）

- `calculate_urgency()` — 削除
- `check_deadline_migration()` — 削除
- 2分タスク関連の分岐 — 削除

### 11.3 エンドポイント（app.py）

- `/api/tasks/classify` — 削除
- `/api/tasks/<id>/finalize` — 削除（move バリデーションに統合）
- `/api/projects/*` の 501 暫定実装 — 削除（実装に置換）

### 11.4 フロントエンド（main.js）

- `renderMatrix()` — 削除（マトリクス UI）
- `startClassifyFlow()`, `nextQuestionOrOutcome()` — 削除（Q1〜Q6 静的フロー）
- `QUADRANT_CONFIG` — 削除
- 2分ルール関連の UI ロジック — 削除
- 旧スケジュールタブ関連 — （既に削除済み）

### 11.5 CLAUDE.md

- 「Matrix Quadrants」セクション — 削除
- 「Categories」を新カテゴリ階層の説明に置換
- 「詳細設定相談モード」プロンプトを v2 仕様に更新
- 「プロジェクト用 AI 相談プロンプト」セクションを新規追加

---

## 12. UI コンポーネント設計（フロント）

### 12.1 新規コンポーネント

| 名前 | ファイル | 概要 |
|------|---------|------|
| `renderInboxColumn()` | main.js | 左カラム = オプションなしリスト |
| `renderListColumn()` | main.js | 中央カラム = 各リスト縦並び |
| `renderWorkflowDiagram()` | main.js | 右カラム = GTDワークフロー図（SVG） |
| `setupTaskDragDrop()` | main.js | gtd_status 変更用の D&D ハンドラ |
| `showMoveValidationDialog()` | main.js | エラー/確認のトーストとダイアログ |
| `renderProjectsTab()` | main.js | プロジェクトタブ（3ビュー） |
| `renderProjectDetail()` | main.js | プロジェクト詳細パネル |
| `renderCategoryManager()` | main.js | カテゴリ管理モーダル（追加・編集・削除） |
| `renderRolloverButtons()` | main.js | 朝/夜リセットボタン |

### 12.2 削除コンポーネント

| 名前 | 理由 |
|------|------|
| `renderMatrix()` | マトリクス廃止 |
| `startClassifyFlow()` | 静的フロー廃止 |
| `nextQuestionOrOutcome()` | 同上 |
| `renderQuadrant*()` 系 | 同上 |

---

## 13. 設計上の決定事項一覧

| 番号 | 項目 | 決定 |
|------|------|------|
| D-01 | マトリクス | **完全廃止** |
| D-02 | importance/urgency | **完全廃止** |
| D-03 | 2分ルール / is_two_minute | **完全廃止** |
| D-04 | 「すぐにやること」リスト | **廃止** |
| D-05 | カレンダー自動遷移 | **廃止**（明示D&Dのみ） |
| D-06 | 仕分け方式 | D&D + 参考図表示（強制ウィザードなし） |
| D-07 | rollover | 手動ボタン + 自動 lazy の併用、動作は scheduled_for クリアのみ |
| D-08 | 「名称変更/細分化」リスト | **作らない**（仕様の複雑化を避ける） |
| D-09 | カテゴリ構造 | 2階層（親5既定 + ユーザー子追加） |
| D-10 | 親カテゴリ初期値 | Output / Input / Work / Session / ルーティン |
| D-11 | 見込み時間 | `estimate_minutes` 追加、AI 提案対応 |
| D-12 | プロジェクト機能 | 復活、4状態（drafting/active/completed/archived） |
| D-13 | プロジェクト化タスクの扱い | 元タスクはプロジェクト名として吸収（タスク化しない） |
| D-14 | プロジェクト drafting → active | 「タスク登録」ボタン + 確認ダイアログ |
| D-15 | active 後の追加タスク | 即 next_action（再 drafting なし） |
| D-16 | プロジェクト下書き保存ボタン | 不要（仕様簡素化） |
| D-17 | AI の役割 | category 推定 / roadmap / checklist / estimate_minutes / 期限相談 / タスク分解 / ゴミ箱判定 / プロジェクトタスク一括提案 / 完了条件明確化 |
| D-18 | AI が仕分け判定を提案 | しない（仕分けは常にユーザー） |
| D-19 | 移動バリデーション | ERROR / CONFIRM の2レベル。破壊的操作の確認は不要（trashは保管庫） |
| D-20 | ゴミ箱 | 削除ではなく保管庫。レビューでオプションなしに戻せる |

---

## 14. 未決事項

なし。Phase 1 着手前に全項目クローズ済み。

---

## 15. 関連ドキュメント

- [GTD_TEST_SPEC.md](GTD_TEST_SPEC.md) — v2 テスト仕様
- [GTD_ROADMAP_v2.md](GTD_ROADMAP_v2.md) — 実装ロードマップ・AIモデル割当
- [CONVENTIONS.md](CONVENTIONS.md) — コーディング規約（変更なし）
- [CLAUDE.md](../CLAUDE.md) — AI アシスタント仕様（v2 で更新）
