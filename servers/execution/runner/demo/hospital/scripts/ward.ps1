# Helpers of the hospital scripts: the beds in run/ward.json, the ward
# log in run/ward.log, and requests to the runner. Not a command.
$WardFile = Join-Path $PSScriptRoot '..\run\ward.json'
$WardLog = Join-Path $PSScriptRoot '..\run\ward.log'
$Capacity = [int]$env:DT_PARAM_CAPACITY

function Read-Ward { Get-Content $WardFile -Raw | ConvertFrom-Json }

function Save-Ward($beds) {
  $beds | ConvertTo-Json -Compress | Set-Content $WardFile -Encoding ASCII
}

function Write-WardLog($text) {
  "$((Get-Date).ToUniversalTime().ToString('HH:mm:ss')) $text" | Add-Content $WardLog -Encoding ASCII
}

# The number of free beds in the whole hospital
function Get-FreeBeds {
  $free = 0
  foreach ($ward in (Read-Ward).PSObject.Properties) {
    $free += $Capacity - @($ward.Value).Count
  }
  $free
}

# A ward with a free bed: the wanted one, or under the multi scope any
function Find-Bed($wanted, $scope) {
  $beds = Read-Ward
  $wards = @($wanted)
  if ($scope -eq 'multi') {
    $wards += $beds.PSObject.Properties.Name | Where-Object { $_ -ne $wanted }
  }
  $wards | Where-Object { @($beds.$_).Count -lt $Capacity } | Select-Object -First 1
}

function Add-Patient($ward, $patient) {
  $beds = Read-Ward
  $beds.$ward = @($beds.$ward) + $patient
  Save-Ward $beds
}

# Frees the bed of the patient and returns the ward, or nothing
function Remove-Patient($patient) {
  $beds = Read-Ward
  $ward = $beds.PSObject.Properties | Where-Object { $_.Value -contains $patient }
  if ($null -eq $ward) { return }
  $beds.($ward.Name) = @($ward.Value | Where-Object { $_ -ne $patient })
  Save-Ward $beds
  $ward.Name
}

# POSTs the body to the runner and returns the HTTP status, 0 when the
# runner can not be reached; Windows PowerShell 5.1 throws on 4xx and 5xx
function Send-Runner($path, $body) {
  try {
    Invoke-RestMethod -Method Post -Uri "$env:RUNNER_URL/$path" `
      -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) | Out-Null
    202
  } catch { [int]$_.Exception.Response.StatusCode }
}
