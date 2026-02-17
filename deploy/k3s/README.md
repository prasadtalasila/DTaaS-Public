# DTaaS Kubernetes (k3s) Deployment

This directory contains Kubernetes manifests for deploying DTaaS on a k3s cluster. These manifests have been converted from the Docker Compose configuration in `deploy/docker/compose.server.secure.yml`.

## Overview

The deployment consists of the following components:

- **Traefik**: Reverse proxy and ingress controller with TLS termination
- **Client**: React-based web frontend
- **LibMS**: Library management microservice
- **User Workspaces**: ML workspace containers for each user (user1, user2)
- **Traefik Forward Auth**: OAuth2 authentication middleware

## Prerequisites

- k3s cluster (v1.21+)
- kubectl configured to access your cluster
- Valid TLS certificates for your domain
- OAuth2 provider (GitLab) credentials
- Storage provisioner (k3s comes with local-path provisioner by default)

## Directory Structure

```
deploy/k3s/
├── 00-namespace.yaml                  # Namespace definition
├── 01-configmaps.yaml                 # Configuration files (client, libms, traefik, auth)
├── 02-secrets.yaml                    # OAuth credentials and TLS certificates (template)
├── 03-volumes.yaml                    # PersistentVolumes and PersistentVolumeClaims
├── 04-traefik.yaml                    # Traefik deployment, service, and RBAC
├── 05-client.yaml                     # Client deployment and service
├── 06-libms.yaml                      # Library microservice deployment and service
├── 07-user-workspaces.yaml            # User workspace deployments and services
├── 08-traefik-forward-auth.yaml       # Authentication service deployment and service
├── 09-ingress.yaml                    # Traefik IngressRoute resources
├── kustomization.yaml                 # Kustomize configuration for deployment
├── .env.template                      # Environment variables template
└── README.md                          # This file
```

## Configuration

### Step 1: Configure Environment Variables

1. Copy the environment template:
   ```bash
   cp .env.template .env
   ```

2. Edit `.env` and update the following values:
   - `SERVER_DNS`: Your domain name (e.g., dtaas.example.com)
   - `OAUTH_URL`: Your GitLab OAuth URL
   - `OAUTH_CLIENT_ID`: Your OAuth client ID
   - `OAUTH_CLIENT_SECRET`: Your OAuth client secret
   - `OAUTH_SECRET`: A random secret string for OAuth sessions
   - `USERNAME1`: First user's username
   - `USERNAME2`: Second user's username

### Step 2: Update ConfigMaps

Edit `01-configmaps.yaml` and update:
- `client-config`: Update URLs and OAuth settings to match your domain
- `libms-config`: Update Git repository URLs if using Git mode
- `traefik-forward-auth-config`: Update user email whitelists

### Step 3: Create TLS Certificates Secret

Create a Kubernetes secret with your TLS certificates:

```bash
kubectl create secret tls traefik-tls-cert \
  --cert=/path/to/fullchain.pem \
  --key=/path/to/privkey.pem \
  --namespace=dtaas
```

Or edit `02-secrets.yaml` and add your base64-encoded certificate data.

### Step 4: Create OAuth Secrets

Encode your OAuth credentials:

```bash
echo -n 'https://gitlab.example.com' | base64
echo -n 'your-client-id' | base64
echo -n 'your-client-secret' | base64
echo -n 'random-secret-string' | base64
```

Update the values in `02-secrets.yaml` under `oauth-credentials`.

### Step 5: Configure Storage

The manifests use k3s's default `local-path` storage class with hostPath volumes. Update `03-volumes.yaml` if you need to:
- Change storage paths (default: `/dtaas/files`)
- Use a different storage class
- Adjust storage sizes

**Important**: Ensure the directories exist on the host:

```bash
sudo mkdir -p /dtaas/files/{common,user1,user2}
sudo chown -R 1000:1000 /dtaas/files
```

## Deployment

### Option 1: Deploy with kubectl

