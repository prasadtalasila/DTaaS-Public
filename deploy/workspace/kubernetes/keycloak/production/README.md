<!-- markdownlint-disable MD041 -->
# DTaaS Workspace Kubernetes Deployment (Keycloak)

🎉 Thank you for downloading **Digital Twin as a Service**.

This guide explains how to deploy the application on Kubernetes for
secure multi-user deployments with Keycloak authentication.

## ❓ Prerequisites

✅ Kubernetes cluster v1.28 or later

✅ `kubectl` v1.28 or later

✅ Traefik v3 CRDs installed on the cluster

✅ Sufficient system resources (at least 2GB RAM per workspace instance)

✅ Domain name pointing to the cluster load balancer (required for automatic TLS via Let's Encrypt)

✅ A Kubernetes StorageClass named `local-path` (install
[rancher/local-path-provisioner](https://github.com/rancher/local-path-provisioner)
for single-node clusters, or replace `storageClassName` in PVC manifests with
your cloud/NFS storage class)

## 🗒️ Design

```text
User Request → Traefik (Ingress) → Forward Auth → Keycloak (OIDC)
                       ↓
                 User Workspace
```

The Kubernetes manifests in `manifests/` provide a production-ready setup:

- **Traefik** reverse proxy with TLS termination (ports 80, 443)
- **Automatic HTTPS certificates** via Let's Encrypt ACME (HTTP-01 challenge)
- **OAuth2 authentication** via `traefik-forward-auth`
- **Keycloak** identity provider for OIDC authentication
- **Multiple workspace instances** (user1, user2) behind authentication
- **DTaaS web client** served over HTTPS

### Manifests Structure

```text
manifests/
├── kustomization.yaml          # Kustomize entry point
├── namespace.yaml              # dtaas-workspace Namespace
├── dtaas-configmap.yaml        # Shared non-secret configuration
├── crds/                       # Traefik Custom Resource Definitions
│   └── traefik.yaml
├── traefik/                    # Traefik ingress controller
│   ├── serviceaccount.yaml
│   ├── clusterrole.yaml
│   ├── clusterrolebinding.yaml
│   ├── role.yaml
│   ├── rolebinding.yaml
│   ├── pvc-certs.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── keycloak/                   # Keycloak identity provider
│   ├── pvc.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── client/                     # DTaaS web client
│   ├── configmap.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── forward-auth/               # Traefik forward-auth middleware
│   ├── configmap.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── workspaces/                 # User workspace containers
│   ├── pvc-common.yaml
│   ├── pvc-user1.yaml
│   ├── pvc-user2.yaml
│   ├── deployment-user1.yaml
│   ├── service-user1.yaml
│   ├── deployment-user2.yaml
│   └── service-user2.yaml
└── ingress/                    # Traefik CRD routing rules
    ├── tlsstore.yaml
    ├── middleware.yaml
    ├── ingressroute-keycloak.yaml
    ├── ingressroute-client.yaml
    ├── ingressroute-forward-auth.yaml
    ├── ingressroute-user1.yaml
    └── ingressroute-user2.yaml
```

## 📁 User Directories

User workspace data is stored in Kubernetes PersistentVolumeClaims (PVCs).
See [`files/README.md`](files/README.md) for instructions on pre-populating
workspace data.

## ⚙️ Configuration

Follow the pre-install steps in [`CONFIGURATION.md`](CONFIGURATION.md).

### Apply Manifests

Copy the example environment file and populate it with your values,
then run the configuration script to apply settings to the cluster:

```bash
cp .env.example .env
# Edit .env with your domain, credentials, and ACME email
python scripts/config.py
```

Create the namespace and apply all manifests using Kustomize in two passes.
The first pass installs the Traefik CRDs; the second pass applies the
CRD instances once the API server has registered the new resource types:

```bash
kubectl apply -f manifests/namespace.yaml
kubectl apply -k manifests/crds/
kubectl apply -k manifests/
```

### 🌵 Temporary Issues

👉 `traefik-forward-auth` pod may restart until Keycloak is configured.
👉 Visiting `https://<DOMAIN_NAME>` shows `HTTP ERROR 500` until
   post-install Keycloak configuration is complete.

Complete the post-install steps in [`CONFIGURATION.md`](CONFIGURATION.md).
Then restart the forward-auth deployment:

```bash
kubectl rollout restart deployment/traefik-forward-auth -n dtaas-workspace
```

The application is accessible at `https://<DOMAIN_NAME>` from a web browser.

## 🛑 Stopping Services

To remove all deployed resources:

```bash
kubectl delete -k manifests/
kubectl delete namespace dtaas-workspace
```

To remove PersistentVolumeClaims (deletes workspace data):

```bash
kubectl delete pvc -n dtaas-workspace --all
```

## 🔧 Customisation

### Adding More Users

1. Create a new PVC in `manifests/workspaces/pvc-user3.yaml`
2. Create a new Deployment in `manifests/workspaces/deployment-user3.yaml`
3. Create a new Service in `manifests/workspaces/service-user3.yaml`
4. Add an IngressRoute in `manifests/ingress/ingressroute-user3.yaml`
5. Add the user rule to `manifests/forward-auth/configmap.yaml`
6. Add all new files to `manifests/kustomization.yaml`

## 🐛 Troubleshooting

### Certificate Issues

**Problem**: "NET::ERR_CERT_INVALID" or certificate not issued

**Solutions**:

- Ensure port 80 is accessible from the internet (required for ACME HTTP-01 challenge)
- Verify your domain A record resolves to the Traefik LoadBalancer IP
- Check Traefik logs for ACME errors: `kubectl logs -n dtaas-workspace deploy/traefik`
- Confirm `ACME_EMAIL` is set in `.env` and `dtaas-config` ConfigMap

### OAuth2 Issues

**Problem**: Redirect loop after OAuth2 login

**Solutions**:

- Verify `PROVIDERS_OIDC_ISSUER_URL` in the forward-auth secret
- Ensure redirect URIs in Keycloak client include `/_oauth/*`
- Check `COOKIE_DOMAIN` matches the domain
- Clear browser cookies and retry

### Service Access Issues

**Problem**: Cannot access workspace after authentication

**Solutions**:

- Check pod status: `kubectl get pods -n dtaas-workspace`
- View logs: `kubectl logs -n dtaas-workspace deploy/<service-name>`
- Check IngressRoutes: `kubectl get ingressroute -n dtaas-workspace`

## 📚 Additional Resources

- [Traefik Kubernetes Documentation](https://doc.traefik.io/traefik/providers/kubernetes-crd/)
- [Traefik Forward Auth](https://github.com/thomseddon/traefik-forward-auth)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
