"""AI engine port — what services need from any AI backend.

実装は infrastructure/ai/ に置く（subprocess_engine.py, api_engine.py 等）。
コンテナで `AI_BACKEND` 環境変数によって選択する。

すべての実装は失敗時に `infrastructure.errors.AIEngineError` を投げる。
タイムアウトは `AITimeoutError`、JSON パース失敗は `AIResponseFormatError`。
"""
from typing import Any, Protocol


class AIEngine(Protocol):
    def chat(
        self,
        system: str,
        messages: list[dict[str, Any]],
        model: str,
    ) -> str:
        """会話履歴を渡してアシスタントの応答テキストを返す。

        Args:
            system   : システムプロンプト
            messages : [{"role": "user"|"assistant", "content": "..."}, ...]
            model    : 'sonnet' | 'haiku' 等のモデル識別子
        Returns:
            応答テキスト（trim 済み）
        """
        ...

    def complete(self, prompt: str, model: str) -> str:
        """単発プロンプトで応答テキストを取得する（chat の簡易版）。"""
        ...
