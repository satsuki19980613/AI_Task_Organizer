"""In-memory repository 実装。

ports.repositories.* を満たす最小実装。テストで使う。SQLite に依存しないので
ユニットテストの高速化に有効。
"""
from __future__ import annotations

import copy
from datetime import date

from core.domain.errors import NotFoundError


class InMemoryTaskRepository:
    def __init__(self):
        self._tasks: dict[str, dict] = {}
        self._archived: dict[str, dict] = {}

    def get(self, task_id: str) -> dict:
        if task_id not in self._tasks:
            raise NotFoundError(f'task {task_id} not found')
        return copy.deepcopy(self._tasks[task_id])

    def list(self, **filters) -> list[dict]:
        items = [copy.deepcopy(t) for t in self._tasks.values()]
        if 'project_id' in filters:
            items = [t for t in items if t.get('project_id') == filters['project_id']]
        if 'gtd_status' in filters:
            items = [t for t in items if t.get('gtd_status') == filters['gtd_status']]
        items.sort(key=lambda t: t.get('created_at', ''))
        return items

    def save(self, task: dict) -> None:
        self._tasks[task['id']] = copy.deepcopy(task)

    def save_all(self, tasks: list[dict]) -> None:
        self._tasks = {t['id']: copy.deepcopy(t) for t in tasks}

    def delete(self, task_id: str) -> None:
        self._tasks.pop(task_id, None)

    def list_drafts(self) -> list[dict]:
        return [copy.deepcopy(t) for t in self._tasks.values() if t.get('is_draft')]

    def list_by_project(self, project_id: str) -> list[dict]:
        return self.list(project_id=project_id)

    def find_similar(self, title: str, limit: int) -> list[dict]:
        return [copy.deepcopy(a) for a in self._archived.values()][:limit]

    def archive(self, task_id: str) -> dict:
        if task_id not in self._tasks:
            raise NotFoundError(f'task {task_id} not found')
        t = self._tasks.pop(task_id)
        archived = copy.deepcopy(t)
        archived['archived_at'] = '2026-01-01T00:00:00'
        self._archived[archived['id']] = archived
        return archived

    def restore(self, archived_id: str) -> dict:
        if archived_id not in self._archived:
            raise NotFoundError(f'archived task {archived_id} not found')
        return copy.deepcopy(self._archived.pop(archived_id))

    def list_archived(self) -> list[dict]:
        return [copy.deepcopy(a) for a in self._archived.values()]

    def search_archived(self, query='', category='', sort='newest') -> list[dict]:
        items = self.list_archived()
        if query:
            items = [a for a in items if query in (a.get('title') or '')]
        if category:
            items = [a for a in items if a.get('category') == category]
        return items

    def delete_archived(self, archived_id: str) -> None:
        self._archived.pop(archived_id, None)


class InMemoryProjectRepository:
    def __init__(self):
        self._items: dict[str, dict] = {}

    def get(self, pid: str) -> dict:
        if pid not in self._items:
            raise NotFoundError(f'project {pid} not found')
        return copy.deepcopy(self._items[pid])

    def list(self, **filters) -> list[dict]:
        items = [copy.deepcopy(p) for p in self._items.values()]
        if 'status' in filters:
            items = [p for p in items if p.get('status') == filters['status']]
        if 'archived' in filters:
            items = [p for p in items if bool(p.get('archived')) == bool(filters['archived'])]
        return items

    def save(self, p: dict) -> None:
        self._items[p['id']] = copy.deepcopy(p)

    def save_all(self, items) -> None:
        self._items = {p['id']: copy.deepcopy(p) for p in items}

    def delete(self, pid: str) -> None:
        self._items.pop(pid, None)


class InMemoryCategoryRepository:
    def __init__(self):
        self._items: dict[str, dict] = {}

    def get(self, cid: str) -> dict:
        if cid not in self._items:
            raise NotFoundError(f'category {cid} not found')
        return copy.deepcopy(self._items[cid])

    def list(self) -> list[dict]:
        return sorted(
            [copy.deepcopy(c) for c in self._items.values()],
            key=lambda c: c.get('sort_order') or 0,
        )

    def save(self, c: dict) -> None:
        self._items[c['id']] = copy.deepcopy(c)

    def delete(self, cid: str) -> None:
        self._items.pop(cid, None)


