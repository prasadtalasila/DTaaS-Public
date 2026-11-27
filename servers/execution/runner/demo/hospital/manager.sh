#!/usr/bin/env bash
# Manager commands for the runner of hospital-1, signed with the key of
# manager-1 (run/keys/manager-1.key). Run from this folder, in WSL or
# Git Bash; it needs node and curl, and the runner started with
# runner.auth.yaml.
#
#   ./manager.sh admit p-2 cardiology
#   ./manager.sh discharge p-2 cardiology
#   ./manager.sh state | dt | last | properties | peers | health
#   ./manager.sh history [LIMIT]
#   ./manager.sh transition open|closed
#   ./manager.sh param NAME VALUE        (capacity 3, scope multi, fidelity high)
#   ./manager.sh snapshot
#   ./manager.sh whatif [HORIZON]        (then: ./manager.sh whatif-result ID)
#   ./manager.sh call METHOD PATH [JSON] (any route)
#
# Each request gets a new Bearer token: a JWS signed with the key, bound
# to the runner, the method, the path and the body, valid for 30 s and
# once. RUNNER_URL, DT_ID and DT_AS (default manager-1) override the
# defaults.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

export DT_ID=${DT_ID:-hospital-1}
export DT_AS=${DT_AS:-manager-1}
export MSYS_NO_PATHCONV=1
RUNNER_URL=${RUNNER_URL:-http://localhost:5100}

# call METHOD PATH [JSON]: a signed request; the reply and its status
call() {
  local method=$1 path=$2 body=${3:-} auth
  auth=$(node tools/sign.mjs http "$method" "$path" "$body")
  local args=(-s -w '\n%{http_code}\n' -X "$method" "$RUNNER_URL$path")
  [[ -n $auth ]] && args+=(-H "Authorization: $auth")
  [[ -n $body ]] && args+=(-H 'content-type: application/json' -d "$body")
  [[ -n ${IDEMPOTENCY_KEY:-} ]] && args+=(-H "Idempotency-Key: $IDEMPOTENCY_KEY")
  curl "${args[@]}"
}

patient() {
  printf '{"name":"%s","input":{"patient":"%s","ward":"%s"}}' "$1" "$2" "$3"
}

cmd=${1:-}
shift || true
case $cmd in
  admit | discharge)
    call POST / "$(patient "$cmd" "${1:?patient}" "${2:?ward}")" ;;
  state) call GET /state ;;
  dt) call GET /dt ;;
  last) call GET / ;;
  properties) call GET /properties ;;
  peers) call GET /peers ;;
  health) curl -s "$RUNNER_URL/health"; echo ;;
  history) call GET "/history?limit=${1:-5}" ;;
  transition)
    call POST /fsm/transition "{\"state\":\"${1:?state}\"}" ;;
  param)
    value=${2:?value}
    [[ $value =~ ^[0-9]+$ ]] || value=\"$value\"
    call PUT /parameters "{\"${1:?name}\":$value}" ;;
  snapshot) call POST /snapshot '{}' ;;
  whatif)
    call POST /whatif \
      "{\"name\":\"forecast-beds\",\"input\":{\"horizon\":\"${1:-2h}\"}}" ;;
  whatif-result) call GET "/whatif/${1:?id}" ;;
  call) call "${1:?method}" "${2:?path}" "${3:-}" ;;
  *)
    sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
    exit 2 ;;
esac
