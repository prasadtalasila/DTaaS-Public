# What-If Guide

This guide is for authors of digital twins (DTs) and for the Managers
who ask them questions. It explains what a what-if is, what the author
and the operator write for one, how a Manager asks for one and reads
its result, and what the script of a what-if finds. The routes are
listed in [API.md](api/API.md#what-if), and the design in
[docs/state-machine-design.md](docs/state-machine-design.md). Version
0.13.0 added what-ifs. A question of how the whole twin would have
moved is a replay, which [REPLAY.md](REPLAY.md) describes.

## What a What-If Is

A Manager wants to ask a twin about a state that it is not in: "How
many beds are free in two hours if hospital-2 stays down?" The twin
answers with a script that its author wrote for the purpose. The
runner makes a private copy of the twin, runs the script on the copy,
keeps what the script printed as the result, and removes the copy.
Nothing of the live twin changes, and no second runner starts.

A what-if is:

- one script, a command of `whatIf.commands`, run once;
- run on a copy that the [save](README.md#saving-and-reinstating)
  makes, with the database, the files of the scripts and the present
  as four documents;
- answered at once with an id; the result comes later.

A what-if is not:

- a run of the state machine: no state is entered, no event is raised
  and no other script of the class runs;
- a simulation in real time: it is as fast as the script;
- a second twin. A question about how the whole machine would have
  moved needs every script of the class to run again: a replay, which
  the operator runs with `runner-replay` in a second runner, a replay
  twin, from snapshots of the twin ([REPLAY.md](REPLAY.md)).

## What the Author Writes

The class names the commands that `POST /whatif` runs, in the
`whatIf` section. The examples of this guide are of a hospital twin,
`hospital-1`, whose class `hospital.fsm.yaml` has two states, `open`
and `full`, a parameter `capacity`, the beds of each ward, and a
property `free-beds`; its one peer, `hospital-2`, is a neighbour. Its
scripts keep the patients of each ward in `run/<DT_ID>/ward.json`
beside the scripts, such as
`{"cardiology": ["p-1"], "surgery": ["p-3", "p-4"]}`. Of its class:

```yaml
manager:
  commands:
    - admit
    - discharge
    - forecast-beds
# the commands that copy the beds into a snapshot and back from one
snapshot:
  save: save-script
  restore: restore-script
# the commands that POST /whatif runs on a private copy of the twin;
# replay: the scripts keep to their own beds in a replay twin, so
# runner-replay may start one
whatIf:
  commands:
    - forecast-beds
  replay: true
```

`replay: true` is of a replay, not of a what-if: it allows a replay
twin of the class ([REPLAY.md](REPLAY.md#what-a-class-must-do)). The
runner does not start, and names the problem, when:

- a command of `whatIf.commands` is not one of the `commands` of
  _runner.yaml_: `✖ what-if command forecast-ward is not a permitted
command`;
- it is the name of a state: `✖ what-if command work is the script of
a state, which runs for the machine; a what-if needs a script of its
own`. A state entry and a what-if are thus never runs of one command;
- the class has no `snapshot.save`, which makes the copy:
  `✖ whatIf needs snapshot.save, which makes its copy`.

A Manager may ask for a what-if only of a command that
`manager.commands` lists as well. A `client` may ask for any command
of `whatIf.commands`. A `manager` that asks for a command which either
list lacks gets `403` `manager may not call whatif`, as the role check
comes first; a `client` that asks for a command which
`whatIf.commands` lacks gets `400` `invalid command`.

The save script runs for the copy as for a save: it gets
`DT_SNAPSHOT_DIR`, which is `files/` of the copy, and writes the files
of the scripts there ([STATE-MACHINE.md](STATE-MACHINE.md#snapshot)).
The what-if script then reads them from `$DT_WHATIF_DIR/files/`. The
`save-script` of the hospital:

```bash
#!/usr/bin/env bash
# Saves the beds, run/<DT_ID>/ward.json beside the scripts, into a snapshot
set -euo pipefail
cp "$(dirname "$0")/../run/$DT_ID/ward.json" "$DT_SNAPSHOT_DIR/ward.json"
```

The what-if script reads the scenario on stdin, reads the copy in
`DT_WHATIF_DIR`, and prints its result on stdout. It gets
`DT_MODE=what-if`, `DT_WHATIF_DIR`, and the other variables of a
command of `POST /`: `DT_ID`, `DT_STATE` and `DT_ENTRY` of the current
state, and the `DT_PARAM_` variables. It gets neither `RUNNER_URL`
nor `RUNNER_TOKEN`. Every other script gets `DT_MODE=live`. A
`client` may still run a what-if command with `POST /`; the script
then refuses, as `forecast-beds` does:

```bash
#!/usr/bin/env bash
# Command forecast-beds, for POST /whatif only
set -euo pipefail
if [[ ${DT_MODE:-} != what-if ]]; then
  echo "forecast-beds runs only as a what-if, not in mode ${DT_MODE:-none}" >&2
  exit 2
fi
exec node --no-warnings "$(dirname "$0")/forecast.mjs"
```

Run with `POST /`, it fails with exit code 2 and
`forecast-beds runs only as a what-if, not in mode live` on stderr. As
a what-if it runs `forecast.mjs` beside it, which reads the copy and
prints its result:

```js
// The free beds at the horizon of the scenario on stdin: the free beds
// of the copy less the admissions of the last hour, per hour, over the
// horizon. Reads the copy in DT_WHATIF_DIR; prints JSON.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const copy = process.env.DT_WHATIF_DIR;
const read = (file) => JSON.parse(readFileSync(join(copy, file), 'utf8'));
const scenario = JSON.parse(readFileSync(0, 'utf8') || '{}');
const horizon = scenario.horizon ?? 'PT2H';
const hours = Number(/^PT(\d+)H$/.exec(horizon)?.[1] ?? 2);

const capacity = read('parameters.json').capacity.value;
const wards = Object.values(read('files/ward.json'));
const free = wards.reduce((sum, beds) => sum + capacity - beds.length, 0);

const database = new DatabaseSync(join(copy, 'state.db'), { readOnly: true });
const since = new Date(Date.now() - 3600000).toISOString();
const { n: rate } = database
  .prepare(
    `SELECT count(*) AS n FROM timeline WHERE kind = 'command'
     AND json_extract(data, '$.name') = 'admit' AND time > ?`,
  )
  .get(since);
database.close();

console.log(
  JSON.stringify({
    'free-beds': Math.max(free - rate * hours, 0),
    horizon,
    'free-now': free,
    'admissions-per-hour': rate,
    'state-now': read('state.json').machine.state,
    token: process.env.RUNNER_TOKEN === undefined ? 'absent' : 'present',
  }),
);
```

## What the Operator Sets

Nothing beyond [snapshots](README.md#snapshots). `POST /whatif` is
refused with `409` and a status without one of:

| Needed                                        | Status                  |
| :-------------------------------------------- | :---------------------- |
| `database`, a file                            | `no database`           |
| `snapshots.directory`, and no replay twin     | `no snapshot directory` |
| `auth.principals` ([access control][control]) | `no access control`     |

[control]: README.md#access-control

The command must be one of the `commands` of _runner.yaml_, and the
class loads only if it is. The copies are made under
`<snapshots.directory>/what-if/`, and are no snapshots: no `snapshot`
row is written, and `GET /snapshot` does not list them. With
`scripts.user`, a class with a save script can not be saved, and so a
what-if is refused with `409` `save script of another account`
([PRIVILEGE-SETUP.md](PRIVILEGE-SETUP.md#saving-and-reinstating)).

## Asking and Reading the Result

The Manager asks with the name of the command and the scenario as
`input`, signed as `manager-1` in `$JWS`
([API.md](api/API.md#token) tells how to sign):

```bash
curl -X POST http://localhost:5100/whatif -H "Authorization: Bearer $JWS" \
  -H 'Content-Type: application/json' \
  -d '{"name":"forecast-beds","input":{"horizon":"PT2H"}}'
```

The runner makes the copy, then answers `202`:

```json
{ "id": 14, "name": "forecast-beds", "status": "running" }
```

`id` is the number of the run in the command history. The Manager
keeps it and asks `GET /whatif/14`:

```json
{
  "id": 14,
  "name": "forecast-beds",
  "status": "valid",
  "mode": "what-if",
  "receivedAt": "2026-11-24T22:26:41.000Z",
  "by": "manager-1",
  "exitCode": 0,
  "result": {
    "free-beds": 0,
    "horizon": "PT2H",
    "free-now": 1,
    "admissions-per-hour": 5,
    "state-now": "open",
    "token": "absent"
  },
  "finishedAt": "2026-11-24T22:26:41.000Z",
  "resources": { "cpuSeconds": 0, "peakRssBytes": 5918720, "processes": 2 }
}
```

While the script runs, the reply has only `id`, `name`, `status`
(`running`), `mode`, `receivedAt` and `by`. `result` is the output
parsed as JSON, or the text when it is no JSON. `status` is `valid`,
`failed`, `stopped` or `interrupted`, as in
[GET /history](README.md#get-request-to-history). An id that is no
what-if run gets `404`.

Over MQTT, the request goes to `<topic>/whatif/set` with the same
body, and the reply to `<topic>/whatif/set/response`. The result is
asked on `<topic>/whatif` with `{"id": 14}`, and comes on
`<topic>/whatif/response`.

| Route           | `client` | `operator` | `manager`                                            | `script` | `sensor` |
| :-------------- | :------- | :--------- | :--------------------------------------------------- | :------- | :------- |
| `POST /whatif`  | yes      | no         | commands in `whatIf.commands` and `manager.commands` | no       | no       |
| `GET /whatif/n` | yes      | yes        | yes                                                  | no       | no       |

A second request for a command whose what-if runs joins it: it gets
the same `id`, also while the copy is made, and its input is ignored.
A `client` or an `operator` stops a what-if with
`POST /stop {"name": "forecast-beds"}`; a `manager` may not.

## The Notification

When the run ends and the copy is gone, the runner sends a
notification of kind `whatif` on `<topic>/notify/whatif`, not
retained, and to the [webhook](README.md#webhook):

```json
{
  "kind": "whatif",
  "id": "hospital-1",
  "time": "2026-11-24T22:26:41.409Z",
  "data": {
    "id": 14,
    "name": "forecast-beds",
    "status": "valid",
    "exitCode": 0,
    "result": {
      "free-beds": 0,
      "horizon": "PT2H",
      "free-now": 1,
      "admissions-per-hour": 5,
      "state-now": "open",
      "token": "absent"
    }
  }
}
```

A what-if stopped by `POST /stop` sends it, with `status` `stopped`,
`exitCode` `null` and `result` `""`. One that the shutdown stops sends
none. The timeline has a `sent` row for each notification.

## What the Script Finds

The copy is a [snapshot](README.md#saving-and-reinstating) with four
documents more, in a directory named by the time, such as
`run/hospital-1/snapshots/what-if/20261124T222638160Z/`:

```text
files/ward.json        what the save script wrote
hospital.fsm.yaml      the state machine file
parameters.json        the reply of GET /parameters
peers.json             the reply of GET /peers
properties.json        the reply of GET /properties
runner.yaml            the configuration, with the secrets blanked
scripts/               the directory of location
snapshot.json          the manifest
state.db               a copy of the database
state.json             the reply of GET /state
```

Each document is the reply of the route of the same name at the copy.
Of the hospital, with `p-1`, `p-3` and `p-4` in bed and one bed free,
`state.json`:

```json
{
  "id": "hospital-1",
  "time": "2026-11-24T22:26:38.172Z",
  "machine": {
    "state": "open",
    "status": "valid",
    "entry": 3,
    "events": ["beds-free", "full", "neighbour-down"]
  },
  "parameters": {
    "capacity": 2
  },
  "properties": {
    "free-beds": {
      "value": 1,
      "time": "2026-11-24T22:24:14.277Z"
    }
  },
  "command": {
    "name": "save-script",
    "status": "valid",
    "receivedAt": "2026-11-24T22:24:16.000Z",
    "finishedAt": "2026-11-24T22:24:16.000Z"
  }
}
```

`parameters.json`:

```json
{
  "capacity": {
    "value": 2,
    "type": "integer",
    "minimum": 1,
    "default": 2,
    "controllable": false
  }
}
```

`properties.json`:

```json
{
  "free-beds": {
    "value": 1,
    "time": "2026-11-24T22:24:14.277Z",
    "by": "script",
    "type": "integer",
    "minimum": 0,
    "unit": "beds"
  }
}
```

`peers.json`, which holds what each peer last told; this is in no
table. The twin had heard nothing of `hospital-2`:

```json
{
  "hospital-2": {
    "topic": "dtaas/hospital-2",
    "url": "http://localhost:5200",
    "attributes": {
      "distance": 12.4
    },
    "relationship": "neighbour",
    "enabled": true,
    "online": null,
    "descriptor": null,
    "state": null
  }
}
```

The past is in the `timeline` table of `state.db`
([README](README.md#timeline)): `seq`, `time`, `kind`, `by` and
`data`, a JSON text. The `admit` requests of the copy above:

```sql
SELECT time, json_extract(data, '$.input.patient') AS patient
FROM timeline
WHERE kind = 'command' AND json_extract(data, '$.name') = 'admit';
```

```text
2026-11-24T22:24:04.376Z|p-1
2026-11-24T22:24:05.544Z|p-1
2026-11-24T22:24:06.633Z|p-2
2026-11-24T22:24:07.806Z|p-3
2026-11-24T22:24:08.965Z|p-4
```

The second `p-1` repeated the request key of the first, and the twin
answered it with the stored reply; its row has `"stored": true` in
`data`, and ran nothing. The copy ends at the `seq` of its manifest,
so the `whatif` row of the run itself is not in it. Node has
`node:sqlite`, with which `forecast.mjs` reads the table.

What a script may rely on: the four documents and the `timeline`
table. Their shapes change only with a note in the README. The other
tables of `state.db` are the runner's own, and may change with any
version.

## The Shape of a Scenario

The input is the class's own, as for any command. The recommended
shape:

| Member    | Holds                                                          |
| :-------- | :------------------------------------------------------------- |
| `horizon` | how far ahead the question looks, an ISO 8601 duration: `PT2H` |
| `change`  | what is other than now, such as `{"parameters": {...}}`        |
| `steps`   | what happens when: `[{"at": "PT10M", ...}]`                    |

`forecast.mjs` above reads `horizon` alone.

## Why the Twin Can Not Change

- **No token and no address.** The script gets neither
  `RUNNER_TOKEN` nor `RUNNER_URL`, inherited or set, so it can not
  raise an event, write a property or escalate. The result above
  shows `"token": "absent"`.
- **A copy of the database.** The script reads `state.db` of its copy.
  A query on the live database could hold up the runner's writes.
- **Access control.** Without `auth.principals` every route is open
  to any process of the host, and the missing token would protect
  nothing. The what-if is refused.
- **The result is no property.** It is in the history, in
  `GET /whatif/<id>` and in the notification. `GET /`, the state
  document and the state notifications skip what-if runs, and the
  save run of the copy.

[SECURITY-MODEL.md](SECURITY-MODEL.md#what-ifs) has the reasons.

## Limits

- It is one script; the state machine does not run.
- Two what-ifs of one command do not overlap: the second joins the
  first.
- A what-if of a command that runs live is refused with `409`
  `command running`, and makes no copy. That includes a live run that
  starts while the copy is made.
- A live run, over HTTP or MQTT and with or without input, of a
  command whose what-if runs is refused with `409` `what-if running`.
- During a save, a new what-if gets `503` `saving` with
  `Retry-After`; once the runner shuts down, `503` `shutting down`.
- A failed save script answers `500` with its outcome, and leaves no
  copy.
- The script has no time limit. A `client` or an `operator` stops it.
- A result is kept with the command history, which has no limit.

## What It Costs

Each what-if is a save. The twin pauses for it as for
[POST /snapshot](README.md#saving), and the database and the directory
of the scripts are copied each time, which takes longer as the
timeline grows. The copy is removed when the run ends, and at the next
start if the runner crashed.
