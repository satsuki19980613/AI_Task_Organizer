# Task Organizer — テスト仕様書

> ⚠️ **このファイルは旧仕様用テスト（GTD 改修前）です。GTD 改修（2026-04-25）以降は履歴参照用。**
> 現行のテスト仕様は [`GTD_TEST_SPEC.md`](GTD_TEST_SPEC.md) を正とする。
> 以下の T1〜T8 は `analyze.py` / 行動ログ / 旧チャットフロー（`[[TASK:]]` 提案）など、GTD 改修で廃止された機能を対象とする。

**対象バージョン**: Phase 1〜4 実装済み（旧仕様）
**作成日**: 2026-04-09
**凍結日**: 2026-04-25
**テスト実行者**: Claude Code (automated) / 開発者 (manual)

---

## 構成概要

| レイヤー | ファイル | 主な責務 |
|----------|----------|----------|
| Backend API | `app.py` | REST エンドポイント、DB操作、Claude CLI呼び出し |
| Analysis | `analyze.py` | スコア計算、レポート生成 |
| Frontend | `static/js/main.js` | UI操作、API呼び出し、Chart.js |
| Template | `templates/index.html` | HTML構造 |
| Style | `static/css/style.css` | レイアウト・スタイル |

---

## T1: バックエンド API テスト

### T1-1: タスク CRUD

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T1-1-1 | タスク一覧取得 (空) | `GET /api/tasks` | `[]` を返す |
| T1-1-2 | タスク作成 — 最小フィールド | `POST /api/tasks` body: `{"title":"テスト","priority":"medium","category":"life"}` | 201、`id`・`created_at`・`completed:false`・`roadmap:[]`・`notes:""` が自動付与 |
| T1-1-3 | タスク作成 — deadline あり | body に `"deadline":"2026-04-30"` を含める | レスポンスに `"deadline":"2026-04-30"` が含まれる |
| T1-1-4 | タスク更新 | `PUT /api/tasks/{id}` body: `{"priority":"high"}` | 変更後のタスク全体を返す |
| T1-1-5 | タスク更新 — 存在しないID | `PUT /api/tasks/INVALID` | 404 + `{"error":"not found"}` |
| T1-1-6 | タスク削除 | `DELETE /api/tasks/{id}` | `{"ok":true}`、一覧から消える |
| T1-1-7 | 複数タスク作成後の一覧 | 3件作成後 `GET /api/tasks` | 3件が配列で返る |

```bash
# 実行コマンド例
curl -s http://localhost:5000/api/tasks
curl -s -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"買い物","priority":"medium","category":"life"}'
```

---

### T1-2: アーカイブ API

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T1-2-1 | タスクをアーカイブ | `POST /api/tasks/{id}/archive` | `{"ok":true,"archived_at":"..."}` |
| T1-2-2 | アーカイブ後のアクティブ一覧 | `GET /api/tasks` | アーカイブしたタスクが消える |
| T1-2-3 | アーカイブ一覧取得 | `GET /api/archive` | アーカイブしたタスクが返る |
| T1-2-4 | アーカイブ検索 | `GET /api/archive?q=買い物` | タイトルに「買い物」を含むものだけ返る |
| T1-2-5 | カテゴリーフィルタ | `GET /api/archive?category=life` | `category=life` のみ返る |
| T1-2-6 | 優先度フィルタ | `GET /api/archive?priority=high` | `priority=high` のみ返る |
| T1-2-7 | ソート: newest | `GET /api/archive?sort=newest` | `archived_at` 降順 |
| T1-2-8 | ソート: oldest | `GET /api/archive?sort=oldest` | `archived_at` 昇順 |
| T1-2-9 | ソート: priority | `GET /api/archive?sort=priority` | high→medium→low 順 |
| T1-2-10 | アーカイブから復元 | `POST /api/archive/{id}/restore` | アクティブ一覧に戻る、DBから消える |
| T1-2-11 | アーカイブ削除 | `DELETE /api/archive/{id}` | DBから完全削除 |
| T1-2-12 | 存在しないIDを復元 | `POST /api/archive/INVALID/restore` | 404 |

---

