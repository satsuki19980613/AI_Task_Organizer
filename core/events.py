"""Domain events.

Services emit these when state changes. The bus dispatches them to whoever
subscribed at composition time. Subscribers live outside `core/`.

ルール:
- イベントは過去形で命名（TaskCreated, TaskMoved）。
- 実体は immutable な dataclass（frozen=True）。
- 「何が起きたか」の事実を運ぶ。命令や副作用の指示は含めない。
"""
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DomainEvent:
    """全イベントの基底。購読者は isinstance / 型ヒントで分岐する。"""


# ── Task ────────────────────────────────────────────────
@dataclass(frozen=True)
class TaskCreated(DomainEvent):
    task: dict[str, Any]


@dataclass(frozen=True)
class TaskUpdated(DomainEvent):
    task: dict[str, Any]
    changes: dict[str, Any]              # field -> new value


@dataclass(frozen=True)
class TaskMoved(DomainEvent):
    task: dict[str, Any]
    from_status: str
    to_status: str


@dataclass(frozen=True)
class TaskScheduled(DomainEvent):
    task: dict[str, Any]
    scheduled_date: str | None
    scheduled_for: str | None


@dataclass(frozen=True)
class TaskCompleted(DomainEvent):
    task: dict[str, Any]


@dataclass(frozen=True)
class TaskArchived(DomainEvent):
    task: dict[str, Any]


@dataclass(frozen=True)
class TaskDeleted(DomainEvent):
    task_id: str


# ── Project ─────────────────────────────────────────────
@dataclass(frozen=True)
class ProjectCreated(DomainEvent):
    project: dict[str, Any]


@dataclass(frozen=True)
class ProjectUpdated(DomainEvent):
    project: dict[str, Any]
    changes: dict[str, Any]


@dataclass(frozen=True)
class ProjectActivated(DomainEvent):
    project: dict[str, Any]


# ── Brain dump / Diary ──────────────────────────────────
@dataclass(frozen=True)
class BraindumpSaved(DomainEvent):
    session: dict[str, Any]


@dataclass(frozen=True)
class DiaryEntryCreated(DomainEvent):
    entry: dict[str, Any]


@dataclass(frozen=True)
class DiaryConsolidated(DomainEvent):
    entry_ids: list[str]
    session: dict[str, Any]              # the resulting BraindumpSession


# ── Habit ───────────────────────────────────────────────
@dataclass(frozen=True)
class HabitLogged(DomainEvent):
    habit_id: str
    date: str
    done: bool
