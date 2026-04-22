import os
import re
import json
import time
import sqlite3
import subprocess
from datetime import date, timedelta
from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_socketio import SocketIO

from config import (
    BASE_DIR, DATA_DIR, SECRET_KEY, PORT,
    CLAUDE_PATH, CLAUDE_TIMEOUT,
    CHAT_HISTORY_LIMIT, DUMP_HISTORY_LIMIT, PROJECT_HISTORY_LIMIT,
    ERROR_TEXT_LIMIT, SUB_THEME_LIMIT,
    VALID_CATEGORIES, VALID_FREQUENCIES, BRAIN_DUMP_THEME_CATEGORIES,
    SIMILAR_TASKS_LIMIT, DB_FILE, ANALYSIS_FILE,
)
from db import init_db, migrate_from_json, row_to_task, row_to_habit, calculate_habit_stats
from storage import load_tasks, save_tasks, load_projects, save_projects, load_system_prompt

os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__)
app.config['SECRET_KEY'] = SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

init_db()
migrate_from_json()

# ── Task API ───────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/sw.js')
def serve_sw():
    return send_from_directory(os.path.join(BASE_DIR, 'static'), 'sw.js',
                               mimetype='application/javascript')

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    return jsonify(load_tasks())

@app.route('/api/tasks', methods=['POST'])
def create_task():
    task = request.get_json()
    tasks = load_tasks()
    task['id'] = str(int(time.time() * 1000))
    task['created_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    task.setdefault('completed', False)
    task.setdefault('roadmap', [])
    task.setdefault('checklist', [])
    task.setdefault('tags', [])
    task.setdefault('notes', '')
    task.setdefault('deadline', None)
    task.setdefault('importance', 'high')
    task.setdefault('urgency', 'high')
    tasks.append(task)
    save_tasks(tasks)
    proj_id_ref  = task.get('project_id')
    phase_id_ref = task.get('phase_id')
    if proj_id_ref and phase_id_ref:
        projects = load_projects()
        for pi, proj in enumerate(projects):
            if proj['id'] == proj_id_ref:
                for pj, ph in enumerate(projects[pi].get('phases', [])):
                    if ph['id'] == phase_id_ref:
                        projects[pi]['phases'][pj]['current_task_id'] = task['id']
                        break
                save_projects(projects)
                break
    return jsonify(task), 201

@app.route('/api/tasks/<task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.get_json()
    tasks = load_tasks()
    for i, t in enumerate(tasks):
        if t['id'] == task_id:
            tasks[i].update(data)
            save_tasks(tasks)
            return jsonify(tasks[i])
    return jsonify({'error': 'not found'}), 404

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    tasks = load_tasks()
    save_tasks([t for t in tasks if t['id'] != task_id])
    return jsonify({'ok': True})

# ── Archive API ───────────────────────────────────────────

@app.route('/api/tasks/<task_id>/archive', methods=['POST'])
def archive_task_route(task_id):
    tasks = load_tasks()
    task  = next((t for t in tasks if t['id'] == task_id), None)
    if not task:
        return jsonify({'error': 'not found'}), 404
    archived_at = time.strftime('%Y-%m-%dT%H:%M:%S')
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            'INSERT OR REPLACE INTO archived_tasks '
            '(id, title, importance, urgency, category, tags, roadmap, checklist, notes, archived_at, deadline) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (task['id'], task['title'],
             task.get('importance', 'high'), task.get('urgency', 'high'),
             task.get('category', 'life'),
             json.dumps(task.get('tags', []), ensure_ascii=False),
             json.dumps(task.get('roadmap', []), ensure_ascii=False),
             json.dumps(task.get('checklist', []), ensure_ascii=False),
             task.get('notes', ''), archived_at,
             task.get('deadline', None))
        )
        conn.commit()
    save_tasks([t for t in tasks if t['id'] != task_id])
    return jsonify({'ok': True, 'archived_at': archived_at})

@app.route('/api/archive', methods=['GET'])
def get_archive():
    q        = request.args.get('q', '').strip()
    category = request.args.get('category', '')
    sort     = request.args.get('sort', 'newest')

    sql, params = 'SELECT * FROM archived_tasks WHERE 1=1', []
    if q:        sql += ' AND title LIKE ?';  params.append(f'%{q}%')
    if category: sql += ' AND category = ?'; params.append(category)

    order = {
        'newest': 'archived_at DESC',
        'oldest': 'archived_at ASC',
        'title':  'title ASC',
    }.get(sort, 'archived_at DESC')
    sql += f' ORDER BY {order}'

    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
    return jsonify([row_to_task(r) for r in rows])

