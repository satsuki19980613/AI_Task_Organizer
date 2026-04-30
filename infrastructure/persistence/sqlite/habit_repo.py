"""habits / habit_logs テーブル用 Repository。"""
from __future__ import annotations

import json
from datetime import date, timedelta

from infrastructure.persistence.sqlite.connection import open_conn
from infrastructure.persistence.sqlite.mappers import row_to_habit
from core.domain.errors import NotFoundError


class SqliteHabitRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    # ── habits CRUD ──────────────────────────────────
    def get(self, habit_id: str) -> dict:
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM habits WHERE id = ?', (habit_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f'habit {habit_id} not found')
        return row_to_habit(row)

    def list(self, **filters) -> list[dict]:
        sql = 'SELECT * FROM habits'
        params: list = []
        if 'active' in filters:
            sql += ' WHERE active = ?'
            params.append(1 if filters['active'] else 0)
        sql += ' ORDER BY created_at'
        with open_conn(self._db) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [row_to_habit(r) for r in rows]

    def save(self, habit: dict) -> None:
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO habits '
                '(id, title, category, tags, frequency, weekday, notes, color, '
                ' created_at, active) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET '
                'title=excluded.title, category=excluded.category, '
                'tags=excluded.tags, frequency=excluded.frequency, '
                'weekday=excluded.weekday, notes=excluded.notes, '
                'color=excluded.color, active=excluded.active',
                (habit['id'], habit.get('title', ''),
                 habit.get('category', 'life'),
                 json.dumps(habit.get('tags', []), ensure_ascii=False),
                 habit.get('frequency', 'daily'),
                 habit.get('weekday'),
                 habit.get('notes', ''),
                 habit.get('color', ''),
                 habit.get('created_at', ''),
                 1 if habit.get('active', True) else 0),
            )

    def delete(self, habit_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM habit_logs WHERE habit_id = ?', (habit_id,))
            conn.execute('DELETE FROM habits WHERE id = ?', (habit_id,))

    # ── habit_logs ───────────────────────────────────
    def log_completion(self, habit_id: str, day: date, done: bool) -> None:
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO habit_logs (habit_id, date, done) VALUES (?, ?, ?) '
                'ON CONFLICT(habit_id, date) DO UPDATE SET done=excluded.done',
                (habit_id, day.isoformat(), 1 if done else 0),
            )

    def get_logs(self, habit_id: str, start: date, end: date) -> dict[str, bool]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT date, done FROM habit_logs '
                'WHERE habit_id = ? AND date BETWEEN ? AND ? ORDER BY date',
                (habit_id, start.isoformat(), end.isoformat()),
            ).fetchall()
        return {r['date']: bool(r['done']) for r in rows}

    def calculate_stats(self, habit_id: str, today: date) -> dict:
        """継続率・ストリーク計算。db.py の calculate_habit_stats を移植。"""
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT date, done FROM habit_logs WHERE habit_id = ? ORDER BY date',
                (habit_id,)
            ).fetchall()
        logs_by_date = {r['date']: bool(r['done']) for r in rows}

        def rate(days: int) -> float:
            done = sum(
                1 for i in range(days)
                if logs_by_date.get((today - timedelta(days=i)).isoformat())
            )
            return round(done / days, 3)

        d = today
        if today.isoformat() not in logs_by_date:
            d = today - timedelta(days=1)

        current_streak = 0
        while logs_by_date.get(d.isoformat()):
            current_streak += 1
            d -= timedelta(days=1)

        done_dates = sorted(k for k, v in logs_by_date.items() if v)
        best_streak = 0
        if done_dates:
            run = 1
            for i in range(1, len(done_dates)):
                prev = date.fromisoformat(done_dates[i - 1])
                curr = date.fromisoformat(done_dates[i])
                if (curr - prev).days == 1:
                    run += 1
                else:
                    best_streak = max(best_streak, run)
                    run = 1
            best_streak = max(best_streak, run)

        return {
            'rate_7d':        rate(7),
            'rate_30d':       rate(30),
            'rate_90d':       rate(90),
            'current_streak': current_streak,
            'best_streak':    best_streak,
            'total_done':     sum(1 for v in logs_by_date.values() if v),
        }
