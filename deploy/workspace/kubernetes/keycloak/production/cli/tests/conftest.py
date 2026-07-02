"""Shared test fixtures and helpers."""

import json
import subprocess
from functools import lru_cache
from pathlib import Path
from unittest.mock import MagicMock


@lru_cache(maxsize=1)
def constants() -> dict[str, str]:
    """Return the test constants loaded from ``tests/constants.json``.

    Centralising IP addresses, hostnames, and other sample values keeps
    SonarQube happy (no inline literals) and lets the whole suite share
    the same fixtures.
    """
    path = Path(__file__).parent / "constants.json"
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def make_proc(
    stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0
) -> MagicMock:
    """Create a mock CompletedProcess for use in tests.

    Args:
        stdout: Simulated stdout bytes.
        stderr: Simulated stderr bytes.
        returncode: Simulated return code.

    Returns:
        MagicMock configured as CompletedProcess.
    """
    proc = MagicMock(spec=subprocess.CompletedProcess)
    proc.stdout = stdout
    proc.stderr = stderr
    proc.returncode = returncode
    return proc
