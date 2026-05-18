"""IngressRoute patching helpers for DTaaS Kubernetes deployment."""

import json
import re
import sys

import click

from .k8s_ops import NAMESPACE, kubectl


def _rewrite_host_routes(routes: list[dict], dns: str) -> tuple[list[dict], bool]:
    """Return ``(new_routes, modified)`` with all ``Host(...)`` rules rewritten."""
    new_routes: list[dict] = []
    modified = False
    for route in routes:
        old_match = route.get("match", "")
        new_match = re.sub(r"Host\(`[^`]+`\)", f"Host(`{dns}`)", old_match)
        modified = modified or new_match != old_match
        new_routes.append({**route, "match": new_match})
    return new_routes, modified


def _apply_ingressroute_patch(name: str, new_routes: list[dict], dns: str) -> None:
    """Call ``kubectl patch`` for one IngressRoute and report the outcome."""
    patch = json.dumps({"spec": {"routes": new_routes}})
    res = kubectl(
        "patch",
        "ingressroute",
        name,
        "-n",
        NAMESPACE,
        "--type=merge",
        f"--patch={patch}",
    )
    if res.returncode != 0:
        click.echo(f"Error patching {name}:\n{res.stderr.decode()}", err=True)
        sys.exit(1)
    click.echo(f"Patched ingressroute/{name} → Host(`{dns}`).")


def _patch_one_ingressroute(item: dict, dns: str, dry_run: bool) -> None:
    """Patch a single IngressRoute item's Host() rules.

    Args:
        item: IngressRoute object dict from kubectl.
        dns: New domain name to substitute.
        dry_run: If True, print commands without executing them.
    """
    name = item["metadata"]["name"]
    routes = item.get("spec", {}).get("routes", [])
    new_routes, modified = _rewrite_host_routes(routes, dns)
    if not modified:
        return
    if dry_run:
        click.echo(f"[dry-run] Would patch ingressroute/{name} → Host(`{dns}`)")
        return
    _apply_ingressroute_patch(name, new_routes, dns)


def patch_ingressroutes(env: dict[str, str], dry_run: bool) -> None:
    """Patch all IngressRoute Host() rules with SERVER_DNS.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        click.echo("Skipping IngressRoute patching: SERVER_DNS not set.", err=True)
        return
    result = kubectl("get", "ingressroute", "-n", NAMESPACE, "-o", "json")
    if result.returncode != 0:
        click.echo(f"Error listing IngressRoutes: {result.stderr.decode()}", err=True)
        sys.exit(1)
    for item in json.loads(result.stdout).get("items", []):
        _patch_one_ingressroute(item, dns, dry_run)
