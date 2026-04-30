"""Domain entities — the canonical shape of business objects.

These dataclasses define the contract that ports speak. Adapters convert
external representations (DB rows, JSON payloads) into entities at the
boundary so the rest of the code can rely on a single shape.

Field semantics follow `docs/GTD_DESIGN.md`. Keep these classes free of
infrastructure concerns (no sqlite, no flask, no subprocess).
"""
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class Task:
    id: str
    title: str
    gtd_status: str = 'inbox'           # see VALID_GTD_STATUS
    is_draft: bool = True
    category: Optional[str] = None       # legacy; new code uses category_id
    category_id: Optional[str] = None
    importance: Optional[str] = None     # 'high' | 'low' | None
    urgency: Optional[str] = None        # 'high' | 'low' | None
    estimate_minutes: Optional[int] = None
    deadline: Optional[str] = None       # ISO date
    scheduled_date: Optional[str] = None # ISO date
    scheduled_for: Optional[str] = None  # 'today' | 'tomorrow' | None
    waiting_for: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    roadmap: list[dict[str, Any]] = field(default_factory=list)
    checklist: list[dict[str, Any]] = field(default_factory=list)
    notes: str = ''
    project_id: Optional[str] = None
    project_sort_order: Optional[int] = None
    phase_id: Optional[str] = None
    completed: bool = False
    completed_at: Optional[str] = None
    created_at: str = ''
    is_two_minute: bool = False          # GTD v1 legacy


@dataclass
class Project:
    id: str
    title: str
    goal: str = ''
    category: str = 'life'
    status: str = 'drafting'             # see VALID_PROJECT_STATUS
    deadline: Optional[str] = None
    completion_condition: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    phases: list[dict[str, Any]] = field(default_factory=list)
    current_phase: int = 0
    next_step_history: list[dict[str, Any]] = field(default_factory=list)
    archived: bool = False
    completed_at: Optional[str] = None
    created_at: str = ''


@dataclass
class Category:
    id: str
    name: str
    parent_id: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_system: bool = False
    sort_order: int = 0
    created_at: Optional[str] = None


@dataclass
class Habit:
    id: str
    title: str
    category: str = 'life'
    frequency: str = 'daily'             # 'daily' | 'weekly'
    weekday: Optional[int] = None        # 0=Mon..6=Sun
    tags: list[str] = field(default_factory=list)
    notes: str = ''
    color: str = ''
    active: bool = True
    created_at: str = ''


@dataclass
class DiaryEntry:
    id: str
    date: str                            # ISO date
    body_score: int = 0
    body_text: str = ''
    emotion_score: int = 0
    emotion_text: str = ''
    actions: list[dict[str, Any]] = field(default_factory=list)
    thoughts: list[dict[str, Any]] = field(default_factory=list)
    consolidated: bool = False
    created_at: str = ''


@dataclass
class BraindumpSession:
    id: str
    title: str
    summary: str = ''
    theme_category: str = 'その他'
    sub_theme: str = ''
    source: str = 'chat'
    date: str = ''                       # ISO date
    raw_messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = ''


@dataclass
class WeeklyReview:
    id: str
    completed_at: str
    week_start: str
    week_end: str
    drafts_processed: int = 0
    someday_promoted: int = 0
    trash_deleted: int = 0
    waiting_resolved: int = 0
    next_actions_completed: int = 0
    notes: str = ''
