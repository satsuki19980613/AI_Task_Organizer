"""
プレゼン用PDF生成スクリプト（A4縦・5ページ版）
"""
import base64, json, shutil, subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE          = Path(__file__).parent
TASKS_JSON    = BASE / "data" / "tasks.json"
PROJECTS_JSON = BASE / "data" / "projects.json"
BACKUP_TASKS  = BASE / "data" / "_tasks_backup.json"
BACKUP_PROJ   = BASE / "data" / "_projects_backup.json"
OUT_DIR       = BASE / "presentation"
OUT_DIR.mkdir(exist_ok=True)

DEMO_TASKS = [
    {
        "id": "demo_001", "title": "提案書の作成", "importance": "high", "urgency": "high",
        "category": "work", "deadline": "2026-04-22", "completed": False,
        "created_at": "2026-04-18T09:00:00", "notes": "",
        "tags": ["提案書", "クライアント"],
        "roadmap": [
            {"id": "r001", "text": "要件を整理する", "done": True},
            {"id": "r002", "text": "構成案を作る", "done": True},
            {"id": "r003", "text": "スライドを作成する", "done": False},
            {"id": "r004", "text": "上司にレビューを依頼する", "done": False},
            {"id": "r005", "text": "最終修正して提出する", "done": False},
        ],
        "checklist": [
            {"id": "c001", "text": "昨年度の提案書（参考用）", "done": True},
            {"id": "c002", "text": "クライアントの要望メモ", "done": True},
        ],
    },
    {
        "id": "demo_002", "title": "定期健康診断の予約", "importance": "high", "urgency": "high",
        "category": "health", "deadline": "2026-04-25", "completed": False,
        "created_at": "2026-04-15T10:00:00", "notes": "",
        "tags": ["健康診断"],
        "roadmap": [
            {"id": "r010", "text": "クリニックの電話番号を調べる", "done": False},
            {"id": "r011", "text": "予約を入れる", "done": False},
            {"id": "r012", "text": "前日の食事制限を確認する", "done": False},
        ],
        "checklist": [{"id": "c010", "text": "保険証", "done": False}],
    },
    {
        "id": "demo_003", "title": "英語スキルアップ計画", "importance": "high", "urgency": "low",
        "category": "learning", "deadline": "2026-09-30", "completed": False,
        "created_at": "2026-04-10T09:00:00", "notes": "",
        "tags": ["英語", "スキルアップ"],
        "roadmap": [
            {"id": "r020", "text": "現在のレベルを確認する（TOEICスコア）", "done": True},
            {"id": "r021", "text": "学習プランを立てる", "done": False},
            {"id": "r022", "text": "毎朝15分のリスニングを習慣化する", "done": False},
            {"id": "r023", "text": "月1回オンライン英会話を受ける", "done": False},
        ],
        "checklist": [{"id": "c020", "text": "英語学習アプリ", "done": False}],
    },
    {
        "id": "demo_004", "title": "家計簿の整理（今月分）", "importance": "high", "urgency": "low",
        "category": "admin", "deadline": "2026-04-30", "completed": False,
        "created_at": "2026-04-12T20:00:00", "notes": "",
        "tags": ["家計簿", "お金"],
        "roadmap": [
            {"id": "r030", "text": "レシートを集める", "done": False},
            {"id": "r031", "text": "スプレッドシートに入力する", "done": False},
            {"id": "r032", "text": "先月と比較してコメントを書く", "done": False},
        ],
        "checklist": [],
    },
    {
        "id": "demo_005", "title": "チームへの連絡事項を共有", "importance": "low", "urgency": "high",
        "category": "work", "deadline": "2026-04-21", "completed": False,
        "created_at": "2026-04-20T08:00:00", "notes": "",
        "tags": ["連絡", "チーム"],
        "roadmap": [
            {"id": "r040", "text": "連絡内容をまとめる", "done": False},
            {"id": "r041", "text": "Slackに投稿する", "done": False},
        ],
        "checklist": [],
    },
    {
        "id": "demo_006", "title": "名刺の補充注文", "importance": "low", "urgency": "high",
        "category": "admin", "deadline": "2026-04-22", "completed": False,
        "created_at": "2026-04-19T11:00:00", "notes": "",
        "tags": ["名刺"],
        "roadmap": [
            {"id": "r050", "text": "印刷業者のサイトで注文する", "done": False},
            {"id": "r051", "text": "デザインを確認して承認する", "done": False},
        ],
        "checklist": [{"id": "c050", "text": "現在の名刺デザインデータ", "done": False}],
    },
    {
        "id": "demo_007", "title": "デスク周りの整理整頓", "importance": "low", "urgency": "low",
        "category": "life", "deadline": None, "completed": False,
        "created_at": "2026-04-10T15:00:00", "notes": "",
        "tags": ["片付け"],
        "roadmap": [
            {"id": "r060", "text": "不要な書類をシュレッダーにかける", "done": False},
            {"id": "r061", "text": "ケーブルを整理する", "done": False},
        ],
        "checklist": [],
    },
    {
        "id": "demo_008", "title": "読みたい本リストの整理", "importance": "low", "urgency": "low",
        "category": "learning", "deadline": None, "completed": False,
        "created_at": "2026-04-08T21:00:00", "notes": "",
        "tags": ["読書", "インプット"],
        "roadmap": [
            {"id": "r070", "text": "メモに残してある本タイトルをまとめる", "done": False},
            {"id": "r071", "text": "優先順位をつける", "done": False},
        ],
        "checklist": [],
    },
]

