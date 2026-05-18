"""IngressRoute patching helpers for DTaaS Kubernetes deployment.

Two patching paths are provided:

* :func:`patch_ingressroutes` updates the live ``IngressRoute`` objects
  in the cluster via the Kubernetes ``CustomObjectsApi``.
* :func:`patch_ingressroute_files` rewrites the on-disk YAML files
  under ``manifests/ingress/`` so a subsequent ``kubectl apply -k`` (or
  :func:`cli.k8s_ops.apply_manifests`) does not stomp the patched value
  back to the ``YOUR_SERVER_DNS`` placeholder.

The two should be invoked together so the live cluster and the git
state stay in sync.
"""

import re
import sys
from pathlib import Path

import click
from kubernetes.client.exceptions import ApiException

from .k8s_ops import NAMESPACE, custom_api

INGRESSROUTE_GROUP = "traefik.io"
INGRESSROUTE_VERSION = "v1alpha1"
INGRESSROUTE_PLURAL = "ingressroutes"

INGRESSROUTE_FILES = (
    "ingressroute-client.yaml",
    "ingressroute-forward-auth.yaml",
    "ingressroute-keycloak.yaml",
    "ingressroute-user1.yaml",
    "ingressroute-user2.yaml",
)

_HOST_RULE_RE = re.compile(r"Host\(`[^`]+`\)")


def _api_error_message(exc: ApiException) -> str:
    """Pull a short human-readable message out of an ApiException."""
    return exc.body or exc.reason or str(exc)


def _rewrite_host_routes(routes: list[dict], dns: str) -> tuple[list[dict], bool]:
    """Return ``(new_routes, modified)`` with all ``Host(...)`` rules rewritten."""
    new_routes: list[dict] = []
    modified = False
    for route in routes:
        old_match = route.get("match", "")
        new_match = _HOST_RULE_RE.sub(f"Host(`{dns}`)", old_match)
        modified = modified or new_match != old_match
        new_routes.append({**route, "match": new_match})
    return new_routes, modified


def _apply_ingressroute_patch(name: str, new_routes: list[dict], dns: str) -> None:
    """Patch one IngressRoute via the CustomObjectsApi and report the outcome."""
    try:
        custom_api().patch_namespaced_custom_object(
            group=INGRESSROUTE_GROUP,
            version=INGRESSROUTE_VERSION,
            namespace=NAMESPACE,
            plural=INGRESSROUTE_PLURAL,
            name=name,
            body={"spec": {"routes": new_routes}},
        )
    except ApiException as exc:
        click.echo(f"Error patching {name}: {_api_error_message(exc)}", err=True)
        sys.exit(1)
    click.echo(f"Patched ingressroute/{name} → Host(`{dns}`).")


def _patch_one_ingressroute(item: dict, dns: str, dry_run: bool) -> None:
    """Patch a single IngressRoute item's Host() rules."""
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
    """Patch all live IngressRoute Host() rules in the cluster with SERVER_DNS.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print the action without executing it.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        click.echo("Skipping IngressRoute patching: SERVER_DNS not set.", err=True)
        return
    try:
        listing = custom_api().list_namespaced_custom_object(
            group=INGRESSROUTE_GROUP,
            version=INGRESSROUTE_VERSION,
            namespace=NAMESPACE,
            plural=INGRESSROUTE_PLURAL,
        )
    except ApiException as exc:
        click.echo(f"Error listing IngressRoutes: {_api_error_message(exc)}", err=True)
        sys.exit(1)
    for item in listing.get("items", []):
        _patch_one_ingressroute(item, dns, dry_run)


def _rewrite_host_in_text(text: str, dns: str) -> tuple[str, bool]:
    """Replace every ``Host(`...`)`` in ``text``; return ``(new_text, changed)``."""
    new_text = _HOST_RULE_RE.sub(f"Host(`{dns}`)", text)
    return new_text, new_text != text


def patch_ingressroute_files(
    env: dict[str, str], ingress_dir: Path, dry_run: bool
) -> None:
    """Rewrite Host() rules in the ingressroute YAML files on disk.

    Keeps the git-tracked manifests in sync with the live cluster so that
    a re-run of ``kubectl apply -k manifests`` (or
    :func:`cli.k8s_ops.apply_manifests`) does not revert the cluster back
    to the ``YOUR_SERVER_DNS`` placeholder.

    Args:
        env: Dictionary of environment variables.
        ingress_dir: Directory containing the ingressroute-*.yaml files.
        dry_run: If True, print intended changes without writing.
    """
    dns = env.get("SERVER_DNS", "")
    if not dns:
        click.echo("Skipping IngressRoute file rewrite: SERVER_DNS not set.", err=True)
        return
    for name in INGRESSROUTE_FILES:
        path = ingress_dir / name
        if not path.exists():
            continue
        original = path.read_text()
        updated, changed = _rewrite_host_in_text(original, dns)
        if not changed:
            continue
        if dry_run:
            click.echo(f"[dry-run] Would rewrite {path} → Host(`{dns}`)")
            continue
        path.write_text(updated)
        click.echo(f"Rewrote {path.name} → Host(`{dns}`).")
