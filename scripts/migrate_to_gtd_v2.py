"""GTD v2 マイグレーションスクリプト

docs/GTD_DESIGN.md v2 / docs/GTD_ROADMAP_v2.md Phase 2 に従い以下を実行する:

    1. archive.db を archive_pre_v2_YYYYMMDD.db にバックアップ
    2. db.init_db() で新スキーマを適用
       - tasks: estimate_minutes / category_id / project_sort_order カラム追加
       - projects: status / completion_condition / period_start / period_end / archived / completed_at カラム追加
       - categories テーブル新設 + 親カテゴリ5件投入
    3. 旧 category 文字列 → category_id へ移行
    4. 旧 projects レコード全件を status='archived', archived=1 に設定
    5. state.json に last_manual_rollover キーを追加（欠損時のみ）

冪等: 2回目以降の実行でもエラーにならない。

実行:
    C:\\Python313\\python.exe scripts\\migrate_to_gtd_v2.py
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from config import DATA_DIR, DB_FILE, STATE_FILE  # noqa: E402
from db import init_db  # noqa: E402

# 旧 category 文字列 → 新 category_id マッピング
CATEGORY_MAP: dict[str, str] = {
    'work':     'cat_work',
    'health':   'cat_routine',
    'life':     'cat_routine',
    'learning': 'cat_input',
    'social':   'cat_session',
    'admin':    'cat_work',
}


def log(msg: str) -> None:
    print(f'[migrate_v2] {msg}')


def backup_db() -> str | None:
    """archive.db を archive_pre_v2_YYYYMMDD.db にコピー（既存なら連番サフィックス付与）。"""
    if not os.path.exists(DB_FILE):
        log(f'SKIP backup: {DB_FILE} が存在しません')
        return None

    stamp = date.today().strftime('%Y%m%d')
    base = os.path.join(DATA_DIR, f'archive_pre_v2_{stamp}.db')
    target = base
    idx = 1
    while os.path.exists(target):
        target = os.path.join(DATA_DIR, f'archive_pre_v2_{stamp}_{idx}.db')
        idx += 1

    shutil.copy2(DB_FILE, target)
    log(f'backup: {DB_FILE} -> {target}')
    return target


def migrate_categories(conn: sqlite3.Connection) -> int:
    """旧 category 文字列 → category_id に移行。category_id が未設定の行のみ対象。"""
    updated = 0
    for old_cat, new_id in CATEGORY_MAP.items():
        cur = conn.execute(
            "UPDATE tasks SET category_id = ? "
            "WHERE category = ? AND (category_id IS NULL OR category_id = '')",
            (new_id, old_cat),
        )
        updated += cur.rowcount
    return updated


def archive_old_projects(conn: sqlite3.Connection) -> int:
    """既存の projects レコード（status='drafting'）を全件 archived に設定。

    v1 のプロジェクトは凍結データのため全件アーカイブ扱いにする。
    2回目実行時は status='drafting' の行が存在しないので rowcount=0（冪等）。
    """
    cur = conn.execute(
        "UPDATE projects SET status = 'archived', archived = 1 WHERE status = 'drafting'"
    )
    return cur.rowcount


def update_state_json() -> None:
    """state.json に last_manual_rollover キーを追加（欠損時のみ）。"""
    state: dict = {}
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                state = json.load(f) or {}
        except (OSError, json.JSONDecodeError):
            log('WARN: state.json の読み込みに失敗。再作成します')

    if 'last_manual_rollover' not in state:
        state['last_manual_rollover'] = None
        log('state.json: last_manual_rollover キーを追加')
    else:
        log('state.json: last_manual_rollover は既に存在します（スキップ）')

    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def main() -> None:
    log('=== GTD v2 マイグレーション START ===')

    backup_db()

    log('init_db(): 新スキーマを適用中...')
    init_db()
    log('init_db(): 完了')

    with sqlite3.connect(DB_FILE) as conn:
        cat_updated = migrate_categories(conn)
        log(f'category_id 移行: {cat_updated} 件')

        proj_archived = archive_old_projects(conn)
        log(f'projects アーカイブ: {proj_archived} 件')

        task_count = conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]
        proj_count = conn.execute('SELECT COUNT(*) FROM projects').fetchone()[0]
        cat_count  = conn.execute('SELECT COUNT(*) FROM categories').fetchone()[0]
        log(f'レコード数: tasks={task_count}, projects={proj_count}, categories={cat_count}')

        conn.commit()

    update_state_json()

    log('=== GTD v2 マイグレーション DONE ===')


if __name__ == '__main__':
    main()
