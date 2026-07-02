"""Tests for files_ops module."""

from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

from cli.config import cli
from cli.files_ops import _resolve_user_pvc, files_group
from cli.tests.conftest import make_proc


class TestResolveUserPvc:
    """Tests for _resolve_user_pvc()."""

    def test_short_label(self) -> None:
        """A bare ``user1`` is expanded to ``workspace-user1``."""
        assert _resolve_user_pvc("user1") == "workspace-user1"

    def test_already_prefixed(self) -> None:
        """A ``workspace-*`` label is returned unchanged."""
        assert _resolve_user_pvc("workspace-common") == "workspace-common"


class TestFilesSeedDryRun:
    """Tests for ``files seed`` in dry-run mode."""

    def test_dry_run_does_not_call_kubectl(self, tmp_path: Path) -> None:
        """No kubectl call is made in dry-run; intent is logged."""
        source = tmp_path / "files" / "template"
        source.mkdir(parents=True)
        runner = CliRunner()
        with patch("cli.files_ops.kubectl") as mock_kubectl:
            result = runner.invoke(
                files_group,
                [
                    "seed",
                    "--pvc",
                    "workspace-user1",
                    "--source",
                    str(source),
                    "--dry-run",
                ],
            )
        assert result.exit_code == 0, result.output
        mock_kubectl.assert_not_called()
        assert "[dry-run]" in result.output

    def test_seed_exits_when_source_missing(self, tmp_path: Path) -> None:
        """A missing source directory is a hard error."""
        runner = CliRunner()
        result = runner.invoke(
            files_group,
            [
                "seed",
                "--pvc",
                "workspace-user1",
                "--source",
                str(tmp_path / "nope"),
            ],
        )
        assert result.exit_code != 0


class TestFilesSeedAll:
    """Tests for ``files seed-all`` in dry-run mode."""

    def test_seeds_common_and_users(self, tmp_path: Path) -> None:
        """seed-all dry-run touches workspace-common and per-user PVCs."""
        files_dir = tmp_path / "files"
        (files_dir / "common").mkdir(parents=True)
        (files_dir / "template").mkdir(parents=True)
        runner = CliRunner()
        with patch("cli.files_ops.kubectl") as mock_kubectl:
            result = runner.invoke(
                files_group,
                [
                    "seed-all",
                    "--files-dir",
                    str(files_dir),
                    "--user",
                    "user1",
                    "--user",
                    "user2",
                    "--dry-run",
                ],
            )
        assert result.exit_code == 0, result.output
        mock_kubectl.assert_not_called()
        assert "workspace-common" in result.output
        assert "workspace-user1" in result.output
        assert "workspace-user2" in result.output


class TestFilesGroupRegistered:
    """The files group is reachable from the top-level CLI."""

    def test_files_group_listed(self) -> None:
        """``cli files --help`` succeeds and lists the sub-commands."""
        runner = CliRunner()
        result = runner.invoke(cli, ["files", "--help"])
        assert result.exit_code == 0, result.output
        for cmd in ("seed", "dump", "fix-permissions", "seed-all", "dump-all"):
            assert cmd in result.output


class TestFilesFixPermissionsDryRun:
    """Tests for ``files fix-permissions`` in dry-run mode."""

    def test_dry_run_does_not_call_kubectl(self) -> None:
        """No kubectl call is made when --dry-run is passed."""
        runner = CliRunner()
        with patch("cli.files_ops.kubectl") as mock_kubectl:
            result = runner.invoke(
                files_group,
                ["fix-permissions", "--pvc", "workspace-user1", "--dry-run"],
            )
        assert result.exit_code == 0, result.output
        mock_kubectl.assert_not_called()
        assert "1000:100" in result.output


class TestFilesDumpDryRun:
    """Tests for ``files dump`` in dry-run mode."""

    def test_dry_run_does_not_call_kubectl(self, tmp_path: Path) -> None:
        """No kubectl call is made when --dry-run is passed."""
        runner = CliRunner()
        dest = tmp_path / "out"
        with patch("cli.files_ops.kubectl") as mock_kubectl:
            result = runner.invoke(
                files_group,
                ["dump", "--pvc", "workspace-user1", "--dest", str(dest), "--dry-run"],
            )
        assert result.exit_code == 0, result.output
        mock_kubectl.assert_not_called()


class TestFilesSeedLive:
    """Smoke test the live ``files seed`` path with mocked kubectl."""

    def test_starts_pod_copies_and_deletes(self, tmp_path: Path) -> None:
        """The command starts a pod, copies, fixes ownership, deletes."""
        source = tmp_path / "files" / "template"
        source.mkdir(parents=True)
        runner = CliRunner()
        with patch("cli.files_ops.kubectl") as mock_kubectl:
            mock_kubectl.return_value = make_proc()
            result = runner.invoke(
                files_group,
                ["seed", "--pvc", "workspace-user1", "--source", str(source)],
            )
        assert result.exit_code == 0, result.output
        calls = " ".join(str(c) for c in mock_kubectl.call_args_list)
        assert "run" in calls and "wait" in calls
        assert "cp" in calls
        assert "exec" in calls and "chown" in calls
        assert "delete" in calls
