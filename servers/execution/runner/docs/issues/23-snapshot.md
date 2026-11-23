# 23 Save and Reinstate a DT

- Status: planned. The design was settled with the owner on
  2026-11-23; two smaller questions are open below.
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

A snapshot is a directory, named by the time it was taken:

```text
snapshots/
└── 20261123T101502120Z/
    ├── snapshot.json
    └── files/
        └── ward.json
```

`snapshot.json` is the runner's part, what the runner itself knows of
the twin:

```json
{
  "format": 1,
  "id": "hospital-1",
  "class": { "id": "urn:dtaas:demo:hospital", "version": "1.0.0" },
  "time": "2026-11-23T10:15:02.120Z",
  "seq": 412,
  "machine": { "state": "open", "entry": 7, "status": "running" },
  "parameters": { "scope": "multi", "capacity": 2, "fidelity": "high" },
  "properties": {
    "free-beds": {
      "value": 1,
      "time": "2026-11-23T10:14:58.000Z",
      "by": "script"
    }
  },
  "peers": { "hospital-2": true }
}
```

`files/` is the scripts' part: whatever the scripts of the class keep
for themselves. Only the author's scripts know what that is, so the
class names two scripts that save and restore it:

```yaml
# the state machine file, the class
snapshot:
  save: save-state
  restore: restore-state
```

Both are commands of `runner.yaml`. Each gets the directory to write
to, or to read from, as `DT_SNAPSHOT_DIR`. A class whose scripts keep
everything in properties needs neither, and its snapshots have no
`files/`.

A snapshot holds neither `runner.yaml`, nor keys, nor the command
history, nor the timeline. `seq` says which row of the
[timeline](22-timeline.md) it was taken after.

The name of the directory is the time in UTC to the millisecond,
without the separators that a file name can not hold on Windows. Two
snapshots can not share a name, as a save takes longer than that.

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
   is answered `503` `saving`: a transition, an event, a command, a
   write of parameters, properties or peers, a stop. Reads are
   answered. A script that ends during the save has its completion
   held.
2. **The runner writes `snapshot.json`.**
3. **The runner runs the save script**, if the class names one, with
   `DT_SNAPSHOT_DIR` set to `files/`. A script that fails, or passes
   the timeout, fails the save: the directory is removed and the
   reply is `500` with the outcome.
4. **The runner writes a `snapshot` row** to the timeline and
   **unpauses**. The held completions are handled in their order.

The reply is `201`:

```json
{
  "time": "2026-11-23T10:15:02.120Z",
  "seq": 412,
  "path": "run/hospital-1/snapshots/20261123T101502120Z"
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
runner -c runner.yaml --reinstate snapshots/20261123T101502120Z
```

1. The database of `runner.yaml` must be new or empty. A runner does
   not write a snapshot over a twin that it has.
