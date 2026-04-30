"""SQLite スキーマ定義とマイグレーション。

`init_db()` を起動時に1回呼ぶ。テーブル CREATE は冪等（IF NOT EXISTS）、
カラム追加は ALTER TABLE + try/except で既存 DB との互換を保つ。
"""
import json
import os
import sqlite3
from datetime import datetime

from config import TASKS_FILE, PROJECTS_FILE


def init_db(db_file: str) -> None:
    with sqlite3.connect(db_file) as conn:
        # archived_tasks
        conn.execute('''
            CREATE TABLE IF NOT EXISTS archived_tasks (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                importance  TEXT NOT NULL DEFAULT 'high',
                urgency     TEXT NOT NULL DEFAULT 'high',
                category    TEXT NOT NULL DEFAULT 'life',
                tags        TEXT NOT NULL DEFAULT '[]',
                roadmap     TEXT NOT NULL DEFAULT '[]',
                checklist   TEXT NOT NULL DEFAULT '[]',
                notes       TEXT NOT NULL DEFAULT '',
                archived_at TEXT NOT NULL,
                deadline    TEXT
            )
        ''')
        for col, definition in [
            ('importance', "TEXT NOT NULL DEFAULT 'high'"),
            ('urgency',    "TEXT NOT NULL DEFAULT 'high'"),
            ('tags',       "TEXT NOT NULL DEFAULT '[]'"),
            ('checklist',  "TEXT NOT NULL DEFAULT '[]'"),
        ]:
            try:
                conn.execute(f'ALTER TABLE archived_tasks ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        # brain_dump_sessions
        conn.execute('''
            CREATE TABLE IF NOT EXISTS brain_dump_sessions (
                id             TEXT PRIMARY KEY,
                title          TEXT NOT NULL,
                summary        TEXT NOT NULL DEFAULT '',
                theme_category TEXT NOT NULL DEFAULT 'その他',
                date           TEXT NOT NULL,
                raw_messages   TEXT NOT NULL DEFAULT '[]',
                created_at     TEXT NOT NULL
            )
        ''')
        for col, definition in [
            ('theme_category', "TEXT NOT NULL DEFAULT 'その他'"),
            ('sub_theme',      "TEXT NOT NULL DEFAULT ''"),
            ('source',         "TEXT NOT NULL DEFAULT 'chat'"),
        ]:
            try:
                conn.execute(f'ALTER TABLE brain_dump_sessions ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        try:
            conn.execute("ALTER TABLE habits ADD COLUMN color TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass

        # tasks
        conn.execute('''
            CREATE TABLE IF NOT EXISTS tasks (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                importance  TEXT NOT NULL DEFAULT 'high',
                urgency     TEXT NOT NULL DEFAULT 'high',
                category    TEXT NOT NULL DEFAULT 'life',
                tags        TEXT NOT NULL DEFAULT '[]',
                roadmap     TEXT NOT NULL DEFAULT '[]',
                checklist   TEXT NOT NULL DEFAULT '[]',
                notes       TEXT NOT NULL DEFAULT '',
                completed   INTEGER NOT NULL DEFAULT 0,
                deadline    TEXT,
                created_at  TEXT NOT NULL,
                project_id  TEXT,
                phase_id    TEXT
            )
        ''')
        for col, definition in [
            ('gtd_status',     "TEXT NOT NULL DEFAULT 'inbox'"),
            ('is_draft',       "INTEGER NOT NULL DEFAULT 1"),
            ('scheduled_date', "TEXT"),
            ('scheduled_for',  "TEXT"),
            ('waiting_for',    "TEXT"),
            ('is_two_minute',  "INTEGER NOT NULL DEFAULT 0"),
            ('completed_at',   "TEXT"),
        ]:
            try:
                conn.execute(f'ALTER TABLE tasks ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        for col, definition in [
            ('estimate_minutes',   'INTEGER'),
            ('category_id',        'TEXT'),
            ('project_sort_order', 'INTEGER'),
        ]:
            try:
                conn.execute(f'ALTER TABLE tasks ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        # projects
        conn.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id                TEXT PRIMARY KEY,
                title             TEXT NOT NULL,
                goal              TEXT NOT NULL DEFAULT '',
                category          TEXT NOT NULL DEFAULT 'life',
                deadline          TEXT,
                tags              TEXT NOT NULL DEFAULT '[]',
                phases            TEXT NOT NULL DEFAULT '[]',
                current_phase     INTEGER NOT NULL DEFAULT 0,
                created_at        TEXT NOT NULL,
                next_step_history TEXT NOT NULL DEFAULT '[]'
            )
        ''')
        for col, definition in [
            ('status',               "TEXT NOT NULL DEFAULT 'drafting'"),
            ('completion_condition', 'TEXT'),
            ('period_start',         'TEXT'),
            ('period_end',           'TEXT'),
            ('archived',             'INTEGER DEFAULT 0'),
            ('completed_at',         'TEXT'),
        ]:
            try:
                conn.execute(f'ALTER TABLE projects ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        try:
            conn.execute('DROP TABLE IF EXISTS behavior_logs')
        except sqlite3.OperationalError:
            pass

        # categories
        conn.execute('''
            CREATE TABLE IF NOT EXISTS categories (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                parent_id   TEXT,
                icon        TEXT,
                color       TEXT,
                is_system   INTEGER DEFAULT 0,
                sort_order  INTEGER DEFAULT 0,
                created_at  TEXT,
                FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
            )
        ''')
        _now = datetime.now().isoformat(timespec='seconds')
        for cat_id, name, icon, color, sort in [
            ('cat_output',  'Output',    '📤', '#4F46E5', 10),
            ('cat_input',   'Input',     '📥', '#059669', 20),
            ('cat_work',    'Work',      '🛠',  '#DC2626', 30),
            ('cat_session', 'Session',   '👥', '#D97706', 40),
            ('cat_routine', 'ルーティン', '🔁', '#7C3AED', 50),
        ]:
            conn.execute(
                'INSERT OR IGNORE INTO categories '
                '(id, name, parent_id, icon, color, is_system, sort_order, created_at) '
                'VALUES (?, ?, NULL, ?, ?, 1, ?, ?)',
                (cat_id, name, icon, color, sort, _now),
            )

        # habits
        conn.execute('''
            CREATE TABLE IF NOT EXISTS habits (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                category    TEXT NOT NULL DEFAULT 'life',
                tags        TEXT NOT NULL DEFAULT '[]',
                frequency   TEXT NOT NULL DEFAULT 'daily',
                notes       TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                active      INTEGER NOT NULL DEFAULT 1
            )
        ''')
        try:
            conn.execute('ALTER TABLE habits ADD COLUMN weekday INTEGER')
        except sqlite3.OperationalError:
            pass

        # weekly_reviews
        conn.execute('''
            CREATE TABLE IF NOT EXISTS weekly_reviews (
                id                      TEXT PRIMARY KEY,
                completed_at            TEXT NOT NULL,
                week_start              TEXT NOT NULL,
                week_end                TEXT NOT NULL,
                drafts_processed        INTEGER DEFAULT 0,
                someday_promoted        INTEGER DEFAULT 0,
                trash_deleted           INTEGER DEFAULT 0,
                waiting_resolved        INTEGER DEFAULT 0,
                next_actions_completed  INTEGER DEFAULT 0,
                notes                   TEXT DEFAULT ''
            )
        ''')

        # habit_logs
        conn.execute('''
            CREATE TABLE IF NOT EXISTS habit_logs (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                habit_id  TEXT NOT NULL,
                date      TEXT NOT NULL,
                done      INTEGER NOT NULL DEFAULT 1,
                UNIQUE(habit_id, date)
            )
        ''')
        try:
            conn.execute('CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_id ON habit_logs(habit_id)')
        except sqlite3.OperationalError:
            pass

        # daily_task_log
        conn.execute('''
            CREATE TABLE IF NOT EXISTS daily_task_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                date         TEXT NOT NULL,
                task_id      TEXT NOT NULL,
                title        TEXT NOT NULL,
                status       TEXT NOT NULL,
                category_id  TEXT,
                recorded_at  TEXT NOT NULL
            )
        ''')
        try:
            conn.execute('CREATE INDEX IF NOT EXISTS idx_daily_task_log_date ON daily_task_log(date)')
        except sqlite3.OperationalError:
            pass

        # diary_entries
        conn.execute('''
            CREATE TABLE IF NOT EXISTS diary_entries (
                id             TEXT PRIMARY KEY,
                date           TEXT NOT NULL,
                body_score     INTEGER NOT NULL DEFAULT 0,
                body_text      TEXT NOT NULL DEFAULT '',
                emotion_score  INTEGER NOT NULL DEFAULT 0,
                emotion_text   TEXT NOT NULL DEFAULT '',
                actions        TEXT NOT NULL DEFAULT '[]',
                thoughts       TEXT NOT NULL DEFAULT '[]',
                consolidated   INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT NOT NULL
            )
        ''')
        for col, definition in [
            ('body_anchors',    "TEXT NOT NULL DEFAULT '[]'"),
            ('emotion_anchors', "TEXT NOT NULL DEFAULT '[]'"),
        ]:
            try:
                conn.execute(f'ALTER TABLE diary_entries ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        try:
            conn.execute('CREATE INDEX IF NOT EXISTS idx_diary_entries_date ON diary_entries(date)')
        except sqlite3.OperationalError:
            pass

        conn.commit()


def migrate_from_json(db_file: str) -> None:
    """JSON ファイルから SQLite への移行（冪等）。GTD 改修以前の遺産対応。"""
    with sqlite3.connect(db_file) as conn:
        if os.path.exists(TASKS_FILE):
            try:
                with open(TASKS_FILE, 'r', encoding='utf-8') as f:
                    tasks = json.load(f)
                archived_ids = set(
                    r[0] for r in conn.execute('SELECT id FROM archived_tasks').fetchall()
                )
                for t in tasks:
                    if t['id'] in archived_ids:
                        continue
                    conn.execute(
                        'INSERT OR IGNORE INTO tasks '
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
            except Exception:
                pass

        if os.path.exists(PROJECTS_FILE):
            try:
                with open(PROJECTS_FILE, 'r', encoding='utf-8') as f:
                    projects = json.load(f)
                for p in projects:
                    conn.execute(
                        'INSERT OR IGNORE INTO projects '
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
            except Exception:
                pass

        conn.commit()
