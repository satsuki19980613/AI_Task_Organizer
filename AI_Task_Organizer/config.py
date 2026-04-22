import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

# External tools
CLAUDE_PATH = r'C:\Users\sa641.SATSUKIPC\.local\bin\claude.exe'

# Flask server
PORT       = 5000
SECRET_KEY = 'task-organizer-local-key'

# Data files
TASKS_FILE    = os.path.join(DATA_DIR, 'tasks.json')
PROJECTS_FILE = os.path.join(DATA_DIR, 'projects.json')
DB_FILE       = os.path.join(DATA_DIR, 'archive.db')
LOG_FILE      = os.path.join(DATA_DIR, 'task_behavior_log.jsonl')
ANALYSIS_FILE = os.path.join(DATA_DIR, 'task_analysis_report.json')
CLAUDE_MD     = os.path.join(BASE_DIR, 'CLAUDE.md')

# Claude CLI
CLAUDE_TIMEOUT        = 120  # subprocess timeout (seconds)
CHAT_HISTORY_LIMIT    = 20   # messages included in task/main chat context
DUMP_HISTORY_LIMIT    = 40   # messages included for brain-dump summarization
PROJECT_HISTORY_LIMIT = 10   # messages included for project next-step context

# Text truncation
ERROR_TEXT_LIMIT = 100  # max chars from stderr in error responses
SUB_THEME_LIMIT  = 30   # max chars for brain-dump sub_theme field

# Domain validation
VALID_CATEGORIES  = {'work', 'health', 'life', 'learning', 'social', 'admin'}
VALID_IMPORTANCE  = {'high', 'low'}
VALID_URGENCY     = {'high', 'low'}
VALID_FREQUENCIES = {'daily', 'weekly'}

# Brain-dump theme categories (ordered; 'その他' must be last)
BRAIN_DUMP_THEME_CATEGORIES = [
    '仕事・キャリア', '人間関係', '自己成長・学習',
    'アイデア・創造', '感情・メンタル', '日常・生活', '将来・目標', 'その他',
]

# Similarity search
SIMILAR_TASKS_LIMIT = 5

# Analysis scoring  (see analyze.py for formula details)
AVOIDANCE_LAMBDA              = 0.7
ENGAGEMENT_SATURATION         = 5    # denominator for engagement normalization
AVOIDANCE_SIGMOID_DIVISOR     = 3    # scaling factor for sigmoid normalization
PRIORITY_HIGH_THRESHOLD       = 0.7
PRIORITY_MED_THRESHOLD        = 0.4
HIGH_AVOIDANCE_SCORE_THRESHOLD = 0.5
HIGH_AVOIDANCE_PROGRESS_CAP    = 0.3
HIGH_AVOIDANCE_MIN_DAYS        = 5
DEADLINE_CRITICAL_DAYS         = 3
DEADLINE_CRITICAL_D_THRESHOLD  = 0.25
WEEKLY_TREND_LIMIT             = 8
