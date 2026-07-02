"""PVC seeding/dumping helpers for workspace volumes.

The workspace pods mount three PVCs (``workspace-user1``,
``workspace-user2``, ``workspace-common``). On a fresh cluster these
volumes are empty; this module copies the local ``files/template/`` and
``files/common/`` directories into the PVCs so the workspaces have
something to start from. The same mechanism in reverse extracts the
PVC contents back to disk.

The implementation runs a short-lived ``busybox`` pod that mounts the
target PVC, uses ``kubectl cp`` to move data across the API server, and
then deletes the helper pod. File ownership is fixed to UID 1000 / GID
100 so the workspace user (set by the upstream image entrypoint) can
read and write.
"""

import json
import sys
import time
from pathlib import Path

import click

from .k8s_ops import NAMESPACE, kubectl

HELPER_IMAGE = "busybox:1.36"
WORKSPACE_UID = 1000
WORKSPACE_GID = 100
HELPER_POD_TIMEOUT = "120s"


def _helper_pod_overrides(pvc: str) -> str:
    """Return JSON overrides for ``kubectl run`` that mount ``pvc`` at /workspace."""
    return json.dumps(
        {
            "spec": {
                "securityContext": {"fsGroup": WORKSPACE_GID},
                "volumes": [
                    {
                        "name": "pvc",
                        "persistentVolumeClaim": {"claimName": pvc},
                    }
                ],
                "containers": [
                    {
                        "name": "helper",
                        "image": HELPER_IMAGE,
                        "command": ["sh", "-c", "sleep 3600"],
                        "volumeMounts": [{"name": "pvc", "mountPath": "/workspace"}],
                    }
                ],
            }
        }
    )


def _run_or_exit(args: list[str], label: str) -> bytes:
    """Run kubectl with ``args`` and exit non-zero on failure.

    Args:
        args: Arguments to pass to kubectl.
        label: Human-readable label for the error message.

    Returns:
        The stdout bytes of the command.
    """
    result = kubectl(*args)
    if result.returncode != 0:
        click.echo(f"Error: {label} failed:\n{result.stderr.decode()}", err=True)
        sys.exit(1)
    return result.stdout


def _wait_for_pod(name: str) -> None:
    """Block until the helper pod is Ready (or exit non-zero on timeout)."""
    click.echo(f"Waiting for pod/{name} to be Ready …")
    _run_or_exit(
        [
            "wait",
            f"pod/{name}",
            "-n",
            NAMESPACE,
            "--for=condition=Ready",
            f"--timeout={HELPER_POD_TIMEOUT}",
        ],
        f"wait for pod/{name}",
    )


def _delete_pod_quiet(name: str) -> None:
    """Best-effort delete of the helper pod; never aborts the CLI."""
    res = kubectl(
        "delete",
        "pod",
        name,
        "-n",
        NAMESPACE,
        "--ignore-not-found",
        "--wait=false",
    )
    if res.returncode != 0:
        click.echo(
            f"Warning: could not delete pod/{name}: {res.stderr.decode()}",
            err=True,
        )


def _start_helper_pod(pvc: str) -> str:
    """Start a busybox helper pod that mounts ``pvc`` at /workspace.

    Returns:
        The name of the created pod.
    """
    name = f"workspace-files-{pvc}-{int(time.time())}"
    overrides = _helper_pod_overrides(pvc)
    _run_or_exit(
        [
            "run",
            name,
            "-n",
            NAMESPACE,
            f"--image={HELPER_IMAGE}",
            "--restart=Never",
            f"--overrides={overrides}",
            "--command",
            "--",
            "sh",
            "-c",
            "sleep 3600",
        ],
        f"start pod/{name}",
    )
    _wait_for_pod(name)
    return name


def _fix_ownership(pod: str) -> None:
    """Set ownership of the mounted /workspace to UID 1000 / GID 100."""
    res = kubectl(
        "exec",
        "-n",
        NAMESPACE,
        pod,
        "--",
        "sh",
        "-c",
        f"chown -R {WORKSPACE_UID}:{WORKSPACE_GID} /workspace "
        "&& chmod -R g+rX /workspace",
    )
    if res.returncode != 0:
        click.echo(
            f"Warning: chown/chmod failed inside {pod}: {res.stderr.decode()}",
            err=True,
        )


def _seed_one(pvc: str, source: Path, dry_run: bool) -> None:
    """Copy ``source`` into the named PVC, then fix ownership."""
    if not source.exists():
        click.echo(f"Source directory not found: {source}", err=True)
        sys.exit(1)
    click.echo(f"Seeding PVC {pvc} from {source} …")
    if dry_run:
        click.echo(
            f"[dry-run] Would copy {source}/ into PVC {pvc} via helper pod "
            f"and chown to {WORKSPACE_UID}:{WORKSPACE_GID}."
        )
        return
    pod = _start_helper_pod(pvc)
    try:
        _run_or_exit(
            ["cp", f"{source}/.", f"{NAMESPACE}/{pod}:/workspace"],
            f"copy into pod/{pod}",
        )
        _fix_ownership(pod)
        click.echo(f"Seeded PVC {pvc}.")
    finally:
        _delete_pod_quiet(pod)


