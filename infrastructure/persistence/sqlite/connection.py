"""SQLite 接続のヘルパー。

すべての repo はこのコンテキストマネージャ経由で接続を取得する。
row_factory を毎回設定する重複を避ける + 例外を `RepositoryError` に
変換する一元化ポイント。
"""
import sqlite3
from contextlib import contextmanager

from infrastructure.errors import RepositoryError


@contextmanager
def open_conn(db_file: str):
    try:
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error as e:
        raise RepositoryError(f'SQLite operation failed: {e}', cause=e) from e
