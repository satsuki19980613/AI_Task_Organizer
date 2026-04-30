"""AI 応答抽出ユーティリティのテスト。"""
from core.services.ai_extractors import (
    extract_marker_json, extract_first_json_object,
)


def test_marker_json_basic():
    parsed, cleaned = extract_marker_json('hello [[DETAIL:{"a":1}]] bye', 'DETAIL')
    assert parsed == {'a': 1}
    assert '[[DETAIL' not in cleaned
    assert 'hello' in cleaned and 'bye' in cleaned


def test_marker_json_missing_returns_none():
    parsed, cleaned = extract_marker_json('no marker here', 'DETAIL')
    assert parsed is None
    assert cleaned == 'no marker here'


def test_marker_json_bad_json_returns_none():
    parsed, cleaned = extract_marker_json('[[DETAIL:{not json}]]', 'DETAIL')
    assert parsed is None
    assert '[[DETAIL' not in cleaned  # 取り除く


def test_first_json_object_finds_braces():
    parsed = extract_first_json_object('text before {"x": 2} text after')
    assert parsed == {'x': 2}


def test_first_json_object_no_braces():
    assert extract_first_json_object('plain text') is None
