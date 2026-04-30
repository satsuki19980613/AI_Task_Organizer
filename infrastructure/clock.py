"""Clock 実装。"""
from datetime import date, datetime


class SystemClock:
    """`Clock` Protocol の標準実装。テスト用には `tests/fakes/clock.py` の FakeClock を使う。"""

    def now(self) -> datetime:
        return datetime.now()

    def today(self) -> date:
        return date.today()
