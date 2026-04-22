import json
import sqlite3
from datetime import date, timedelta

from config import DB_FILE


def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        # --- 既存テーブル ---
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
        ]:
            try:
                conn.execute(f'ALTER TABLE brain_dump_sessions ADD COLUMN {col} {definition}')
            except sqlite3.OperationalError:
                pass

        try:
            conn.execute("ALTER TABLE habits ADD COLUMN color TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass

        # --- 新規テーブル ---
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

        conn.execute('''
            CREATE TABLE IF NOT EXISTS behavior_logs (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                ts       TEXT NOT NULL,
                task_id  TEXT NOT NULL DEFAULT '',
                action   TEXT NOT NULL
            )
        ''')
        try:
            conn.execute('CREATE INDEX IF NOT EXISTS idx_behavior_logs_task_id ON behavior_logs(task_id)')
        except sqlite3.OperationalError:
            pass

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

        conn.commit()


def migrate_from_json():
    """JSON/JSONL ファイルから SQLite への移行（冪等）"""
    import os
    from config import TASKS_FILE, PROJECTS_FILE, LOG_FILE

    with sqlite3.connect(DB_FILE) as conn:
        # tasks.json → tasks テーブル
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

        # projects.json → projects テーブル
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

        # task_behavior_log.jsonl → behavior_logs テーブル（テーブルが空のときのみ）
        count = conn.execute('SELECT COUNT(*) FROM behavior_logs').fetchone()[0]
        if count == 0 and os.path.exists(LOG_FILE):
            try:
                with open(LOG_FILE, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                            conn.execute(
                                'INSERT INTO behavior_logs (ts, task_id, action) VALUES (?, ?, ?)',
                                (entry.get('ts', ''), entry.get('task_id', ''), entry.get('action', ''))
                            )
                        except Exception:
                            pass
            except Exception:
                pass

        conn.commit()


def row_to_task(row):
    """archived_tasks 行の変換（既存）"""
    d = dict(row)
    for key in ('roadmap', 'checklist', 'tags'):
        d[key] = json.loads(d.get(key, '[]'))
    return d


def row_to_task_full(row):
    """tasks テーブル行の変換"""
    d = dict(row)
    for key in ('roadmap', 'checklist', 'tags'):
        d[key] = json.loads(d.get(key, '[]'))
    d['completed'] = bool(d.get('completed', 0))
    return d


def row_to_project(row):
    """projects テーブル行の変換"""
    d = dict(row)
    for key in ('tags', 'phases', 'next_step_history'):
        d[key] = json.loads(d.get(key, '[]'))
    return d


def row_to_habit(row):
    """habits テーブル行の変換"""
    d = dict(row)
    d['tags'] = json.loads(d.get('tags', '[]'))
    d['active'] = bool(d.get('active', 1))
    d['importance'] = 'high'
    d['urgency'] = 'low'
    d['color'] = d.get('color', '')
    return d


def calculate_habit_stats(habit_id: str, today: date) -> dict:
    """習慣の継続率・ストリーク計算"""
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT date, done FROM habit_logs WHERE habit_id = ? ORDER BY date',
            (habit_id,)
        ).fetchall()

    logs_by_date = {r['date']: bool(r['done']) for r in rows}

    def rate(days):
        done = sum(
            1 for i in range(days)
            if logs_by_date.get((today - timedelta(days=i)).isoformat())
        )
        return round(done / days, 3)

    # 当日ログなし → 昨日から遡る（今日まだ記録していないだけでストリークを切らない）
    d = today
    if today.isoformat() not in logs_by_date:
        d = today - timedelta(days=1)

    current_streak = 0
    while logs_by_date.get(d.isoformat()):
        current_streak += 1
        d -= timedelta(days=1)

    done_dates = sorted(k for k, v in logs_by_date.items() if v)
    best_streak = 0
    if done_dates:
        run = 1
        for i in range(1, len(done_dates)):
            prev = date.fromisoformat(done_dates[i - 1])
            curr = date.fromisoformat(done_dates[i])
            if (curr - prev).days == 1:
                run += 1
            else:
                best_streak = max(best_streak, run)
                run = 1
        best_streak = max(best_streak, run)

    return {
        'rate_7d':        rate(7),
        'rate_30d':       rate(30),
        'rate_90d':       rate(90),
        'current_streak': current_streak,
        'best_streak':    best_streak,
        'total_done':     sum(1 for v in logs_by_date.values() if v),
    }
