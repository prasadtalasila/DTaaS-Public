# Workspace Files

This directory holds the seed content that pre-populates each user's
Kubernetes PersistentVolumeClaim (PVC) and the shared `workspace-common`
PVC. The files here are **not mounted directly** by the workspace
containers — the CLI copies them into the PVCs once, after the cluster
is provisioned.

## Directory Structure

```text
files/
├── common/        # Shared content for all users (read-only in workspaces)
│   ├── data/
│   ├── digital_twins/
│   ├── functions/
│   ├── models/
│   └── tools/
└── template/      # Template content used to seed each new user workspace
    ├── data/
    ├── digital_twins/
    ├── functions/
    ├── models/
    └── tools/
```

Each subdirectory keeps a `.gitkeep` so the empty layout is preserved
in version control. Replace the placeholder files with your own content
before seeding the PVCs.

## How the Volumes Are Mounted

Each user Deployment mounts two PVCs (see
`../manifests/workspaces/deployment-user1.yaml`):

| PVC                | Mount path           | Mode      |
| ------------------ | -------------------- | --------- |
| `workspace-user1`  | `/workspace`         | read/write |
| `workspace-common` | `/workspace/common`  | read-only |

`workspace-common` is mounted read-only into every user pod, so it
should hold only assets you want to share across users. Per-user PVCs
(`workspace-user1`, `workspace-user2`, …) provide each user's private
read/write workspace.

## Seeding the PVCs

The `cli/` package wraps the entire seed flow (helper pod, `kubectl cp`,
ownership fix, cleanup). Run it from the `cli/` directory after the
manifests have been applied:

```bash
cd cli
python -m cli.config files seed-all
```

That single command:

1. Starts a short-lived `busybox` helper pod that mounts the target PVC.
2. Waits for the pod to be Ready.
3. Runs `kubectl cp files/common/.  …` and
   `kubectl cp files/template/. …` for each PVC.
4. Sets ownership to `UID 1000 : GID 100` so the workspace user can
   read and write (see [File Permissions](#file-permissions-for-volume-mapping)
   below).
5. Deletes the helper pod.

Useful flags:

- `--files-dir DIR` — point at an alternate directory containing
  `common/` and `template/`. Defaults to `files/`.
- `--user user3 --user user4` — repeat to seed extra user PVCs (the
  PVCs themselves must exist; see the customisation section of the
  parent README).
- `--dry-run` — print the kubectl commands without touching the cluster.

For a single PVC:

```bash
cd cli
python -m cli.config files seed \
    --pvc workspace-user1 \
    --source ../files/template
```

## Copying Files Back

To pull a PVC back to disk:

```bash
cd cli
python -m cli.config files dump-all                    # → ../files/{common,user1,user2}/
python -m cli.config files dump \
    --pvc workspace-user1 --dest ../files/user1        # one PVC only
```

Both commands start a helper pod, run `kubectl cp` in the opposite
direction, then delete the pod.

For very large volumes you may prefer to run `tar` inside the helper
pod and stream the archive yourself:

```bash
kubectl exec -n dtaas-workspace <helper-pod> -- tar c -C /workspace . \
    > workspace-user1.tar
```

## File Permissions for Volume Mapping

The workspace container starts as root (UID 0) with the supplemental
group `100` (`fsGroup: 100` in the pod `securityContext`). The image's
entrypoint then drops privileges to the workspace user (UID 1000) for
normal operation.

Two consequences follow:

1. **`fsGroup: 100` retags files at mount time.** When a pod first
   mounts a PVC, Kubernetes recursively `chown` the volume to GID 100
   and adds group-read permissions. Files copied in afterwards do **not**
   inherit this — the workspace user can only access them if they are
   owned by UID 1000 *or* group-readable to GID 100.

2. **Read-only common volume.** `workspace-common` is mounted read-only
   into each user pod, so it is enough that the workspace user can
   *read* the files; write permissions are irrelevant there.

The CLI handles both concerns automatically: after every `seed` /
`seed-all`, it runs `chown -R 1000:100 /workspace && chmod -R g+rX
/workspace` inside the helper pod, so the workspace user can read
everything and write the per-user PVC.

If you somehow end up with the wrong ownership (for example, you copied
files in by hand), re-apply the fix without re-seeding:

```bash
cd cli
python -m cli.config files fix-permissions --pvc workspace-user1
```

### Common Pitfalls

- **`Permission denied` on the read-only common mount.** Files were
  copied as UID 0 without group-read. Run
  `python -m cli.config files fix-permissions --pvc workspace-common`.
- **PVC starts with the wrong contents after a re-install.** Deleting
  the Deployment does **not** delete the PVC. Either reuse the existing
  data, or run `kubectl delete pvc -n dtaas-workspace --all` to drop the
  volumes and start fresh.
- **`fsGroup` retagging is slow on large volumes.** Pre-fix the
  ownership with `fix-permissions` and remove `fsGroup` from the
  Deployment if startup latency is a concern.
