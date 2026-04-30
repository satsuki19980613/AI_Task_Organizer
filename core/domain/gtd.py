"""GTD v2 純粋ロジック — 副作用なし、外部依存なし。

ここに置くのは「task / habit / category という値を入れたら判定・変換した値が
返る」関数のみ。永続化や時刻取得を必要とする処理（rollover、cleanup_drafts）は
`core/services/` の範疇 — このファイルには置かない。

仕様: docs/GTD_DESIGN.md v2 / Sect.5・6
"""
from datetime import datetime
from typing import Any

from config.constants import MOVE_REQUIRED_FIELDS, MOVE_FORBIDDEN_TRANSITIONS


def check_is_draft(task: dict) -> bool:
    """必須項目が揃っていなければ True（＝下書き扱い）。

    必須項目マトリクス (GTD_DESIGN.md Sect.2.4):
    - inbox                            → 常に下書き（仕分け前）
    - next_action / someday /
      project_pending / trash / done   → title のみで確定可
    - waiting                          → title のみで確定可（waiting_for は任意）
    - calendar                         → title, scheduled_date
    """
    if not task.get('title'):
        return True
    status = task.get('gtd_status', 'inbox')
    if status == 'inbox':
        return True
    if status == 'calendar':
        return not task.get('scheduled_date')
    return False


def apply_gtd_defaults(task: dict) -> dict:
    """新規タスク作成時に GTD v2 必須フィールドのデフォルトを埋める（既存値は保持）。"""
    task.setdefault('gtd_status',         'inbox')
    task.setdefault('is_draft',           True)
    task.setdefault('category_id',        None)
    task.setdefault('estimate_minutes',   None)
    task.setdefault('deadline',           None)
    task.setdefault('scheduled_date',     None)
    task.setdefault('scheduled_for',      None)
    task.setdefault('waiting_for',        None)
    task.setdefault('tags',               [])
    task.setdefault('roadmap',            [])
    task.setdefault('checklist',          [])
    task.setdefault('notes',              '')
    task.setdefault('project_id',         None)
    task.setdefault('project_sort_order', None)
    task.setdefault('completed',          False)
    task.setdefault('completed_at',       None)
    return task


def validate_move(task: dict, target_status: str, force_params: dict | None = None) -> dict:
    """gtd_status を target_status に変更してよいかを判定する。

    Returns:
        {"ok": True}                                                   — 移動 OK
        {"ok": False, "level": "error",   "error": "...",
         "missing": [...]}                                             — D&D 拒否
        {"ok": False, "level": "confirm", "error": "...",
         "force_param": "..."}                                          — 確認ダイアログ
    """
    force_params = force_params or {}

    # ── ERROR レベル（拒否） ──
    if target_status in ('next_action', 'waiting', 'calendar') and task.get('completed'):
        return {
            'ok':    False,
            'level': 'error',
            'error': '完了済みはアーカイブから復元してください',
        }

    for field_name, message in MOVE_REQUIRED_FIELDS.get(target_status, []):
        if not task.get(field_name):
            if target_status == 'calendar' and field_name == 'scheduled_date' and task.get('deadline'):
                continue
            return {
                'ok':      False,
                'level':   'error',
                'error':   message,
                'missing': [field_name],
            }

    forbidden = MOVE_FORBIDDEN_TRANSITIONS.get(target_status)
    if forbidden:
        when = forbidden.get('when')
        if when == 'has_deadline' and task.get('deadline'):
            return {
                'ok':    False,
                'level': 'error',
                'error': forbidden.get('message', '移動できません'),
            }

    # ── CONFIRM レベル（要確認） ──
    if (
        target_status in ('trash', 'someday', 'waiting')
        and task.get('scheduled_for')
        and not force_params.get('force_clear_schedule')
    ):
        return {
            'ok':          False,
            'level':       'confirm',
            'error':       '予定を解除して移動しますか？',
            'force_param': 'force_clear_schedule',
        }

    if (
        target_status == 'trash'
        and task.get('project_id')
        and not force_params.get('force_detach_project')
    ):
        return {
            'ok':          False,
            'level':       'confirm',
            'error':       'プロジェクトから外して移動しますか？',
            'force_param': 'force_detach_project',
        }

    return {'ok': True}


def apply_move(task: dict, target_status: str, force_params: dict | None = None) -> dict:
    """validate_move を通過した task に対して、副作用を含めて遷移を反映する。"""
    force_params = force_params or {}
    task['gtd_status'] = target_status
    if force_params.get('force_clear_schedule'):
        task['scheduled_for'] = None
    if force_params.get('force_detach_project'):
        task['project_id'] = None
    if target_status == 'calendar' and not task.get('scheduled_date') and task.get('deadline'):
        task['scheduled_date'] = task['deadline']
    if target_status == 'done':
        task['completed'] = True
        if not task.get('completed_at'):
            task['completed_at'] = datetime.now().isoformat(timespec='seconds')
    task['is_draft'] = check_is_draft(task)
    return task


def _resolve_parent_category(cat_id: str | None, by_id: dict) -> str | None:
    """子カテゴリ id から親カテゴリ id を辿る（最大 5 段で打ち切り）。"""
    cur = cat_id
    for _ in range(5):
        if not cur or cur not in by_id:
            return None
        node = by_id[cur]
        if not node.get('parent_id'):
            return cur
        cur = node['parent_id']
    return None


def compute_today_summary(tasks: list, habits: list, categories: list) -> dict:
    """今日/明日パネル用に親カテゴリでグルーピングし、estimate_minutes 合計を計算する。"""
    by_id = {c['id']: c for c in categories}
    parents = sorted(
        [c for c in categories if not c.get('parent_id')],
        key=lambda c: c.get('sort_order') or 0,
    )

    def make_group(cat: dict | None) -> dict:
        if cat is None:
            return {
                'id':         None,
                'name':       '未分類',
                'icon':       '',
                'color':      '',
                'sort_order': 999,
                'tasks':      [],
                'habits':     [],
                'minutes':    0,
            }
        return {
            'id':         cat['id'],
            'name':       cat.get('name', ''),
            'icon':       cat.get('icon') or '',
            'color':      cat.get('color') or '',
            'sort_order': cat.get('sort_order') or 0,
            'tasks':      [],
            'habits':     [],
            'minutes':    0,
        }

    groups: dict[str | None, dict] = {p['id']: make_group(p) for p in parents}
    groups[None] = make_group(None)

    total_minutes = 0
    for t in tasks:
        cat_id = t.get('category_id')
        parent_id = _resolve_parent_category(cat_id, by_id) if cat_id else None
        if parent_id not in groups:
            parent_id = None
        groups[parent_id]['tasks'].append(t)
        m = t.get('estimate_minutes') or 0
        if isinstance(m, int) and m > 0:
            groups[parent_id]['minutes'] += m
            total_minutes += m

    routine_target = groups.get('cat_routine') or groups[None]
    for h in habits:
        routine_target['habits'].append(h)

    ordered: list[dict] = [groups[p['id']] for p in parents]
    if groups[None]['tasks'] or groups[None]['habits']:
        ordered.append(groups[None])

    return {'groups': ordered, 'total_minutes': total_minutes}
