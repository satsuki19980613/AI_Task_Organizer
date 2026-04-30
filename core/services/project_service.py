"""ProjectService — プロジェクトのユースケース。

担当ルート: /api/projects/*
"""
from __future__ import annotations

import time
from typing import Any

from config.constants import VALID_PROJECT_STATUS
from core.domain.errors import NotFoundError, ValidationError
from core.domain.gtd import check_is_draft
from core.events import (
    ProjectCreated, ProjectUpdated, ProjectActivated,
    TaskCreated, TaskUpdated,
)


_UPDATABLE = (
    'title', 'goal', 'category', 'deadline', 'tags',
    'completion_condition', 'period_start', 'period_end',
    'status', 'archived', 'completed_at',
)

_DEPRECATED = ('importance', 'urgency', 'is_two_minute', 'category')


class ProjectService:
    def __init__(self, project_repo, task_repo, event_bus, clock):
        self._projects = project_repo
        self._tasks = task_repo
        self._bus = event_bus
        self._clock = clock

    def list_all(self, status: str = '', archived: Any = None) -> list[dict]:
        projects = self._projects.list()
        if status:
            projects = [p for p in projects if (p.get('status') or 'drafting') == status]
        if archived in (False, '0', 'false'):
            projects = [p for p in projects if not p.get('archived')]
        elif archived in (True, '1', 'true'):
            projects = [p for p in projects if p.get('archived')]
        return projects

    def create(self, data: dict) -> dict:
        title = str(data.get('title', '')).strip()
        if not title:
            raise ValidationError('title is required')
        project = {
            'id':                   'proj_' + str(int(time.time() * 1000)),
            'title':                title,
            'goal':                 data.get('goal', ''),
            'category':             data.get('category', 'life'),
            'deadline':             data.get('deadline'),
            'phases':               [],
            'tags':                 data.get('tags', []),
            'current_phase':        0,
            'created_at':           self._clock.now().isoformat(timespec='seconds'),
            'next_step_history':    [],
            'status':               'drafting',
            'completion_condition': data.get('completion_condition'),
            'period_start':         data.get('period_start'),
            'period_end':           data.get('period_end'),
            'archived':             False,
            'completed_at':         None,
        }
        self._projects.save(project)
        self._bus.publish(ProjectCreated(project=project))
        return project

    def update(self, project_id: str, data: dict) -> dict:
        if 'status' in data and data['status'] not in VALID_PROJECT_STATUS:
            raise ValidationError(f'invalid status: {data["status"]}')
        existing = self._projects.get(project_id)
        changes = {k: data[k] for k in _UPDATABLE if k in data}
        existing.update(changes)
        self._projects.save(existing)
        self._bus.publish(ProjectUpdated(project=existing, changes=changes))
        return existing

    def delete(self, project_id: str) -> None:
        # 子タスクの project_id をクリア（タスク自体は残す）
        for t in self._tasks.list_by_project(project_id):
            t['project_id'] = None
            self._tasks.save(t)
        self._projects.delete(project_id)

    def activate(self, project_id: str) -> dict:
        target = self._projects.get(project_id)
        if target.get('status') != 'drafting':
            raise ValidationError(
                f'project status must be drafting (now: {target.get("status")})'
            )
        children = self._tasks.list_by_project(project_id)
        activated = 0
        for t in children:
            if not t.get('completed') and t.get('gtd_status') in ('inbox', 'project_pending'):
                t['gtd_status'] = 'next_action'
            t['is_draft'] = check_is_draft(t)
            self._tasks.save(t)
            activated += 1
        target['status'] = 'active'
        self._projects.save(target)
        self._bus.publish(ProjectActivated(project=target))
        return {'ok': True, 'project': target, 'activated_tasks': activated}

    def list_tasks(self, project_id: str) -> list[dict]:
        children = self._tasks.list_by_project(project_id)
        children.sort(key=lambda t: (
            t.get('project_sort_order') if t.get('project_sort_order') is not None else 9999,
            t.get('created_at') or '',
        ))
        return children

    def add_task(self, project_id: str, data: dict) -> dict:
        project = self._projects.get(project_id)
        cleaned = {k: v for k, v in data.items() if k not in _DEPRECATED}
        title = str(cleaned.get('title', '')).strip()
        if not title:
            raise ValidationError('title is required')

        siblings = self._tasks.list_by_project(project_id)
        next_order = max(
            (t.get('project_sort_order') or 0 for t in siblings),
            default=0,
        ) + 10

        is_active = project.get('status') == 'active'
        from core.domain.gtd import apply_gtd_defaults
        task = {
            'id':                 str(int(time.time() * 1000)),
            'title':              title,
            'gtd_status':         'next_action' if is_active else 'inbox',
            'is_draft':           True,
            'created_at':         self._clock.now().isoformat(timespec='seconds'),
            'project_id':         project_id,
            'project_sort_order': cleaned.get('project_sort_order', next_order),
            'category_id':        cleaned.get('category_id'),
            'estimate_minutes':   cleaned.get('estimate_minutes'),
            'deadline':           cleaned.get('deadline'),
            'scheduled_date':     cleaned.get('scheduled_date'),
            'waiting_for':        cleaned.get('waiting_for'),
            'tags':               cleaned.get('tags', []),
            'roadmap':            cleaned.get('roadmap', []),
            'checklist':          cleaned.get('checklist', []),
            'notes':              cleaned.get('notes', ''),
        }
        apply_gtd_defaults(task)
        task['is_draft'] = check_is_draft(task)
        self._tasks.save(task)
        self._bus.publish(TaskCreated(task=task))
        return task
