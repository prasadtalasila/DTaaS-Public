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

✅ Domain name pointing to the cluster load balancer
   (required for automatic TLS via Let's Encrypt)

✅ A Kubernetes StorageClass named `local-path` (install
[rancher/local-path-provisioner](https://github.com/rancher/local-path-provisioner)
for single-node clusters, or replace `storageClassName` in PVC manifests with
your cloud/NFS storage class)

## 🗒️ Design

The deployment runs entirely inside a single Kubernetes namespace
(`dtaas-workspace`). Traefik terminates TLS at the cluster edge and routes
each request to the correct backend after consulting `traefik-forward-auth`
for authentication. Keycloak is the identity provider for OIDC.

### Request Flow

```text
                         ┌─────────────────────────────┐
                         │   Browser (HTTPS, port 443) │
                         └──────────────┬──────────────┘
                                        │
                            ┌───────────▼────────────┐
                            │     Traefik Ingress    │
                            │      (TLS + ACME)      │
                            └─┬────────┬───────────┬─┘
              forward-auth on │        │ no auth   │ forward-auth on
                    /<user>,/ │        │ /auth,    │   /<user>, /
                              │        │ /_oauth   │
            ┌─────────────────┼────────┼───────────┼──────────────┐
            │                 │        │           │              │
   ┌────────▼─────────┐ ┌─────▼─────┐ ┌▼──────────┐ ┌─────────────▼────┐
   │ DTaaS Client (/) │ │ Workspaces│ │ Keycloak  │ │ traefik-forward- │
   │ React SPA        │ │ user1,    │ │ (/auth)   │ │ auth (/_oauth)   │
   │                  │ │ user2 …   │ │ OIDC IdP  │ │ OIDC middleware  │
   └──────────────────┘ └───────────┘ └─────▲─────┘ └─────────┬────────┘
                                            │                 │
                                            │ OIDC discovery, │
                                            │ token exchange  │
                                            │  (in-cluster)   │
                                            │                 │
                                       ┌────┴────────┐        │
                                       │  custom-dns │◄───────┘
                                       │  (CoreDNS)  │  resolve SERVER_DNS
                                       │ hairpin fix │  to Traefik ClusterIP
                                       └─────────────┘
```

`custom-dns` is only on the **forward-auth → Keycloak** path. The browser
talks to Keycloak directly via Traefik; the React SPA and workspaces never
go through `custom-dns`.

### Components

The Kubernetes manifests in `manifests/` provide a production-ready setup:

- **Traefik** ingress controller terminating TLS on ports 80/443. HTTP is
  redirected to HTTPS via an entrypoint redirection rule.
- **Automatic HTTPS certificates** issued by Let's Encrypt using the ACME
  HTTP-01 challenge, stored on a PVC so they survive pod restarts.
- **traefik-forward-auth** middleware enforces OIDC authentication on every
  protected route (the workspaces and the client; `/auth` and `/_oauth` are
  excluded).
- **Keycloak** identity provider mounted under `/auth`, backed by a PVC for
  realm and user persistence.
- **custom-dns (CoreDNS)** an in-namespace DNS server that resolves the
  public `SERVER_DNS` to the Traefik ClusterIP. This avoids the
  hairpin-NAT problem where `forward-auth` would otherwise try to talk to
  Keycloak via the external LoadBalancer IP and fail on single-node or
  NAT-restricted clusters.
- **Workspace pods** (`user1`, `user2`, …) each mount a per-user PVC and a
  shared read-only `workspace-common` PVC.
- **DTaaS web client** React SPA served on `/` and protected by the same
  forward-auth middleware.

### Authentication Sequence

1. Browser requests `https://<SERVER_DNS>/<user>`.
2. Traefik matches the IngressRoute and consults `traefik-forward-auth`.
3. If no session cookie exists, forward-auth redirects the browser to
   Keycloak at `/auth/realms/dtaas/protocol/openid-connect/auth`.
4. The user signs in; Keycloak redirects back to `/_oauth` with an
   authorization code.
5. forward-auth exchanges the code for tokens (resolving the issuer URL
   through `custom-dns` so the lookup stays inside the cluster) and sets
   a session cookie scoped to `SERVER_DNS`.
6. Subsequent requests pass the middleware and reach the workspace,
   client, or Keycloak service directly.

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
├── client/                     # DTaaS web client (React SPA)
│   ├── configmap.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── custom-dns/                 # In-namespace CoreDNS (hairpin-NAT fix)
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

For the full pre-install / post-install procedure, see
[`CONFIGURATION.md`](CONFIGURATION.md). The short version follows.

### Install

```bash
# 1. Fill in your domain, usernames, ACME email, Keycloak admin password, etc.
cp .env.example .env
$EDITOR .env

# 2. Install dependencies once (Python 3.10+).
cd cli
pip install -r requirements.txt
cd ..

# 3. One-shot install — namespace, CRDs, manifests, ConfigMap, secrets, patches.
cd cli && python -m cli.config install
```

The `install` command applies `manifests/namespace.yaml`, then the
Traefik CRDs, then the rest of the Kustomize bundle, then runs all the
per-environment patches that the older `apply` command did (domain
substitution, custom-DNS hairpin fix, secrets). On a fresh checkout it
also copies `manifests/dtaas-configmap.yaml.example` to its non-example
counterpart so Kustomize finds the file.

If you only want the patch step (for example, after editing `.env`):

```bash
cd cli && python -m cli.config apply
```

Pass `--dry-run` to either command to see the kubectl invocations
without touching the cluster.

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

### Seed Workspace PVCs

`workspace-user1`, `workspace-user2`, and `workspace-common` are empty
when first created. Populate them with the content under `files/` via:

```bash
cd cli && python -m cli.config files seed-all
```

See [`files/README.md`](files/README.md) for per-PVC commands and the
file-permission details.

## 🛑 Stopping Services

To remove all deployed resources:

```bash
kubectl delete -k manifests/
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
