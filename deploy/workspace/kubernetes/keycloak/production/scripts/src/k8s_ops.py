"""Kubernetes operations for DTaaS configuration management."""

import json
import re
import subprocess
import sys

import click

NAMESPACE = "dtaas-workspace"
KUBECTL_TIMEOUT = 60
PLACEHOLDER_SERVER_DNS = "YOUR_SERVER_DNS"


def kubectl(*args: str, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    """Run kubectl with the given arguments.

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


def apply_yaml(yaml_bytes: bytes, dry_run: bool, label: str) -> None:
    """Apply YAML bytes via kubectl apply or print for dry-run.

    Args:
        yaml_bytes: Raw YAML content to apply.
        dry_run: If True, print the YAML instead of applying.
        label: Human-readable label for progress messages.
    """
    if dry_run:
        click.echo(f"[dry-run] Would apply {label}:\n{yaml_bytes.decode()}")
        return
    result = kubectl("apply", "-f", "-", stdin=yaml_bytes)
    if result.returncode != 0:
        click.echo(f"Error applying {label}:\n{result.stderr.decode()}", err=True)
        sys.exit(1)
    click.echo(f"Applied {label}.")


def secret_yaml(name: str, literals: dict[str, str]) -> bytes:
    """Generate YAML for a Kubernetes secret using kubectl dry-run.

    Args:
        name: Secret name.
        literals: Key/value pairs to store in the secret.

    Returns:
        YAML bytes for the secret resource.
    """
    args = [
        "create", "secret", "generic", name,
        "-n", NAMESPACE,
        "--dry-run=client", "-o", "yaml",
    ]
    for k, v in literals.items():
        args += [f"--from-literal={k}={v}"]
    result = kubectl(*args)
    if result.returncode != 0:
        click.echo(f"Error generating secret {name}:\n{result.stderr.decode()}", err=True)
        sys.exit(1)
    return result.stdout


def patch_configmap(env: dict[str, str], dry_run: bool) -> None:
    """Create or update dtaas-config ConfigMap with values from env.

    After updating the ConfigMap, restarts Deployments that read values from
    it as environment variables so they pick up the new configuration.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    keys = ["SERVER_DNS", "USERNAME1", "USERNAME2", "ACME_EMAIL"]
    literals = [f"--from-literal={k}={env[k]}" for k in keys if k in env]
    if not literals:
        return
    result = kubectl(
        "create", "configmap", "dtaas-config", "-n", NAMESPACE,
        "--dry-run=client", "-o", "yaml", *literals,
    )
    if result.returncode != 0:
        click.echo(f"Error generating dtaas-config:\n{result.stderr.decode()}", err=True)
        sys.exit(1)
    apply_yaml(result.stdout, dry_run, "ConfigMap dtaas-config")
    _restart_configmap_consumers(dry_run)


def _restart_configmap_consumers(dry_run: bool) -> None:
    """Rolling-restart Deployments that read dtaas-config via env vars.

    Kubernetes does not automatically restart pods when a ConfigMap they
    reference via ``envFrom`` or ``valueFrom.configMapKeyRef`` changes.
    This function triggers a rollout restart so pods pick up the new values.

    Args:
        dry_run: If True, print commands without executing them.
    """
    deployments = ["keycloak", "user1", "user2"]
    for name in deployments:
        if dry_run:
            click.echo(f"[dry-run] Would rollout restart deployment/{name}")
            continue
        res = kubectl(
            "rollout", "restart", f"deployment/{name}", "-n", NAMESPACE,
        )
        if res.returncode != 0:
            click.echo(
                f"Warning: could not restart {name}: {res.stderr.decode()}",
                err=True,
            )
        else:
            click.echo(f"Restarted deployment/{name}.")


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
        dry_run: If True, print commands without executing them.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        return
    result = kubectl("get", "configmap", "client-config", "-n", NAMESPACE, "-o", "json")
    if result.returncode != 0:
        click.echo(f"Error getting client-config: {result.stderr.decode()}", err=True)
        sys.exit(1)
    item = json.loads(result.stdout)
    env_js = item["data"].get("env.js", "")
    new_env_js = _rewrite_client_env_js(env_js, dns)
    if new_env_js == env_js:
        click.echo("client-config already up to date.")
        return
    patch = json.dumps({"data": {"env.js": new_env_js}})
    if dry_run:
        click.echo(f"[dry-run] Would patch configmap/client-config → {dns}")
        return
    res = kubectl("patch", "configmap", "client-config", "-n", NAMESPACE,
                  "--type=merge", f"--patch={patch}")
    if res.returncode != 0:
        click.echo(f"Error patching client-config:\n{res.stderr.decode()}", err=True)
        sys.exit(1)
    click.echo("Patched ConfigMap client-config.")


def apply_keycloak_secret(env: dict[str, str], dry_run: bool) -> None:
    """Create or update the dtaas-keycloak secret.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    required = ["KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD"]
    if any(k not in env for k in required):
        click.echo(f"Skipping keycloak secret: {required} not all set.")
        return
    yaml_bytes = secret_yaml("dtaas-keycloak", {
        "KEYCLOAK_ADMIN": env["KEYCLOAK_ADMIN"],
        "KEYCLOAK_ADMIN_PASSWORD": env["KEYCLOAK_ADMIN_PASSWORD"],
    })
    apply_yaml(yaml_bytes, dry_run, "secret dtaas-keycloak")


def apply_forward_auth_secret(env: dict[str, str], dry_run: bool) -> None:
    """Create or update the dtaas-forward-auth secret.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    required = [
        "OAUTH_SECRET", "KEYCLOAK_CLIENT_ID",
        "KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_ISSUER_URL",
    ]
    if any(k not in env for k in required):
        click.echo(f"Skipping forward-auth secret: {required} not all set.")
        return
    yaml_bytes = secret_yaml("dtaas-forward-auth", {
        "SECRET": env["OAUTH_SECRET"],
        "PROVIDERS_OIDC_CLIENT_ID": env["KEYCLOAK_CLIENT_ID"],
        "PROVIDERS_OIDC_CLIENT_SECRET": env["KEYCLOAK_CLIENT_SECRET"],
        "PROVIDERS_OIDC_ISSUER_URL": env["KEYCLOAK_ISSUER_URL"],
    })
    apply_yaml(yaml_bytes, dry_run, "secret dtaas-forward-auth")


def get_lb_ip() -> str:
    """Return the external IP or hostname of the Traefik LoadBalancer service.

    Checks ``status.loadBalancer.ingress[0].ip`` first; if empty, falls back to
    ``status.loadBalancer.ingress[0].hostname`` (used by AWS ELB, GKE, etc.).

    Returns:
        External IP or hostname string, or empty string if not found.
    """
    for field in ("ip", "hostname"):
        result = kubectl(
            "get", "svc", "traefik", "-n", NAMESPACE,
            "-o", f"jsonpath={{.status.loadBalancer.ingress[0].{field}}}",
        )
        value = result.stdout.decode().strip() if result.returncode == 0 else ""
        if value:
            return value
    return ""


def get_traefik_clusterip() -> str:
    """Return the ClusterIP of the Traefik service."""
    result = kubectl(
        "get", "svc", "traefik", "-n", NAMESPACE,
        "-o", "jsonpath={.spec.clusterIP}",
    )
    return result.stdout.decode().strip() if result.returncode == 0 else ""


def apply_custom_dns_configmap(traefik_clusterip: str, server_dns: str, dry_run: bool) -> None:
    """Create or update the custom-dns CoreDNS ConfigMap.

    The ConfigMap configures a CoreDNS instance that overrides the cluster's
    DNS resolution to route SERVER_DNS to the Traefik ClusterIP, fixing the
    hairpin NAT issue.

    Args:
        traefik_clusterip: ClusterIP of the Traefik service.
        server_dns: The server DNS name to override.
        dry_run: If True, print commands without executing them.
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
    result = kubectl(
        "create", "configmap", "custom-dns-config",
        "-n", NAMESPACE, "--dry-run=client", "-o", "yaml",
        f"--from-literal=Corefile={corefile}",
    )
    if result.returncode != 0:
        click.echo(f"Error generating custom-dns configmap:\n{result.stderr.decode()}", err=True)
        sys.exit(1)
    apply_yaml(result.stdout, dry_run, "ConfigMap custom-dns-config")


def get_custom_dns_clusterip() -> str:
    """Return the ClusterIP of the custom-dns Service."""
    result = kubectl(
        "get", "svc", "custom-dns", "-n", NAMESPACE,
        "-o", "jsonpath={.spec.clusterIP}",
    )
    return result.stdout.decode().strip() if result.returncode == 0 else ""


def patch_forward_auth_dns(dns_ip: str, dry_run: bool) -> None:
    """Patch forward-auth to use a custom DNS server via dnsPolicy: None.

    This overrides the default DNS for the pod so that SERVER_DNS resolves to
    Traefik's ClusterIP, avoiding the hairpin NAT issue.

    Args:
        dns_ip: ClusterIP of the custom-dns Service.
        dry_run: If True, print commands without executing them.
    """
    patch = json.dumps({"spec": {"template": {"spec": {
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
    }}}})
    if dry_run:
        click.echo(f"[dry-run] Would patch forward-auth dnsConfig → nameserver {dns_ip}")
        return
    res = kubectl(
        "patch", "deployment", "traefik-forward-auth", "-n", NAMESPACE,
        "--type=merge", f"--patch={patch}",
    )
    if res.returncode != 0:
        click.echo(f"Error patching forward-auth dnsConfig:\n{res.stderr.decode()}", err=True)
        sys.exit(1)
    click.echo(f"Patched forward-auth dnsConfig: nameserver → {dns_ip}.")
