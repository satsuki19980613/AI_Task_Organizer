"""AI プロンプト・テンプレート集約。

5 種類の呼び出しサイトに対応:
1. braindump_summary  — 会話を JSON 要約（haiku）
2. diary_consolidate  — 日記の思考トピックを整理（haiku）
3. dump_chat_system   — 思考整理パートナー用システムプロンプト
4. task_detail_chat   — タスク詳細設計の system プロンプト
5. project_chat       — プロジェクトの子タスク提案 system プロンプト

services から呼ばれる。実装変更があってもここを編集するだけで済む。
"""
from typing import Any

from config.constants import BRAIN_DUMP_THEME_CATEGORIES


# ── 1. Brain dump 会話要約 ─────────────────────────────
def braindump_summary_prompt(messages: list[dict[str, Any]]) -> str:
    conv_text = '\n'.join(
        f"{'ユーザー' if m.get('role') == 'user' else 'AI'}: {m.get('content','')}"
        for m in messages
    )
    cats_str = ' / '.join(BRAIN_DUMP_THEME_CATEGORIES)
    return (
        "以下の会話を読んで、JSONのみを返してください（前後の説明文は不要）。\n\n"
        f"会話:\n{conv_text}\n\n"
        "返すJSON形式:\n"
        '{"title": "会話のテーマを10〜20字で", '
        '"summary": "会話の要点を3〜5文で", '
        f'"theme_category": "次のうち最も近い1つ（未分類は使用禁止）: {cats_str}", '
        '"sub_theme": "theme_categoryの中のより具体的なサブテーマを7〜15字で（例: キャリア設計・業務改善・不安と焦り）。未分類・その他などの曖昧な語は禁止"}'
    )


# ── 2. Diary 思考整理 ─────────────────────────────────
def diary_consolidate_prompt(thought_lines: list[str]) -> str:
    cats_str = ' / '.join(BRAIN_DUMP_THEME_CATEGORIES)
    return (
        "以下はユーザーが日記で記録した「考えたこと」のトピック一覧です。\n"
        "トピック同士の包摂関係・類似関係を見て、大テーマと具体テーマに整理してください。\n\n"
        "トピック:\n" + '\n'.join(thought_lines) + "\n\n"
        "返すJSON形式（JSONのみ、前後の説明文は不要）:\n"
        '{"title": "全体を表す10〜20字のタイトル", '
        '"summary": "本人の思考の癖や傾向を3〜5文で要約。大テーマと具体テーマの包摂関係を文章で説明する", '
        f'"theme_category": "次のうち最も近い1つ（未分類は使用禁止）: {cats_str}", '
        '"sub_theme": "theme_categoryの中のより具体的なサブテーマを7〜15字で"}'
    )


