# Command forecast-beds, for POST /whatif only: the free beds of the
# hospital after the horizon of the scenario on stdin, {"horizon":
# "PT2H", "steps": [{"at": "PT10M", "peer": "hospital-2", "online":
# false}]}, computed on the private copy of the twin. forecast.mjs says
# what it computes. It refuses to run as a live command.
if ($env:DT_MODE -ne 'what-if') {
  [Console]::Error.WriteLine("forecast-beds runs only as a what-if, not in mode $env:DT_MODE")
  exit 2
}
[Console]::In.ReadToEnd() | node --no-warnings (Join-Path $PSScriptRoot 'forecast.mjs')
exit $LASTEXITCODE
