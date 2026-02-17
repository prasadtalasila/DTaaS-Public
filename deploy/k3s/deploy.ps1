# PowerShell script to deploy DTaaS to k3s cluster
# Usage: .\deploy.ps1 [-Action apply|delete]

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("apply", "delete")]
    [string]$Action = "apply"
)

$ErrorActionPreference = "Stop"
$Namespace = "dtaas"

function Write-Info {
    param([string]$message)
    Write-Host "[INFO] $message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$message)
    Write-Host "[WARN] $message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$message)
    Write-Host "[ERROR] $message" -ForegroundColor Red
}

# Check if kubectl is installed
try {
    kubectl version --client | Out-Null
} catch {
    Write-Error "kubectl is not installed. Please install kubectl first."
    exit 1
}

# Check if cluster is accessible
try {
    kubectl cluster-info | Out-Null
} catch {
    Write-Error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
}

if ($Action -eq "apply") {
    Write-Info "Deploying DTaaS to k3s cluster..."
    
    # Check if .env file exists
    if (-not (Test-Path ".env")) {
        Write-Warn ".env file not found. Using template values from manifests."
        Write-Warn "For production, create .env from .env.template and run .\generate-secrets.ps1"
    }
    
    # Apply manifests in order
    Write-Info "Creating namespace..."
    kubectl apply -f 00-namespace.yaml
    
    Write-Info "Creating ConfigMaps..."
    kubectl apply -f 01-configmaps.yaml
    
    Write-Info "Creating Secrets..."
    if (Test-Path "02-secrets-generated.yaml") {
        Write-Info "Using generated secrets (02-secrets-generated.yaml)..."
        kubectl apply -f 02-secrets-generated.yaml
    } else {
        Write-Warn "Generated secrets not found. Using template (may have placeholder values)..."
        kubectl apply -f 02-secrets.yaml
    }
    
    Write-Info "Creating storage resources..."
    kubectl apply -f 03-volumes.yaml
    
    Write-Info "Deploying Traefik..."
    kubectl apply -f 04-traefik.yaml
    
    Write-Info "Deploying client..."
    kubectl apply -f 05-client.yaml
    
    Write-Info "Deploying library microservice..."
    kubectl apply -f 06-libms.yaml
    
    Write-Info "Deploying user workspaces..."
    kubectl apply -f 07-user-workspaces.yaml
    
    Write-Info "Deploying authentication service..."
    kubectl apply -f 08-traefik-forward-auth.yaml
    
    Write-Info "Creating ingress routes..."
    kubectl apply -f 09-ingress.yaml
    
    Write-Host ""
    Write-Info "Deployment complete!"
    Write-Host ""
    Write-Info "Check deployment status:"
    Write-Host "  kubectl get pods -n $Namespace"
    Write-Host "  kubectl get svc -n $Namespace"
    Write-Host ""
    Write-Info "View logs:"
    Write-Host "  kubectl logs -n $Namespace -l app=traefik"
    Write-Host "  kubectl logs -n $Namespace -l app=client"
    Write-Host ""
    
    # Wait a moment and check pod status
    Start-Sleep -Seconds 3
    Write-Info "Current pod status:"
    kubectl get pods -n $Namespace
    
} elseif ($Action -eq "delete") {
    Write-Warn "Removing DTaaS from k3s cluster..."
    $confirm = Read-Host "Are you sure you want to delete all DTaaS resources? (yes/no)"
    
    if ($confirm -eq "yes") {
        kubectl delete namespace $Namespace --wait=true
        Write-Info "DTaaS has been removed from the cluster."
    } else {
        Write-Info "Deletion cancelled."
    }
}
