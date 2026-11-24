# Saving, Reinstating and What-If

A design, not a description of what is built. It gathers what issues
[22](issues/22-timeline.md) to [25](issues/25-replay.md) plan, in one
place: what each feature is for, how the features differ, and every
format that they would add. The issues hold the plans, the tasks and
the open questions; where this page and an issue disagree, the issue
is right.

The hospital twin of `demo/hospital` is the example throughout.

## The Features

A digital twin (DT) on the runner has a present and no past, and it
exists once. Six features, in four issues, change that:

| Feature   | Issue | In one sentence                                                               | Who uses it  |
| :-------- | :---- | :---------------------------------------------------------------------------- | :----------- |
| Timeline  | 22    | The runner records everything that enters the DT, changes in it, or leaves it | Every reader |
| Save      | 23    | The runner writes the whole DT into a directory, a snapshot                   | The operator |
| Reinstate | 23    | A runner starts from a snapshot and is that DT again                          | The operator |
| What-if   | 24    | The DT answers a question about a state that it is not in, with one script    | The Manager  |
| Replay    | 25    | A second twin is reinstated, changed, and given the recorded inputs again     | The operator |
| Compare   | 25    | Two timelines are set side by side                                            | The operator |

They build on each other:

```text
timeline ─> save ─> reinstate ─┬─> what-if (a copy, inside the twin)
                               └─> replay ─> compare (a second twin)
```

Three decisions run through all of them:

- **The runner starts no second runner.** A what-if is a script of
  the DT. A replay is made by a tool that the operator runs.
- **Saving is outside the state machine.** It is a request to the
  runner, which pauses, copies and goes on. No state is entered.
- **Whoever steers the DT can not copy it.** Saving and replaying are
  the operator's. Asking a what-if is the Manager's.

## Words

| Word            | Meaning                                                                                    |
| :-------------- | :----------------------------------------------------------------------------------------- |
| twin            | The DT that a runner serves, live: the one that the physical twin is tied to               |
| snapshot        | A directory that holds a twin as it was at one moment                                      |
| reinstated twin | A twin that a runner started from a snapshot. It may have another `id`, port and host      |
| replay twin     | A reinstated twin with something changed, which is given recorded inputs. It is never live |
| private copy    | A snapshot in a temporary directory, made for one what-if and removed after it             |
| input           | Anything that came to the twin from outside: a request, a command, a notice of a peer      |

### The Name of the Second Twin

The second twin of a replay was first called a side twin. Two better
names:

- **Replay twin.** It says what the twin is for and which tool makes
  it, and it can not be taken for a twin in production. This page
  and the issues use it.
- **Trial twin.** It says that the twin exists to try a change, and
  it is close to the Test-FDT of the Fluid Digital Twins paper. It
  fits less well if a replay is run with nothing changed, to check
  that a recording is complete.

"Fork" was also used. It is a word of version control, and it
suggests that the two could be merged again, which they can not.

## Roles

The work needs a fifth role, `operator`: whoever runs the runner. An
operator keeps the twin running and can copy it, and does not steer
it. A Manager steers it and can not copy it.

| Route                                                                              | `client` | `operator` | `manager`               | `script` | `sensor` |
| :--------------------------------------------------------------------------------- | :------- | :--------- | :---------------------- | :------- | :------- |
| `health`                                                                           | open     | open       | open                    | open     | open     |
| Reads: `dt`, `state`, `fsm`, `status`, `history`, `metrics`, `parameters`, `peers` | yes      | yes        | yes                     | yes      | no       |
| `properties`                                                                       | yes      | yes        | yes                     | yes      | yes      |
| `timeline`                                                                         | yes      | yes        | yes                     | yes      | no       |
| `snapshots` (list), `save`, `delete-snapshot`                                      | yes      | yes        | no                      | no       | no       |
| `stop`                                                                             | yes      | yes        | no                      | no       | no       |
| `whatif`                                                                           | yes      | no         | both lists only         | no       | no       |
| `whatif-result`                                                                    | yes      | yes        | yes                     | no       | no       |
| `execute`                                                                          | yes      | no         | `manager.commands` only | no       | no       |
| `transition`                                                                       | yes      | no         | no                      | no       | no       |
| `event`, `escalate`                                                                | yes      | no         | no                      | yes      | no       |
| `set-parameters`, `set-peers`                                                      | yes      | no         | yes                     | no       | no       |
| `set-properties`                                                                   | yes      | no         | no                      | yes      | yes      |

