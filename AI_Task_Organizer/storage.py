import json
import os
import sqlite3

from config import DB_FILE, CLAUDE_MD
from db import row_to_task_full, row_to_project


def load_tasks():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM tasks ORDER BY created_at').fetchall()
    return [row_to_task_full(r) for r in rows]


def save_tasks(tasks):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DELETE FROM tasks')
        for t in tasks:
            conn.execute(
                'INSERT INTO tasks '
                '(id, title, importance, urgency, category, tags, roadmap, checklist, notes, completed, deadline, created_at, project_id, phase_id) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (t['id'], t.get('title', ''),
                 t.get('importance', 'high'), t.get('urgency', 'high'),
                 t.get('category', 'life'),
                 json.dumps(t.get('tags', []), ensure_ascii=False),
                 json.dumps(t.get('roadmap', []), ensure_ascii=False),
                 json.dumps(t.get('checklist', []), ensure_ascii=False),
                 t.get('notes', ''),
                 1 if t.get('completed') else 0,
                 t.get('deadline'),
                 t.get('created_at', ''),
                 t.get('project_id'),
                 t.get('phase_id'))
            )
        conn.commit()


def load_projects():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM projects ORDER BY created_at').fetchall()
    projects = [row_to_project(r) for r in rows]
    for proj in projects:
        for ph in proj.get('phases', []):
            ph.setdefault('current_task_id', None)
            ph.setdefault('notes', '')
    return projects


def save_projects(projects):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DELETE FROM projects')
        for p in projects:
            conn.execute(
                'INSERT INTO projects '
                '(id, title, goal, category, deadline, tags, phases, current_phase, created_at, next_step_history) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (p['id'], p.get('title', ''),
                 p.get('goal', ''), p.get('category', 'life'),
                 p.get('deadline'),
                 json.dumps(p.get('tags', []), ensure_ascii=False),
                 json.dumps(p.get('phases', []), ensure_ascii=False),
                 p.get('current_phase', 0),
                 p.get('created_at', ''),
                 json.dumps(p.get('next_step_history', []), ensure_ascii=False))
            )
        conn.commit()


def load_system_prompt():
    if os.path.exists(CLAUDE_MD):
        with open(CLAUDE_MD, 'r', encoding='utf-8') as f:
            return f.read()
    return ''