def _dump_one(pvc: str, dest: Path, dry_run: bool) -> None:
    """Copy the contents of the named PVC into ``dest``."""
    click.echo(f"Dumping PVC {pvc} → {dest} …")
    if dry_run:
        click.echo(f"[dry-run] Would copy PVC {pvc} contents into {dest}/.")
        return
    dest.mkdir(parents=True, exist_ok=True)
    pod = _start_helper_pod(pvc)
    try:
        _run_or_exit(
            ["cp", f"{NAMESPACE}/{pod}:/workspace/.", str(dest)],
            f"copy out of pod/{pod}",
        )
        click.echo(f"Dumped PVC {pvc}.")
    finally:
        _delete_pod_quiet(pod)


def _resolve_user_pvc(user_label: str) -> str:
    """Map ``user1``/``user2``/``workspace-userN`` to the PVC name."""
    if user_label.startswith("workspace-"):
        return user_label
    return f"workspace-{user_label}"


@click.group("files")
def files_group() -> None:
    """Manage workspace PVC contents (seed, dump, fix permissions)."""


@files_group.command("seed")
@click.option(
    "--pvc",
    "pvc",
    required=True,
    help="Target PVC name (e.g. workspace-user1 or workspace-common).",
)
@click.option(
    "--source",
    "source",
    required=True,
    type=click.Path(exists=False, file_okay=False, path_type=Path),
    help="Local directory to copy into the PVC.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print planned actions without touching the cluster.",
)
def files_seed(pvc: str, source: Path, dry_run: bool) -> None:
    """Copy a local directory into a single PVC."""
    _seed_one(pvc, source, dry_run)


@files_group.command("dump")
@click.option(
    "--pvc",
    "pvc",
    required=True,
    help="Source PVC name (e.g. workspace-user1).",
)
@click.option(
    "--dest",
    "dest",
    required=True,
    type=click.Path(file_okay=False, path_type=Path),
    help="Local directory to write the PVC contents into.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print planned actions without touching the cluster.",
)
def files_dump(pvc: str, dest: Path, dry_run: bool) -> None:
    """Copy a single PVC's contents back to a local directory."""
    _dump_one(pvc, dest, dry_run)


@files_group.command("fix-permissions")
@click.option(
    "--pvc",
    "pvc",
    required=True,
    help="PVC name to chown to the workspace user.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print planned actions without touching the cluster.",
)
def files_fix_permissions(pvc: str, dry_run: bool) -> None:
    """Re-set ownership inside a PVC to UID 1000 / GID 100."""
    click.echo(f"Fixing permissions in PVC {pvc} …")
    if dry_run:
        click.echo(
            f"[dry-run] Would chown -R {WORKSPACE_UID}:{WORKSPACE_GID} "
            f"and chmod -R g+rX inside PVC {pvc}."
        )
        return
    pod = _start_helper_pod(pvc)
    try:
        _fix_ownership(pod)
        click.echo(f"Fixed permissions in PVC {pvc}.")
    finally:
        _delete_pod_quiet(pod)


@files_group.command("seed-all")
@click.option(
    "--files-dir",
    "files_dir",
    default="files",
    show_default=True,
    type=click.Path(exists=False, file_okay=False, path_type=Path),
    help="Local directory containing ``template/`` and ``common/``.",
)
@click.option(
    "--user",
    "users",
    multiple=True,
    default=("user1", "user2"),
    show_default=True,
    help="User PVC label (repeatable). Each is seeded from <files-dir>/template/.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print planned actions without touching the cluster.",
)
def files_seed_all(files_dir: Path, users: tuple[str, ...], dry_run: bool) -> None:
    """Seed every workspace PVC from ``files/`` in one go.

    Copies ``files/common/`` into ``workspace-common`` and
    ``files/template/`` into each per-user PVC.
    """
    common_src = files_dir / "common"
    template_src = files_dir / "template"
    _seed_one("workspace-common", common_src, dry_run)
    for user in users:
        _seed_one(_resolve_user_pvc(user), template_src, dry_run)


@files_group.command("dump-all")
@click.option(
    "--dest-dir",
    "dest_dir",
    default="files",
    show_default=True,
    type=click.Path(file_okay=False, path_type=Path),
    help="Local directory to write PVC contents into.",
)
@click.option(
    "--user",
    "users",
    multiple=True,
    default=("user1", "user2"),
    show_default=True,
    help="User PVC label (repeatable). Each dumps to <dest-dir>/<user>/.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print planned actions without touching the cluster.",
)
def files_dump_all(dest_dir: Path, users: tuple[str, ...], dry_run: bool) -> None:
    """Dump every workspace PVC back to ``files/``."""
    _dump_one("workspace-common", dest_dir / "common", dry_run)
    for user in users:
        _dump_one(_resolve_user_pvc(user), dest_dir / user, dry_run)