@app.route('/api/archive/<task_id>', methods=['DELETE'])
def delete_archived(task_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DELETE FROM archived_tasks WHERE id = ?', (task_id,))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/archive/<task_id>/restore', methods=['POST'])
def restore_archived(task_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            'SELECT * FROM archived_tasks WHERE id = ?', (task_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        task = row_to_task(row)
        conn.execute('DELETE FROM archived_tasks WHERE id = ?', (task_id,))
        conn.commit()
    restored = {
        'id':         task['id'],
        'title':      task['title'],
        'importance': task['importance'],
        'urgency':    task['urgency'],
        'category':   task['category'],
        'tags':       task['tags'],
        'roadmap':    task['roadmap'],
        'checklist':  task['checklist'],
        'notes':      task['notes'],
        'completed':  False,
        'deadline':   task.get('deadline'),
    }
    tasks = load_tasks()
    tasks.append(restored)
    save_tasks(tasks)
    return jsonify(restored)

# ── Similar Tasks API ─────────────────────────────────────

@app.route('/api/tasks/<task_id>/similar', methods=['GET'])
def get_similar_tasks(task_id):
    tasks = load_tasks()
    task  = next((t for t in tasks if t['id'] == task_id), None)
    if not task:
        return jsonify({'error': 'not found'}), 404

    category   = task.get('category', '')
    task_tags  = set(task.get('tags', []))
    task_words = set(task.get('title', '').split())

    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT * FROM archived_tasks ORDER BY archived_at DESC'
        ).fetchall()

    results = []
    for row in rows:
        a = row_to_task(row)
        score = 0
        if a.get('category') == category:
            score += 3
        archived_tags = set(a.get('tags', []))
        score += len(task_tags & archived_tags) * 2
        archived_words = set(a.get('title', '').split())
        score += len(task_words & archived_words)
        if score > 0:
            results.append((score, a))

    results.sort(key=lambda x: x[0], reverse=True)
    return jsonify([a for _, a in results[:SIMILAR_TASKS_LIMIT]])

# ── Brain Dump API ────────────────────────────────────────

@app.route('/api/braindump/save', methods=['POST'])
def save_braindump():
    data     = request.get_json()
    messages = data.get('messages', [])
    if not messages:
        return jsonify({'error': 'no messages'}), 400

    conv_text = '\n'.join(
        f"{'ユーザー' if m['role'] == 'user' else 'AI'}: {m['content']}"
        for m in messages[-DUMP_HISTORY_LIMIT:]
    )
    cats_str = ' / '.join(BRAIN_DUMP_THEME_CATEGORIES)
    prompt = (
        "以下の会話を読んで、JSONのみを返してください（前後の説明文は不要）。\n\n"
        f"会話:\n{conv_text}\n\n"
        "返すJSON形式:\n"
        '{"title": "会話のテーマを10〜20字で", '
        '"summary": "会話の要点を3〜5文で", '
        f'"theme_category": "次のうち最も近い1つ（未分類は使用禁止）: {cats_str}", '
        '"sub_theme": "theme_categoryの中のより具体的なサブテーマを7〜15字で（例: キャリア設計・業務改善・不安と焦り）。未分類・その他などの曖昧な語は禁止"}'
    )

    title          = '頭の整理メモ'
    summary        = ''
    theme_category = 'その他'
    sub_theme      = ''
    try:
        result = subprocess.run(
            [CLAUDE_PATH, '--print', '-p', prompt],
            capture_output=True, text=True, encoding='utf-8',
            timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        output = result.stdout.strip()
        json_match = re.search(r'\{.*\}', output, re.DOTALL)
        if json_match:
            parsed         = json.loads(json_match.group())
            title          = parsed.get('title', title)
            summary        = parsed.get('summary', output)
            cat            = parsed.get('theme_category', 'その他')
            theme_category = cat if cat in BRAIN_DUMP_THEME_CATEGORIES else 'その他'
            sub_theme      = parsed.get('sub_theme', '')[:SUB_THEME_LIMIT]
        else:
            summary = output or '要約を生成できませんでした。'
    except Exception:
        summary = '要約を生成できませんでした。'

    session_id = str(int(time.time() * 1000))
    created_at = time.strftime('%Y-%m-%dT%H:%M:%S')
    date_str   = time.strftime('%Y-%m-%d')

    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            'INSERT INTO brain_dump_sessions '
            '(id, title, summary, theme_category, sub_theme, date, raw_messages, created_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (session_id, title, summary, theme_category, sub_theme, date_str,
             json.dumps(messages, ensure_ascii=False), created_at)
        )
        conn.commit()

    return jsonify({'ok': True, 'id': session_id, 'title': title, 'summary': summary})

