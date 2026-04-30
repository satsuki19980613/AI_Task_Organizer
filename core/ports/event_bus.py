"""Event bus port — how services emit domain events.

実装は infrastructure/eventing/ に置く。コンテナで購読を組み立てる。
コア側は subscribe を呼ばない（誰が反応するかを知らないのが原則）。

シンプルな同期 pub-sub で十分。非同期化が必要になった時にこの Protocol を
非同期版へ拡張する（その時はコア無変更、実装のみ差し替え）。
"""
from typing import Callable, Protocol, Type

from core.events import DomainEvent


EventHandler = Callable[[DomainEvent], None]


class EventBus(Protocol):
    def publish(self, event: DomainEvent) -> None: ...

    def subscribe(
        self,
        event_type: Type[DomainEvent],
        handler: EventHandler,
    ) -> None: ...
