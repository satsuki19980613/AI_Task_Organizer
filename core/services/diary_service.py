"""DiaryService — 日記（BEAT）のユースケース。

担当ルート: /api/diary/*
"""
from __future__ import annotations

import time
from datetime import date

from config import DIARY_CONSOLIDATE_LIMIT, SUB_THEME_LIMIT
from config.constants import (
    BRAIN_DUMP_THEME_CATEGORIES, DIARY_SCORE_MIN, DIARY_SCORE_MAX,
)
from core.domain.errors import NotFoundError, ValidationError
from core.events import DiaryEntryCreated, DiaryConsolidated, BraindumpSaved


def _clamp_score(v) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    if n < DIARY_SCORE_MIN:
        return DIARY_SCORE_MIN
    if n > DIARY_SCORE_MAX:
        return DIARY_SCORE_MAX
    return n


def _sanitize_actions(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for a in raw:
        if not isinstance(a, dict):
            continue
        text = str(a.get('text', '')).strip()
        emotion = str(a.get('emotion', '')).strip()
        if not text and not emotion:
            continue
        out.append({'text': text, 'emotion': emotion})
    return out


def _sanitize_anchors(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for a in raw:
        if not isinstance(a, dict):
            continue
        try:
            t = int(a.get('t', 0))
            v = int(a.get('v', 0))
        except (TypeError, ValueError):
            continue
        if t < 0:
            t = 0
        elif t > 1440:
            t = 1440
        if v < DIARY_SCORE_MIN:
            v = DIARY_SCORE_MIN
        elif v > DIARY_SCORE_MAX:
            v = DIARY_SCORE_MAX
        out.append({'t': t, 'v': v})
    out.sort(key=lambda x: x['t'])
    return out


def _avg_score(anchors: list[dict]) -> int:
    if not anchors:
        return 0
    s = sum(a['v'] for a in anchors)
    return int(round(s / len(anchors)))


def _sanitize_thoughts(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for t in raw:
        if not isinstance(t, dict):
            continue
        topic = str(t.get('topic', '')).strip()
        content = str(t.get('content', '')).strip()
        if not topic and not content:
            continue
        out.append({'topic': topic, 'content': content})
    return out


class DiaryService:
    def __init__(self, diary_repo, braindump_repo, ai_engine, event_bus, clock, model_light: str):
        self._diary = diary_repo
        self._braindumps = braindump_repo
        self._ai = ai_engine
        self._bus = event_bus
        self._clock = clock
        self._model_light = model_light

    def list_range(self, date_from: str, date_to: str) -> list[dict]:
        # date_from / date_to は ISO 文字列。空文字なら開放範囲。
        all_entries = self._diary.list_unconsolidated(10**6) if False else None
        # 簡略化: from/to が空でも全件返す。frontend は数日のスパンで指定する想定。
        if not date_from and not date_to:
            return self._all_entries_desc()
        start = date.fromisoformat(date_from) if date_from else date.min
        end = date.fromisoformat(date_to) if date_to else date.max
        rows = self._diary.list(start, end)
        rows.sort(key=lambda r: (r.get('date') or '', r.get('created_at') or ''), reverse=True)
        return rows

    def _all_entries_desc(self) -> list[dict]:
        # consolidated/unconsolidated 全件 + 降順ソート
        rows = self._diary.list(date.min, date.max)
        rows.sort(key=lambda r: (r.get('date') or '', r.get('created_at') or ''), reverse=True)
        return rows

    def create(self, data: dict) -> dict:
        body_anchors = _sanitize_anchors(data.get('body_anchors', []))
        emotion_anchors = _sanitize_anchors(data.get('emotion_anchors', []))
        body_score = (
            _clamp_score(data['body_score']) if 'body_score' in data
            else _avg_score(body_anchors)
        )
        emotion_score = (
            _clamp_score(data['emotion_score']) if 'emotion_score' in data
            else _avg_score(emotion_anchors)
        )
        entry = {
            'id':              str(int(time.time() * 1000)),
            'date':            data.get('date') or self._clock.today().isoformat(),
            'body_score':      body_score,
            'body_text':       str(data.get('body_text', '')).strip(),
            'emotion_score':   emotion_score,
            'emotion_text':    str(data.get('emotion_text', '')).strip(),
            'body_anchors':    body_anchors,
            'emotion_anchors': emotion_anchors,
            'actions':         _sanitize_actions(data.get('actions', [])),
            'thoughts':        _sanitize_thoughts(data.get('thoughts', [])),
            'consolidated':    False,
            'created_at':      self._clock.now().isoformat(timespec='seconds'),
        }
        self._diary.save(entry)
        self._bus.publish(DiaryEntryCreated(entry=entry))
        return entry

    def update(self, entry_id: str, data: dict) -> dict:
        entry = self._diary.get(entry_id)
        if 'date' in data:
            entry['date'] = data['date']
        if 'body_score' in data:
            entry['body_score'] = _clamp_score(data['body_score'])
        if 'body_text' in data:
            entry['body_text'] = str(data['body_text']).strip()
        if 'emotion_score' in data:
            entry['emotion_score'] = _clamp_score(data['emotion_score'])
        if 'emotion_text' in data:
            entry['emotion_text'] = str(data['emotion_text']).strip()
        if 'body_anchors' in data:
            entry['body_anchors'] = _sanitize_anchors(data['body_anchors'])
            if 'body_score' not in data:
                entry['body_score'] = _avg_score(entry['body_anchors'])
        if 'emotion_anchors' in data:
            entry['emotion_anchors'] = _sanitize_anchors(data['emotion_anchors'])
            if 'emotion_score' not in data:
                entry['emotion_score'] = _avg_score(entry['emotion_anchors'])
        if 'actions' in data:
            entry['actions'] = _sanitize_actions(data['actions'])
        if 'thoughts' in data:
            entry['thoughts'] = _sanitize_thoughts(data['thoughts'])
        self._diary.save(entry)
        return entry

    def delete(self, entry_id: str) -> None:
        self._diary.delete(entry_id)

    def consolidate(self) -> dict:
        from core.services.ai_prompts import diary_consolidate_prompt
        from core.services.ai_extractors import extract_first_json_object

        entries = self._diary.list_unconsolidated(DIARY_CONSOLIDATE_LIMIT)
        thought_lines: list[str] = []
        for e in entries:
            for t in e.get('thoughts', []):
                topic = t.get('topic', '')
                content = t.get('content', '')
                if not topic and not content:
                    continue
                thought_lines.append(f"- [{e['date']}] {topic}: {content}")
        if not thought_lines:
            raise ValidationError('no thoughts to consolidate')

        title = '日記からの思考整理'
        summary = '\n'.join(thought_lines)
        theme_category = '感情・メンタル'
        sub_theme = ''
        try:
            output = self._ai.complete(diary_consolidate_prompt(thought_lines), self._model_light)
            parsed = extract_first_json_object(output)
            if parsed:
                title = parsed.get('title', title)
                summary = parsed.get('summary', summary)
                cat = parsed.get('theme_category', '感情・メンタル')
                theme_category = cat if cat in BRAIN_DUMP_THEME_CATEGORIES else '感情・メンタル'
                sub_theme = (parsed.get('sub_theme', '') or '')[:SUB_THEME_LIMIT]
        except Exception:
            pass  # AIEngineError 含むフォールバック

        session_id = 'diary_' + str(int(time.time() * 1000))
        session = {
            'id':             session_id,
            'title':          title,
            'summary':        summary,
            'theme_category': theme_category,
            'sub_theme':      sub_theme,
            'source':         'diary',
            'date':           self._clock.today().isoformat(),
            'raw_messages':   [{'role': 'user', 'content': '\n'.join(thought_lines)}],
            'created_at':     self._clock.now().isoformat(timespec='seconds'),
        }
        self._braindumps.save(session)
        self._diary.mark_consolidated([e['id'] for e in entries])
        self._bus.publish(BraindumpSaved(session=session))
        self._bus.publish(DiaryConsolidated(
            entry_ids=[e['id'] for e in entries], session=session,
        ))

        return {
            'ok': True,
            'id': session_id,
            'title': title,
            'summary': summary,
            'theme_category': theme_category,
            'sub_theme': sub_theme,
            'consolidated_count': len(entries),
        }