@app.route('/api/braindump', methods=['GET'])
def get_braindump():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT * FROM brain_dump_sessions ORDER BY created_at DESC'
        ).fetchall()
    sessions = []
    for row in rows:
        s = dict(row)
        try:
            s['raw_messages'] = json.loads(s.get('raw_messages', '[]'))
        except Exception:
            s['raw_messages'] = []
        sessions.append(s)
    return jsonify(sessions)

@app.route('/api/braindump/<session_id>', methods=['DELETE'])
def delete_braindump(session_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DELETE FROM brain_dump_sessions WHERE id = ?', (session_id,))
        conn.commit()
    return jsonify({'ok': True})

# ── Behavior Log API ──────────────────────────────────────

@app.route('/api/log', methods=['POST'])
def log_event():
    data    = request.get_json()
    task_id = data.get('task_id', '')
    action  = data.get('action', '')
    if not action:
        return jsonify({'error': 'missing action'}), 400
    ts = time.strftime('%Y-%m-%dT%H:%M:%S')
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            'INSERT INTO behavior_logs (ts, task_id, action) VALUES (?, ?, ?)',
            (ts, task_id, action)
        )
        conn.commit()
    return jsonify({'ok': True})

# ── Report API ────────────────────────────────────────────

@app.route('/api/report', methods=['GET'])
def get_report():
    from analyze import run_analysis
    return jsonify(run_analysis())

