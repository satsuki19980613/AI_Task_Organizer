"""weekly_reviews テーブル用 Repository。"""
from __future__ import annotations

from infrastructure.persistence.sqlite.connection import open_conn


class SqliteWeeklyReviewRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def list(self, limit: int) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM weekly_reviews ORDER BY completed_at DESC LIMIT ?',
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def save(self, review: dict) -> None:
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO weekly_reviews '
                '(id, completed_at, week_start, week_end, drafts_processed, '
                ' someday_promoted, trash_deleted, waiting_resolved, '
                ' next_actions_completed, notes) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (review['id'], review['completed_at'],
                 review['week_start'], review['week_end'],
                 review.get('drafts_processed', 0),
                 review.get('someday_promoted', 0),
                 review.get('trash_deleted', 0),
                 review.get('waiting_resolved', 0),
                 review.get('next_actions_completed', 0),
                 review.get('notes', '')),
            )
