"""SQLite 行 ↔ ドメイン entity の変換。

repo の中だけで使う。dataclass entity と dict 表現の両方を扱える設計
（移行期間中は dict も来るため）。Step 4 完了後は entity 専用に絞る。
"""
import json
from typing import Any

from core.domain.entities import (
    Task, Project, Category, Habit, DiaryEntry, BraindumpSession, WeeklyReview,
)


# ── Task ────────────────────────────────────────────────
def row_to_task(row) -> dict:
    """tasks テーブル行 → dict（API/UI が期待する形）。"""
    d = dict(row)
    for key in ('roadmap', 'checklist', 'tags'):
        d[key] = json.loads(d.get(key) or '[]')
    d['completed']     = bool(d.get('completed', 0))
    d['is_draft']      = bool(d.get('is_draft', 1))
    d['is_two_minute'] = bool(d.get('is_two_minute', 0))
    for key in ('importance', 'category', 'deadline', 'scheduled_date', 'waiting_for'):
        if d.get(key) == '':
            d[key] = None
    return d


def row_to_archived_task(row) -> dict:
    """archived_tasks テーブル行 → dict。"""
    d = dict(row)
    for key in ('roadmap', 'checklist', 'tags'):
        d[key] = json.loads(d.get(key) or '[]')
    return d


def task_to_params(t: dict | Task) -> tuple:
    """tasks テーブルへの INSERT/UPDATE パラメータ。dict も entity も受ける。"""
    d = _to_dict(t)
    return (
        d['id'], d.get('title', ''),
        d.get('gtd_status', 'inbox'),
        1 if d.get('is_draft', True) else 0,
        d.get('importance') or '',
        d.get('urgency') or 'low',
        d.get('category') or '',
        d.get('category_id'),
        d.get('estimate_minutes'),
        d.get('project_sort_order'),
        json.dumps(d.get('tags', []), ensure_ascii=False),
        json.dumps(d.get('roadmap', []), ensure_ascii=False),
        json.dumps(d.get('checklist', []), ensure_ascii=False),
        d.get('notes', ''),
        d.get('deadline'),
        d.get('scheduled_date'),
        d.get('scheduled_for'),
        d.get('waiting_for'),
        1 if d.get('is_two_minute') else 0,
        1 if d.get('completed') else 0,
        d.get('completed_at'),
        d.get('created_at', ''),
        d.get('project_id'),
        d.get('phase_id'),
    )


TASK_COLUMNS = (
    'id, title, gtd_status, is_draft, importance, urgency, category, '
    'category_id, estimate_minutes, project_sort_order, '
    'tags, roadmap, checklist, notes, '
    'deadline, scheduled_date, scheduled_for, waiting_for, '
    'is_two_minute, completed, completed_at, created_at, '
    'project_id, phase_id'
)
TASK_PLACEHOLDERS = ', '.join(['?'] * 24)


# ── Project ─────────────────────────────────────────────
def row_to_project(row) -> dict:
    d = dict(row)
    for key in ('tags', 'phases', 'next_step_history'):
        d[key] = json.loads(d.get(key) or '[]')
    d['archived'] = bool(d.get('archived', 0))
    for ph in d.get('phases', []):
        ph.setdefault('current_task_id', None)
        ph.setdefault('notes', '')
    return d


def project_to_params(p: dict | Project) -> tuple:
    d = _to_dict(p)
    return (
        d['id'], d.get('title', ''),
        d.get('goal', ''), d.get('category', 'life'),
        d.get('deadline'),
        json.dumps(d.get('tags', []), ensure_ascii=False),
        json.dumps(d.get('phases', []), ensure_ascii=False),
        d.get('current_phase', 0),
        d.get('created_at', ''),
        json.dumps(d.get('next_step_history', []), ensure_ascii=False),
        d.get('status', 'drafting'),
        d.get('completion_condition'),
        d.get('period_start'),
        d.get('period_end'),
        1 if d.get('archived') else 0,
        d.get('completed_at'),
    )


PROJECT_COLUMNS = (
    'id, title, goal, category, deadline, tags, phases, current_phase, '
    'created_at, next_step_history, '
    'status, completion_condition, period_start, period_end, archived, completed_at'
)
PROJECT_PLACEHOLDERS = ', '.join(['?'] * 16)


# ── Category ────────────────────────────────────────────
def row_to_category(row) -> dict:
    d = dict(row)
    d['is_system'] = bool(d.get('is_system', 0))
    return d


# ── Habit ───────────────────────────────────────────────
def row_to_habit(row) -> dict:
    d = dict(row)
    d['tags'] = json.loads(d.get('tags') or '[]')
    d['active'] = bool(d.get('active', 1))
    d['importance'] = 'high'
    d['urgency'] = 'low'
    d['color'] = d.get('color', '')
    return d


# ── Diary ───────────────────────────────────────────────
def row_to_diary(row) -> dict:
    d = dict(row)
    for key in ('actions', 'thoughts', 'body_anchors', 'emotion_anchors'):
        try:
            d[key] = json.loads(d.get(key) or '[]')
        except (json.JSONDecodeError, TypeError):
            d[key] = []
    d['consolidated'] = bool(d.get('consolidated', 0))
    return d


# ── Braindump ───────────────────────────────────────────
def row_to_braindump(row) -> dict:
    d = dict(row)
    try:
        d['raw_messages'] = json.loads(d.get('raw_messages') or '[]')
    except json.JSONDecodeError:
        d['raw_messages'] = []
    return d


# ── helpers ─────────────────────────────────────────────
def _to_dict(obj: Any) -> dict:
    """entity (dataclass) でも dict でも dict に揃える。"""
    if isinstance(obj, dict):
        return obj
    # dataclass
    from dataclasses import asdict, is_dataclass
    if is_dataclass(obj):
        return asdict(obj)
    raise TypeError(f'Unsupported entity type: {type(obj)!r}')
