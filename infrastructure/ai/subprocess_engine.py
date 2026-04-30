"""Claude Code CLI を subprocess 起動して応答を得る AIEngine 実装。

Windows 環境で `claude.exe` が利用できることが前提。クラウド/モバイルで動かす
場合は `api_engine.py`（未実装）を別途用意し、container で AI_BACKEND 環境
変数によって切替える。
"""
import subprocess
from typing import Any

from infrastructure.errors import (
    AIEngineError, AITimeoutError,
)


class SubprocessAIEngine:
    """`claude --print --model <m> -p <prompt>` を呼び stdout を返す。"""

    def __init__(self, claude_path: str, timeout: int):
        self._claude_path = claude_path
        self._timeout = timeout

    def chat(
        self,
        system: str,
        messages: list[dict[str, Any]],
        model: str,
    ) -> str:
        prompt = self._format_chat_prompt(system, messages)
        return self._run(prompt, model)

    def complete(self, prompt: str, model: str) -> str:
        return self._run(prompt, model)

    # ── internals ──────────────────────────────────────
    @staticmethod
    def _format_chat_prompt(system: str, messages: list[dict[str, Any]]) -> str:
        parts = [system, '\n\n--- 会話 ---\n']
        for msg in messages:
            role_jp = 'ユーザー' if msg.get('role') == 'user' else 'アシスタント'
            parts.append(f'\n{role_jp}: {msg.get("content", "")}')
        parts.append('\nアシスタント:')
        return ''.join(parts)

    def _run(self, prompt: str, model: str) -> str:
        try:
            result = subprocess.run(
                [self._claude_path, '--print', '--model', model, '-p', prompt],
                capture_output=True,
                text=True,
                encoding='utf-8',
                timeout=self._timeout,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except subprocess.TimeoutExpired as e:
            raise AITimeoutError('Claude CLI timed out', cause=e) from e
        except Exception as e:
            raise AIEngineError(f'Claude CLI failed: {e}', cause=e) from e

        text = (result.stdout or '').strip()
        if not text:
            stderr = (result.stderr or '').strip()
            raise AIEngineError(
                f'Claude CLI returned empty stdout: {stderr[:200]}'
            )
        return text