DEMO_PROJECTS = [
    {
        "id": "proj_demo_001",
        "title": "英語で電話会議できる",
        "goal": "海外クライアントとの電話会議で自分の意見をリアルタイムに返せる状態になる",
        "category": "learning", "deadline": "2026-10-31",
        "tags": ["英語", "スキルアップ"],
        "phases": [
            {"id": "ph001", "text": "基礎固め", "done": False, "notes": "", "current_task_id": "demo_003"},
            {"id": "ph002", "text": "実践練習", "done": False, "notes": "", "current_task_id": None},
            {"id": "ph003", "text": "実戦投入", "done": False, "notes": "", "current_task_id": None},
        ],
        "current_phase": 0, "created_at": "2026-04-10T09:00:00", "next_step_history": [],
    }
]


def backup_and_replace():
    print("データをバックアップ中...")
    shutil.copy(TASKS_JSON, BACKUP_TASKS)
    if PROJECTS_JSON.exists():
        shutil.copy(PROJECTS_JSON, BACKUP_PROJ)
    TASKS_JSON.write_text(json.dumps(DEMO_TASKS, ensure_ascii=False, indent=2), encoding="utf-8")
    PROJECTS_JSON.write_text(json.dumps(DEMO_PROJECTS, ensure_ascii=False, indent=2), encoding="utf-8")
    print("デモデータをセット完了")


def restore():
    print("元データを復元中...")
    shutil.copy(BACKUP_TASKS, TASKS_JSON)
    BACKUP_TASKS.unlink(missing_ok=True)
    if BACKUP_PROJ.exists():
        shutil.copy(BACKUP_PROJ, PROJECTS_JSON)
        BACKUP_PROJ.unlink(missing_ok=True)
    print("元データ復元完了")


