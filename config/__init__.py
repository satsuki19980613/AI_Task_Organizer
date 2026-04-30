"""Config package — re-exports settings and constants for backward compat.

Existing code imports as `from config import X`. Until callers migrate to
`from config.settings import X` / `from config.constants import X`, this
module preserves that flat namespace.
"""
from config.settings import *  # noqa: F401,F403
from config.constants import *  # noqa: F401,F403
