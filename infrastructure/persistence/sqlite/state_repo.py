"""state.json 永続化（last_rollover_date 等）。

DB ではなく JSON ファイル。SQLite の強制ではないので「sqlite」配下に置くのは
若干違和感があるが、persistence 層として一箇所にまとめておく。将来 DB 化や
KV 化したい時はここを差し替える。
"""
import json
import os
from typing import Any

from infrastructure.errors import RepositoryError


_DEFAULT_STATE: dict[str, Any] = {
    'last_rollover_date':   None,
    'last_draft_cleanup':   None,
    'last_manual_rollover': None,
}


class JsonStateRepository:
    def __init__(self, state_file: str):
        self._file = state_file

    def load(self) -> dict[str, Any]:
        if not os.path.exists(self._file):
            return dict(_DEFAULT_STATE)
        try:
            with open(self._file, 'r', encoding='utf-8') as f:
                state = json.load(f) or {}
        except (OSError, json.JSONDecodeError):
            return dict(_DEFAULT_STATE)
        for k, v in _DEFAULT_STATE.items():
            state.setdefault(k, v)
        return state

    def save(self, state: dict[str, Any]) -> None:
        try:
            os.makedirs(os.path.dirname(self._file), exist_ok=True)
            with open(self._file, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
        except OSError as e:
            raise RepositoryError(f'state.json save failed: {e}', cause=e) from e
