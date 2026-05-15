"""Tests for k8s_ops module."""

import json
from unittest.mock import patch

import pytest

from src.k8s_ops import (
    apply_yaml,
    get_custom_dns_clusterip,
    get_lb_ip,
    get_traefik_clusterip,
    kubectl,
    patch_client_configmap,
    patch_configmap,
    secret_yaml,
)
from src.tests.conftest import make_proc


class TestKubectl:
    """Tests for kubectl() wrapper."""

    def test_calls_kubectl_binary(self) -> None:
        """kubectl() invokes the kubectl binary with provided args."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = make_proc()
            kubectl("get", "pods")
            args = mock_run.call_args[0][0]
            assert args[0] == "kubectl"
            assert "get" in args
            assert "pods" in args

    def test_passes_stdin(self) -> None:
        """kubectl() forwards the stdin keyword argument."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = make_proc()
            kubectl("apply", "-f", "-", stdin=b"yaml")
            _, kwargs = mock_run.call_args
            assert kwargs["input"] == b"yaml"


class TestApplyYaml:
    """Tests for apply_yaml()."""

    def test_dry_run_prints_yaml(self, capsys: pytest.CaptureFixture) -> None:
        """Dry-run prints the YAML content without calling kubectl."""
        apply_yaml(b"kind: ConfigMap", dry_run=True, label="test-cm")
        out = capsys.readouterr().out
        assert "[dry-run]" in out
        assert "kind: ConfigMap" in out

    def test_success_prints_applied(self, capsys: pytest.CaptureFixture) -> None:
        """A successful apply prints a confirmation message."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc()):
            apply_yaml(b"kind: ConfigMap", dry_run=False, label="test-cm")
        assert "Applied test-cm" in capsys.readouterr().out

    def test_failure_exits(self) -> None:
        """A failed apply calls sys.exit with a non-zero code."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stderr=b"err", returncode=1)):
            with pytest.raises(SystemExit):
                apply_yaml(b"bad yaml", dry_run=False, label="test-cm")


class TestSecretYaml:
    """Tests for secret_yaml()."""

    def test_generates_secret_yaml(self) -> None:
        """secret_yaml() returns YAML bytes from kubectl dry-run."""
        yaml_output = b"apiVersion: v1\nkind: Secret\n"
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=yaml_output)):
            result = secret_yaml("my-secret", {"KEY": "value"})
        assert result == yaml_output

    def test_exits_on_error(self) -> None:
        """secret_yaml() exits when kubectl returns a non-zero code."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stderr=b"err", returncode=1)):
            with pytest.raises(SystemExit):
                secret_yaml("bad-secret", {})


class TestPatchConfigmap:
    """Tests for patch_configmap()."""

    def test_skips_when_no_matching_keys(self) -> None:
        """No kubectl call is made when env has no recognised keys."""
        with patch("src.k8s_ops.kubectl") as mock_kubectl:
            patch_configmap({}, dry_run=False)
        mock_kubectl.assert_not_called()

    def test_applies_configmap_and_restarts(self, capsys: pytest.CaptureFixture) -> None:
        """Applying the ConfigMap also restarts dependent deployments."""
        cm_yaml = b"kind: ConfigMap\n"
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=cm_yaml)):
            patch_configmap({"SERVER_DNS": "example.com"}, dry_run=False)
        out = capsys.readouterr().out
        assert "Applied ConfigMap dtaas-config" in out
        assert "Restarted deployment/keycloak" in out
        assert "Restarted deployment/user1" in out
        assert "Restarted deployment/user2" in out

    def test_dry_run_does_not_call_kubectl(self, capsys: pytest.CaptureFixture) -> None:
        """Dry-run prints intent without calling kubectl for the patch."""
        cm_yaml = b"kind: ConfigMap\n"
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=cm_yaml)):
            patch_configmap({"SERVER_DNS": "example.com"}, dry_run=True)
        out = capsys.readouterr().out
        assert "[dry-run]" in out


class TestGetLbIp:
    """Tests for get_lb_ip()."""

    def test_returns_ip_when_available(self) -> None:
        """Returns the IP address from the LoadBalancer status."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=b"1.2.3.4")):
            assert get_lb_ip() == "1.2.3.4"

    def test_falls_back_to_hostname(self) -> None:
        """Falls back to the hostname field when IP is empty (e.g. AWS ELB)."""
        def side_effect(*args: str, **_kwargs: object) -> object:
            """Return empty for IP lookup, hostname for hostname lookup."""
            jsonpath = next((a for a in args if "jsonpath" in a), "")
            if ".ip}" in jsonpath:
                return make_proc(stdout=b"")
            return make_proc(stdout=b"my-lb.aws.example.com")

        with patch("src.k8s_ops.kubectl", side_effect=side_effect):
            assert get_lb_ip() == "my-lb.aws.example.com"

    def test_returns_empty_when_not_found(self) -> None:
        """Returns an empty string when both IP and hostname are absent."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=b"")):
            assert get_lb_ip() == ""


class TestGetTraefikClusterip:
    """Tests for get_traefik_clusterip()."""

    def test_returns_clusterip(self) -> None:
        """Returns the Traefik service ClusterIP."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=b"10.0.0.1")):
            assert get_traefik_clusterip() == "10.0.0.1"

    def test_returns_empty_on_error(self) -> None:
        """Returns empty string when kubectl fails."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(returncode=1)):
            assert get_traefik_clusterip() == ""


class TestGetCustomDnsClusterip:
    """Tests for get_custom_dns_clusterip()."""

    def test_returns_clusterip(self) -> None:
        """Returns the custom-dns service ClusterIP."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=b"10.0.0.2")):
            assert get_custom_dns_clusterip() == "10.0.0.2"

    def test_returns_empty_on_error(self) -> None:
        """Returns empty string when kubectl fails."""
        with patch("src.k8s_ops.kubectl", return_value=make_proc(returncode=1)):
            assert get_custom_dns_clusterip() == ""


class TestPatchClientConfigmap:
    """Tests for patch_client_configmap()."""

    def test_skips_when_no_server_dns(self) -> None:
        """No kubectl call when SERVER_DNS is absent from env."""
        with patch("src.k8s_ops.kubectl") as mock_kubectl:
            patch_client_configmap({}, dry_run=False)
        mock_kubectl.assert_not_called()

    def test_updates_url_in_env_js(self) -> None:
        """Replaces the domain in the env.js ConfigMap data."""
        env_js = "window.env = { url: 'https://old.example.com/' };"
        cm_json = json.dumps({"data": {"env.js": env_js}}).encode()
        with patch("src.k8s_ops.kubectl") as mock_kubectl:
            mock_kubectl.return_value = make_proc(stdout=cm_json)
            patch_client_configmap({"SERVER_DNS": "new.example.com"}, dry_run=False)
        patch_call = mock_kubectl.call_args_list[-1]
        assert "new.example.com" in str(patch_call)

    def test_no_op_when_already_up_to_date(self, capsys: pytest.CaptureFixture) -> None:
        """Skips patch when the domain in env.js already matches."""
        env_js = "window.env = { url: 'https://new.example.com/' };"
        cm_json = json.dumps({"data": {"env.js": env_js}}).encode()
        with patch("src.k8s_ops.kubectl", return_value=make_proc(stdout=cm_json)):
            patch_client_configmap({"SERVER_DNS": "new.example.com"}, dry_run=False)
        assert "already up to date" in capsys.readouterr().out
