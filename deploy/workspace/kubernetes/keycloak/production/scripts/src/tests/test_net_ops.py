"""Tests for net_ops module."""

import socket
from unittest.mock import patch

import pytest

from src.net_ops import resolve_dns, show_dns_fix_instructions


class TestResolveDns:
    """Tests for resolve_dns()."""

    def test_valid_hostname_returns_ip(self) -> None:
        """A resolvable hostname returns its IP address."""
        with patch("socket.gethostbyname", return_value="1.2.3.4"):
            assert resolve_dns("example.com") == "1.2.3.4"

    def test_unknown_hostname_returns_empty_string(self) -> None:
        """An unresolvable hostname returns an empty string."""
        with patch("socket.gethostbyname", side_effect=socket.gaierror):
            assert resolve_dns("nonexistent.invalid") == ""


class TestShowDnsFixInstructions:
    """Tests for show_dns_fix_instructions()."""

    def test_output_contains_ip_and_domain(self, capsys: pytest.CaptureFixture) -> None:
        """Output includes the provided domain and IP."""
        show_dns_fix_instructions("example.com", "1.2.3.4")
        out = capsys.readouterr().out
        assert "example.com" in out
        assert "1.2.3.4" in out

    def test_output_contains_a_record_guidance(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Output includes A record type and TTL guidance."""
        show_dns_fix_instructions("my.domain", "5.6.7.8")
        out = capsys.readouterr().out
        assert "Type : A" in out
        assert "TTL" in out
