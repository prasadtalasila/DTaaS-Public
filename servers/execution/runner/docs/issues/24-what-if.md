# 24 What-If Inside the Twin

- Status: planned. The design was settled with the owner on
  2026-11-23.
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
- The class needs `snapshot.save`, which makes the copy.

And the script. It reads the copy and prints its answer:

```bash
#!/usr/bin/env bash
# forecast-beds: the free beds after a horizon, under a scenario
scenario=$(cat)
beds="$DT_WHATIF_DIR/files/ward.json"
database="$DT_WHATIF_DIR/state.db"
free=$(simulate "$beds" "$database" "$scenario")
echo "{\"free-beds\": $free, \"horizon\": \"PT2H\"}"
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

The reply comes at once, as a simulation may take long:

```json
{ "id": 57, "name": "forecast-beds", "status": "running" }
```

`id` is the number of the run in the command history. The Manager
keeps it to ask for the result.

### What the runner does

1. **It makes a private copy.** It saves the twin as in
   [23](23-snapshot.md), with the same pause, into a temporary
   directory named by the time,
   `<snapshots>/what-if/20261123T101502120Z/`. The copy is a
   snapshot: the manifest, `state.db`, the two files, `scripts/`, and
   `files/` from the save script. It also holds the present as four
   documents, listed [below](#what-the-script-reads). No `snapshot`
   row is written, and
   the list of snapshots does not show it.
2. **It answers `202`** with the `id`.
3. **It runs the command**, with the input on stdin and two more
   variables: `DT_MODE=what-if`, and `DT_WHATIF_DIR`, the copy.
4. **It keeps what the script printed** as the result, with the
   outcome, in the command history.
5. **It tells that the run ended**, and **removes the copy**, however
   the script ended.

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

- **On request.** `GET /whatif/57` answers the run: its `status`,
  and once it has ended its `exitCode`, its `result` and its resource
  figures. `result` is the output parsed as JSON, or the text when it
  is no JSON.
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

| Kind               | Change                                                                                                                                                                   |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route              | `POST /whatif`: `202` with `id`; `400` for a command that `whatIf.commands` lacks; `409` without a database, a directory or access control; `503` `saving` during a save |
| Route              | `GET /whatif/<id>`: the run; `404` for an id that is no what-if                                                                                                          |
| MQTT               | `<base>/whatif/set` to ask, `<base>/whatif` with `{"id": 57}` for a result                                                                                               |
| Notification       | kind `whatif`, on `<base>/notify/whatif` and the webhook                                                                                                                 |
| State machine file | `whatIf.commands`                                                                                                                                                        |
| Script variables   | `DT_MODE` (`live` or `what-if`) for every script; `DT_WHATIF_DIR` for a what-if; no `RUNNER_TOKEN` and no `RUNNER_URL` for a what-if                                     |
| Timeline           | a `whatif` row with the command and its input; a `sent` row for the notification                                                                                         |
| History            | `mode: what-if` on the run                                                                                                                                               |

### Limits

- It is one script. The state machine does not run, and no other
  script of the class does.
- It is as fast as the script. Nothing replays in real time.
- Two what-ifs of one command do not overlap: the second joins the
  first, also while its copy is made.
- A what-if of a command that runs live is refused with `409`
  `command running`, and makes no copy.
- A live run of a command whose what-if runs is refused with `409`
  `what-if running`, with or without input, over HTTP and MQTT. A state
  whose command runs as a what-if is not entered (`script running`).
  A stop transition out of a state stops every run of its command, a
  what-if as well. The live twin never takes the output of a what-if.
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

Provisional:

1. `src/fsm/class.ts`: `whatIf`, with the cross-checks: each command
   is permitted, and `snapshot.save` is named.
2. `src/snapshot/snapshot.service.ts` of [23](23-snapshot.md): a save
   into a temporary directory, without a row and outside the list.
3. `src/whatif/whatif.service.ts` (new): the checks, the copy, the
   run without a token or an address, the notification, and the
   removal in a `finally`. `execa-manager.service.ts` is at 241 lines
   and does not grow.
4. `src/whatif.controller.ts` (new), the MQTT routes, the two rows of
   `src/auth/roles.ts`, and the kind `whatif` in
   `src/dto/notify.dto.ts`.
5. `src/fsm/script-context.ts`: `DT_MODE` for every script.
6. `demo/hospital`: `forecast-beds`, and a step of the story where
   the Manager asks and reads the result.
7. Documents: a new `WHAT-IF.md` for authors and Managers,
   `README.md`, `STATE-MACHINE.md`, `SECURITY-MODEL.md`, `api/API.md`,
   `api/*.http`, and decisions in `docs/state-machine-design.md`.

## Tasks

- [x] A class with `whatIf.commands` loads; one that names a command
      which is not permitted, or has no `snapshot.save`, is refused.
      Check: `test/unit/fsm.class.spec.ts`.
- [x] `POST /whatif` answers `202` with an id, and is refused without
      a database, a directory, access control, or a listed command.
      Check: `test/e2e/whatif.spec.ts`, `test/e2e/whatif.refuse.spec.ts`.
- [x] The script runs with `DT_MODE=what-if` and a copy that holds a
      database that opens and the four documents, and without `RUNNER_TOKEN` and
      `RUNNER_URL`; the copy is gone after a success, a failure and a
      stop. Check: `test/e2e/whatif.spec.ts`, `test/e2e/whatif.run.spec.ts`.
- [x] The state document, the properties and the machine are the same
      before and after a what-if. Check: `test/e2e/whatif.spec.ts`.
- [x] `GET /whatif/<id>` shows the run and its result, and a `whatif`
      notification is sent once at the end. Check:
      `test/e2e/whatif.spec.ts`, `test/unit/notifier.whatif.spec.ts`.
- [x] A `manager` may run a command listed in both places and no
      other. Check: `test/unit/auth.roles.spec.ts`,
      `test/e2e/whatif.run.spec.ts`.
- [x] Every other script gets `DT_MODE=live`. Check:
      `test/unit/script-context.spec.ts`.
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [x] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
