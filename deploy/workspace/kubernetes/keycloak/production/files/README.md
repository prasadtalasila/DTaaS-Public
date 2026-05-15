# Workspace Files

This directory contains the workspace files for the DTaaS deployment.

## Directory Structure

```text
files/
├── common/        # Shared files for all users (read-only in workspaces)
│   ├── data/
│   ├── digital_twins/
│   ├── functions/
│   ├── models/
│   └── tools/
└── template/      # Template directory to create new user workspaces
    ├── data/
    ├── digital_twins/
    ├── functions/
    ├── models/
    └── tools/
```

## Setup

User workspace data is stored in Kubernetes PersistentVolumeClaims (PVCs).
The PVCs are defined in `../manifests/workspaces/`.

To pre-populate workspace files, copy template data into the PVCs
after provisioning. One way is to use a temporary pod:

```bash
kubectl run -n dtaas-workspace workspace-init \
  --image=busybox --restart=Never \
  --overrides='{"spec":{"volumes":[{"name":"pvc","persistentVolumeClaim":{"claimName":"workspace-user1"}}],"containers":[{"name":"workspace-init","image":"busybox","command":["sh","-c","sleep 3600"],"volumeMounts":[{"name":"pvc","mountPath":"/workspace"}]}]}}' \
  -- sleep 3600

kubectl cp files/template/. dtaas-workspace/workspace-init:/workspace/
kubectl delete pod -n dtaas-workspace workspace-init
```

Repeat for each user PVC and for the common PVC.

## File Permissions

The workspace container starts as root (UID 0) with supplemental group `100`
(`fsGroup: 100`). The container's entrypoint switches to a workspace user
(UID 1000) for normal operation. Ensure files in PVCs are group-readable
by GID 100, or owned by UID 1000, so the workspace user can access them.
