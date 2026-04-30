"""DI コンポジションルート — 具体実装の選択を一箇所に集約する。

このファイルだけが「どの AIEngine を使うか」「どの DB を使うか」を知っている。
他のすべてのコードは Protocol 越しに依存する。

レシピ（ARCHITECTURE.md §2 B）:
- 新しい AI バックエンドを追加する時 → ここの `_build_ai_engine` を編集する
- 新しい通知チャネルを追加する時 → ここで `event_bus.subscribe(...)` を1行追加する
- それ以外は core/ や routes/ の編集で完結する
"""
from __future__ import annotations

import os

from config import (
    DB_FILE, STATE_FILE, CLAUDE_PATH, CLAUDE_TIMEOUT,
    CLAUDE_MODEL_CHAT, CLAUDE_MODEL_LIGHT, AI_BACKEND, CLAUDE_MD,
)
from infrastructure.clock import SystemClock
from infrastructure.eventing.in_memory_bus import InMemoryEventBus
from infrastructure.ai.subprocess_engine import SubprocessAIEngine
from infrastructure.persistence.sqlite.task_repo import SqliteTaskRepository
from infrastructure.persistence.sqlite.project_repo import SqliteProjectRepository
from infrastructure.persistence.sqlite.category_repo import SqliteCategoryRepository
from infrastructure.persistence.sqlite.habit_repo import SqliteHabitRepository
from infrastructure.persistence.sqlite.diary_repo import SqliteDiaryRepository
from infrastructure.persistence.sqlite.braindump_repo import SqliteBraindumpRepository
from infrastructure.persistence.sqlite.weekly_review_repo import SqliteWeeklyReviewRepository
from infrastructure.persistence.sqlite.state_repo import JsonStateRepository
from infrastructure.persistence.sqlite.daily_log_repo import SqliteDailyLogRepository

from core.services.task_service import TaskService
from core.services.project_service import ProjectService
from core.services.category_service import CategoryService
from core.services.habit_service import HabitService
from core.services.diary_service import DiaryService
from core.services.braindump_service import BraindumpService
from core.services.chat_service import ChatService


def _load_system_prompt() -> str:
    if os.path.exists(CLAUDE_MD):
        with open(CLAUDE_MD, 'r', encoding='utf-8') as f:
            return f.read()
    return ''


def _build_ai_engine():
    """AI_BACKEND 環境変数に応じて AIEngine 実装を選ぶ。"""
    if AI_BACKEND == 'subprocess':
        return SubprocessAIEngine(claude_path=CLAUDE_PATH, timeout=CLAUDE_TIMEOUT)
    # 'api' バックエンドはまだ未実装。Step 1 計画通り、追加時はここに分岐を増やす。
    raise NotImplementedError(f'AI_BACKEND={AI_BACKEND!r} is not supported yet')


class Container:
    """すべての依存を保持する。Flask app 起動時に1回作る。"""

    def __init__(self):
        # adapters
        self.clock = SystemClock()
        self.event_bus = InMemoryEventBus()
        self.ai_engine = _build_ai_engine()

        self.task_repo = SqliteTaskRepository(DB_FILE)
        self.project_repo = SqliteProjectRepository(DB_FILE)
        self.category_repo = SqliteCategoryRepository(DB_FILE)
        self.habit_repo = SqliteHabitRepository(DB_FILE)
        self.diary_repo = SqliteDiaryRepository(DB_FILE)
        self.braindump_repo = SqliteBraindumpRepository(DB_FILE)
        self.weekly_review_repo = SqliteWeeklyReviewRepository(DB_FILE)
        self.state_repo = JsonStateRepository(STATE_FILE)
        self.daily_log_repo = SqliteDailyLogRepository(DB_FILE)

        # services
        self.task_service = TaskService(
            task_repo=self.task_repo,
            habit_repo=self.habit_repo,
            category_repo=self.category_repo,
            weekly_review_repo=self.weekly_review_repo,
            state_repo=self.state_repo,
            daily_log_repo=self.daily_log_repo,
            event_bus=self.event_bus,
            clock=self.clock,
        )
        self.project_service = ProjectService(
            project_repo=self.project_repo,
            task_repo=self.task_repo,
            event_bus=self.event_bus,
            clock=self.clock,
        )
        self.category_service = CategoryService(
            category_repo=self.category_repo,
            task_repo=self.task_repo,
            clock=self.clock,
        )
        self.habit_service = HabitService(
            habit_repo=self.habit_repo,
            event_bus=self.event_bus,
            clock=self.clock,
        )
        self.diary_service = DiaryService(
            diary_repo=self.diary_repo,
            braindump_repo=self.braindump_repo,
            ai_engine=self.ai_engine,
            event_bus=self.event_bus,
            clock=self.clock,
            model_light=CLAUDE_MODEL_LIGHT,
        )
        self.braindump_service = BraindumpService(
            braindump_repo=self.braindump_repo,
            ai_engine=self.ai_engine,
            event_bus=self.event_bus,
            clock=self.clock,
            model_light=CLAUDE_MODEL_LIGHT,
        )
        self.chat_service = ChatService(
            task_repo=self.task_repo,
            project_repo=self.project_repo,
            category_repo=self.category_repo,
            ai_engine=self.ai_engine,
            system_prompt_loader=_load_system_prompt,
            model_chat=CLAUDE_MODEL_CHAT,
        )

        # ── 購読者の登録 ──────────────────────────────
        # 現時点では何も購読しない（コアは将来の拡張を意識しない）。
        # 通知/位置情報サービスを後付けする時は、ここに subscribe を増やすだけ。
