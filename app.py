"""Entry point — Python から直接 `python app.py` で起動される。

Flask app の組み立ては `interfaces/web/app.py` の `create_app()` に委譲する。
このファイルは「起動」だけを担当する。
"""
from flask_socketio import SocketIO

from config import PORT
from interfaces.web.app import create_app


app = create_app()
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')


if __name__ == '__main__':
    print('=' * 48)
    print(f'  Task Organizer  http://localhost:{PORT}')
    print('=' * 48)
    socketio.run(app, host='0.0.0.0', port=PORT, debug=False)
