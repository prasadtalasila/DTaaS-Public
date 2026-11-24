# Runner API

The runner serves one digital twin (DT) and answers the same requests
over HTTP and over MQTT. This document lists every route of both, with
the request, the reply and the status of each outcome, and the
notifications that the runner sends on its own. It is the reference for
a DT Manager, a script or any other client of the runner.

The examples come from the
[hospital bed-management demo](../demo/hospital/README.md). Most are
requests typed in its recording on Windows against version 0.10.0,
with the replies that the runner gave, so the values fit together from
one example to the next; the notifications are those that its MQTT
subscriber received in the same run, decoded. The text says where an
example comes from elsewhere. The
[Example Session](#example-session) at the end retells the recording as
one story.

The recording predates version 0.11.0, and this document describes
0.14.0. The replies of [GET /parameters](#get-parameters) are shown as
0.11 and later give them, the state documents of the recording lack
the `properties` member, and the examples of
[properties](#properties) are not from the recording. The descriptors
are shown with the `class` member and the peers with the
`relationship` member, which 0.11 added after the recording.

## The Demo Setup

The demo runs two runners, of the hospitals `hospital-1` and
`hospital-2` in Aarhus, which are [peers](#peers) of each other. Each
has two wards, cardiology and maternity, of two beds at `hospital-1`
and one at `hospital-2`. Most examples ask `hospital-1`, whose
configuration, [demo/hospital/runner.yaml](../demo/hospital/runner.yaml),
gives the addresses that the examples use:

| Setting            | `hospital-1`                                                                                     | `hospital-2`               |
| :----------------- | :----------------------------------------------------------------------------------------------- | :------------------------- |
| HTTP base URL      | `http://localhost:5100`                                                                          | `http://localhost:5200`    |
| MQTT broker        | `mqtt://127.0.0.1:18830`, MQTT 3.1.1                                                             | the same                   |
| MQTT base topic    | `dtaas/hospital-1`                                                                               | `dtaas/hospital-2`         |
| Webhook            | `http://127.0.0.1:18080/dt-events`                                                               | the same                   |
| Permitted commands | `open`, `full`, `closed`, `admit`, `discharge`, `save-script`, `restore-script`, `forecast-beds` | the same                   |
| Manager commands   | `admit`, `discharge`, `forecast-beds`                                                            | the same                   |
| Peers              | `hospital-2`, 12.4 km away                                                                       | `hospital-1`, 12.4 km away |

Both runners name one state machine file,
[demo/hospital/hospital.fsm.yaml](../demo/hospital/hospital.fsm.yaml),
the class `urn:dtaas:demo:hospital` of the two DTs
([CLASS-INSTANCE-INTERFACE.md](../CLASS-INSTANCE-INTERFACE.md)). It has
three states, `open`, `full` and `closed`, each running the script of
the same name. It declares the events `full`, `beds-free`,
`scope-changed`, `fidelity-changed`, `close`, `reopen`,
`neighbour-full` and `neighbour-down`, and three parameters: `scope`,
of values `single` and `multi`, which the Manager controls; `capacity`,
which the Manager may read only; and `fidelity`, of values `low`,
`medium` and `high`, which sets how often `open` samples the beds. It
declares one property, `free-beds`, an integer of unit `beds`, which
`open` writes when the number of free beds changes. Its
subscriptions raise `neighbour-full` when a peer of the relationship
`neighbour` is `full` and `neighbour-down` when it goes offline. The
configuration of `hospital-1` gives `hospital-2` that relationship.
That of `hospital-2`,
[demo/hospital/runner-2.yaml](../demo/hospital/runner-2.yaml), sets
`capacity` to 1 and gives `hospital-1` no relationship, so `hospital-2`
follows no one. The scripts run on Windows in
PowerShell, so their output ends lines with `\r\n`.

The demo runs with [access control](#access-control) and
[signatures](#signatures): each runner lists the principals `alice`
(role `client`) and `manager-1` (role `manager`), signs its output with
its own key, and lists the other's public key with the peer. In the
recording, `dt1 PATH [CURL OPTIONS]` is `curl -s` against
`http://localhost:5100`, signed as `alice`, which prints the reply and
then its HTTP status; `dt2` is the same for `hospital-2`. The examples
below show the plain `curl` command instead, with
`-H "Authorization: Bearer $JWS"`, where `$JWS` is a token for that
request, which the demo's
[tools/sign.mjs](../demo/hospital/tools/sign.mjs) makes (see
[Token](#token)). `--json` (curl 7.82 or later) sends a POST with the
given body as `application/json`; with an older curl, write
`-H 'Content-Type: application/json' -d '<body>'`, and add `-X PUT` for
a PUT. `mq1 ROUTE [JSON]` and `mq2` publish an MQTT request, signed as
`manager-1`, and print the response, as described in [MQTT](#mqtt).

## Routes

Every HTTP route has an MQTT route of the same meaning. An MQTT request
is published on `<topic>/<route>`, where `<topic>` is the `mqtt.topic`
of the configuration. The three routes that write a resource are the
exception: `set-parameters`, `set-properties` and `set-peers` are
published one level under the topic that reads it, on
`<topic>/parameters/set`, `<topic>/properties/set` and
`<topic>/peers/set` (see [Request Topics](#request-topics)).

| HTTP                     | MQTT route       | Request body                                | Success |
| :----------------------- | :--------------- | :------------------------------------------ | :------ |
| `GET /dt`                | `dt`             |                                             | 200     |
| `GET /state`             | `state`          |                                             | 200     |
| `GET /health`            | `health`         |                                             | 200     |
| `GET /metrics`           | `metrics`        |                                             | 200     |
| `POST /`                 | `execute`        | `{"name": "admit", "input": {...}}`         | 200     |
| `GET /`                  | `status`         |                                             | 200     |
| `GET /history`           | `history`        | none; query `since`, `limit`                | 200     |
| `POST /stop`             | `stop`           | `{"name": "open"}` or none                  | 200     |
| `POST /fsm/transition`   | `transition`     | `{"state": "open"}`                         | 202     |
| `POST /fsm/event`        | `event`          | `{"event": "close"}`                        | 202     |
| `GET /fsm`               | `fsm`            |                                             | 200     |
| `GET /parameters`        | `parameters`     |                                             | 200     |
| `PUT /parameters`        | `set-parameters` | `{"scope": "multi"}`                        | 200     |
| `GET /properties`        | `properties`     |                                             | 200     |
| `PUT /properties`        | `set-properties` | `{"free-beds": 3}`                          | 200     |
| `POST /escalate`         | `escalate`       | `{"reason": "...", "proposal": {}}`         | 202     |
| `GET /peers`             | `peers`          |                                             | 200     |
| `PUT /peers`             | `set-peers`      | `{"hospital-2": false}`                     | 200     |
| `GET /timeline`          | `timeline`       | none; query `after`, `kind`, ...            | 200     |
| `POST /snapshot`         | `save`           | `{"stop": true}` or none                    | 201     |
| `GET /snapshot`          | `snapshots`      |                                             | 200     |
| `DELETE /snapshot/<n>`   | none             |                                             | 204     |
| `POST /whatif`           | `whatif`         | `{"name": "forecast-beds", "input": {...}}` | 202     |
| `GET /whatif/<id>`       | `whatif-result`  | MQTT `{"id": 5}`                            | 200     |
| `PUT /peers/<id>/notice` | none             | `{"kind": "presence", "data": {...}}`       | 200     |

`<n>` is the name of a [snapshot](#snapshots). The two MQTT routes of
the snapshots are published on `<topic>/snapshot/set` and
`<topic>/snapshot`; no topic deletes one. The two routes of a
[what-if](#what-if) are published on `<topic>/whatif/set` and
`<topic>/whatif`. `PUT /peers/<id>/notice` is a route of HTTP alone,
answered only by a [replay twin](#replay-twins); any other runner
answers `404`.

With access control, each route is open to some roles only; see
[Roles](#roles).

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
  `2026-10-27T19:19:50.732Z`. The times of commands are stored to the
  second, so their milliseconds are `000`.
- **Unexpected errors.** An unexpected failure gets HTTP status 500
  with `{"statusCode": 500, "message": "Internal server error"}`, over
  MQTT too.
- **Credentials.** With `auth.principals` in the configuration, a
  request without a valid credential gets 401 and a caller whose role
  may not call the route 403, before the body is validated; see
  [Access Control](#access-control). Without it, the runner ignores any
  `Authorization` header.

## Digital Twin

Four routes tell who the DT is, what state it is in, whether the
runner is alive, and what it did since it started.

### GET /dt

Describes the DT from the configuration. MQTT route: `dt`.

```bash
curl -s http://localhost:5100/dt -H "Authorization: Bearer $JWS"
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
  "class": { "id": "urn:dtaas:demo:hospital", "version": "1.0.0" },
  "stateMachine": true,
  "manager": { "commands": ["admit", "discharge"] },
  "peers": ["hospital-2"],
  "publicKey": "NC6o1XrrDbF0Kta1gISss-R6v1IgC8zg0OUOWy7Jr3Y",
  "replay": null
}
```

| Field          | Meaning                                                                                                      |
| :------------- | :----------------------------------------------------------------------------------------------------------- |
| `id`           | the identity of the DT, `id` in the configuration                                                            |
| `attributes`   | the `attributes` of the configuration; `{}` without any                                                      |
| `commands`     | the permitted commands, which `POST /` may run                                                               |
| `class`        | the `id` and `version` of the `class` section of the state machine file; `null` without the section or file  |
| `stateMachine` | whether a state machine is loaded; `false` without a file and for a file without states                      |
| `manager`      | the `manager.commands` of the state machine file; the commands meant for the Manager, a subset of `commands` |
| `peers`        | the ids of the enabled [peers](#peers), in the order of the configuration; `[]` without any                  |
| `publicKey`    | the public key that verifies the runner's [signatures](#signatures); `null` without `auth.key`               |
| `replay`       | `null`; in a [replay twin](#replay-twins), `of`, the `id` of the twin, and `time`, the time of its snapshot  |

`class` names the kind of DT that the state machine file defines, and
came with version 0.11.0. The runner never interprets the `id` and
never compares versions
([CLASS-INSTANCE-INTERFACE.md](../CLASS-INSTANCE-INTERFACE.md)).
`replay` came with version 0.14.0. A replay twin of the demo, started
by hand from a snapshot of `hospital-1`, answered with `id`
`hospital-1.replay`, `publicKey` `null` and:

```json
"replay": { "of": "hospital-1", "time": "2026-11-24T18:38:56.368Z" }
```

### GET /state

Returns the whole state of the DT in one document, with status 200
whether or not a state machine is loaded. MQTT route: `state`. This is
the document of the [state notifications](#state-notifications).

After the first transition of the demo, into `open`:

```bash
curl -s http://localhost:5100/state -H "Authorization: Bearer $JWS"
```

`200`:

```json
{
  "id": "hospital-1",
  "time": "2026-10-27T19:19:50.732Z",
  "machine": {
    "state": "open",
    "status": "running",
    "entry": 1,
    "events": [
      "beds-free",
      "close",
      "fidelity-changed",
      "full",
      "neighbour-down",
      "neighbour-full",
      "reopen",
      "scope-changed"
    ]
  },
  "parameters": { "scope": "single", "capacity": 2, "fidelity": "medium" },
  "command": {
    "name": "open",
    "status": "running",
    "receivedAt": "2026-10-27T19:19:44.000Z",
    "finishedAt": null
  }
}
```

Before the first transition, `machine` is
`{"state": null, "status": "none", "entry": 0, "events": [...]}` and
`command` is `null`, as in the first
[state notification](#state-notifications).

From version 0.11.0 the document also has `properties`, between
`parameters` and `command`, which the recording predates. For the demo
it is, once `open` has written the four free beds:

```json
{
  "properties": {
    "free-beds": { "value": 4, "time": "2026-11-22T19:59:17.857Z" }
  }
}
```

| Field        | Meaning                                                                                                   |
| :----------- | :-------------------------------------------------------------------------------------------------------- |
| `id`         | the identity of the DT                                                                                    |
| `time`       | the time the document was built                                                                           |
| `machine`    | the reply of [GET /fsm](#get-fsm), or `null` without a state machine                                      |
| `parameters` | the value of each [parameter](#parameters); `{}` without a state machine file                             |
| `properties` | the latest `value` of each [property](#properties) and the `time` of its write; `{}` without declarations |
| `command`    | the latest command, or `null` before the first one                                                        |

The `value` and `time` of a property are `null` until its first write.

`command` has the `name` of the command, its `status`, `receivedAt` and
`finishedAt`. Its status is `running` until the script finishes, then
`valid`, `failed`, `invalid`, `stopped` or `interrupted`, as in
[GET /](#get-). `finishedAt` is `null` while it runs. While `admit`
runs in state `open`, for example, the document has:

```json
{
  "machine": { "state": "open", "status": "running", "entry": 1 },
  "command": {
    "name": "admit",
    "status": "running",
    "receivedAt": "2026-10-27T19:19:58.000Z",
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
{
  "status": "ok",
  "uptime": 13,
  "mqtt": "connected",
  "database": "file",
  "scripts": null
}
```

From 0.12.0 the reply also has `saving`. A runner on port 5317 without
MQTT, asked while a [save](#post-snapshot) ran, answered:

```json
{
  "status": "ok",
  "uptime": 25,
  "mqtt": "disabled",
  "database": "file",
  "scripts": null,
  "saving": true
}
```

The demo runs on Windows, where the runner refuses `scripts.user`, so
`scripts` is `null`; a Linux runner with that setting answers
`"scripts": { "user": "dt-script" }`.

| Field      | Values                                                                                      |
| :--------- | :------------------------------------------------------------------------------------------ |
| `status`   | `degraded` while `mqtt` is `disconnected`, else `ok`                                        |
| `uptime`   | whole seconds since the runner started                                                      |
| `mqtt`     | `connected`; `disconnected`, also while it reconnects; `disabled` without an `mqtt` section |
| `database` | `file` with a `database` file in the configuration, else `memory`                           |
| `scripts`  | `{ "user": <name> }` with `scripts.user`, the script account's name; else `null`            |
| `saving`   | `true` while a [save](#post-snapshot) runs, else `false`                                    |

The reply is `200` in both cases. The runner connects to the broker
after it starts, so the first replies may say `degraded`. Over MQTT the
runner answers only while it is connected, so the reply always says
`connected`; that a reply arrives at all tells that the runner is
alive.

### GET /metrics

Counts what the runner did since it started. MQTT route: `metrics`.

```bash
curl -s http://localhost:5100/metrics -H "Authorization: Bearer $JWS"
```

`200`, in the section History and Metrics of the demo, after
`hospital-2` went offline (see the [Example Session](#example-session)):

```json
{
  "since": "2026-10-27T19:19:12.448Z",
  "uptime": 166,
  "commands": {
    "valid": 6,
    "failed": 2,
    "stopped": 5,
    "invalid": 0,
    "interrupted": 0,
    "running": 1
  },
  "resources": {
    "open": { "cpuSeconds": 13.546, "peakRssBytes": 105103360, "processes": 2 }
  },
  "machine": {
    "entries": { "open": 7, "full": 1 },
    "seconds": { "open": 118.519, "full": 15.093 },
    "completions": { "$success": 0, "$failure": 1, "$stopped": 0 },
    "transitions": { "requested": 1, "accepted": 1 },
    "events": { "requested": 9, "accepted": 7, "noTransition": 2 }
  },
  "escalations": { "request": 1, "failure": 1, "no-transition": 1 }
}
```

The fourteen commands are seven runs of `open`, five of `admit`, one
of `discharge` and one of `full`. Only the runs of `open` were
measured: on Windows the other scripts ended before their first sample,
as in [POST /](#post-).

- `since` is when the runner process started, and `uptime` the whole
  seconds since then, as on [GET /health](#get-health). A restart sets
  every counter back to zero, which `since` shows.
- `commands` counts the records of [GET /history](#get-history) that
  arrived since the start, by status, with `running` for unfinished
  ones; `interrupted` counts the commands that this start found
  unfinished (see [Restarts](../README.md#restarts)). Every key is
  always present.
- `resources` has a key for each command with a measured run among the
  same records: `cpuSeconds` sums its runs, to the millisecond,
  `peakRssBytes` is the largest peak of one run, and `processes` the
  largest tree of one run. A `null` figure adds
  nothing, so the object is `{}` before any measured run. The figures
  are those of [POST /](#post-).
- `machine` is `null` without a state machine. `entries` and `seconds`
  have a key for each state entered since the start, and for the state
  that a restored machine starts in, which counts from `since` without
  an entry. `seconds` counts the current state up to the request, to the
  millisecond.
- `completions` counts the scripts of the current entry that finished,
  by the event that their outcome raises: six of the seven entries
  into `open` were left before their scripts ended, so their ends count
  nothing. A
  [stop transition](../STATE-MACHINE.md#stop-transitions)
  (`stop: true`) likewise enters its next state before the stopped
  script ends, so that stop counts nothing; only a
  [POST /stop](#post-stop), which keeps the entry, counts as
  `$stopped`. A DT whose only stops are stop transitions keeps
  `$stopped` at zero.
- `transitions` and `events` count the requests that reached the
  machine; a [repeated request](#repeated-requests) that gets its
  stored reply counts once. `events` includes the events that a
  parameter change raises, such as `scope-changed` above, and those of
  the [peer subscriptions](#peers), such as `neighbour-full`.
- `escalations` counts the [escalations](#escalation) by trigger, with
  or without a state machine.

The counters live in memory and change no state document, so a change
of a counter sends no notification. Analysis over a longer time is the
Manager's, from the history and the notifications.

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
curl -s http://localhost:5100/ -H "Authorization: Bearer $JWS" \
  -H 'Idempotency-Key: admit-p-1' \
  --json '{"name":"admit","input":{"patient":"p-1","ward":"cardiology"}}'
```

`200`:

```json
{
  "status": "success",
  "result": {
    "exitCode": 0,
    "stdout": "hospital-1 in state open#1, scope single\r\np-1 admitted to cardiology",
    "stderr": "",
    "resources": { "cpuSeconds": null, "peakRssBytes": null, "processes": null }
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

`resources` holds what the script used, as the runner sampled it while
it ran; the [README](../README.md#resources) tells how each platform
measures. `cpuSeconds` is user plus system CPU time in seconds, to the
millisecond, `peakRssBytes` the peak resident memory in bytes, and
`processes` the most processes seen at once. They cover the process
tree of the run: the process that the runner starts and every process
below it, sampled every half second or so. The figures are lower
bounds, and `null` when not measured: on a platform other than Linux
and Windows, or for a script that ended before its first sample. On
Windows the sampler is a `powershell.exe` of its own, which needs a
second or more to start, so a short script such as `admit.ps1` above
ends unmeasured. A run of `open` in the demo, which lasted five
seconds, reports its tree: `powershell.exe`, which ran `open.ps1`, and
its `conhost.exe`, most of the 100 MB being PowerShell's own:

```json
{ "cpuSeconds": 1.656, "peakRssBytes": 103395328, "processes": 2 }
```

Both wards hold two beds and `scope` is `single`, so after `p-2`, a
third cardiology patient fails with exit code 3:

```bash
curl -s http://localhost:5100/ -H "Authorization: Bearer $JWS" \
  --json '{"name":"admit","input":{"patient":"p-3","ward":"cardiology"}}'
```

`200`:

```json
{
  "status": "failed",
  "result": {
    "exitCode": 3,
    "stdout": "hospital-1 in state open#1, scope single",
    "stderr": "no free bed for p-3; escalated: 202",
    "resources": { "cpuSeconds": null, "peakRssBytes": null, "processes": null }
  }
}
```

Before it failed, the script [escalated](#post-escalate) to the
Manager.

Input to a command that is running is refused, since the run in
progress did not get that input. `open` is the script of the current
state, so it is running:

```bash
curl -s http://localhost:5100/ -H "Authorization: Bearer $JWS" \
  --json '{"name":"open","input":{}}'
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
curl -s http://localhost:5100/ -H "Authorization: Bearer $JWS"
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
  "exitCode": 3,
  "resources": { "cpuSeconds": null, "peakRssBytes": null, "processes": null }
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
empty logs, `exitCode` `null` and every `resources` figure `null`, until it
finishes;
[GET /state](#get-state) shows it as `running`. These names differ from
those of `POST /`: `valid` here is `success` there.

### GET /history

Lists the command requests received, oldest first: those of `POST /`,
of MQTT `execute`, and the scripts that the state machine ran. Commands
that are not permitted appear too. A repeated request and a request
refused with `command running` do not. MQTT route: `history`.

```bash
curl -s http://localhost:5100/history -H "Authorization: Bearer $JWS"
```

`200`, after the change of `fidelity` in the demo, the newest two of
six records, with `limit=2` (see below):

```json
[
  {
    "id": 5,
    "name": "open",
    "status": "stopped",
    "exitCode": null,
    "receivedAt": "2026-10-27T19:20:31.000Z",
    "finishedAt": "2026-10-27T19:20:36.000Z",
    "by": null,
    "resources": {
      "cpuSeconds": 1.656,
      "peakRssBytes": 103395328,
      "processes": 2
    }
  },
  {
    "id": 6,
    "name": "open",
    "status": "running",
    "exitCode": null,
    "receivedAt": "2026-10-27T19:20:36.000Z",
    "finishedAt": null,
    "by": null,
    "resources": { "cpuSeconds": null, "peakRssBytes": null, "processes": null }
  }
]
```

| Field        | Value                                                                                           |
| :----------- | :---------------------------------------------------------------------------------------------- |
| `id`         | the number of the request, which grows with each one                                            |
| `name`       | the command                                                                                     |
| `status`     | `running` while unfinished, then as [GET /state](#get-state) reports it                         |
| `exitCode`   | as on [GET /](#get-); `null` while running                                                      |
| `receivedAt` | when the request arrived                                                                        |
| `finishedAt` | when the command finished; `null` while running                                                 |
| `by`         | the [principal](#access-control) that sent it, or `null` without `auth` or for a state's script |
| `resources`  | as on [POST /](#post-); `null` while running, and for refused, interrupted and older commands   |
| `mode`       | `"what-if"` for the run of a [what-if](#what-if); absent for every other run                    |

Record 5 is the run of `open` at entry 2, which the change of
`fidelity` stopped with its figures; record 6 is the run at entry 3,
whose figures come when it ends. The six records are the first two
entries into `open`, the admissions of `p-1`, `p-2` and `p-3`, which
`alice` sent and which ended before their first sample, and this run.
The repeat of `p-1` and the refused input to `open` are missing.
Neither the logs, which stay on [GET /](#get-), nor the input are part
of the history. The duration of a command is
`finishedAt - receivedAt`.

At the end of the demo, `GET /history` had fourteen records: five sent
by `alice`, the `discharge` that `manager-1` sent over MQTT, and eight
scripts of states, whose `by` is `null`.

Two query parameters, both optional, select the records; over MQTT they
are the payload, as a JSON object such as `{"since": "...", "limit": 2}`,
and an empty payload takes the defaults.

| Parameter | Value                                                                                        |
| :-------- | :------------------------------------------------------------------------------------------- |
| `since`   | ISO 8601 with `Z` or an offset; the records received at that second or later                 |
| `limit`   | an integer from 1 to 1000, by default 100; the newest records of the selection, oldest first |

The demo asked for the records of the last 90 seconds, at most two:

```bash
since=$(date -u -d '-90 sec' +%FT%TZ)
curl -s "http://localhost:5100/history?since=$since&limit=2" \
  -H "Authorization: Bearer $JWS"
```

and got records 13 and 14, the runs of `open` that `neighbour-down`
stopped and started. The signature covers the path without the query,
so the token of `GET /history` serves any query. As times are stored to
the second, `since` is compared to the second too, and the records of
that second come again: a Manager that polls with the last `receivedAt`
it holds drops the repeats by `id`. A value that fails, such as
`limit=0`, `limit=1001`, `limit=1.5`, a `since` that is not ISO 8601, a
parameter given twice, or an MQTT payload that is not a JSON object,
gets the validation error of the [Conventions](#conventions). Unknown
parameters are ignored.

In a URL, the `+` of an offset must be percent-encoded as `%2B`, as in
`since=2026-10-26T16:56:00%2B02:00`: a plain `+` arrives as a space, and
the request is refused with `400`.

### POST /stop

Stops the running command of the given name, or every running command
without a `name` or without a body. MQTT route: `stop`, with an empty
payload or `{}` to stop every command.

The runner sends the script `SIGTERM`, and `SIGKILL` if it still runs
after `stopGrace` milliseconds of the configuration. On Windows, as in
the demo, it ends `powershell.exe` at once. It answers once the scripts
have exited, which can take the grace period and more. Only the
script's own process is signalled; on Windows the processes that the
script started keep running. The stopped run reports the `resources`
of its tree up to the last sample before that process exited, and the
processes that survive the stop are not measured:

```bash
curl -s http://localhost:5100/stop -H "Authorization: Bearer $JWS" \
  --json '{"name":"open"}'
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

These routes need a `stateMachine` in the configuration, whose file
has states; without one, and for a file without states, they answer
`404` with `{"status": "no state machine", "state": null}`.

The machine is idle before its first transition and whenever the
script of its current state has finished. On entering a state, the
runner starts the script of that state and answers as soon as the
script has started.

### POST /fsm/transition

Moves an idle machine to a state. MQTT route: `transition`.

```bash
curl -s http://localhost:5100/fsm/transition -H "Authorization: Bearer $JWS" \
  --json '{"state":"open"}'
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
[Calls From Scripts](#calls-from-scripts), and the runner raises the
events of [peer subscriptions](#peers) the same way.

The state `full` has no transition for `close`:

```bash
curl -s http://localhost:5100/fsm/event -H "Authorization: Bearer $JWS" \
  --json '{"event":"close"}'
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
| `no state machine`    | 404  | no `stateMachine` key, or a file that has no states     |
| `stopping`            | 503  | the runner is shutting down                             |

A body without a `state` or an `event` gets the
[validation error](#conventions) before any other check.

### GET /fsm

Returns the state of the machine. MQTT route: `fsm`. After the stop of
`open`:

```bash
curl -s http://localhost:5100/fsm -H "Authorization: Bearer $JWS"
```

`200`:

```json
{
  "state": "closed",
  "status": "valid",
  "entry": 9,
  "events": [
    "beds-free",
    "close",
    "fidelity-changed",
    "full",
    "neighbour-down",
    "neighbour-full",
    "reopen",
    "scope-changed"
  ]
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
file with a `type` of `string`, `number`, `integer` or `boolean` and,
optionally, an `enum`, a `minimum` and a `maximum`. The scripts see
them as `DT_PARAM_<NAME>` environment variables. The configuration
may give a parameter the value of this DT, under `parameters`, in place
of the `default` of the file
([README](../README.md#parameters)).
No name has a meaning to the runner: a `fidelity` parameter, by which a
Manager trades a DT's accuracy for computing power, is a convention
between DT authors and Managers
([Pattern: Fidelity](../STATE-MACHINE.md#pattern-fidelity)).
Without a state machine file, both routes answer `404` with
`{"status": "no state machine", "state": null}`. A file without
states, which only declares, is enough for them.

### GET /parameters

Returns the value and the declaration of each parameter, without its
`event`. MQTT route: `parameters`.

```bash
curl -s http://localhost:5100/parameters -H "Authorization: Bearer $JWS"
```

`200`:

```json
{
  "scope": {
    "value": "single",
    "type": "string",
    "enum": ["single", "multi"],
    "default": "single",
    "controllable": true
  },
  "capacity": {
    "value": 2,
    "type": "integer",
    "minimum": 1,
    "default": 2,
    "controllable": false
  },
  "fidelity": {
    "value": "medium",
    "type": "string",
    "enum": ["low", "medium", "high"],
    "default": "medium",
    "controllable": true
  }
}
```

Each entry has the `value` and the declaration: `type`, `default`,
`controllable` and, where declared, `enum`, `minimum` and `maximum`.
`default` is the value that `parameters` of the configuration gives
the parameter, else the `default` of the state machine file; it is
also the `value` until a request changes it. `hospital-2`, whose
configuration sets `capacity` to 1, shows `"value": 1` and
`"default": 1`.
Version 0.11.0 changed the reply for an enum, which was
`"type": "enum"` with `"values"`; it is `"type": "string"` with
`"enum"`. A state machine file that declares `type: enum` with
`values` loaded in 0.11, with a warning, and does not load from
0.12.0.

### PUT /parameters

Sets the values of controllable parameters. The body maps parameter
names to new values, which are strings, numbers or booleans. MQTT
route: `set-parameters`, on the topic `<topic>/parameters/set`.

The runner applies the whole body or none of it:

1. It checks every entry. An unknown name, a parameter that is not
   controllable or a value that does not fit the declaration is
   refused with `400`, and `message` lists every problem.
1. It stores the new values, so that a script that starts afterwards
   sees them. If the database fails, it stores none.
1. It raises the `event` of each changed parameter, in the order of
   the declarations. An event that two changed parameters declare is
   raised once.

`capacity` is not controllable:

```bash
curl -s -X PUT http://localhost:5100/parameters -H "Authorization: Bearer $JWS" \
  --json '{"capacity":3}'
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
script of `open` and starts it again, at entry 2. The demo sent it over
MQTT, as `manager-1` (see [MQTT](#mqtt)); over HTTP it is:

```bash
curl -s -X PUT http://localhost:5100/parameters -H "Authorization: Bearer $JWS" \
  --json '{"scope":"multi"}'
```

The reply is the body of `GET /parameters`, now with `"value": "multi"`
for `scope`. The reply is the same whatever the events did; an event
that the machine refuses is logged. `GET /state` tells where the
machine went. A value equal to the current one changes nothing and
raises no event, so a repeat of the request and `{}` change nothing.
The route takes no request key for that reason.

`{"fidelity": "high"}` then raised `fidelity-changed`, another
`stop: true` self-transition of `open`, which started again at entry 3
and samples the beds every 100 ms instead of 500 ms; the run at entry
2 ended `stopped` with its figures, as [GET /history](#get-history)
shows.

## Properties

Properties are the latest values that the scripts and sensors of the
DT hand the runner, such as a reading of the physical twin. The state
machine file declares them with the types of JSON Schema, as a Thing
Description of the W3C Web of Things uses them, and every number names
its unit ([README](../README.md#properties)). The runner checks each
value against its declaration, stores it, shows it and publishes it in
the [state document](#get-state). It never interprets a value, and a
write raises no event.

Without a state machine file, both routes answer `404` with
`{"status": "no state machine", "state": null}`. A file without states
is enough for them, and a file that declares no property gives `{}`.

The examples of this section are not from the recording. They are
those of a runner whose file declares the `free-beds` of the demo and
two more properties, as the sample
[state-machine.yaml.sample](../config/state-machine.yaml.sample) does:

```yaml
properties:
  free-beds:
    type: integer
    minimum: 0
    unit: beds
  ward-status:
    type: string
    enum:
      - open
      - full
      - closed
  forecast:
    type: array
    items:
      type: number
      unit: beds
```

### GET /properties

Returns the latest value of each property, the time of its write, who
wrote it, and its declaration. MQTT route: `properties`. Every role
may call it, the role `sensor` too.

```bash
curl -s http://localhost:5100/properties -H "Authorization: Bearer $JWS"
```

`200`, after a script wrote `free-beds` and before any other write:

```json
{
  "free-beds": {
    "value": 4,
    "time": "2026-11-22T19:59:17.857Z",
    "by": "script",
    "type": "integer",
    "minimum": 0,
    "unit": "beds"
  },
  "ward-status": {
    "value": null,
    "time": null,
    "by": null,
    "type": "string",
    "enum": ["open", "full", "closed"]
  },
  "forecast": {
    "value": null,
    "time": null,
    "by": null,
    "type": "array",
    "items": { "type": "number", "unit": "beds" }
  }
}
```

| Field   | Meaning                                                                                                           |
| :------ | :---------------------------------------------------------------------------------------------------------------- |
| `value` | the latest value written; `null` until the first write, and when `null` was written                               |
| `time`  | the runner's time at that write; `null` until the first write                                                     |
| `by`    | the principal that wrote it, or `script`; `null` without access control and until the first write                 |
| others  | the declaration: `type` and, as declared, `enum`, `minimum`, `maximum`, `unit`, `items`, `properties`, `required` |

### PUT /properties

Writes the latest values of properties. The body is a flat object of
property names and values. MQTT route: `set-properties`, on the topic
`<topic>/properties/set`. The roles `client`, `script` and `sensor`
may call it; a `manager` may not (see [Roles](#roles)).

```bash
curl -s -X PUT http://localhost:5100/properties -H "Authorization: Bearer $JWS" \
  --json '{"free-beds":3,"forecast":[3,2.5,2]}'
```

The reply is `200` with the body of `GET /properties`, where both
properties have the new value, one `time` and the caller as `by`.

The runner checks the whole body first, and changes nothing if any
entry is not declared or does not fit its declaration. `message` lists
every problem:

```bash
curl -s -X PUT http://localhost:5100/properties -H "Authorization: Bearer $JWS" \
  --json '{"free-beds":-1,"ward-status":"shut","forecast":[1,"x"],"size":1}'
```

`400`:

```json
{
  "message": [
    "property free-beds: Too small: expected number to be >=0",
    "property ward-status: Invalid option: expected one of \"open\"|\"full\"|\"closed\"",
    "property forecast[1]: Invalid input: expected number, received string",
    "property size is not declared"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

- `null` is accepted for every type and means that the value is not
  known, for example while a sensor is offline. It is stored with its
  `time` as any other value.
- Writing the same value again updates its `time`, so a reader sees
  that the feed is alive.
- `{}` is `200` and changes nothing. A body that is not an object gets
  the [validation error](#conventions). The route takes no request
  key.
- An object value may not have a member that its declaration lacks,
  and must have the members that `required` lists.
- A write changes the state document. Its
  [state notification](#state-notifications) may wait for
  `stateInterval`.
- The runner keeps the latest value of each property in its database,
  one row per name, and restores it with its `time` and `by` at the
  next start. A stored value that no longer fits its declaration is
  dropped with a warning in the log.

## Peers

The configuration's `relationships.peers` section lists the DTs that
this one is willing to interact with; nothing else is a peer. With MQTT, the runner
subscribes to the presence and state notifications of each enabled
peer with a `topic`, on its own broker, and remembers what they told.
A notification counts only as an [envelope](#notifications) of its
topic's kind and of the peer's `id`; for a peer with a `publicKey`,
only as a JWS of the envelope that the key signed, with the peer's `id`
as `kid`. The runner logs and drops any other, and an empty payload,
which clears a retained notification, sets its part back to `null`. A
peer's notification sends no notification. It raises an event only
through a `subscriptions` entry of the state machine file, when the
entry's condition on the peer's `state` or `online` turns true; the
event then takes the path of [POST /fsm/event](#post-fsmevent) without
a request key, and nothing replies
([README](../README.md#peer-events)). An entry names one peer by its
`id`, or a `relationship`, which the configuration gives to peers; the
runner then follows every peer of that relationship. In the demo, the
state machine file subscribes to the state `full` and to
`online: false` of the relationship `neighbour`, which the
configuration of `hospital-1` gives `hospital-2`, and the runner logs
each event it raises:

```text
Raised neighbour-full on state full of peer hospital-2: entered open
Raised neighbour-down on online false of peer hospital-2: entered open
```

### GET /peers

Maps each peer's id to its entry; `{}` without peers. MQTT route:
`peers`.

```bash
curl -s http://localhost:5100/peers -H "Authorization: Bearer $JWS"
```

`200`, with `hospital-2` online in state `open`, after the first
transition of both hospitals:

```json
{
  "hospital-2": {
    "topic": "dtaas/hospital-2",
    "url": "http://localhost:5200",
    "attributes": { "distance": 12.4 },
    "relationship": "neighbour",
    "enabled": true,
    "online": true,
    "descriptor": {
      "id": "hospital-2",
      "attributes": {
        "name": "Hospital 2",
        "city": "Aarhus",
        "latitude": 56.2,
        "longitude": 10.18,
        "wards": 2
      },
      "commands": ["open", "full", "closed", "admit", "discharge"],
      "class": { "id": "urn:dtaas:demo:hospital", "version": "1.0.0" },
      "stateMachine": true,
      "manager": { "commands": ["admit", "discharge"] },
      "peers": ["hospital-1"],
      "publicKey": "h484L5GHC1Fm1u-zlUFvxmaZy4me2A2mKuIoRFY57XU"
    },
    "state": {
      "id": "hospital-2",
      "time": "2026-10-27T19:19:40.394Z",
      "machine": {
        "state": "open",
        "status": "running",
        "entry": 1,
        "events": [
          "beds-free",
          "close",
          "fidelity-changed",
          "full",
          "neighbour-down",
          "neighbour-full",
          "reopen",
          "scope-changed"
        ]
      },
      "parameters": { "scope": "single", "capacity": 1, "fidelity": "medium" },
      "command": {
        "name": "open",
        "status": "running",
        "receivedAt": "2026-10-27T19:19:40.000Z",
        "finishedAt": null
      }
    }
  }
}
```

| Field          | Meaning                                                                                 |
| :------------- | :-------------------------------------------------------------------------------------- |
| `topic`        | the peer's MQTT base topic; `null` without one                                          |
| `url`          | the peer's HTTP base URL; `null` without one                                            |
| `attributes`   | the peer's `attributes` in the configuration, such as a distance; `{}` without any      |
| `relationship` | the peer's `relationship` in the configuration, such as `neighbour`; `null` without one |
| `enabled`      | whether the runner follows the peer and lists it in [GET /dt](#get-dt)                  |
| `online`       | the `online` of the peer's last presence notice                                         |
| `descriptor`   | the descriptor of the peer's last online notice; an offline notice keeps it             |
| `state`        | the `data` of the peer's last state notification                                        |

`online`, `descriptor` and `state` are `null` until a notification
tells them, and stay `null` without MQTT, for a disabled peer and for
one without `topic`. When the runner of `hospital-2` was killed, its
will set `online` to `false` and kept the descriptor and the last
state, `full` at entry 2. `publicKey` of the configuration is not
shown; the `publicKey` of the descriptor is the one that the peer
announced.

### PUT /peers

Enables and disables peers of the configuration. The body maps peer ids
to booleans. MQTT route: `set-peers`, on the topic `<topic>/peers/set`.

The runner checks the whole body first. An unknown id or a value that
is not a boolean is refused with `400`, and `message` lists every
problem:

```bash
curl -s -X PUT http://localhost:5100/peers -H "Authorization: Bearer $JWS" \
  --json '{"hospital-9":false,"hospital-2":"off"}'
```

`400`:

```json
{
  "message": ["unknown peer hospital-9", "peer hospital-2 takes a boolean"],
  "error": "Bad Request",
  "statusCode": 400
}
```

A body that is not an object gets the [validation error](#conventions).
`{"hospital-2": false}` is `200` with the body of `GET /peers`:

```json
{
  "hospital-2": {
    "topic": "dtaas/hospital-2",
    "url": "http://localhost:5200",
    "attributes": { "distance": 12.4 },
    "relationship": "neighbour",
    "enabled": false,
    "online": null,
    "descriptor": null,
    "state": null
  }
}
```

In the demo, `{"hospital-2": true}` then brought back the retained
state `full` of `hospital-2`, which counted as a change for the
subscription of `hospital-1`, so `neighbour-full` restarted `open`
once more. The runner stores the changes of a body together, or
none of them; a stored change overrides the `enabled` of the
configuration at the next start. Disabling a peer unsubscribes and
forgets what it told; enabling it subscribes again, and the retained
notifications fill the entry shortly after the reply. A value equal to
the current one changes nothing, so `{}` changes nothing and the route
takes no request key. No notification is sent: the retained presence
notice keeps the peers of the last connection, while `GET /dt` is
current. The Manager can enable and disable only the peers that the
operator listed, never add one.

### PUT /peers/:id/notice

Hands a [replay twin](#replay-twins) a notice of a peer, as it would
have come over MQTT. A replay twin follows no peer, so `runner-replay`
sends it the `notice` rows of the twin's timeline this way. No MQTT
route; only an `operator` may call it, and a runner that is no replay
twin answers `404` `{"message": "Not Found", "statusCode": 404}` to
every caller.

The body is `{"kind": "presence", "data": {"online": <boolean>,
"descriptor": <descriptor>}}`, with `descriptor` optional, or
`{"kind": "state", "data": <state document>}`; `"data": null` stands
for the empty payload that clears a retained notification. A replay
twin of the demo, with the header `Replay-Seq: 57`:

```bash
curl -s -X PUT http://127.0.0.1:5400/peers/hospital-2/notice \
  -H 'Replay-Seq: 57' --json '{"kind":"presence","data":{"online":false}}'
```

`200`, with the body of `GET /peers`:

```json
{
  "hospital-2": {
    "topic": "dtaas/hospital-2",
    "url": "http://localhost:5200",
    "attributes": { "distance": 12.4 },
    "relationship": "neighbour",
    "enabled": true,
    "online": false,
    "descriptor": null,
    "state": null
  }
}
```

The runner wrote a `notice` row and raised `neighbour-down` through the
subscription of the class, as over MQTT. A notice of a disabled peer is
`200` and ignored, as MQTT does not follow a disabled peer.

| Case                       | Status | `message`                         |
| :------------------------- | :----- | :-------------------------------- |
| A peer that is not listed  | 400    | `["unknown peer hospital-9"]`     |
| Another `kind`, a bad body | 400    | `Validation Failed`               |
| A malformed header         | 400    | see [Replay Twins](#replay-twins) |
| Any role but `operator`    | 403    | `client may not call notice`      |

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
curl -s http://localhost:5100/escalate -H "Authorization: Bearer $JWS" \
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

## Timeline

The runner keeps one row for each thing that entered the DT, changed
in it or left it, in its database, and never deletes or changes a row
after the request that wrote it. A request row names its caller, and
an entry the row that caused it. So the rows tell why the DT is
in its state, also after a restart with a database file.

### GET /timeline

Lists the rows, oldest first. MQTT route: `timeline`, whose payload is
the query as a JSON object, such as `{"kind": "command"}`; an empty
payload takes the defaults.

```bash
curl -s "http://localhost:5077/timeline?after=9&limit=7" \
  -H "Authorization: Bearer $JWS"
```

`200`, from a runner with access control on port 5077, after a
transition to `create` whose scripts led to `execute`. `alice` raised
an event that moved nothing and ran a command with input, `manager-1`
set `scope`, whose event restarted `execute`, and the sensor
`ward-gateway` wrote a property:

```json
[
  {
    "seq": 10,
    "time": "2026-11-24T08:22:05.034Z",
    "kind": "event",
    "by": "alice",
    "data": {
      "event": "done",
      "source": "client",
      "reply": { "status": "no transition", "state": "execute" }
    }
  },
  {
    "seq": 11,
    "time": "2026-11-24T08:22:05.130Z",
    "kind": "command",
    "by": "alice",
    "data": { "name": "echo-input", "input": { "patient": "p-7" }, "run": 4 }
  },
  {
    "seq": 12,
    "time": "2026-11-24T08:22:06.239Z",
    "kind": "parameters",
    "by": "manager-1",
    "data": { "scope": "multi" }
  },
  {
    "seq": 13,
    "time": "2026-11-24T08:22:06.240Z",
    "kind": "event",
    "by": "manager-1",
    "data": {
      "event": "scope-changed",
      "source": "parameter",
      "cause": 12,
      "reply": { "status": "accepted", "state": "execute" }
    }
  },
  {
    "seq": 14,
    "time": "2026-11-24T08:22:06.240Z",
    "kind": "entry",
    "by": null,
    "data": { "state": "execute", "entry": 4, "cause": 13 }
  },
  {
    "seq": 15,
    "time": "2026-11-24T08:22:06.250Z",
    "kind": "exit",
    "by": null,
    "data": { "state": "execute", "entry": 4, "status": "valid", "run": 5 }
  },
  {
    "seq": 16,
    "time": "2026-11-24T08:22:07.334Z",
    "kind": "properties",
    "by": "ward-gateway",
    "data": { "free-beds": 4 }
  }
]
```

| Field  | Value                                                                                                                                                                                                                                                                                                                  |
| :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`  | the number of the row, which only rises, also across restarts                                                                                                                                                                                                                                                          |
| `time` | when the row was written, to the millisecond                                                                                                                                                                                                                                                                           |
| `kind` | one of the kinds below                                                                                                                                                                                                                                                                                                 |
| `by`   | for a request row (`transition`, `event`, `command`, `stop`, `parameters`, `properties`, `peers`, `snapshot`, `whatif`), the [principal](#access-control) that sent it, `script`, or `null` without `auth`; `null` for the rows that the runner writes itself (`start`, `entry`, `exit`, `notice`, `sent`, `shutdown`) |
| `data` | what the row records, by kind                                                                                                                                                                                                                                                                                          |

| Kind         | Written when                                             | `data`                                                                                                                                                |
| :----------- | :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`      | the runner starts                                        | `class`, the `instance` values, the whole `state` it starts with (`machine`, `parameters`, `properties`), the enabled `peers`, and `reinstated`       |
| `transition` | a transition request is handled                          | `state`, and the `reply`                                                                                                                              |
| `event`      | an event request is handled, also one that moves nothing | `event`, `source`, and the `reply`; `peer` and `cause` for a peer's event, `cause` for a parameter's                                                  |
| `command`    | a command is submitted                                   | `name`, its `input` if any, and `run`, the `id` of its run in [GET /history](#get-history), `null` when refused                                       |
| `stop`       | a stop is asked for                                      | `name`, or `null` for every command                                                                                                                   |
| `parameters` | parameters change                                        | the names and the new values                                                                                                                          |
| `properties` | properties change                                        | the names and the new values                                                                                                                          |
| `peers`      | peers are switched                                       | the peer ids and the switches                                                                                                                         |
| `notice`     | a notice of a followed peer arrives                      | `peer`, `kind` (`state` or `presence`), and the notice as `data`                                                                                      |
| `entry`      | the machine enters a state                               | `state`, `entry`, and `cause`, the `seq` of the row that led to it; `null` when no request is in progress and no exit row was written since the start |
| `exit`       | the script of an entry ends                              | `state`, `entry`, `status` (`valid`, `invalid` or `stopped`), and `run`                                                                               |
| `sent`       | a notification goes to MQTT or a webhook                 | `kind`; for a state notification `cause`, the last row that was not `sent`, else the `data` of the notification, without its envelope                 |
| `shutdown`   | the runner begins to shut down                           | `{}`                                                                                                                                                  |
| `snapshot`   | a [save](#post-snapshot) has written its snapshot        | `time`, when the save began, and `name`, the directory of the snapshot                                                                                |
| `whatif`     | a [what-if](#post-whatif) starts its run                 | `name`, its `input` if any, and `run`, the `id` of its run                                                                                            |

- `source` is `client`, `script` for a script that calls with
  `RUNNER_TOKEN`, `peer` for an event of a
  [subscription](#peers), or `parameter` for the event of a parameter.
  Without access control a script has no token, so its events read
  `client`.
- A completion has no event row: the `entry` it leads to names the
  `exit` row as its `cause`.
- Every entry has one `exit` row, also when a stop transition, a later
  entry or a [POST /stop](#post-stop) ended its script, so it may come
  after the next entry. A script that never started, as a shutdown
  began or a later entry came first, is `stopped` with `run` `null`;
  one that could not start is `invalid` with `run` `null`. The exit row
  comes before the state notification of that end.
- A `transition` or `event` row is completed with its `reply` when the
  request has been handled, and a `command` row with its `run`. No row
  changes after that.
- A repeat of an accepted transition or event request with its key
  (a repeat of a refused one is handled again), a property write that
  changes no value, and the end of a command of `POST /`
  make no row; the history holds the end of a command. A repeated
  command request makes a row that names the run of the first, with
  `stored: true` since 0.14.0, as the demo's second `admit` of `p-1`
  with the key `admit-p-1`, whose `data` was `{"name": "admit",
"input": {"patient": "p-1", "ward": "cardiology"}, "run": 3,
"stored": true}`.
  `runner-replay` does not send such a row. A request that joined a
  running command without a key has no mark.
- `sent` rows are written only for a configured transport.
- The `start` row of a runner started with `--reinstate` has
  `reinstated`: the `id`, `time` and `seq` of the
  [snapshot](#snapshots) it came from. Other `start` rows have none.
- A `snapshot` row is written after the copy of the database, so the
  copy ends before it. A `whatif` row is written after its copy is
  made, and a what-if writes no `snapshot` row.

The `input` of a command or a what-if may name a person. Only a `client`, an
`operator`, and every caller without access control, read it; any
other role gets the row without `input`. `manager-1` asking for
`?kind=command` of the same runner got:

```json
[
  {
    "seq": 11,
    "time": "2026-11-24T08:22:05.130Z",
    "kind": "command",
    "by": "alice",
    "data": { "name": "echo-input", "run": 4 }
  },
  {
    "seq": 17,
    "time": "2026-11-24T08:22:12.704Z",
    "kind": "command",
    "by": "alice",
    "data": { "name": "loop", "run": 6 }
  }
]
```

| Parameter | Value                                                                       |
| :-------- | :-------------------------------------------------------------------------- |
| `after`   | a `seq`; only the rows after it, by default `0`                             |
| `since`   | ISO 8601 with `Z` or an offset; only the rows at or after that time         |
| `until`   | ISO 8601 with `Z` or an offset; only the rows before that time              |
| `kind`    | kinds separated by commas, such as `entry,exit`; only rows of these         |
| `limit`   | an integer from 1 to 1000, by default 100; the oldest rows of the selection |
| `count`   | `true` answers `{"count": <rows>}` for the selection, and no rows           |

A reader that wants every row asks again with `after` set to the last
`seq` it has, until the reply is empty. With `?count=true` the same
runner answered `{"count": 18}`. A value that fails, such as
`kind=bogus`, `limit=0`, `after=x` or `since=today`, gets the
validation error of the [Conventions](#conventions), and a `sensor`
gets `403`. As for [GET /history](#get-history), the signature covers
the path without the query, and the `+` of an offset is written `%2B`
in a URL.

There is no limit on the rows. A sensor that changes a value at every
write adds a row at every write, and the database file grows with it.

In a [replay twin](#replay-twins) every row has `at` too, the time
that it stands for, and a row of an input whose request named its
first sender has `origin`: `by`, the principal that sent it to the
twin (`null` for a notice), and `seq`, its `seq` there. Two rows of
the replay twin of the demo, a command of `alice` and the event that a
replayed parameter raised:

```json
[
  {
    "seq": 18,
    "time": "2026-11-24T18:39:10.729Z",
    "kind": "command",
    "by": "replay",
    "data": {
      "name": "admit",
      "input": { "patient": "p-2", "ward": "cardiology" },
      "run": 5
    },
    "at": "2026-11-24T18:38:58.222Z",
    "origin": { "by": "alice", "seq": 22 }
  },
  {
    "seq": 23,
    "time": "2026-11-24T18:39:11.652Z",
    "kind": "event",
    "by": "replay",
    "data": {
      "event": "fidelity-changed",
      "source": "parameter",
      "cause": 22,
      "reply": { "status": "accepted", "state": "open" }
    },
    "at": "2026-11-24T18:39:00.068Z"
  }
]
```

`by` is `replay`, the one principal of the replay twin. The rows that
a runner of an earlier version wrote, and every row of a twin, have
neither field.

## Snapshots

A snapshot is a copy of the DT in a directory: its database, its
configuration, its state machine file, its scripts, and what the save
script of the class wrote. The configuration names the directory in
`snapshots.directory`; without it every route here answers `409`
`no snapshot directory`. A runner started with `--reinstate <snapshot>`
is the DT again ([README](../README.md#saving-and-reinstating)). The
routes are for a `client` and an `operator` ([Roles](#roles)).

The examples come from a runner on port 5317 without access control,
whose class names the save script `save-ward`.

### POST /snapshot

Saves the DT now, into a new directory named by the time in UTC.
MQTT route: `save`, on `<topic>/snapshot/set`, with the same body as
payload. With `{"stop": true}` the runner shuts down after the save;
an empty body, or `{}`, leaves it running.

```bash
curl -s http://localhost:5317/snapshot --json '{}'
```

`201`:

```json
{
  "time": "2026-11-24T12:48:51.220Z",
  "seq": 3,
  "path": "run/ward-1/snapshots/20261124T124851220Z"
}
```

| Field  | Value                                                                    |
| :----- | :----------------------------------------------------------------------- |
| `time` | when the save began, which names the directory                           |
| `seq`  | the last row of the [timeline](#timeline) in the copy of the database    |
| `path` | the directory of the snapshot, from `snapshots.directory` as it is given |

While the save runs, the runner pauses. Every route that would change
the DT is refused with `503`, a `Retry-After` header and the status
`saving`: `POST /`, `POST /stop`, a transition, an event, an
escalation, `PUT /parameters`, `PUT /properties`, `PUT /peers` and a
second save. The reads are answered, and `GET /health` has
`"saving": true`. An event during the save got:

```text
HTTP/1.1 503 Service Unavailable
Retry-After: 1
```

```json
{ "status": "saving" }
```

A script that ends during the save has its completion held, and an
event that a subscription to a peer raises is held with it. Both are
handled in their order once the save ends. After a save with `stop`,
nothing held is handled.

| Case                                                     | Status | Body                                                     |
| :------------------------------------------------------- | :----- | :------------------------------------------------------- |
| The database is in memory                                | 409    | `{"status": "no database"}`                              |
| No `snapshots` section in the configuration              | 409    | `{"status": "no snapshot directory"}`                    |
| A run of the save script is in progress                  | 409    | `{"status": "save script running"}`                      |
| The class names a save script, and `scripts.user` is set | 409    | `{"status": "save script of another account", ...}`      |
| A save runs already                                      | 503    | `{"status": "saving"}`, with `Retry-After`               |
| The save script fails, or runs past `snapshots.timeout`  | 500    | the reply of [POST /](#post-) for that run of the script |
| A body other than `{"stop": <boolean>}`                  | 400    | the [validation error](#conventions)                     |

The `409` for `scripts.user` has a `message` that says what to do
([PRIVILEGE-SETUP.md](../PRIVILEGE-SETUP.md)). A save script that
exited with code 3 gave:

```json
{
  "status": "failed",
  "result": {
    "exitCode": 3,
    "stdout": "",
    "stderr": "no ward",
    "resources": { "cpuSeconds": null, "peakRssBytes": null, "processes": null }
  }
}
```

A save that fails leaves no directory, and the DT goes on, also when
the request had `stop`. A save that succeeds writes a `snapshot` row
to the timeline. The save script has a run in
[GET /history](#get-history) under the caller of the save.

With `stop`, the runner answers `201`, then stops the scripts that
run and shuts down without taking a request again. If the shutdown
fails, the runner logs it and goes on, with its scripts already
stopped.

### GET /snapshot

Lists the snapshots of the directory, oldest first. A directory there
without a readable `snapshot.json` is left out. MQTT route:
`snapshots`, on `<topic>/snapshot`.

```bash
curl -s http://localhost:5317/snapshot
```

`200`:

```json
[
  {
    "time": "2026-11-24T12:48:51.220Z",
    "seq": 3,
    "path": "run/ward-1/snapshots/20261124T124851220Z"
  }
]
```

### DELETE /snapshot/:name

Removes the snapshot of that name, the last part of its `path`. It
has no MQTT route.

```bash
curl -s -X DELETE http://localhost:5317/snapshot/20261124T124851220Z
```

`204`, with no body. A name that is not of a snapshot of the
directory gets `404`:

```json
{ "message": "Not Found", "statusCode": 404 }
```

## What-If

A what-if runs one command of `whatIf.commands` of the state machine
file on a private copy of the DT, and keeps what the command printed
as its result ([WHAT-IF.md](../WHAT-IF.md)). The script gets the
input on stdin, `DT_MODE=what-if` and the copy in `DT_WHATIF_DIR`,
and neither `RUNNER_URL` nor `RUNNER_TOKEN`. Nothing of the DT
changes: [GET /](#get-), the [state document](#get-state) and the
state notifications skip the run. A what-if needs a database file,
`snapshots.directory` and `auth.principals`.

The examples come from a copy of the demo with `hospital-1` alone,
in state `open` after the admissions of `p-1` and `p-2`.

### POST /whatif

Makes the copy, as a [save](#post-snapshot) does, with the same pause,
starts the command on it, and answers `202` with the `id` of the run
in [GET /history](#get-history). The body is that of [POST /](#post-).
MQTT route: `whatif`, on `<topic>/whatif/set`.

```bash
curl -s -X POST http://localhost:5100/whatif \
  -H "Authorization: Bearer $JWS" -H 'Content-Type: application/json' \
  -d '{"name":"forecast-beds","input":{"horizon":"PT2H","steps":[{"at":"PT10M","peer":"hospital-2","online":false}]}}'
```

`202`, signed by `manager-1`:

```json
{ "id": 5, "name": "forecast-beds", "status": "running" }
```

A second request for a command whose what-if runs, also while its
copy is made, gets the same `id`, and its input is ignored.

| Case                                                              | Status | Body                                               |
| :---------------------------------------------------------------- | :----- | :------------------------------------------------- |
| A `client`, and `whatIf.commands` lacks it                        | 400    | `{"status": "invalid command"}`                    |
| A `manager`, and `whatIf.commands` or `manager.commands` lacks it | 403    | `manager may not call whatif`                      |
| The database is in memory                                         | 409    | `{"status": "no database"}`                        |
| No `snapshots.directory`                                          | 409    | `{"status": "no snapshot directory"}`              |
| No `auth.principals`                                              | 409    | `{"status": "no access control"}`                  |
| The command runs live, or starts while the copy is made           | 409    | `{"status": "command running"}`                    |
| A run of the save script is in progress                           | 409    | `{"status": "save script running"}`                |
| The save script runs as [scripts.user][user]                      | 409    | `{"status": "save script of another account"}`     |
| A save is in progress                                             | 503    | `{"status": "saving"}`, with `Retry-After: 1`      |
| The runner shuts down                                             | 503    | `{"status": "shutting down"}`                      |
| The save script fails or passes the timeout                       | 500    | the outcome of the save script, as `POST /` has it |

[user]: ../README.md#script-user

`admit` asked by `alice`, a `client`, got the `400`, and by
`manager-1` the `403`:

```json
{
  "message": "manager may not call whatif",
  "error": "Forbidden",
  "statusCode": 403
}
```

A live request of a command whose what-if runs, by
[POST /](#post-) or MQTT `execute`, with or without input, gets `409`
with `{"status": "what-if running"}`. No refused request makes a copy.

### GET /whatif/:id

The run of that `id`. MQTT route: `whatif-result`, on
`<topic>/whatif` with the payload `{"id": 5}`.

```bash
curl -s http://localhost:5100/whatif/5 -H "Authorization: Bearer $JWS"
```

`200`:

```json
{
  "id": 5,
  "name": "forecast-beds",
  "status": "valid",
  "mode": "what-if",
  "receivedAt": "2026-11-24T13:59:00.000Z",
  "by": "manager-1",
  "exitCode": 0,
  "result": {
    "free-beds": 0,
    "horizon": "PT2H",
    "free-now": 2,
    "admissions-per-hour": 2,
    "state-now": "open",
    "peers-offline-now": [],
    "token": "absent"
  },
  "finishedAt": "2026-11-24T13:59:00.000Z",
  "resources": { "cpuSeconds": 0, "peakRssBytes": 86016, "processes": 1 }
}
```

| Field        | Value                                                                 |
| :----------- | :-------------------------------------------------------------------- |
| `status`     | `running`, then `valid`, `failed`, `stopped` or `interrupted`         |
| `by`         | the caller of the what-if                                             |
| `exitCode`   | as on [GET /](#get-); once ended                                      |
| `result`     | the stdout parsed as JSON, or the text when it is no JSON; once ended |
| `finishedAt` | once ended                                                            |
| `resources`  | as in [GET /history](#get-history); once ended                        |

While the command runs, the reply has `id`, `name`, `status`, `mode`,
`receivedAt` and `by` only. An id that is no what-if, such as that of
a command of `POST /` or of the save run that made a copy, gets `404`
with `{"message": "Not Found", "statusCode": 404}`; an id that is no
integer gets `400` `Validation failed (numeric string is expected)`.
The save run is in [GET /history](#get-history) without `mode`, with
the caller of the what-if.

The end of the run is told by a [what-if notification](#what-if-notifications).
A client or an operator stops a what-if with [POST /stop](#post-stop)
and its name.

## Replay Twins

A replay twin is a runner started with `--reinstate <snapshot>
--what-if`, which `runner-replay` starts to run a twin again from a
snapshot ([REPLAY.md](../REPLAY.md)). Its API is that of any runner,
with five differences:

- It listens on `127.0.0.1` only, connects to no MQTT broker, follows
  no peer and sends no notification; `GET /health` shows
  `"mqtt": "disabled"`.
- [GET /dt](#get-dt) shows `replay`.
- It answers [PUT /peers/:id/notice](#put-peersidnotice).
- The role `operator` may call every route ([Roles](#roles)).
- It takes two headers that name where an input came from, and
  records them as `origin`, with `at` on every row
  ([GET /timeline](#get-timeline)).

| Header       | Value                                                            | Needed                |
| :----------- | :--------------------------------------------------------------- | :-------------------- |
| `Replay-Seq` | the `seq` that the input had in the twin, a whole number above 0 | with either header    |
| `Replay-By`  | the principal that sent it to the twin, a name                   | no; `null` without it |

The headers are a label that the tool sets, not a credential: the
request is signed by the principal of the replay twin, and the headers
are not part of the signature. A runner that is no replay twin ignores
them. A replay twin checks them after the signature, and refuses a
malformed header with `400` and a message that names it and what it
must be:

```json
{
  "message": ["Replay-Seq must be a whole number above 0, not \"x\""],
  "error": "Bad Request",
  "statusCode": 400
}
```

Other headers, as a replay twin of the demo answered them:

- `Replay-By: alice` alone: `Replay-Seq is missing: Replay-By needs
it, a whole number above 0`;
- `Replay-By: a b`: `Replay-By must be the name of a principal, up to
64 letters, digits, _, . or -, from a letter, not "a b"`;
- `Replay-Seq` twice, `3` and `4`: `Replay-Seq must be a whole number
above 0, not "3, 4"`, as Node joins the two values.

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

## Access Control

Without `auth.principals` in the configuration, every route is open
to anyone who reaches the port or the request topics, also with an
`auth` section that holds only a [key](#signatures). With principals,
the runner answers only the principals it lists, each in a role, and its
own scripts:

```yaml
auth:
  principals:
    - name: manager-1
      role: manager
      publicKey: 'mCpoaytWvGJ9K0lxNlSNw6sjUG7UezRWtxPvL1pyxKA'
    - name: alice
      role: client
      publicKey: 'o-YAagcjoyUxT2xcgULS22sCK6N_cJ-op8Jh7yukXMk'
    - name: ward-gateway
      role: sensor
      publicKey: 'EPaCWNX3g6JgjqMMM1MUR-9sAKYZh-1fbF9Z9ATpgho'
```

`role` is `manager`, `client` or `sensor`. `publicKey` is an Ed25519
public key as the base64url of its 32 raw bytes, the `x` of its JWK
(RFC 8037); the caller keeps the private key.
The demo's [tools/keygen.mjs](../demo/hospital/tools/keygen.mjs) writes
a key pair, `NAME.key` in PKCS#8 PEM and `NAME.pub` in this encoding.
`GET /health` and MQTT `health` stay open. The runner logs each
accepted request with its principal at `debug` level, and stores the
principal of each command in its history database: the name, `script`,
or nothing without `auth`, also for the script of a state.

The same section may hold a `key` instead of, or besides, the
principals: the private key with which the runner signs its output
(see [Signatures](#signatures)). The section needs one of the two.

### Token

An HTTP request carries `Authorization: Bearer <token>`, a compact JWS
(RFC 7515) that the caller signs for that one request:

- Header: `{"alg":"Ed25519","kid":"<principal>"}`. `alg` is the fully
  specified name of RFC 9864; any other, `EdDSA` and `none` included,
  is refused.
- `aud`: the DT's `id`. `iat` and `exp`: seconds, `exp` after `iat` by
  60 s at most; the runner allows 30 s of clock skew either way.
- `jti`: random, of 16 to 64 characters. The runner refuses a `jti` it
  accepted before, until the token can no longer be valid, and forgets
  them at a restart.
- `htm`: the method. `htu`: the path, without host or query, as the
  runner receives it, or behind a prefix that a gateway strips, such
  as `/user1/runner/fsm/event` for `/fsm/event`.
- `bh`: the base64url SHA-256 of the exact body bytes sent; of the
  empty string without a body.

`alice` raising `close` sends these claims:

```json
{
  "aud": "hospital-1",
  "iat": 1793005516,
  "exp": 1793005546,
  "jti": "4Yprdk_SIrCcAYAPD-gPtQ",
  "htm": "POST",
  "htu": "/fsm/event",
  "bh": "vMxsLojiWijWYxqt3cB8LD75hzg-qHd9LKzoVarHsRg"
}
```

`bh` hashes the bytes of the body, here `{"event":"close"}`:

```bash
printf '%s' '{"event":"close"}' | openssl dgst -sha256 -binary |
  basenc --base64url | tr -d '='
```

In Node, with `node:crypto` alone:

```js
import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const key = createPrivateKey(readFileSync('alice.key'));
const part = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export function authorization(method, path, body = '') {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    aud: 'hospital-1',
    iat,
    exp: iat + 30,
    jti: randomBytes(16).toString('base64url'),
    htm: method,
    htu: path,
    bh: createHash('sha256').update(body).digest('base64url'),
  };
  const input = `${part({ alg: 'Ed25519', kid: 'alice' })}.${part(claims)}`;
  const signature = sign(null, Buffer.from(input), key).toString('base64url');
  return `Bearer ${input}.${signature}`;
}
```

The `Idempotency-Key` header is not signed, as `jti` already stops a
replay. Over MQTT the token is the request payload itself; see
[MQTT Access Control](#mqtt-access-control).

### Roles

A `client` may call every route, and a `manager` reads, sets
parameters, enables and disables peers and runs the `manager.commands`
of the state machine file. A manager tunes the parameters; it may read
the properties but not write them, as they are what the DT observes.
A `sensor` feeds property values from outside the runner, such as a
gateway of the physical twin: it reads and writes the properties and
calls nothing else.
An `operator` runs the runner: it reads, stops commands, saves,
lists and removes [snapshots](#snapshots), and reads the result of a
[what-if](#what-if); it steers nothing and asks for no what-if. A
manager can not copy the DT, and asks for a what-if only of a command
that `whatIf.commands` and `manager.commands` both list.
The runner's own scripts send `Authorization: Bearer $RUNNER_TOKEN`
(see [Calls From Scripts](#calls-from-scripts)) and act in the role
`script`. A principal's token is accepted from a script too, in the
principal's role.

| HTTP                   | MQTT route        | client | operator | manager            | script | sensor |
| :--------------------- | :---------------- | :----- | :------- | :----------------- | :----- | :----- |
| `GET /health`          | `health`          | open   | open     | open               | open   | open   |
| `GET /dt`              | `dt`              | yes    | yes      | yes                | yes    | no     |
| `GET /state`           | `state`           | yes    | yes      | yes                | yes    | no     |
| `GET /`                | `status`          | yes    | yes      | yes                | yes    | no     |
| `GET /history`         | `history`         | yes    | yes      | yes                | yes    | no     |
| `GET /metrics`         | `metrics`         | yes    | yes      | yes                | yes    | no     |
| `GET /fsm`             | `fsm`             | yes    | yes      | yes                | yes    | no     |
| `GET /parameters`      | `parameters`      | yes    | yes      | yes                | yes    | no     |
| `POST /`               | `execute`         | yes    | no       | `manager.commands` | no     | no     |
| `POST /stop`           | `stop`            | yes    | yes      | no                 | no     | no     |
| `POST /fsm/transition` | `transition`      | yes    | no       | no                 | no     | no     |
| `POST /fsm/event`      | `event`           | yes    | no       | no                 | yes    | no     |
| `POST /escalate`       | `escalate`        | yes    | no       | no                 | yes    | no     |
| `PUT /parameters`      | `set-parameters`  | yes    | no       | yes                | no     | no     |
| `GET /properties`      | `properties`      | yes    | yes      | yes                | yes    | yes    |
| `PUT /properties`      | `set-properties`  | yes    | no       | no                 | yes    | yes    |
| `GET /peers`           | `peers`           | yes    | yes      | yes                | yes    | no     |
| `PUT /peers`           | `set-peers`       | yes    | no       | yes                | no     | no     |
| `GET /timeline`        | `timeline`        | yes    | yes      | yes                | yes    | no     |
| `GET /snapshot`        | `snapshots`       | yes    | yes      | no                 | no     | no     |
| `POST /snapshot`       | `save`            | yes    | yes      | no                 | no     | no     |
| `DELETE /snapshot/<n>` | `delete-snapshot` | yes    | yes      | no                 | no     | no     |
| `POST /whatif`         | `whatif`          | yes    | no       | both lists         | no     | no     |
| `GET /whatif/<id>`     | `whatif-result`   | yes    | yes      | yes                | no     | no     |

A `manager` and a `script` read the [timeline](#timeline) without the
`input` of a command, which only a `client` and an `operator` see.

The route names are those of the 403 message, over HTTP and MQTT
alike, whatever the topic: a manager that writes a property gets
`manager may not call set-properties`. `delete-snapshot` is a
route of HTTP alone. An operator that asks for a transition gets
`operator may not call transition`.

In a [replay twin](#replay-twins) the role `operator` may call every
route, as `runner-replay` sends every input of the twin as one
principal of that role, and `PUT /peers/<id>/notice` is open to the
`operator` alone. The other roles keep the rows above, and get `403`
for the notice route.

### Errors

A refusal has the body of a Nest error, over MQTT too. No message
before the signature check tells whether a name is listed.

| Case                                                    | Status | `message`                               |
| :------------------------------------------------------ | :----- | :-------------------------------------- |
| No header, or an empty MQTT payload or one with `{`     | 401    | `missing credential`                    |
| Not `Bearer`, not three base64url parts, not JSON       | 401    | `malformed credential`                  |
| `alg` not `Ed25519`, unknown `kid`, bad signature/token | 401    | `invalid credential`                    |
| `aud` not this DT, claims missing or of the wrong type  | 401    | `invalid claims`                        |
| Expired, issued in the future, or `exp - iat` over 60 s | 401    | `expired credential`                    |
| `htm`, `htu`, `bh` or `topic` differs from the request  | 401    | `credential does not match the request` |
| `jti` seen before                                       | 401    | `replayed credential`                   |
| Role refused, or a manager command not listed           | 403    | `<role> may not call <route>`           |

A bearer without a dot is taken for the script token, so a wrong one
is `invalid credential`; an MQTT payload that is neither empty nor
starts with `{` is read as a JWS, and is `malformed credential` if it
is not one.

A manager that runs `open` of the demo gets:

```json
{
  "message": "manager may not call execute",
  "error": "Forbidden",
  "statusCode": 403
}
```

The 413 of an oversized body comes first; 401 and 403 come before the
validation error.

## MQTT

With an `mqtt` section in the configuration, the runner connects to the
broker, subscribes with QoS 1 to one request topic per route and to
the notifications of its [peers](#peers), and publishes the
[notifications](#notifications).

### Request Topics

A request is published on the topic of its route, with the JSON of the
matching HTTP request body as payload. The routes that read take no
payload, and the runner ignores any, except `history` and `timeline`,
whose payload is their query.

| Request topic            | HTTP                   | Payload                               |
| :----------------------- | :--------------------- | :------------------------------------ |
| `<topic>/execute`        | `POST /`               | `{"name": "<command>", "input": {}}`  |
| `<topic>/status`         | `GET /`                | none                                  |
| `<topic>/history`        | `GET /history`         | `{"since": "<time>", "limit": 10}`    |
| `<topic>/stop`           | `POST /stop`           | `{"name": "<command>"}`, `{}` or none |
| `<topic>/transition`     | `POST /fsm/transition` | `{"state": "<state>"}`                |
| `<topic>/event`          | `POST /fsm/event`      | `{"event": "<event>"}`                |
| `<topic>/fsm`            | `GET /fsm`             | none                                  |
| `<topic>/dt`             | `GET /dt`              | none                                  |
| `<topic>/state`          | `GET /state`           | none                                  |
| `<topic>/health`         | `GET /health`          | none                                  |
| `<topic>/parameters`     | `GET /parameters`      | none                                  |
| `<topic>/parameters/set` | `PUT /parameters`      | `{"<name>": <value>}`                 |
| `<topic>/properties`     | `GET /properties`      | none                                  |
| `<topic>/properties/set` | `PUT /properties`      | `{"<name>": <value>}`                 |
| `<topic>/escalate`       | `POST /escalate`       | `{"reason": "<reason>"}`              |
| `<topic>/peers`          | `GET /peers`           | none                                  |
| `<topic>/peers/set`      | `PUT /peers`           | `{"<peer id>": <boolean>}`            |
| `<topic>/metrics`        | `GET /metrics`         | none                                  |
| `<topic>/timeline`       | `GET /timeline`        | `{"kind": "command"}`                 |
| `<topic>/snapshot`       | `GET /snapshot`        | none                                  |
| `<topic>/snapshot/set`   | `POST /snapshot`       | `{"stop": true}`, `{}` or none        |
| `<topic>/whatif/set`     | `POST /whatif`         | `{"name": "<command>", "input": {}}`  |
| `<topic>/whatif`         | `GET /whatif/<id>`     | `{"id": 5}`                           |

The topic of a route is `<topic>/<route>`, except for the three routes
that write a resource. Their topic is one level under the topic that
reads the resource, so that one resource is one subtree, which a
broker can grant as a whole, such as `<topic>/properties/#` to a
sensor:

| Resource   | Read                 | Write                    | Write before 0.11, removed in 0.12.0 |
| :--------- | :------------------- | :----------------------- | :----------------------------------- |
| parameters | `<topic>/parameters` | `<topic>/parameters/set` | `<topic>/set-parameters`             |
| properties | `<topic>/properties` | `<topic>/properties/set` | none                                 |
| peers      | `<topic>/peers`      | `<topic>/peers/set`      | `<topic>/set-peers`                  |

- Version 0.11 still answered the write topics of before 0.11, with a
  warning. Version 0.12.0 removes them: the runner does not subscribe
  to them, and a request on one gets no answer. There never was a
  `set-properties` topic.

- The names `set` and `response` are reserved, as a write topic and a
  default response topic sit under the read topic: the runner refuses
  at startup a parameter, a property or a peer id of either name.
- The route names do not change: `set-parameters`, `set-properties`
  and `set-peers` in the [role table](#roles), in a 403 message and in
  this document.
- The snapshots take the same form: `<topic>/snapshot` lists them
  (route `snapshots`) and `<topic>/snapshot/set` saves (route `save`).
  The replies are those of HTTP, and a change refused during a save
  gets `{"status": "saving"}`. No topic removes a snapshot.
- So do the what-ifs: `<topic>/whatif/set` asks for one (route
  `whatif`) and `<topic>/whatif` reads its result (route
  `whatif-result`). The demo's `mq1 whatif/set` got
  `{"id": 8, "name": "forecast-beds", "status": "running"}` on
  `<topic>/whatif/set/response`, and `mq1 whatif '{"id":8}'` the run on
  `<topic>/whatif/response`.

### Responses

The response payload is the JSON body of the matching HTTP reply, or
with `auth.key` a JWS of it (see [Signatures](#signatures)). MQTT
has no status codes, so the payload alone tells the outcome, through
its `status` field or the `statusCode` of an error. The runner
publishes each response with QoS 1:

- to the response topic of an MQTT 5 request, with its correlation
  data, when the request has a response topic;
- otherwise to the request topic followed by `/response`, such as
  `<topic>/execute/response`, or `<topic>/parameters/set/response` for
  a write.

The default response topic of a write is thus two levels under its
resource, and a subscription to `<topic>/+/response` does not match
it. A client that writes subscribes to `<topic>/+/set/response` as
well, or gives an MQTT 5 response topic of its own. A response to a
request on an old write topic goes to that topic followed by
`/response`, as before.

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

In the demo, `mq1 dt` subscribes to `dtaas/hospital-1/dt/response`,
publishes a signed payload on `dtaas/hospital-1/dt`, and prints the
response topic, whether the payload is `verified`, `UNSIGNED` or
`INVALID` (see [Signatures](#signatures)), and the payload, here the
body of [GET /dt](#get-dt). The demo shows the line of its `publicKey`
beside the key file with which the tools verified the response:

```text
dtaas/hospital-1/dt/response (verified)
  "publicKey": "NC6o1XrrDbF0Kta1gISss-R6v1IgC8zg0OUOWy7Jr3Y"
NC6o1XrrDbF0Kta1gISss-R6v1IgC8zg0OUOWy7Jr3Y
```

The Manager discharges `p-1` over MQTT, with input:

```bash
mq1 execute '{"name":"discharge","input":{"patient":"p-1"}}'
```

```text
dtaas/hospital-1/execute/response (verified)
{
  "status": "success",
  "result": {
    "exitCode": 0,
    "stdout": "p-1 left cardiology\r\nraised event beds-free, reply 202",
    "stderr": "",
    "resources": { "cpuSeconds": null, "peakRssBytes": null, "processes": null }
  }
}
```

`discharge.ps1` raised `beds-free`, which moved the machine from `full`
back to `open`, as `mq1 fsm` shows:

```text
dtaas/hospital-1/fsm/response (verified)
{
  "state": "open",
  "status": "running",
  "entry": 6,
  "events": [
    "beds-free",
    "close",
    "fidelity-changed",
    "full",
    "neighbour-down",
    "neighbour-full",
    "reopen",
    "scope-changed"
  ]
}
```

The same requests with the
[Mosquitto clients](https://mosquitto.org/download/), for a runner
without `auth.principals`; with them, each payload is the JWS that
`node tools/sign.mjs mqtt ROUTE JSON` prints (see
[MQTT Access Control](#mqtt-access-control)):

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

### MQTT Access Control

With `auth.principals`, the payload of every request but `health` is a
compact JWS, signed as for HTTP (see [Token](#token)), whose claims are
`aud`, `iat`, `exp`, `jti`, `topic`, the request topic, and `body`, the
JSON of the plain request, absent for a route without one. The runner
verifies the token, compares `topic` with the topic the request came
on, and handles `body` as it handles a plain payload. This works over
MQTT 3.1.1 and MQTT 5 alike. The Manager's `execute` of the demo, as
claims:

```json
{
  "aud": "hospital-1",
  "iat": 1793005596,
  "exp": 1793005626,
  "jti": "Zq0m3Xb7c9WkLr2PfYt8sQ",
  "topic": "dtaas/hospital-1/execute",
  "body": { "name": "discharge", "input": { "patient": "p-1" } }
}
```

A plain payload gets the `401` body `missing credential`, and a refused
credential or role its [error](#errors) body, on the response topic as
any response. The request key stays an MQTT 5 user property. The
demo's [tools/sign.mjs](../demo/hospital/tools/sign.mjs) prints such a
payload: `node tools/sign.mjs mqtt execute '<json>'`.

The broker's access control remains the outer wall: `auth` decides who
may act, the broker who may publish on the request topics and read the
responses and notifications at all, and which topics the runner may
publish on. Without `auth.principals`, anyone who can publish on the
request topics can run the permitted commands. Use `mqtts://` or `wss://` with
a username and password when the broker is not on the same computer.

## Notifications

The runner tells what happens without being asked. Each notification
is one JSON object, or with `auth.key` a JWS of it
(see [Signatures](#signatures)):

| Field  | Meaning                                                    |
| :----- | :--------------------------------------------------------- |
| `kind` | `state`, `escalation`, `presence` or `whatif`              |
| `id`   | the identity of the DT                                     |
| `time` | the time of the notification; `null` only in the MQTT will |
| `data` | the content, which depends on `kind`                       |

The payloads below are those that the subscriber of the demo received
in the recording, each a JWS that it verified with the public key of
its DT, shown decoded. The recording's network pane shows each
notification as a one-line summary only.

### State Notifications

The runner sends its [state document](#get-state) whenever the
document changes: when the machine enters a state, when the script of
a state finishes, when a command starts or finishes, when a parameter
changes, when a [property](#properties) is written, and once at
startup. A document that differs from the last one sent only in its
`time` is not sent again. `data` is the document, and `id` and `time`
are its own.

A property may be written many times a second, so the runner holds a
document whose only change is in property values, or in their times,
until `stateInterval` milliseconds after the last state notification
it sent. `stateInterval` is a key of the configuration: a whole
number, `0` or more, and `1000` without the key. A fast feed thus
gives one notification per interval, with the values of that moment.
A change of the machine, the parameters or the command is never held:
it is sent at once and carries the property values that were waiting.
A document still held at shutdown is not sent.

The first notification of the demo, at the startup of `hospital-1`:

```json
{
  "kind": "state",
  "id": "hospital-1",
  "time": "2026-10-27T19:19:16.975Z",
  "data": {
    "id": "hospital-1",
    "time": "2026-10-27T19:19:16.975Z",
    "machine": {
      "state": null,
      "status": "none",
      "entry": 0,
      "events": [
        "beds-free",
        "close",
        "fidelity-changed",
        "full",
        "neighbour-down",
        "neighbour-full",
        "reopen",
        "scope-changed"
      ]
    },
    "parameters": { "scope": "single", "capacity": 2, "fidelity": "medium" },
    "command": null
  }
}
```

The stop of `open` gives this sequence of documents, shown here by
`machine` and `command` only:

| `machine`              | `command`           |
| :--------------------- | :------------------ |
| `open` #8, `running`   | `open`, `stopped`   |
| `open` #8, `stopped`   | `open`, `stopped`   |
| `closed` #9, `running` | `closed`, `running` |
| `closed` #9, `running` | `closed`, `valid`   |
| `closed` #9, `valid`   | `closed`, `valid`   |

### Escalation Notifications

| `data` field | Meaning                                                                                         |
| :----------- | :---------------------------------------------------------------------------------------------- |
| `trigger`    | `request` (`POST /escalate`), `failure` (`onFailure`) or `no-transition` (`onNoTransition`)     |
| `state`      | the state when the escalation happened; `null` without a machine or before its first transition |
| `entry`      | the entry of that state; `0` without a machine or before its first transition                   |
| `event`      | the event that had no transition, for `no-transition`; else `null`                              |
| `reason`     | the reason of the request, or the runner's own text                                             |
| `proposal`   | the proposal of the request, else `null`                                                        |

`hospital-1` escalates three times. `admit.ps1` asks for scope `multi`:

```json
{
  "kind": "escalation",
  "id": "hospital-1",
  "time": "2026-10-27T19:20:18.670Z",
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

The script of `full` fails, as `hospital-2` is full too, and `full` has
no `$failure` transition:

```json
{
  "kind": "escalation",
  "id": "hospital-1",
  "time": "2026-10-27T19:21:10.496Z",
  "data": {
    "trigger": "failure",
    "state": "full",
    "entry": 5,
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
  "time": "2026-10-27T19:21:14.605Z",
  "data": {
    "trigger": "no-transition",
    "state": "full",
    "entry": 5,
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
  "time": "2026-10-27T19:19:17.081Z",
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
      "class": { "id": "urn:dtaas:demo:hospital", "version": "1.0.0" },
      "stateMachine": true,
      "manager": { "commands": ["admit", "discharge"] },
      "peers": ["hospital-2"],
      "publicKey": "NC6o1XrrDbF0Kta1gISss-R6v1IgC8zg0OUOWy7Jr3Y"
    }
  }
}
```

The offline notice, at a graceful shutdown:

```json
{
  "kind": "presence",
  "id": "hospital-1",
  "time": "2026-10-27T19:22:09.109Z",
  "data": { "online": false }
}
```

Over MQTT, the runner also connects with a will on the presence topic:
the offline notice with `"time": null`, as the will is fixed when the
runner connects. The broker publishes the will only when the runner
disappears without leaving: a crash, a kill or a lost connection. The
demo kills the runner of `hospital-2`, and the broker publishes its
will, signed when the runner connected:

```json
{
  "kind": "presence",
  "id": "hospital-2",
  "time": null,
  "data": { "online": false }
}
```

At shutdown, the runner publishes the offline notice and disconnects
gracefully, so that the broker drops the will. Each step waits at most
2 s. When the broker does not confirm, the runner closes the connection
and logs a warning; the broker may then publish the will, which still
says offline.

### What-If Notifications

When a [what-if](#what-if) has ended and its copy is gone, the runner
sends a notification of kind `whatif`, with the `id`, `name`,
`status`, `exitCode` and `result` of the run, as
[GET /whatif/:id](#get-whatifid) shows them. From the copy of the demo
with `hospital-1` alone:

```json
{
  "kind": "whatif",
  "id": "hospital-1",
  "time": "2026-11-24T13:59:00.433Z",
  "data": {
    "id": 5,
    "name": "forecast-beds",
    "status": "valid",
    "exitCode": 0,
    "result": {
      "free-beds": 0,
      "horizon": "PT2H",
      "free-now": 2,
      "admissions-per-hour": 2,
      "state-now": "open",
      "peers-offline-now": [],
      "token": "absent"
    }
  }
}
```

A what-if that [POST /stop](#post-stop) stopped sends one with
`"status": "stopped"`, `"exitCode": null` and `"result": ""`. A
what-if that the shutdown stopped sends none. The subscriber of the
demo summarised it as:

```text
13:59:00 hospital-1 verified whatif forecast-beds run 5 valid: free-beds=0 in PT2H
```

### Over MQTT

The runner publishes each notification with QoS 1 on
`<topic>/notify/<kind>`:

| Topic                       | Retained | Why                                                        |
| :-------------------------- | :------- | :--------------------------------------------------------- |
| `<topic>/notify/state`      | yes      | a Manager that subscribes later gets the current state     |
| `<topic>/notify/presence`   | yes      | a Manager that subscribes later knows whether the DT is up |
| `<topic>/notify/escalation` | no       | a Manager that subscribes later does not act on an old one |
| `<topic>/notify/whatif`     | no       | the Manager that asked reads the result on request too     |

The online notice is published each time the runner connects, the first
time and after each reconnect. The notification topics are two levels
under the base topic, so `<topic>/+/response` does not match them; the
demo's subscriber takes those of every DT with `dtaas/+/notify/+`:

```bash
mosquitto_sub -h 127.0.0.1 -p 18830 -v -t 'dtaas/+/notify/+'
```

While the broker is unreachable, the runner queues the notifications in
memory and publishes them in order when it connects again.

In the demo, `mq retained` subscribes after the shutdown of
`hospital-1`. It gets the retained state and presence of both DTs, the
will of `hospital-2` among them, and no escalation:

```text
retained 19:22:04 hospital-1 verified closed#9 valid | closed:valid | scope=multi fidelity=high
retained 19:22:09 hospital-1 verified offline
retained 19:20:54 hospital-2 verified full#2 valid | full:valid | scope=single fidelity=medium
retained --:--:-- hospital-2 verified offline (the will)
```

### Over a Webhook

With a `relationships.manager.notify.url` in the configuration, the
runner posts each notification to it as `application/json`, or with
`auth.key` as `application/jose`, the media type of a compact JWS
(RFC 7515), with a 5 s timeout. The `token` of the same section, sent
as a bearer, authenticates the runner to the webhook; the signature
lets the receiver check every body, including those it stores or
forwards. It
retries after 1 s, 2 s and 4 s on a network error, a timeout or a `5xx`
reply, and not on any other reply. Posts are independent, so they may
arrive out of order; a receiver that needs a strict order uses MQTT. A
failure is logged once, with the host of the webhook only, until a post
succeeds again.

The webhook gets the online notice once at startup, not on a
reconnect, and the offline notice once at shutdown; the will goes over
MQTT only. At shutdown the runner abandons the posts still in progress
or waiting for a retry. Both runners of the demo post to one receiver,
which logged the notifications other than state documents, before the
shutdown, as below, each verified with the key of the DT that the
payload names:

```text
POST 19:19:16 hospital-1 verified online, peers hospital-2
POST 19:19:21 hospital-2 verified online, peers hospital-1
POST 19:20:18 hospital-1 verified escalation request open#1: no cardiology bed for p-3 {"scope":"multi"}
POST 19:21:10 hospital-1 verified escalation failure full#5: script of state full failed
POST 19:21:14 hospital-1 verified escalation no-transition full#5: no transition for close in state full
```

### Signatures

With `key` in the `auth` section, the runner signs everything it sends
on its own or in reply with a private key of the DT, so that a
receiver that holds the public key can check origin and integrity:

```yaml
auth:
  # an Ed25519 private key, PEM PKCS#8, relative to this file
  key: 'keys/hospital-1.key'
```

The path is taken from the directory of the configuration file, and an
absolute path works too. `keygen.mjs hospital-1 keys` writes the key
and its public key, `keys/hospital-1.pub`. A file that cannot be read,
an encrypted key, or a key that is not an Ed25519 private key stops
the runner at startup with an error that names the file.

| Output                        | Without `auth.key`      | With `auth.key`                |
| :---------------------------- | :---------------------- | :----------------------------- |
| Notifications, MQTT           | JSON envelope           | JWS of the envelope            |
| Notifications, webhook        | `application/json` body | `application/jose` body, a JWS |
| MQTT responses                | JSON body of the reply  | JWS of the body                |
| MQTT will (`notify/presence`) | JSON, `time: null`      | JWS, `time: null`              |
| HTTP replies                  | JSON                    | JSON, unsigned                 |

Each is a compact JWS (RFC 7515) whose payload is exactly the JSON
without a key. Its protected header is
`{"alg":"Ed25519","kid":"<id>"}`: `alg` is the fully specified name of
RFC 9864, as in a [token](#token), and `kid` the `id` of the DT. No
claim is added: the `id` and `time` of the envelope bind it to the DT
and the moment, and there is no `exp`, as a retained notification must
stay verifiable for a Manager that connects hours later. The will
keeps `time: null`; it is signed once, when the runner connects.
Ed25519 is deterministic, so a notification gives the same JWS over
MQTT and the webhook.

The first state notification of
[State Notifications](#state-notifications) is published on
`dtaas/hospital-1/notify/state` as one line,
`<header>.<payload>.<signature>`, here broken before each dot and with
`[…]` for the omitted characters:

```text
eyJhbGciOiJFZDI1NTE5Iiwia2lkIjoiaG9zcGl0YWwtMSJ9
.eyJraW5kIjoic3RhdGUiLCJpZCI6Imhvc3BpdGFs[…]NvbW1hbmQiOm51bGx9fQ
.UufoNbhIlLc0ZHmzH1wb[…]
```

The header decodes to `{"alg":"Ed25519","kid":"hospital-1"}`, and the
payload, 502 characters, to the envelope unchanged. The signature is
86 base64url characters, the 64 bytes of Ed25519. The document grows
from 376 to 638 bytes.

A consumer verifies with the public key its operator gave it, as
`publicKey` of [GET /dt](#get-dt) gives it: the base64url of the 32 raw
bytes, the `x` of the JWK. In Node, `key` is
`createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })`:

```js
import { verify } from 'node:crypto';

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url'));

export function unwrap(text, key, id) {
  const [header, payload, signature, ...rest] = text.split('.');
  const { alg, kid } = decode(header);
  const signed = Buffer.from(`${header}.${payload}`);
  const bytes = Buffer.from(signature ?? '', 'base64url');
  const ok = verify(null, signed, key, bytes);
  if (rest.length > 0 || alg !== 'Ed25519' || kid !== id || !ok) {
    throw new Error('not verified');
  }
  return decode(payload);
}
```

A payload that parses as JSON is plain JSON from a runner without a
key: a notification starts with `{`, and a response may also be an
array, such as that of `history`. A JWS never parses as JSON. Whether
to accept a plain payload is the consumer's choice. The demo's
[tools/jws.mjs](../demo/hospital/tools/jws.mjs) marks each message
`verified`, `UNSIGNED`, or `INVALID` with the reason: no key file, an
unreadable key file, a malformed JWS, a wrong `alg` or `kid`, or a bad
signature. It prints an `INVALID` payload as it came, marked
unverified, so that a refusal of a signed runner still shows.

Not signed, with the reason:

- HTTP replies: the caller chose the endpoint, TLS and the DTaaS
  gateway protect the reply, and [access control](#access-control)
  authenticates the caller.
- Freshness: a signature proves origin and integrity, not that a
  message is new. Anyone who can publish on the notification topics
  can replay an old signed document or will; the access control of the
  broker limits that, and a receiver that must not go back in time
  compares `time` with that of the last message it took.
  The will in particular has no time to compare: it keeps
  `time: null`, so a captured will stays valid for as long as the
  key does.
- More than one key: a new key is a restart, and a new public key for
  every receiver.

A plain notification retained from an earlier run without a key and a
signed one share a topic. The runner publishes its online notice on
every connect and its state document at startup, so both retained
topics are replaced as soon as it connects; a receiver that requires
signatures drops the plain one it may get first, and waits.

Without MQTT and a webhook, [GET /state](#get-state) is the only way to
observe the state, and nothing is announced.

## Calls From Scripts

Scripts are clients of the API too. The runner gives each script its
own address and the context of the DT in environment variables.

### Script Environment

| Variable          | Value in the demo, in state `open` at entry 1                              |
| :---------------- | :------------------------------------------------------------------------- |
| `RUNNER_URL`      | `http://127.0.0.1:5100`                                                    |
| `RUNNER_TOKEN`    | the bearer token, with `auth.principals` only                              |
| `DT_ID`           | `hospital-1`                                                               |
| `DT_STATE`        | `open`; empty before the first transition                                  |
| `DT_ENTRY`        | `1`                                                                        |
| `DT_PARAM_<NAME>` | `DT_PARAM_SCOPE=single`, `DT_PARAM_CAPACITY=2`, `DT_PARAM_FIDELITY=medium` |
| `DT_MODE`         | `live`; `what-if` for the command of a [what-if](#what-if)                 |
| `DT_WHATIF_DIR`   | the copy of the DT, for the command of a what-if only                      |
| `DT_REPLAY_OF`    | in a [replay twin](#replay-twins) only: `hospital-1`, the twin             |
| `DT_TIME_SCALE`   | in a replay twin only: the factor of `--time-scale`, such as `2`           |

The command of a what-if gets neither `RUNNER_URL` nor `RUNNER_TOKEN`,
so it calls no route. Every script of a replay twin gets
`DT_MODE=what-if`, `DT_REPLAY_OF` and `DT_TIME_SCALE`, and calls the
routes of the replay twin; its `DT_ID` is `hospital-1.replay`.

Without a state machine, `DT_STATE` and `DT_ENTRY` are absent. There
is no variable for a [property](#properties): a script reads
`GET $RUNNER_URL/properties`. The
variables under `env` in the state machine file come too, such as
`POLL_MS=500` of `open`. The script of `open` logged:

```text
19:19:46 open   DT_ID=hospital-1 DT_STATE=open DT_ENTRY=1
19:19:46 open   DT_PARAM_SCOPE=single DT_PARAM_CAPACITY=2 POLL_MS=500
19:19:46 open   HINT=hospital-1/open#1 scope=single RUNNER_URL=http://127.0.0.1:5100
19:19:46 open   fidelity medium: beds sampled every 500 ms
19:19:47 open   overflow to hospital-2 at 12.4 km
```

The last line comes from a call of `GET $RUNNER_URL/peers`: a script
may read the routes that the role `script` may call (see
[Roles](#roles)).

### Raise an Event or Escalate

A script raises an event with `POST $RUNNER_URL/fsm/event` and
escalates with `POST $RUNNER_URL/escalate`, with the header
`Authorization: Bearer $RUNNER_TOKEN`. `RUNNER_TOKEN` is drawn at each
start of the runner, and a script that sends it acts in the role
`script` (see [Roles](#roles)). Without `auth.principals` the variable is unset
and the runner ignores the header, so a script may always send it. The
token is for HTTP only. The demo scripts use this PowerShell helper,
from [scripts/ward.ps1](../demo/hospital/scripts/ward.ps1):

```powershell
# RUNNER_TOKEN is unset without access control, and the header ignored
$RunnerHeaders = @{ Authorization = "Bearer $env:RUNNER_TOKEN" }

function Send-Runner($path, $body) {
  try {
    Invoke-RestMethod -Method Post -Uri "$env:RUNNER_URL/$path" -Headers $RunnerHeaders `
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
  -H "Authorization: Bearer $RUNNER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"event": "full"}'
curl -s -X POST "$RUNNER_URL/escalate" \
  -H "Authorization: Bearer $RUNNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason": "no cardiology bed for p-3", "proposal": {"scope": "multi"}}'
```

An event that a script raises is like any other: the machine follows
the transition of its current state for it, even while the script that
raised it still runs.

### Write a Property

A script writes [property](#properties) values with
`PUT $RUNNER_URL/properties` and the same header, in the role
`script`. `open.ps1` of the demo writes the number of free beds when
it changes, with this helper of
[scripts/ward.ps1](../demo/hospital/scripts/ward.ps1):

```powershell
function Send-FreeBeds($free) {
  try {
    Invoke-RestMethod -Method Put -Uri "$env:RUNNER_URL/properties" -Headers $RunnerHeaders `
      -ContentType 'application/json' -Body (@{ 'free-beds' = $free } | ConvertTo-Json -Compress) | Out-Null
  } catch { Write-WardLog "open   free-beds not written: $($_.Exception.Message)" }
}
```

A write that fails is only logged, as the next sample writes again. In
a shell script on Linux:

```bash
curl -s -X PUT "$RUNNER_URL/properties" \
  -H "Authorization: Bearer $RUNNER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"free-beds": 3}'
```

## Example Session

The recording, in order, as requests and what they did. Times are
those of the markers in
[demo-windows-manager.cast](../demo/hospital/demo-windows-manager.cast),
which [demo-windows-network.cast](../demo/hospital/demo-windows-network.cast)
shares. `hospital-1` is asked unless the request names `hospital-2`.

| Time | Request                                                                        | Outcome                                                                                                        |
| ---: | :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| 0:37 | both runners start                                                             | presence online and the first state document of each, signed, over MQTT and the webhook                        |
| 0:56 | `GET /dt`; `GET /health`; `GET /dt` unsigned; `POST /` `open` as `manager-1`   | the descriptor with `peers` and `publicKey`; `ok`, `scripts` `null`; `401 missing credential`; `403`           |
| 1:16 | MQTT `dt`                                                                      | the descriptor, `verified` with the runner's public key                                                        |
| 1:23 | `POST /fsm/transition` to `open`, `hospital-2` first; `GET /state`             | `202 accepted`; `open.ps1` logs its environment, its fidelity and overflow to `hospital-2`                     |
| 1:46 | `GET /peers`; `PUT /peers` with an unknown peer and a string                   | `hospital-2` online in `open`, with its descriptor and state; `400` with two problems                          |
| 1:59 | `POST /` `admit` `p-1`, key `admit-p-1`, twice; then `open` with input         | `success` both times, and `admit` ran once; `409 command running`                                              |
| 2:29 | `POST /` `admit` `p-2`, then `p-3`; `GET /`                                    | `success`, then `failed` with exit code 3 and a `request` escalation; the failed `admit`                       |
| 2:57 | `GET /parameters`; `PUT` `capacity`; MQTT `set-parameters` `scope`; `fidelity` | the declarations; `400 not controllable`; `open` restarts at entries 2 and 3; `GET /history` shows both runs   |
| 3:36 | `hospital-2`: MQTT `execute` `admit` `p-5`, `POST /` `admit` `p-6`             | `hospital-2` goes `full` and its `full` succeeds; `neighbour-full` restarts `open` at entry 4                  |
| 4:03 | `POST /` `admit` `p-3`, then `p-4`                                             | `success`; `open.ps1` raises `full`, the script of `full` finds no open peer and fails, a `failure` escalation |
| 4:29 | `POST /fsm/event` `close`, twice                                               | `409 no transition` twice, one `no-transition` escalation                                                      |
| 4:46 | MQTT `execute` `discharge` `p-1`; MQTT `fsm`                                   | `success`; `beds-free` takes the machine to `open` at entry 6                                                  |
| 4:59 | `PUT /peers` `hospital-2` `false`, then `true`                                 | the entry empties; the retained `full` raises `neighbour-full` again, `open` at entry 7                        |
| 5:20 | the runner of `hospital-2` is killed; `GET /peers`                             | the will, offline with `time` `null`; `neighbour-down` restarts `open` at entry 8                              |
| 5:36 | `GET /history` with `since` and `limit`; `GET /history`; `GET /metrics`        | two records; fourteen, by `alice`, `manager-1` and none; the counters                                          |
| 5:52 | `POST /stop` `open`                                                            | `stopped: ["open"]`; `$stopped` leads to `closed` at entry 9                                                   |
| 6:08 | the webhook log                                                                | presence and escalations of both DTs, `verified`                                                               |
| 6:13 | graceful shutdown of `hospital-1`; MQTT `retained`                             | presence offline; the retained state and presence of both DTs                                                  |

## Version

This document describes runner version 0.14.0. It adds the
[replay twins](#replay-twins): `replay` in [GET /dt](#get-dt), the
route [PUT /peers/:id/notice](#put-peersidnotice), the headers
`Replay-By` and `Replay-Seq`, `at` and `origin` on the rows of the
[timeline](#get-timeline) of a replay twin, and `DT_REPLAY_OF` and
`DT_TIME_SCALE` in the [script environment](#script-environment).
Nothing that 0.13.0 answered changes; a database of 0.13.0 gains the
two columns at the first start.

Version 0.13.0 added the
[what-ifs](#what-if): the routes `POST /whatif` and `GET /whatif/<id>`,
the MQTT topics `<topic>/whatif/set` and `<topic>/whatif`, the
notification kind `whatif`, the timeline kind `whatif`, `mode` in
[GET /history](#get-history), and `DT_MODE` and `DT_WHATIF_DIR` in
the [script environment](#script-environment). Every script now gets
`DT_MODE`. Nothing that 0.12.0 answered changes.

Version 0.12.0 removes what 0.11
deprecated, and a file or a request that uses one is refused:

| Removed                                                          | Use instead                                                                          |
| :--------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `notify` and `peers` at the top of the configuration             | `relationships.manager.notify`, `relationships.peers`                                |
| `type: enum` with `values`, for a parameter                      | `type: string` with `enum`                                                           |
| The MQTT topics `<topic>/set-parameters` and `<topic>/set-peers` | `<topic>/parameters/set` and `<topic>/peers/set` ([Request Topics](#request-topics)) |

It also adds the role `operator` ([Roles](#roles)), the
[snapshots](#snapshots) with their three routes and two MQTT topics,
`saving` in [GET /health](#get-health), the timeline kind `snapshot`,
and `reinstated` in a `start` row. A `503` with the status `saving`
is new: a client that changes the DT may get it during a save, and
tries again after `Retry-After`.

Version 0.11.0 added
[properties](#properties), the role `sensor`, `stateInterval`, the
`relationships` section of the configuration and a state machine file
without states. It also added the `class` section of the state machine
file, the `parameters` of the configuration and subscriptions by
`relationship` ([CLASS-INSTANCE-INTERFACE.md](../CLASS-INSTANCE-INTERFACE.md)):
[GET /dt](#get-dt) and the [presence](#presence) notice gained `class`,
and [GET /peers](#get-peers) gained `relationship`. It added the
[timeline](#timeline) too. Three of its
changes break a client of 0.10:

- [GET /parameters](#get-parameters) shows an enum as
  `"type": "string"` with `"enum"`, not `"type": "enum"` with
  `"values"`.
- The [state document](#get-state) has a `properties` member.
- The names `set` and `response` are reserved for parameters,
  properties and peer ids.

It deprecated the three spellings that 0.12.0 removes and still took
them, each with a warning in the log.

Version 0.10.0 made
[GET /history](#get-history) return full records and added
[GET /metrics](#get-metrics); 0.9.0 added
[access control](#access-control). The optional
[signatures](#signatures), the `resources` of the commands, the
[peers](#peers) and the subscriptions to them came without a version
change. The
[README](../README.md#use) tells how to install, configure and start the
runner, and the [state machine guide](../STATE-MACHINE.md) how to write a
state machine file.
