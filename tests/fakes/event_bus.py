"""RecordingEventBus — テスト時に発行イベントを記録するだけの EventBus。"""
from collections import defaultdict
from typing import Type

from core.events import DomainEvent
from core.ports.event_bus import EventHandler


class RecordingEventBus:
    def __init__(self) -> None:
        self.events: list[DomainEvent] = []
        self._handlers: dict[Type[DomainEvent], list[EventHandler]] = defaultdict(list)

    def publish(self, event: DomainEvent) -> None:
        self.events.append(event)
        for event_type, handlers in self._handlers.items():
            if isinstance(event, event_type):
                for h in handlers:
                    h(event)

    def subscribe(self, event_type, handler) -> None:
        self._handlers[event_type].append(handler)

    def types(self) -> list[type]:
        return [type(e) for e in self.events]