### T1-3: 行動ログ API

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T1-3-1 | 正常ログ記録 | `POST /api/log` body: `{"task_id":"123","action":"sidebar_open"}` | `{"ok":true}`、`task_behavior_log.jsonl` に1行追記 |
| T1-3-2 | action 欠落 | body: `{"task_id":"123"}` | 400 + `{"error":"missing action"}` |
| T1-3-3 | task_id 空文字 | body: `{"task_id":"","action":"sidebar_open"}` | `{"ok":true}`（task_id省略は許容） |
| T1-3-4 | ログ形式確認 | `task_behavior_log.jsonl` を読む | `{"ts":"...","task_id":"...","action":"..."}` の JSON Lines 形式 |
| T1-3-5 | 連続ログ記録 | 10回連続 POST | 10行追記される |

```bash
curl -s -X POST http://localhost:5000/api/log \
  -H "Content-Type: application/json" \
  -d '{"task_id":"test001","action":"sidebar_open"}'
```

---

### T1-4: レポート API

| ID | テストケース | 操作 | 期待結果 |
|----|-------------|------|----------|
| T1-4-1 | レポート生成 (タスクなし) | `GET /api/report` | `{"generated_at":"...","tasks":[],"weekly_trend":[],"category_stats":{...}}` |
| T1-4-2 | レポート生成 (タスクあり) | タスク作成後 `GET /api/report` | tasks 配列に各タスクの分析結果 |
| T1-4-3 | レスポンスキー確認 | 各タスクオブジェクト | 16キー全て存在: `id, title, category, priority, suggested_priority, deadline, created_at, progress_rate, days_old, days_since_interaction, open_count, chat_count, deadline_urgency, avoidance_score, priority_score, flags` |
| T1-4-4 | `task_analysis_report.json` 生成 | `GET /api/report` 後 | ファイルが作成される |
| T1-4-5 | AI分析 — レポートなし | `POST /api/analyze/ai`（レポートファイルなし） | 404 + `{"error":"no report yet"}` |
| T1-4-6 | AI分析 — レポートあり | レポート生成後 `POST /api/analyze/ai` | `{"response":"..."}` (Claude CLI応答) |

---

## T2: analyze.py 単体テスト

### T2-1: `_deadline_urgency()`

| ID | 入力 | 期待出力 |
|----|------|----------|
| T2-1-1 | `deadline=None` | `0.1` |
| T2-1-2 | `deadline=""` | `0.1` |
| T2-1-3 | `deadline=今日` | `1.0` (1/(0+1)=1.0) |
| T2-1-4 | `deadline=明日` | `0.5` (1/(1+1)=0.5) |
| T2-1-5 | `deadline=3日後` | `0.25` (1/(3+1)=0.25) |
| T2-1-6 | `deadline=99日後` | `≈0.0099` |
| T2-1-7 | `deadline=昨日（過去）` | `1.0` (days_remaining<0 → 0 → 1/(0+1)) |
| T2-1-8 | 不正な日付文字列 `"2026-99-99"` | `0.1` |

```python
# 実行方法
python -c "
from analyze import _deadline_urgency
from datetime import date
today = date.today()
print(_deadline_urgency(None, today))           # 0.1
print(_deadline_urgency(today.isoformat(), today))  # 1.0
print(_deadline_urgency('2026-99-99', today))   # 0.1
"
```

---

### T2-2: `_avoidance_score()`

| ID | 入力 | 期待出力 |
|----|------|----------|
| T2-2-1 | events=[], progress=0.0, days_old=0 | `0.0` (engagement=0) |
| T2-2-2 | sidebar_open×1, progress=0.0, days_old=10 | 正の値、0〜1の範囲 |
| T2-2-3 | sidebar_open×5, progress=0.0, days_old=30 | T2-2-2より大きい値 |
| T2-2-4 | progress=1.0 (完了) | `0.0` に近い (`1-progress_rate=0`) |
| T2-2-5 | chat_sent×1 vs sidebar_open×2 | 等しい (chat×2 重み) |
| T2-2-6 | 任意の入力 | 結果が必ず `[0.0, 1.0]` の範囲内 |

```python
python -c "
from analyze import _avoidance_score
events = [{'action':'sidebar_open'}] * 5 + [{'action':'task_chat_sent'}] * 3
print(_avoidance_score(events, 0.0, 30))   # 高スコア
print(_avoidance_score(events, 1.0, 30))   # 0に近い
print(_avoidance_score([], 0.0, 0))        # 0.0
"
```