@app.route('/api/analyze/ai', methods=['POST'])
def analyze_ai():
    if not os.path.exists(ANALYSIS_FILE):
        return jsonify({'error': 'no report yet'}), 404
    with open(ANALYSIS_FILE, 'r', encoding='utf-8') as f:
        report = json.load(f)

    tasks   = report.get('tasks', [])
    flagged = [t for t in tasks if t.get('flags')]
    flagged_lines = '\n'.join(
        f"- {t['title']} (回避スコア: {t['avoidance_score']:.2f}, 進捗: {int(t['progress_rate']*100)}%)"
        for t in flagged[:5]
    ) or '  なし'
    cat_lines = '\n'.join(
        f"- {cat}: {s['count']}件, 平均回避スコア {s['avg_avoidance']:.2f}"
        for cat, s in report.get('category_stats', {}).items()
        if s['count'] > 0
    ) or '  なし'

    prompt = (
        f"以下はタスク管理アプリの分析レポートです。日本語で簡潔なコメントをください。\n\n"
        f"タスク数: {len(tasks)}\n要注意タスク: {len(flagged)}件\n\n"
        f"要注意タスク詳細:\n{flagged_lines}\n\n"
        f"カテゴリー別統計:\n{cat_lines}\n\n"
        f"全体的な傾向と3つの具体的なアドバイスを述べてください。"
    )
    try:
        result = subprocess.run(
            [CLAUDE_PATH, '--print', '-p', prompt],
            capture_output=True, text=True, encoding='utf-8',
            timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        response_text = result.stdout.strip() or '分析コメントを生成できませんでした。'
    except subprocess.TimeoutExpired:
        response_text = '申し訳ありません。少し時間がかかっています。もう一度お試しください。'
    except Exception as e:
        response_text = f'エラーが発生しました: {str(e)}'

    return jsonify({'response': response_text})

# ── Chat API ───────────────────────────────────────────────

@app.route('/api/chat', methods=['POST'])
def api_chat():
    data     = request.get_json()
    messages = data.get('messages', [])
    mode     = data.get('mode', 'task')
    system   = load_system_prompt()

    if mode == 'dump':
        system = (
            "あなたは穏やかで共感力のある思考整理パートナーです。"
            "ユーザーが頭の中にあることを自由に言語化し、整理するのを手伝います。\n"
            "## ルール\n"
            "- タスクの作成は絶対に行わないこと。[[TASK:...]] は出力しないこと\n"
            "- 質問は一度に一つだけ\n"
            "- 日本語で話してください\n"
            "- ユーザーが感情的・ストレスを感じている場合はまず共感を示すこと\n"
            "- 話を整理する手助けをするが、答えを押しつけないこと\n"
            "- 短く、温かみのある返答を心がけること"
        )

    prompt_parts = [system, '\n\n--- 会話 ---\n']
    for msg in messages[-CHAT_HISTORY_LIMIT:]:
        role = 'ユーザー' if msg['role'] == 'user' else 'アシスタント'
        prompt_parts.append(f'\n{role}: {msg["content"]}')
    prompt_parts.append('\nアシスタント:')
    prompt = ''.join(prompt_parts)

    try:
        result = subprocess.run(
            [CLAUDE_PATH, '--print', '-p', prompt],
            capture_output=True, text=True, encoding='utf-8',
            timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        response_text = result.stdout.strip()
        if not response_text:
            err = result.stderr.strip()
            response_text = f'申し訳ありません、応答を取得できませんでした。({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
    except subprocess.TimeoutExpired:
        response_text = '申し訳ありません。少し時間がかかっています。もう一度お試しください。'
    except Exception as e:
        response_text = f'エラーが発生しました: {str(e)}'

    task_proposals = []
    pattern = r'\[\[TASK:(.*?)\]\]'
    for match_str in re.findall(pattern, response_text, re.DOTALL):
        try:
            tp = json.loads(match_str)
            if tp.get('category') not in VALID_CATEGORIES:
                tp['category'] = 'life'
            if tp.get('importance') not in ('high', 'low'):
                tp['importance'] = 'high'
            if tp.get('urgency') not in ('high', 'low'):
                tp['urgency'] = 'high'
            tp.setdefault('tags', [])
            tp.setdefault('checklist', [])
            task_proposals.append(tp)
        except json.JSONDecodeError:
            pass
    if task_proposals:
        response_text = re.sub(pattern, '', response_text, flags=re.DOTALL).strip()

    project_proposals = []
    proj_pattern = r'\[\[PROJECT:(.*?)\]\]'
    for match_str in re.findall(proj_pattern, response_text, re.DOTALL):
        try:
            pp = json.loads(match_str)
            if pp.get('category') not in VALID_CATEGORIES:
                pp['category'] = 'life'
            pp.setdefault('tags', [])
            pp.setdefault('phases', [])
            project_proposals.append(pp)
        except json.JSONDecodeError:
            pass
    if project_proposals:
        response_text = re.sub(proj_pattern, '', response_text, flags=re.DOTALL).strip()

    habit_proposals = []
    habit_pattern = r'\[\[HABIT:(.*?)\]\]'
    for match_str in re.findall(habit_pattern, response_text, re.DOTALL):
        try:
            hp = json.loads(match_str)
            if hp.get('category') not in VALID_CATEGORIES:
                hp['category'] = 'life'
            if hp.get('frequency') not in VALID_FREQUENCIES:
                hp['frequency'] = 'daily'
            hp.setdefault('tags', [])
            hp.setdefault('notes', '')
            habit_proposals.append(hp)
        except json.JSONDecodeError:
            pass
    if habit_proposals:
        response_text = re.sub(habit_pattern, '', response_text, flags=re.DOTALL).strip()

    return jsonify({'response': response_text, 'task_proposals': task_proposals, 'project_proposals': project_proposals, 'habit_proposals': habit_proposals})

# ── Project API ───────────────────────────────────────────

@app.route('/api/projects', methods=['GET'])
def get_projects():
    return jsonify(load_projects())

@app.route('/api/projects', methods=['POST'])
def create_project():
    data     = request.get_json()
    projects = load_projects()
    base_ts  = int(time.time() * 1000)
    phases   = [
        {'id': str(base_ts + i), 'text': p['text'], 'done': False, 'notes': '', 'current_task_id': None}
        for i, p in enumerate(data.get('phases', []))
    ]
    project = {
        'id':                'proj_' + str(base_ts),
        'title':             data.get('title', ''),
        'goal':              data.get('goal', ''),
        'category':          data.get('category', 'life'),
        'deadline':          data.get('deadline', None),
        'phases':            phases,
        'tags':              data.get('tags', []),
        'current_phase':     0,
        'created_at':        time.strftime('%Y-%m-%dT%H:%M:%S'),
        'next_step_history': [],
    }
    projects.append(project)
    save_projects(projects)
    return jsonify(project), 201

@app.route('/api/projects/<project_id>', methods=['PUT'])
def update_project(project_id):
    data     = request.get_json()
    projects = load_projects()
    for i, p in enumerate(projects):
        if p['id'] == project_id:
            projects[i].update(data)
            save_projects(projects)
            return jsonify(projects[i])
    return jsonify({'error': 'not found'}), 404

@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    projects = load_projects()
    save_projects([p for p in projects if p['id'] != project_id])
    tasks = load_tasks()
    save_tasks([t for t in tasks if t.get('project_id') != project_id])
    return jsonify({'ok': True})

@app.route('/api/projects/<project_id>/next-step', methods=['POST'])
def project_next_step(project_id):
    projects = load_projects()
    project  = next((p for p in projects if p['id'] == project_id), None)
    if not project:
        return jsonify({'error': 'not found'}), 404

    data     = request.get_json()
    messages = data.get('messages', [])
    system   = load_system_prompt()

    phases = project.get('phases', [])
    phases_lines = '\n'.join(
        f"  {'[完了]' if ph.get('done') else '[進行中]' if (not ph.get('done') and all(p.get('done') for p in phases[:i])) else '[ ]'} {ph['text']}"
        for i, ph in enumerate(phases)
    ) or '  (なし)'

    history = project.get('next_step_history', [])
    history_lines = ''
    if history:
        history_lines = '\n直近の取り組みメモ:\n' + '\n'.join(
            f"  - {h.get('step', '')}" for h in history[-3:]
        )

    project_context = (
        f"\n\n--- 現在対象のプロジェクト ---\n"
        f"タイトル: {project['title']}\n"
        f"ゴール: {project.get('goal', '')}\n"
        f"カテゴリー: {project.get('category', 'life')}\n"
        f"期限: {project.get('deadline') or 'なし'}\n"
        f"フェーズ:\n{phases_lines}\n"
        f"{history_lines}\n"
        f"---\n"
        f"ユーザーが今日取り組めるスモールステップ（15〜30分で完了できる具体的な行動）を1つ提案してください。\n"
        f"まず現在の状況を確認する質問を1つしてから提案してください。\n"
        f"[[TASK:...]] や [[PROJECT:...]] は絶対に出力しないこと。\n"
    )

    prompt_parts = [system, project_context, '\n\n--- 会話 ---\n']
    for msg in messages[-PROJECT_HISTORY_LIMIT:]:
        role = 'ユーザー' if msg['role'] == 'user' else 'アシスタント'
        prompt_parts.append(f'\n{role}: {msg["content"]}')
    prompt_parts.append('\nアシスタント:')
    prompt = ''.join(prompt_parts)

    try:
        result = subprocess.run(
            [CLAUDE_PATH, '--print', '-p', prompt],
            capture_output=True, text=True, encoding='utf-8',
            timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        response_text = result.stdout.strip()
        if not response_text:
            err = result.stderr.strip()
            response_text = f'申し訳ありません、応答を取得できませんでした。({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
    except subprocess.TimeoutExpired:
        response_text = '申し訳ありません。少し時間がかかっています。もう一度お試しください。'
    except Exception as e:
        response_text = f'エラーが発生しました: {str(e)}'

    return jsonify({'response': response_text})

# ── Phase Chat API ────────────────────────────────────────

@app.route('/api/projects/<proj_id>/phases/<phase_id>/chat', methods=['POST'])
def phase_chat(proj_id, phase_id):
    projects = load_projects()
    proj     = next((p for p in projects if p['id'] == proj_id), None)
    if not proj:
        return jsonify({'error': 'project not found'}), 404
    phase = next((ph for ph in proj.get('phases', []) if ph['id'] == phase_id), None)
    if not phase:
        return jsonify({'error': 'phase not found'}), 404

    data     = request.get_json()
    messages = data.get('messages', [])
    system   = load_system_prompt()

    current_task_info = ''
    if phase.get('current_task_id'):
        tasks = load_tasks()
        ct = next((t for t in tasks if t['id'] == phase['current_task_id']), None)
        if ct:
            done_s  = sum(1 for r in ct.get('roadmap', []) if r.get('done'))
            total_s = len(ct.get('roadmap', []))
            current_task_info = (
                f"\n現在取り組み中のタスク: {ct['title']}\n"
                f"進捗: {done_s}/{total_s} ステップ"
                + (' (完了済み)\n' if ct.get('completed') else '\n')
            )

    phase_context = (
        f"\n\n--- プロジェクト・フェーズ情報 ---\n"
        f"プロジェクト: {proj['title']}\n"
        f"ゴール: {proj.get('goal', '')}\n"
        f"現在のフェーズ: {phase['text']}\n"
        f"全体期限: {proj.get('deadline') or 'なし'}\n"
        f"{current_task_info}"
        f"---\n"
        f"このフェーズの目標達成に向けて、今すぐ取り組める具体的なタスクを1つ提案してください。\n"
        f"タスクは15〜60分で完了できる粒度にしてください。\n"
        f"確認後は [[TASK:...]] 形式で出力すること（[[PROJECT:...]] は出力禁止）。\n"
        f"category は '{proj.get('category', 'life')}' を使うこと。\n"
    )

    prompt_parts = [system, phase_context, '\n\n--- 会話 ---\n']
    for msg in messages[-CHAT_HISTORY_LIMIT:]:
        role = 'ユーザー' if msg['role'] == 'user' else 'アシスタント'
        prompt_parts.append(f'\n{role}: {msg["content"]}')
    prompt_parts.append('\nアシスタント:')
    prompt = ''.join(prompt_parts)

    try:
        result = subprocess.run(
            [CLAUDE_PATH, '--print', '-p', prompt],
            capture_output=True, text=True, encoding='utf-8',
            timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        response_text = result.stdout.strip()
        if not response_text:
            err = result.stderr.strip()
            response_text = f'応答を取得できませんでした。({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
    except subprocess.TimeoutExpired:
        response_text = '少し時間がかかっています。もう一度お試しください。'
    except Exception as e:
        response_text = f'エラーが発生しました: {str(e)}'

    task_proposals = []
    pattern = r'\[\[TASK:(.*?)\]\]'
    for match_str in re.findall(pattern, response_text, re.DOTALL):
        try:
            tp = json.loads(match_str)
            if tp.get('category') not in VALID_CATEGORIES:
                tp['category'] = proj.get('category', 'life')
            if tp.get('importance') not in ('high', 'low'):
                tp['importance'] = 'high'
            if tp.get('urgency') not in ('high', 'low'):
                tp['urgency'] = 'high'
            tp.setdefault('tags', [])
            tp.setdefault('checklist', [])
            tp['project_id'] = proj_id
            tp['phase_id']   = phase_id
            task_proposals.append(tp)
        except json.JSONDecodeError:
            pass
    if task_proposals:
        response_text = re.sub(pattern, '', response_text, flags=re.DOTALL).strip()

    return jsonify({'response': response_text, 'task_proposals': task_proposals})

# ── Task Chat API ─────────────────────────────────────────

@app.route('/api/tasks/<task_id>/chat', methods=['POST'])
def task_chat(task_id):
    tasks = load_tasks()
    task  = next((t for t in tasks if t['id'] == task_id), None)
    if not task:
        return jsonify({'error': 'not found'}), 404

    data     = request.get_json()
    messages = data.get('messages', [])
    system   = load_system_prompt()

    roadmap_lines = '\n'.join(
        f"  {'[完了]' if r.get('done') else '[ ]'} {r['text']}"
        for r in task.get('roadmap', [])
    ) or '  (なし)'

    checklist_lines = '\n'.join(
        f"  {'[✓]' if c.get('done') else '[ ]'} {c['text']}"
        for c in task.get('checklist', [])
    ) or '  (なし)'

    importance_label = '高' if task.get('importance') == 'high' else '低'
    urgency_label    = '高' if task.get('urgency') == 'high' else '低'

    task_context = (
        f"\n\n--- 現在対象のタスク ---\n"
        f"タイトル: {task['title']}\n"
        f"重要度: {importance_label} / 緊急度: {urgency_label}\n"
        f"カテゴリー: {task.get('category', 'life')}\n"
        f"タグ: {', '.join(task.get('tags', [])) or 'なし'}\n"
        f"ロードマップ（インデックスは0始まり）:\n{roadmap_lines}\n"
        f"チェックリスト（準備物）:\n{checklist_lines}\n"
        f"メモ: {task.get('notes', '') or '(なし)'}\n"
        f"---\n"
        f"ユーザーがこのタスクについて質問しています。"
        f"タスクの内容を踏まえて、具体的で実用的なアドバイスを簡潔に伝えてください。"
        f"タスク作成フローは不要です。[[TASK:...]] は出力しないこと。\n"
        f"ステップの内容を変更・改善する場合は、通常の返答に加えて末尾に "
        f"[[UPDATE_STEP:{{\"index\": 0, \"text\": \"新しいテキスト\"}}]] の形式で出力してください（インデックスは0始まり）。"
        f"複数ステップを変更する場合は複数行に並べてください。\n"
    )

    prompt_parts = [system, task_context, '\n\n--- 会話 ---\n']
    for msg in messages[-CHAT_HISTORY_LIMIT:]:
        role = 'ユーザー' if msg['role'] == 'user' else 'アシスタント'
        prompt_parts.append(f'\n{role}: {msg["content"]}')
    prompt_parts.append('\nアシスタント:')
    prompt = ''.join(prompt_parts)

    try:
        result = subprocess.run(
            [CLAUDE_PATH, '--print', '-p', prompt],
            capture_output=True, text=True, encoding='utf-8',
            timeout=CLAUDE_TIMEOUT, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        response_text = result.stdout.strip()
        if not response_text:
            err = result.stderr.strip()
            response_text = f'申し訳ありません、応答を取得できませんでした。({err[:ERROR_TEXT_LIMIT] if err else "timeout"})'
    except subprocess.TimeoutExpired:
        response_text = '申し訳ありません。少し時間がかかっています。もう一度お試しください。'
    except Exception as e:
        response_text = f'エラーが発生しました: {str(e)}'

    step_updates = []
    update_pattern = re.compile(r'\[\[UPDATE_STEP:(\{.*?\})\]\]', re.DOTALL)
    matches = update_pattern.findall(response_text)
    if matches:
        tasks = load_tasks()
        task_obj = next((t for t in tasks if t['id'] == task_id), None)
        if task_obj:
            roadmap = task_obj.get('roadmap', [])
            for match in matches:
                try:
                    upd = json.loads(match)
                    idx  = int(upd.get('index', -1))
                    text = upd.get('text', '').strip()
                    if 0 <= idx < len(roadmap) and text:
                        old_text = roadmap[idx]['text']
                        roadmap[idx] = {**roadmap[idx], 'text': text}
                        step_updates.append({'index': idx, 'old': old_text, 'new': text})
                except (json.JSONDecodeError, ValueError, KeyError):
                    pass
            if step_updates:
                task_obj['roadmap'] = roadmap
                save_tasks(tasks)
        response_text = update_pattern.sub('', response_text).strip()

    return jsonify({'response': response_text, 'step_updates': step_updates})

# ── Habit API ─────────────────────────────────────────────

@app.route('/api/habits', methods=['GET'])
def get_habits():
    today      = date.today()
    today_str  = today.isoformat()
    weekday    = today.weekday()  # 0=月
    monday     = today - timedelta(days=weekday)
    week_dates = [(monday + timedelta(days=i)).isoformat() for i in range(5)]

    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT * FROM habits WHERE active = 1 ORDER BY created_at'
        ).fetchall()
        habits = [row_to_habit(r) for r in rows]
        for h in habits:
            log_row = conn.execute(
                'SELECT done FROM habit_logs WHERE habit_id = ? AND date = ?',
                (h['id'], today_str)
            ).fetchone()
            h['today_done'] = bool(log_row['done']) if log_row else False
            week_rows = conn.execute(
                'SELECT date, done FROM habit_logs WHERE habit_id = ? AND date >= ? AND date <= ?',
                (h['id'], week_dates[0], week_dates[-1])
            ).fetchall()
            week_map = {r['date']: bool(r['done']) for r in week_rows}
            h['week_done'] = {d: week_map.get(d, None) for d in week_dates}

    # stats は接続外で計算（ネスト接続を避ける）
    for h in habits:
        stats = calculate_habit_stats(h['id'], today)
        h['current_streak'] = stats['current_streak']
        h['rate_30d']       = stats['rate_30d']

    return jsonify(habits)


@app.route('/api/habits', methods=['POST'])
def create_habit():
    data      = request.get_json()
    title     = data.get('title', '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400
    category  = data.get('category', 'life')
    if category not in VALID_CATEGORIES:
        return jsonify({'error': 'invalid category'}), 400
    frequency = data.get('frequency', 'daily')
    if frequency not in VALID_FREQUENCIES:
        return jsonify({'error': 'invalid frequency'}), 400

    habit_id   = 'habit_' + str(int(time.time() * 1000))
    created_at = time.strftime('%Y-%m-%dT%H:%M:%S')
    tags       = data.get('tags', [])
    notes      = data.get('notes', '')
    color      = data.get('color', '')

    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            'INSERT INTO habits (id, title, category, tags, frequency, notes, created_at, active, color) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
            (habit_id, title, category, json.dumps(tags, ensure_ascii=False), frequency, notes, created_at, color)
        )
        conn.commit()

    return jsonify({
        'id': habit_id, 'title': title, 'category': category,
        'tags': tags, 'frequency': frequency, 'notes': notes,
        'created_at': created_at, 'active': True,
        'importance': 'high', 'urgency': 'low',
        'color': color, 'today_done': False, 'current_streak': 0,
    }), 201


@app.route('/api/habits/<habit_id>', methods=['PUT'])
def update_habit(habit_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute('SELECT * FROM habits WHERE id = ?', (habit_id,)).fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        data  = request.get_json()
        habit = row_to_habit(row)

        if 'title' in data:
            habit['title'] = data['title'].strip()
        if 'category' in data:
            if data['category'] not in VALID_CATEGORIES:
                return jsonify({'error': 'invalid category'}), 400
            habit['category'] = data['category']
        if 'frequency' in data:
            if data['frequency'] not in VALID_FREQUENCIES:
                return jsonify({'error': 'invalid frequency'}), 400
            habit['frequency'] = data['frequency']
        if 'notes' in data:
            habit['notes'] = data['notes']
        if 'tags' in data:
            habit['tags'] = data['tags']
        if 'active' in data:
            habit['active'] = bool(data['active'])
        if 'color' in data:
            habit['color'] = data['color']

        conn.execute(
            'UPDATE habits SET title=?, category=?, tags=?, frequency=?, notes=?, active=?, color=? WHERE id=?',
            (habit['title'], habit['category'],
             json.dumps(habit['tags'], ensure_ascii=False),
             habit['frequency'], habit['notes'],
             1 if habit['active'] else 0,
             habit.get('color', ''),
             habit_id)
        )
        conn.commit()
    return jsonify(habit)


@app.route('/api/habits/<habit_id>', methods=['DELETE'])
def delete_habit(habit_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('DELETE FROM habit_logs WHERE habit_id = ?', (habit_id,))
        conn.execute('DELETE FROM habits WHERE id = ?', (habit_id,))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/habits/<habit_id>/log', methods=['POST'])
def log_habit(habit_id):
    with sqlite3.connect(DB_FILE) as conn:
        row = conn.execute('SELECT id FROM habits WHERE id = ?', (habit_id,)).fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        data     = request.get_json()
        date_str = data.get('date', '')
        if not date_str:
            return jsonify({'error': 'date is required'}), 400
        try:
            date.fromisoformat(date_str)
        except ValueError:
            return jsonify({'error': 'invalid date format'}), 400
        done = 1 if data.get('done', True) else 0
        conn.execute(
            'INSERT INTO habit_logs (habit_id, date, done) VALUES (?, ?, ?) '
            'ON CONFLICT(habit_id, date) DO UPDATE SET done = excluded.done',
            (habit_id, date_str, done)
        )
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/habits/<habit_id>/logs', methods=['GET'])
def get_habit_logs(habit_id):
    with sqlite3.connect(DB_FILE) as conn:
        row = conn.execute('SELECT id FROM habits WHERE id = ?', (habit_id,)).fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        days = request.args.get('days', 90, type=int)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT date, done FROM habit_logs WHERE habit_id = ? ORDER BY date DESC LIMIT ?',
            (habit_id, days)
        ).fetchall()
    return jsonify([{'date': r['date'], 'done': bool(r['done'])} for r in rows])


@app.route('/api/habits/<habit_id>/stats', methods=['GET'])
def get_habit_stats(habit_id):
    with sqlite3.connect(DB_FILE) as conn:
        row = conn.execute('SELECT id FROM habits WHERE id = ?', (habit_id,)).fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
    return jsonify(calculate_habit_stats(habit_id, date.today()))


# ── Launch ────────────────────────────────────────────────

if __name__ == '__main__':
    print('=' * 48)
    print(f'  Task Organizer  http://localhost:{PORT}')
    print('=' * 48)
    socketio.run(app, host='0.0.0.0', port=PORT, debug=False)
