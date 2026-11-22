# State open, admitting patients: logs the script context and where
# overflow goes, then samples the beds, writes their number as the
# property free-beds when it changes, and raises the event full over
# HTTP once every bed is taken. The fidelity sets how often it samples.
. "$PSScriptRoot\ward.ps1"
$factor = @{ low = 4; medium = 1; high = 0.2 }[$env:DT_PARAM_FIDELITY]
$interval = [int]([int]$env:POLL_MS * $factor)
Write-WardLog "open   DT_ID=$env:DT_ID DT_STATE=$env:DT_STATE DT_ENTRY=$env:DT_ENTRY"
Write-WardLog "open   DT_PARAM_SCOPE=$env:DT_PARAM_SCOPE DT_PARAM_CAPACITY=$env:DT_PARAM_CAPACITY POLL_MS=$env:POLL_MS"
Write-WardLog "open   HINT=$env:HINT RUNNER_URL=$env:RUNNER_URL"
Write-WardLog "open   fidelity $env:DT_PARAM_FIDELITY`: beds sampled every $interval ms"
Write-WardLog "open   overflow to $(Get-Overflow)"
$free = Get-FreeBeds
$written = -1
while ($free -gt 0) {
  if ($free -ne $written) { Send-FreeBeds $free; $written = $free }
  Start-Sleep -Milliseconds $interval
  $free = Get-FreeBeds
}
Send-FreeBeds 0
$code = Send-Runner 'fsm/event' @{ event = 'full' }
Write-WardLog "open   no free bed left: raised event full, reply $code"
