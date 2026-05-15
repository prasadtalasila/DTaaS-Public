"""Kubernetes operations for DTaaS configuration management."""

import json
import subprocess
import sys

import click

NAMESPACE = "dtaas-workspace"


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
        sys.exit(result.returncode)
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
        sys.exit(result.returncode)
    return result.stdout


def patch_configmap(env: dict[str, str], dry_run: bool) -> None:
    """Update dtaas-config ConfigMap with values from env.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    keys = ["SERVER_DNS", "USERNAME1", "USERNAME2", "ACME_EMAIL"]
    pairs = {k: env[k] for k in keys if k in env}
    items = ", ".join(f'"{k}": "{v}"' for k, v in pairs.items())
    patch = f'{{"data": {{{items}}}}}'
    if dry_run:
        click.echo(f"[dry-run] kubectl patch configmap dtaas-config --patch='{patch}'")
        return
    result = kubectl(
        "patch", "configmap", "dtaas-config",
        "-n", NAMESPACE, "--type=merge", f"--patch={patch}",
    )
    if result.returncode != 0:
        click.echo(f"Error patching configmap:\n{result.stderr.decode()}", err=True)
        sys.exit(result.returncode)
    click.echo("Patched ConfigMap dtaas-config.")


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
        sys.exit(result.returncode)
    item = json.loads(result.stdout)
    env_js = item["data"].get("env.js", "")
    new_env_js = re.sub(
        r"https://[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?"
        r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)+/",
        f"https://{dns}/",
        env_js,
    )
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
        sys.exit(res.returncode)
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
    """Return the external IP of the Traefik LoadBalancer service."""
    result = kubectl(
        "get", "svc", "traefik", "-n", NAMESPACE,
        "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}",
    )
    return result.stdout.decode().strip() if result.returncode == 0 else ""


def get_traefik_clusterip() -> str:
    """Return the ClusterIP of the Traefik service."""
    result = kubectl(
        "get", "svc", "traefik", "-n", NAMESPACE,
        "-o", "jsonpath={.spec.clusterIP}",
    )
    return result.stdout.decode().strip() if result.returncode == 0 else ""


def patch_forward_auth_aliases(env: dict[str, str], dry_run: bool) -> None:
    """Patch forward-auth hostAliases to use Traefik ClusterIP for SERVER_DNS.

    This resolves the hairpin NAT issue where pods inside the cluster cannot
    reach the LoadBalancer's external IP.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        click.echo("Skipping hostAliases patch: SERVER_DNS not set.", err=True)
        return
    cluster_ip = get_traefik_clusterip()
    if not cluster_ip:
        click.echo("Skipping hostAliases patch: could not get Traefik ClusterIP.", err=True)
        return
    patch = json.dumps({
        "spec": {"template": {"spec": {"hostAliases": [{
            "ip": cluster_ip,
            "hostnames": [dns],
        }]}}}
    })
    if dry_run:
        click.echo(f"[dry-run] Would patch forward-auth hostAliases: {dns} → {cluster_ip}")
        return
    res = kubectl(
        "patch", "deployment", "traefik-forward-auth", "-n", NAMESPACE,
        "--type=merge", f"--patch={patch}",
    )
    if res.returncode != 0:
        click.echo(f"Error patching forward-auth hostAliases:\n{res.stderr.decode()}", err=True)
        sys.exit(res.returncode)
    click.echo(f"Patched forward-auth hostAliases: {dns} → {cluster_ip}.")
