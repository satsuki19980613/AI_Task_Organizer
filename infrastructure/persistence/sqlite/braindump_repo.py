"""brain_dump_sessions テーブル用 Repository。"""
from __future__ import annotations

import json

from infrastructure.persistence.sqlite.connection import open_conn
from infrastructure.persistence.sqlite.mappers import row_to_braindump
from core.domain.errors import NotFoundError


class SqliteBraindumpRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def get(self, session_id: str) -> dict:
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM brain_dump_sessions WHERE id = ?', (session_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f'braindump {session_id} not found')
        return row_to_braindump(row)

    def list(self) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM brain_dump_sessions ORDER BY created_at DESC'
            ).fetchall()
        return [row_to_braindump(r) for r in rows]

    def save(self, session: dict) -> None:
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO brain_dump_sessions '
                '(id, title, summary, theme_category, sub_theme, source, date, '
                ' raw_messages, created_at) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET '
                'title=excluded.title, summary=excluded.summary, '
                'theme_category=excluded.theme_category, '
                'sub_theme=excluded.sub_theme, source=excluded.source, '
                'date=excluded.date, raw_messages=excluded.raw_messages',
                (session['id'], session.get('title', ''),
                 session.get('summary', ''),
                 session.get('theme_category', 'その他'),
                 session.get('sub_theme', ''),
                 session.get('source', 'chat'),
                 session.get('date', ''),
                 json.dumps(session.get('raw_messages', []), ensure_ascii=False),
                 session.get('created_at', '')),
            )

    def delete(self, session_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM brain_dump_sessions WHERE id = ?', (session_id,))
