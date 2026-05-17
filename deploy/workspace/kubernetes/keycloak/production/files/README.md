# Workspace Files

This directory holds the seed content that pre-populates each user's
Kubernetes PersistentVolumeClaim (PVC) and the shared `workspace-common`
PVC. The files here are **not mounted directly** by the workspace
containers — they are copied into the PVCs once, after the cluster is
provisioned.

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

The `workspace-common` PVC is mounted into every user pod read-only,
so it should hold only assets you want to share across users.
Per-user PVCs (`workspace-user1`, `workspace-user2`, …) provide each
user's private read/write workspace and should be seeded from
`files/template/`.

## Seeding the PVCs (Local → Cluster)

After the manifests are applied and the PVCs are bound, copy the local
content into the cluster. A short-lived helper pod is the simplest path:

```bash
# 1. Pick the PVC you want to populate (workspace-user1 in this example).
PVC=workspace-user1

# 2. Start a temporary helper pod that mounts the PVC at /workspace.
kubectl run -n dtaas-workspace seed-${PVC} \
  --image=busybox --restart=Never \
  --overrides="{\"spec\":{\"securityContext\":{\"fsGroup\":100},\"volumes\":[{\"name\":\"pvc\",\"persistentVolumeClaim\":{\"claimName\":\"${PVC}\"}}],\"containers\":[{\"name\":\"seed\",\"image\":\"busybox\",\"command\":[\"sh\",\"-c\",\"sleep 3600\"],\"volumeMounts\":[{\"name\":\"pvc\",\"mountPath\":\"/workspace\"}]}]}}" \
  -- sleep 3600

# 3. Wait until the helper pod is Ready.
kubectl wait -n dtaas-workspace --for=condition=Ready pod/seed-${PVC} --timeout=120s

# 4. Copy the template content into the PVC.
kubectl cp files/template/. dtaas-workspace/seed-${PVC}:/workspace/

# 5. Tear the helper pod down.
kubectl delete pod -n dtaas-workspace seed-${PVC}
```

Repeat the steps for each user PVC (`workspace-user2`, …) and for the
shared `workspace-common` PVC (in step 4 use `files/common/.` instead of
`files/template/.`).

## Copying Files Back (Cluster → Local)

You can pull files out of any PVC the same way — start a helper pod, then
use `kubectl cp` with the source/destination reversed:

```bash
PVC=workspace-user1

# 1. Start the helper pod (same overrides as above).
kubectl run -n dtaas-workspace dump-${PVC} \
  --image=busybox --restart=Never \
  --overrides="{\"spec\":{\"securityContext\":{\"fsGroup\":100},\"volumes\":[{\"name\":\"pvc\",\"persistentVolumeClaim\":{\"claimName\":\"${PVC}\"}}],\"containers\":[{\"name\":\"dump\",\"image\":\"busybox\",\"command\":[\"sh\",\"-c\",\"sleep 3600\"],\"volumeMounts\":[{\"name\":\"pvc\",\"mountPath\":\"/workspace\"}]}]}}" \
  -- sleep 3600

kubectl wait -n dtaas-workspace --for=condition=Ready pod/dump-${PVC} --timeout=120s

# 2. Copy the PVC contents back into files/<user>/ on your machine.
mkdir -p files/${PVC}
kubectl cp dtaas-workspace/dump-${PVC}:/workspace ./files/${PVC}/

# 3. Tear down.
kubectl delete pod -n dtaas-workspace dump-${PVC}
```

For the shared volume, set `PVC=workspace-common` and copy back into
`files/common/`. To take a full snapshot of every PVC at once, wrap the
loop above in a small shell script.

> **Note:** `kubectl cp` requires `tar` to be available in the helper pod
> image. The `busybox` image above provides it. For very large volumes
> consider running `tar` inside the helper pod and streaming the archive
> with `kubectl exec ... -- tar c .` instead.

## File Permissions for Volume Mapping

The workspace container starts as root (UID 0) with the supplemental
group `100` (`fsGroup: 100` in the pod `securityContext`). The image's
entrypoint then drops privileges to the workspace user (UID 1000) for
normal operation.

Two consequences follow:

1. **`fsGroup: 100` retags files at mount time.** When a pod first
   mounts a PVC, Kubernetes recursively `chown` the volume to GID 100
   and adds group-read permissions. Files copied in afterwards do **not**
   inherit this — you must either own them as UID 1000 or make them
   group-readable to GID 100 before the workspace user can use them.

2. **Read-only common volume.** `workspace-common` is mounted read-only
   into each user pod, so it is enough that the workspace user can
   *read* the files; write permissions are irrelevant in the pod.

### Recommended Permissions Before Seeding

Run these commands on the host that holds your local `files/` directory
before copying anything into the cluster:

```bash
# Group-read everything so GID 100 inside the pod can read it.
chmod -R g+rX files/

# Optional but safer: set the group ownership explicitly.
sudo chown -R :100 files/

# Make per-user directories writable by the workspace user (UID 1000).
sudo chown -R 1000:100 files/template/
```

If you cannot use `sudo` locally, do the same fix inside the helper pod
after copying:

```bash
kubectl exec -n dtaas-workspace seed-${PVC} -- \
  sh -c 'chown -R 1000:100 /workspace && chmod -R g+rX /workspace'
```

### Verifying Permissions

After seeding, exec into the running workspace pod and confirm the
workspace user can list and read the files:

```bash
kubectl exec -n dtaas-workspace deploy/user1 -- \
  ls -la /workspace /workspace/common
```

You should see `user1` (UID 1000) or group `100` ownership, and the
contents should be readable.

### Common Pitfalls

- **`Permission denied` on the read-only common mount.** The files were
  copied as UID 0 with mode `0600`. Re-seed with `chmod -R g+rX` applied
  first, or fix in place with the `kubectl exec` recipe above.
- **PVC starts with the wrong contents after a re-install.** Deleting
  the Deployment does **not** delete the PVC. Either reuse the existing
  data, or run `kubectl delete pvc -n dtaas-workspace --all` to drop the
  volumes and start fresh.
- **`fsGroup` retagging is slow on large volumes.** This is a known
  Kubernetes behaviour. For PVCs with millions of files, pre-fix the
  ownership in the helper pod and remove `fsGroup` from the Deployment.