A `client` keeps every right. It is the owner of the twin, or an
application that acts for the owner, and the tests. Reinstating and
replaying have no route: they are commands at a shell on the host.

Version 0.12.0 (issue 23) built the role with every row of the table
but `whatif` and `whatif-result`, which version 0.13.0 (issue 24)
built: a `manager` asks for a what-if only of a command that
`whatIf.commands` and `manager.commands` both list. The list is the
route `snapshots`, the save `save` and the removal `delete-snapshot`,
a route of HTTP alone. An operator also reads the `input` of a
command row of the timeline, as a `client` does.

## The Timeline

One table that only grows. Each row has a number, `seq`, that only
rises, a `time` to the millisecond, a `kind`, `by` (the principal,
`script`, or `null`) and `data`.

| Group        | Kinds                                                                                             |
| :----------- | :------------------------------------------------------------------------------------------------ |
| What enters  | `transition`, `event`, `command`, `stop`, `whatif`, `parameters`, `properties`, `peers`, `notice` |
| What changes | `start`, `entry`, `exit`, `snapshot`, `shutdown`                                                  |
| What is sent | `sent`                                                                                            |

Issue 22 built every kind but `snapshot` and `whatif`, which come with
the save and the what-if. `stop` is a request to stop a script;
`shutdown` is the end of a run of the runner. Two rows of a run of the
built runner with access control:

```json
[
  {
    "seq": 11,
    "time": "2026-11-24T08:22:05.130Z",
    "kind": "command",
    "by": "alice",
    "data": { "name": "echo-input", "input": { "patient": "p-7" }, "run": 4 }
  },
  {
    "seq": 14,
    "time": "2026-11-24T08:22:06.240Z",
    "kind": "entry",
    "by": null,
    "data": { "state": "execute", "entry": 4, "cause": 13 }
  }
]
```

`run` is the id of the run in the command history. The `cause` of an
entry is the request row that led to it, here an event that a change
of a parameter raised, or the `exit` row of the script whose
completion did. Each entry has one `exit` row, with the status of its
script. A request row holds its reply, and is never changed after the
request.

The `start` row holds the whole state that the runner starts with.
So what the runner knew of the twin at any `seq` is the `start` row
before it and the rows between. The rows are also the inputs of a
replay.

`GET /timeline` takes `after` (a `seq`), `since` and `until` (times),
`kind`, `limit` and `count`. No row is ever removed, and the table
has no limit for now.

## Saving

### What a Snapshot Holds

A snapshot is a directory, named by the time it was taken, in UTC to
the millisecond:

```text
run/hospital-1/snapshots/
└── 20261124T125705005Z/
    ├── snapshot.json
    ├── state.db
    ├── runner.yaml
    ├── hospital.fsm.yaml
    ├── scripts/
    │   ├── admit
    │   ├── admit.ps1
    │   ├── ...
    │   ├── save-script
    │   ├── save-script.ps1
    │   ├── ward.ps1
    │   └── ward.sh
    └── files/
        └── ward.json
```

| Part                   | Written by      | Holds                                                                                         | Why it is there                                                   |
| :--------------------- | :-------------- | :-------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| `snapshot.json`        | the runner      | The manifest                                                                                  | A runner checks it before it opens anything else                  |
| `state.db`             | the runner      | The database: machine, parameter values, properties, peer switches, command history, timeline | It is the twin. A runner without a database file can not be saved |
| `runner.yaml`          | the runner      | The configuration, with the secrets blanked                                                   | The values that an instance sets for parameters are only there    |
| the state machine file | the runner      | The class                                                                                     | A name and a version do not bring the file to another host        |
| `scripts/`             | the runner      | The whole directory of `location`                                                             | The class is the file and its scripts                             |
| `files/`               | the save script | What the scripts keep for themselves                                                          | Only their author knows what that is                              |

The signing key of the runner is a path in `runner.yaml`. The key
itself is not copied, unless the operator put it under `location`, as
anything there is copied with the scripts.

- The directory has mode `0700`, as it holds the inputs and the logs
  of commands.
- In the copy of `runner.yaml` the MQTT password, the user and password
  of `mqtt.url` and the webhook token are blanked. The copy is written
  from the parsed file, so it has no comments.
- `snapshots.directory` must lie outside `location`, and the state
  machine file must not be named `runner.yaml` when `snapshots` is
  set. The runner refuses both when it loads the configuration.

### The Manifest

A save of the demo's `hospital-1`, in `open` after one `admit`, wrote:

