# Saves the beds of the hospital into a snapshot: copies ward.json of
# the ward directory of ward.ps1, run\<DT_ID>\ or that of a replay twin,
# to DT_SNAPSHOT_DIR. POST /snapshot runs it.
. "$PSScriptRoot\ward.ps1"
$ErrorActionPreference = 'Stop'
Copy-Item -LiteralPath $WardFile -Destination (Join-Path $env:DT_SNAPSHOT_DIR 'ward.json')
