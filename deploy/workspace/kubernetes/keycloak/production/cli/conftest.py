"""Pytest configuration: add the cli/ parent directory to sys.path.

This lets tests use ``from cli.<module> import ...`` whether they are
collected from the project root or from inside ``cli/``.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