# ── 3. Dump モード system プロンプト ─────────────────
DUMP_CHAT_SYSTEM = (
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


# ── 4. Task 詳細チャット system プロンプト ──────────
def task_detail_system_prompt(
    task: dict,
    category_label: str,
    deadline_label: str,
    estimate_label: str,
    status_label: str,
    category_choices: str,
) -> str:
    roadmap_lines = '\n'.join(
        f"  {'[完了]' if r.get('done') else '[ ]'} {r.get('text','')}"
        for r in task.get('roadmap', [])
    ) or '  (なし)'
    checklist_lines = '\n'.join(
        f"  {'[✓]' if c.get('done') else '[ ]'} {c.get('text','')}"
        for c in task.get('checklist', [])
    ) or '  (なし)'

    return (
        "あなたはタスクの詳細設計を手伝うアシスタントです。以下のタスクについて、"
        "ユーザーの質問に答えながら、必要に応じて構造化情報を JSON で出力してください。\n\n"
        "タスク情報:\n"
        f"- タイトル: {task.get('title','')}\n"
        f"- カテゴリ: {category_label}\n"
        f"- 期限: {deadline_label}\n"
        f"- 見込み時間: {estimate_label}\n"
        f"- 状態: {status_label}\n"
        f"ロードマップ:\n{roadmap_lines}\n"
        f"チェックリスト（準備物）:\n{checklist_lines}\n\n"
        "選択できる category_id（親と子）:\n"
        f"{category_choices}\n\n"
        "できること:\n"
        "1. category（親カテゴリ + サブカテゴリ）の推定\n"
        "2. roadmap（3〜7個のステップ）の提案\n"
        "3. checklist（準備物）の提案\n"
        "4. estimate_minutes（見込み時間、分単位）の提案\n"
        "5. 期限が不明なときの一般情報の相談\n"
        "6. タスク分解の提案（複数タスクに分けたほうが良いか）\n"
        "7. 「これは本当にやる必要がある？」と問いかける（ゴミ箱判定の補助）\n\n"
        "提案を確定したい場合のみ、以下の形式で出力してください。"
        "ユーザーが「決定」や「保存」など明示的に確定の意思を示すまでは通常の会話を続けること:\n\n"
        '[[DETAIL:{"category_id":"cat_work","roadmap":[{"text":"ステップ1"}],'
        '"checklist":[{"text":"準備物1"}],"estimate_minutes":30}]]\n\n'
        "※ [[DETAIL:]] は部分更新として扱われる。含めたいフィールドだけ含めて良い。\n"
        "※ 1 回の応答につき [[DETAIL:]] は最大 1 つ。valid JSON であること。\n"
        "※ 仕分けの判断（next_action / waiting / calendar / someday / project_pending / trash）"
        "は AI から提案しない。仕分けは常にユーザーが決める。\n"
        "※ [[TASK:]] / [[PROJECT:]] / [[HABIT:]] / [[UPDATE_STEP:]] は絶対に出力しないこと。\n"
        "※ 日本語で話し、温かく落ち着いた口調で、質問は一度に一つだけ。"
    )


# ── 5. Project チャット system プロンプト ────────────
def project_chat_system_prompt(
    project: dict,
    children: list[dict],
    category_choices: str,
) -> str:
    def _fmt_child(t: dict) -> str:
        title = t.get('title', '')
        m = t.get('estimate_minutes')
        return f"  - {title} ({m}分)" if m else f"  - {title}"
    existing_lines = '\n'.join(_fmt_child(t) for t in children) or '  (まだ子タスクはありません)'

    cc_label = project.get('completion_condition') or '未設定'
    period_label = (
        f"{project.get('period_start') or '未設定'} 〜 {project.get('period_end') or '未設定'}"
    )

    return (
        "あなたはプロジェクトのタスク設計を手伝うアシスタントです。"
        "以下のプロジェクトについて、ユーザーの質問に答えながら、"
        "プロジェクト内のタスクを 3〜10 個提案してください。\n\n"
        "プロジェクト情報:\n"
        f"- 名前: {project.get('title','')}\n"
        f"- 完了条件: {cc_label}\n"
        f"- 期間: {period_label}\n"
        "既存の子タスク:\n"
        f"{existing_lines}\n\n"
        "選択できる category_id:\n"
        f"{category_choices}\n\n"
        "できること:\n"
        "1. 子タスクの提案（複数）\n"
        "2. 完了条件のあいまいさをチェックして書き換え提案\n"
        "3. 期間設定のアドバイス\n\n"
        "提案を確定したい場合のみ、以下の形式で出力してください:\n\n"
        '[[PROJECT_TASKS:{"completion_condition":"（必要なら更新）",'
        '"tasks":[{"title":"タスク1","estimate_minutes":30,"category_id":"cat_work"},'
        '{"title":"タスク2","estimate_minutes":60}]}]]\n\n'
        "※ tasks 配列のみ部分更新も可能。\n"
        "※ AI が勝手に既存タスクを上書きしない。常に「追加」として扱う。\n"
        "※ 1 回の応答につき [[PROJECT_TASKS:]] は最大 1 つ。valid JSON であること。\n"
        "※ 日本語で話し、温かく落ち着いた口調で、質問は一度に一つだけ。"
    )
