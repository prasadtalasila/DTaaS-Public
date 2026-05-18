"""Kubernetes operations for DTaaS configuration management.

Most operations use the official ``kubernetes`` Python client (the
``CoreV1Api``, ``AppsV1Api`` and ``CustomObjectsApi`` classes). Two
paths still shell out to ``kubectl``:

* :func:`apply_manifests` runs ``kubectl apply -k`` because Kustomize
  is not part of the Python client.
* :func:`kubectl` is preserved as a thin subprocess wrapper used by
  ``files_ops.py`` for ``kubectl run``/``cp``/``exec``/``wait``
  helper-pod orchestration, which is awkward to replicate via the API.
"""

import re
import subprocess
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import cast

import click
import yaml
from kubernetes import client, config
from kubernetes.client.exceptions import ApiException

NAMESPACE = "dtaas-workspace"
KUBECTL_TIMEOUT = 60
PLACEHOLDER_SERVER_DNS = "YOUR_SERVER_DNS"
HTTP_CONFLICT = 409
HTTP_NOT_FOUND = 404

# Deployments whose pods consume the dtaas-config ConfigMap via env vars.
# Kubernetes does not auto-roll pods when a ConfigMap they reference via
# envFrom/valueFrom changes, so an explicit rollout restart is required.
# Traefik in particular must be restarted: it caches ACME_EMAIL at start
# and silently keeps issuing self-signed certs if Let's Encrypt rejected
# the original (placeholder) email.
_CONFIGMAP_CONSUMERS = (
    "keycloak",
    "traefik",
    "traefik-forward-auth",
    "user1",
    "user2",
)


@lru_cache(maxsize=1)
def _load_kube_config() -> None:
    """Load kubeconfig once per process (in-cluster, falling back to file)."""
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()


def core_api() -> client.CoreV1Api:
    """Return a CoreV1Api client (loads kubeconfig on first call)."""
    _load_kube_config()
    return client.CoreV1Api()


def apps_api() -> client.AppsV1Api:
    """Return an AppsV1Api client (loads kubeconfig on first call)."""
    _load_kube_config()
    return client.AppsV1Api()


def custom_api() -> client.CustomObjectsApi:
    """Return a CustomObjectsApi client (loads kubeconfig on first call)."""
    _load_kube_config()
    return client.CustomObjectsApi()


