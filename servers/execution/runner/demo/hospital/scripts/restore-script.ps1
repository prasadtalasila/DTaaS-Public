# Restores the beds of the hospital from a snapshot: copies ward.json of
# DT_SNAPSHOT_DIR to run/<DT_ID>/. runner --reinstate runs it.
$ErrorActionPreference = 'Stop'
$WardDir = Join-Path $PSScriptRoot "..\run\$env:DT_ID"
New-Item -ItemType Directory -Force -Path $WardDir | Out-Null
Copy-Item -LiteralPath (Join-Path $env:DT_SNAPSHOT_DIR 'ward.json') -Destination (Join-Path $WardDir 'ward.json')
