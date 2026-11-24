# 23 Save and Reinstate a DT

- Status: in progress, on the branch `runner/23-snapshot`. The design
  was settled with the owner on 2026-11-23; the Spec below says what
  was built, and the demo step is still to do.
- Depends on: [22](22-timeline.md) (the row that a save writes), 21
  (the class that a saved twin belongs to), 15a (the roles)
- PR: none yet
- Research note: lesson 1 of the Fluid Digital Twins paper, in
  [integrated-simulations.md](../integrated-simulations.md#fluid-digital-twins-offloading-and-a-twin-beside-itself).
  The owner asked for the issue with W3, on 2026-11-20.

## Spec

A DT lives in the database file of its runner and in the files of its
scripts. It can not be handed to another host, kept as a copy before
a risky change, or started a second time. This issue lets an operator
save a DT as a snapshot, and start a runner from one.

Saving and reinstating are outside the state machine. They are the
operator's, a new role, and not the Manager's.

### What a snapshot is

A snapshot is a directory, named by the time it was taken. It holds
everything that a runner needs to be this twin again:

```text
snapshots/
└── 20261123T101502120Z/
    ├── snapshot.json
    ├── state.db
    ├── runner.yaml
    ├── hospital.fsm.yaml
    ├── scripts/
    │   ├── open
    │   └── ...
    └── files/
        └── ward.json
```

| Part                   | Written by      | Holds                                                                                                                              |
| :--------------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot.json`        | the runner      | The manifest: what the snapshot is, so that a runner can check it before it opens more                                             |
| `state.db`             | the runner      | A copy of the database: the machine, the parameter values, the properties, the peer switches, the command history and the timeline |
| `runner.yaml`          | the runner      | A copy of the configuration, with the secrets blanked                                                                              |
| the state machine file | the runner      | A copy of the class, under its own name                                                                                            |
| `scripts/`             | the runner      | A copy of the directory of `location`: the scripts of the class                                                                    |
| `files/`               | the save script | What the scripts keep for themselves; absent if the class names no save script                                                     |

The manifest:

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

That is the manifest of a save of the demo's `hospital-1`, in `open`
after one `admit`.

- `seq` is the number of the last row of the
  [timeline](22-timeline.md) before the save. It says where in the
  history of the twin the snapshot sits, and a replay sends the rows
  after it.
- `machine` is where the state machine was: the `state`, or `null`
  before the first transition; the `entry`, the count of state
  entries so far, which goes on from here after a restore; and the
  `status` of the script of that entry.
- Both are a summary for the operator and for the checks. What counts
  is in `state.db`.

Three things explain what is in the directory:

- **The database is the twin.** Without a database file there is
  nothing to save, and a runner that keeps its history in memory
  refuses to: `409` `no database`. The copy is always named
  `state.db`. SQLite makes it in one step, so it needs no journal
  beside it.
- **`runner.yaml` holds what the database does not.** The values that
  an instance sets for its parameters ([21](21-dt-class.md)) are only
  there. A twin restored without them would come back with the
  defaults of the class.
- **The class is the file and the scripts.** A name and a version in
  the manifest do not bring either to another host. The owner decided
  on 2026-11-23 to copy the whole directory of the scripts.

The signing key of the runner is a path in `runner.yaml`, and the key
itself is not copied, unless the operator put it under `location`:
anything there, a key or a database too, is copied with the scripts.

As built:

- Each snapshot directory is created with mode `0700`, as it holds
  the logs and the inputs of commands.
- In the copy of `runner.yaml` the MQTT password, the webhook token and
  the user information of `mqtt.url` are blanked. The copy is written
  from the parsed file, so it has no comments.
- The snapshot directory must lie outside `location`, as each save
  copies `location`; and the state machine file must not be named
  `runner.yaml` when `snapshots` is set, as it would replace the copy
  of the configuration. The runner refuses both when it loads
  `runner.yaml`.

What the scripts keep is known to their author alone, so the class
names two scripts that save and restore it:

```yaml
# the state machine file, the class
snapshot:
  save: save-script
  restore: restore-script
```

Both are commands of `runner.yaml`. Each gets the directory to write
to, or to read from, as `DT_SNAPSHOT_DIR`. A class whose scripts keep
everything in properties needs neither.

The name of the directory is the time in UTC to the millisecond,
without the separators that a file name can not hold on Windows.

### Where snapshots go

```yaml
# runner.yaml, the instance
snapshots:
  directory: 'run/hospital-1/snapshots'
  timeout: 30000
```

`directory` is relative to `runner.yaml`. `timeout` is how long, in
milliseconds, the save script may take; 30 s by default. Without the
section, a save is refused with `409` `no snapshot directory`.

### Saving

`POST /snapshot` saves the twin now:

1. **The runner pauses.** Every request that would change the twin
   is refused with `503` `saving` and `Retry-After: 1`: a transition,
   an event, an escalation, a command, a write of parameters,
   properties or peers, a stop, and a second save. Reads are answered.
   A script that ends during the save has its completion held. An
   event raised from within, by a subscription to a peer, is held in
   the same queue as the completions, and both are handled after the
   save in the order they came.
2. **The runner writes its parts**: the manifest, `state.db`, the two
   files and `scripts/`.
3. **The runner runs the save script**, if the class names one, with
   `DT_SNAPSHOT_DIR` set to `files/`. A script that fails, or passes
   the timeout, fails the save: the directory is removed and the
   reply is `500` with the outcome.
4. **The runner writes a `snapshot` row** to the timeline and
   **unpauses**. The held completions and events are handled in their
   order.

Before it pauses, the runner refuses a save with `409`:

- `no database` and `no snapshot directory`, as above;
- `save script running`, while a run of the save script is in
  progress, for example one that a client started with `POST /`: the
  save would join that run, which has no `DT_SNAPSHOT_DIR`;
- `save script of another account`, with a `message`, for a class
  with a save script under `scripts.user` (18). The script account can
  not write into a directory of mode `0700` that the runner owns, and
  the runner holds no privilege to give it one. The operator keeps what
  the scripts need in properties and names no save script, or leaves
  out `scripts.user`. Staging the files through the run directory,
  which the script account owns, could lift this later.

The row is written after the copy, so `state.db` ends at the row
before it.

The reply is `201`:

```json
{
  "time": "2026-11-24T12:57:05.005Z",
  "seq": 5,
  "path": "run/hospital-1/snapshots/20261124T125705005Z"
}
```

The script of the current state is not stopped, and the entry of the
machine does not change. What that script holds in memory alone is
therefore not saved. This asks nothing new of an author: a restart of
the runner ends every script without a warning (D28), so a script
that survives a restart already keeps what it needs in files or in
properties. Such a script writes a file in one step, to a temporary
name and then a rename, so that a save never copies half of one.

`GET /snapshot` lists the snapshots of the directory, oldest first,
each with its `time`, `seq` and `path`. `DELETE /snapshot/<name>`
removes one.

### Reinstating

Reinstating is a start of a runner, by the operator at a shell, and
has no route:

```bash
runner -c runner.yaml --reinstate snapshots/20261124T125705005Z
```

1. **The runner reads the manifest**, first. It stops if there is
   none, if it is not JSON, or if the `format` is not one it knows.
   It then stops if `runner.yaml` names no database or its database
   exists already, if the class names a restore script and
   `scripts.user` is set (as for a save), or if the class of the
   snapshot has another `id` than that of the state machine file. A
   runner does not write a snapshot over a twin that it has.
2. **It compares, and warns.** The `-c` file of the operator is the
   one that counts, as a moved twin needs another port and other
   paths. The runner names, one line each, every difference between
   it and the copies in the snapshot: another class `version`, each
   instance parameter whose value differs, a state machine file that
   is not the same byte for byte, and each script of the copy that
   `location` lacks or has otherwise.
3. **It copies `state.db`** to the database of `runner.yaml`. The copy
   refuses to overwrite a file, in case one appeared since the check.
4. **It runs the restore script**, if the class names one, with
   `DT_SNAPSHOT_DIR` set to `files/`. A snapshot without `files/`,
   saved without a save script, skips it with a warning. Any failure
   after the copy, of the restore script or of the start, removes the
   copied database, and the runner stops with the error; a later start
   can copy again.
5. **It starts as after any restart.** A stored value that no longer
   fits the class is dropped with a warning, and a command that was
   running is `interrupted`. The machine is in the last state of the
   snapshot, and waits there: the runner starts no script by itself
   (S6, D28), and a caller moves the twin on with an event or a
   transition.
6. **It writes a `start` row** that names the snapshot:
   `reinstated: {id, time, seq}`, those of the manifest.

The reinstated twin has everything that the first had at the save:
the command history with its logs, and the timeline with the inputs
of commands.

The `id` of the instance may differ from that of the snapshot. That
is how a twin moves to another host, and how [25](25-replay.md) makes
a replay twin.

### Taking a twin out of execution

A twin can be saved, shut down, removed from its host, and reinstated
later to go on. The owner decided on 2026-11-23 that a save can stop
the runner in the same step, so that nothing changes after the
snapshot:

```http
POST /snapshot
{ "stop": true }
```

The runner saves as above. It then answers `201`, and shuts down
without taking requests again: the scripts that run are stopped, as
at any shutdown, and the offline notice is sent. The completions held
during the save are not handled, and an event of a peer that came
during it or comes later is dropped, with a line in the log. If the
save fails, the runner answers `500` and goes on running. If the
shutdown fails after a successful save, the runner logs it and the
twin goes on, with its scripts already stopped.

The whole of it:

1. `POST /snapshot` with `{"stop": true}`, and keep the directory.
2. Remove the database and the files of the runner, or the host.
3. Later, on this host or another:
   `runner -c runner.yaml --reinstate <snapshot>`.
4. Send the twin an event or a transition. It waits in its saved
   state as `interrupted`, and the script of that state does not
   start by itself.

What the twin has again: its state, its parameter values, its
properties with the times they were written, its peer switches, its
command history and its timeline. The entry numbers go on from where
they were.

What it does not have:

- **What a running script held in memory.** The script is ended at
  the shutdown, as at any.
- **What its peers last told it.** That is kept in memory. It comes
  back when the peers' retained notices arrive, or with their next
  ones.
- **The replies kept for request keys, and the metrics**, which are
  counted since a start.
- **The time in between.** The properties are as old as they were,
  and their times say so. The physical twin has moved on, and the
  scripts of the class have to catch up with it.

A save without `stop` leaves the runner running. A twin that is shut
down some time after such a save loses what changed in between.

### Version 0.12.0

The owner decided on 2026-11-24 that this issue takes the runner to
0.12.0 and removes what 0.11 kept for one version:

| Removed                                          | Use instead                                           |
| :----------------------------------------------- | :---------------------------------------------------- |
| `notify` and `peers` at the top of `runner.yaml` | `relationships.manager.notify`, `relationships.peers` |
| `type: enum` with `values`, for a parameter      | `type: string` with `enum`                            |
| The MQTT topics `set-parameters` and `set-peers` | `parameters/set` and `peers/set`                      |

A file or a request that uses one is refused, with the strict schema
or as an unknown topic. `src/config/layout.ts` and its tests go, with
the warning for old enums and the table of old topics.

### Roles

The owner decided on 2026-11-23 on a fifth role, `operator`: whoever
runs the runner. An operator keeps the twin running and can copy it,
and does not steer it. A Manager steers it and can not copy it.

| Route                                                                              | `client` | `operator` | `manager`               | `script` | `sensor` |
| :--------------------------------------------------------------------------------- | :------- | :--------- | :---------------------- | :------- | :------- |
| `health`                                                                           | open     | open       | open                    | open     | open     |
| reads: `dt`, `state`, `fsm`, `status`, `history`, `metrics`, `parameters`, `peers` | yes      | yes        | yes                     | yes      | no       |
| `properties`                                                                       | yes      | yes        | yes                     | yes      | yes      |
| `timeline` (22)                                                                    | yes      | yes        | yes                     | yes      | no       |
| `snapshots` (the list)                                                             | yes      | yes        | no                      | no       | no       |
| `save`, `delete-snapshot`                                                          | yes      | yes        | no                      | no       | no       |
| `stop`                                                                             | yes      | yes        | no                      | no       | no       |
| `execute`                                                                          | yes      | no         | `manager.commands` only | no       | no       |
| `transition`                                                                       | yes      | no         | no                      | no       | no       |
| `event`, `escalate`                                                                | yes      | no         | no                      | yes      | no       |
| `set-parameters`, `set-peers`                                                      | yes      | no         | yes                     | no       | no       |
| `set-properties`                                                                   | yes      | no         | no                      | yes      | yes      |

A `client` keeps every right (S10). It is the owner of the twin, or
an application that acts for the owner, and the tests. The route
names are those of the `403` message; `delete-snapshot` is a route of
HTTP alone. An `operator`, like a `client`, reads the `input` of a
command row of the timeline.

### API changes

| Kind               | Change                                                                                                                                                                     |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route              | `POST /snapshot`, with `{"stop": true}` to shut down after it: `201` with `time`, `seq`, `path`; `409` with one of four statuses (above); `500` when the save script fails |
| Route              | `GET /snapshot`: the list                                                                                                                                                  |
| Route              | `DELETE /snapshot/<name>`: `204`, or `404`                                                                                                                                 |
| MQTT               | `<base>/snapshot` to list and `<base>/snapshot/set` to save, with the same replies; no topic to delete                                                                     |
| Reply              | `503` `saving` on every changing route while a save runs, with `Retry-After`                                                                                               |
| Role               | `operator` in `auth.principals`, with the rights above; `403` messages name it                                                                                             |
| `runner.yaml`      | `snapshots.directory`, `snapshots.timeout`                                                                                                                                 |
| State machine file | `snapshot.save`, `snapshot.restore`, each a command of `runner.yaml`                                                                                                       |
| Script variable    | `DT_SNAPSHOT_DIR`, for the two scripts only                                                                                                                                |
| Command line       | `--reinstate <directory>`                                                                                                                                                  |
| Timeline           | a `snapshot` row; a `start` row that names the snapshot it was reinstated from                                                                                             |
| Health             | `saving: true` while a save runs                                                                                                                                           |

### Not in this issue

- A snapshot of an earlier moment. A twin is taken back in time by
  reinstating the last snapshot before the moment and sending it the
  inputs since, which [25](25-replay.md) does.
- Saves at intervals. An operator calls the route from a scheduler.
- Reinstating into a runner that is running.
- Signing a snapshot.
- Copying a snapshot to another host: it is a directory.
- Removing personal data from a snapshot. It holds the logs and the
  inputs of commands, and goes wherever the directory goes.

### Decided

| Question                                                     | Decision of 2026-11-23                                                                               |
| :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| What the scripts keep                                        | The class names a save and a restore script                                                          |
| Inside or outside the machine                                | Outside: a route with a pause, no save state                                                         |
| Who saves                                                    | `operator` and `client`; not `manager`                                                               |
| How snapshots are told apart                                 | By the time they were taken                                                                          |
| What a snapshot holds                                        | The database, the configuration, the state machine file, the scripts, and what the save script wrote |
| During a save                                                | Requests that change the twin are refused                                                            |
| What a reinstated twin has                                   | Everything in the database; it is in the last saved state                                            |
| What a reinstated twin does                                  | It waits, as `interrupted`, for a caller                                                             |
| Reinstating                                                  | At a start only, by the operator                                                                     |
| Taking a twin out of execution                               | A save can stop the runner in the same step                                                          |
| When the configuration or the scripts differ from the copies | The runner warns and goes on (2026-11-24)                                                            |
| The version                                                  | 0.12.0, with the deprecated keys, spelling and topics removed (2026-11-24)                           |

### Settled in the build

1. **A running script learns nothing of a save.** The runner sends no
   signal, as Windows has none such as `SIGUSR1`. A script writes its
   files in one step and keeps what must survive in files or
   properties, as for a restart; `STATE-MACHINE.md` says so.
2. **The whole of `scripts/` is copied at every save.** A class with a
   large simulator in `location` makes every snapshot as large; the
   README says so.

### Open questions

1. **Staging for `scripts.user`.** A save script and a restore script
   could write and read a directory under the run directory, which the
   script account owns, and the runner could move it into the snapshot
   and back. Until then such a class is refused under `scripts.user`.

## Plan

Provisional:

0. `package.json` to `0.12.0`, and the removals of the table above,
   as a first commit.
1. `src/auth/auth.config.ts`, `src/auth/roles.ts`: the role and the
   rows of the table.
2. `src/config/config.schema.ts`: `snapshots`. `src/fsm/class.ts`:
   `snapshot`, with a cross-check that both names are commands.
3. `src/snapshot/snapshot.ts` (new): the manifest, the copy of the
   database with SQLite's `VACUUM INTO`, and the copies of the two
   files, with the secrets blanked, and of the scripts.
   `src/snapshot/store.ts` (new): the directories, their names, the
   list and the removal.
4. `src/snapshot/pause.ts` (new): a plain class that the guard and the
   MQTT handler ask before a changing route, and that holds the
   completions. `FsmService` is at 248 lines, so the hold goes where
   `run` awaits the outcome of a script, as one call.
5. `src/snapshot/snapshot.service.ts` (new): the four steps of a
   save, with the timeout.
6. `src/snapshot.controller.ts` (new) and the MQTT routes.
7. `src/config/commander.ts`: `--reinstate`. `src/snapshot/reinstate.ts`
   (new): steps 1 to 4 of reinstating, called from `src/main.ts`
   before the database opens; the restore that follows is today's.
8. `demo/hospital`: `save-script` and `restore-script`, which copy
   `ward.json`, in both script languages.
9. Documents: `README.md`, `STATE-MACHINE.md`,
   `CLASS-INSTANCE-INTERFACE.md` (moving a twin), `SECURITY-MODEL.md`
   (the role), `api/API.md`, `api/*.http`, and decisions in
   `docs/state-machine-design.md` that amend D12 and D28.

## Tasks

- [x] The old keys, the old enum and the old topics are refused, and
      nothing in the samples, the demo and the documents uses one.
      Check: `test/unit/config.schema.spec.ts`,
      `test/unit/fsm.parameters.schema.spec.ts`,
      `test/unit/mqtt.request-topics.spec.ts`.
- [x] `operator` has the rights of the table, and no other role
      gained or lost one. Check: `test/unit/auth.roles.spec.ts`,
      `test/e2e/snapshot.access.spec.ts`.
- [x] A save writes the manifest, a database that opens and ends at
      the row before the save, the two files without their secrets and
      the scripts, and runs the save script with its directory; the
      list shows it; a removal removes it. A runner without a database
      file refuses. Check:
      `test/unit/snapshot.spec.ts`, `test/unit/snapshot.save.spec.ts`,
      `test/unit/snapshot.refuse.spec.ts`, `test/e2e/snapshot.spec.ts`,
      `test/e2e/mqtt.snapshot.spec.ts`.
- [x] While a save runs, each changing route answers `503` `saving`,
      each read answers, and a script that ends has its completion
      handled after. Check: `test/unit/snapshot.pause.spec.ts`,
      `test/unit/auth.guard.spec.ts`,
      `test/unit/mqtt-request.snapshot.spec.ts`,
      `test/e2e/snapshot.during.spec.ts`.
- [x] A save with `stop` answers, then shuts the runner down with
      nothing changed after the snapshot; when the save fails the
      runner goes on. A twin saved so, removed and reinstated has its
      history and goes on at the next request. Check:
      `test/e2e/snapshot.stop.spec.ts`, `test/e2e/snapshot.fail.spec.ts`,
      `test/e2e/reinstate.stop.spec.ts`.
- [x] A save script that fails or runs past the timeout leaves no
      directory, and the twin goes on. Check:
      `test/e2e/snapshot.fail.spec.ts`.
- [x] A runner started with `--reinstate` has the history, the
      timeline and the state of the snapshot under its own `id`, has
      run the restore script, waits in the saved state as
      `interrupted`, and names the snapshot in a `start` row. Check:
      `test/e2e/reinstate.spec.ts`.
- [x] It refuses a database that exists, a class with another `id`
      and a directory that is no snapshot; it stops, and leaves no
      database, when the restore script fails; it warns of instance
      values and scripts that differ from the copies. Check:
      `test/e2e/reinstate.refuse.spec.ts`,
      `test/unit/snapshot.reinstate.spec.ts`,
      `test/e2e/dist.spec.ts`.
- [ ] The demo hospital is saved, reinstated on another port, and has
      its patients. Check: a step of `demo/hospital/tools/steps.mjs`.
- [x] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [x] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

What the plan did not foresee:

- **A pause of the routes does not freeze the twin.** The plan held
  the completions of scripts and refused the changing routes. An event
  raised by a subscription to a peer still moved the machine during a
  save, and after a save with `stop` it could move it after the
  `snapshot` row. Such events now wait in the queue of the
  completions, in one order, and are dropped once the runner goes
  down.
- **The pause needs an end on every path.** The `snapshot` row was
  written outside the code that ended the pause, and a failed shutdown
  left the twin paused for good. The pause now ends in a `finally`,
  except for the one path that shuts down, and a shutdown that fails
  ends it there.
- **A save could join another run of its script.** `newCommand` joins
  a running command of the same name, so a save during a client's run
  of the save script took that run's result, without
  `DT_SNAPSHOT_DIR`. It is refused with `409` `save script running`.
- **The script account can not reach a snapshot.** Under
  `scripts.user` the runner has `CAP_SETUID` and `CAP_SETGID` only, can
  not change an owner, and makes each snapshot `0700`. No layout that
  the operator prepares once fits every new directory, so the save and
  the reinstate of a class with such scripts are refused.
- **Paths can collide.** A snapshot directory inside `location` made
  every save copy the scripts into themselves, and a state machine file
  named `runner.yaml` replaced the copy of the configuration. Both are
  refused at load.
- **Secrets hide in more keys than planned.** `mqtt.url` may hold a
  user and a password, which the copy blanks too; the copy is written
  from the parsed file and loses the comments.
- **A cleanup must remove only what it wrote.** Reinstating first
  removed the copied database only when the restore script failed;
  any other failure left a file that refused every later start. A
  `try` now covers everything after the copy, and the copy itself
  refuses to overwrite (`COPYFILE_EXCL`), so the cleanup never removes
  a file that it did not write.
- **The order of the checks matters to the operator.** The manifest
  is read first, so a directory that is no snapshot is named as such
  even when a database exists; a snapshot without `files/` skips the
  restore script with a warning instead of passing it a missing
  directory.
- **Holding in order needs one queue.** A first version let held
  completions await a shared gate, and a later event ran before an
  earlier completion; a test caught it. Each waiting item now goes on
  one microtask after the save ends, in the order it came.
- **The constructor limit placed the code.** `Snapshots` is a plain
  class owned by `DescriptorService`, and `fsm.manager` became public
  for it, as no injectable could reach the MQTT handler without a
  fourth parameter.
