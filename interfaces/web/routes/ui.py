"""UI ルート（/ と /sw.js）。"""
import os

from flask import Blueprint, render_template, send_from_directory

from config import BASE_DIR


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('ui', __name__)

    @bp.route('/')
    def index():
        return render_template('index.html')

    @bp.route('/sw.js')
    def serve_sw():
        return send_from_directory(
            os.path.join(BASE_DIR, 'static'), 'sw.js',
            mimetype='application/javascript',
        )

    return bp
