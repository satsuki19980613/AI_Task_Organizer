"""diary_entries テーブル用 Repository。"""
from __future__ import annotations

import json
from datetime import date

from infrastructure.persistence.sqlite.connection import open_conn
from infrastructure.persistence.sqlite.mappers import row_to_diary
from core.domain.errors import NotFoundError


class SqliteDiaryRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def get(self, entry_id: str) -> dict:
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM diary_entries WHERE id = ?', (entry_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f'diary entry {entry_id} not found')
        return row_to_diary(row)

    def list(self, start: date, end: date) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM diary_entries WHERE date BETWEEN ? AND ? '
                'ORDER BY date ASC, created_at ASC',
                (start.isoformat(), end.isoformat()),
            ).fetchall()
        return [row_to_diary(r) for r in rows]

    def save(self, entry: dict) -> None:
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO diary_entries '
                '(id, date, body_score, body_text, emotion_score, emotion_text, '
                ' actions, thoughts, consolidated, created_at, '
                ' body_anchors, emotion_anchors) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET '
                'date=excluded.date, body_score=excluded.body_score, '
                'body_text=excluded.body_text, emotion_score=excluded.emotion_score, '
                'emotion_text=excluded.emotion_text, actions=excluded.actions, '
                'thoughts=excluded.thoughts, consolidated=excluded.consolidated, '
                'body_anchors=excluded.body_anchors, '
                'emotion_anchors=excluded.emotion_anchors',
                (entry['id'], entry.get('date', ''),
                 entry.get('body_score', 0),
                 entry.get('body_text', ''),
                 entry.get('emotion_score', 0),
                 entry.get('emotion_text', ''),
                 json.dumps(entry.get('actions', []), ensure_ascii=False),
                 json.dumps(entry.get('thoughts', []), ensure_ascii=False),
                 1 if entry.get('consolidated') else 0,
                 entry.get('created_at', ''),
                 json.dumps(entry.get('body_anchors', []), ensure_ascii=False),
                 json.dumps(entry.get('emotion_anchors', []), ensure_ascii=False)),
            )

    def delete(self, entry_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM diary_entries WHERE id = ?', (entry_id,))

    def list_unconsolidated(self, limit: int) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM diary_entries WHERE consolidated = 0 '
                'ORDER BY date ASC, created_at ASC LIMIT ?',
                (limit,),
            ).fetchall()
        return [row_to_diary(r) for r in rows]

    def mark_consolidated(self, entry_ids: list[str]) -> None:
        if not entry_ids:
            return
        with open_conn(self._db) as conn:
            conn.executemany(
                'UPDATE diary_entries SET consolidated = 1 WHERE id = ?',
                [(eid,) for eid in entry_ids],
            )
