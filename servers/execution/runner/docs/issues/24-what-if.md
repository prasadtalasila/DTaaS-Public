# 24 What-If Inside the Twin

- Status: in progress, on the branch `runner/24-what-if`, version
  0.13.0. The design was settled with the owner on 2026-11-23; the
  Spec below says what was built.
- Depends on: [23](23-snapshot.md) (the save that makes the copy), 15a
  (access control)
- PR: none yet
- Research note: the Fluid Digital Twins paper, read in
  [integrated-simulations.md](../integrated-simulations.md#fluid-digital-twins-offloading-and-a-twin-beside-itself).
  The owner asked for the issue with W3, on 2026-11-20. It reopens the
  non-goal "forecasts and exogenous triggers" of the
  [issues](README.md#non-goals).

## Spec

A Manager wants to ask a twin a question about a state that it is
not in: "How many beds are free in two hours if hospital-2 goes
down?" The twin answers by itself, with a script that its author
wrote for the purpose, run on a private copy of the twin. Nothing of
the twin changes, and no second runner is started.

A question about how the whole state machine would have moved needs
every script of the class to run again. That is a second twin, which
the operator makes with the tools of [25](25-replay.md).

### What the author writes

```yaml
# the state machine file, the class
snapshot:
  save: save-script
  restore: restore-script
whatIf:
  commands:
    - forecast-beds
manager:
  commands:
    - admit
    - discharge
    - forecast-beds
```

- `whatIf.commands` are the commands that `POST /whatif` runs. Each
  must be a command of `runner.yaml`.
- A Manager may run one only if `manager.commands` lists it as well.
- None may be the name of a state: a what-if command is a script
  written for the purpose, while the script of a state runs for the
  machine. A class that breaks this is refused at load, so that a
  state entry and a what-if are never runs of one command.
- The class needs `snapshot.save`, which makes the copy.

The runner does not start with a class that breaks one of these, and
names the problem: `what-if command forecast-ward is not a permitted
command`, `what-if command work is the script of a state, which runs
for the machine; a what-if needs a script of its own`, or `whatIf
needs snapshot.save, which makes its copy`.

And the script. It reads the copy and prints its answer. The demo's
`scripts/forecast-beds` refuses to run live and hands the copy to
`scripts/forecast.mjs`:

```bash
#!/usr/bin/env bash
set -euo pipefail
if [[ ${DT_MODE:-} != what-if ]]; then
  echo "forecast-beds runs only as a what-if, not in mode ${DT_MODE:-none}" >&2
  exit 2
fi
exec node --no-warnings "$(dirname "$0")/forecast.mjs"
```

### What the operator writes

```yaml
# runner.yaml, the instance
commands:
  - open
  - full
  - closed
  - admit
  - discharge
  - save-script
  - restore-script
  - forecast-beds
database: 'run/hospital-1/hospital.db'
snapshots:
  directory: 'run/hospital-1/snapshots'
auth:
  principals:
    - name: 'manager-1'
      role: 'manager'
      publicKey: 'mCpoaytWvGJ9K0lxNlSNw6sjUG7UezRWtxPvL1pyxKA'
```

Nothing is new here beyond [23](23-snapshot.md). Three things are
needed, and a what-if is refused without any of them: a database
file, a directory for snapshots, and access control.

### Asking

```http
POST /whatif
{
  "name": "forecast-beds",
  "input": {
    "horizon": "PT2H",
    "change": { "parameters": { "scope": "multi" } },
    "steps": [{ "at": "PT10M", "peer": "hospital-2", "online": false }]
  }
}
```

The input is the scenario. Its shape is the class's own, as for any
command; `horizon`, `change` and `steps` are a convention that the
documents will recommend.

The reply comes once the copy is made, before the script runs, as a
simulation may take long. From the demo:

```json
{ "id": 5, "name": "forecast-beds", "status": "running" }
```

`id` is the number of the run in the command history. The Manager
keeps it to ask for the result. A second request for a command whose
what-if runs gets the same `id`, also while the copy is made, and its
input is ignored.

| Refusal                                                    | Status                                                        |
| :--------------------------------------------------------- | :------------------------------------------------------------ |
| a `client`, for a command that `whatIf.commands` lacks     | `400` `invalid command`                                       |
| a `manager`, for a command that either list lacks          | `403` `manager may not call whatif`                           |
| a database in memory                                       | `409` `no database`                                           |
| no `snapshots.directory`                                   | `409` `no snapshot directory`                                 |
| no `auth.principals`                                       | `409` `no access control`                                     |
| the command runs live, or starts live during the copy      | `409` `command running`                                       |
| a run of the save script, or a save script of another user | `409` `save script running`, `save script of another account` |
| a save in progress                                         | `503` `saving`, with `Retry-After: 1`                         |
| the runner shuts down                                      | `503` `shutting down`                                         |
| the save script fails                                      | `500` with its outcome                                        |

The checks come in about that order; none of the refused requests
leaves a copy.

### What the runner does

1. **It makes a private copy.** It saves the twin as in
   [23](23-snapshot.md), with the same pause, into a temporary
   directory named by the time,
   `<snapshots>/what-if/20261124T135903552Z/`. The copy is a
   snapshot: the manifest, `state.db`, the two files, `scripts/`, and
   `files/` from the save script. It also holds the present as four
   documents, listed [below](#what-the-script-reads), written before
   the save script runs. No `snapshot` row is written, and
   the list of snapshots does not show it. The save run is in the
   history with the caller of the what-if and no `mode`; `GET /`,
   the state document and `GET /whatif/<id>` skip it.
2. **It answers `202`** with the `id`.
3. **It runs the command**, with the input on stdin and two more
   variables: `DT_MODE=what-if`, and `DT_WHATIF_DIR`, the copy, an
   absolute path. It writes a `whatif` row to the timeline, with the
   command, its input and its run.
4. **It keeps what the script printed** as the result, with the
   outcome, in the command history, and the run with
   `mode: what-if` in `GET /history`.
5. **It removes the copy**, however the script ended, and then
   **tells that the run ended**. A copy that a crash left is removed
   at the next start. A replay twin has no snapshot directory, so it
   refuses a what-if with `409` `no snapshot directory` and removes no
   copy at its start.

`DT_MODE` is `live` for every other script.

### What the script reads

The script has no address to ask, so everything it may want is in
its copy. The present is there as documents, which a script reads
with `jq` and no database client:

| File              | The reply of      | Holds                                                          |
| :---------------- | :---------------- | :------------------------------------------------------------- |
| `state.json`      | `GET /state`      | The machine, the parameter values, the properties, the command |
| `parameters.json` | `GET /parameters` | Each parameter with its declaration                            |
| `properties.json` | `GET /properties` | Each property with its value, its time and its declaration     |
| `peers.json`      | `GET /peers`      | Each peer, and what it last told: this is in no table          |

The past is in `state.db`, a copy of the database of the runner. Its
tables:

| Table          | Holds                                                    | For a what-if                                                 |
| :------------- | :------------------------------------------------------- | :------------------------------------------------------------ |
| `timeline`     | Every row of [22](22-timeline.md)                        | The rate of admissions, what a peer told and when: **stable** |
| `commands`     | Each run: name, status, output, caller, resource figures | How long a script takes; internal                             |
| `properties`   | The latest value of each property                        | Use `properties.json`; internal                               |
| `parameters`   | Each change of a parameter                               | Use `parameters.json`; internal                               |
| `machine`      | The state, the entry and the status, in one row          | Use `state.json`; internal                                    |
| `peers`        | Each enabling and disabling of a peer                    | Use `peers.json`; internal                                    |
| `request_keys` | Which request key ran which command                      | Nothing; internal                                             |

The documents and the `timeline` table are what a script may rely
on: their shapes change only with a note in the README. The other
tables are the runner's own and may change with any version.

A forecast of the beds, for one, reads the free beds from
`properties.json`, the admissions of the last hours from `timeline`,
and whether hospital-2 is open from `peers.json`.

### The twin stays as it is

The owner decided on 2026-11-23 that a what-if can not change the
live twin. Four things see to that:

- **No token and no address.** The script gets neither `RUNNER_TOKEN`
  nor `RUNNER_URL`. It can not raise an event, write a property or
  escalate. It reads the copy.
- **A copy of the database, not the database.** The script may read
  `state.db` of its copy: the history, the timeline, the values. A
  query on the file of the live twin could hold up the runner's own
  writes, and could not be kept from writing.
- **Access control must be on.** Without `auth.principals` every
  route is open to any process of the host, and a missing token would
  protect nothing. `POST /whatif` is then refused with `409`.
- **The result is not published.** It is no property, and the state
  document does not change.

What it costs: the twin pauses for the save at each what-if, and the
database is copied each time, which takes longer as the timeline
grows.

### Getting the result

What the script prints on stdout is the result. The runner captures
it as it captures the output of every command, and stores it with
the run. The Manager is on another host and can not read a file of
the runner, so the runner hands the result over, in two ways:

- **On request.** `GET /whatif/5` answers the run: its `id`,
  `name`, `status`, `mode`, `receivedAt` and `by`, and once it has
  ended its `exitCode`, its `result`, `finishedAt` and its resource
  figures. `result` is the output parsed as JSON, or the text when it
  is no JSON. From the demo:

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

  An id that is no what-if run gets `404`.

- **By a notification.** When the run ends, the runner sends a
  notification of a new kind, `whatif`, to `<base>/notify/whatif` and
  to the webhook (S3, S7), with the `id`, the `name`, the outcome and
  the result. It is not retained.

An event was considered for this and left out: an event has a name
and no data, it moves the state machine, which a what-if must not,
and a state without a transition for it would escalate.

### Roles

| Route           | `client` | `operator` | `manager`                                            | `script` | `sensor` |
| :-------------- | :------- | :--------- | :--------------------------------------------------- | :------- | :------- |
| `whatif`        | yes      | no         | commands in `whatIf.commands` and `manager.commands` | no       | no       |
| `whatif-result` | yes      | yes        | yes                                                  | no       | no       |

### API changes

| Kind               | Change                                                                                                                               |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| Route              | `POST /whatif`: `202` with `id`; the refusals [above](#asking)                                                                       |
| Route              | `GET /whatif/<id>`: the run; `404` for an id that is no what-if                                                                      |
| MQTT               | `<base>/whatif/set` to ask, `<base>/whatif` with `{"id": 5}` for a result                                                            |
| Notification       | kind `whatif`, on `<base>/notify/whatif` and the webhook                                                                             |
| State machine file | `whatIf.commands`                                                                                                                    |
| Script variables   | `DT_MODE` (`live` or `what-if`) for every script; `DT_WHATIF_DIR` for a what-if; no `RUNNER_TOKEN` and no `RUNNER_URL` for a what-if |
| Timeline           | a `whatif` row with the command and its input; a `sent` row for the notification                                                     |
| History            | `mode: what-if` on the run                                                                                                           |

### Limits

- It is one script. The state machine does not run, and no other
  script of the class does.
- It is as fast as the script. Nothing replays in real time.
- Two what-ifs of one command do not overlap: the second joins the
  first, also while its copy is made.
- A what-if of a command that runs live is refused with `409`
  `command running`, and makes no copy.
- A live run of a command whose what-if runs is refused with `409`
  `what-if running`, with or without input, over HTTP and MQTT. The
  live twin never takes the output of a what-if. No state shares a
  command with a what-if, so a what-if never holds up or is stopped by
  a transition.
- A what-if that the shutdown stops sends no `whatif` notification;
  its copy is removed.

### Not in this issue

- A second twin, and replays of a recorded period:
  [25](25-replay.md).
- Publishing a result as a property.
- A model of the physical twin, which is the author's, in the script.
- A Manager that decides from the result.

### Decided

| Question                           | Decision of 2026-11-23                                                             |
| :--------------------------------- | :--------------------------------------------------------------------------------- |
| The route                          | `POST /whatif`, and not `POST /`                                                   |
| Who may ask                        | A Manager, for a command that `manager.commands` lists too; a client               |
| The copy                           | A snapshot in a temporary directory named by the time, with a copy of the database |
| What a what-if may change          | Nothing: no token, no address, no published result                                 |
| The result                         | What the script prints                                                             |
| The reply                          | At once, with an id; the result later                                              |
| Without access control             | Refused                                                                            |
| How the result reaches the Manager | `GET /whatif/<id>`, and a notification on the webhook and over MQTT                |
| A time limit for the script        | None; a client or an operator stops it (2026-11-24)                                |
| What the script may rely on        | The four documents of its copy, and the `timeline` table                           |

### Open questions

1. **How long is a result kept?** With the command history, which has
   no limit now.

## Plan

As built:

1. `src/fsm/class.ts` and `src/fsm/definition.ts`: `whatIf`, with the
   cross-checks: each command is permitted and no state, and
   `snapshot.save` is named.
2. `src/snapshot/snapshots.ts` of [23](23-snapshot.md): `saveInto` a
   directory, without a row and outside the list, with a hook for the
   four documents; `checked()` with the save's checks.
   `src/snapshot/script.ts` stores the save run with mode
   `what-if-copy`.
3. `src/whatif/whatifs.ts` (new, a plain class that
   `DescriptorService` owns): the checks, the copy, the run without a
   token or an address, the join, the removal in a `finally`, the end
   listeners, the stop at shutdown and the leftovers at a start.
   `src/whatif/present.ts` (new): the four documents.
4. `src/whatif.controller.ts` and `src/dto/whatif.dto.ts` (new), the
   MQTT routes in `src/mqtt/mqtt.config.ts` and
   `src/mqtt/mqtt-request.handler.ts`, the two rows of
   `src/auth/roles.ts`, the kind `whatif` in `src/dto/notify.dto.ts`
   and `src/notify/notifier.service.ts`, and in
   `src/dto/timeline.dto.ts` and `src/queue.timeline.ts`.
5. A `mode` column: `src/queue.schema.ts`, `src/queue.service.ts`,
   `src/queue.history.ts`, `src/execa-manager.service.ts` and
   `src/command-result.ts` (`refuseOtherMode`).
6. `src/fsm/script-context.ts`: `DT_MODE` for every script, and no API
   variables for a what-if; the declared `env` moved to
   `src/fsm/declared-env.ts`.
7. `demo/hospital`: `forecast-beds`, `forecast-beds.ps1` and
   `forecast.mjs`, and the chapter "What-if" of
   `tools/steps-peers.mjs`.
8. Documents: a new `WHAT-IF.md` for authors and Managers,
   `README.md`, `STATE-MACHINE.md`, `CLASS-INSTANCE-INTERFACE.md`,
   `SECURITY-MODEL.md`, `PRIVILEGE-SETUP.md`, `DEVELOPER.md`,
   `api/API.md`, `api/*.http`, the demo's README,
   `docs/save-reinstate-what-if.md`, and D55 to D58 in
   `docs/state-machine-design.md`.

## Tasks

- [x] A class with `whatIf.commands` loads; one that names a command
      which is not permitted or is a state, or has no `snapshot.save`,
      is refused. Check: `test/unit/fsm.class.spec.ts`.
- [x] `POST /whatif` answers `202` with an id, and is refused without
      a database, a directory, access control, or a listed command, and
      during a save or a run of the save script. Check:
      `test/e2e/whatif.spec.ts`, `test/e2e/whatif.refuse.spec.ts`,
      `test/e2e/whatif.copy.spec.ts`.
- [x] A second what-if joins the first, also during the copy; a
      what-if of a live run, and a live run of a running what-if, are
      refused. Check: `test/e2e/whatif.run.spec.ts`,
      `test/e2e/whatif.copy.spec.ts`, `test/unit/whatif.spec.ts`.
- [x] The script runs with `DT_MODE=what-if` and a copy that holds a
      database that opens and the four documents, and without
      `RUNNER_TOKEN` and `RUNNER_URL`; the copy is gone after a
      success, a failure, a stop, a shutdown and a crash. Check:
      `test/e2e/whatif.spec.ts`, `test/e2e/whatif.run.spec.ts`,
      `test/e2e/whatif.refuse.spec.ts`,
      `test/unit/script-context.whatif.spec.ts`.
- [x] The state document, the properties and the machine are the same
      before and after a what-if. Check: `test/e2e/whatif.spec.ts`.
- [x] `GET /whatif/<id>` shows the run and its result, and a `whatif`
      notification is sent once at the end, also after `POST /stop`,
      and none after a shutdown. Check: `test/e2e/whatif.spec.ts`,
      `test/e2e/whatif.notify.spec.ts`,
      `test/unit/notifier.whatif.spec.ts`, `test/unit/whatif.spec.ts`.
- [x] The MQTT routes ask and read. Check:
      `test/unit/mqtt-request.whatif.spec.ts`.
- [x] The history marks the run `mode: what-if`. Check:
      `test/integration/queue.whatif.spec.ts`.
- [x] A `manager` may run a command listed in both places and no
      other. Check: `test/unit/auth.roles.spec.ts`,
      `test/e2e/whatif.run.spec.ts`.
- [x] Every other script gets `DT_MODE=live`. Check:
      `test/unit/script-context.spec.ts`.
- [x] The demo asks `forecast-beds` and reads its result. Check:
      `node demo/hospital/tools/record.mjs` and `check-cast.mjs`, twice.
- [x] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [x] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

What the plan did not foresee:

- **A second runner may share the directory of the first.** A replay
  twin started by hand with a copy of the live `runner.yaml` kept its
  `snapshots`, so at its start it removed the `what-if/` copies of the
  live twin, and it saved and ran what-ifs into the live directory.
  The final review found it; a replay twin now has no snapshot
  directory, whatever `runner.yaml` lists.

- **Two runs of one command are one run.** `ExecaManager` joins a
  running command of the same name. A what-if of a command that ran
  live joined that run, which had neither the copy nor the what-if
  environment, and a live request of a command whose what-if ran took
  its output. Each run now carries its mode, a join across modes is
  refused (`what-if running`, `command running`), and a class may not
  use a state as a what-if command, so a state entry never meets a
  what-if.
- **The save of the copy is a run too.** It changed the `command` of
  `GET /state` and sent a state notification, and its id answered
  `GET /whatif/<id>`. It is stored with a mode of its own,
  `what-if-copy`, which `GET /`, the state document and the result
  skip.
- **A check before an `await` can be overtaken.** A live run that
  started while the copy was made was not seen; `begin` checks again
  after the save, and nothing is awaited from there to the start. A
  second request during the copy at first got `503 saving`; the id of
  a what-if is now held from the request, and `whatif` is no longer a
  route that the pause refuses.
- **The shutdown needs its own path.** A what-if whose copy was being
  made was not stopped, and whether its notification went out depended
  on the order of the hooks. `stop()` waits for the copies, stops the
  runs and waits for their removal, and a what-if stopped so tells
  nothing; one stopped by `POST /stop` tells `stopped`.
- **A cleanup must not throw past its caller.** A failed removal of a
  copy became an unhandled rejection; it is logged, and the next start
  removes the copy.
- **The demo shared the snapshot directory.** `record.mjs` reinstated
  from the last name in the directory, which became `what-if/`; it now
  skips that name.
