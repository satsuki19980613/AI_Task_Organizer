"""同期 in-memory pub-sub。

シンプルなスレッド非対応実装で十分。Flask は `threading` モードで動作するが、
イベント発行は services 内（リクエスト処理スレッド）で起き、購読者も同スレッドで
即時実行されるためロック不要。

非同期化や永続キュー化が必要になった時は EventBus Protocol を変えずに別実装
（infrastructure/eventing/celery_bus.py 等）に差し替える。
"""
from collections import defaultdict
from typing import Type

from core.events import DomainEvent
from core.ports.event_bus import EventHandler


class InMemoryEventBus:
    def __init__(self) -> None:
        self._handlers: dict[Type[DomainEvent], list[EventHandler]] = defaultdict(list)

    def publish(self, event: DomainEvent) -> None:
        # 完全一致のハンドラと、基底クラス購読のハンドラの両方に配信
        for event_type, handlers in self._handlers.items():
            if isinstance(event, event_type):
                for handler in handlers:
                    handler(event)

    def subscribe(
        self,
        event_type: Type[DomainEvent],
        handler: EventHandler,
    ) -> None:
        self._handlers[event_type].append(handler)
