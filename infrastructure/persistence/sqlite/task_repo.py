"""tasks / archived_tasks テーブル用 Repository。

dict ベースの戻り値で TaskRepository Protocol を満たす（Protocol は
structural typing なので dict でも実行時は問題なし）。Step 4 で entity 化を
検討する。
"""
from __future__ import annotations

import json
import time

from infrastructure.persistence.sqlite.connection import open_conn
from infrastructure.persistence.sqlite.mappers import (
    row_to_task, row_to_archived_task,
    task_to_params, TASK_COLUMNS, TASK_PLACEHOLDERS,
)
from core.domain.errors import NotFoundError


class SqliteTaskRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def get(self, task_id: str) -> dict:
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM tasks WHERE id = ?', (task_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f'task {task_id} not found')
        return row_to_task(row)

    def list(self, **filters) -> list[dict]:
        sql = 'SELECT * FROM tasks'
        params: list = []
        clauses: list[str] = []
        if 'project_id' in filters:
            clauses.append('project_id = ?')
            params.append(filters['project_id'])
        if 'gtd_status' in filters:
            clauses.append('gtd_status = ?')
            params.append(filters['gtd_status'])
        if clauses:
            sql += ' WHERE ' + ' AND '.join(clauses)
        sql += ' ORDER BY created_at'
        with open_conn(self._db) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [row_to_task(r) for r in rows]

    def save(self, task: dict) -> None:
        sql = (
            'INSERT INTO tasks '
            f'({TASK_COLUMNS}) VALUES ({TASK_PLACEHOLDERS}) '
            'ON CONFLICT(id) DO UPDATE SET '
            'title=excluded.title, gtd_status=excluded.gtd_status, '
            'is_draft=excluded.is_draft, importance=excluded.importance, '
            'urgency=excluded.urgency, category=excluded.category, '
            'category_id=excluded.category_id, '
            'estimate_minutes=excluded.estimate_minutes, '
            'project_sort_order=excluded.project_sort_order, '
            'tags=excluded.tags, roadmap=excluded.roadmap, '
            'checklist=excluded.checklist, notes=excluded.notes, '
            'deadline=excluded.deadline, scheduled_date=excluded.scheduled_date, '
            'scheduled_for=excluded.scheduled_for, waiting_for=excluded.waiting_for, '
            'is_two_minute=excluded.is_two_minute, completed=excluded.completed, '
            'completed_at=excluded.completed_at, project_id=excluded.project_id, '
            'phase_id=excluded.phase_id'
        )
        with open_conn(self._db) as conn:
            conn.execute(sql, task_to_params(task))

    def save_all(self, tasks: list[dict]) -> None:
        """全置換（DELETE + INSERT）。storage.save_tasks 互換。"""
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM tasks')
            for t in tasks:
                conn.execute(
                    f'INSERT INTO tasks ({TASK_COLUMNS}) VALUES ({TASK_PLACEHOLDERS})',
                    task_to_params(t),
                )

    def delete(self, task_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM tasks WHERE id = ?', (task_id,))

    def list_drafts(self) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM tasks WHERE is_draft = 1 ORDER BY created_at'
            ).fetchall()
        return [row_to_task(r) for r in rows]

    def list_by_project(self, project_id: str) -> list[dict]:
        return self.list(project_id=project_id)

    def find_similar(self, title: str, limit: int) -> list[dict]:
        """archived_tasks を返す。スコアリングは services 側で行う。"""
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM archived_tasks ORDER BY archived_at DESC'
            ).fetchall()
        return [row_to_archived_task(r) for r in rows]

    def archive(self, task_id: str) -> dict:
        """tasks → archived_tasks。冪等ではない（重複ID は OperationalError）。"""
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM tasks WHERE id = ?', (task_id,)
            ).fetchone()
            if not row:
                raise NotFoundError(f'task {task_id} not found')
            t = row_to_task(row)
            archived_at = time.strftime('%Y-%m-%dT%H:%M:%S')
            conn.execute(
                'INSERT INTO archived_tasks '
                '(id, title, importance, urgency, category, tags, roadmap, '
                ' checklist, notes, archived_at, deadline) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (t['id'], t.get('title', ''),
                 t.get('importance') or 'high',
                 t.get('urgency') or 'low',
                 t.get('category') or 'life',
                 json.dumps(t.get('tags', []), ensure_ascii=False),
                 json.dumps(t.get('roadmap', []), ensure_ascii=False),
                 json.dumps(t.get('checklist', []), ensure_ascii=False),
                 t.get('notes', ''),
                 archived_at,
                 t.get('deadline'))
            )
            conn.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        t['archived_at'] = archived_at
        return t

    def restore(self, archived_id: str) -> dict:
        """archived_tasks → tasks。元 ID をそのまま戻す。"""
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM archived_tasks WHERE id = ?', (archived_id,)
            ).fetchone()
            if not row:
                raise NotFoundError(f'archived task {archived_id} not found')
            a = row_to_archived_task(row)
            conn.execute('DELETE FROM archived_tasks WHERE id = ?', (archived_id,))
        return a

    def list_archived(self) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM archived_tasks ORDER BY archived_at DESC'
            ).fetchall()
        return [row_to_archived_task(r) for r in rows]

    def list_archived_on(self, date_str: str) -> list[dict]:
        """その日（YYYY-MM-DD）にアーカイブされたタスクのみ返す。"""
        with open_conn(self._db) as conn:
            rows = conn.execute(
                "SELECT * FROM archived_tasks "
                "WHERE substr(archived_at, 1, 10) = ? "
                "ORDER BY archived_at",
                (date_str,),
            ).fetchall()
        return [row_to_archived_task(r) for r in rows]

    def search_archived(
        self, query: str = '', category: str = '', sort: str = 'newest',
    ) -> list[dict]:
        sql, params = 'SELECT * FROM archived_tasks WHERE 1=1', []
        if query:
            sql += ' AND title LIKE ?'
            params.append(f'%{query}%')
        if category:
            sql += ' AND category = ?'
            params.append(category)
        order = {
            'newest': 'archived_at DESC',
            'oldest': 'archived_at ASC',
            'title':  'title ASC',
        }.get(sort, 'archived_at DESC')
        sql += f' ORDER BY {order}'
        with open_conn(self._db) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [row_to_archived_task(r) for r in rows]

    def delete_archived(self, archived_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM archived_tasks WHERE id = ?', (archived_id,))
