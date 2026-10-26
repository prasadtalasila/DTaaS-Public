# State full: looks for a patient who could go home early, the last local
# adaptation. There is none, so the script fails, and as the state has no
# $failure transition, the runner escalates to the Manager.
. "$PSScriptRoot\ward.ps1"
Write-WardLog "full   entry $($env:DT_ENTRY): no free bed and no early discharge possible"
[Console]::Error.WriteLine('no local adaptation left')
exit 2
