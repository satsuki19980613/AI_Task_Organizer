"""Domain error hierarchy.

Anything raised inside `core/` MUST be a `DomainError` subclass. This is the
contract that lets the web (or any other) interface translate failures into
its own protocol (HTTP status codes, voice replies, etc.) without leaking
infrastructure details.

Infrastructure-layer errors (DB I/O, AI engine failures) are defined in
`infrastructure/errors.py` and converted at the boundary.
"""


class DomainError(Exception):
    """Base for all errors that originate in the domain layer."""

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code or self.__class__.__name__


class ValidationError(DomainError):
    """Input violates a domain invariant or business rule."""


class NotFoundError(DomainError):
    """Requested entity does not exist."""


class ConflictError(DomainError):
    """Operation conflicts with current state (e.g. illegal status transition)."""


class PermissionError_(DomainError):  # avoid shadowing builtin
    """Caller is not allowed to perform this operation."""