class InMemoryHabitRepository:
    def __init__(self):
        self._items: dict[str, dict] = {}
        self._logs: dict[tuple[str, str], bool] = {}

    def get(self, hid: str) -> dict:
        if hid not in self._items:
            raise NotFoundError(f'habit {hid} not found')
        return copy.deepcopy(self._items[hid])

    def list(self, **filters) -> list[dict]:
        items = [copy.deepcopy(h) for h in self._items.values()]
        if 'active' in filters:
            items = [h for h in items if bool(h.get('active')) == bool(filters['active'])]
        return items

    def save(self, h: dict) -> None:
        self._items[h['id']] = copy.deepcopy(h)

    def delete(self, hid: str) -> None:
        self._items.pop(hid, None)
        for k in list(self._logs.keys()):
            if k[0] == hid:
                del self._logs[k]

    def log_completion(self, hid: str, day: date, done: bool) -> None:
        self._logs[(hid, day.isoformat())] = done

    def get_logs(self, hid: str, start: date, end: date) -> dict[str, bool]:
        out = {}
        for (h, d), done in self._logs.items():
            if h == hid and start.isoformat() <= d <= end.isoformat():
                out[d] = done
        return out

    def calculate_stats(self, hid: str, today: date) -> dict:
        return {
            'rate_7d': 0.0, 'rate_30d': 0.0, 'rate_90d': 0.0,
            'current_streak': 0, 'best_streak': 0, 'total_done': 0,
        }


class InMemoryStateRepository:
    def __init__(self):
        self._state: dict = {}

    def load(self) -> dict:
        return copy.deepcopy(self._state)

    def save(self, state: dict) -> None:
        self._state = copy.deepcopy(state)


class InMemoryWeeklyReviewRepository:
    def __init__(self):
        self._items: list[dict] = []

    def list(self, limit: int) -> list[dict]:
        return [copy.deepcopy(r) for r in self._items[:limit]]

    def save(self, review: dict) -> None:
        self._items.append(copy.deepcopy(review))


class InMemoryDiaryRepository:
    def __init__(self):
        self._items: dict[str, dict] = {}

    def get(self, eid: str) -> dict:
        if eid not in self._items:
            raise NotFoundError(f'diary entry {eid} not found')
        return copy.deepcopy(self._items[eid])

    def list(self, start: date, end: date) -> list[dict]:
        return [
            copy.deepcopy(e) for e in self._items.values()
            if start.isoformat() <= (e.get('date') or '') <= end.isoformat()
        ]

    def save(self, e: dict) -> None:
        self._items[e['id']] = copy.deepcopy(e)

    def delete(self, eid: str) -> None:
        self._items.pop(eid, None)

    def list_unconsolidated(self, limit: int) -> list[dict]:
        items = [copy.deepcopy(e) for e in self._items.values() if not e.get('consolidated')]
        items.sort(key=lambda e: (e.get('date') or '', e.get('created_at') or ''))
        return items[:limit]

    def mark_consolidated(self, ids: list[str]) -> None:
        for i in ids:
            if i in self._items:
                self._items[i]['consolidated'] = True


class InMemoryBraindumpRepository:
    def __init__(self):
        self._items: dict[str, dict] = {}

    def get(self, sid: str) -> dict:
        if sid not in self._items:
            raise NotFoundError(f'braindump {sid} not found')
        return copy.deepcopy(self._items[sid])

    def list(self) -> list[dict]:
        return sorted(
            [copy.deepcopy(s) for s in self._items.values()],
            key=lambda s: s.get('created_at') or '',
            reverse=True,
        )

    def save(self, s: dict) -> None:
        self._items[s['id']] = copy.deepcopy(s)

    def delete(self, sid: str) -> None:
        self._items.pop(sid, None)
