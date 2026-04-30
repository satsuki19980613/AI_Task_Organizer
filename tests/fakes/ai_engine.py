"""FakeAIEngine — AI 呼び出しを実行せず、用意した応答を返す。"""
from typing import Any


class FakeAIEngine:
    def __init__(self, responses: list[str] | None = None):
        self.responses = list(responses or [])
        self.calls: list[tuple[str, list, str]] = []

    def chat(self, system: str, messages: list[dict[str, Any]], model: str) -> str:
        self.calls.append(('chat', list(messages), model))
        return self._next()

    def complete(self, prompt: str, model: str) -> str:
        self.calls.append(('complete', [prompt], model))
        return self._next()

    def _next(self) -> str:
        if not self.responses:
            return ''
        return self.responses.pop(0)
