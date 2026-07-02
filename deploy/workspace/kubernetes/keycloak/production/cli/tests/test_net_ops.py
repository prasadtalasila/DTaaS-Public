"""Tests for net_ops module."""

import socket
from unittest.mock import patch

import pytest

from cli.net_ops import resolve_dns, show_dns_fix_instructions
from cli.tests.conftest import constants


class TestResolveDns:
    """Tests for resolve_dns()."""

    def test_valid_hostname_returns_ip(self) -> None:
        """A resolvable hostname returns its IP address."""
        ip = constants()["fake_a_record_ip"]
        with patch("socket.gethostbyname", return_value=ip):
            assert resolve_dns("example.com") == ip

    def test_unknown_hostname_returns_empty_string(self) -> None:
        """An unresolvable hostname returns an empty string."""
        with patch("socket.gethostbyname", side_effect=socket.gaierror):
            assert resolve_dns("nonexistent.invalid") == ""


class TestShowDnsFixInstructions:
    """Tests for show_dns_fix_instructions()."""

    def test_output_contains_ip_and_domain(self, capsys: pytest.CaptureFixture) -> None:
        """Output includes the provided domain and IP."""
        ip = constants()["fake_lb_ip"]
        show_dns_fix_instructions("example.com", ip)
        out = capsys.readouterr().out
        assert "example.com" in out
        assert ip in out

    def test_output_contains_a_record_guidance(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Output includes A record type and TTL guidance."""
        ip = constants()["fake_a_record_ip"]
        show_dns_fix_instructions("my.domain", ip)
        out = capsys.readouterr().out
        assert "Type : A" in out
        assert "TTL" in out
