"""Tests for k8s_ops module."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from kubernetes.client import V1ConfigMap, V1LoadBalancerIngress, V1LoadBalancerStatus
from kubernetes.client import V1ObjectMeta, V1Service, V1ServiceSpec, V1ServiceStatus
from kubernetes.client.exceptions import ApiException

from cli.k8s_ops import (
    _CONFIGMAP_CONSUMERS,
    _rewrite_client_env_js,
    apply_configmap,
    apply_manifests,
    apply_namespace,
    apply_secret,
    get_custom_dns_clusterip,
    get_lb_ip,
    get_traefik_clusterip,
    kubectl,
    patch_client_configmap,
    patch_configmap,
)
from cli.tests.conftest import constants, make_proc

_TRAEFIK_CONSUMERS = ("traefik", "traefik-forward-auth")


def _api_exc(status: int, body: str = "err") -> ApiException:
    """Build an ApiException with the given HTTP status."""
    exc = ApiException(status=status, reason="r")
    exc.body = body
    return exc


class TestKubectl:
    """Tests for kubectl() subprocess wrapper (still used by files_ops)."""

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


class TestApplyNamespace:
    """Tests for apply_namespace()."""

    def test_dry_run_does_not_call_api(self, tmp_path: Path) -> None:
        """Dry-run prints intent without invoking the API."""
        ns_file = tmp_path / "namespace.yaml"
        ns_file.write_text("apiVersion: v1\nkind: Namespace\nmetadata:\n  name: x\n")
        with patch("cli.k8s_ops.core_api") as mock_api:
            apply_namespace(str(tmp_path), dry_run=True)
        mock_api.assert_not_called()

    def test_creates_namespace(self, tmp_path: Path) -> None:
        """create_namespace is called with the parsed manifest body."""
        ns_file = tmp_path / "namespace.yaml"
        ns_file.write_text(
            "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: dtaas-workspace\n"
        )
        api = MagicMock()
        with patch("cli.k8s_ops.core_api", return_value=api):
            apply_namespace(str(tmp_path), dry_run=False)
        api.create_namespace.assert_called_once()
        body = api.create_namespace.call_args.kwargs["body"]
        assert body["metadata"]["name"] == "dtaas-workspace"

    def test_already_exists_is_not_an_error(
        self, tmp_path: Path, capsys: pytest.CaptureFixture
    ) -> None:
        """A 409 from create_namespace is handled gracefully."""
        ns_file = tmp_path / "namespace.yaml"
        ns_file.write_text("apiVersion: v1\nkind: Namespace\nmetadata:\n  name: x\n")
        api = MagicMock()
        api.create_namespace.side_effect = _api_exc(409)
        with patch("cli.k8s_ops.core_api", return_value=api):
            apply_namespace(str(tmp_path), dry_run=False)
        assert "already exists" in capsys.readouterr().out


class TestApplyManifests:
    """Tests for apply_manifests() — still uses kubectl for Kustomize."""

    def test_dry_run_does_not_call_kubectl(self) -> None:
        """Dry-run prints intent without invoking kubectl."""
        with patch("cli.k8s_ops.kubectl") as mock_kubectl:
            apply_manifests("/path/to/manifests", dry_run=True)
        mock_kubectl.assert_not_called()

    def test_applies_crds_then_bundle(self) -> None:
        """Applies CRDs first, then the full Kustomize bundle."""
        with patch("cli.k8s_ops.kubectl", return_value=make_proc()) as mock_kubectl:
            apply_manifests("/path/to/manifests", dry_run=False)
        calls = [c.args for c in mock_kubectl.call_args_list]
        assert calls[0] == ("apply", "-k", "/path/to/manifests/crds/")
        assert calls[1] == ("apply", "-k", "/path/to/manifests/")


class TestApplyConfigmap:
    """Tests for apply_configmap() upsert helper."""

    def test_creates_when_absent(self) -> None:
        """create_namespaced_config_map is called with the supplied data."""
        api = MagicMock()
        with patch("cli.k8s_ops.core_api", return_value=api):
            apply_configmap("cm", {"k": "v"}, dry_run=False)
        api.create_namespaced_config_map.assert_called_once()
        api.replace_namespaced_config_map.assert_not_called()

    def test_falls_back_to_replace_on_conflict(self) -> None:
        """A 409 conflict triggers a replace call with the same body."""
        api = MagicMock()
        api.create_namespaced_config_map.side_effect = _api_exc(409)
        with patch("cli.k8s_ops.core_api", return_value=api):
            apply_configmap("cm", {"k": "v"}, dry_run=False)
        api.replace_namespaced_config_map.assert_called_once()

    def test_non_conflict_error_exits(self) -> None:
        """Any status other than 409 propagates as SystemExit."""
        api = MagicMock()
        api.create_namespaced_config_map.side_effect = _api_exc(500)
        with patch("cli.k8s_ops.core_api", return_value=api):
            with pytest.raises(SystemExit):
                apply_configmap("cm", {"k": "v"}, dry_run=False)


class TestApplySecret:
    """Tests for apply_secret() upsert helper."""

    def test_passes_string_data(self) -> None:
        """The Secret body carries string_data set from the input dict."""
        api = MagicMock()
        with patch("cli.k8s_ops.core_api", return_value=api):
            apply_secret("s", {"K": "v"}, dry_run=False)
        body = api.create_namespaced_secret.call_args.args[1]
        assert body.string_data == {"K": "v"}

    def test_falls_back_to_replace_on_conflict(self) -> None:
        """A 409 conflict triggers replace_namespaced_secret."""
        api = MagicMock()
        api.create_namespaced_secret.side_effect = _api_exc(409)
        with patch("cli.k8s_ops.core_api", return_value=api):
            apply_secret("s", {"K": "v"}, dry_run=False)
        api.replace_namespaced_secret.assert_called_once()


class TestPatchConfigmap:
    """Tests for patch_configmap()."""

    def test_skips_when_no_matching_keys(self) -> None:
        """No API call is made when env has no recognised keys."""
        with patch("cli.k8s_ops.apply_configmap") as mock_apply:
            patch_configmap({}, dry_run=False)
        mock_apply.assert_not_called()

    def test_applies_and_restarts_all_consumers(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Applying the ConfigMap restarts every dependent deployment."""
        api = MagicMock()
        apps = MagicMock()
        with (
            patch("cli.k8s_ops.core_api", return_value=api),
            patch("cli.k8s_ops.apps_api", return_value=apps),
        ):
            patch_configmap({"SERVER_DNS": "example.com"}, dry_run=False)
        out = capsys.readouterr().out
        assert "Applied ConfigMap dtaas-config" in out
        for name in _CONFIGMAP_CONSUMERS:
            assert f"Restarted deployment/{name}" in out

    def test_restarts_traefik_after_acme_email_change(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Both traefik deployments are restarted so ACME_EMAIL refresh sticks."""
        # Regression guard: if traefik isn't restarted, Let's Encrypt keeps
        # rejecting the cached placeholder email and TLS stays on the
        # Traefik self-signed default cert.
        api = MagicMock()
        apps = MagicMock()
        with (
            patch("cli.k8s_ops.core_api", return_value=api),
            patch("cli.k8s_ops.apps_api", return_value=apps),
        ):
            patch_configmap(
                {"ACME_EMAIL": "admin@example.com"}, dry_run=False
            )
        out = capsys.readouterr().out
        for name in _TRAEFIK_CONSUMERS:
            assert f"Restarted deployment/{name}" in out

    def test_dry_run_does_not_call_api(self, capsys: pytest.CaptureFixture) -> None:
        """Dry-run prints intent without invoking the API client."""
        with (
            patch("cli.k8s_ops.core_api") as core,
            patch("cli.k8s_ops.apps_api") as apps,
        ):
            patch_configmap({"SERVER_DNS": "example.com"}, dry_run=True)
        out = capsys.readouterr().out
        assert "[dry-run]" in out
        core.assert_not_called()
        apps.assert_not_called()


def _svc(ip: str = "", hostname: str = "", clusterip: str = "") -> V1Service:
    """Build a Service object for get_lb_ip/_clusterip tests."""
    ingress = [V1LoadBalancerIngress(ip=ip or None, hostname=hostname or None)]
    return V1Service(
        metadata=V1ObjectMeta(name="x"),
        spec=V1ServiceSpec(cluster_ip=clusterip or None),
        status=V1ServiceStatus(load_balancer=V1LoadBalancerStatus(ingress=ingress)),
    )


class TestGetLbIp:
    """Tests for get_lb_ip()."""

    def test_returns_ip_when_available(self) -> None:
        """Returns the IP address from the LoadBalancer status."""
        ip = constants()["fake_lb_ip"]
        api = MagicMock()
        api.read_namespaced_service.return_value = _svc(ip=ip)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_lb_ip() == ip

    def test_falls_back_to_hostname(self) -> None:
        """Falls back to the hostname field when IP is empty (e.g. AWS ELB)."""
        hostname = constants()["fake_lb_hostname"]
        api = MagicMock()
        api.read_namespaced_service.return_value = _svc(hostname=hostname)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_lb_ip() == hostname

    def test_returns_empty_when_not_found(self) -> None:
        """Returns empty string when the Service lookup fails."""
        api = MagicMock()
        api.read_namespaced_service.side_effect = _api_exc(404)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_lb_ip() == ""


class TestGetTraefikClusterip:
    """Tests for get_traefik_clusterip()."""

    def test_returns_clusterip(self) -> None:
        """Returns the Traefik service ClusterIP."""
        ip = constants()["fake_traefik_clusterip"]
        api = MagicMock()
        api.read_namespaced_service.return_value = _svc(clusterip=ip)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_traefik_clusterip() == ip

    def test_returns_empty_on_error(self) -> None:
        """Returns empty string when the Service lookup fails."""
        api = MagicMock()
        api.read_namespaced_service.side_effect = _api_exc(404)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_traefik_clusterip() == ""


class TestGetCustomDnsClusterip:
    """Tests for get_custom_dns_clusterip()."""

    def test_returns_clusterip(self) -> None:
        """Returns the custom-dns service ClusterIP."""
        ip = constants()["fake_custom_dns_clusterip"]
        api = MagicMock()
        api.read_namespaced_service.return_value = _svc(clusterip=ip)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_custom_dns_clusterip() == ip

    def test_returns_empty_on_error(self) -> None:
        """Returns empty string when the Service lookup fails."""
        api = MagicMock()
        api.read_namespaced_service.side_effect = _api_exc(404)
        with patch("cli.k8s_ops.core_api", return_value=api):
            assert get_custom_dns_clusterip() == ""


def _cm_with_env_js(env_js: str) -> V1ConfigMap:
    return V1ConfigMap(metadata=V1ObjectMeta(name="client-config"), data={"env.js": env_js})


class TestPatchClientConfigmap:
    """Tests for patch_client_configmap()."""

    def test_skips_when_no_server_dns(self) -> None:
        """No API call when SERVER_DNS is absent from env."""
        with patch("cli.k8s_ops.core_api") as core:
            patch_client_configmap({}, dry_run=False)
        core.assert_not_called()

    def test_updates_url_in_env_js(self) -> None:
        """Replaces the domain in DTaaS-managed env.js URL entries."""
        api = MagicMock()
        api.read_namespaced_config_map.return_value = _cm_with_env_js(
            "REACT_APP_URL: 'https://old.example.com/'"
        )
        with patch("cli.k8s_ops.core_api", return_value=api):
            patch_client_configmap(
                {"SERVER_DNS": "new.example.com"}, dry_run=False
            )
        patch_body = api.patch_namespaced_config_map.call_args.args[2]
        assert "new.example.com" in patch_body["data"]["env.js"]

    def test_restarts_client_after_patch(self, capsys: pytest.CaptureFixture) -> None:
        """After patching client-config a rollout restart is issued."""
        api = MagicMock()
        api.read_namespaced_config_map.return_value = _cm_with_env_js(
            "REACT_APP_URL: 'https://YOUR_SERVER_DNS/'"
        )
        apps = MagicMock()
        with (
            patch("cli.k8s_ops.core_api", return_value=api),
            patch("cli.k8s_ops.apps_api", return_value=apps),
        ):
            patch_client_configmap(
                {"SERVER_DNS": "new.example.com"}, dry_run=False
            )
        out = capsys.readouterr().out
        assert "Restarted deployment/client" in out
        apps.patch_namespaced_deployment.assert_called_once()
        assert apps.patch_namespaced_deployment.call_args.args[0] == "client"

    def test_no_op_when_already_up_to_date(self, capsys: pytest.CaptureFixture) -> None:
        """Skips patch when the domain in env.js already matches."""
        api = MagicMock()
        api.read_namespaced_config_map.return_value = _cm_with_env_js(
            "REACT_APP_URL: 'https://new.example.com/'"
        )
        with patch("cli.k8s_ops.core_api", return_value=api):
            patch_client_configmap(
                {"SERVER_DNS": "new.example.com"}, dry_run=False
            )
        assert "already up to date" in capsys.readouterr().out
        api.patch_namespaced_config_map.assert_not_called()

    def test_replaces_placeholder_on_first_run(self) -> None:
        """The YOUR_SERVER_DNS placeholder is substituted on initial apply."""
        api = MagicMock()
        api.read_namespaced_config_map.return_value = _cm_with_env_js(
            "REACT_APP_URL: 'https://YOUR_SERVER_DNS/',\n"
            "REACT_APP_AUTH_AUTHORITY: 'https://YOUR_SERVER_DNS/auth/realms/dtaas',\n"
        )
        with patch("cli.k8s_ops.core_api", return_value=api):
            patch_client_configmap(
                {"SERVER_DNS": "dtaas.example.com"}, dry_run=False
            )
        env_js = api.patch_namespaced_config_map.call_args.args[2]["data"]["env.js"]
        assert "dtaas.example.com" in env_js
        assert "YOUR_SERVER_DNS" not in env_js


class TestRewriteClientEnvJs:
    """Tests for _rewrite_client_env_js()."""

    def test_replaces_placeholder(self) -> None:
        """Literal YOUR_SERVER_DNS occurrences are replaced."""
        result = _rewrite_client_env_js(
            "REACT_APP_URL: 'https://YOUR_SERVER_DNS/'", "dtaas.example.com"
        )
        assert "YOUR_SERVER_DNS" not in result
        assert "dtaas.example.com" in result

    def test_replaces_existing_fqdn(self) -> None:
        """A real FQDN already in place is replaced on re-run."""
        result = _rewrite_client_env_js(
            "REACT_APP_AUTH_AUTHORITY: 'https://old.example.com/auth/realms/dtaas'",
            "new.example.com",
        )
        assert "old.example.com" not in result
        assert "new.example.com" in result

    def test_preserves_unmanaged_urls(self) -> None:
        """URLs assigned to keys we do not manage are untouched."""
        env_js = (
            "REACT_APP_URL: 'https://YOUR_SERVER_DNS/',\n"
            "REACT_APP_ANALYTICS_URL: 'https://analytics.example.org/'"
        )
        result = _rewrite_client_env_js(env_js, "dtaas.example.com")
        assert "analytics.example.org" in result
        assert "dtaas.example.com" in result
