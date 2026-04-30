"""SQLite repo の往復テスト（実 DB を一時ディレクトリに作成）。

ports の structural な契約と、mappers の dict ↔ row 変換を検証する。
"""
import pytest

from infrastructure.persistence.sqlite.schema import init_db
from infrastructure.persistence.sqlite.task_repo import SqliteTaskRepository
from infrastructure.persistence.sqlite.project_repo import SqliteProjectRepository
from infrastructure.persistence.sqlite.category_repo import SqliteCategoryRepository
from infrastructure.persistence.sqlite.diary_repo import SqliteDiaryRepository


@pytest.fixture
def db_file(tmp_path):
    """pytest 管理の一時ディレクトリ。Windows のファイルロック対策。"""
    path = str(tmp_path / 'test.db')
    init_db(path)
    return path


# ── tasks ─────────────────────────────────────────────────
def test_task_save_then_get(db_file):
    repo = SqliteTaskRepository(db_file)
    t = {
        'id': 't1', 'title': 'hello', 'gtd_status': 'next_action',
        'is_draft': False, 'tags': ['a'], 'roadmap': [{'text': 'step1'}],
        'checklist': [{'text': 'item'}], 'notes': 'n', 'created_at': '2026-01-01',
    }
    repo.save(t)
    out = repo.get('t1')
    assert out['title'] == 'hello'
    assert out['gtd_status'] == 'next_action'
    assert out['is_draft'] is False
    assert out['tags'] == ['a']
    assert out['roadmap'] == [{'text': 'step1'}]


def test_task_list_filter_by_project(db_file):
    repo = SqliteTaskRepository(db_file)
    repo.save({'id': '1', 'title': 'a', 'created_at': '2026-01-01', 'project_id': 'p1'})
    repo.save({'id': '2', 'title': 'b', 'created_at': '2026-01-02', 'project_id': 'p2'})
    repo.save({'id': '3', 'title': 'c', 'created_at': '2026-01-03', 'project_id': 'p1'})
    items = repo.list_by_project('p1')
    assert sorted(i['id'] for i in items) == ['1', '3']


def test_task_archive_and_restore(db_file):
    repo = SqliteTaskRepository(db_file)
    repo.save({'id': 't1', 'title': 'x', 'created_at': '2026-01-01'})
    archived = repo.archive('t1')
    assert archived['archived_at']

    # tasks から消えている
    from core.domain.errors import NotFoundError
    with pytest.raises(NotFoundError):
        repo.get('t1')
    # archived に存在
    items = repo.list_archived()
    assert len(items) == 1

    # restore
    restored = repo.restore('t1')
    assert restored['id'] == 't1'
    assert len(repo.list_archived()) == 0


# ── projects ──────────────────────────────────────────────
def test_project_save_get_delete(db_file):
    repo = SqliteProjectRepository(db_file)
    p = {
        'id': 'p1', 'title': 'P', 'goal': 'G', 'category': 'work',
        'phases': [], 'tags': [], 'next_step_history': [],
        'current_phase': 0, 'created_at': '2026-01-01', 'status': 'drafting',
    }
    repo.save(p)
    assert repo.get('p1')['title'] == 'P'
    repo.delete('p1')
    from core.domain.errors import NotFoundError
    with pytest.raises(NotFoundError):
        repo.get('p1')


# ── categories ────────────────────────────────────────────
def test_seed_categories_present(db_file):
    """init_db が cat_work など5件のシステムカテゴリを作る。"""
    repo = SqliteCategoryRepository(db_file)
    ids = sorted(c['id'] for c in repo.list())
    assert 'cat_work' in ids
    assert 'cat_routine' in ids


# ── diary ─────────────────────────────────────────────────
def test_diary_save_and_unconsolidated(db_file):
    repo = SqliteDiaryRepository(db_file)
    repo.save({
        'id': 'd1', 'date': '2026-04-01',
        'body_score': 5, 'body_text': 'ok',
        'emotion_score': 3, 'emotion_text': '',
        'actions': [], 'thoughts': [{'topic': 't', 'content': 'c'}],
        'consolidated': False, 'created_at': '2026-04-01T12:00',
    })
    items = repo.list_unconsolidated(10)
    assert len(items) == 1
    repo.mark_consolidated(['d1'])
    assert len(repo.list_unconsolidated(10)) == 0
