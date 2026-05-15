# ⚙️ DTaaS Kubernetes Configuration

This document outlines the configuration needed for the Kubernetes deployment.
Configuration is divided into pre-install and post-install tasks.

**Pre-install Configuration Tasks:**

- [Namespace and ConfigMap](#-namespace-and-configmap)
- [Domain](#-domain)
- [TLS Certificates](#-tls-certificates)
- [Usernames](#-usernames)
- [Forward Auth](#-traefik-forward-auth-configuration)

**Post-install Configuration Tasks:**

- [Keycloak Integration](#-keycloak-integration)
- [Web Client](#️-dtaas-web-client-config)

## 🌍 Namespace and ConfigMap

All resources are deployed into the `dtaas-workspace` namespace defined in
`manifests/namespace.yaml`.

The `manifests/dtaas-configmap.yaml` holds non-sensitive configuration:

```yaml
data:
  SERVER_DNS: intocps.org   # Replace with your domain
  USERNAME1: user1          # Replace with your first username
  USERNAME2: user2          # Replace with your second username
  ACME_EMAIL: admin@intocps.org  # Email for Let's Encrypt notifications
```

### Using scripts/config.py

The `scripts/config.py` script reads a `.env` file and applies values to the
cluster. Copy the example file, fill in your values, then run:

```bash
cp .env.example .env
# Edit .env
python scripts/config.py
```

Run `python scripts/config.py --dry-run` to preview commands without applying.

## 🌐 Domain

Replace `intocps.org` in the following files with your actual domain:

- `manifests/dtaas-configmap.yaml` — `SERVER_DNS` value
- `manifests/client/configmap.yaml` — all `intocps.org` references
- `manifests/ingress/ingressroute-*.yaml` — `Host(...)` rules

## 🔒 TLS Certificates

TLS certificates are obtained automatically from Let's Encrypt using Traefik's
built-in ACME support (HTTP-01 challenge). No manual certificate management is
required.

**Prerequisites:**
- Your domain's DNS A record must point to the Traefik LoadBalancer IP.
- Port 80 must be reachable from the internet (for the HTTP-01 challenge).
- Set `ACME_EMAIL` in your `.env` file before deploying.

Traefik stores the issued certificates in the `traefik-acme-storage` PVC
at `/data/acme.json`. Certificates renew automatically before expiry.

Create the namespace before applying manifests:

```bash
kubectl apply -f manifests/namespace.yaml
```

## 👥 Usernames

Update `USERNAME1` and `USERNAME2` in `manifests/dtaas-configmap.yaml`.

Update the `PathPrefix` rules in:

- `manifests/forward-auth/configmap.yaml`
- `manifests/ingress/ingressroute-user1.yaml`
- `manifests/ingress/ingressroute-user2.yaml`

**NOTE:** Usernames must match the Keycloak users configured in forward auth.

## 🚪 Traefik Forward Auth Configuration

Edit `manifests/forward-auth/configmap.yaml` with the usernames
and email addresses of the Keycloak users:

```yaml
data:
  conf: |
    rule.user1_access.action=auth
    rule.user1_access.rule=PathPrefix(`/<USERNAME1>`)
    rule.user1_access.whitelist = <EMAIL_USER1>

    rule.user2_access.action=auth
    rule.user2_access.rule=PathPrefix(`/<USERNAME2>`)
    rule.user2_access.whitelist = <EMAIL_USER2>
```

Alternatively, copy the example file in `config/forward-auth-conf.example`
to use as a reference.

## 🎯 Keycloak Integration

Create the Keycloak credentials secret:

```bash
kubectl create secret generic dtaas-keycloak \
  --from-literal=KEYCLOAK_ADMIN=<ADMIN_USERNAME> \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD=<STRONG_PASSWORD> \
  --namespace=dtaas-workspace
```

Create the forward auth OIDC secret after configuring Keycloak:

```bash
kubectl create secret generic dtaas-forward-auth \
  --from-literal=PROVIDERS_OIDC_ISSUER_URL=https://<DOMAIN_NAME>/auth/realms/dtaas \
  --from-literal=PROVIDERS_OIDC_CLIENT_ID=dtaas-workspace \
  --from-literal=PROVIDERS_OIDC_CLIENT_SECRET=<CLIENT_SECRET> \
  --from-literal=SECRET=<RANDOM_SECRET> \
  --namespace=dtaas-workspace
```

Generate `<RANDOM_SECRET>` using:

```bash
openssl rand -base64 32
```

For detailed Keycloak setup, see [KEYCLOAK_SETUP.md](KEYCLOAK_SETUP.md).

## 🖥️ DTaaS Web Client Config

Edit `manifests/client/configmap.yaml` and replace all `intocps.org`
references with your domain name.

### 🔑🖥️ Client OAuth2 Setup

The DTaaS web client uses Authorization Code flow with PKCE.
Follow the [Create OAuth2 Client for DTaaS Client Service](KEYCLOAK_SETUP.md)
instructions then update `manifests/client/configmap.yaml`:

```js
REACT_APP_CLIENT_ID: 'dtaas-client',
REACT_APP_AUTH_AUTHORITY: 'https://<DOMAIN_NAME>/auth/realms/dtaas',
REACT_APP_REDIRECT_URI: 'https://<DOMAIN_NAME>/Library',
REACT_APP_LOGOUT_REDIRECT_URI: 'https://<DOMAIN_NAME>/',
REACT_APP_GITLAB_SCOPES: 'openid profile',
```

## 📚 Additional Resources

- [Traefik Kubernetes Documentation](https://doc.traefik.io/traefik/providers/kubernetes-crd/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
