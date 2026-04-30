"""Clock port — テスト可能な時刻取得。

services は datetime.now() を直接呼ばず、Clock を経由する。これによりテストで
時刻を固定できる（FakeClock）。実装は infrastructure/clock.py。
"""
from datetime import date, datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...
    def today(self) -> date: ...
