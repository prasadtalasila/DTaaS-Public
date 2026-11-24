#!/usr/bin/env bash
# Helpers of the hospital scripts on Linux: the beds in
# run/<DT_ID>/ward.json, the ward log in run/<DT_ID>/ward.log, and
# requests to the runner. Not a command. Needs jq and curl.
# A replay twin runs a copy of the scripts in its out, so its beds are
# there, and those of the twin are untouched
WARD_DIR="$(dirname "${BASH_SOURCE[0]}")/../run/$DT_ID"
WARD_FILE="$WARD_DIR/ward.json"
WARD_LOG="$WARD_DIR/ward.log"
CAPACITY=$DT_PARAM_CAPACITY
# RUNNER_TOKEN is unset without access control, and the header ignored
AUTH=(-H "Authorization: Bearer ${RUNNER_TOKEN:-}")
JSON=(-H 'Content-Type: application/json')

write_ward_log() {
  printf '%s %s\n' "$(date -u +%H:%M:%S)" "$1" >> "$WARD_LOG"
}

# Replaces the beds with the output of the jq filter, in one step
save_ward() {
  jq -c "$@" "$WARD_FILE" > "$WARD_FILE.tmp" && mv "$WARD_FILE.tmp" "$WARD_FILE"
}

# The number of free beds in the whole hospital
free_beds() {
  jq --argjson capacity "$CAPACITY" '[.[] | $capacity - length] | add' "$WARD_FILE"
}

# A ward with a free bed: the wanted one, or under the multi scope any
find_bed() {
  jq -r --arg wanted "$1" --arg scope "$2" --argjson capacity "$CAPACITY" '
    . as $beds
    | [$wanted] + (if $scope == "multi" then keys_unsorted - [$wanted] else [] end)
    | map(select(($beds[.] // []) | length < $capacity))
    | first // empty' "$WARD_FILE"
}

add_patient() {
  # shellcheck disable=SC2016
  save_ward --arg ward "$1" --arg patient "$2" '.[$ward] += [$patient]'
}

# Frees the bed of the patient and prints the ward, or nothing
remove_patient() {
  local ward
  ward=$(jq -r --arg patient "$1" \
    'first(to_entries[] | select(.value | index($patient)) | .key) // empty' "$WARD_FILE")
  if [[ -n $ward ]]; then
    # shellcheck disable=SC2016
    save_ward --arg ward "$ward" --arg patient "$1" '.[$ward] -= [$patient]'
    echo "$ward"
  fi
}

# POSTs the JSON body to the runner and prints the HTTP status, 0 when
# the runner can not be reached
send_runner() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" "${JSON[@]}" \
    -d "$2" "$RUNNER_URL/$1")
  echo "$((10#$code))"
}

# Hands the runner the number of free beds, as the property free-beds;
# the next sample writes again after a write that failed
send_free_beds() {
  curl -sf -o /dev/null -X PUT "${AUTH[@]}" "${JSON[@]}" \
    -d "{\"free-beds\": $1}" "$RUNNER_URL/properties" ||
    write_ward_log "open   free-beds not written: curl exit $?"
}

# Where overflow goes: the nearest peer of GET /peers that is online and
# open, as "<id> at <distance> km", or none
get_overflow() {
  local peers
  if ! peers=$(curl -sf "${AUTH[@]}" "$RUNNER_URL/peers"); then
    echo 'none (no reply from the runner)'
    return
  fi
  jq -r 'to_entries
    | map(select(.value.online and .value.state.machine.state == "open"))
    | sort_by(.value.attributes.distance) | first
    | if . == null then "none"
      else "\(.key) at \(.value.attributes.distance) km" end' <<< "$peers"
}
