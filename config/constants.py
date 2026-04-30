"""Immutable domain constants.

These are part of the domain contract — changing them changes business
behavior. Runtime / deployment values belong in `settings.py`.
"""

# Domain validation
VALID_CATEGORIES  = {'work', 'health', 'life', 'learning', 'social', 'admin'}
VALID_IMPORTANCE  = {'high', 'low'}
VALID_URGENCY     = {'high', 'low'}
VALID_FREQUENCIES = {'daily', 'weekly'}
VALID_WEEKDAYS    = {0, 1, 2, 3, 4, 5, 6}  # 0=月 〜 6=日 (Python date.weekday())

# Brain-dump theme categories (ordered; 'その他' must be last)
BRAIN_DUMP_THEME_CATEGORIES = [
    '仕事・キャリア', '人間関係', '自己成長・学習',
    'アイデア・創造', '感情・メンタル', '日常・生活', '将来・目標', 'その他',
]

# Diary (BEAT) score range
DIARY_SCORE_MIN = -10
DIARY_SCORE_MAX =  10

# GTD v2
VALID_GTD_STATUS = {
    'inbox', 'next_action', 'waiting', 'calendar',
    'someday', 'project_pending', 'trash', 'done',
}

VALID_PROJECT_STATUS = {'drafting', 'active', 'completed', 'archived'}

MOVE_REQUIRED_FIELDS = {
    'calendar': [('scheduled_date', 'カレンダーに入れるには日付を設定してください')],
}

MOVE_FORBIDDEN_TRANSITIONS = {
    'someday': {'when': 'has_deadline', 'message': '期限を解除してから移動してください'},
}

VALID_ROLLOVER_TIMING = {'morning', 'evening'}
