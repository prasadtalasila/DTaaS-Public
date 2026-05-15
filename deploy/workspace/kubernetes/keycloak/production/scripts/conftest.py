"""Pytest configuration: add scripts/ to the module search path."""

import sys
from pathlib import Path

# Allow `import src.config` etc. from tests
sys.path.insert(0, str(Path(__file__).parent))
