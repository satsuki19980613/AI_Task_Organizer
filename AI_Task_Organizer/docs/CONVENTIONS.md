# AI Task Organizer — 開発規約

このファイルはコードの秩序を維持するための規約を定めます。
改修時は必ずこのファイルを参照し、記載の方針に従ってください。

---

## ディレクトリ構成

```
AI_Task_Organizer/
├── config.py          # 全定数・設定値（マジックナンバー禁止）
├── db.py              # SQLite 操作（スキーマ定義・型変換のみ）
├── storage.py         # JSON ファイル I/O（tasks/projects/CLAUDE.md）
├── app.py             # Flask ルート定義（薄いコントローラー）
├── analyze.py         # タスク分析・スコア計算モジュール
├── requirements.txt   # Python 依存パッケージ
├── start.bat          # Windows 起動スクリプト（start.ps1 を呼ぶ）
├── start.ps1          # Python プロセス管理・ブラウザ起動
├── CLAUDE.md          # AI アシスタント用プロンプト仕様
├── data/              # 永続データ（全ファイルは .gitignore 推奨）
│   ├── tasks.json
│   ├── projects.json
│   ├── archive.db
│   ├── task_behavior_log.jsonl
│   └── task_analysis_report.json
├── docs/              # 設計ドキュメント
│   ├── CONVENTIONS.md （このファイル）
│   └── TEST_SPEC.md
├── static/
│   ├── css/style.css
│   ├── js/main.js
│   ├── icons/icon.svg
│   ├── manifest.json
│   └── sw.js
└── templates/
    └── index.html
```

---

## 責務の分離ルール

### config.py
- **役割**: 全マジックナンバー・定数の唯一の定義場所
- **禁止**: ビジネスロジック、I/O 処理
- **追加ルール**: 数値・文字列リテラルを他の .py ファイルに直接書かない。
  新しい設定値が必要になったら必ず config.py に定義してからインポートする。

### db.py
- **役割**: SQLite の接続・スキーマ管理・行変換
- **禁止**: Flask ルート、JSON ファイル I/O、ビジネスロジック
- **追加ルール**: テーブル追加・カラム追加は `init_db()` 内の migration パターンに従う。

### storage.py
- **役割**: `tasks.json` / `projects.json` / `CLAUDE.md` の読み書き
- **禁止**: DB 操作、Flask ルート
- **追加ルール**: ファイルパスは config.py からインポートする。

### app.py
- **役割**: Flask ルート定義（エンドポイントのマッピングと HTTP レスポンス）
- **禁止**: ビジネスロジックの肥大化（分析処理・スコア計算は analyze.py へ）
- **追加ルール**: 新しいエンドポイントを追加するときは `# ── XXX API ──` のセクション区切りに従う。

### analyze.py
- **役割**: タスクデータの統計分析・スコア算出・レポート生成
- **禁止**: Flask ルート、HTTP 処理
- **追加ルール**: スコア計算式の定数変更は config.py で行う。

---

## マジックナンバー・ハードコード禁止

以下の値を .py ファイルに直書きすることを**禁止**します。
必ず `config.py` に定義してからインポートしてください。

| 禁止例 | config.py 定数 |
|--------|----------------|
| `120` (タイムアウト秒) | `CLAUDE_TIMEOUT` |
| `20` (チャット履歴上限) | `CHAT_HISTORY_LIMIT` |
| `40` (ブレインダンプ履歴) | `DUMP_HISTORY_LIMIT` |
| `10` (プロジェクト履歴) | `PROJECT_HISTORY_LIMIT` |
| `100` (エラー文字列切り捨て) | `ERROR_TEXT_LIMIT` |
| `5` (類似タスク件数) | `SIMILAR_TASKS_LIMIT` |
| `0.7` (回避スコア重み) | `AVOIDANCE_LAMBDA` |
| `0.7` / `0.4` (優先度閾値) | `PRIORITY_HIGH/MED_THRESHOLD` |
| `{'work','health',...}` | `VALID_CATEGORIES` |

---

## データファイル

- **場所**: すべて `data/` ディレクトリ以下
- **パス参照**: `config.py` の定数（`TASKS_FILE`, `DB_FILE`, など）を使う
- **直接編集**: 開発・デバッグ目的での手動編集は許容するが、本番データのバックアップを推奨
- **.gitignore**: `data/` は機密データを含む可能性があるため gitignore を推奨

---

## フロントエンド (main.js)

- **現状**: `static/js/main.js` に全フロントエンドロジックが含まれる（単一ファイル構成）
- **方針**: ビルドツール（webpack 等）なしで動作する構成を維持する。
  分割が必要になった場合は ES Modules + `<script type="module">` を検討する。
- **定数**: `CATEGORY_CONFIG`, `QUADRANT_CONFIG` はファイル先頭に定義済み。追加設定はここに加える。
- **スタイル**: CSS カスタムプロパティ（`var(--accent)` 等）を使い、カラーコードの直書きを避ける。

---

## API 設計規約

### エンドポイント命名
```
GET    /api/{resource}              一覧取得
POST   /api/{resource}              新規作成
PUT    /api/{resource}/{id}         更新
DELETE /api/{resource}/{id}         削除
POST   /api/{resource}/{id}/{action} 特殊操作（archive, restore など）
POST   /api/{parent}/{pid}/{child}/{cid}/chat  チャット系
```

### レスポンス形式
- 成功: `jsonify(data)` + 適切なステータスコード（200/201）
- エラー: `jsonify({'error': 'message'}), 404/400`
- 操作成功: `jsonify({'ok': True})`

---

## AI ブロック形式

AI (Claude) が出力する構造化データは以下の形式を使う。
フォーマットの追加・変更時は `CLAUDE.md` と `app.py` の両方を更新すること。

| ブロック | 用途 | パース場所 |
|----------|------|-----------|
| `[[TASK:{...}]]` | タスク作成提案 | `api_chat`, `phase_chat` |
| `[[PROJECT:{...}]]` | プロジェクト作成提案 | `api_chat` |
| `[[UPDATE_STEP:{...}]]` | ステップ内容の更新 | `task_chat` |

---

## テスト

テスト仕様は `docs/TEST_SPEC.md` を参照。
機能追加時は対応するテストケースを TEST_SPEC.md に追記すること。

### 最低限確認すべきこと（改修後チェックリスト）
```
[ ] python -m py_compile config.py db.py storage.py app.py analyze.py
[ ] python analyze.py  （エラーなく完了する）
[ ] GET  /api/tasks    → 200
[ ] POST /api/tasks    → 201（必須フィールドが自動付与される）
[ ] GET  /api/archive  → 200
[ ] GET  /api/report   → 200（分析レポートが返る）
```

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-04-20 | 初版作成。責務分離リファクタリング（config/db/storage 分離、data/ ディレクトリ導入）|
