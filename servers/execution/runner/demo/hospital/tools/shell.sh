#!/usr/bin/env bash
# Shell functions of the hospital demo, sourced before each command

# dt PATH [CURL OPTIONS]: an HTTP request to the runner, with the reply
# as compact JSON and its HTTP status on the last line. With the keys
# of record.mjs, it is signed as alice (tools/sign.mjs); curl's -X and
# --json give the method and the body that the signature covers.
dt() {
  local path=$1 method=GET body='' option
  shift
  local options=("$@")
  while [ $# -gt 0 ]; do
    option=$1
    shift
    case $option in
      -X) method=$1 ;;
      --json) body=$1 && [ "$method" = GET ] && method=POST ;;
    esac
  done
  # Git Bash would turn the path into a Windows path for node
  local auth
  auth=$(MSYS_NO_PATHCONV=1 node tools/sign.mjs http "$method" "$path" "$body")
  if [ -n "$auth" ]; then
    options+=(-H "Authorization: $auth")
  fi
  curl -s -w '\n%{http_code}' "${options[@]}" "http://localhost:5100$path" |
    node tools/pp.mjs
  return $?
}

# mq ROUTE [JSON]: an MQTT request to the runner and its response
mq() {
  node tools/mq.mjs "$@"
  return $?
}
