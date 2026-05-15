"""Shared test fixtures and helpers."""

import subprocess
from unittest.mock import MagicMock


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
