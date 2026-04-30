"""Flask app factory.

`create_app()` を呼ぶと Flask app + container + 全 Blueprint が組み上がる。
ルートエントリの `app.py`（プロジェクト直下）はこの factory を呼んで起動する
だけ。新エンドポイントを増やす時は `routes/` 配下に追加して、ここで登録する。
"""
import os

from flask import Flask

from config import DATA_DIR, DB_FILE, SECRET_KEY
from infrastructure.persistence.sqlite.schema import init_db, migrate_from_json
from interfaces.web.container import Container
from interfaces.web.error_handlers import register_error_handlers
from interfaces.web.routes import (
    ui, tasks, archive, review, projects, categories,
    habits, diary, braindump, chat,
)


def create_app() -> Flask:
    os.makedirs(DATA_DIR, exist_ok=True)
    init_db(DB_FILE)
    migrate_from_json(DB_FILE)

    app = Flask(
        __name__,
        template_folder=_template_dir(),
        static_folder=_static_dir(),
    )
    app.config['SECRET_KEY'] = SECRET_KEY

    container = Container()
    app.container = container  # type: ignore[attr-defined]  # テスト/拡張から参照可

    register_error_handlers(app)

    for module in (
        ui, tasks, archive, review, projects, categories,
        habits, diary, braindump, chat,
    ):
        app.register_blueprint(module.make_blueprint(container))

    return app


def _project_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(os.path.dirname(here))


def _template_dir() -> str:
    return os.path.join(_project_root(), 'templates')


def _static_dir() -> str:
    return os.path.join(_project_root(), 'static')
