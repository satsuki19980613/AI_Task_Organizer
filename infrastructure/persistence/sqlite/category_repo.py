"""categories テーブル用 Repository。"""
from __future__ import annotations

from infrastructure.persistence.sqlite.connection import open_conn
from infrastructure.persistence.sqlite.mappers import row_to_category
from core.domain.errors import NotFoundError


class SqliteCategoryRepository:
    def __init__(self, db_file: str):
        self._db = db_file

    def get(self, category_id: str) -> dict:
        with open_conn(self._db) as conn:
            row = conn.execute(
                'SELECT * FROM categories WHERE id = ?', (category_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f'category {category_id} not found')
        return row_to_category(row)

    def list(self) -> list[dict]:
        with open_conn(self._db) as conn:
            rows = conn.execute(
                'SELECT * FROM categories ORDER BY sort_order, name'
            ).fetchall()
        return [row_to_category(r) for r in rows]

    def save(self, category: dict) -> None:
        with open_conn(self._db) as conn:
            conn.execute(
                'INSERT INTO categories '
                '(id, name, parent_id, icon, color, is_system, sort_order, created_at) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET '
                'name=excluded.name, parent_id=excluded.parent_id, '
                'icon=excluded.icon, color=excluded.color, '
                'sort_order=excluded.sort_order',
                (category['id'], category.get('name', ''),
                 category.get('parent_id'),
                 category.get('icon'), category.get('color'),
                 1 if category.get('is_system') else 0,
                 category.get('sort_order') or 0,
                 category.get('created_at')),
            )

    def delete(self, category_id: str) -> None:
        with open_conn(self._db) as conn:
            conn.execute('DELETE FROM categories WHERE id = ?', (category_id,))
