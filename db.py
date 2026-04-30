"""Backward-compat shim for one-off migration scripts.

`scripts/migrate_to_gtd*.py` import `init_db` from this module. The real
implementation has moved to `infrastructure/persistence/sqlite/schema.py`.
This shim keeps those scripts runnable.

App code uses the new location directly.
"""
from config import DB_FILE
from infrastructure.persistence.sqlite.schema import (
    init_db as _init_db,
    migrate_from_json as _migrate,
)


def init_db():
    _init_db(DB_FILE)


def migrate_from_json():
    _migrate(DB_FILE)
