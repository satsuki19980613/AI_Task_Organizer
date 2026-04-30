"""CategoryService — カテゴリのユースケース。

担当ルート: /api/categories/*
"""
from __future__ import annotations

import time

from core.domain.errors import NotFoundError, ValidationError


class CategoryService:
    def __init__(self, category_repo, task_repo, clock):
        self._categories = category_repo
        self._tasks = task_repo
        self._clock = clock

    def list_all(self) -> dict:
        rows = sorted(self._categories.list(), key=lambda c: c.get('sort_order') or 0)
        return {'all': rows, 'parents': rows}

    def create(self, data: dict) -> dict:
        name = str(data.get('name', '')).strip()
        if not name:
            raise ValidationError('name is required')
        category = {
            'id':         'cat_' + str(int(time.time() * 1000)),
            'name':       name,
            'parent_id':  None,
            'icon':       str(data.get('icon', '')).strip(),
            'color':      str(data.get('color', '')).strip(),
            'is_system':  False,
            'sort_order': int(data.get('sort_order') or 0),
            'created_at': self._clock.now().isoformat(timespec='seconds'),
        }
        self._categories.save(category)
        return category

    def update(self, category_id: str, data: dict) -> dict:
        existing = self._categories.get(category_id)
        if existing.get('is_system'):
            raise ValidationError('system category cannot be edited')
        if 'name' in data:
            new_name = str(data['name']).strip()
            existing['name'] = new_name or existing['name']
        if 'icon' in data:
            existing['icon'] = str(data['icon']).strip()
        if 'color' in data:
            existing['color'] = str(data['color']).strip()
        if 'sort_order' in data:
            existing['sort_order'] = int(data['sort_order'] or 0)
        self._categories.save(existing)
        return existing

    def delete(self, category_id: str) -> None:
        existing = self._categories.get(category_id)
        if existing.get('is_system'):
            raise ValidationError('system category cannot be deleted')
        # 子カテゴリ ID（CASCADE で消えるが、タスクの参照は手動でクリア）
        children = [c['id'] for c in self._categories.list() if c.get('parent_id') == category_id]
        affected = [category_id] + children
        for t in self._tasks.list():
            if t.get('category_id') in affected:
                t['category_id'] = None
                self._tasks.save(t)
        self._categories.delete(category_id)
