"""Infrastructure-layer errors.

These are raised by adapters (DB repositories, AI engine implementations,
external API clients) and represent failures of the underlying technology
rather than domain rule violations.

Adapters MUST NOT let raw library exceptions (sqlite3.Error, subprocess
errors, requests.RequestException, ...) escape — they wrap them in one of
the types below so the application layer sees a stable contract.
"""


class InfrastructureError(Exception):
    """Base for failures originating outside the domain."""

    def __init__(self, message: str, *, cause: Exception | None = None):
        super().__init__(message)
        self.message = message
        self.cause = cause


class RepositoryError(InfrastructureError):
    """Persistence layer failed (DB I/O, schema mismatch, serialization)."""


class AIEngineError(InfrastructureError):
    """AI backend failed (subprocess crash, API error, timeout, parse error)."""


class AITimeoutError(AIEngineError):
    """AI backend did not respond within the configured timeout."""


class AIResponseFormatError(AIEngineError):
    """AI returned a payload that could not be parsed into the expected shape."""
