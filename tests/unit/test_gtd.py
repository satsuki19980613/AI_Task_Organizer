"""GTD 純粋関数のテスト（副作用なし、ports 不要）。"""
from core.domain.gtd import (
    check_is_draft, apply_gtd_defaults, validate_move, apply_move,
)


# ── check_is_draft ─────────────────────────────────────────
def test_inbox_always_draft():
    assert check_is_draft({'title': 'x', 'gtd_status': 'inbox'}) is True


def test_no_title_is_draft():
    assert check_is_draft({'title': '', 'gtd_status': 'next_action'}) is True


def test_calendar_without_date_is_draft():
    assert check_is_draft({'title': 'x', 'gtd_status': 'calendar'}) is True


def test_calendar_with_date_not_draft():
    assert check_is_draft({
        'title': 'x', 'gtd_status': 'calendar', 'scheduled_date': '2026-05-01'
    }) is False


def test_next_action_with_title_not_draft():
    assert check_is_draft({'title': 'x', 'gtd_status': 'next_action'}) is False


# ── apply_gtd_defaults ─────────────────────────────────────
def test_defaults_filled():
    t = apply_gtd_defaults({'title': 'x'})
    assert t['gtd_status'] == 'inbox'
    assert t['is_draft'] is True
    assert t['tags'] == []
    assert t['roadmap'] == []
    assert t['checklist'] == []
    assert t['completed'] is False


def test_defaults_preserve_existing():
    t = apply_gtd_defaults({'title': 'x', 'gtd_status': 'next_action'})
    assert t['gtd_status'] == 'next_action'


# ── validate_move ──────────────────────────────────────────
def test_move_completed_back_to_active_rejected():
    t = {'title': 'x', 'completed': True}
    v = validate_move(t, 'next_action')
    assert v['ok'] is False
    assert v['level'] == 'error'


def test_move_to_calendar_without_date_rejected():
    t = {'title': 'x', 'gtd_status': 'inbox'}
    v = validate_move(t, 'calendar')
    assert v['ok'] is False
    assert v['missing'] == ['scheduled_date']


def test_move_to_calendar_inherits_deadline():
    t = {'title': 'x', 'deadline': '2026-05-10'}
    v = validate_move(t, 'calendar')
    assert v['ok'] is True


def test_move_to_someday_with_deadline_rejected():
    t = {'title': 'x', 'deadline': '2026-05-10'}
    v = validate_move(t, 'someday')
    assert v['ok'] is False


def test_move_with_scheduled_for_to_trash_needs_confirm():
    t = {'title': 'x', 'scheduled_for': 'today'}
    v = validate_move(t, 'trash')
    assert v['ok'] is False
    assert v['level'] == 'confirm'


def test_move_with_scheduled_for_to_trash_with_force_ok():
    t = {'title': 'x', 'scheduled_for': 'today'}
    v = validate_move(t, 'trash', {'force_clear_schedule': True, 'force_detach_project': True})
    assert v['ok'] is True


# ── apply_move ─────────────────────────────────────────────
def test_apply_move_to_done_sets_completion():
    t = {'title': 'x', 'gtd_status': 'next_action'}
    out = apply_move(t, 'done')
    assert out['gtd_status'] == 'done'
    assert out['completed'] is True
    assert out['completed_at']


def test_apply_move_to_calendar_inherits_deadline():
    t = {'title': 'x', 'deadline': '2026-05-10'}
    out = apply_move(t, 'calendar')
    assert out['scheduled_date'] == '2026-05-10'


def test_apply_move_force_clear_schedule():
    t = {'title': 'x', 'scheduled_for': 'today'}
    out = apply_move(t, 'trash', {'force_clear_schedule': True})
    assert out['scheduled_for'] is None
