# Saves the beds of the hospital into a snapshot: copies
# run/<DT_ID>/ward.json to DT_SNAPSHOT_DIR. POST /snapshot runs it.
$ErrorActionPreference = 'Stop'
$WardFile = Join-Path $PSScriptRoot "..\run\$env:DT_ID\ward.json"
Copy-Item -LiteralPath $WardFile -Destination (Join-Path $env:DT_SNAPSHOT_DIR 'ward.json')