def take_screenshots():
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from webdriver_manager.chrome import ChromeDriverManager

    print("Chrome を起動中...")
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    # A4縦の幅に合わせた横長ウィンドウでアプリを表示
    options.add_argument("--window-size=1280,800")
    options.add_argument("--hide-scrollbars")
    options.add_argument("--force-device-scale-factor=2")   # 高解像度で撮影
    options.add_argument("--lang=ja")

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options,
    )

    def js_click(selector):
        el = driver.find_element(By.CSS_SELECTOR, selector)
        driver.execute_script("arguments[0].click();", el)

    try:
        driver.get("http://localhost:5000")
        time.sleep(3)

        # マトリクス（タスクが並んだ全体ビュー）
        js_click("[data-tab='tasks']")
        time.sleep(2)
        driver.save_screenshot(str(OUT_DIR / "screen_matrix.png"))
        print("screen_matrix.png 保存")

        # タスク詳細パネル（1枚目のカードをクリック）
        cards = driver.find_elements(By.CSS_SELECTOR, ".matrix-card")
        if cards:
            driver.execute_script("arguments[0].click();", cards[0])
            time.sleep(2.5)
        driver.save_screenshot(str(OUT_DIR / "screen_detail.png"))
        print("screen_detail.png 保存")

        # AI チャット
        js_click("[data-tab='chat']")
        time.sleep(2)
        driver.save_screenshot(str(OUT_DIR / "screen_chat.png"))
        print("screen_chat.png 保存")

        # レポート
        js_click("[data-tab='report']")
        time.sleep(3)
        driver.save_screenshot(str(OUT_DIR / "screen_report.png"))
        print("screen_report.png 保存")

    finally:
        driver.quit()
        print("Chrome 終了")


def img_b64(name: str) -> str:
    return base64.b64encode((OUT_DIR / name).read_bytes()).decode()


# ══════════════════════════════════════════════════════════════
#  HTML（A4縦・5ページ）
# ══════════════════════════════════════════════════════════════
CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif;
  background: #e8edf0;
  color: #2c3e50;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@page { size: A4 portrait; margin: 0; }

.page {
  width: 210mm;
  min-height: 297mm;
  height: 297mm;
  overflow: hidden;
  background: #ffffff;
  page-break-after: always;
  display: flex;
  flex-direction: column;
}

