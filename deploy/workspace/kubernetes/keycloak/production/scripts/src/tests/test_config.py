"""Tests for config.py – load_env and CLI commands."""

from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from src.config import cli, load_env


class TestLoadEnv:
    """Tests for load_env()."""

    def test_parses_key_value_pairs(self, tmp_path: Path) -> None:
        """KEY=value lines are parsed into a dict."""
        env_file = tmp_path / ".env"
        env_file.write_text("SERVER_DNS=example.com\nUSERNAME1=user1\n")
        result = load_env(env_file)
        assert result["SERVER_DNS"] == "example.com"
        assert result["USERNAME1"] == "user1"

    def test_skips_comments_and_blanks(self, tmp_path: Path) -> None:
        """Lines starting with # and blank lines are ignored."""
        env_file = tmp_path / ".env"
        env_file.write_text("# comment\n\nKEY=value\n")
        result = load_env(env_file)
        assert "# comment" not in result
        assert result["KEY"] == "value"

    def test_exits_when_file_missing(self) -> None:
        """SystemExit is raised when the env file does not exist."""
        with pytest.raises(SystemExit):
            load_env(Path("/nonexistent/.env"))

    def test_handles_value_with_equals_sign(self, tmp_path: Path) -> None:
        """Values containing '=' are preserved intact."""
        env_file = tmp_path / ".env"
        env_file.write_text("SECRET=abc=def\n")
        result = load_env(env_file)
        assert result["SECRET"] == "abc=def"

    def test_strips_surrounding_quotes(self, tmp_path: Path) -> None:
        """Single and double quotes around values are stripped."""
        env_file = tmp_path / ".env"
        env_file.write_text(
            'DOUBLE="hello"\nSINGLE=\'world\'\nMIXED="don\'t"\nUNCLOSED="oops\n'
        )
        result = load_env(env_file)
        assert result["DOUBLE"] == "hello"
        assert result["SINGLE"] == "world"
        assert result["MIXED"] == "don't"
        # Unbalanced quotes are left intact rather than silently mangled.
        assert result["UNCLOSED"] == '"oops'


class TestApplyCmd:
    """Tests for the `apply` CLI command."""

    def test_apply_calls_patch_functions(self, tmp_path: Path) -> None:
        """The apply command invokes all configuration patch helpers."""
        env_file = tmp_path / ".env"
        env_file.write_text(
            "SERVER_DNS=example.com\nACME_EMAIL=a@b.com\n"
            "USERNAME1=user1\nUSERNAME2=user2\n"
        )
        runner = CliRunner()
        with (
            patch("src.config.patch_configmap") as pc,
            patch("src.config.patch_ingressroutes") as pi,
            patch("src.config.patch_client_configmap") as pcc,
            patch("src.config._apply_custom_dns") as acd,
            patch("src.config.apply_keycloak_secret") as aks,
            patch("src.config.apply_forward_auth_secret") as afas,
        ):
            result = runner.invoke(cli, ["apply", "--env-file", str(env_file)])
        assert result.exit_code == 0, result.output
        pc.assert_called_once()
        pi.assert_called_once()
        pcc.assert_called_once()
        acd.assert_called_once()
        aks.assert_called_once()
        afas.assert_called_once()

    def test_apply_dry_run_flag(self, tmp_path: Path) -> None:
        """The --dry-run flag is forwarded to all patch helpers."""
        env_file = tmp_path / ".env"
        env_file.write_text("SERVER_DNS=example.com\n")
        runner = CliRunner()
        with (
            patch("src.config.patch_configmap"),
            patch("src.config.patch_ingressroutes"),
            patch("src.config.patch_client_configmap"),
            patch("src.config._apply_custom_dns") as acd,
            patch("src.config.apply_keycloak_secret"),
            patch("src.config.apply_forward_auth_secret"),
        ):
            runner.invoke(cli, ["apply", "--dry-run", "--env-file", str(env_file)])
        args, kwargs = acd.call_args
        assert args[1] is True or kwargs.get("dry_run") is True


class TestNetworkShow:
    """Tests for the `network show` CLI command."""

    def test_shows_match_when_dns_correct(self, tmp_path: Path) -> None:
        """Outputs a checkmark when LB IP and DNS resolve to the same address."""
        env_file = tmp_path / ".env"
        env_file.write_text("SERVER_DNS=example.com\n")
        runner = CliRunner()
        with (
            patch("src.config.get_lb_ip", return_value="1.2.3.4"),
            patch("src.config.resolve_dns", return_value="1.2.3.4"),
        ):
            result = runner.invoke(
                cli, ["network", "show", "--env-file", str(env_file)]
            )
        assert result.exit_code == 0
        assert "✓" in result.output

    def test_exits_on_dns_mismatch(self, tmp_path: Path) -> None:
        """Exits non-zero when LB IP and DNS A record differ."""
        env_file = tmp_path / ".env"
        env_file.write_text("SERVER_DNS=example.com\n")
        runner = CliRunner()
        with (
            patch("src.config.get_lb_ip", return_value="1.2.3.4"),
            patch("src.config.resolve_dns", return_value="9.9.9.9"),
            patch("src.config.show_dns_fix_instructions"),
        ):
            result = runner.invoke(
                cli, ["network", "show", "--env-file", str(env_file)]
            )
        assert result.exit_code != 0

    def test_exits_when_server_dns_missing(self, tmp_path: Path) -> None:
        """Exits non-zero when SERVER_DNS is absent from the env file."""
        env_file = tmp_path / ".env"
        env_file.write_text("USERNAME1=user1\n")
        runner = CliRunner()
        result = runner.invoke(cli, ["network", "show", "--env-file", str(env_file)])
        assert result.exit_code != 0

    def test_resolves_lb_hostname_for_comparison(self, tmp_path: Path) -> None:
        """An LB hostname is resolved to an IP before comparing with DNS."""
        env_file = tmp_path / ".env"
        env_file.write_text("SERVER_DNS=example.com\n")
        runner = CliRunner()
        resolve_calls = {"calls": 0}

        def _resolve(_hostname: str) -> str:
            resolve_calls["calls"] += 1
            return "1.2.3.4"

        with (
            patch("src.config.get_lb_ip", return_value="my-elb.aws.example.com"),
            patch("src.config.resolve_dns", side_effect=_resolve),
        ):
            result = runner.invoke(
                cli, ["network", "show", "--env-file", str(env_file)]
            )
        assert result.exit_code == 0
        # Both the SERVER_DNS *and* the LB hostname must have been resolved.
        assert resolve_calls["calls"] == 2
        assert "✓" in result.output
