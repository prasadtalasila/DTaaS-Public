#!/bin/bash
# Deploy DTaaS to k3s cluster
# Usage: ./deploy.sh [apply|delete]

set -e

ACTION=${1:-apply}
NAMESPACE="dtaas"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    log_error "kubectl is not installed. Please install kubectl first."
    exit 1
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    log_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi

if [ "$ACTION" == "apply" ]; then
    log_info "Deploying DTaaS to k3s cluster..."
    
    # Check if .env file exists
    if [ ! -f .env ]; then
        log_warn ".env file not found. Using template values from manifests."
        log_warn "For production, create .env from .env.template and run ./generate-secrets.sh"
    fi
    
    # Apply manifests in order
    log_info "Creating namespace..."
    kubectl apply -f 00-namespace.yaml
    
    log_info "Creating ConfigMaps..."
    kubectl apply -f 01-configmaps.yaml
    
    log_info "Creating Secrets..."
    if [ -f 02-secrets-generated.yaml ]; then
        log_info "Using generated secrets (02-secrets-generated.yaml)..."
        kubectl apply -f 02-secrets-generated.yaml
    else
        log_warn "Generated secrets not found. Using template (may have placeholder values)..."
        kubectl apply -f 02-secrets.yaml
    fi
    
    log_info "Creating storage resources..."
    kubectl apply -f 03-volumes.yaml
    
    log_info "Deploying Traefik..."
    kubectl apply -f 04-traefik.yaml
    
    log_info "Deploying client..."
    kubectl apply -f 05-client.yaml
    
    log_info "Deploying library microservice..."
    kubectl apply -f 06-libms.yaml
    
    log_info "Deploying user workspaces..."
    kubectl apply -f 07-user-workspaces.yaml
    
    log_info "Deploying authentication service..."
    kubectl apply -f 08-traefik-forward-auth.yaml
    
    log_info "Creating ingress routes..."
    kubectl apply -f 09-ingress.yaml
    
    log_info ""
    log_info "Deployment complete!"
    log_info ""
    log_info "Check deployment status:"
    log_info "  kubectl get pods -n ${NAMESPACE}"
    log_info "  kubectl get svc -n ${NAMESPACE}"
    log_info ""
    log_info "View logs:"
    log_info "  kubectl logs -n ${NAMESPACE} -l app=traefik"
    log_info "  kubectl logs -n ${NAMESPACE} -l app=client"
    log_info ""
    
    # Wait a moment and check pod status
    sleep 3
    log_info "Current pod status:"
    kubectl get pods -n ${NAMESPACE}
    
elif [ "$ACTION" == "delete" ]; then
    log_warn "Removing DTaaS from k3s cluster..."
    read -p "Are you sure you want to delete all DTaaS resources? (yes/no): " confirm
    
    if [ "$confirm" == "yes" ]; then
        kubectl delete namespace ${NAMESPACE} --wait=true
        log_info "DTaaS has been removed from the cluster."
    else
        log_info "Deletion cancelled."
    fi
    
else
    log_error "Unknown action: $ACTION"
    echo "Usage: $0 [apply|delete]"
    exit 1
fi