Deploy all resources in order:

```bash
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-configmaps.yaml
kubectl apply -f 02-secrets.yaml
kubectl apply -f 03-volumes.yaml
kubectl apply -f 04-traefik.yaml
kubectl apply -f 05-client.yaml
kubectl apply -f 06-libms.yaml
kubectl apply -f 07-user-workspaces.yaml
kubectl apply -f 08-traefik-forward-auth.yaml
kubectl apply -f 09-ingress.yaml
```

### Option 2: Deploy with Kustomize

Deploy all resources at once:

```bash
kubectl apply -k .
```

## Verification

Check deployment status:

```bash
# Check all pods
kubectl get pods -n dtaas

# Check services
kubectl get svc -n dtaas

# Check ingress routes
kubectl get ingressroute -n dtaas

# Check logs
kubectl logs -n dtaas deployment/traefik
kubectl logs -n dtaas deployment/client
kubectl logs -n dtaas deployment/libms
```

## Accessing the Application

Once deployed, access the application at:
- Main application: `https://foo.com/`
- Library service: `https://foo.com/lib`
- User1 workspace: `https://foo.com/user1`
- User2 workspace: `https://foo.com/user2`

Replace `foo.com` with your actual domain.

## Scaling

To add more user workspaces:

1. Add a new PV/PVC in `03-volumes.yaml`
2. Add a new deployment in `07-user-workspaces.yaml`
3. Add a new IngressRoute in `09-ingress.yaml`
4. Update the auth config in `01-configmaps.yaml`

## Resource Limits

Default resource limits per component:

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| Traefik | 100m | 500m | 128Mi | 512Mi |
| Client | 100m | 500m | 128Mi | 512Mi |
| LibMS | 100m | 500m | 128Mi | 512Mi |
| User Workspace | 500m | 4 cores | 512Mi | 4Gi |
| Forward Auth | 50m | 200m | 64Mi | 256Mi |

Adjust these values in the respective deployment files based on your cluster capacity.

## Troubleshooting

### Pods not starting

Check pod events:
```bash
kubectl describe pod <pod-name> -n dtaas
```

### Storage issues

Verify PVCs are bound:
```bash
kubectl get pvc -n dtaas
```

### Authentication not working

Check traefik-forward-auth logs:
```bash
kubectl logs -n dtaas deployment/traefik-forward-auth
```

### Ingress not accessible

Check Traefik service external IP:
```bash
kubectl get svc traefik -n dtaas
```

For k3s, Traefik is exposed as LoadBalancer. If using bare metal, you may need to configure MetalLB or use NodePort.

## Security Considerations

1. **Secrets**: Never commit `02-secrets.yaml` with real credentials
2. **TLS**: Always use valid TLS certificates in production
3. **OAuth**: Ensure OAuth callback URLs are correctly configured
4. **Network Policies**: Consider adding NetworkPolicy resources for additional isolation
5. **RBAC**: Review and restrict Traefik RBAC permissions as needed

## Migration from Docker Compose

Key differences from Docker Compose deployment:

1. **Networking**: Uses Kubernetes Services instead of Docker networks
2. **Storage**: Uses PersistentVolumes instead of bind mounts
3. **Environment Variables**: Managed through ConfigMaps and Secrets
4. **Service Discovery**: Uses DNS names (service-name.namespace.svc.cluster.local)
5. **Ingress**: Uses Traefik IngressRoute CRDs instead of Docker labels

## Updating Configuration

To update configuration:

```bash
# Update ConfigMap
kubectl apply -f 01-configmaps.yaml

# Restart affected deployments
kubectl rollout restart deployment/client -n dtaas
kubectl rollout restart deployment/libms -n dtaas
```

## Cleanup

To remove all DTaaS resources:

```bash
kubectl delete namespace dtaas
```

Or with Kustomize:

```bash
kubectl delete -k .
```

## Support

For issues and support, refer to the main DTaaS documentation at `docs/`.
