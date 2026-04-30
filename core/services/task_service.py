"""TaskService — タスクに関するすべてのユースケース。

担当ルート: /api/tasks/*, /api/today, /api/tomorrow, /api/drafts,
/api/archive/*, /api/review/*

依存（ports のみ。具体実装は container で注入）:
- TaskRepository
- HabitRepository (today/tomorrow パネル用)
- CategoryRepository (today/tomorrow グルーピング用)
- WeeklyReviewRepository
- StateRepository (rollover/cleanup の冪等性管理)
- EventBus
- Clock
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

from config import DRAFT_RETENTION_DAYS, SIMILAR_TASKS_LIMIT
from config.constants import VALID_GTD_STATUS
from core.domain.errors import NotFoundError, ValidationError
from core.domain.gtd import (
    apply_gtd_defaults, check_is_draft, validate_move, apply_move,
    compute_today_summary,
)
from core.events import (
    TaskCreated, TaskUpdated, TaskMoved, TaskScheduled, TaskCompleted,
    TaskArchived, TaskDeleted,
)


_DEPRECATED_TASK_FIELDS = ('importance', 'urgency', 'is_two_minute', 'category')


def _strip_deprecated(data: dict) -> dict:
    return {k: v for k, v in data.items() if k not in _DEPRECATED_TASK_FIELDS}


class TaskService:
    def __init__(
        self,
        task_repo,
        habit_repo,
        category_repo,
        weekly_review_repo,
        state_repo,
        daily_log_repo,
        event_bus,
        clock,
    ):
        self._tasks = task_repo
        self._habits = habit_repo
        self._categories = category_repo
        self._reviews = weekly_review_repo
        self._state = state_repo
        self._daily_log = daily_log_repo
        self._bus = event_bus
        self._clock = clock

    # ── CRUD ─────────────────────────────────────────
    def list_all(self) -> list[dict]:
        self._rollover_if_needed()
        return self._tasks.list()

    def create(self, data: dict) -> dict:
        task = _strip_deprecated(data)
        task['id'] = str(time.time_ns() // 1_000)  # マイクロ秒精度で衝突回避
        task['created_at'] = self._clock.now().isoformat(timespec='seconds')
        apply_gtd_defaults(task)
        task['is_draft'] = check_is_draft(task)
        self._tasks.save(task)
        self._bus.publish(TaskCreated(task=task))
        return task

    def update(self, task_id: str, data: dict) -> dict:
        data = _strip_deprecated(data)
        if 'gtd_status' in data and data['gtd_status'] not in VALID_GTD_STATUS:
            raise ValidationError(f'invalid gtd_status: {data["gtd_status"]}')
        existing = self._tasks.get(task_id)
        existing.update(data)
        existing['is_draft'] = check_is_draft(existing)
        if existing.get('completed') and not existing.get('completed_at'):
            existing['completed_at'] = self._clock.now().isoformat(timespec='seconds')
            if existing.get('gtd_status') != 'done':
                existing['gtd_status'] = 'done'
        self._tasks.save(existing)
        self._bus.publish(TaskUpdated(task=existing, changes=data))
        if existing.get('completed'):
            self._bus.publish(TaskCompleted(task=existing))
        return existing

    def delete(self, task_id: str) -> None:
        self._tasks.delete(task_id)
        self._bus.publish(TaskDeleted(task_id=task_id))

    # ── GTD operations ────────────────────────────────
    def collect(self, titles: list[str]) -> list[dict]:
        cleaned = [str(t).strip() for t in titles if str(t).strip()]
        if not cleaned:
            raise ValidationError('no valid titles')
        created: list[dict] = []
        base_us = time.time_ns() // 1_000
        now_iso = self._clock.now().isoformat(timespec='seconds')
        for idx, title in enumerate(cleaned):
            t = {
                'id':         str(base_us + idx),
                'title':      title,
                'gtd_status': 'inbox',
                'is_draft':   True,
                'created_at': now_iso,
            }
            apply_gtd_defaults(t)
            t['is_draft'] = True
            self._tasks.save(t)
            created.append(t)
            self._bus.publish(TaskCreated(task=t))
        return created

    def move(self, task_id: str, target_status: str, force_params: dict) -> dict:
        """gtd_status 変更。verdict.ok == False は呼び出し側で 200 で返す想定。"""
        if target_status not in VALID_GTD_STATUS:
            raise ValidationError(f'invalid target_status: {target_status}')
        t = self._tasks.get(task_id)
        verdict = validate_move(t, target_status, force_params)
        if not verdict.get('ok'):
            verdict['ok'] = False
            return verdict
        from_status = t.get('gtd_status', 'inbox')
        apply_move(t, target_status, force_params)
        self._tasks.save(t)
        self._bus.publish(TaskMoved(task=t, from_status=from_status, to_status=target_status))
        if target_status == 'done':
            self._bus.publish(TaskCompleted(task=t))
        return {'ok': True, 'task': t}

    def schedule(self, task_id: str, scheduled_for: Any) -> dict:
        if scheduled_for not in (None, 'today', 'tomorrow'):
            raise ValidationError('scheduled_for must be today/tomorrow/null')
        t = self._tasks.get(task_id)
        t['scheduled_for'] = scheduled_for
        self._tasks.save(t)
        self._bus.publish(TaskScheduled(
            task=t, scheduled_date=t.get('scheduled_date'), scheduled_for=scheduled_for,
        ))
        return t

    # ── Drafts / Today / Tomorrow ─────────────────────
    def list_drafts(self) -> list[dict]:
        self._cleanup_old_drafts_if_needed()
        drafts = [t for t in self._tasks.list() if t.get('is_draft')]
        drafts.sort(key=lambda t: t.get('created_at', ''), reverse=True)
        return drafts

    def get_today_panel(self) -> dict:
        self._rollover_if_needed()
        today = self._clock.today()
        return self._panel_for_date(today)

    def get_tomorrow_panel(self) -> dict:
        self._rollover_if_needed()
        return self._panel_for_date(self._clock.today() + timedelta(days=1))

    def _panel_for_date(self, target: date) -> dict:
        target_str = target.isoformat()
        sf_key = 'today' if target == self._clock.today() else 'tomorrow'
        tasks = [
            t for t in self._tasks.list()
            if not t.get('is_draft') and not t.get('completed') and (
                t.get('scheduled_for') == sf_key or
                t.get('scheduled_date') == target_str
            )
        ]
        # 当日中は完了済みタスクも斜線表示で残す。今日パネルのみ。
        completed_today: list[dict] = []
        if target == self._clock.today():
            completed_today = self._tasks.list_archived_on(target_str)
        habits = self._habits_for_date(target)
        categories = self._categories.list()
        summary = compute_today_summary(tasks, habits, categories)
        return {
            'tasks':           tasks,
            'completed_today': completed_today,
            'habits':          habits,
            'date':            target_str,
            'groups':          summary['groups'],
            'total_minutes':   summary['total_minutes'],
        }

    def _habits_for_date(self, target: date) -> list[dict]:
        target_weekday = target.weekday()
        target_str = target.isoformat()
        habits = []
        for h in self._habits.list(active=True):
            freq = h.get('frequency')
            if freq == 'weekly':
                if h.get('weekday') is None or h.get('weekday') != target_weekday:
                    continue
            elif freq != 'daily':
                continue
            logs = self._habits.get_logs(h['id'], target, target)
            h['done'] = bool(logs.get(target_str, False))
            habits.append(h)
        return habits

    # ── Similar / Archive ─────────────────────────────
    def find_similar(self, task_id: str) -> list[dict]:
        t = self._tasks.get(task_id)
        category = t.get('category', '')
        task_tags = set(t.get('tags', []))
        task_words = set(t.get('title', '').split())

        results = []
        for a in self._tasks.list_archived():
            score = 0
            if a.get('category') == category:
                score += 3
            score += len(task_tags & set(a.get('tags', []))) * 2
            score += len(task_words & set(a.get('title', '').split()))
            if score > 0:
                results.append((score, a))
        results.sort(key=lambda x: x[0], reverse=True)
        return [a for _, a in results[:SIMILAR_TASKS_LIMIT]]

    def archive(self, task_id: str) -> dict:
        # 日次ログ用に、削除前のタスク情報（特に category_id）を保持
        pre = self._tasks.get(task_id)  # NotFoundError → caller へ伝播
        archived = self._tasks.archive(task_id)
        if pre.get('completed'):
            self._daily_log.add(
                date_str=self._clock.today().isoformat(),
                task_id=archived['id'],
                title=archived.get('title', ''),
                status='completed',
                category_id=pre.get('category_id'),
            )
        self._bus.publish(TaskArchived(task=archived))
        return archived

    def list_archived(self, query: str = '', category: str = '', sort: str = 'newest') -> list[dict]:
        return self._tasks.search_archived(query=query, category=category, sort=sort)

    def delete_archived(self, archived_id: str) -> None:
        self._tasks.delete_archived(archived_id)

    # ── Daily log（カレンダーモーダル用） ────────────────
    def get_daily_log(self, date_str: str) -> dict:
        entries = self._daily_log.list_by_date(date_str)
        completed  = [e for e in entries if e.get('status') == 'completed']
        unfinished = [e for e in entries if e.get('status') == 'unfinished']
        return {
            'date':       date_str,
            'completed':  completed,
            'unfinished': unfinished,
        }

    def restore_from_archive(self, archived_id: str) -> dict:
        a = self._tasks.restore(archived_id)
        restored = {
            'id':         a['id'],
            'title':      a['title'],
            'importance': a.get('importance', 'high'),
            'urgency':    a.get('urgency', 'low'),
            'category':   a.get('category', 'life'),
            'tags':       a.get('tags', []),
            'roadmap':    a.get('roadmap', []),
            'checklist':  a.get('checklist', []),
            'notes':      a.get('notes', ''),
            'completed':  False,
            'deadline':   a.get('deadline'),
        }
        apply_gtd_defaults(restored)
        restored['is_draft'] = check_is_draft(restored)
        self._tasks.save(restored)
        self._bus.publish(TaskCreated(task=restored))
        return restored

    # ── Rollover / Cleanup ────────────────────────────
    def _rollover_if_needed(self, force: bool = False) -> int:
        now = self._clock.now()
        if now.hour < 6 and not force:
            return 0
        state = self._state.load()
        today_str = self._clock.today().isoformat()
        if not force and state.get('last_rollover_date') == today_str:
            return 0

        # 「昨日」として扱う日付。前回 rollover した日（state.last_rollover_date）が
        # あればそれを採用、なければ今日の前日をフォールバック。
        previous_day = state.get('last_rollover_date') or (
            (self._clock.today() - timedelta(days=1)).isoformat()
        )

        changed = 0
        all_tasks = self._tasks.list()
        for t in all_tasks:
            sf = t.get('scheduled_for')
            if sf == 'today':
                if not t.get('completed'):
                    # 未完了として日次ログに記録
                    self._daily_log.add(
                        date_str=previous_day,
                        task_id=t['id'],
                        title=t.get('title', ''),
                        status='unfinished',
                        category_id=t.get('category_id'),
                    )
                    # 元のリストに関わらず一律 next_action に戻す。
                    # scheduled_date は保持してユーザー裁量で調整可能にする。
                    t['gtd_status'] = 'next_action'
                t['scheduled_for'] = None
                self._tasks.save(t)
                changed += 1
            elif sf == 'tomorrow':
                t['scheduled_for'] = 'today'
                self._tasks.save(t)
                changed += 1

        state['last_rollover_date'] = today_str
        self._state.save(state)
        return changed

    def manual_rollover(self, timing: str) -> dict:
        moved = self._rollover_if_needed(force=True)
        state = self._state.load()
        now_iso = self._clock.now().isoformat(timespec='seconds')
        state['last_manual_rollover'] = now_iso
        state['last_rollover_date'] = self._clock.today().isoformat()
        self._state.save(state)
        return {'ok': True, 'timing': timing, 'moved': moved, 'at': now_iso}

    def _cleanup_old_drafts_if_needed(self) -> None:
        state = self._state.load()
        today_str = self._clock.today().isoformat()
        if state.get('last_draft_cleanup') == today_str:
            return
        threshold = (self._clock.today() - timedelta(days=DRAFT_RETENTION_DAYS)).isoformat()
        for t in self._tasks.list():
            if t.get('is_draft') and (t.get('created_at') or '')[:10] < threshold:
                self._tasks.delete(t['id'])
                self._bus.publish(TaskDeleted(task_id=t['id']))
        state['last_draft_cleanup'] = today_str
        self._state.save(state)

    # ── Weekly Review ─────────────────────────────────
    def review_summary(self) -> dict:
        today = self._clock.today()
        week_start = today - timedelta(days=today.weekday())
        week_end   = week_start + timedelta(days=6)
        nw_start   = week_end + timedelta(days=1)
        nw_end     = nw_start + timedelta(days=6)
        ws, we = week_start.isoformat(), week_end.isoformat()
        nws, nwe = nw_start.isoformat(), nw_end.isoformat()
        tasks = self._tasks.list()

        return {
            'drafts': sum(1 for t in tasks if t.get('is_draft')),
            'next_actions': sum(
                1 for t in tasks
                if t.get('gtd_status') == 'next_action'
                and not t.get('is_draft') and not t.get('completed')
            ),
            'waiting': sum(1 for t in tasks if t.get('gtd_status') == 'waiting' and not t.get('is_draft')),
            'someday': sum(1 for t in tasks if t.get('gtd_status') == 'someday'),
            'trash':   sum(1 for t in tasks if t.get('gtd_status') == 'trash'),
            'next_week_calendar': sum(
                1 for t in tasks
                if t.get('gtd_status') == 'calendar'
                and nws <= (t.get('scheduled_date') or '') <= nwe
            ),
            'this_week_done': sum(
                1 for t in tasks
                if t.get('gtd_status') == 'done'
                and ws <= (t.get('completed_at') or '')[:10] <= we
            ),
            'week_start': ws,
            'week_end':   we,
        }

    def review_complete(self, data: dict) -> dict:
        today = self._clock.today()
        week_start = today - timedelta(days=today.weekday())
        week_end   = week_start + timedelta(days=6)
        review = {
            'id':           'review_' + str(int(time.time() * 1000)),
            'completed_at': self._clock.now().isoformat(timespec='seconds'),
            'week_start':   week_start.isoformat(),
            'week_end':     week_end.isoformat(),
            'drafts_processed':       int(data.get('drafts_processed', 0) or 0),
            'someday_promoted':       int(data.get('someday_promoted', 0) or 0),
            'trash_deleted':          int(data.get('trash_deleted', 0) or 0),
            'waiting_resolved':       int(data.get('waiting_resolved', 0) or 0),
            'next_actions_completed': int(data.get('next_actions_completed', 0) or 0),
            'notes':                  str(data.get('notes', '')),
        }
        self._reviews.save(review)
        return {
            'ok': True,
            'id': review['id'],
            'completed_at': review['completed_at'],
            'week_start':   review['week_start'],
            'week_end':     review['week_end'],
        }
