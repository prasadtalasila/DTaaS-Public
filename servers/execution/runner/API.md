# Runner API

The runner serves one digital twin (DT) and answers the same requests
over HTTP and over MQTT. This document lists every route of both, with
the request, the reply and the status of each outcome, and the
notifications that the runner sends on its own. It is the reference for
a DT Manager, a script or any other client of the runner.

The examples come from the
[hospital bed-management demo](demo/hospital/README.md). Most are
requests typed in that recording, with the replies that the runner
gave, so the values fit together from one example to the next; the
text says where an example comes from elsewhere. The
[Example Session](#example-session) at the end retells the recording as
one story.

## The Demo Setup

The demo runner manages `hospital-1`, a hospital in Aarhus with two
wards, cardiology and maternity, of two beds each. Its configuration,
[demo/hospital/runner.yaml](demo/hospital/runner.yaml), gives the
addresses that the examples use:

| Setting            | Value                                          |
| :----------------- | :--------------------------------------------- |
| HTTP base URL      | `http://localhost:5100`                        |
| MQTT broker        | `mqtt://127.0.0.1:18830`, MQTT 3.1.1           |
| MQTT base topic    | `dtaas/hospital-1`                             |
| Webhook            | `http://127.0.0.1:18080/dt-events`             |
| Permitted commands | `open`, `full`, `closed`, `admit`, `discharge` |
| Manager commands   | `admit`, `discharge`                           |

The state machine,
[demo/hospital/hospital.fsm.yaml](demo/hospital/hospital.fsm.yaml), has
three states, `open`, `full` and `closed`, each running the script of
the same name. It declares the events `full`, `beds-free`,
`scope-changed`, `close` and `reopen`, and two parameters: `scope`, of
values `single` and `multi`, which the Manager controls, and
`capacity`, which the Manager may read only. The scripts run on
Windows in PowerShell, so their output ends lines with `\r\n`.

In the recording, `dt PATH [CURL OPTIONS]` is `curl -s` against
`http://localhost:5100`, which prints the reply and then its HTTP
status. The examples below show the plain `curl` command instead.
`--json` (curl 7.82 or later) sends a POST with the given body as
`application/json`; with an older curl, write
`-H 'Content-Type: application/json' -d '<body>'`, and add `-X PUT` for
a PUT. `mq ROUTE [JSON]` publishes an MQTT request and prints the
response, as described in [MQTT](#mqtt).

## Routes

Every HTTP route has an MQTT route of the same meaning. An MQTT request
is published on `<topic>/<route>`, where `<topic>` is the `mqtt.topic`
of the configuration.

| HTTP                   | MQTT route       | Request body                        | Success |
| :--------------------- | :--------------- | :---------------------------------- | :------ |
| `GET /dt`              | `dt`             |                                     | 200     |
| `GET /state`           | `state`          |                                     | 200     |
| `GET /health`          | `health`         |                                     | 200     |
| `POST /`               | `execute`        | `{"name": "admit", "input": {...}}` | 200     |
| `GET /`                | `status`         |                                     | 200     |
| `GET /history`         | `history`        |                                     | 200     |
| `POST /stop`           | `stop`           | `{"name": "open"}` or none          | 200     |
| `POST /fsm/transition` | `transition`     | `{"state": "open"}`                 | 202     |
| `POST /fsm/event`      | `event`          | `{"event": "close"}`                | 202     |
| `GET /fsm`             | `fsm`            |                                     | 200     |
| `GET /parameters`      | `parameters`     |                                     | 200     |
| `PUT /parameters`      | `set-parameters` | `{"scope": "multi"}`                | 200     |
| `POST /escalate`       | `escalate`       | `{"reason": "...", "proposal": {}}` | 202     |

The runner also sends [notifications](#notifications): its state
document whenever it changes, escalations to the Manager, and its
presence when it joins and leaves. They go to MQTT and to a webhook,
when the configuration has them.

## Conventions

These rules hold for every route.

- **Bodies.** Requests and replies are JSON. A request with a body
  sends `Content-Type: application/json`. A body over 100 kB is refused
  with HTTP status 413 by the JSON parser of the HTTP server, before
  any other check.
- **Validation error.** A body that does not fit the route, such as a
  `POST /` without a `name`, gets HTTP status 400 and this reply:

  ```json
  {
    "message": "Validation Failed",
    "error": "Bad Request",
    "statusCode": 400
  }
  ```

- **Outcome in the body.** A reply that reports an outcome names it in
  a `status` field, such as `{"status": "command running"}`, as well as
  in the HTTP status, since MQTT has no status codes. An error reply
  carries `statusCode` instead.
- **Request keys.** `POST /`, `POST /fsm/transition`,
  `POST /fsm/event` and `POST /escalate` take an optional
  `Idempotency-Key` header, of up to 255 characters, so that a repeated
  request does not act twice. See
  [Repeated Requests](#repeated-requests). A longer key gets the
  validation error.
- **Times.** Times are ISO 8601 in UTC, such as
  `2026-10-26T09:05:15.176Z`. The times of commands are stored to the
  second, so their milliseconds are `000`.
- **Unexpected errors.** An unexpected failure gets HTTP status 500
  with `{"statusCode": 500, "message": "Internal server error"}`, over
  MQTT too.

## Digital Twin

Three routes tell who the DT is, what state it is in, and whether the
runner is alive.

### GET /dt

Describes the DT from the configuration. MQTT route: `dt`.

```bash
curl -s http://localhost:5100/dt
```

`200`:

```json
{
  "id": "hospital-1",
  "attributes": {
    "name": "Hospital 1",
    "city": "Aarhus",
    "latitude": 56.19,
    "longitude": 10.17,
    "wards": 2
  },
  "commands": ["open", "full", "closed", "admit", "discharge"],
  "stateMachine": true,
  "manager": { "commands": ["admit", "discharge"] }
}
```

| Field          | Meaning                                                                                                      |
| :------------- | :----------------------------------------------------------------------------------------------------------- |
| `id`           | the identity of the DT, `id` in the configuration                                                            |
| `attributes`   | the `attributes` of the configuration; `{}` without any                                                      |
| `commands`     | the permitted commands, which `POST /` may run                                                               |
| `stateMachine` | whether a state machine file is loaded                                                                       |
| `manager`      | the `manager.commands` of the state machine file; the commands meant for the Manager, a subset of `commands` |

### GET /state

Returns the whole state of the DT in one document, with status 200
whether or not a state machine is loaded. MQTT route: `state`. This is
the document of the [state notifications](#state-notifications).

Straight after the start of the demo, before the first transition:

```bash
curl -s http://localhost:5100/state
```

`200`:

```json
{
  "id": "hospital-1",
  "time": "2026-10-26T09:05:15.176Z",
  "machine": {
    "state": null,
    "status": "none",
    "entry": 0,
    "events": ["beds-free", "close", "full", "reopen", "scope-changed"]
  },
  "parameters": { "scope": "single", "capacity": 2 },
  "command": null
}
```

| Field        | Meaning                                                                  |
| :----------- | :----------------------------------------------------------------------- |
| `id`         | the identity of the DT                                                   |
| `time`       | the time the document was built                                          |
| `machine`    | the reply of [GET /fsm](#get-fsm), or `null` without a state machine     |
| `parameters` | the value of each [parameter](#parameters); `{}` without a state machine |
| `command`    | the latest command, or `null` before the first one                       |

`command` has the `name` of the command, its `status`, `receivedAt` and
`finishedAt`. Its status is `running` until the script finishes, then
`valid`, `failed`, `invalid`, `stopped` or `interrupted`, as in
[GET /](#get-). `finishedAt` is `null` while it runs. While `admit`
runs in state `open`, for example, the document has:

```json
{
  "machine": {
    "state": "open",
    "status": "running",
    "entry": 1,
    "events": ["beds-free", "close", "full", "reopen", "scope-changed"]
  },
  "command": {
    "name": "admit",
    "status": "running",
    "receivedAt": "2026-10-26T14:55:51.000Z",
    "finishedAt": null
  }
}
```

The latest command may be one of `POST /` while the script of the state
machine runs, as here; `machine.status` tells the status of the script
of the state. The logs of a command are on [GET /](#get-) only.

### GET /health

Tells whether the runner answers and whether its connections are up.
It is a liveness check only: it does not tell whether the DT does its
job. MQTT route: `health`.

```bash
curl -s http://localhost:5100/health
```

`200`:

```json
{ "status": "ok", "uptime": 4, "mqtt": "connected", "database": "file" }
```

| Field      | Values                                                                                      |
| :--------- | :------------------------------------------------------------------------------------------ |
| `status`   | `degraded` while `mqtt` is `disconnected`, else `ok`                                        |
| `uptime`   | whole seconds since the runner started                                                      |
| `mqtt`     | `connected`; `disconnected`, also while it reconnects; `disabled` without an `mqtt` section |
| `database` | `file` with a `database` file in the configuration, else `memory`                           |

The reply is `200` in both cases. The runner connects to the broker
after it starts, so the first replies may say `degraded`. Over MQTT the
runner answers only while it is connected, so the reply always says
`connected`; that a reply arrives at all tells that the runner is
alive.

## Commands

A command is a script in the `location` directory whose name is listed
under `commands` in the configuration. The runner runs at most one
instance of each command at a time.

### POST /

Runs a command and answers once it has finished. MQTT route: `execute`.

| Field   | Required | Meaning                                                              |
| :------ | :------- | :------------------------------------------------------------------- |
| `name`  | yes      | the command to run                                                   |
| `input` | no       | a JSON object, which the script reads from stdin as one line of JSON |

`input` may be `{}`, but not a list, a string or `null`, nor have a
`__proto__` key, and its JSON may be at most 64 KiB (65 536 bytes). Any
other `input` gets the [validation error](#conventions).

The Manager admits patient `p-1` to cardiology, with a request key:

```bash
curl -s http://localhost:5100/ -H 'Idempotency-Key: admit-p-1' \
  --json '{"name":"admit","input":{"patient":"p-1","ward":"cardiology"}}'
```

`200`:

```json
{
  "status": "success",
  "result": {
    "exitCode": 0,
    "stdout": "hospital-1 in state open#1, scope single\r\np-1 admitted to cardiology",
    "stderr": ""
  }
}
```

`admit.ps1` read `{"patient":"p-1","ward":"cardiology"}` from stdin.
Its first line of output comes from the
[script environment](#script-environment).

The reply tells how the command ended:

| `status`          | HTTP | Meaning                                                                   |
| :---------------- | :--- | :------------------------------------------------------------------------ |
| `success`         | 200  | the script exited with 0                                                  |
| `failed`          | 200  | a permitted script exited with another code, was killed, or did not start |
| `stopped`         | 200  | a [stop request](#post-stop) stopped the script                           |
| `invalid command` | 400  | the command is not permitted, or the request key is of another command    |
| `command running` | 409  | the request has `input` and the command is already running                |

`result` comes with `success`, `failed` and `stopped`, and holds the
logs of the script whatever its outcome. `exitCode` is `null` for a
stopped script. On Linux it is also `null` for a script that could not
start or was killed by a signal. On Windows, a missing script is
reported with the exit code of `powershell.exe`, and a script killed
from outside with 1. A refused request has no `result`.

Both wards hold two beds and `scope` is `single`, so after `p-2`, a
third cardiology patient fails with exit code 3:

```bash
curl -s http://localhost:5100/ \
  --json '{"name":"admit","input":{"patient":"p-3","ward":"cardiology"}}'
```

`200`:

```json
{
  "status": "failed",
  "result": {
    "exitCode": 3,
    "stdout": "hospital-1 in state open#1, scope single",
    "stderr": "no free bed for p-3; escalated: 202"
  }
}
```

Before it failed, the script [escalated](#post-escalate) to the
Manager.

Input to a command that is running is refused, since the run in
progress did not get that input. `open` is the script of the current
state, so it is running:

```bash
curl -s http://localhost:5100/ --json '{"name":"open","input":{}}'
```

`409`:

```json
{ "status": "command running" }
```

A request without `input` for a running command does not start it a
second time either; it waits for that run and gets its result.

### GET /

Shows the latest command received, with its logs and exit code. MQTT
route: `status`. After the failed admission of `p-3`:

```bash
curl -s http://localhost:5100/
```

`200`:

```json
{
  "name": "admit",
  "status": "failed",
  "logs": {
    "stdout": "hospital-1 in state open#1, scope single",
    "stderr": "no free bed for p-3; escalated: 202"
  },
  "exitCode": 3
}
```

| `status`      | Meaning                                                                   |
| :------------ | :------------------------------------------------------------------------ |
| `valid`       | the script succeeded                                                      |
| `failed`      | the script failed                                                         |
| `stopped`     | a stop request stopped the script                                         |
| `interrupted` | the script was running when the runner stopped                            |
| `invalid`     | the command is not permitted; the logs are empty and `exitCode` is `null` |

Before the first command, `name` is `none` and `status` is `invalid`.
While the latest command runs, its `status` is `invalid` too, with
empty logs and `exitCode` `null`, until it finishes;
[GET /state](#get-state) shows it as `running`. These names differ from
those of `POST /`: `valid` here is `success` there.

### GET /history

Lists the command requests received so far, oldest first: those of
`POST /`, of MQTT `execute`, and the scripts that the state machine
ran. Commands that are not permitted appear too. A repeated request
and a request refused with `command running` do not. MQTT route:
`history`.

```bash
curl -s http://localhost:5100/history
```

`200`, near the end of the demo:

```json
[
  { "name": "open" },
  { "name": "admit" },
  { "name": "admit" },
  { "name": "admit" },
  { "name": "open" },
  { "name": "admit" },
  { "name": "admit" },
  { "name": "full" },
  { "name": "discharge" },
  { "name": "open" }
]
```

The entries are the three entries into `open`, the five admissions
(`p-1`, `p-2`, `p-3` refused, `p-3` again and `p-4`), the script of
`full`, and the `discharge` sent over MQTT. The repeat of `p-1` and the
refused input to `open` are missing. The input is not part of the
history.

### POST /stop

Stops the running command of the given name, or every running command
without a `name` or without a body. MQTT route: `stop`, with an empty
payload or `{}` to stop every command.

The runner sends the script `SIGTERM`, and `SIGKILL` if it still runs
after `stopGrace` milliseconds of the configuration. On Windows, as in
the demo, it ends `powershell.exe` at once. It answers once the scripts
have exited, which can take the grace period and more:

```bash
curl -s http://localhost:5100/stop --json '{"name":"open"}'
```

`200`:

```json
{ "stopped": ["open"] }
```

`stopped` lists the commands that were stopped; it is empty when
nothing of that name was running. A request waiting on a stopped run
gets `stopped`. When the stopped script is that of the current state,
the state machine follows its `$stopped` transition. In the demo that
leads from `open` to `closed`. The reply does not wait for that, so
`GET /fsm` straight after it may still show the old state for a
moment. A stop takes no request key: a repeat finds nothing running.

## State Machine

These routes need a `stateMachine` in the configuration; without one,
they answer `404` with `{"status": "no state machine", "state": null}`.

The machine is idle before its first transition and whenever the
script of its current state has finished. On entering a state, the
runner starts the script of that state and answers as soon as the
script has started.

### POST /fsm/transition

Moves an idle machine to a state. MQTT route: `transition`.

```bash
curl -s http://localhost:5100/fsm/transition --json '{"state":"open"}'
```

`202`:

```json
{ "status": "accepted", "state": "open" }
```

`state` is the state of the machine after the request, `null` before
the first transition. The machine refuses a transition while the
script of its state runs, with `busy`.

### POST /fsm/event

Sends an event to the machine, which follows the transition of its
current state for that event, even while the script of that state
runs. MQTT route: `event`. Scripts raise events this way too, as in
[Calls From Scripts](#calls-from-scripts).

The state `full` has no transition for `close`:

```bash
curl -s http://localhost:5100/fsm/event --json '{"event":"close"}'
```

`409`:

```json
{ "status": "no transition", "state": "full" }
```

With `escalation.onNoTransition` set, as in the demo, the runner also
[escalates](#escalation-notifications), once per entry into the state.
The same request again gets the same reply and escalates nothing.

### Replies of Transitions and Events

| `status`              | HTTP | Meaning                                                 |
| :-------------------- | :--- | :------------------------------------------------------ |
| `accepted`            | 202  | the machine entered the state and started its script    |
| `invalid state`       | 400  | the state is not in the state machine file              |
| `invalid event`       | 400  | the event is not under `events`                         |
| `invalid request key` | 400  | the request key belongs to another request              |
| `busy`                | 409  | a transition request while the script of the state runs |
| `no transition`       | 409  | the current state has no transition for the event       |
| `script running`      | 409  | the script of the next state is still running           |
| `no state machine`    | 404  | the configuration has no `stateMachine`                 |
| `stopping`            | 503  | the runner is shutting down                             |

A body without a `state` or an `event` gets the
[validation error](#conventions) before any other check.

### GET /fsm

Returns the state of the machine. MQTT route: `fsm`. After the stop of
`open`:

```bash
curl -s http://localhost:5100/fsm
```

`200`:

```json
{
  "state": "closed",
  "status": "valid",
  "entry": 5,
  "events": ["beds-free", "close", "full", "reopen", "scope-changed"]
}
```

| Field    | Meaning                                                        |
| :------- | :------------------------------------------------------------- |
| `state`  | the current state, `null` before the first transition          |
| `status` | the status of the script of the state, below                   |
| `entry`  | the number of entries into states so far; `0` before the first |
| `events` | the events of the state machine file, in alphabetical order    |

`entry` tells two entries into the same state apart, such as the
restart of `open` when `scope` changes.

| `status`      | Meaning                                                         |
| :------------ | :-------------------------------------------------------------- |
| `none`        | no state yet                                                    |
| `running`     | the script of the state runs                                    |
| `valid`       | the script succeeded                                            |
| `invalid`     | the script failed                                               |
| `stopped`     | a stop request stopped the script                               |
| `interrupted` | the script was running when the runner stopped; after a restart |

## Parameters

Parameters are named values of the DT, declared in the state machine
file. The scripts see them as `DT_PARAM_<NAME>` environment variables.
Without a state machine, both routes answer `404` with
`{"status": "no state machine", "state": null}`.

### GET /parameters

Returns the value and the declaration of each parameter, without its
`event`. MQTT route: `parameters`.

```bash
curl -s http://localhost:5100/parameters
```

`200`:

```json
{
  "scope": {
    "value": "single",
    "type": "enum",
    "values": ["single", "multi"],
    "default": "single",
    "controllable": true
  },
  "capacity": {
    "value": 2,
    "type": "number",
    "default": 2,
    "controllable": false
  }
}
```

### PUT /parameters

Sets the values of controllable parameters. The body maps parameter
names to new values, which are strings, numbers or booleans. MQTT
route: `set-parameters`.

The runner applies the whole body or none of it:

1. It checks every entry. An unknown name, a parameter that is not
   controllable or a value of the wrong type is refused with `400`,
   and `message` lists every problem.
1. It stores the new values, so that a script that starts afterwards
   sees them. If the database fails, it stores none.
1. It raises the `event` of each changed parameter, in the order of
   the declarations. An event that two changed parameters declare is
   raised once.

`capacity` is not controllable:

```bash
curl -s -X PUT http://localhost:5100/parameters --json '{"capacity":3}'
```

`400`:

```json
{
  "message": ["parameter capacity is not controllable"],
  "error": "Bad Request",
  "statusCode": 400
}
```

The Manager sets `scope` to `multi`, which raises `scope-changed`. In
`open` that is a `stop: true` self-transition, so the runner stops the
script of `open` and starts it again, at entry 2:

```bash
curl -s -X PUT http://localhost:5100/parameters --json '{"scope":"multi"}'
```

`200`, with the body of `GET /parameters`, now with `"value": "multi"`
for `scope`. The reply is the same whatever the events did; an event
that the machine refuses is logged. `GET /state` tells where the
machine went. A value equal to the current one changes nothing and
raises no event, so a repeat of the request and `{}` change nothing.
The route takes no request key for that reason.

## Escalation

An escalation tells the Manager that the DT can not cope on its own.
The runner sends it as an
[escalation notification](#escalation-notifications). It escalates on
its own when the script of a state fails (`escalation.onFailure`) and
when an event has no transition (`escalation.onNoTransition`); a
script or a client escalates with `POST /escalate`.

### POST /escalate

Sends an escalation to the Manager. MQTT route: `escalate`.

| Field      | Required | Meaning                                                                            |
| :--------- | :------- | :--------------------------------------------------------------------------------- |
| `reason`   | yes      | a non-empty string of up to 1 KiB                                                  |
| `proposal` | no       | a JSON object of up to 4 KiB, by convention the parameter values the DT would like |

Each size is that of the value as JSON text, in bytes of UTF-8, quotes
included. The runner passes `proposal` on as it was received and does
not read it. In the demo, `admit.ps1` escalates when it finds no bed,
with this body:

```bash
curl -s http://localhost:5100/escalate \
  --json '{"reason":"no cardiology bed for p-3","proposal":{"scope":"multi"}}'
```

`202`:

```json
{ "status": "accepted" }
```

The reply is the same with or without a state machine, so that a DT
without one can escalate too. Once the runner has begun to stop, it
still answers `202` but sends nothing. Any other body gets the
[validation error](#conventions).

## Repeated Requests

A client that is not sure its request arrived, such as one that lost
its connection while waiting, can send it again safely with a request
key.

- `POST /` and `execute` with a key that the runner has seen give the
  reply to the first request, and the command does not run again,
  whatever the `input` of the repeat. A key of another command is
  refused with `invalid command`. The runner keeps these keys in its
  database without a time limit.
- `POST /fsm/transition`, `POST /fsm/event`, `transition` and `event`
  give a repeat of an accepted request the reply to the first one. A
  refused request changed nothing, so its repeat is checked again. A
  key of another request gets `invalid request key`. The runner keeps
  the latest 256 keys in memory.
- `POST /escalate` and `escalate` give a repeat the first reply and
  escalate nothing, even with another body. These keys are kept apart
  from the others, the latest 256 in memory.

The demo sends the admission of `p-1` twice with the key `admit-p-1`.
Both replies are the `success` shown under [POST /](#post-), and the
runner log shows that `admit` ran once:

```text
Discarded a repeated request for "admit"
```

A repeated request is not added to the history. A command that was
running when the runner stopped is `interrupted` after the restart,
and a repeat of its request gets `failed` with `exitCode` `null`.

Without a key, a request for a command that is running joins that run
and gets its result. With `input`, it is refused with `command running`
instead, is not added to the history, and its key is not kept.

## MQTT

With an `mqtt` section in the configuration, the runner connects to the
broker, subscribes with QoS 1 to one request topic per route, and
publishes the [notifications](#notifications).

### Request Topics

A request is published on `<topic>/<route>`, with the JSON of the
matching HTTP request body as payload. The routes that read take no
payload; the runner ignores any.

| Request topic            | HTTP                   | Payload                               |
| :----------------------- | :--------------------- | :------------------------------------ |
| `<topic>/execute`        | `POST /`               | `{"name": "<command>", "input": {}}`  |
| `<topic>/status`         | `GET /`                | none                                  |
| `<topic>/history`        | `GET /history`         | none                                  |
| `<topic>/stop`           | `POST /stop`           | `{"name": "<command>"}`, `{}` or none |
| `<topic>/transition`     | `POST /fsm/transition` | `{"state": "<state>"}`                |
| `<topic>/event`          | `POST /fsm/event`      | `{"event": "<event>"}`                |
| `<topic>/fsm`            | `GET /fsm`             | none                                  |
| `<topic>/dt`             | `GET /dt`              | none                                  |
| `<topic>/state`          | `GET /state`           | none                                  |
| `<topic>/health`         | `GET /health`          | none                                  |
| `<topic>/parameters`     | `GET /parameters`      | none                                  |
| `<topic>/set-parameters` | `PUT /parameters`      | `{"<name>": <value>}`                 |
| `<topic>/escalate`       | `POST /escalate`       | `{"reason": "<reason>"}`              |

### Responses

The response payload is the JSON body of the matching HTTP reply. MQTT
has no status codes, so the payload alone tells the outcome, through
its `status` field or the `statusCode` of an error. The runner
publishes each response with QoS 1:

- to the response topic of an MQTT 5 request, with its correlation
  data, when the request has a response topic;
- otherwise to the request topic followed by `/response`, such as
  `<topic>/execute/response`.

The runner uses the default response topic instead when the requested
one is empty, holds a wildcard, starts with `$`, or is one of its
request topics. Every client subscribed to a default response topic
receives every response on it; a client that must tell its own
responses apart connects with MQTT 5 and gives a response topic of its
own.

A payload that is not a JSON object fitting the route gets the
[validation error](#conventions). An `execute` payload has no 100 kB
limit, but its `input` has the 64 KiB limit of `POST /`.

### Example: Descriptor and Discharge

In the demo, `mq dt` subscribes to `dtaas/hospital-1/dt/response`,
publishes an empty payload on `dtaas/hospital-1/dt`, and prints the
response topic and payload:

```text
dtaas/hospital-1/dt/response
{
  "id": "hospital-1",
  "attributes": { "name": "Hospital 1", "city": "Aarhus", "latitude": 56.19, "longitude": 10.17, "wards": 2 },
  "commands": ["open", "full", "closed", "admit", "discharge"],
  "stateMachine": true,
  "manager": { "commands": ["admit", "discharge"] }
}
```

The Manager discharges `p-1` over MQTT, with input:

```bash
mq execute '{"name":"discharge","input":{"patient":"p-1"}}'
```

```text
dtaas/hospital-1/execute/response
{
  "status": "success",
  "result": {
    "exitCode": 0,
    "stdout": "p-1 left cardiology\r\nraised event beds-free, reply 202",
    "stderr": ""
  }
}
```

`discharge.ps1` raised `beds-free`, which moved the machine from `full`
back to `open`, as `mq fsm` shows:

```text
dtaas/hospital-1/fsm/response
{
  "state": "open",
  "status": "running",
  "entry": 4,
  "events": ["beds-free", "close", "full", "reopen", "scope-changed"]
}
```

The same requests with the
[Mosquitto clients](https://mosquitto.org/download/):

```bash
mosquitto_sub -h 127.0.0.1 -p 18830 -t 'dtaas/hospital-1/+/response' &
mosquitto_pub -h 127.0.0.1 -p 18830 -t 'dtaas/hospital-1/dt' -n
mosquitto_pub -h 127.0.0.1 -p 18830 -t 'dtaas/hospital-1/execute' \
  -m '{"name":"discharge","input":{"patient":"p-1"}}'
```

### Request Keys and Delivery

The broker may deliver a request twice, as the runner subscribes with
QoS 1. An MQTT 5 request with an `idempotency-key` user property acts
once, as in [Repeated Requests](#repeated-requests); MQTT 3.1.1, which
the demo broker speaks, has no user properties. With an MQTT 5 broker:

```bash
mosquitto_pub -h localhost -V mqttv5 -t 'dtaas/hospital-1/execute' \
  -D publish user-property idempotency-key admit-p-1 \
  -m '{"name":"admit","input":{"patient":"p-1","ward":"cardiology"}}'
```

Requests published while the runner is disconnected are lost. The
runner ignores retained requests, so that a command does not run again
each time the runner connects.

### Access Control

Anyone who can publish on the request topics can run the permitted
commands. Use the access control of the broker to limit who publishes
on them, and which topics the runner may publish on. Use `mqtts://` or
`wss://` with a username and password when the broker is not on the
same computer.

## Notifications

The runner tells what happens without being asked. Each notification
is one JSON object:

| Field  | Meaning                                                    |
| :----- | :--------------------------------------------------------- |
| `kind` | `state`, `escalation` or `presence`                        |
| `id`   | the identity of the DT                                     |
| `time` | the time of the notification; `null` only in the MQTT will |
| `data` | the content, which depends on `kind`                       |

The payloads below were captured from a re-run of the demo, with a
subscriber that logged every message unchanged, as the recording shows
each notification as a one-line summary only. Their times are those of
the re-run.

### State Notifications

The runner sends its [state document](#get-state) whenever the
document changes: when the machine enters a state, when the script of
a state finishes, when a command starts or finishes, when a parameter
changes, and once at startup. A document that differs from the last
one sent only in its `time` is not sent again. `data` is the document,
and `id` and `time` are its own.

The first notification of the demo, at startup:

```json
{
  "kind": "state",
  "id": "hospital-1",
  "time": "2026-10-26T14:55:41.712Z",
  "data": {
    "id": "hospital-1",
    "time": "2026-10-26T14:55:41.712Z",
    "machine": {
      "state": null,
      "status": "none",
      "entry": 0,
      "events": ["beds-free", "close", "full", "reopen", "scope-changed"]
    },
    "parameters": { "scope": "single", "capacity": 2 },
    "command": null
  }
}
```

The stop of `open` gives this sequence of documents, shown here by
`machine` and `command` only:

| `machine`              | `command`           |
| :--------------------- | :------------------ |
| `open` #4, `running`   | `open`, `stopped`   |
| `open` #4, `stopped`   | `open`, `stopped`   |
| `closed` #5, `running` | `closed`, `running` |
| `closed` #5, `running` | `closed`, `valid`   |
| `closed` #5, `valid`   | `closed`, `valid`   |

### Escalation Notifications

| `data` field | Meaning                                                                                         |
| :----------- | :---------------------------------------------------------------------------------------------- |
| `trigger`    | `request` (`POST /escalate`), `failure` (`onFailure`) or `no-transition` (`onNoTransition`)     |
| `state`      | the state when the escalation happened; `null` without a machine or before its first transition |
| `entry`      | the entry of that state; `0` without a machine or before its first transition                   |
| `event`      | the event that had no transition, for `no-transition`; else `null`                              |
| `reason`     | the reason of the request, or the runner's own text                                             |
| `proposal`   | the proposal of the request, else `null`                                                        |

The demo escalates three times. `admit.ps1` asks for scope `multi`:

```json
{
  "kind": "escalation",
  "id": "hospital-1",
  "time": "2026-10-26T14:55:59.980Z",
  "data": {
    "trigger": "request",
    "state": "open",
    "entry": 1,
    "event": null,
    "reason": "no cardiology bed for p-3",
    "proposal": { "scope": "multi" }
  }
}
```

The script of `full` fails, and `full` has no `$failure` transition:

```json
{
  "kind": "escalation",
  "id": "hospital-1",
  "time": "2026-10-26T14:56:13.007Z",
  "data": {
    "trigger": "failure",
    "state": "full",
    "entry": 3,
    "event": null,
    "reason": "script of state full failed",
    "proposal": null
  }
}
```

The event `close` has no transition in `full`:

```json
{
  "kind": "escalation",
  "id": "hospital-1",
  "time": "2026-10-26T14:56:14.962Z",
  "data": {
    "trigger": "no-transition",
    "state": "full",
    "entry": 3,
    "event": "close",
    "reason": "no transition for close in state full",
    "proposal": null
  }
}
```

### Presence

The runner announces that it joins and leaves. The online notice
carries the [descriptor](#get-dt):

```json
{
  "kind": "presence",
  "id": "hospital-1",
  "time": "2026-10-26T14:55:41.780Z",
  "data": {
    "online": true,
    "descriptor": {
      "id": "hospital-1",
      "attributes": {
        "name": "Hospital 1",
        "city": "Aarhus",
        "latitude": 56.19,
        "longitude": 10.17,
        "wards": 2
      },
      "commands": ["open", "full", "closed", "admit", "discharge"],
      "stateMachine": true,
      "manager": { "commands": ["admit", "discharge"] }
    }
  }
}
```

The offline notice, at a graceful shutdown:

```json
{
  "kind": "presence",
  "id": "hospital-1",
  "time": "2026-10-26T14:56:29.685Z",
  "data": { "online": false }
}
```

Over MQTT, the runner also connects with a will on the presence topic:
the offline notice with `"time": null`, as the will is fixed when the
runner connects. The broker publishes the will only when the runner
disappears without leaving: a crash, a kill or a lost connection.

At shutdown, the runner publishes the offline notice and disconnects
gracefully, so that the broker drops the will. Each step waits at most
2 s. When the broker does not confirm, the runner closes the connection
and logs a warning; the broker may then publish the will, which still
says offline.

### Over MQTT

The runner publishes each notification with QoS 1 on
`<topic>/notify/<kind>`:

| Topic                       | Retained | Why                                                        |
| :-------------------------- | :------- | :--------------------------------------------------------- |
| `<topic>/notify/state`      | yes      | a Manager that subscribes later gets the current state     |
| `<topic>/notify/presence`   | yes      | a Manager that subscribes later knows whether the DT is up |
| `<topic>/notify/escalation` | no       | a Manager that subscribes later does not act on an old one |

The online notice is published each time the runner connects, the first
time and after each reconnect. The notification topics are two levels
under the base topic, so `<topic>/+/response` does not match them:

```bash
mosquitto_sub -h 127.0.0.1 -p 18830 -v -t 'dtaas/hospital-1/notify/+'
```

While the broker is unreachable, the runner queues the notifications in
memory and publishes them in order when it connects again.

In the demo, `mq retained` subscribes late. Halfway through it gets the
retained state and presence, and no escalation:

```text
notify/state (retained) 09:05:39 machine open#4 running | scope multi | command open:running
notify/presence (retained) 09:05:11 online  hospital-1 in Aarhus
```

After the shutdown, the retained presence says offline:

```text
notify/state (retained) 09:05:45 machine closed#5 valid | scope multi | command closed:valid
notify/presence (retained) 09:05:47 offline
```

### Over a Webhook

With a `notify.url` in the configuration, the runner posts each
notification to it as `application/json`, with a 5 s timeout. It
retries after 1 s, 2 s and 4 s on a network error, a timeout or a `5xx`
reply, and not on any other reply. Posts are independent, so they may
arrive out of order; a receiver that needs a strict order uses MQTT. A
failure is logged once, with the host of the webhook only, until a post
succeeds again.

The webhook gets the online notice once at startup, not on a
reconnect, and the offline notice once at shutdown. At shutdown the
runner abandons the posts still in progress or waiting for a retry. In
the recording, the demo's receiver logged the notifications other than
state documents as:

```text
POST presence   09:05:11 online  hospital-1 in Aarhus
POST escalation 09:05:24 request in open#1: no cardiology bed for p-3 proposal {"scope":"multi"}
POST escalation 09:05:34 failure in full#3: script of state full failed
POST escalation 09:05:36 no-transition in full#3 event close: no transition for close in state full
POST presence   09:05:47 offline
```

Without MQTT and a webhook, [GET /state](#get-state) is the only way to
observe the state, and nothing is announced.

## Calls From Scripts

Scripts are clients of the API too. The runner gives each script its
own address and the context of the DT in environment variables.

### Script Environment

| Variable          | Value in the demo, in state `open` at entry 1  |
| :---------------- | :--------------------------------------------- |
| `RUNNER_URL`      | `http://127.0.0.1:5100`                        |
| `DT_ID`           | `hospital-1`                                   |
| `DT_STATE`        | `open`; empty before the first transition      |
| `DT_ENTRY`        | `1`                                            |
| `DT_PARAM_<NAME>` | `DT_PARAM_SCOPE=single`, `DT_PARAM_CAPACITY=2` |

Without a state machine, `DT_STATE` and `DT_ENTRY` are absent. The
variables under `env` in the state machine file come too, such as
`POLL_MS=500` of `open`. The script of `open` logged:

```text
09:05:16 open   DT_ID=hospital-1 DT_STATE=open DT_ENTRY=1
09:05:16 open   DT_PARAM_SCOPE=single DT_PARAM_CAPACITY=2 POLL_MS=500
09:05:16 open   HINT=hospital-1/open#1 scope=single RUNNER_URL=http://127.0.0.1:5100
```

### Raise an Event or Escalate

A script raises an event with `POST $RUNNER_URL/fsm/event` and
escalates with `POST $RUNNER_URL/escalate`. The demo scripts use this
PowerShell helper, from
[scripts/ward.ps1](demo/hospital/scripts/ward.ps1):

```powershell
function Send-Runner($path, $body) {
  try {
    Invoke-RestMethod -Method Post -Uri "$env:RUNNER_URL/$path" `
      -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) | Out-Null
    202
  } catch { [int]$_.Exception.Response.StatusCode }
}
```

`open.ps1` raises `full` once every bed is taken, and `admit.ps1`
escalates when it finds no bed:

```powershell
$code = Send-Runner 'fsm/event' @{ event = 'full' }
$code = Send-Runner 'escalate' $escalation
```

In a shell script on Linux, the same calls are:

```bash
curl -s -X POST "$RUNNER_URL/fsm/event" \
  -H 'Content-Type: application/json' -d '{"event": "full"}'
curl -s -X POST "$RUNNER_URL/escalate" \
  -H 'Content-Type: application/json' \
  -d '{"reason": "no cardiology bed for p-3", "proposal": {"scope": "multi"}}'
```

An event that a script raises is like any other: the machine follows
the transition of its current state for it, even while the script that
raised it still runs.

## Example Session

The recording, in order, as requests and what they did. Times are
those of the markers in [hospital.cast](demo/hospital/hospital.cast).

| Time | Request                                                                | Outcome                                                                                              |
| ---: | :--------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| 0:15 | runner starts                                                          | presence online and the first state document, over MQTT and the webhook                              |
| 0:31 | `GET /dt`, MQTT `dt`                                                   | the descriptor, the same on both                                                                     |
| 0:37 | `GET /health`                                                          | `ok`, MQTT `connected`, database `file`                                                              |
| 0:40 | `GET /state`                                                           | no state yet, `scope` `single`                                                                       |
| 0:42 | `POST /fsm/transition` to `open`                                       | `202 accepted`; `open.ps1` logs its environment                                                      |
| 0:53 | `POST /` `admit` `p-1`, key `admit-p-1`, twice; then `open` with input | `success` both times, and `admit` ran once; `409 command running`                                    |
| 1:18 | `POST /` `admit` `p-2`, then `p-3`                                     | `success`, then `failed` with exit code 3 and a `request` escalation                                 |
| 1:39 | `GET /`                                                                | the failed `admit`, with exit code 3                                                                 |
| 1:43 | `GET /parameters`; `PUT` `capacity`, then `scope`                      | the declarations; `400 not controllable`; `200`, and `open` restarts at entry 2                      |
| 2:01 | `POST /` `admit` `p-3`, then `p-4`                                     | `success` in maternity; `open.ps1` raises `full`, the script of `full` fails, a `failure` escalation |
| 2:23 | `POST /fsm/event` `close`, twice                                       | `409 no transition` twice, one `no-transition` escalation                                            |
| 2:36 | MQTT `execute` `discharge` `p-1`; MQTT `fsm`                           | `success`; `beds-free` takes the machine to `open` at entry 4                                        |
| 2:51 | `GET /history`                                                         | ten entries                                                                                          |
| 2:54 | `POST /stop` `open`                                                    | `stopped: ["open"]`; `$stopped` leads to `closed` at entry 5                                         |
| 3:10 | graceful shutdown                                                      | presence offline, retained                                                                           |

## Version

This document describes runner version 0.8.0. The
[README](README.md#use) tells how to install, configure and start the
runner, and the [state machine guide](STATE-MACHINE.md) how to write a
state machine file.
