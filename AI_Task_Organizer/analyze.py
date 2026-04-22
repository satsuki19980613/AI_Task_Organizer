"""
analyze.py — タスク行動ログ分析モジュール

behavior_logs テーブル + tasks テーブルを読み込み、
タスクごとの回避スコア・期限緊急度・統合優先度スコアを算出して
task_analysis_report.json に書き出す。

優先度統合式:
  P = D + A × (1 − D) × λ
    D : 期限緊急度  (双曲型、0〜1)
    A : 回避スコア  (エンゲージメント × 未進捗 × 経過日数ベース、0〜1)
    λ : 回避感度パラメータ (config.AVOIDANCE_LAMBDA)
"""

import json
import math
import sqlite3
from datetime import date, datetime

from config import (
    DB_FILE, ANALYSIS_FILE,
    AVOIDANCE_LAMBDA, ENGAGEMENT_SATURATION, AVOIDANCE_SIGMOID_DIVISOR,
    PRIORITY_HIGH_THRESHOLD, PRIORITY_MED_THRESHOLD,
    HIGH_AVOIDANCE_SCORE_THRESHOLD, HIGH_AVOIDANCE_PROGRESS_CAP, HIGH_AVOIDANCE_MIN_DAYS,
    DEADLINE_CRITICAL_DAYS, DEADLINE_CRITICAL_D_THRESHOLD,
    WEEKLY_TREND_LIMIT,
)
from storage import load_tasks


# ── helpers ────────────────────────────────────────────────

def _load_events():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT ts, task_id, action FROM behavior_logs ORDER BY ts'
        ).fetchall()
    return [dict(r) for r in rows]


def _deadline_urgency(deadline_str: str | None, today: date) -> float:
    """期限緊急度 D (0〜1)。双曲型。期限なし → 0.1"""
    if not deadline_str:
        return 0.1
    try:
        dl = date.fromisoformat(deadline_str)
    except ValueError:
        return 0.1
    days_remaining = (dl - today).days
    return min(1.0, 1.0 / (max(days_remaining, 0) + 1))


def _avoidance_score(task_events: list, progress_rate: float, days_old: int) -> float:
    """回避スコア A (0〜1)"""
    open_count = sum(1 for e in task_events if e.get('action') == 'sidebar_open')
    chat_count = sum(1 for e in task_events if e.get('action') == 'task_chat_sent')

    raw_engagement = open_count + chat_count * 2
    engagement = 1 - math.exp(-raw_engagement / ENGAGEMENT_SATURATION)

    avoidance_raw = engagement * (1 - progress_rate) * math.log(days_old + 2)

    A = 2 / (1 + math.exp(-avoidance_raw / AVOIDANCE_SIGMOID_DIVISOR)) - 1
    return round(max(0.0, min(1.0, A)), 4)


def _iso_week(ts_str: str) -> str:
    """'2026-04-09T...' → 'W15'"""
    try:
        dt = datetime.fromisoformat(ts_str)
        return f"W{dt.isocalendar()[1]:02d}"
    except Exception:
        return 'W??'


# ── main ───────────────────────────────────────────────────

def run_analysis() -> dict:
    today     = date.today()
    today_str = today.isoformat()

    tasks  = load_tasks()
    events = _load_events()

    task_results = []

    for task in tasks:
        task_id    = task['id']
        task_evts  = [e for e in events if e.get('task_id') == task_id]

        roadmap = task.get('roadmap', [])
        if roadmap:
            progress_rate = sum(1 for r in roadmap if r.get('done')) / len(roadmap)
        else:
            progress_rate = 0.0

        created_str = task.get('created_at', today_str)
        try:
            created_date = date.fromisoformat(created_str[:10])
        except Exception:
            created_date = today
        days_old = max(0, (today - created_date).days)

        if task_evts:
            last_ts = max(e['ts'] for e in task_evts)
            try:
                last_date = date.fromisoformat(last_ts[:10])
                days_since = max(0, (today - last_date).days)
            except Exception:
                days_since = days_old
        else:
            days_since = days_old

        D = _deadline_urgency(task.get('deadline'), today)
        A = _avoidance_score(task_evts, progress_rate, days_old)
        P = round(D + A * (1 - D) * AVOIDANCE_LAMBDA, 4)

        if P >= PRIORITY_HIGH_THRESHOLD:
            suggested = 'high'
        elif P >= PRIORITY_MED_THRESHOLD:
            suggested = 'medium'
        else:
            suggested = 'low'

        flags = []
        if A > HIGH_AVOIDANCE_SCORE_THRESHOLD and progress_rate < HIGH_AVOIDANCE_PROGRESS_CAP and days_old > HIGH_AVOIDANCE_MIN_DAYS:
            flags.append('high_avoidance')
        deadline = task.get('deadline')
        if deadline:
            try:
                dl_date = date.fromisoformat(deadline)
                if (dl_date - today).days <= DEADLINE_CRITICAL_DAYS and D > DEADLINE_CRITICAL_D_THRESHOLD:
                    flags.append('deadline_critical')
            except Exception:
                pass

        open_count = sum(1 for e in task_evts if e.get('action') == 'sidebar_open')
        chat_count = sum(1 for e in task_evts if e.get('action') == 'task_chat_sent')

        task_results.append({
            'id':                    task_id,
            'title':                 task.get('title', ''),
            'category':              task.get('category', 'life'),
            'priority':              task.get('priority', 'medium'),
            'suggested_priority':    suggested,
            'deadline':              deadline,
            'created_at':            created_str,
            'progress_rate':         round(progress_rate, 3),
            'days_old':              days_old,
            'days_since_interaction': days_since,
            'open_count':            open_count,
            'chat_count':            chat_count,
            'deadline_urgency':      round(D, 4),
            'avoidance_score':       A,
            'priority_score':        P,
            'flags':                 flags,
        })

    weekly: dict[str, list[float]] = {}
    for e in events:
        week = _iso_week(e.get('ts', ''))
        tr = next((t for t in task_results if t['id'] == e.get('task_id')), None)
        if tr:
            weekly.setdefault(week, []).append(tr['avoidance_score'])

    weekly_trend = [
        {'week': w, 'avg_avoidance': round(sum(scores) / len(scores), 3)}
        for w, scores in sorted(weekly.items())[-WEEKLY_TREND_LIMIT:]
    ]

    cats = ['work', 'health', 'life', 'learning', 'social', 'admin']
    category_stats = {}
    for cat in cats:
        cat_tasks = [t for t in task_results if t['category'] == cat]
        if cat_tasks:
            avg_avoidance = round(sum(t['avoidance_score'] for t in cat_tasks) / len(cat_tasks), 3)
            avg_progress  = round(sum(t['progress_rate']   for t in cat_tasks) / len(cat_tasks), 3)
        else:
            avg_avoidance = 0.0
            avg_progress  = 0.0
        category_stats[cat] = {
            'count':        len(cat_tasks),
            'avg_avoidance': avg_avoidance,
            'avg_progress':  avg_progress,
        }

    report = {
        'generated_at':   datetime.now().isoformat(),
        'tasks':          task_results,
        'weekly_trend':   weekly_trend,
        'category_stats': category_stats,
    }

    with open(ANALYSIS_FILE, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report


if __name__ == '__main__':
    from db import init_db, migrate_from_json
    init_db()
    migrate_from_json()
    r = run_analysis()
    flagged = [t for t in r['tasks'] if t['flags']]
    print(f"分析完了  タスク数: {len(r['tasks'])} / 要注意: {len(flagged)}")
    for t in flagged:
        print(f"  [{','.join(t['flags'])}] {t['title']}  P={t['priority_score']}")
