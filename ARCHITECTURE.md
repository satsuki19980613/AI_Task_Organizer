# ARCHITECTURE — AI 開発規約

このドキュメントは、AI が本リポジトリで**迷わず最短距離で**コードを修正・拡張するためのナビゲーション・マニフェストです。実装作業の前に必ず本ファイルを参照してください。

---

## 0. 設計の中核原則（一行要約）

1. **DIP**: コアは抽象（`core/ports/`）にのみ依存。具体実装は外から注入。
2. **イベント駆動**: コアは状態変化をイベント発行するだけ。誰が反応するか知らない。
3. **単一責任**: 1ファイル1責務、目安 ≤ 200行。
4. **境界での堅牢性**: 検証・例外変換・観測は境界層に集中。
5. **AI 開発効率**: 予測可能な配置、規約優先、明示的型、副作用の局所化。

---

## 1. ディレクトリ責務マップ

| パス | 責務 | 何を import してよいか |
|------|------|----------------------|
| `core/domain/` | エンティティ、純粋ロジック、検証、エラー型 | 標準ライブラリのみ |
| `core/ports/` | 抽象インターフェース（Protocol） | `core/domain/` |
| `core/services/` | ユースケース。ports に依存し具体実装を知らない | `core/domain/`, `core/ports/` |
| `core/events.py` | ドメインイベント定義（dataclass） | `core/domain/` |
| `infrastructure/persistence/` | repo の SQLite 実装 | `core/`, `config/`, sqlite3 |
| `infrastructure/ai/` | AIEngine の実装（subprocess / HTTP 等） | `core/`, `config/`, subprocess/HTTP |
| `core/services/ai_prompts.py` | プロンプトテンプレート（純粋関数） | `config/` のみ |
| `core/services/ai_extractors.py` | AI 応答からの構造化抽出（純粋関数） | 標準ライブラリのみ |
| `infrastructure/eventing/` | EventBus の実装、購読者 | `core/` |
| `interfaces/web/` | Flask アダプタ（routes, schemas, container, error_handlers） | 全層 |
| `config/` | 設定値・定数 | 標準ライブラリのみ |
| `tests/` | 単体・統合テスト、fakes | 全層 |

### import 方向ルール（厳守）

```
interfaces/  ─┐
              ├─→ core/services/ ─→ core/ports/ ─→ core/domain/
infrastructure/ ─┘
config/  ←  全層から参照可
```

- **`core/` は `infrastructure/` `interfaces/` を import してはいけない**。
- 違反検査: `grep -r "from infrastructure" core/` `grep -r "from interfaces" core/` が空であること。

---

## 2. レシピ集 — 「X を追加・変更したい時」

### A. 新しい HTTP エンドポイントを追加する
編集ファイル（**3つだけ**）:
1. `interfaces/web/schemas.py` — リクエスト/レスポンスの検証スキーマ追加
2. `core/services/<domain>_service.py` — ユースケース・メソッド追加（必要なら）
3. `interfaces/web/routes/<domain>.py` — Blueprint にルート追加

### B. 新しい AI バックエンドを追加する（例: Anthropic API）
編集ファイル:
1. `infrastructure/ai/api_engine.py` — `AIEngine` Protocol を実装したクラスを新規作成
2. `interfaces/web/container.py` — `AI_BACKEND` 環境変数の分岐に追加
3. `core/` は**一切編集しない**

### C. 新しい通知チャネル（Web Push 等）を追加する
編集ファイル:
1. `infrastructure/eventing/subscribers/<channel>.py` — イベント購読ハンドラを新規作成
2. `interfaces/web/container.py` — `event_bus.subscribe(EventType, handler)` を1行追加
3. `core/`, `core/services/` は**一切編集しない**（これが原則 #2 の核心）

### D. 新しいドメインイベントを追加する
編集ファイル:
1. `core/events.py` — dataclass で新イベント追加
2. 該当 `core/services/<domain>_service.py` — `event_bus.publish(NewEvent(...))` を呼ぶ
3. 購読側は B/C のレシピで後付け

### E. DB スキーマを変更する
編集ファイル:
1. `infrastructure/persistence/sqlite/schema.py` — マイグレーション追加
2. `infrastructure/persistence/sqlite/mappers.py` — 行 ↔ entity 変換更新
3. `infrastructure/persistence/sqlite/<domain>_repo.py` — クエリ更新
4. `core/domain/entities.py` — entity に新フィールド（必要なら）

