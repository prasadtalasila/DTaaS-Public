# State open, admitting patients: logs the script context, then watches
# the beds and raises the event full over HTTP once every bed is taken
. "$PSScriptRoot\ward.ps1"
Write-WardLog "open   DT_ID=$env:DT_ID DT_STATE=$env:DT_STATE DT_ENTRY=$env:DT_ENTRY"
Write-WardLog "open   DT_PARAM_SCOPE=$env:DT_PARAM_SCOPE DT_PARAM_CAPACITY=$env:DT_PARAM_CAPACITY POLL_MS=$env:POLL_MS"
Write-WardLog "open   HINT=$env:HINT RUNNER_URL=$env:RUNNER_URL"
while ((Get-FreeBeds) -gt 0) { Start-Sleep -Milliseconds ([int]$env:POLL_MS) }
$code = Send-Runner 'fsm/event' @{ event = 'full' }
Write-WardLog "open   no free bed left: raised event full, reply $code"
