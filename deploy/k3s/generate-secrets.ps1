# PowerShell script to generate Kubernetes secrets from environment variables
# Usage: .\generate-secrets.ps1

$ErrorActionPreference = "Stop"

# Load environment variables from .env file
if (-not (Test-Path ".env")) {
    Write-Error "Error: .env file not found. Copy .env.template to .env and configure it."
    exit 1
}

$envVars = @{}
Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)$') {
        $envVars[$matches[1].Trim()] = $matches[2].Trim()
    }
}

# Function to base64 encode
function ConvertTo-Base64 {
    param([string]$text)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    return [Convert]::ToBase64String($bytes)
}

Write-Host "Generating OAuth credentials secret..." -ForegroundColor Green

# Create OAuth secret
$oauthSecretContent = @"
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
  oauth-auth-url: $(ConvertTo-Base64 "$($envVars['OAUTH_URL'])/oauth/authorize")
  oauth-token-url: $(ConvertTo-Base64 "$($envVars['OAUTH_URL'])/oauth/token")
  oauth-user-url: $(ConvertTo-Base64 "$($envVars['OAUTH_URL'])/api/v4/user")
  oauth-client-id: $(ConvertTo-Base64 $envVars['OAUTH_CLIENT_ID'])
  oauth-client-secret: $(ConvertTo-Base64 $envVars['OAUTH_CLIENT_SECRET'])
  oauth-secret: $(ConvertTo-Base64 $envVars['OAUTH_SECRET'])
"@

Set-Content -Path "02-secrets-generated.yaml" -Value $oauthSecretContent
Write-Host "OAuth credentials secret generated: 02-secrets-generated.yaml" -ForegroundColor Green

# Create TLS secret if certificate paths are provided
if ($envVars.ContainsKey('TLS_CERT_PATH') -and $envVars.ContainsKey('TLS_KEY_PATH')) {
    $certPath = $envVars['TLS_CERT_PATH']
    $keyPath = $envVars['TLS_KEY_PATH']
    
    if ((Test-Path $certPath) -and (Test-Path $keyPath)) {
        Write-Host "Creating TLS certificate secret..." -ForegroundColor Green
        
        # Read certificate and key files
        $certContent = [Convert]::ToBase64String([IO.File]::ReadAllBytes($certPath))
        $keyContent = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyPath))
        
        $tlsSecretContent = @"

---
# TLS Certificate Secret
apiVersion: v1
kind: Secret
metadata:
  name: traefik-tls-cert
  namespace: dtaas
type: kubernetes.io/tls
data:
  tls.crt: $certContent
  tls.key: $keyContent
"@
        
        Add-Content -Path "02-secrets-generated.yaml" -Value $tlsSecretContent
        Write-Host "TLS certificate secret added to 02-secrets-generated.yaml" -ForegroundColor Green
    }
    else {
        Write-Warning "TLS certificate files not found at specified paths"
        Write-Warning "TLS_CERT_PATH: $certPath"
        Write-Warning "TLS_KEY_PATH: $keyPath"
    }
}
else {
    Write-Warning "TLS certificate paths not set in .env"
    Write-Host "You will need to create the TLS secret manually:" -ForegroundColor Yellow
    Write-Host "kubectl create secret tls traefik-tls-cert --cert=<path> --key=<path> --namespace=dtaas" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Secrets generation complete!" -ForegroundColor Green
Write-Host "Apply with: kubectl apply -f 02-secrets-generated.yaml" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANT: Do not commit 02-secrets-generated.yaml to version control!" -ForegroundColor Red
