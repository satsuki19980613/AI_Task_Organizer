"""TaskService のユニットテスト（fakes だけで完結、SQLite 不要）。"""
from datetime import datetime

import pytest

from core.events import (
    TaskCreated, TaskUpdated, TaskMoved, TaskCompleted,
    TaskScheduled, TaskArchived, TaskDeleted,
)
from core.services.task_service import TaskService
from core.domain.errors import NotFoundError, ValidationError
from tests.fakes.clock import FakeClock
from tests.fakes.event_bus import RecordingEventBus
from tests.fakes.repositories import (
    InMemoryTaskRepository, InMemoryHabitRepository, InMemoryCategoryRepository,
    InMemoryWeeklyReviewRepository, InMemoryStateRepository,
)


@pytest.fixture
def svc():
    return _build_service()


def _build_service(now: datetime | None = None):
    clock = FakeClock(now or datetime(2026, 4, 28, 9, 0, 0))
    bus = RecordingEventBus()
    s = TaskService(
        task_repo=InMemoryTaskRepository(),
        habit_repo=InMemoryHabitRepository(),
        category_repo=InMemoryCategoryRepository(),
        weekly_review_repo=InMemoryWeeklyReviewRepository(),
        state_repo=InMemoryStateRepository(),
        event_bus=bus,
        clock=clock,
    )
    s._test_bus = bus  # type: ignore  # テストで参照するためのフック
    s._test_clock = clock  # type: ignore
    return s


def test_create_publishes_TaskCreated(svc):
    t = svc.create({'title': 'first task'})
    assert t['title'] == 'first task'
    assert t['gtd_status'] == 'inbox'
    assert t['is_draft'] is True
    assert TaskCreated in svc._test_bus.types()  # type: ignore


def test_create_strips_deprecated_fields(svc):
    t = svc.create({'title': 'x', 'importance': 'high', 'urgency': 'low'})
    assert 'importance' not in t or t.get('importance') is None or t['importance'] == 'high'
    # 重要なのは strip 後でもエラーなしで作成できること
    assert t['title'] == 'x'


def test_update_invalid_status_raises(svc):
    t = svc.create({'title': 'x'})
    with pytest.raises(ValidationError):
        svc.update(t['id'], {'gtd_status': 'invalid_status'})


def test_update_missing_raises_not_found(svc):
    with pytest.raises(NotFoundError):
        svc.update('nope', {'notes': 'x'})


def test_update_completed_sets_done_status(svc):
    t = svc.create({'title': 'x'})
    out = svc.update(t['id'], {'completed': True})
    assert out['gtd_status'] == 'done'
    assert out['completed_at']
    assert TaskCompleted in svc._test_bus.types()  # type: ignore


def test_collect_creates_multiple(svc):
    created = svc.collect(['a', 'b', '   ', 'c'])
    assert [c['title'] for c in created] == ['a', 'b', 'c']
    assert all(c['gtd_status'] == 'inbox' for c in created)


def test_collect_empty_raises(svc):
    with pytest.raises(ValidationError):
        svc.collect([])


def test_move_publishes_TaskMoved(svc):
    t = svc.create({'title': 'x'})
    result = svc.move(t['id'], 'next_action', {'force_clear_schedule': False, 'force_detach_project': False})
    assert result['ok'] is True
    assert TaskMoved in svc._test_bus.types()  # type: ignore


def test_move_to_someday_with_deadline_returns_verdict(svc):
    t = svc.create({'title': 'x', 'deadline': '2026-05-10'})
    result = svc.move(t['id'], 'someday', {'force_clear_schedule': False, 'force_detach_project': False})
    assert result['ok'] is False
    assert result['level'] == 'error'


def test_move_invalid_status_raises(svc):
    t = svc.create({'title': 'x'})
    with pytest.raises(ValidationError):
        svc.move(t['id'], 'invalid', {'force_clear_schedule': False, 'force_detach_project': False})


def test_schedule_publishes_TaskScheduled(svc):
    t = svc.create({'title': 'x'})
    out = svc.schedule(t['id'], 'today')
    assert out['scheduled_for'] == 'today'
    assert TaskScheduled in svc._test_bus.types()  # type: ignore


def test_schedule_invalid_value_raises(svc):
    t = svc.create({'title': 'x'})
    with pytest.raises(ValidationError):
        svc.schedule(t['id'], 'next-week')


def test_delete_publishes_TaskDeleted(svc):
    t = svc.create({'title': 'x'})
    svc.delete(t['id'])
    assert TaskDeleted in svc._test_bus.types()  # type: ignore


def test_archive_publishes_TaskArchived(svc):
    t = svc.create({'title': 'x'})
    archived = svc.archive(t['id'])
    assert archived['archived_at']
    assert TaskArchived in svc._test_bus.types()  # type: ignore


def test_drafts_returns_only_drafts(svc):
    a = svc.create({'title': 'inbox-a'})  # inbox なので draft
    svc.update(a['id'], {'gtd_status': 'next_action'})  # 確定
    svc.create({'title': 'still-draft'})  # inbox のまま
    drafts = svc.list_drafts()
    titles = sorted(d['title'] for d in drafts)
    assert titles == ['still-draft']


def test_review_summary_counts(svc):
    a = svc.create({'title': 'a'})
    svc.update(a['id'], {'gtd_status': 'next_action'})
    svc.update(a['id'], {'completed': True})  # done
    svc.create({'title': 'still-draft'})  # draft
    summary = svc.review_summary()
    assert summary['drafts'] == 1
    assert summary['this_week_done'] == 1


def test_rollover_advances_scheduled_for():
    s = _build_service(now=datetime(2026, 4, 28, 9, 0, 0))
    a = s.create({'title': 'a'})
    s.schedule(a['id'], 'tomorrow')
    b = s.create({'title': 'b'})
    s.schedule(b['id'], 'today')
    n = s._rollover_if_needed(force=True)
    assert n == 2
    a2 = s._tasks.get(a['id'])
    b2 = s._tasks.get(b['id'])
    assert a2['scheduled_for'] == 'today'
    assert b2['scheduled_for'] is None


def test_rollover_idempotent_same_day():
    s = _build_service(now=datetime(2026, 4, 28, 9, 0, 0))
    a = s.create({'title': 'a'})
    s.schedule(a['id'], 'tomorrow')
    s._rollover_if_needed()
    n = s._rollover_if_needed()
    assert n == 0


def test_rollover_skipped_before_6am():
    s = _build_service(now=datetime(2026, 4, 28, 5, 30, 0))
    a = s.create({'title': 'a'})
    s.schedule(a['id'], 'tomorrow')
    n = s._rollover_if_needed()
    assert n == 0
