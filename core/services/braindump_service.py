"""BraindumpService — 思考整理（brain dump）のユースケース。

担当ルート: /api/braindump/*
"""
from __future__ import annotations

import time

from config import DUMP_HISTORY_LIMIT, SUB_THEME_LIMIT
from config.constants import BRAIN_DUMP_THEME_CATEGORIES
from core.domain.errors import ValidationError
from core.events import BraindumpSaved
from core.services.ai_prompts import braindump_summary_prompt
from core.services.ai_extractors import extract_first_json_object


class BraindumpService:
    def __init__(self, braindump_repo, ai_engine, event_bus, clock, model_light: str):
        self._repo = braindump_repo
        self._ai = ai_engine
        self._bus = event_bus
        self._clock = clock
        self._model_light = model_light

    def list_all(self) -> list[dict]:
        return self._repo.list()

    def delete(self, session_id: str) -> None:
        self._repo.delete(session_id)

    def save_from_chat(self, messages: list[dict]) -> dict:
        if not messages:
            raise ValidationError('no messages')

        recent = messages[-DUMP_HISTORY_LIMIT:]
        title = '頭の整理メモ'
        summary = ''
        theme_category = 'その他'
        sub_theme = ''

        try:
            output = self._ai.complete(braindump_summary_prompt(recent), self._model_light)
            parsed = extract_first_json_object(output)
            if parsed:
                title = parsed.get('title', title)
                summary = parsed.get('summary', output)
                cat = parsed.get('theme_category', 'その他')
                theme_category = cat if cat in BRAIN_DUMP_THEME_CATEGORIES else 'その他'
                sub_theme = (parsed.get('sub_theme', '') or '')[:SUB_THEME_LIMIT]
            else:
                summary = output or '要約を生成できませんでした。'
        except Exception:
            summary = '要約を生成できませんでした。'

        session = {
            'id':             str(int(time.time() * 1000)),
            'title':          title,
            'summary':        summary,
            'theme_category': theme_category,
            'sub_theme':      sub_theme,
            'source':         'chat',
            'date':           self._clock.today().isoformat(),
            'raw_messages':   messages,
            'created_at':     self._clock.now().isoformat(timespec='seconds'),
        }
        self._repo.save(session)
        self._bus.publish(BraindumpSaved(session=session))
        return {
            'ok': True,
            'id': session['id'],
            'title': title,
            'summary': summary,
        }
