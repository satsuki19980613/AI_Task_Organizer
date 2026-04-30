"""GTD 改修向け ゼロスタート マイグレーションスクリプト。

docs/GTD_DESIGN.md Sect.10 の手順を実行する:

    1. data/ 全体を data_backup_YYYYMMDD/ にコピー（安全策）
    2. 既存 data/tasks.json を archive.db の archived_tasks へ移動
    3. tasks テーブル内のレコードも archived_tasks へ移動
    4. tasks.json を [] に初期化し、tasks テーブルは空に
    5. data/task_analysis_report.json 削除
    6. data/task_behavior_log.jsonl 削除
    7. archive.db の behavior_logs テーブル DROP
    8. init_db() を実行して新スキーマを適用
       (tasks: 新カラム追加 / habits: weekday 追加 / weekly_reviews 新設)
    9. data/state.json を初期化

冪等: 2回目以降の実行でもエラーにならない。

実行:
    C:\\Python313\\python.exe scripts\\migrate_to_gtd.py
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from datetime import date, datetime

# プロジェクトルートを import path に追加
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from config import (  # noqa: E402
    DATA_DIR, TASKS_FILE, DB_FILE, STATE_FILE,
)

# v2 で config から削除された定数をスクリプト内で補完（一時移行スクリプト用）
LOG_FILE      = os.path.join(DATA_DIR, 'task_behavior_log.jsonl')
ANALYSIS_FILE = os.path.join(DATA_DIR, 'task_analysis_report.json')
from db import init_db  # noqa: E402


def log(msg: str) -> None:
    print(f'[migrate_to_gtd] {msg}')


def backup_data_dir() -> str | None:
    """data/ を data_backup_YYYYMMDD/ にコピー。既存なら連番サフィックスを付与。"""
    if not os.path.isdir(DATA_DIR):
        log(f'SKIP backup: {DATA_DIR} が存在しません')
        return None

    stamp = date.today().strftime('%Y%m%d')
    base = os.path.join(os.path.dirname(DATA_DIR), f'data_backup_{stamp}')
    target = base
    idx = 1
    while os.path.exists(target):
        target = f'{base}_{idx}'
        idx += 1

    shutil.copytree(DATA_DIR, target)
    log(f'backup: {DATA_DIR} -> {target}')
    return target


def _insert_archived_task(conn: sqlite3.Connection, task: dict) -> None:
    """旧スキーマの task dict を archived_tasks に挿入（既存IDは INSERT OR IGNORE）。"""
    now = datetime.now().isoformat(timespec='seconds')
    conn.execute(
        'INSERT OR IGNORE INTO archived_tasks '
        '(id, title, importance, urgency, category, tags, roadmap, checklist, notes, archived_at, deadline) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (
            str(task.get('id') or int(datetime.now().timestamp() * 1000)),
            task.get('title', ''),
            task.get('importance', 'high') or 'high',
            task.get('urgency', 'high') or 'high',
            task.get('category', 'life') or 'life',
            json.dumps(task.get('tags', []), ensure_ascii=False),
            json.dumps(task.get('roadmap', []), ensure_ascii=False),
            json.dumps(task.get('checklist', []), ensure_ascii=False),
            task.get('notes', '') or '',
            now,
            task.get('deadline'),
        ),
    )


def archive_existing_tasks() -> None:
    """tasks.json と tasks テーブルのレコードを archived_tasks へ退避。"""
    if not os.path.exists(DB_FILE):
        log(f'SKIP archive: {DB_FILE} が存在しません（init_db が先に走ります）')
        return

    moved_json = 0
    moved_rows = 0

    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row

        # 1) tasks.json からの退避
        if os.path.exists(TASKS_FILE):
            try:
                with open(TASKS_FILE, 'r', encoding='utf-8') as f:
                    raw = json.load(f) or []
                for t in raw:
                    _insert_archived_task(conn, t)
                    moved_json += 1
            except (OSError, json.JSONDecodeError) as e:
                log(f'WARN: tasks.json の読み込みに失敗: {e}')

        # 2) tasks テーブルからの退避
        try:
            rows = conn.execute('SELECT * FROM tasks').fetchall()
            for r in rows:
                d = {k: r[k] for k in r.keys()}
                for key in ('roadmap', 'checklist', 'tags'):
                    try:
                        d[key] = json.loads(d.get(key) or '[]')
                    except (TypeError, ValueError):
                        d[key] = []
                _insert_archived_task(conn, d)
                moved_rows += 1
            conn.execute('DELETE FROM tasks')
        except sqlite3.OperationalError as e:
            log(f'INFO: tasks テーブル未作成のためスキップ: {e}')

        conn.commit()

    log(f'archived: json={moved_json} rows={moved_rows}')


def reset_tasks_json() -> None:
    """tasks.json を [] に初期化。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump([], f, ensure_ascii=False)
    log(f'reset: {TASKS_FILE} = []')


def delete_legacy_files() -> None:
    """旧分析レポート・行動ログファイルを削除。"""
    for path in (ANALYSIS_FILE, LOG_FILE):
        if os.path.exists(path):
            try:
                os.remove(path)
                log(f'removed: {path}')
            except OSError as e:
                log(f'WARN: 削除失敗 {path}: {e}')
        else:
            log(f'SKIP: {path} は存在しません')


def drop_behavior_logs_table() -> None:
    """behavior_logs テーブルを DROP（init_db でも実行されるが明示的に）。"""
    if not os.path.exists(DB_FILE):
        log('SKIP drop: archive.db が存在しません')
        return
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DROP TABLE IF EXISTS behavior_logs')
        conn.commit()
    log('dropped: behavior_logs')


def initialize_state_file() -> None:
    """state.json を初期化。既存なら欠損キーのみ補完。"""
    default = {'last_rollover_date': None, 'last_draft_cleanup': None}
    state = default.copy()

    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f) or {}
            # 既存値を優先し、欠損キーのみデフォルトで補う
            for k, v in default.items():
                existing.setdefault(k, v)
            state = existing
            log(f'state.json は既存、欠損キーのみ補完: {state}')
        except (OSError, json.JSONDecodeError):
            log('state.json が破損、デフォルトで再初期化')
    else:
        log(f'state.json を新規作成: {state}')

    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def main() -> None:
    log('=== START ===')
    backup_data_dir()
    # 先に既存タスクを archive に退避（tasks テーブルが無い場合は skip される）
    archive_existing_tasks()
    reset_tasks_json()
    delete_legacy_files()
    drop_behavior_logs_table()
    # 新スキーマ適用（tasks に GTD カラム追加 / habits.weekday / weekly_reviews）
    init_db()
    log('init_db: 新スキーマを適用')
    initialize_state_file()
    log('=== DONE ===')


if __name__ == '__main__':
    main()
