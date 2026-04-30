"""FakeClock — テスト時に時刻を固定するための Clock 実装。"""
from datetime import date, datetime


class FakeClock:
    def __init__(self, fixed: datetime):
        self._now = fixed

    def now(self) -> datetime:
        return self._now

    def today(self) -> date:
        return self._now.date()

    def set(self, moment: datetime) -> None:
        self._now = moment