def kubectl(*args: str, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    """Run kubectl with the given arguments.

    Retained for ``files_ops.py`` (kubectl cp / exec / wait) and the
    Kustomize-based :func:`apply_manifests` path.

    Args:
        args: kubectl subcommand arguments.
        stdin: Optional bytes to pass to stdin.

    Returns:
        The completed process result.
    """
    return subprocess.run(
        ["kubectl", *args],
        input=stdin,
        capture_output=True,
        check=False,
        timeout=KUBECTL_TIMEOUT,
    )


def _api_error_message(exc: ApiException) -> str:
    """Pull a short human-readable message out of an ApiException."""
    return exc.body or exc.reason or str(exc)


def apply_namespace(manifests_dir: str, dry_run: bool) -> None:
    """Apply the ``namespace.yaml`` manifest via the Python client.

    Args:
        manifests_dir: Path to the ``manifests/`` directory.
        dry_run: If True, print the action instead of executing it.
    """
    target = Path(manifests_dir) / "namespace.yaml"
    doc = yaml.safe_load(target.read_text())
    name = doc["metadata"]["name"]
    label = f"namespace/{name}"
    if dry_run:
        click.echo(f"[dry-run] Would apply {label} from {target}")
        return
    try:
        core_api().create_namespace(body=doc)
    except ApiException as exc:
        if exc.status == HTTP_CONFLICT:
            click.echo(f"{label} already exists.")
            return
        click.echo(f"Error applying {label}: {_api_error_message(exc)}", err=True)
        sys.exit(1)
    click.echo(f"Applied {label}.")


def apply_manifests(manifests_dir: str, dry_run: bool) -> None:
    """Apply Traefik CRDs then the full Kustomize bundle.

    The CRDs must be registered with the API server before any of the
    ``traefik.io/*`` objects (``IngressRoute``, ``Middleware`` …) can be
    created, so they are applied in their own pass. The Python client
    has no Kustomize support, so this step uses ``kubectl apply -k``.

    Args:
        manifests_dir: Path to the ``manifests/`` directory.
        dry_run: If True, print kubectl command instead of running it.
    """
    crds_path = f"{manifests_dir}/crds/"
    bundle_path = f"{manifests_dir}/"
    if dry_run:
        click.echo(f"[dry-run] Would apply CRDs at {crds_path}")
        click.echo(f"[dry-run] Would apply Kustomize bundle at {bundle_path}")
        return
    for label, path in (("CRDs", crds_path), ("manifests", bundle_path)):
        result = kubectl("apply", "-k", path)
        if result.returncode != 0:
            click.echo(
                f"Error applying {label} ({path}):\n{result.stderr.decode()}",
                err=True,
            )
            sys.exit(1)
        click.echo(f"Applied {label} ({path}).")


def _create_or_replace(
    label: str,
    create_fn: Callable[[], object],
    replace_fn: Callable[[], object],
) -> None:
    """Create a resource, replacing it on 409 Conflict.

    The Python client has no native ``apply`` verb; this implements the
    common "upsert" pattern by trying ``create`` and falling back to
    ``replace`` when the object already exists.
    """
    try:
        create_fn()
        click.echo(f"Applied {label}.")
        return
    except ApiException as exc:
        if exc.status != HTTP_CONFLICT:
            click.echo(f"Error creating {label}: {_api_error_message(exc)}", err=True)
            sys.exit(1)
    try:
        replace_fn()
    except ApiException as exc:
        click.echo(f"Error replacing {label}: {_api_error_message(exc)}", err=True)
        sys.exit(1)
    click.echo(f"Applied {label}.")


def apply_configmap(name: str, data: dict[str, str], dry_run: bool) -> None:
    """Create or update a ConfigMap with the given data.

    Args:
        name: ConfigMap name.
        data: Key/value pairs to store.
        dry_run: If True, print the action without executing it.
    """
    label = f"ConfigMap {name}"
    if dry_run:
        click.echo(f"[dry-run] Would apply {label}.")
        return
    body = client.V1ConfigMap(
        metadata=client.V1ObjectMeta(name=name, namespace=NAMESPACE),
        data=data,
    )
    api = core_api()
    _create_or_replace(
        label,
        lambda: api.create_namespaced_config_map(NAMESPACE, body),
        lambda: api.replace_namespaced_config_map(name, NAMESPACE, body),
    )


def apply_secret(name: str, string_data: dict[str, str], dry_run: bool) -> None:
    """Create or update an opaque Secret with the given string data.

    Args:
        name: Secret name.
        string_data: Key/value pairs (server base64-encodes them).
        dry_run: If True, print the action without executing it.
    """
    label = f"secret {name}"
    if dry_run:
        click.echo(f"[dry-run] Would apply {label}.")
        return
    body = client.V1Secret(
        metadata=client.V1ObjectMeta(name=name, namespace=NAMESPACE),
        string_data=string_data,
    )
    api = core_api()
    _create_or_replace(
        label,
        lambda: api.create_namespaced_secret(NAMESPACE, body),
        lambda: api.replace_namespaced_secret(name, NAMESPACE, body),
    )


def patch_configmap(env: dict[str, str], dry_run: bool) -> None:
    """Create or update dtaas-config ConfigMap with values from env.

    After updating the ConfigMap, restarts Deployments that read values
    from it as environment variables so they pick up the new values.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print the action without executing it.
    """
    keys = ["SERVER_DNS", "USERNAME1", "USERNAME2", "ACME_EMAIL"]
    data = {k: env[k] for k in keys if k in env}
    if not data:
        return
    apply_configmap("dtaas-config", data, dry_run)
    _restart_configmap_consumers(dry_run)


def _rollout_restart(name: str, dry_run: bool) -> None:
    """Rolling-restart a single Deployment with a warning on failure.

    Mirrors the behaviour of ``kubectl rollout restart`` by patching
    ``spec.template.metadata.annotations`` with a fresh timestamp.
    """
    if dry_run:
        click.echo(f"[dry-run] Would rollout restart deployment/{name}")
        return
    now = datetime.now(timezone.utc).isoformat()
    patch = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {"kubectl.kubernetes.io/restartedAt": now},
                }
            }
        }
    }
    try:
        apps_api().patch_namespaced_deployment(name, NAMESPACE, patch)
    except ApiException as exc:
        click.echo(
            f"Warning: could not restart {name}: {_api_error_message(exc)}",
            err=True,
        )
        return
    click.echo(f"Restarted deployment/{name}.")


