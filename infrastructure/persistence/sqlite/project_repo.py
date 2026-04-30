"""projects テーブル用 Repository。"""
from __future__ import annotations

from infrastructure.persistence.sqlite.connection import open_conn
from infrastructure.persistence.sqlite.mappers import (
    row_to_project, project_to_params, PROJECT_COLUMNS, PROJECT_PLACEHOLDERS,
)
from core.domain.errors import NotFoundError


class SqliteProjectRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def get(self, project_id: str) -> dict:
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM projects WHERE id = ?', (project_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f'project {project_id} not found')
        return row_to_project(row)

    def list(self, **filters) -> list[dict]:
        sql = 'SELECT * FROM projects'
        params: list = []
        clauses: list[str] = []
        if 'status' in filters:
            clauses.append('status = ?')
            params.append(filters['status'])
        if 'archived' in filters:
            clauses.append('archived = ?')
            params.append(1 if filters['archived'] else 0)
        if clauses:
            sql += ' WHERE ' + ' AND '.join(clauses)
        sql += ' ORDER BY created_at'
        with open_conn(self._db) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [row_to_project(r) for r in rows]

    def save(self, project: dict) -> None:
        sql = (
            f'INSERT INTO projects ({PROJECT_COLUMNS}) '
            f'VALUES ({PROJECT_PLACEHOLDERS}) '
            'ON CONFLICT(id) DO UPDATE SET '
            'title=excluded.title, goal=excluded.goal, category=excluded.category, '
            'deadline=excluded.deadline, tags=excluded.tags, phases=excluded.phases, '
            'current_phase=excluded.current_phase, '
            'next_step_history=excluded.next_step_history, '
            'status=excluded.status, '
            'completion_condition=excluded.completion_condition, '
            'period_start=excluded.period_start, period_end=excluded.period_end, '
            'archived=excluded.archived, completed_at=excluded.completed_at'
        )
        with open_conn(self._db) as conn:
            conn.execute(sql, project_to_params(project))

    def save_all(self, projects: list[dict]) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM projects')
            for p in projects:
                conn.execute(
                    f'INSERT INTO projects ({PROJECT_COLUMNS}) '
                    f'VALUES ({PROJECT_PLACEHOLDERS})',
                    project_to_params(p),
                )

    def delete(self, project_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM projects WHERE id = ?', (project_id,))