```json
{
  "format": 1,
  "runner": "0.12.0",
  "id": "hospital-1",
  "class": {
    "id": "urn:dtaas:demo:hospital",
    "version": "1.0.0"
  },
  "time": "2026-11-24T12:57:05.005Z",
  "seq": 5,
  "machine": {
    "state": "open",
    "entry": 1,
    "status": "running"
  }
}
```

| Field     | Meaning                                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`  | The version of this layout. A runner refuses one that it does not know                                                                                                    |
| `runner`  | The version of the runner that saved                                                                                                                                      |
| `id`      | The twin that was saved                                                                                                                                                   |
| `class`   | The class of that twin. A runner reinstates only into a class with the same `id`                                                                                          |
| `time`    | When the save began. The name of the directory is this time                                                                                                               |
| `seq`     | The last row of the timeline before the save. A replay sends the rows after it                                                                                            |
| `machine` | Where the state machine was: the `state`, or `null` before the first transition; the `entry`, the count of state entries so far; the `status` of the script of that entry |

`seq` and `machine` are a summary for the operator and for the
checks. What counts is in `state.db`.

### What the Author and the Operator Add

```yaml
# the state machine file: which scripts save and restore what the
# scripts keep
snapshot:
  save: save-script
  restore: restore-script
```

```yaml
# runner.yaml: where snapshots go, and how long the save script may
# take, in milliseconds
snapshots:
  directory: 'run/hospital-1/snapshots'
  timeout: 30000