### F. 新しいバリデーション・ルールを追加する
編集ファイル:
1. **形式エラー**（型・必須・範囲）: `interfaces/web/schemas.py`
2. **業務ルール**（GTD 状態遷移等）: `core/domain/validation.py`

---

## 3. 命名規約

| 種別 | パターン | 例 |
|------|---------|----|
| Repository Protocol | `<Entity>Repository` | `TaskRepository` |
| Repository 実装 | `Sqlite<Entity>Repository` | `SqliteTaskRepository` |
| Service | `<Domain>Service` | `TaskService` |
| Event | 過去形 | `TaskCreated`, `TaskMoved`, `TaskArchived` |
| エラー（domain） | `<Concept>Error` | `ValidationError`, `NotFoundError` |
| エラー（infra） | `<Layer>Error` | `RepositoryError`, `AIEngineError` |

---

## 4. ファイルサイズ目標

| 層 | 行数の目安 | 超過時の対応 |
|----|-----------|-------------|
| `core/domain/*` | ≤ 150 | 概念単位で分割 |
| `core/ports/*` | ≤ 80 | Protocol 1個 = 1ファイルで分割 |
| `core/services/*` | ≤ 200 | ユースケース単位で分割 |
| `infrastructure/persistence/*_repo.py` | ≤ 200 | テーブル単位で分割 |
| `interfaces/web/routes/*` | ≤ 150 | ドメイン単位で分割 |
| `interfaces/web/app.py` | ≤ 150 | Blueprint 登録 + container 初期化のみ |

200行を超えたら**分割を検討**。ただし機械的に分けず、責務境界が自然な場所で分ける。

---

## 5. 共通パターン（全 AI が同じ書き方をする）

### Repository
```python
class TaskRepository(Protocol):
    def get(self, id: str) -> Task: ...           # NotFound → NotFoundError
    def list(self, **filters) -> list[Task]: ...
    def save(self, task: Task) -> None: ...       # 新規/更新どちらも
    def delete(self, id: str) -> None: ...
```

### Service メソッド
```python
def create(self, ...) -> Task:
    # 1. 検証（domain validation）
    # 2. entity 構築
    # 3. repo.save()
    # 4. event_bus.publish(TaskCreated(task))
    # 5. return
```

### Route
```python
@bp.post('/tasks')
def create_task():
    payload = schemas.CreateTask.parse(request.get_json())  # 形式検証
    task = task_service.create(**payload)                   # 業務処理
    return jsonify(task.to_dict()), 201
```

すべての service メソッドは**この4〜5ステップ構造**を守る。AI はこの形を見つけたら同じパターンを再利用する。

### Python の罠: `list` メソッドと型アノテーション

repo / port / Protocol で `def list(...)` を定義すると、クラススコープで builtin の `list` がシャドウされ、後続の `list[Task]` アノテーションが評価時エラー（`'function' object is not subscriptable`）になる。

**ルール**: `def list(...)` を持つすべてのクラスのファイル先頭に必ず以下を入れる：

```python
from __future__ import annotations
```

これでアノテーションが文字列化（遅延評価）され、`list[X]` がクラス定義時に評価されなくなる。`core/ports/repositories.py` および `infrastructure/persistence/sqlite/*_repo.py` で適用済み。

---

## 6. 副作用の場所

| 副作用 | 発生してよい場所 |
|--------|---------------|
| DB 書き込み | `infrastructure/persistence/*_repo.py` のみ |
| 外部プロセス起動 / HTTP | `infrastructure/ai/*` のみ |
| イベント発行 | `core/services/*` のみ |
| イベント購読・反応 | `infrastructure/eventing/subscribers/*` のみ |
| 例外 → HTTP 変換 | `interfaces/web/error_handlers.py` のみ |

これ以外の場所で副作用を起こしてはいけない。

---

## 7. 開発前チェックリスト（AI 用）

実装に着手する前に：

- [ ] §2 のレシピのどれに該当するか確認した
- [ ] 編集対象ファイルを §2 のリストに沿って特定した
- [ ] §1 の import 方向を違反していないか確認した
- [ ] §5 の共通パターンに沿って書く
- [ ] §4 のファイルサイズを超えそうなら分割を検討した
