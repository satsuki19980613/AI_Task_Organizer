"""HabitService — 習慣のユースケース。

担当ルート: /api/habits/*
"""
from __future__ import annotations

import time
from datetime import date, timedelta

from config.constants import VALID_CATEGORIES, VALID_FREQUENCIES, VALID_WEEKDAYS
from core.domain.errors import NotFoundError, ValidationError
from core.events import HabitLogged


class HabitService:
    def __init__(self, habit_repo, event_bus, clock):
        self._habits = habit_repo
        self._bus = event_bus
        self._clock = clock

    def list_with_today(self) -> list[dict]:
        today = self._clock.today()
        today_str = today.isoformat()
        monday = today - timedelta(days=today.weekday())
        week_dates = [(monday + timedelta(days=i)).isoformat() for i in range(7)]

        habits = self._habits.list(active=True)
        for h in habits:
            today_logs = self._habits.get_logs(h['id'], today, today)
            h['today_done'] = bool(today_logs.get(today_str, False))
            week_logs = self._habits.get_logs(h['id'], monday, monday + timedelta(days=6))
            h['week_done'] = {d: week_logs.get(d, None) for d in week_dates}
            stats = self._habits.calculate_stats(h['id'], today)
            h['current_streak'] = stats['current_streak']
            h['rate_30d'] = stats['rate_30d']
        return habits

    def create(self, data: dict) -> dict:
        title = str(data.get('title', '')).strip()
        if not title:
            raise ValidationError('title is required')
        category = data.get('category', 'life')
        if category not in VALID_CATEGORIES:
            raise ValidationError('invalid category')
        frequency = data.get('frequency', 'daily')
        if frequency not in VALID_FREQUENCIES:
            raise ValidationError('invalid frequency')
        weekday = data.get('weekday')
        if frequency == 'weekly':
            if weekday is None or weekday not in VALID_WEEKDAYS:
                raise ValidationError('weekday (0-6) is required when frequency is weekly')
        else:
            weekday = None

        habit = {
            'id':         'habit_' + str(int(time.time() * 1000)),
            'title':      title,
            'category':   category,
            'tags':       data.get('tags', []),
            'frequency':  frequency,
            'weekday':    weekday,
            'notes':      data.get('notes', ''),
            'created_at': self._clock.now().isoformat(timespec='seconds'),
            'active':     True,
            'color':      data.get('color', ''),
        }
        self._habits.save(habit)
        # API レスポンスは v1 互換フィールドを足して返す
        habit_out = dict(habit)
        habit_out['importance'] = 'high'
        habit_out['urgency'] = 'low'
        habit_out['today_done'] = False
        habit_out['current_streak'] = 0
        return habit_out

    def update(self, habit_id: str, data: dict) -> dict:
        habit = self._habits.get(habit_id)
        if 'title' in data:
            habit['title'] = data['title'].strip()
        if 'category' in data:
            if data['category'] not in VALID_CATEGORIES:
                raise ValidationError('invalid category')
            habit['category'] = data['category']
        if 'frequency' in data:
            if data['frequency'] not in VALID_FREQUENCIES:
                raise ValidationError('invalid frequency')
            habit['frequency'] = data['frequency']
        if 'weekday' in data:
            habit['weekday'] = data['weekday']
        if 'notes' in data:
            habit['notes'] = data['notes']
        if 'tags' in data:
            habit['tags'] = data['tags']
        if 'active' in data:
            habit['active'] = bool(data['active'])
        if 'color' in data:
            habit['color'] = data['color']

        if habit['frequency'] == 'weekly':
            if habit.get('weekday') is None or habit['weekday'] not in VALID_WEEKDAYS:
                raise ValidationError('weekday (0-6) is required when frequency is weekly')
        else:
            habit['weekday'] = None

        self._habits.save(habit)
        return habit

    def delete(self, habit_id: str) -> None:
        self._habits.get(habit_id)  # NotFound 時に例外
        self._habits.delete(habit_id)

    def log(self, habit_id: str, date_str: str, done: bool) -> None:
        self._habits.get(habit_id)  # NotFound 確認
        if not date_str:
            raise ValidationError('date is required')
        try:
            day = date.fromisoformat(date_str)
        except ValueError:
            raise ValidationError('invalid date format')
        self._habits.log_completion(habit_id, day, done)
        self._bus.publish(HabitLogged(habit_id=habit_id, date=date_str, done=done))

    def get_logs(self, habit_id: str, days: int) -> list[dict]:
        self._habits.get(habit_id)
        end = self._clock.today()
        start = end - timedelta(days=days)
        logs = self._habits.get_logs(habit_id, start, end)
        sorted_dates = sorted(logs.keys(), reverse=True)
        return [{'date': d, 'done': logs[d]} for d in sorted_dates]

    def get_stats(self, habit_id: str) -> dict:
        self._habits.get(habit_id)
        return self._habits.calculate_stats(habit_id, self._clock.today())
