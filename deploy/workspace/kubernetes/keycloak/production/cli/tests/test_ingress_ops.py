"""Tests for ingress_ops module."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from kubernetes.client.exceptions import ApiException

from cli.ingress_ops import (
    INGRESSROUTE_FILES,
    patch_ingressroute_files,
    patch_ingressroutes,
)

_SINGLE_ITEM = {
    "items": [
        {
            "metadata": {"name": "dtaas-tls"},
            "spec": {"routes": [{"match": "Host(`old.example.com`)"}]},
        }
    ]
}

_NEW_DOMAIN_ITEM = {
    "items": [
        {
            "metadata": {"name": "dtaas-tls"},
            "spec": {"routes": [{"match": "Host(`new.example.com`)"}]},
        }
    ]
}


def _api_exc(status: int) -> ApiException:
    exc = ApiException(status=status, reason="r")
    exc.body = "err"
    return exc


class TestPatchIngressroutes:
    """Tests for patch_ingressroutes() (live-cluster patching)."""

    def test_dry_run_prints_patched_match(self, capsys: pytest.CaptureFixture) -> None:
        """Dry-run logs the patch intent without calling patch_namespaced_custom_object."""
        api = MagicMock()
        api.list_namespaced_custom_object.return_value = _SINGLE_ITEM
        with patch("cli.ingress_ops.custom_api", return_value=api):
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=True)
        out = capsys.readouterr().out
        assert "new.example.com" in out
        assert "[dry-run]" in out
        api.patch_namespaced_custom_object.assert_not_called()

    def test_live_run_applies_patch(self) -> None:
        """Live run calls patch_namespaced_custom_object for each modified IngressRoute."""
        api = MagicMock()
        api.list_namespaced_custom_object.return_value = _SINGLE_ITEM
        with patch("cli.ingress_ops.custom_api", return_value=api):
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
        api.patch_namespaced_custom_object.assert_called_once()
        kwargs = api.patch_namespaced_custom_object.call_args.kwargs
        assert kwargs["name"] == "dtaas-tls"
        assert "new.example.com" in kwargs["body"]["spec"]["routes"][0]["match"]

    def test_skips_when_no_server_dns(self) -> None:
        """No API call is made when SERVER_DNS is missing from env."""
        with patch("cli.ingress_ops.custom_api") as api:
            patch_ingressroutes({}, dry_run=False)
        api.assert_not_called()

    def test_handles_empty_ingressroutes(self) -> None:
        """No patch is attempted when the cluster has no IngressRoutes."""
        api = MagicMock()
        api.list_namespaced_custom_object.return_value = {"items": []}
        with patch("cli.ingress_ops.custom_api", return_value=api):
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
        api.patch_namespaced_custom_object.assert_not_called()

    def test_no_op_when_domain_already_matches(self) -> None:
        """Skips patch when IngressRoute already has the correct domain."""
        api = MagicMock()
        api.list_namespaced_custom_object.return_value = _NEW_DOMAIN_ITEM
        with patch("cli.ingress_ops.custom_api", return_value=api):
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
        api.patch_namespaced_custom_object.assert_not_called()

    def test_exits_on_list_error(self) -> None:
        """SystemExit is raised when listing IngressRoutes fails."""
        api = MagicMock()
        api.list_namespaced_custom_object.side_effect = _api_exc(500)
        with patch("cli.ingress_ops.custom_api", return_value=api):
            with pytest.raises(SystemExit):
                patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)

    def test_exits_on_patch_error(self) -> None:
        """SystemExit is raised when patch_namespaced_custom_object fails."""
        api = MagicMock()
        api.list_namespaced_custom_object.return_value = _SINGLE_ITEM
        api.patch_namespaced_custom_object.side_effect = _api_exc(500)
        with patch("cli.ingress_ops.custom_api", return_value=api):
            with pytest.raises(SystemExit):
                patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)


def _write_ingress_file(
    directory: Path, name: str, host: str, path_prefix: str
) -> Path:
    """Write a stub IngressRoute file with the given Host() and path."""
    target = directory / name
    target.write_text(
        "apiVersion: traefik.io/v1alpha1\n"
        "kind: IngressRoute\n"
        "spec:\n"
        "  routes:\n"
        f"    - match: Host(`{host}`) && PathPrefix(`{path_prefix}`)\n"
    )
    return target


class TestPatchIngressrouteFiles:
    """Tests for patch_ingressroute_files() (on-disk YAML patching)."""

    def test_skips_when_no_server_dns(self, tmp_path: Path) -> None:
        """File contents are untouched when SERVER_DNS is missing."""
        target = _write_ingress_file(
            tmp_path, INGRESSROUTE_FILES[0], "YOUR_SERVER_DNS", "/"
        )
        before = target.read_text()
        patch_ingressroute_files({}, tmp_path, dry_run=False)
        assert target.read_text() == before

    def test_rewrites_placeholder_to_real_domain(self, tmp_path: Path) -> None:
        """The YOUR_SERVER_DNS placeholder is replaced in every known file."""
        for name in INGRESSROUTE_FILES:
            _write_ingress_file(tmp_path, name, "YOUR_SERVER_DNS", "/x")
        patch_ingressroute_files(
            {"SERVER_DNS": "shared.example.com"}, tmp_path, dry_run=False
        )
        for name in INGRESSROUTE_FILES:
            content = (tmp_path / name).read_text()
            assert "YOUR_SERVER_DNS" not in content
            assert "shared.example.com" in content

    def test_rewrites_real_domain_on_rerun(self, tmp_path: Path) -> None:
        """A real FQDN already in place is replaced on subsequent runs."""
        target = _write_ingress_file(
            tmp_path, INGRESSROUTE_FILES[0], "old.example.com", "/"
        )
        patch_ingressroute_files(
            {"SERVER_DNS": "new.example.com"}, tmp_path, dry_run=False
        )
        content = target.read_text()
        assert "old.example.com" not in content
        assert "new.example.com" in content

    def test_preserves_path_prefix(self, tmp_path: Path) -> None:
        """PathPrefix( ) and other rule fragments are not modified."""
        target = _write_ingress_file(
            tmp_path, INGRESSROUTE_FILES[0], "old.example.com", "/keycloak"
        )
        patch_ingressroute_files(
            {"SERVER_DNS": "new.example.com"}, tmp_path, dry_run=False
        )
        assert "PathPrefix(`/keycloak`)" in target.read_text()

    def test_no_op_when_file_already_matches(
        self, tmp_path: Path, capsys: pytest.CaptureFixture
    ) -> None:
        """Files already containing the target host are left untouched."""
        target = _write_ingress_file(
            tmp_path, INGRESSROUTE_FILES[0], "new.example.com", "/"
        )
        before_mtime = target.stat().st_mtime_ns
        patch_ingressroute_files(
            {"SERVER_DNS": "new.example.com"}, tmp_path, dry_run=False
        )
        assert target.stat().st_mtime_ns == before_mtime
        assert "Rewrote" not in capsys.readouterr().out

    def test_dry_run_does_not_write(self, tmp_path: Path) -> None:
        """Dry-run does not modify file contents."""
        target = _write_ingress_file(
            tmp_path, INGRESSROUTE_FILES[0], "YOUR_SERVER_DNS", "/"
        )
        before = target.read_text()
        patch_ingressroute_files(
            {"SERVER_DNS": "shared.example.com"}, tmp_path, dry_run=True
        )
        assert target.read_text() == before

    def test_missing_files_are_ignored(self, tmp_path: Path) -> None:
        """An ingress directory that does not contain every file does not error."""
        _write_ingress_file(tmp_path, INGRESSROUTE_FILES[0], "YOUR_SERVER_DNS", "/")
        # No exception even though the other files are absent.
        patch_ingressroute_files(
            {"SERVER_DNS": "shared.example.com"}, tmp_path, dry_run=False
        )
