"""IngressRoute patching helpers for DTaaS Kubernetes deployment."""

import json
import re
import sys

import click

from .k8s_ops import NAMESPACE, kubectl


def _patch_one_ingressroute(item: dict, dns: str, dry_run: bool) -> None:
    """Patch a single IngressRoute item's Host() rules.

    Args:
        item: IngressRoute object dict from kubectl.
        dns: New domain name to substitute.
        dry_run: If True, print commands without executing them.
    """
    name = item["metadata"]["name"]
    new_routes = []
    modified = False
    for route in item.get("spec", {}).get("routes", []):
        old_match = route.get("match", "")
        new_match = re.sub(r'Host\(`[^`]+`\)', f'Host(`{dns}`)', old_match)
        modified = modified or new_match != old_match
        new_routes.append({**route, "match": new_match})
    if not modified:
        return
    patch = json.dumps({"spec": {"routes": new_routes}})
    if dry_run:
        click.echo(f"[dry-run] Would patch ingressroute/{name} → Host(`{dns}`)")
        return
    res = kubectl("patch", "ingressroute", name, "-n", NAMESPACE,
                  "--type=merge", f"--patch={patch}")
    if res.returncode != 0:
        click.echo(f"Error patching {name}:\n{res.stderr.decode()}", err=True)
        sys.exit(res.returncode)
    click.echo(f"Patched ingressroute/{name} → Host(`{dns}`).")


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
        sys.exit(result.returncode)
    for item in json.loads(result.stdout).get("items", []):
        _patch_one_ingressroute(item, dns, dry_run)