def _restart_configmap_consumers(dry_run: bool) -> None:
    """Rolling-restart every Deployment that reads dtaas-config via env."""
    for name in _CONFIGMAP_CONSUMERS:
        _rollout_restart(name, dry_run)


_CLIENT_URL_KEYS = (
    "REACT_APP_URL",
    "REACT_APP_AUTH_AUTHORITY",
    "REACT_APP_REDIRECT_URI",
    "REACT_APP_LOGOUT_REDIRECT_URI",
)


def _rewrite_client_env_js(env_js: str, dns: str) -> str:
    """Rewrite the host portion of DTaaS-managed URLs in env.js.

    Handles both the initial ``YOUR_SERVER_DNS`` placeholder and re-runs
    where a real FQDN is already in place. Only URLs assigned to the
    React-app environment keys we manage are rewritten, so unrelated URLs
    (CDNs, analytics, etc.) are left untouched.

    Args:
        env_js: Current ``env.js`` content from the ConfigMap.
        dns: New SERVER_DNS to substitute as the host.

    Returns:
        The updated ``env.js`` content.
    """
    updated = env_js.replace(PLACEHOLDER_SERVER_DNS, dns)
    for key in _CLIENT_URL_KEYS:
        updated = re.sub(
            rf"({key}:\s*'https://)[^/']+(/)",
            rf"\g<1>{dns}\g<2>",
            updated,
        )
    return updated


