"""AI 応答テキストから構造化データを取り出すユーティリティ。

`[[DETAIL:{...}]]` や `[[PROJECT_TASKS:{...}]]` のようなインライン JSON、
および応答全体が JSON である braindump/diary の要約抽出をサポート。

すべて純粋関数。失敗時は None または raise（呼び出し側がフォールバック処理）。
"""
import json
import re
from typing import Optional


def extract_marker_json(text: str, marker: str) -> tuple[Optional[dict], str]:
    """`[[<MARKER>:{...}]]` を取り出す。返り値は (パース結果, 取り除いた本文)。

    例:
        extract_marker_json("はい [[DETAIL:{\"a\":1}]] です", "DETAIL")
        # → ({"a": 1}, "はい  です")
    """
    pattern = re.compile(rf'\[\[{re.escape(marker)}:(\{{.*?\}})\]\]', re.DOTALL)
    m = pattern.search(text)
    if not m:
        return None, text
    try:
        parsed = json.loads(m.group(1))
        if not isinstance(parsed, dict):
            parsed = None
    except json.JSONDecodeError:
        parsed = None
    cleaned = (text[:m.start()] + text[m.end():]).strip()
    return parsed, cleaned


def extract_first_json_object(text: str) -> Optional[dict]:
    """応答に含まれる最初の `{...}` を JSON としてパースする。失敗時 None。"""
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m:
        return None
    try:
        parsed = json.loads(m.group())
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