```

The two scripts get one variable, `DT_SNAPSHOT_DIR`, which is
`files/` of the snapshot. Those of the demo:

```bash
#!/usr/bin/env bash
# Saves the beds of the hospital into a snapshot: copies
# run/<DT_ID>/ward.json to DT_SNAPSHOT_DIR. POST /snapshot runs it.
set -euo pipefail
cp "$(dirname "$0")/../run/$DT_ID/ward.json" "$DT_SNAPSHOT_DIR/ward.json"
```

```bash
#!/usr/bin/env bash
# Restores the beds of the hospital from a snapshot: copies ward.json of
# DT_SNAPSHOT_DIR to run/<DT_ID>/. runner --reinstate runs it.
set -euo pipefail
ward_dir="$(dirname "$0")/../run/$DT_ID"
mkdir -p "$ward_dir"
cp "$DT_SNAPSHOT_DIR/ward.json" "$ward_dir/ward.json"
```

A class whose scripts keep everything in properties names neither.

### The Save

```http
POST /snapshot
```

1. The runner pauses. A request that would change the twin is
   refused with `503` `saving` and `Retry-After`; reads are answered;
   a script that ends has its completion held, and an event that a
   subscription to a peer raises is held with the completions.
2. The runner copies the database, then writes the manifest and the
   other parts of the directory.
3. The runner runs the save script, within the timeout.
4. The runner writes a `snapshot` row, goes on, and handles what it
   held in the order it came.

```json
{
  "time": "2026-11-24T12:57:05.005Z",
  "seq": 5,
  "path": "run/hospital-1/snapshots/20261124T125705005Z"
}
```

The script of the current state is not stopped. What it holds in
memory alone is not saved, which asks nothing new: a restart of the
runner ends every script without a warning already.

| Request                                | Reply                                                                                     |
| :------------------------------------- | :---------------------------------------------------------------------------------------- |
| `POST /snapshot`                       | `201` as above; `409` with one of four statuses (below); `500` when the save script fails |
| `POST /snapshot` with `{"stop": true}` | The same, and the runner then shuts down                                                  |
| `GET /snapshot`                        | `200`, a list of `{time, seq, path}`, oldest first                                        |
| `DELETE /snapshot/<name>`              | `204`, or `404`                                                                           |
| any changing route, during a save      | `503` `{"status": "saving"}`, with `Retry-After`                                          |

A save is refused with `409` and a status:

- `no database`, for a twin whose database is in memory;
- `no snapshot directory`, without `snapshots` in `runner.yaml`;
- `save script running`, while a run of the save script is in
  progress, as a save would join that run, which has no
  `DT_SNAPSHOT_DIR`;
- `save script of another account`, for a class with a save script
  under `scripts.user`. The script account can not write into a
  directory that only the runner's account reads, and the runner holds
  no privilege to hand it one. The operator keeps what the scripts
  need in properties and names no save script, or leaves out
  `scripts.user`. Staging the files through the run directory, which
  the script account owns, could lift this later.

A save script that fails or passes the timeout fails the save with
`500` and its outcome, and leaves no directory.

After a save with `stop`, the runner answers, stops the scripts that
run and shuts down. An event that a peer raises then is dropped, with
a line in the log. If the shutdown fails, the twin goes on, with its
scripts already stopped.

## Reinstating

```bash
runner -c runner.yaml --reinstate run/hospital-1/snapshots/20261124T125705005Z
```

1. The runner reads the manifest first, and stops if there is none, if
   it is not JSON, or if its format is unknown. It then stops if
   `runner.yaml` names no database or its database exists, if the
   class names a restore script and `scripts.user` is set, or if the
   class of the snapshot has another `id`.
2. It warns of each difference that matters between the `-c` file
   and the copy in the snapshot: the class version, each instance
   value, the state machine file, and each script of the copy that
   `location` lacks or has otherwise. The `-c` file is the one that
   counts.
3. It copies `state.db` to the database of `runner.yaml`. The copy
   refuses to overwrite a file.
4. It runs the restore script. A snapshot without `files/` skips it
   with a warning.
5. It starts as after any restart, and writes a `start` row with
   `reinstated`: the `id`, `time` and `seq` of the snapshot.

If the restore script or the resume of the machine fails, the copied
database is removed and the runner stops; a later start can copy
again. A failure after that, such as a port in use, leaves the copied
database: the operator starts without `--reinstate`, or removes the
database before reinstating again.

The reinstated twin has everything that the first had: the values,
the command history with its logs, and the timeline. Its machine is
in the last saved state and waits there, as `interrupted`, until a
caller sends an event or a transition. The runner starts no script by
itself.

### Out of Execution and Back

A twin can be taken out of execution and brought back later:

```http
POST /snapshot
{ "stop": true }
```

1. The runner saves, answers, and shuts down without taking another
   request. Nothing changes after the snapshot. If the shutdown fails,
   the twin goes on, with its scripts already stopped.
2. The operator removes the database and the files, or the host.
3. Later, anywhere: `runner -c runner.yaml --reinstate <snapshot>`.
4. A caller sends an event or a transition, and the twin goes on.

| It comes back with                               | It comes back without                                 |
| :----------------------------------------------- | :---------------------------------------------------- |
| Its state and its entry count                    | What a running script held in memory                  |
| Its parameter values and peer switches           | What its peers last told it, until they tell it again |
| Its properties, with the times they were written | The replies kept for request keys                     |
| Its command history and its timeline             | Its metrics, which count since a start                |

The time in between is not made up for. The properties are as old as
they were, the physical twin has moved on, and the scripts of the
class have to catch up with it.

Three uses, which differ only in the `runner.yaml` that the operator
gives:

| Use                | `id` and port               | What it is                                  |
| :----------------- | :-------------------------- | :------------------------------------------ |
| Bring a twin back  | the same                    | A backup, restored after a loss             |
| Move a twin        | the same `id`, another host | The twin, elsewhere; the first is shut down |
| Make a replay twin | another `id` and port       | A second twin, never live; made by a tool   |

## What-If Inside the Twin

A Manager asks: "How many beds are free in two hours if hospital-2
goes down?" The twin answers with one script, written for the
purpose, which runs on a private copy. Version 0.13.0 (issue 24)
built it as described here; [WHAT-IF.md](../WHAT-IF.md) is the guide
for authors and Managers.

### What Is Declared

The state machine file of the demo, `demo/hospital/hospital.fsm.yaml`,
in part:

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
# the commands that POST /whatif runs on a private copy of the twin
whatIf:
  commands:
    - forecast-beds
```

A Manager may ask only for a command that both lists hold, and gets
`403` for any other; a `client` gets `400` `invalid command` for a
command that `whatIf.commands` lacks. A command
of `whatIf.commands` must be permitted and may not be a state, and
the class needs `snapshot.save`; else the runner does not start. The
runner needs a database file, a directory for snapshots and access
control; without any of them a what-if is refused with `409`.

### Asking, and the Answer

```http
POST /whatif
{
  "name": "forecast-beds",
  "input": {
    "horizon": "PT2H",
    "steps": [{ "at": "PT10M", "peer": "hospital-2", "online": false }]
  }
}
```

`input` is the scenario, in a shape of the class's own choosing. The
runner makes the copy, then replies at once:

```json
{ "id": 5, "name": "forecast-beds", "status": "running" }
```

The runner:

1. saves the twin into a directory such as
   `<snapshots>/what-if/20261124T135903552Z/`, with the pause of a
   save, and without a row or an entry in the list; the save run is
   in the history with no `mode`;