def patch_client_configmap(env: dict[str, str], dry_run: bool) -> None:
    """Update client-config ConfigMap URL references with SERVER_DNS.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print the action without executing it.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        return
    api = core_api()
    try:
        cm = cast(
            client.V1ConfigMap,
            api.read_namespaced_config_map("client-config", NAMESPACE),
        )
    except ApiException as exc:
        click.echo(f"Error getting client-config: {_api_error_message(exc)}", err=True)
        sys.exit(1)
    env_js = (cm.data or {}).get("env.js", "")
    new_env_js = _rewrite_client_env_js(env_js, dns)
    if new_env_js == env_js:
        click.echo("client-config already up to date.")
        return
    if dry_run:
        click.echo(f"[dry-run] Would patch configmap/client-config → {dns}")
        click.echo("[dry-run] Would rollout restart deployment/client")
        return
    try:
        api.patch_namespaced_config_map(
            "client-config", NAMESPACE, {"data": {"env.js": new_env_js}}
        )
    except ApiException as exc:
        click.echo(f"Error patching client-config: {_api_error_message(exc)}", err=True)
        sys.exit(1)
    click.echo("Patched ConfigMap client-config.")
    # The client Deployment mounts env.js with subPath, so a ConfigMap update
    # is not projected into the running pod; a rollout restart is required.
    _rollout_restart("client", dry_run)


def apply_keycloak_secret(env: dict[str, str], dry_run: bool) -> None:
    """Create or update the dtaas-keycloak secret.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print the action without executing it.
    """
    required = ["KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD"]
    if any(k not in env for k in required):
        click.echo(f"Skipping keycloak secret: {required} not all set.")
        return
    apply_secret(
        "dtaas-keycloak",
        {
            "KEYCLOAK_ADMIN": env["KEYCLOAK_ADMIN"],
            "KEYCLOAK_ADMIN_PASSWORD": env["KEYCLOAK_ADMIN_PASSWORD"],
        },
        dry_run,
    )


def apply_forward_auth_secret(env: dict[str, str], dry_run: bool) -> None:
    """Create or update the dtaas-forward-auth secret.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print the action without executing it.
    """
    required = [
        "OAUTH_SECRET",
        "KEYCLOAK_CLIENT_ID",
        "KEYCLOAK_CLIENT_SECRET",
        "KEYCLOAK_ISSUER_URL",
    ]
    if any(k not in env for k in required):
        click.echo(f"Skipping forward-auth secret: {required} not all set.")
        return
    apply_secret(
        "dtaas-forward-auth",
        {
            "SECRET": env["OAUTH_SECRET"],
            "PROVIDERS_OIDC_CLIENT_ID": env["KEYCLOAK_CLIENT_ID"],
            "PROVIDERS_OIDC_CLIENT_SECRET": env["KEYCLOAK_CLIENT_SECRET"],
            "PROVIDERS_OIDC_ISSUER_URL": env["KEYCLOAK_ISSUER_URL"],
        },
        dry_run,
    )


def _read_service(name: str) -> client.V1Service | None:
    """Return the named Service, or None if it does not exist."""
    try:
        return cast(
            client.V1Service,
            core_api().read_namespaced_service(name, NAMESPACE),
        )
    except ApiException:
        return None


def get_lb_ip() -> str:
    """Return the external IP or hostname of the Traefik LoadBalancer service.

    Checks the ``ip`` field first; if empty, falls back to ``hostname``
    (used by AWS ELB, GKE, etc.). Returns an empty string if no
    ingress entry is set yet.
    """
    svc = _read_service("traefik")
    if svc is None or not svc.status or not svc.status.load_balancer:
        return ""
    ingress = svc.status.load_balancer.ingress or []
    if not ingress:
        return ""
    first = ingress[0]
    return first.ip or first.hostname or ""


def _clusterip(name: str) -> str:
    """Return the ClusterIP of a Service, or empty string on error."""
    svc = _read_service(name)
    if svc is None or not svc.spec:
        return ""
    return svc.spec.cluster_ip or ""


def get_traefik_clusterip() -> str:
    """Return the ClusterIP of the Traefik service."""
    return _clusterip("traefik")


def get_custom_dns_clusterip() -> str:
    """Return the ClusterIP of the custom-dns Service."""
    return _clusterip("custom-dns")


def apply_custom_dns_configmap(
    traefik_clusterip: str, server_dns: str, dry_run: bool
) -> None:
    """Create or update the custom-dns CoreDNS ConfigMap.

    The ConfigMap configures a CoreDNS instance that overrides the cluster's
    DNS resolution to route SERVER_DNS to the Traefik ClusterIP, fixing the
    hairpin NAT issue.

    Args:
        traefik_clusterip: ClusterIP of the Traefik service.
        server_dns: The server DNS name to override.
        dry_run: If True, print the action without executing it.
    """
    corefile = (
        ".:53 {\n"
        "    hosts {\n"
        f"        {traefik_clusterip} {server_dns}\n"
        "        fallthrough\n"
        "    }\n"
        "    forward . /etc/resolv.conf\n"
        "    cache 30\n"
        "    errors\n"
        "    health :8080\n"
        "    ready :8181\n"
        "}\n"
    )
    apply_configmap("custom-dns-config", {"Corefile": corefile}, dry_run)


def patch_forward_auth_dns(dns_ip: str, dry_run: bool) -> None:
    """Patch forward-auth to use a custom DNS server via dnsPolicy: None.

    This overrides the default DNS for the pod so that SERVER_DNS resolves
    to Traefik's ClusterIP, avoiding the hairpin NAT issue.

    Args:
        dns_ip: ClusterIP of the custom-dns Service.
        dry_run: If True, print the action without executing it.
    """
    patch = {
        "spec": {
            "template": {
                "spec": {
                    "dnsPolicy": "None",
                    "dnsConfig": {
                        "nameservers": [dns_ip],
                        "searches": [
                            f"{NAMESPACE}.svc.cluster.local",
                            "svc.cluster.local",
                            "cluster.local",
                        ],
                        "options": [{"name": "ndots", "value": "5"}],
                    },
                }
            }
        }
    }
    if dry_run:
        click.echo(
            f"[dry-run] Would patch forward-auth dnsConfig → nameserver {dns_ip}"
        )
        return
    try:
        apps_api().patch_namespaced_deployment("traefik-forward-auth", NAMESPACE, patch)
    except ApiException as exc:
        click.echo(
            f"Error patching forward-auth dnsConfig: {_api_error_message(exc)}",
            err=True,
        )
        sys.exit(1)
    click.echo(f"Patched forward-auth dnsConfig: nameserver → {dns_ip}.")