---

### T2-3: `run_analysis()` 統合

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T2-3-1 | `tasks.json` なし | エラーなし、`tasks:[]` |
| T2-3-2 | ログなし、タスク3件 | `days_since_interaction` = `days_old` |
| T2-3-3 | `priority_score` 範囲 | 全タスクで `0.0 ≤ P ≤ 1.0` |
| T2-3-4 | `suggested_priority` 分岐 | P≥0.7→"high", 0.4≤P<0.7→"medium", <0.4→"low" |
| T2-3-5 | `high_avoidance` フラグ | A>0.5, progress<0.3, days_old>5 の条件を満たすとき付与 |
| T2-3-6 | `deadline_critical` フラグ | 期限3日以内かつ D>0.25 のとき付与 |
| T2-3-7 | `category_stats` 全カテゴリー | work/health/life/learning/social/admin の6キー全て存在 |
| T2-3-8 | `weekly_trend` 上限 | イベントが多くても最大8エントリー |

```bash
python analyze.py
# 期待出力例: 分析完了  タスク数: N / 要注意: M
```

---

## T3: フロントエンド機能テスト

### T3-1: タブ切り替え

| ID | 操作 | 期待結果 |
|----|------|----------|
| T3-1-1 | 「タスク」タブをクリック | `panel-tasks` が表示、他が非表示 |
| T3-1-2 | 「チャット」タブをクリック | `panel-chat` が表示 |
| T3-1-3 | 「スケジュール」タブをクリック | `panel-schedule` が表示 |
| T3-1-4 | 「レポート」タブをクリック | `panel-report` が表示 |
| T3-1-5 | 「アーカイブ」タブをクリック | `panel-archive` が表示 |
| T3-1-6 | アクティブタブのスタイル | クリックしたボタンに `active` クラス |

---

### T3-2: タスク管理 UI

| ID | 操作 | 期待結果 |
|----|------|----------|
| T3-2-1 | 「＋ タスクを追加」クリック | モーダルが開く |
| T3-2-2 | モーダル「キャンセル」クリック | モーダルが閉じる |
| T3-2-3 | タイトル空でモーダル「追加する」 | 何も起きない（バリデーション） |
| T3-2-4 | タスク追加 (high) | `cards-high` にカードが追加される |
| T3-2-5 | タスク追加 (medium) | `cards-medium` にカードが追加される |
| T3-2-6 | タスク追加 (low) | `cards-low` にカードが追加される |
| T3-2-7 | タスクカードをクリック | サイドバーが開く |
| T3-2-8 | サイドバーの「閉じる」クリック | サイドバーが閉じる |

---

### T3-3: サイドバー機能

| ID | 操作 | 期待結果 |
|----|------|----------|
| T3-3-1 | サイドバー開時のログ | `/api/log` に `sidebar_open` が記録される |
| T3-3-2 | ロードマップステップのチェック | `/api/log` に `roadmap_step_toggle`、`PUT /api/tasks/{id}` が呼ばれる |
| T3-3-3 | ロードマップにステップ追加 | テキスト入力→Enter で項目追加、APIに保存 |
| T3-3-4 | 優先度変更 | ラジオボタン変更→`PUT /api/tasks/{id}` で即時保存 |
| T3-3-5 | サイドバーチャットで送信 | `/api/tasks/{id}/chat` が呼ばれ、応答が表示される |
| T3-3-6 | サイドバーチャット送信ログ | `/api/log` に `task_chat_sent` が記録される |
| T3-3-7 | アーカイブボタン | タスクがアーカイブされ、カードが消える |
| T3-3-8 | 削除ボタン | タスクが削除され、カードが消える |

---

### T3-4: チャットパネル

| ID | 操作 | 期待結果 |
|----|------|----------|
| T3-4-1 | メッセージ入力→Ctrl+Enter | 送信される |
| T3-4-2 | メッセージ入力→Enter | 改行される（送信しない） |
| T3-4-3 | 送信中 | タイピングインジケーターが表示される |
| T3-4-4 | AI応答に `[[TASK:...]]` 含む | タスク提案UIが表示される |
| T3-4-5 | タスク提案「追加する」クリック | タスクが作成され、タスクタブに表示される |
| T3-4-6 | タスク提案「キャンセル」クリック | 提案が消える |

