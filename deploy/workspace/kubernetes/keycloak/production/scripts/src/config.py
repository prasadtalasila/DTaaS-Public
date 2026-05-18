"""Configure Kubernetes resources for DTaaS from a .env file.

Usage:
    python -m src.config apply [--env-file PATH] [--dry-run]
    python -m src.config network show [--env-file PATH]
"""

import sys
from dataclasses import dataclass
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


def _is_env_assignment(line: str) -> bool:
    """Return True for non-comment lines that look like KEY=VALUE."""
    return bool(line) and not line.startswith("#") and "=" in line


def _parse_env_lines(lines: list[str]) -> dict[str, str]:
    """Parse stripped lines into a key=value dict."""
    env: dict[str, str] = {}
    for line in lines:
        if not _is_env_assignment(line):
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = _strip_quotes(value.strip())
    return env


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
    lines = [line.strip() for line in env_file.read_text().splitlines()]
    return _parse_env_lines(lines)


@click.group()
def cli() -> None:
    """DTaaS Kubernetes configuration CLI."""


def _skip_custom_dns_reason(env: dict[str, str], traefik_ip: str) -> str:
    """Return a human-readable reason for skipping custom-dns, or "".

    Args:
        env: Dictionary of environment variables.
        traefik_ip: Resolved Traefik ClusterIP (empty if unavailable).

    Returns:
        A short message when the step should be skipped, empty otherwise.
    """
    if not env.get("SERVER_DNS", ""):
        return "Skipping custom-dns: SERVER_DNS not set."
    if not traefik_ip:
        return "Skipping custom-dns: could not get Traefik ClusterIP."
    return ""


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
    traefik_ip = get_traefik_clusterip()
    skip = _skip_custom_dns_reason(env, traefik_ip)
    if skip:
        click.echo(skip, err=True)
        return
    apply_custom_dns_configmap(traefik_ip, env["SERVER_DNS"], dry_run)
    dns_ip = get_custom_dns_clusterip()
    if not dns_ip and not dry_run:
        click.echo(
            "custom-dns Service not yet ready; retry apply after pod starts.", err=True
        )
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


@dataclass(frozen=True)
class _NetworkState:
    """Snapshot of the DNS / LoadBalancer state for a single check."""

    dns: str
    lb_address: str
    lb_ip: str
    resolved_ip: str


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
    lb_address = get_lb_ip()
    # `get_lb_ip()` may return either an IPv4 address or a hostname
    # (AWS/GCP ELB-style). Resolve the hostname form so we compare apples
    # to apples against the user's DNS A record.
    state = _NetworkState(
        dns=dns,
        lb_address=lb_address,
        lb_ip=lb_address if _looks_like_ip(lb_address) else resolve_dns(lb_address),
        resolved_ip=resolve_dns(dns),
    )
    _print_network_summary(state)
    exit_code = _evaluate_dns_alignment(state)
    if exit_code != 0:
        sys.exit(exit_code)


def _print_network_summary(state: _NetworkState) -> None:
    """Print the diagnostic header lines for ``network show``."""
    click.echo(f"Domain         : {state.dns}")
    click.echo(f"LoadBalancer   : {state.lb_address or '(not found)'}")
    if state.lb_address and not _looks_like_ip(state.lb_address):
        click.echo(f"LB resolved IP : {state.lb_ip or '(unresolved)'}")
    click.echo(f"DNS resolved   : {state.resolved_ip or '(unresolved)'}")


def _alignment_message(state: _NetworkState) -> tuple[str, int]:
    """Return (message-to-emit, exit-code) for the current state.

    Exit code is ``1`` for hard failures, ``0`` for success or warning.
    """
    if not state.lb_address:
        return (
            "\n⚠ Could not determine LoadBalancer address."
            "\n  Run: kubectl get svc traefik -n dtaas-workspace",
            0,
        )
    if not state.resolved_ip:
        return f"\n✗ DNS not configured: {state.dns} does not resolve.", 1
    if not state.lb_ip:
        return (
            f"\n⚠ LoadBalancer hostname {state.lb_address} did not resolve; "
            "cannot verify alignment.",
            0,
        )
    if state.resolved_ip != state.lb_ip:
        return (
            f"\n✗ DNS mismatch: {state.dns} resolves to {state.resolved_ip} "
            f"but LoadBalancer resolves to {state.lb_ip}.",
            1,
        )
    return f"\n✓ DNS correctly configured: {state.dns} → {state.lb_address}", 0


def _evaluate_dns_alignment(state: _NetworkState) -> int:
    """Report on alignment between SERVER_DNS and the LoadBalancer."""
    message, exit_code = _alignment_message(state)
    click.echo(message, err=exit_code != 0 or "⚠" in message)
    if exit_code != 0:
        show_dns_fix_instructions(state.dns, state.lb_address)
    return exit_code


def _looks_like_ip(value: str) -> bool:
    """Return True when value looks like an IPv4 dotted-quad address."""
    if not value:
        return False
    parts = value.split(".")
    return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


if __name__ == "__main__":
    cli()
