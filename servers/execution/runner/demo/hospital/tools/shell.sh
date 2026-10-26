#!/usr/bin/env bash
# Shell functions of the hospital demo, sourced before each command

# dt PATH [CURL OPTIONS]: an HTTP request to the runner, with the reply
# as compact JSON and its HTTP status on the last line
dt() {
  local path=$1
  shift
  curl -s -w '\n%{http_code}' "$@" "http://localhost:5100$path" |
    node tools/pp.mjs
}

# mq ROUTE [JSON]: an MQTT request to the runner and its response
mq() {
  node tools/mq.mjs "$@"
}
