"""daily_task_log テーブル用 Repository。

「今日明日のタスク」の完了/未完了を日付別に追跡する。完了タスクが
archived_tasks に移った後でも、日次の振り返り（カレンダーモーダル）で
表示できるよう、title と category_id を冗長保存する。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from infrastructure.persistence.sqlite.connection import open_conn


class SqliteDailyLogRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def add(self, *, date_str: str, task_id: str, title: str,
            status: str, category_id: str | None) -> None:
        recorded_at = datetime.now().isoformat(timespec='seconds')
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO daily_task_log '
                '(date, task_id, title, status, category_id, recorded_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (date_str, task_id, title, status, category_id, recorded_at),
            )

    def list_by_date(self, date_str: str) -> list[dict[str, Any]]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT id, date, task_id, title, status, category_id, recorded_at '
                'FROM daily_task_log WHERE date = ? ORDER BY recorded_at',
                (date_str,),
            ).fetchall()
        return [dict(r) for r in rows]