2. answers `202` with the `id`;
3. runs `forecast-beds` with the input on stdin, `DT_MODE=what-if`
   and `DT_WHATIF_DIR`, and with no `RUNNER_TOKEN` and no
   `RUNNER_URL`, and writes a `whatif` row to the timeline;
4. stores what the script printed, with the outcome, and the run with
   `mode: what-if`;
5. removes the copy, however the script ended, and then sends a
   notification.

The copy holds the present as four documents, `state.json`,
`parameters.json`, `properties.json` and `peers.json`, each the reply
of the route of its name, and the past in `state.db`, of which the
`timeline` table is the part that a script may rely on.

The script of the demo, `scripts/forecast-beds`, refuses to run live,
then hands the copy to `scripts/forecast.mjs`, which reads the beds of
`files/ward.json`, the capacity of `parameters.json`, the peers of
`peers.json`, the `admit` requests of the last hour from `timeline`, and
prints its answer:

```bash
#!/usr/bin/env bash
set -euo pipefail
if [[ ${DT_MODE:-} != what-if ]]; then
  echo "forecast-beds runs only as a what-if, not in mode ${DT_MODE:-none}" >&2
  exit 2
fi
exec node --no-warnings "$(dirname "$0")/forecast.mjs"
```

A second request for the same command while its what-if runs, also
while the copy is made, joins it. A what-if of a command that runs
live is refused with `409` `command running`, and a live run of a
command whose what-if runs with `409` `what-if running`.

### The Result

The result is what the script printed. The Manager is on another
host and can not read a file of the runner, so the runner hands it
over in two ways.

On request, `GET /whatif/5`, from a copy of the demo with
`hospital-1` alone after two admissions:

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

`result` is the output parsed as JSON, or the text when it is no
JSON. `status` is that of any command: `running`, `valid`, `failed`,
`stopped` or `interrupted`. An id that is no what-if gets `404`.

And by a notification on `<base>/notify/whatif` and the webhook, not
retained, in the envelope of every notification:

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

A what-if stopped by `POST /stop` sends the notification with
`stopped`; one that the shutdown stops sends none.

### Why the Twin Stays as It Is

- The script has no token and no address, so it can not raise an
  event, write a property or escalate. The demo's result shows
  `"token": "absent"`.
- It reads a copy of the database, never the database.
- The result is no property, and the state document does not change.
- Without access control the request is refused, as a missing token
  would then protect nothing.

The costs are a pause of the twin at each what-if, and a copy of the
database and the scripts each time.

## Replay

An operator asks: "What would hospital-1 have done last night under
scope `multi`?" The state machine and every script of the class run
again, in a replay twin, on what the twin was told.

### Two Snapshots

| Snapshot | Taken             | Gives                                                                   |
| :------- | :---------------- | :---------------------------------------------------------------------- |
| start    | Before the period | Where the replay twin begins: database, class, scripts, files           |
| inputs   | After the period  | The timeline, whose rows after the `seq` of the start are what happened |

A replay is described in a file, and run from it. The file is
`runner-replay.yaml` by default: without an argument the tool reads
the file of that name in the current directory.

```yaml
# runner-replay.yaml
start: run/hospital-1/snapshots/20261122T220000000Z
inputs: run/hospital-1/snapshots/20261123T060000000Z
out: replays/scope-multi
speed: 60
set:
  parameters:
    scope: multi
```

```bash
runner-replay runner-replay.yaml
```

| Key      | Needed               | Meaning                                                                              |
| :------- | :------------------- | :----------------------------------------------------------------------------------- |
| `start`  | always               | The snapshot that the replay twin starts from                                        |
| `inputs` | unless `steps`       | A later snapshot of the same twin, whose timeline gives the inputs                   |
| `steps`  | in place of `inputs` | A list of inputs, each at a time: a scenario                                         |
| `out`    | always               | Where the replay twin lives; it must not exist                                       |
| `speed`  | no                   | Divide the gaps between the inputs by this number; `1` by default                    |
| `until`  | no                   | Stop at the last input before this time                                              |
| `settle` | no                   | Seconds to wait after the last input for the replay twin to be idle; `30` by default |
| `set`    | no                   | `parameters` and `properties` to set in the replay twin before the first input       |

Paths are relative to the file. The only flag is `--dry-run`, which
prints the inputs and their times and starts nothing.

### Times

Every time that an operator writes, or reads in a file name, is in
one format, that of the names of snapshots: `YYYYMMDDTHHMMSSmmmZ`, in
UTC to the millisecond, such as `20261123T060000000Z`. It is ISO 8601
in its basic form, which has no character that a file name can not
hold on Windows. It is used for:

- the name of a snapshot directory, and of a private copy;
- `until` and each `at` of a replay file.

The times inside JSON documents, such as `time` of the manifest and
of a row, stay in the extended form, `2026-11-23T06:00:00.000Z`, as
everywhere in the API.

### What the Tool Does

1. It checks that both snapshots are of one twin, and that the class
   says `whatIf.replay: true`.
2. It writes the configuration of the replay twin, from the copy of
   `runner.yaml` in the start.
3. It starts a runner on it:
   `runner -c <out>/runner.yaml --reinstate <start> --what-if --time-scale <speed>`.
4. If the script of the saved state was running at the save, it asks
   for a transition to that state, so that the script runs.
5. It applies `set`.
6. It sends each input at its time after the start, over the speed.
7. It waits until the replay twin is idle, for `settle` seconds at
   most, stops it, and leaves `out`.

The configuration that it writes, for the hospital:

```yaml
id: 'hospital-1.replay'
port: 41873
location: '../../run/hospital-1/snapshots/20261122T220000000Z/scripts'
commands:
  - open
  - full
  - closed
  - admit
  - discharge
  - save-script
  - restore-script
stateMachine: '../../run/hospital-1/snapshots/20261122T220000000Z/hospital.fsm.yaml'
database: 'state.db'
parameters:
  scope: multi
relationships:
  peers:
    - id: 'hospital-2'
      topic: 'dtaas/hospital-2'
      url: 'http://localhost:5200'
      relationship: neighbour
auth:
  principals:
    - name: 'replay'
      role: 'client'
      publicKey: 'mCpoaytWvGJ9K0lxNlSNw6sjUG7UezRWtxPvL1pyxKA'
```

- No broker and no webhook: a replay twin reaches nobody.
- The peers are as in the copy, so that the subscriptions of the
  class bind. None is followed: a replay twin listens to no peer,
  whatever its configuration lists.
- One principal, with a key that the tool makes for this run and
  keeps to itself.

### What Is Sent

| Row of the timeline                                                       | Sent as                                   |
| :------------------------------------------------------------------------ | :---------------------------------------- |
| `transition`                                                              | `POST /fsm/transition`                    |
| `event` of a client                                                       | `POST /fsm/event`                         |
| `command`, with its input                                                 | `POST /`                                  |
| `parameters`, `peers`                                                     | `PUT /parameters`, `PUT /peers`           |
| `properties` that a `sensor` wrote                                        | `PUT /properties`                         |
| `notice` of a peer                                                        | `PUT /peers/<id>/notice`                  |
| anything that a script raised or wrote, `entry`, `exit`, `sent`, `whatif` | nothing: the replay twin does these again |

The tool signs each request as `replay`. Each also names who sent it
to the twin, and its `seq` there. The replay twin records both, so
its timeline says `manager-1` where the twin's did. It would run the
same without them: they serve the comparison and the reader.

**The notice of a peer.** Hospital-1 hears of hospital-2 by
listening: hospital-2 announces that it is full, or gone. In a replay
there is no hospital-2 to listen to. The tool has a recording of what
hospital-2 said, and tells it to the replay twin at the right moment,
with this route. A runner that is no replay twin refuses the route,
as anyone could otherwise put words in a peer's mouth.

```http
PUT /peers/hospital-2/notice
{ "kind": "state", "data": { "id": "hospital-2", "machine": { "state": "full" } } }
```

### A Scenario

With `steps` in place of `inputs`, the file describes a coming
period. Each step has `at`, a time after that of the start snapshot,
and one input:

```yaml
start: run/hospital-1/snapshots/20261123T101502120Z
out: replays/neighbour-down
steps:
  - at: 20261123T101502120Z
    transition: open
  - at: 20261123T102500000Z
    notice:
      peer: hospital-2
      kind: presence
      data:
        online: false
  - at: 20261123T103500000Z
    command:
      name: admit
      input:
        patient: p-9
        ward: cardiology
  - at: 20261123T104500000Z
    parameters:
      scope: multi
  - at: 20261123T105500000Z
    event: close
```

| Key of a step | Sent as                  |
| :------------ | :----------------------- |
| `transition`  | `POST /fsm/transition`   |
| `event`       | `POST /fsm/event`        |
| `command`     | `POST /`                 |
| `parameters`  | `PUT /parameters`        |
| `properties`  | `PUT /properties`        |
| `peers`       | `PUT /peers`             |
| `notice`      | `PUT /peers/<id>/notice` |