2. The class of the snapshot must be the class of the state machine
   file: the same `id`. Another `version` is allowed and logged, and
   the values are then checked as at any restart (see
   [A New Version of a Class](../../CLASS-INSTANCE-INTERFACE.md#a-new-version-of-a-class)).
3. The runner stores the machine, the parameter values, the
   properties and the peer switches of the snapshot.
4. The runner runs the restore script, if the class names one, with
   `DT_SNAPSHOT_DIR` set to `files/`. If it fails, the runner stops
   with its error, and the database is left empty.
5. The runner enters the saved state as a new entry, so that its
   script runs and the twin works at once. The operator's command is
   the request for it, so the runner still starts no script by itself
   (S6). A snapshot of an unstarted machine starts unstarted.
6. The timeline of the new database begins with a `start` row that
   names the snapshot: the `id`, the `time` and the `seq` it came
   from.

The `id` of the instance may differ from that of the snapshot. That
is how a twin moves to another host, and how [24](24-what-if.md)
makes a fork.

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
| `snapshots`: list                                                                  | yes      | yes        | no                      | no       | no       |
| `save`, `delete-snapshot`                                                          | yes      | yes        | no                      | no       | no       |
| `stop`                                                                             | yes      | yes        | no                      | no       | no       |
| `execute`                                                                          | yes      | no         | `manager.commands` only | no       | no       |
| `transition`                                                                       | yes      | no         | no                      | no       | no       |
| `event`, `escalate`                                                                | yes      | no         | no                      | yes      | no       |
| `set-parameters`, `set-peers`                                                      | yes      | no         | yes                     | no       | no       |
| `set-properties`                                                                   | yes      | no         | no                      | yes      | yes      |

A `client` keeps every right (S10). It is the owner of the twin, or
an application that acts for the owner, and the tests.

### API changes

| Kind               | Change                                                                                                          |
| :----------------- | :-------------------------------------------------------------------------------------------------------------- |
| Route              | `POST /snapshot`: `201` with `time`, `seq`, `path`; `409` without a directory; `500` when the save script fails |
| Route              | `GET /snapshot`: the list                                                                                       |
| Route              | `DELETE /snapshot/<name>`: `204`, or `404`                                                                      |
| MQTT               | `<base>/snapshot` to list, `<base>/snapshot/set` to save, with the same replies; no topic to delete             |
| Reply              | `503` `saving` on every changing route while a save runs, with `Retry-After`                                    |
| Role               | `operator` in `auth.principals`, with the rights above; `403` messages name it                                  |
| `runner.yaml`      | `snapshots.directory`, `snapshots.timeout`                                                                      |
| State machine file | `snapshot.save`, `snapshot.restore`, each a command of `runner.yaml`                                            |
| Script variable    | `DT_SNAPSHOT_DIR`, for the two scripts only                                                                     |
| Command line       | `--reinstate <directory>`                                                                                       |
| Timeline           | a `snapshot` row; a `start` row that names the snapshot it was reinstated from                                  |
| Health             | `saving: true` while a save runs                                                                                |

### Not in this issue

- A snapshot of an earlier moment. The runner's part of any moment
  follows from the timeline, but the scripts' part exists only where a
  save took it. A twin is taken back in time by reinstating the last
  snapshot before the moment and sending it the inputs since, which
  [24](24-what-if.md) does.
- Saves at intervals. An operator calls the route from a scheduler.
- Reinstating into a runner that is running.
- Signing a snapshot.
- Copying a snapshot to another host: it is a directory.

### Decided

| Question                      | Decision of 2026-11-23                                                        |
| :---------------------------- | :---------------------------------------------------------------------------- |
| What the scripts keep         | The class names a save and a restore script; no rule, no packed run directory |
| Inside or outside the machine | Outside: a route with a pause, no save state and no `$previous`               |
| Who saves                     | `operator` and `client`; not `manager`                                        |
| How snapshots are told apart  | By the time they were taken                                                   |
| What a reinstated twin does   | It enters the saved state as a new entry                                      |
| Reinstating                   | At a start only, by the operator                                              |

### Open questions

1. **Held or refused?** During a save, a changing request is refused
   with `503`. It could be held and answered after the save. A hold
   is kinder to a script that writes a property every second, and
   harder to bound. The plan refuses.
2. **Does the save script see the pause?** A script of a state that
   wants to flush before a save has no signal for it. The runner
   could send one, such as `SIGUSR1`, which Windows does not have.
   The plan sends none.

## Plan

Provisional:

1. `src/auth/auth.config.ts`, `src/auth/roles.ts`: the role and the
   rows of the table.
2. `src/config/config.schema.ts`: `snapshots`. `src/fsm/class.ts`:
   `snapshot`, with a cross-check that both names are commands.
3. `src/snapshot/snapshot.ts` (new): the document, from the state.
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
   (new): steps 1 to 5 of reinstating, called from `src/main.ts`
   between the open of the database and `FsmService.restore()`.
8. `demo/hospital`: `save-state` and `restore-state`, which copy
   `ward.json`, in both script languages.
9. Documents: `README.md`, `STATE-MACHINE.md`,
   `CLASS-INSTANCE-INTERFACE.md` (moving a twin), `SECURITY-MODEL.md`
   (the role), `api/API.md`, `api/*.http`, and decisions in
   `docs/state-machine-design.md` that amend D12 and D28.

## Tasks

- [ ] `operator` has the rights of the table, and no other role
      gained or lost one. Check: `test/unit/auth.roles.spec.ts`.
- [ ] A save writes the document and runs the save script with its
      directory; the list shows it; a removal removes it. Check:
      `test/unit/snapshot.spec.ts`, `test/e2e/snapshot.spec.ts`.
- [ ] While a save runs, each changing route answers `503` `saving`,
      each read answers, and a script that ends has its completion
      handled after. Check: `test/unit/snapshot.pause.spec.ts`,
      `test/e2e/snapshot.spec.ts`.
- [ ] A save script that fails or runs past the timeout leaves no
      directory, and the twin goes on. Check:
      `test/e2e/snapshot.spec.ts`.
- [ ] A runner started with `--reinstate` has the state of the
      snapshot under its own `id`, has run the restore script, is in
      the saved state as a new entry, and names the snapshot in its
      first row. Check: `test/e2e/reinstate.spec.ts`.
- [ ] It refuses a database that is not empty, a class with another
      `id` and a directory that is no snapshot, and it stops when the
      restore script fails. Check: `test/e2e/reinstate.spec.ts`.
- [ ] The demo hospital is saved, reinstated on another port, and has
      its patients. Check: a step of `demo/hospital/tools/steps.mjs`.
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
