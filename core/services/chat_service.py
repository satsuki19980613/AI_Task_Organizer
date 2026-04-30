"""ChatService — 汎用 AI チャット、タスク詳細チャット、プロジェクトチャット。

担当ルート: /api/chat, /api/tasks/<id>/chat, /api/projects/<id>/chat
"""
from __future__ import annotations

from config import (
    CHAT_HISTORY_LIMIT, PROJECT_HISTORY_LIMIT, ERROR_TEXT_LIMIT,
)
from core.domain.errors import NotFoundError, ValidationError
from core.services.ai_prompts import (
    DUMP_CHAT_SYSTEM, task_detail_system_prompt, project_chat_system_prompt,
)
from core.services.ai_extractors import extract_marker_json


def _sanitize_detail_proposal(d: dict, category_idx: dict) -> dict:
    out: dict = {}
    if 'category_id' in d and isinstance(d['category_id'], str):
        if d['category_id'] in category_idx:
            out['category_id'] = d['category_id']
    if 'estimate_minutes' in d:
        try:
            n = int(d['estimate_minutes'])
            if 0 < n <= 24 * 60:
                out['estimate_minutes'] = n
        except (TypeError, ValueError):
            pass
    if 'roadmap' in d and isinstance(d['roadmap'], list):
        steps = []
        for s in d['roadmap']:
            text = str(s.get('text', '') if isinstance(s, dict) else s).strip()
            if text:
                steps.append({'text': text})
        if steps:
            out['roadmap'] = steps
    if 'checklist' in d and isinstance(d['checklist'], list):
        items = []
        for c in d['checklist']:
            text = str(c.get('text', '') if isinstance(c, dict) else c).strip()
            if text:
                items.append({'text': text})
        if items:
            out['checklist'] = items
    return out


def _sanitize_project_tasks_proposal(d: dict, category_idx: dict) -> dict:
    out: dict = {}
    if 'completion_condition' in d and isinstance(d['completion_condition'], str):
        cc = d['completion_condition'].strip()
        if cc:
            out['completion_condition'] = cc
    if 'tasks' in d and isinstance(d['tasks'], list):
        cleaned = []
        for raw in d['tasks']:
            if not isinstance(raw, dict):
                continue
            title = str(raw.get('title', '')).strip()
            if not title:
                continue
            entry: dict = {'title': title}
            if 'estimate_minutes' in raw:
                try:
                    n = int(raw['estimate_minutes'])
                    if 0 < n <= 24 * 60:
                        entry['estimate_minutes'] = n
                except (TypeError, ValueError):
                    pass
            cat_id = raw.get('category_id')
            if isinstance(cat_id, str) and cat_id in category_idx:
                entry['category_id'] = cat_id
            cleaned.append(entry)
        if cleaned:
            out['tasks'] = cleaned
    return out


def _category_label(cat_id, idx: dict) -> str:
    if not cat_id or cat_id not in idx:
        return '未設定'
    node = idx[cat_id]
    parent_id = node.get('parent_id')
    if parent_id and parent_id in idx:
        parent = idx[parent_id]
        return f"{parent.get('name','')} / {node.get('name','')}"
    return node.get('name', '') or '未設定'


def _category_options_for_prompt(idx: dict) -> str:
    parents = sorted(
        [c for c in idx.values() if not c.get('parent_id')],
        key=lambda c: c.get('sort_order') or 0,
    )
    lines: list[str] = []
    for p in parents:
        lines.append(f"- {p['id']} : {p.get('icon','')} {p.get('name','')}")
        children = sorted(
            [c for c in idx.values() if c.get('parent_id') == p['id']],
            key=lambda c: c.get('sort_order') or 0,
        )
        for c in children:
            lines.append(f"    - {c['id']} : {c.get('name','')}")
    return '\n'.join(lines) if lines else '(カテゴリ未登録)'


class ChatService:
    def __init__(
        self,
        task_repo, project_repo, category_repo,
        ai_engine, system_prompt_loader,
        model_chat: str,
    ):
        self._tasks = task_repo
        self._projects = project_repo
        self._categories = category_repo
        self._ai = ai_engine
        self._load_system_prompt = system_prompt_loader
        self._model_chat = model_chat

    # ── /api/chat ─────────────────────────────────────
    def general_chat(self, messages: list[dict], mode: str = 'task') -> dict:
        system = self._load_system_prompt()
        if mode == 'dump':
            system = DUMP_CHAT_SYSTEM
        recent = messages[-CHAT_HISTORY_LIMIT:]
        try:
            response_text = self._ai.chat(system, recent, self._model_chat)
        except Exception as e:
            err = str(e)
            response_text = (
                f'申し訳ありません、応答を取得できませんでした。'
                f'({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
            )
        return {'response': response_text}

    # ── /api/tasks/<id>/chat ──────────────────────────
    def task_detail_chat(self, task_id: str, messages: list[dict]) -> dict:
        task = self._tasks.get(task_id)
        cat_idx = {c['id']: c for c in self._categories.list()}
        category_label = _category_label(task.get('category_id'), cat_idx)
        deadline_label = task.get('deadline') or '未設定'
        estimate_label = (
            f"{task.get('estimate_minutes')}分"
            if task.get('estimate_minutes') else '未設定'
        )
        status_label = task.get('gtd_status') or 'inbox'
        category_choices = _category_options_for_prompt(cat_idx)

        system = task_detail_system_prompt(
            task=task,
            category_label=category_label,
            deadline_label=deadline_label,
            estimate_label=estimate_label,
            status_label=status_label,
            category_choices=category_choices,
        )
        recent = messages[-CHAT_HISTORY_LIMIT:]
        try:
            response_text = self._ai.chat(system, recent, self._model_chat)
        except Exception as e:
            err = str(e)
            response_text = (
                f'申し訳ありません、応答を取得できませんでした。'
                f'({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
            )

        parsed, response_text = extract_marker_json(response_text, 'DETAIL')
        detail_proposal = None
        if parsed:
            sanitized = _sanitize_detail_proposal(parsed, cat_idx)
            if sanitized:
                detail_proposal = sanitized
        return {'response': response_text, 'detail_proposal': detail_proposal}

    # ── /api/projects/<id>/chat ───────────────────────
    def project_chat(self, project_id: str, messages: list[dict]) -> dict:
        project = self._projects.get(project_id)
        cat_idx = {c['id']: c for c in self._categories.list()}
        category_choices = _category_options_for_prompt(cat_idx)
        children = self._tasks.list_by_project(project_id)

        system = project_chat_system_prompt(project, children, category_choices)
        recent = messages[-PROJECT_HISTORY_LIMIT:]
        try:
            response_text = self._ai.chat(system, recent, self._model_chat)
        except Exception as e:
            err = str(e)
            response_text = (
                f'申し訳ありません、応答を取得できませんでした。'
                f'({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
            )

        parsed, response_text = extract_marker_json(response_text, 'PROJECT_TASKS')
        project_tasks_proposal = None
        if parsed:
            sanitized = _sanitize_project_tasks_proposal(parsed, cat_idx)
            if sanitized:
                project_tasks_proposal = sanitized
        return {
            'response': response_text,
            'project_tasks_proposal': project_tasks_proposal,
        }
