"""BraindumpService — AI 連携を fakes で差し替えてテスト。"""
import json
from datetime import datetime

import pytest

from core.events import BraindumpSaved
from core.services.braindump_service import BraindumpService
from tests.fakes.ai_engine import FakeAIEngine
from tests.fakes.clock import FakeClock
from tests.fakes.event_bus import RecordingEventBus
from tests.fakes.repositories import InMemoryBraindumpRepository


def _build():
    bus = RecordingEventBus()
    fake_ai = FakeAIEngine()
    svc = BraindumpService(
        braindump_repo=InMemoryBraindumpRepository(),
        ai_engine=fake_ai,
        event_bus=bus,
        clock=FakeClock(datetime(2026, 4, 28, 10, 0, 0)),
        model_light='haiku',
    )
    return svc, bus, fake_ai


def test_save_extracts_json_summary():
    svc, bus, ai = _build()
    ai.responses.append(json.dumps({
        'title': 'テーマ', 'summary': '要点', 'theme_category': '仕事・キャリア',
        'sub_theme': 'キャリア設計',
    }))
    out = svc.save_from_chat([{'role': 'user', 'content': 'hello'}])
    assert out['ok'] is True
    assert out['title'] == 'テーマ'
    assert BraindumpSaved in bus.types()


def test_save_falls_back_when_ai_returns_garbage():
    svc, bus, ai = _build()
    ai.responses.append('not-json-at-all')
    out = svc.save_from_chat([{'role': 'user', 'content': 'hello'}])
    # フォールバック動作: title はデフォルト、summary は AI 生応答
    assert out['title'] == '頭の整理メモ'
    assert out['summary'] == 'not-json-at-all'


def test_empty_messages_raises():
    from core.domain.errors import ValidationError
    svc, _, _ = _build()
    with pytest.raises(ValidationError):
        svc.save_from_chat([])