### What a Replay Twin Is

A runner started with `--reinstate` and `--what-if`. The second
option changes six things:

| In a replay twin                                                 | In any other runner          |
| :--------------------------------------------------------------- | :--------------------------- |
| `GET /dt` shows `replay: {of, time}`                             | `replay: null`               |
| Scripts get `DT_MODE=what-if`, `DT_REPLAY_OF`, `DT_TIME_SCALE`   | `DT_MODE=live`               |
| The start is refused unless the class says `whatIf.replay: true` | Not asked                    |
| It follows no peer and notifies nobody                           | It follows its enabled peers |
| `PUT /peers/<id>/notice` is answered                             | `404`                        |
| A row records the first sender and `seq` of an input             | No such fields               |

The class must allow it because the scripts run for real. A class
that was not written with the mode in mind would act on the real
hospital from a second process. In the demo the scripts act on
`ward.json`, and the restore script has given the replay twin its
own.

### Time

A replay keeps the meaning of time, at a scale. `speed: 60` plays
an hour in a minute, `1` plays at the speed of the clock, `0.5` takes
twice as long. The replay twin gives the number to its scripts as
`DT_TIME_SCALE`, to divide their own waits by. Each row of its
timeline has, beside its real `time`, `at`: the time that the row
stands for.

### What Is Left in `out`

```text
replays/scope-multi/
├── replay.json
├── runner.yaml
├── state.db
├── runner.log
└── files/
```

```json
{
  "format": 1,
  "of": "hospital-1",
  "start": "run/hospital-1/snapshots/20261122T220000000Z",
  "inputs": "run/hospital-1/snapshots/20261123T060000000Z",
  "from": { "seq": 398, "time": "2026-11-22T22:00:00.000Z" },
  "until": { "seq": 912, "time": "2026-11-23T06:00:00.000Z" },
  "speed": 60,
  "set": { "parameters": { "scope": "multi" } },
  "sent": 147,
  "refused": 2
}
```

`refused` counts the inputs that the replay twin did not accept, such
as an event with no transition in the state that it was then in. That
is a finding, not a fault: the changed twin was somewhere else.

## Compare

```bash
runner-compare run/hospital-1/snapshots/20261123T060000000Z replays/scope-multi
```

Each argument is a snapshot or the output of a replay. The tool reads
the timeline in the database of each, and lists the state entries
side by side:

```text
at        hospital-1                       hospital-1.replay
22:00:00  open    transition  alice        open    transition  alice
22:10:04  open    scope-changed            -
22:20:09  full    full        script       open    scope-changed  manager-1   <- first difference
22:20:09  -                                full    full        script
06:00:00  full                             full

entries: 4 and 4; first difference at 22:20:09
cpu seconds: 12.4 and 13.1
```

With `--json` it prints the same as one document. It exits with 0
when the entries are the same, and with 1 when they differ.

Rows are lined up by the `seq` that an input had in the twin, where
the replay twin recorded it, and by `at` otherwise.

## The Features Compared

| Question                   | Reinstate                         | What-if                             | Replay                                      |
| :------------------------- | :-------------------------------- | :---------------------------------- | :------------------------------------------ |
| Who                        | The operator                      | The Manager                         | The operator                                |
| How it is asked            | `runner --reinstate`              | `POST /whatif`                      | `runner-replay`                             |
| What runs                  | The twin, again                   | One script, with a model of its own | The state machine and every script          |
| Where                      | A runner that the operator starts | Under the runner of the twin        | A runner that the tool starts               |
| On what                    | A snapshot                        | A private copy, removed after       | A snapshot, changed                         |
| The inputs                 | Whatever callers send next        | A scenario in the request           | The rows of a later snapshot, or a scenario |
| Time                       | The clock                         | As fast as the script               | The clock, over a factor                    |
| The answer                 | A twin                            | What the script printed             | A timeline, to compare                      |
| Is it live                 | Yes                               | The twin is; the copy is not        | Never                                       |
| What it costs the twin     | Nothing: the twin is not running  | A pause and a copy of the database  | Nothing: the twin is not contacted          |
| What the author must write | The save and restore scripts      | Those, and the what-if script       | Those, and scripts that honour the mode     |
| What it can not show       | —                                 | How the machine would move          | What the world would have done              |

When to use which:

- **"Is my twin safe?"** Save it, on a schedule.
- **"What happens if?", asked often, answered in seconds, by the
  Manager.** A what-if. It is as good as the model in its script.
