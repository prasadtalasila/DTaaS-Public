# Restores the beds of the hospital from a snapshot: copies ward.json of
# DT_SNAPSHOT_DIR to the ward directory of ward.ps1, run\<DT_ID>\ or that
# of a replay twin. runner --reinstate runs it.
. "$PSScriptRoot\ward.ps1"
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $WardDir | Out-Null
Copy-Item -LiteralPath (Join-Path $env:DT_SNAPSHOT_DIR 'ward.json') -Destination $WardFile
