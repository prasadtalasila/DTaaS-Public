#!/bin/bash
# Helper script to generate Kubernetes secrets from environment variables
# Usage: ./generate-secrets.sh

set -e

# Load environment variables
if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.template to .env and configure it."
    exit 1
fi

source .env

# Function to base64 encode
b64encode() {
    echo -n "$1" | base64 -w 0
}

echo "Generating OAuth credentials secret..."

# Create OAuth secret
cat > 02-secrets-generated.yaml <<EOF
---
# Auto-generated OAuth credentials secret
# Generated from .env file - DO NOT COMMIT THIS FILE
apiVersion: v1
kind: Secret
metadata:
  name: oauth-credentials
  namespace: dtaas
type: Opaque
data:
  oauth-auth-url: $(b64encode "${OAUTH_URL}/oauth/authorize")
  oauth-token-url: $(b64encode "${OAUTH_URL}/oauth/token")
  oauth-user-url: $(b64encode "${OAUTH_URL}/api/v4/user")
  oauth-client-id: $(b64encode "${OAUTH_CLIENT_ID}")
  oauth-client-secret: $(b64encode "${OAUTH_CLIENT_SECRET}")
  oauth-secret: $(b64encode "${OAUTH_SECRET}")
EOF

echo "OAuth credentials secret generated: 02-secrets-generated.yaml"

# Create TLS secret if certificate paths are provided
if [ -n "${TLS_CERT_PATH}" ] && [ -n "${TLS_KEY_PATH}" ]; then
    if [ -f "${TLS_CERT_PATH}" ] && [ -f "${TLS_KEY_PATH}" ]; then
        echo "Creating TLS certificate secret..."
        kubectl create secret tls traefik-tls-cert \
            --cert="${TLS_CERT_PATH}" \
            --key="${TLS_KEY_PATH}" \
            --namespace=dtaas \
            --dry-run=client -o yaml >> 02-secrets-generated.yaml
        echo "TLS certificate secret added to 02-secrets-generated.yaml"
    else
        echo "Warning: TLS certificate files not found at specified paths"
        echo "TLS_CERT_PATH: ${TLS_CERT_PATH}"
        echo "TLS_KEY_PATH: ${TLS_KEY_PATH}"
    fi
else
    echo "Warning: TLS certificate paths not set in .env"
    echo "You will need to create the TLS secret manually:"
    echo "kubectl create secret tls traefik-tls-cert --cert=<path> --key=<path> --namespace=dtaas"
fi

echo ""
echo "Secrets generation complete!"
echo "Apply with: kubectl apply -f 02-secrets-generated.yaml"
echo ""
echo "IMPORTANT: Do not commit 02-secrets-generated.yaml to version control!"