---

### T3-5: レポートパネル

| ID | 操作 | 期待結果 |
|----|------|----------|
| T3-5-1 | レポートタブ初期表示 | 「更新ボタンを押して...」の空状態 |
| T3-5-2 | 「更新」ボタンクリック | `/api/report` を呼び、グラフが描画される |
| T3-5-3 | チャートの表示 | 4つのチャット領域が表示される |
| T3-5-4 | 週次トレンドチャート (データなし) | 「データが蓄積されると...」メッセージ |
| T3-5-5 | 「更新」を2回クリック | グラフが二重にならない（既存インスタンス破棄） |
| T3-5-6 | 「AI分析」ボタンクリック | `/api/analyze/ai` を呼び、テキスト応答が表示される |
| T3-5-7 | 注意タスクのクリック | タスクタブに切り替わり、サイドバーが開く |

---

### T3-6: アーカイブパネル

| ID | 操作 | 期待結果 |
|----|------|----------|
| T3-6-1 | アーカイブタブ表示 | アーカイブ済みタスクの一覧 |
| T3-6-2 | 検索ボックスに入力 | リアルタイムフィルタリング |
| T3-6-3 | カテゴリーフィルタ変更 | フィルタリングされる |
| T3-6-4 | 優先度フィルタ変更 | フィルタリングされる |
| T3-6-5 | ソート変更 | 並び順が変わる |
| T3-6-6 | 「復元」クリック | タスクがアクティブに戻る |
| T3-6-7 | 「削除」クリック | アーカイブから完全削除 |

---

## T4: スコアリング ロジック検証

### T4-1: 優先度スコア統合式 `P = D + A × (1 - D) × 0.7`

| ID | 条件 | D | A | 期待P |
|----|------|---|---|-------|
| T4-1-1 | 期限なし、ログなし | 0.1 | 0.0 | `0.1 + 0.0 × 0.9 × 0.7 = 0.1` |
| T4-1-2 | 期限今日、ログなし | 1.0 | 0.0 | `1.0 + 0.0 × 0.0 × 0.7 = 1.0` |
| T4-1-3 | 期限明日、A=0.5 | 0.5 | 0.5 | `0.5 + 0.5 × 0.5 × 0.7 = 0.675` |
| T4-1-4 | 期限なし、高回避 A=0.8 | 0.1 | 0.8 | `0.1 + 0.8 × 0.9 × 0.7 = 0.604` |
| T4-1-5 | D=1.0 のとき A の影響 | 1.0 | 任意 | `P = 1.0`（Aが影響しない） |

```python
python -c "
def P(D, A, lam=0.7): return round(D + A * (1 - D) * lam, 4)
print(P(0.1, 0.0))  # 0.1
print(P(1.0, 0.0))  # 1.0
print(P(0.5, 0.5))  # 0.675
print(P(0.1, 0.8))  # 0.604
print(P(1.0, 0.8))  # 1.0
"
```

---

### T4-2: フラグ付与条件

```python
# high_avoidance フラグのテスト
python -c "
import json, os

# tasks.json にテストタスクを用意し analyze.py を実行して flags を確認
from analyze import run_analysis
r = run_analysis()
for t in r['tasks']:
    print(t['title'], t['flags'], t['avoidance_score'], t['progress_rate'], t['days_old'])
"
```

---

## T5: データ永続性テスト

| ID | テストケース | 手順 | 期待結果 |
|----|-------------|------|----------|
| T5-1 | サーバー再起動後のタスク保持 | タスク追加→サーバー再起動→`GET /api/tasks` | タスクが残っている |
| T5-2 | サーバー再起動後のアーカイブ保持 | アーカイブ→再起動→`GET /api/archive` | アーカイブが残っている |
| T5-3 | ログファイル追記 | 複数回ログ→ファイル確認 | 既存行を上書きせず追記 |
| T5-4 | `tasks.json` 手動編集後 | ファイルを直接編集→`GET /api/tasks` | 編集内容が反映される |
| T5-5 | `tasks.json` が不正JSON | 不正なJSONを書く→`GET /api/tasks` | `[]` を返す（クラッシュしない） |