- **"What would the twin itself have done?", asked seldom, by the
  operator.** A replay. It runs the real class and takes real time.

## Everything That Is Added

Routes:

| Route                | Method   | Feature | In                 |
| :------------------- | :------- | :------ | :----------------- |
| `/timeline`          | `GET`    | 22      | every runner       |
| `/snapshot`          | `POST`   | 23      | every runner       |
| `/snapshot`          | `GET`    | 23      | every runner       |
| `/snapshot/<name>`   | `DELETE` | 23      | every runner       |
| `/whatif`            | `POST`   | 24      | every runner       |
| `/whatif/<id>`       | `GET`    | 24      | every runner       |
| `/peers/<id>/notice` | `PUT`    | 25      | a replay twin only |

MQTT topics, under the base topic: `timeline`, `snapshot` (list),
`snapshot/set` (save), `whatif` (a result, with `{"id": 57}`),
`whatif/set` (ask), and the notification `notify/whatif`.

The state machine file:

```yaml
snapshot:
  save: save-script
  restore: restore-script
whatIf:
  commands:
    - forecast-beds
  replay: true
```

`runner.yaml`:

```yaml
snapshots:
  directory: 'run/hospital-1/snapshots'
  timeout: 30000
auth:
  principals:
    - name: 'ops-1'
      role: 'operator'
      publicKey: 'mCpoaytWvGJ9K0lxNlSNw6sjUG7UezRWtxPvL1pyxKA'
```

The command line:

| Command                                  | Feature |
| :--------------------------------------- | :------ |
| `runner --reinstate <directory>`         | 23      |
| `runner --what-if --time-scale <factor>` | 25      |
| `runner-replay`                          | 25      |
| `runner-compare`                         | 25      |

Variables of scripts:

| Variable                     | Given to                        | Value                     |
| :--------------------------- | :------------------------------ | :------------------------ |
| `DT_SNAPSHOT_DIR`            | the save and the restore script | `files/` of the snapshot  |
| `DT_MODE`                    | every script                    | `live` or `what-if`       |
| `DT_WHATIF_DIR`              | a what-if script                | its private copy          |
| `DT_REPLAY_OF`               | every script of a replay twin   | the `id` of the twin      |
| `DT_TIME_SCALE`              | every script of a replay twin   | the `speed` of the replay |
| `RUNNER_TOKEN`, `RUNNER_URL` | not a what-if script            | as today                  |

Files:

| File                 | Format                                                     |
| :------------------- | :--------------------------------------------------------- |
| `snapshot.json`      | The manifest of a snapshot                                 |
| a snapshot directory | Named `YYYYMMDDTHHMMSSmmmZ`                                |
| a replay file        | YAML: `start`, `inputs` or `steps`, `out`, and what to set |
| `replay.json`        | What a replay did                                          |

## Limits

- **Personal data travels.** The timeline holds the inputs of
  commands, and the demo's `admit` names a patient. A snapshot
  carries the whole database, to wherever the directory goes and into
  every replay twin.
- **A snapshot is as large as the scripts.** The whole directory of
  the scripts is copied at every save.
- **The database only grows.** A feed that changes a property at
  every write makes a row at every write.
- **A replay answers for the twin, not for the world.** The beds
  that were free last night were free under the old scope.
- **A replay repeats only what the inputs decide.** A script that
  draws random numbers, or reads the clock, goes another way.
- **A script must follow the mode and the scale.** One that ignores
  `DT_MODE` acts on the real world from a replay twin, and one that
  ignores `DT_TIME_SCALE` samples at the wrong rate.
- **A what-if is as good as its model.** The state machine does not
  run in it.

## Not Planned

- Following a live twin with a second one, the parallel kind of the
  Fluid Digital Twins paper.
- Reinstating into a runner that is running.
- A runner that starts another runner for a caller.
- Saves at intervals: an operator calls the route from a scheduler.
- A what-if that publishes its result as a property.
- Signing a snapshot.

## Sources

- Issues [22](issues/22-timeline.md), [23](issues/23-snapshot.md),
  [24](issues/24-what-if.md) and [25](issues/25-replay.md), as
  settled with the owner on 2026-11-23.
- The Fluid Digital Twins paper, as read in
  [integrated-simulations.md](integrated-simulations.md#fluid-digital-twins-offloading-and-a-twin-beside-itself),
  for the three kinds of test twin and for the question of who starts
  one.
- [CLASS-INSTANCE-INTERFACE.md](../CLASS-INSTANCE-INTERFACE.md), for
  class and instance, and for what a new version of a class does to
  stored values.