/* ─ ヘッダーバー ─ */
.hdr {
  flex-shrink: 0;
  background: #e6f2f2;
  border-bottom: 2px solid #a8d0cc;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.hdr-num {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: #5f9ea0;
  color: white;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.hdr-title { font-size: 16px; font-weight: 700; color: #2d6060; }
.hdr-app   { margin-left: auto; font-size: 10px; color: #7aadad; font-weight: 600; letter-spacing: 0.4px; }

/* ─ フッターバー ─ */
.ftr {
  flex-shrink: 0;
  background: #e6f2f2;
  border-top: 1px solid #c0dbd8;
  padding: 6px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ftr-note { font-size: 9px; color: #7aadad; }
.ftr-page { font-size: 9px; color: #7aadad; }

/* ─ 本文エリア ─ */
.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─ スクリーンショットブロック ─ */
.ss-wrap {
  padding: 14px 20px 8px;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}
.ss-wrap img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #dde8e8;
  box-shadow: 0 3px 16px rgba(95,158,160,0.16);
  display: block;
}
.ss-wrap.lg img  { max-height: 148mm; object-fit: contain; object-position: top left; }
.ss-wrap.md img  { max-height: 110mm; object-fit: contain; object-position: top left; }
.ss-wrap.sm img  { max-height: 85mm;  object-fit: contain; object-position: top left; }

/* ─ 説明エリア ─ */
.desc {
  flex: 1;
  padding: 10px 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
.desc-lead {
  font-size: 12px; color: #4a6e6e; line-height: 1.75;
}

/* ─ カードグリッド ─ */
.card-grid {
  display: grid;
  gap: 8px;
}
.card-grid.col2 { grid-template-columns: 1fr 1fr; }
.card-grid.col1 { grid-template-columns: 1fr; }

.card {
  background: #f7fbfb;
  border-radius: 7px;
  padding: 9px 12px;
  border-left: 3px solid #8ec5c0;
}
.card.red    { border-color: #f87171; background: #fff7f7; }
.card.blue   { border-color: #7ab8f5; background: #f5f9ff; }
.card.amber  { border-color: #f0c060; background: #fffbf0; }
.card.gray   { border-color: #b0bec5; background: #f7f8f9; }
.card.teal   { border-color: #8ec5c0; background: #f3fafa; }
.card.green  { border-color: #81c995; background: #f3faf5; }
.card.orange { border-color: #f0a060; background: #fffaf5; }

.card-label { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; color: #8aabab; margin-bottom: 2px; text-transform: uppercase; }
.card-title { font-size: 12.5px; font-weight: 700; color: #2c4f4f; margin-bottom: 3px; }
.card-body  { font-size: 10.5px; color: #546e7a; line-height: 1.65; }
.card-body ul { margin-left: 14px; }
.card-body li { margin-bottom: 2px; }

/* ─ 表紙専用 ─ */
.cover-top {
  flex-shrink: 0;
  background: #e6f2f2;
  padding: 28px 24px 22px;
  border-bottom: 1px solid #c0dbd8;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cover-appname {
  font-size: 32px; font-weight: 900; color: #2d6060;
  letter-spacing: -0.5px; line-height: 1.1;
}
.cover-appname span { color: #5f9ea0; }
.cover-catch {
  font-size: 13px; color: #4a7070; line-height: 1.8;
  border-left: 3px solid #8ec5c0;
  padding-left: 12px;
}
.pill-row { display: flex; flex-wrap: wrap; gap: 6px; }
.pill {
  background: #d4ecea;
  color: #2d6060;
  font-size: 10px; font-weight: 600;
  padding: 3px 11px; border-radius: 20px;
  border: 1px solid #b2d8d4;
}

/* 2カラムスクリーン（ページ5用） */
.two-col {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  overflow: hidden;
}
.two-col .col {
  display: flex; flex-direction: column;
  padding: 12px 14px;
  gap: 8px;
}
.two-col .col + .col { border-left: 1px solid #d4e8e5; }
.col-title {
  font-size: 12px; font-weight: 700; color: #2d6060;
  flex-shrink: 0;
}
.col-ss {
  flex-shrink: 0;
}
.col-ss img {
  width: 100%;
  border-radius: 6px;
  border: 1px solid #dde8e8;
  box-shadow: 0 2px 8px rgba(95,158,160,0.12);
  display: block;
}
"""


def page(num: str, title: str, content: str, footer_note: str, pg_num: str) -> str:
    return f"""
<div class="page">
  <div class="hdr">
    <div class="hdr-num">{num}</div>
    <div class="hdr-title">{title}</div>
    <div class="hdr-app">AI Task Organizer</div>
  </div>
  {content}
  <div class="ftr">
    <div class="ftr-note">{footer_note}</div>
    <div class="ftr-page">{pg_num} / 5</div>
  </div>
</div>"""


def build_html(imgs: dict) -> Path:
    # ── PAGE 1：表紙 ─────────────────────────────────────
    p1 = f"""
  <div class="cover-top">
    <div class="cover-appname">AI <span>Task</span><br>Organizer</div>
    <div class="cover-catch">
      頭の中のごちゃごちゃを、<br>
      整理された「行動リスト」に変えるタスク管理アプリです。<br>
      AIと会話しながら、やることを一緒に整理できます。
    </div>
    <div class="pill-row">
      <span class="pill">ローカル動作（ネット不要）</span>
      <span class="pill">AI アシスタント搭載</span>
      <span class="pill">データはすべて手元に保存</span>
      <span class="pill">個人開発</span>
    </div>
  </div>
  <div class="ss-wrap lg">
    <img src="data:image/png;base64,{imgs['matrix']}" alt="マトリクス全体">
  </div>"""

    # ── PAGE 2：マトリクス ────────────────────────────────
    p2 = f"""
  <div class="body">
    <div class="ss-wrap md">
      <img src="data:image/png;base64,{imgs['matrix']}" alt="マトリクス">
    </div>
    <div class="desc">
      <div class="desc-lead">
        「重要度」と「緊急度」の 2 軸で、タスクを 4 つのエリアに自動分類します。<br>
        何から手をつければよいかが、画面を開くだけでわかります。
      </div>
      <div class="card-grid col2">
        <div class="card red">
          <div class="card-label">重要 × 急ぎ</div>
          <div class="card-title">今すぐやる</div>
          <div class="card-body">締め切りが近い・放置できないもの</div>
        </div>
        <div class="card blue">
          <div class="card-label">重要 × 急がない</div>
          <div class="card-title">計画してやる</div>
          <div class="card-body">将来に向けた準備・スキルアップなど</div>
        </div>
        <div class="card amber">
          <div class="card-label">急ぎ × あまり重要でない</div>
          <div class="card-title">誰かに任せる</div>
          <div class="card-body">急いでいるが自分でなくてもよいもの</div>
        </div>
        <div class="card gray">
          <div class="card-label">どちらでもない</div>
          <div class="card-title">やらなくてよい</div>
          <div class="card-body">後回しでいい・思い切って手放すもの</div>
        </div>
      </div>
    </div>
  </div>"""

    # ── PAGE 3：タスク詳細 ────────────────────────────────
    p3 = f"""
  <div class="body">
    <div class="ss-wrap md">
      <img src="data:image/png;base64,{imgs['detail']}" alt="タスク詳細">
    </div>
    <div class="desc">
      <div class="desc-lead">
        タスクをクリックすると右側に詳細パネルが開き、細かく管理できます。
      </div>
      <div class="card-grid col2">
        <div class="card teal">
          <div class="card-title">ロードマップ</div>
          <div class="card-body">タスクを小さなステップに分解し、チェックしながら進められます。</div>
        </div>
        <div class="card teal">
          <div class="card-title">チェックリスト</div>
          <div class="card-body">持ち物・事前準備をリストにして抜け漏れを防ぎます。</div>
        </div>
        <div class="card teal">
          <div class="card-title">期限・カテゴリー・タグ</div>
          <div class="card-body">仕事・健康・生活など6分類。期限管理で締め切り忘れを防ぎます。</div>
        </div>
        <div class="card teal">
          <div class="card-title">タスクごとのメモ</div>
          <div class="card-body">気づいたことや補足をいつでも書き留められます。</div>
        </div>
      </div>
    </div>
  </div>"""

    # ── PAGE 4：AI チャット ───────────────────────────────
    p4 = f"""
  <div class="body">
    <div class="ss-wrap md">
      <img src="data:image/png;base64,{imgs['chat']}" alt="AI チャット">
    </div>
    <div class="desc">
      <div class="desc-lead">
        チャット画面で AI に話しかけると、質問しながらタスクを整理してくれます。
      </div>
      <div class="card-grid col1">
        <div class="card green">
          <div class="card-title">話しかけるだけでタスク登録</div>
          <div class="card-body">「〜しないといけないんだけど」と入力するだけで、AIが一つひとつ確認しながらタスクを作ってくれます。重要度・期限・ステップもまとめて整理します。</div>
        </div>
        <div class="card green">
          <div class="card-title">プロジェクト管理にも対応</div>
          <div class="card-body">「半年後までに英語で話せるようになりたい」のような長期目標も、フェーズに分けて管理できます。各フェーズで AI がスモールステップを提案します。</div>
        </div>
        <div class="card green">
          <div class="card-title">タスクごとの個別相談</div>
          <div class="card-body">タスクの詳細パネルからも AI に相談できます。「どこから始めればいいか」「どうしても手がつかない」といった壁を一緒に乗り越えます。</div>
        </div>
      </div>
    </div>
  </div>"""

    # ── PAGE 5：分析レポート ──────────────────────────────
    p5 = f"""
  <div class="body">
    <div class="ss-wrap md">
      <img src="data:image/png;base64,{imgs['report']}" alt="レポート">
    </div>
    <div class="desc">
      <div class="desc-lead">
        レポート画面では、タスク全体の状態を自動で分析します。
      </div>
      <div class="card-grid col2">
        <div class="card orange">
          <div class="card-title">優先度スコアの自動計算</div>
          <div class="card-body">期限の近さ・進捗・放置日数をもとに、本当に今やるべきタスクを自動でリストアップします。</div>
        </div>
        <div class="card orange">
          <div class="card-title">先延ばし検知</div>
          <div class="card-body">「ずっと手がつけられていない」タスクを自動検出し、注意を促します。</div>
        </div>
        <div class="card orange">
          <div class="card-title">カテゴリー別の傾向</div>
          <div class="card-body">仕事・健康・生活など分野ごとの進捗をレーダーチャートで可視化します。</div>
        </div>
        <div class="card orange">
          <div class="card-title">AI によるコメント</div>
          <div class="card-body">「このタスクは先延ばしになっています」など、状況に合った改善アドバイスを表示します。</div>
        </div>
      </div>
    </div>
  </div>"""

    pages = [
        page("", "AI Task Organizer", p1, "自分の日常生活のタスク管理のために作りました", "1"),
        page("2", "タスクを4つのエリアに仕分け", p2, "アイゼンハワーマトリクスをベースに設計しています", "2"),
        page("3", "タスクの中身を細かく管理", p3, "タスクをクリックすると詳細パネルが開きます", "3"),
        page("4", "AIアシスタントと一緒に整理", p4, "Claude（Anthropic）のAIをローカルから呼び出しています", "4"),
        page("5", "分析レポートで状態を把握", p5, "レポートは手動更新またはタスク変更時に自動生成されます", "5"),
    ]

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>{CSS}</style>
</head>
<body>
{"".join(pages)}
</body>
</html>"""

    html_path = OUT_DIR / "presentation.html"
    html_path.write_text(html, encoding="utf-8")
    print(f"HTML生成完了: {html_path}")
    return html_path


def html_to_pdf(html_path: Path) -> Path:
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager
    import base64

    print("Chrome でPDF出力中...")
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--lang=ja")

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options,
    )
    try:
        driver.get(f"file:///{html_path.as_posix()}")
        time.sleep(3)
        result = driver.execute_cdp_cmd("Page.printToPDF", {
            "paperWidth":        8.27,    # A4 portrait (inches)
            "paperHeight":       11.69,
            "marginTop":         0,
            "marginBottom":      0,
            "marginLeft":        0,
            "marginRight":       0,
            "printBackground":   True,
            "preferCSSPageSize": True,
        })
        pdf_path = OUT_DIR / "AI_Task_Organizer_Presentation.pdf"
        pdf_path.write_bytes(base64.b64decode(result["data"]))
        print(f"PDF保存完了: {pdf_path}")
        return pdf_path
    finally:
        driver.quit()


def main():
    server_proc = None
    try:
        backup_and_replace()
        print("Flask サーバー起動中...")
        server_proc = subprocess.Popen(
            ["python", str(BASE / "app.py")],
            cwd=str(BASE),
            creationflags=subprocess.CREATE_NO_WINDOW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(4)
        take_screenshots()
    finally:
        if server_proc:
            server_proc.terminate()
            print("サーバー停止")
        restore()

    imgs = {
        "matrix": img_b64("screen_matrix.png"),
        "detail": img_b64("screen_detail.png"),
        "chat":   img_b64("screen_chat.png"),
        "report": img_b64("screen_report.png"),
    }
    html_path = build_html(imgs)
    pdf_path  = html_to_pdf(html_path)
    print(f"\n完了！ {pdf_path}")


if __name__ == "__main__":
    main()