---

## T6: エラーハンドリング・境界値テスト

| ID | テストケース | 期待結果 |
|----|-------------|----------|
| T6-1 | 空の `tasks.json` (`[]`) | 正常に空配列を返す |
| T6-2 | `task_behavior_log.jsonl` に不正なJSONが1行 | その行をスキップし他を正常処理 |
| T6-3 | `created_at` フィールドがないタスク | `days_old=0` として処理 |
| T6-4 | `deadline` フィールドがないタスク | `D=0.1` として処理 |
| T6-5 | `roadmap` が空のタスク | `progress_rate=0.0` として処理 |
| T6-6 | Claude CLI が存在しないとき | `/api/chat` がエラーメッセージを返す（クラッシュしない） |
| T6-7 | Claude CLI タイムアウト | 120秒後にタイムアウトメッセージを返す |

---

## T7: シナリオテスト（E2E）

### シナリオ A: タスク作成から分析まで

```
1. チャットに「英語の勉強をしたい」と入力
2. AIと対話しタスクを確定
3. [[TASK:...]] が生成され「追加する」をクリック
4. タスクタブで新しいタスクを確認
5. タスクをクリックしてサイドバーを開く
6. ロードマップのステップをいくつかチェック
7. サイドバーチャットで質問を送信
8. レポートタブ→「更新」クリック
9. 分析結果でそのタスクが表示されることを確認
10. 「AI分析」でAIのコメントを確認
```

### シナリオ B: 回避スコアの蓄積確認

```
1. タスクを作成（roadmap あり）
2. /api/log に sidebar_open を10回送信
3. /api/report を実行
4. avoidance_score が 0.0 より大きいことを確認
5. roadmap を全て完了済みにする
6. /api/report を再実行
7. avoidance_score が下がっていることを確認
```

```bash
# ログを手動で送り込むスクリプト
TASK_ID="<タスクIDをここに入力>"
for i in $(seq 1 10); do
  curl -s -X POST http://localhost:5000/api/log \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$TASK_ID\",\"action\":\"sidebar_open\"}"
done
curl -s http://localhost:5000/api/report | python -m json.tool | grep avoidance_score
```

### シナリオ C: アーカイブサイクル

```
1. タスクを作成
2. タスクをアーカイブ
3. アーカイブタブで確認・検索
4. タスクを復元
5. タスクタブに戻っていることを確認
6. アーカイブから完全削除
```

---

## T8: チャート描画テスト

| ID | テストケース | 確認方法 |
|----|-------------|---------|
| T8-1 | 週次トレンド (データあり) | ログ複数件 → レポート更新 → 折れ線グラフ表示 |
| T8-2 | 週次トレンド (データなし) | ログなし → 「データが蓄積されると...」メッセージ |
| T8-3 | カテゴリーレーダーチャート | 複数カテゴリーのタスクあり → レーダーに複数軸 |
| T8-4 | 回避スコア棒グラフ | カテゴリー別の高さが avg_avoidance と一致 |
| T8-5 | 優先度スコア横棒グラフ | 上位8タスクが priority_score 降順で表示 |
| T8-6 | チャート再描画 | 「更新」を複数回 → Canvas エラーが出ない |

---

## テスト実行チェックリスト

```
[ ] サーバーが起動している (python app.py)
[ ] http://localhost:5000 でアクセス可能
[ ] tasks.json が存在する (または初回作成される)
[ ] archive.db が存在する (または自動作成される)
[ ] Claude CLI が C:\Users\sa641.SATSUKIPC\.local\bin\claude.exe に存在する
[ ] Python 依存: flask, flask-socketio, sqlite3 (標準), math (標準)
```

---

## 優先テスト順序

1. **T1** (API) — バックエンドの基盤を先に確認
2. **T2** (analyze.py) — スコアリングの正確性
3. **T4** (スコア検証) — 数式の妥当性
4. **T3-2〜T3-3** (タスクUI) — コア機能
5. **T3-5** (レポートUI) — 新機能
6. **T7** (E2Eシナリオ) — 統合動作
7. **T5, T6** (永続性・エラー) — 堅牢性
