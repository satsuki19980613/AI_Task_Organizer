"""Runtime configuration loaded from environment with safe defaults.

All values that depend on the host machine, deployment target, or external
tools live here. Domain-level constants belong in `constants.py`.
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# External tools
CLAUDE_PATH = _env('CLAUDE_PATH', r'C:\Users\sa641.SATSUKIPC\.local\bin\claude.exe')
AI_BACKEND  = _env('AI_BACKEND', 'subprocess')  # 'subprocess' | 'api' (future)

# Flask server
PORT       = _env_int('PORT', 5000)
SECRET_KEY = _env('SECRET_KEY', 'task-organizer-local-key')

# Data files
TASKS_FILE    = os.path.join(DATA_DIR, 'tasks.json')
PROJECTS_FILE = os.path.join(DATA_DIR, 'projects.json')
DB_FILE       = _env('DB_FILE', os.path.join(DATA_DIR, 'archive.db'))
STATE_FILE    = os.path.join(DATA_DIR, 'state.json')
CLAUDE_MD     = os.path.join(BASE_DIR, 'CLAUDE.md')

# Claude CLI / API
CLAUDE_TIMEOUT        = _env_int('CLAUDE_TIMEOUT', 120)
CHAT_HISTORY_LIMIT    = 20
DUMP_HISTORY_LIMIT    = 40
PROJECT_HISTORY_LIMIT = 10

# Claude model selection (CLI alias)
CLAUDE_MODEL_CHAT  = _env('CLAUDE_MODEL_CHAT', 'sonnet')
CLAUDE_MODEL_LIGHT = _env('CLAUDE_MODEL_LIGHT', 'haiku')

# Text truncation
ERROR_TEXT_LIMIT = 100
SUB_THEME_LIMIT  = 30

# Similarity search
SIMILAR_TASKS_LIMIT = 5

# Diary (BEAT)
DIARY_CONSOLIDATE_LIMIT = 60

# GTD
DRAFT_RETENTION_DAYS = 7
