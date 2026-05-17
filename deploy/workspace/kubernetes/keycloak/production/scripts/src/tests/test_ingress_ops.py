"""Tests for ingress_ops module."""

import json
from unittest.mock import patch

import pytest

from src.ingress_ops import patch_ingressroutes
from src.tests.conftest import make_proc

_SINGLE_ITEM_JSON = json.dumps(
    {
        "items": [
            {
                "metadata": {"name": "dtaas-tls"},
                "spec": {"routes": [{"match": "Host(`old.example.com`)"}]},
            }
        ]
    }
).encode()

_NEW_DOMAIN_JSON = json.dumps(
    {
        "items": [
            {
                "metadata": {"name": "dtaas-tls"},
                "spec": {"routes": [{"match": "Host(`new.example.com`)"}]},
            }
        ]
    }
).encode()

_EMPTY_ITEMS_JSON = json.dumps({"items": []}).encode()


class TestPatchIngressroutes:
    """Tests for patch_ingressroutes()."""

    def test_dry_run_prints_patched_yaml(self, capsys: pytest.CaptureFixture) -> None:
        """Dry-run logs the patch intent without calling kubectl patch."""
        with patch(
            "src.ingress_ops.kubectl", return_value=make_proc(stdout=_SINGLE_ITEM_JSON)
        ):
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=True)
        out = capsys.readouterr().out
        assert "new.example.com" in out
        assert "[dry-run]" in out

    def test_live_run_applies_patch(self) -> None:
        """Live run calls kubectl patch for each modified IngressRoute."""
        with patch("src.ingress_ops.kubectl") as mock_kubectl:
            mock_kubectl.return_value = make_proc(stdout=_SINGLE_ITEM_JSON)
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
        patch_calls = [c for c in mock_kubectl.call_args_list if "patch" in str(c)]
        assert len(patch_calls) >= 1

    def test_skips_when_no_server_dns(self) -> None:
        """No kubectl call is made when SERVER_DNS is missing from env."""
        with patch("src.ingress_ops.kubectl") as mock_kubectl:
            patch_ingressroutes({}, dry_run=False)
        mock_kubectl.assert_not_called()

    def test_handles_empty_ingressroutes(self) -> None:
        """No patch is attempted when the cluster has no IngressRoutes."""
        with patch("src.ingress_ops.kubectl") as mock_kubectl:
            mock_kubectl.return_value = make_proc(stdout=_EMPTY_ITEMS_JSON)
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
        patch_calls = [c for c in mock_kubectl.call_args_list if "patch" in str(c)]
        assert len(patch_calls) == 0

    def test_no_op_when_domain_already_matches(self) -> None:
        """Skips patch when IngressRoute already has the correct domain."""
        with patch("src.ingress_ops.kubectl") as mock_kubectl:
            mock_kubectl.return_value = make_proc(stdout=_NEW_DOMAIN_JSON)
            patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
        patch_calls = [c for c in mock_kubectl.call_args_list if "patch" in str(c)]
        assert len(patch_calls) == 0

    def test_exits_on_kubectl_error(self) -> None:
        """SystemExit is raised when kubectl get ingressroute fails."""
        with patch(
            "src.ingress_ops.kubectl",
            return_value=make_proc(returncode=1, stderr=b"err"),
        ):
            with pytest.raises(SystemExit):
                patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)

    def test_exits_on_patch_error(self) -> None:
        """SystemExit is raised when kubectl patch returns non-zero."""

        def side_effect(*args: str, **_kwargs: object) -> object:
            """First call returns items, second call (patch) returns an error."""
            if "get" in args:
                return make_proc(stdout=_SINGLE_ITEM_JSON)
            return make_proc(returncode=1, stderr=b"patch failed")

        with patch("src.ingress_ops.kubectl", side_effect=side_effect):
            with pytest.raises(SystemExit):
                patch_ingressroutes({"SERVER_DNS": "new.example.com"}, dry_run=False)
