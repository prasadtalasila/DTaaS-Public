# ⚙️ DTaaS Kubernetes Configuration

This document outlines the configuration needed for the Kubernetes deployment.
Configuration is divided into pre-install and post-install tasks.

**Pre-install Configuration Tasks:**

- [Namespace and ConfigMap](#-namespace-and-configmap)
- [Domain](#-domain)
- [DNS Verification](#-dns-verification)
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
  SERVER_DNS: YOUR_SERVER_DNS   # Replace with your domain
  USERNAME1: user1              # Replace with your first username
  USERNAME2: user2              # Replace with your second username
  ACME_EMAIL: admin@YOUR_SERVER_DNS  # Email for Let's Encrypt notifications
```

### Using the `cli/` package

The `cli/` package reads a `.env` file and applies values to the
cluster. Copy the example file, fill in your values, then run a single
install command:

```bash
cp .env.example .env
# Edit .env with your domain, credentials, and email
cd cli && python -m cli.config install
```

`install` applies `manifests/namespace.yaml`, then the Traefik CRDs,
then the rest of the Kustomize bundle, then runs all the per-environment
patches. Pass `--dry-run` to preview the kubectl commands without
touching the cluster.

If you only want the patch step (for example after editing `.env`):

```bash
python -m cli.config apply
```

The patch step performs these actions automatically:

- Creates or updates the `dtaas-config` ConfigMap with `SERVER_DNS`,
  usernames and ACME email
- Patches all IngressRoute `Host()` rules to use your domain
- Updates the `client-config` ConfigMap URLs and restarts the client
- Deploys the custom in-namespace DNS resolver (hairpin NAT fix) and
  points `forward-auth` at it
- Creates or updates the Keycloak and forward-auth Kubernetes secrets

## 🌐 Domain

Set `SERVER_DNS` in `.env` to your fully qualified domain name. Then run
`cd cli && python -m cli.config apply` to propagate the domain across
all resources.

The manifests use `YOUR_SERVER_DNS` as a placeholder. Do not edit them
directly — let `cli.config apply` handle the substitution.

## 🔍 DNS Verification

Before deploying, verify that your domain's DNS A record points to the Traefik
LoadBalancer IP:

```bash
python -m cli.config network show
```

Example output when DNS is correct:

```text
Domain         : shared.dtaas-digitaltwin.com
LoadBalancer IP: 91.98.222.171
DNS resolved   : 91.98.222.171

✓ DNS correctly configured: shared.dtaas-digitaltwin.com → 91.98.222.171
```

If the DNS is not yet configured or points to the wrong IP, the command prints
the mismatch and provides fix instructions:

```text
✗ DNS mismatch: shared.dtaas-digitaltwin.com resolves to 1.2.3.4
  but LoadBalancer IP is 91.98.222.171.

── How to fix DNS ──────────────────────────────────────
  Add an A record at your DNS provider / registrar:
    Type : A
    Name : shared.dtaas-digitaltwin.com
    Value: 91.98.222.171
    TTL  : 300  (5 minutes recommended)
...
```

DNS changes typically propagate within a few minutes. Run
`cd cli && python -m cli.config network show` again to confirm before proceeding.

## 🔒 TLS Certificates

TLS certificates are obtained automatically from Let's Encrypt using Traefik's
built-in ACME support (HTTP-01 challenge). No manual certificate management is
required.

**Prerequisites:**

- DNS A record must point to the Traefik LoadBalancer IP (verify with
  `cd cli && python -m cli.config network show`).
- Port 80 must be reachable from the internet (for the HTTP-01 challenge).
- Set `ACME_EMAIL` in your `.env` file before deploying.

Traefik stores the issued certificates in the `traefik-acme-storage` PVC
at `/data/acme.json`. Certificates renew automatically before expiry.

The `install` command creates the namespace before applying the rest of
the bundle, so you do not need to run `kubectl apply` by hand.

## 👥 Usernames

Update `USERNAME1` and `USERNAME2` in `.env`, then run
`python -m cli.config apply`.

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

The client ConfigMap URLs are patched automatically by
`cd cli && python -m cli.config apply` (or by `install`).

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
