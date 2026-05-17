"""Configure Kubernetes resources for DTaaS from a .env file.

Usage:
    python -m src.config apply [--env-file PATH] [--dry-run]
    python -m src.config network show [--env-file PATH]
"""

import sys
from pathlib import Path

import click

from .ingress_ops import patch_ingressroutes
from .k8s_ops import (
    apply_custom_dns_configmap,
    apply_forward_auth_secret,
    apply_keycloak_secret,
    get_custom_dns_clusterip,
    get_lb_ip,
    get_traefik_clusterip,
    patch_client_configmap,
    patch_configmap,
    patch_forward_auth_dns,
)
from .net_ops import resolve_dns, show_dns_fix_instructions

SCRIPT_DIR = Path(__file__).parent
DEFAULT_ENV = SCRIPT_DIR.parent.parent / ".env"


def _strip_quotes(value: str) -> str:
    """Strip a single pair of surrounding quotes from a value."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def load_env(env_file: Path) -> dict[str, str]:
    """Load key=value pairs from a .env file, skipping comments.

    Quoted values (single or double) are unwrapped. Lines starting with
    ``#`` and blank lines are ignored.

    Args:
        env_file: Path to the .env file.

    Returns:
        Dictionary of variable names to their values.
    """
    if not env_file.exists():
        click.echo(f"Error: .env file not found: {env_file}", err=True)
        sys.exit(1)
    env: dict[str, str] = {}
    for raw_line in env_file.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = _strip_quotes(value.strip())
    return env


@click.group()
def cli() -> None:
    """DTaaS Kubernetes configuration CLI."""


def _apply_custom_dns(env: dict[str, str], dry_run: bool) -> None:
    """Update the custom-dns ConfigMap and patch forward-auth to use it.

    The custom-dns Deployment and Service are applied by the regular
    ``kubectl apply -k manifests/`` pass; this function only fills in the
    Corefile entries that depend on the actual Traefik ClusterIP and
    SERVER_DNS, then patches forward-auth's ``dnsConfig`` so its OIDC
    lookups go through custom-dns (the hairpin-NAT fix).

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        click.echo("Skipping custom-dns: SERVER_DNS not set.", err=True)
        return
    traefik_ip = get_traefik_clusterip()
    if not traefik_ip:
        click.echo("Skipping custom-dns: could not get Traefik ClusterIP.", err=True)
        return
    apply_custom_dns_configmap(traefik_ip, dns, dry_run)
    dns_ip = get_custom_dns_clusterip()
    if not dns_ip and not dry_run:
        click.echo("custom-dns Service not yet ready; retry apply after pod starts.", err=True)
        return
    patch_forward_auth_dns(dns_ip or "PENDING", dry_run)


@cli.command("apply")
@click.option(
    "--env-file",
    default=str(DEFAULT_ENV),
    show_default=True,
    help="Path to the .env file.",
    type=click.Path(exists=False),
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print kubectl commands without executing them.",
)
def apply_cmd(env_file: str, dry_run: bool) -> None:
    """Apply DTaaS Kubernetes configuration from a .env file."""
    env = load_env(Path(env_file))
    patch_configmap(env, dry_run)
    patch_ingressroutes(env, dry_run)
    patch_client_configmap(env, dry_run)
    _apply_custom_dns(env, dry_run)
    apply_keycloak_secret(env, dry_run)
    apply_forward_auth_secret(env, dry_run)
    click.echo("Configuration applied successfully.")


@cli.group("network")
def network_group() -> None:
    """Network diagnostics commands."""


@network_group.command("show")
@click.option(
    "--env-file",
    default=str(DEFAULT_ENV),
    show_default=True,
    help="Path to the .env file.",
    type=click.Path(exists=False),
)
def network_show(env_file: str) -> None:
    """Show LoadBalancer IP and DNS resolution for SERVER_DNS."""
    env = load_env(Path(env_file))
    dns = env.get("SERVER_DNS", "")
    if not dns:
        click.echo("SERVER_DNS not set in .env file.", err=True)
        sys.exit(1)
    lb_ip = get_lb_ip()
    resolved_ip = resolve_dns(dns)
    click.echo(f"Domain         : {dns}")
    click.echo(f"LoadBalancer IP: {lb_ip or '(not found)'}")
    click.echo(f"DNS resolved   : {resolved_ip or '(unresolved)'}")
    if not lb_ip:
        click.echo("\n⚠ Could not determine LoadBalancer IP.", err=True)
        click.echo("  Run: kubectl get svc traefik -n dtaas-workspace", err=True)
        return
    if not resolved_ip:
        click.echo(f"\n✗ DNS not configured: {dns} does not resolve.", err=True)
        show_dns_fix_instructions(dns, lb_ip)
        sys.exit(1)
    if resolved_ip != lb_ip:
        click.echo(
            f"\n✗ DNS mismatch: {dns} resolves to {resolved_ip} "
            f"but LoadBalancer IP is {lb_ip}.",
            err=True,
        )
        show_dns_fix_instructions(dns, lb_ip)
        sys.exit(1)
    click.echo(f"\n✓ DNS correctly configured: {dns} → {lb_ip}")


if __name__ == "__main__":
    cli()
