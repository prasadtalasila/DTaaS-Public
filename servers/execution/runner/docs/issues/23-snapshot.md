# 23 Save and Reinstate a DT

- Status: planned. The open questions below are for the owner.
- Depends on: [22](22-timeline.md) (the state at every row), 21 (the
  class that a saved twin belongs to)
- PR: none yet
- Research note: lesson 1 of the Fluid Digital Twins paper, in
  [integrated-simulations.md](../integrated-simulations.md#fluid-digital-twins-offloading-and-a-twin-beside-itself),
  bears on question 1. The owner asked for the issue with W3, on
  2026-11-20.

## Spec

A DT lives in the database file of its runner. It can not be handed
to another host, kept as a copy before a risky change, or started
again from an earlier moment. This issue lets a caller save a DT as
one document, a snapshot, and start a runner from one.

### The snapshot

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

It holds what the runner itself knows of the twin: the machine, the
values of the parameters and properties, and the switches of the
peers. `seq` is the row of the [timeline](22-timeline.md) that it was
taken at.

It does not hold:

- `runner.yaml`, the keys, or anything else of the instance: the
  reinstating operator writes those;
- the command history and the timeline, which stay with the database;
- what the scripts keep for themselves. See the open questions.

### Saving

`GET /snapshot` answers the snapshot of this moment.
`GET /snapshot?seq=412` answers the one of an earlier moment: the
state after that row of the timeline, built from the `start` row
before it and the rows between. `GET /snapshot?time=...` answers the
one after the last row at or before that time. A `seq` or a time
before the first row is refused. Only a `client` may save, as a
snapshot is a copy of the twin.

### Reinstating

A runner starts from a snapshot with a new option:

```bash
runner -c runner.yaml --reinstate snapshot.json
```

- The database of `runner.yaml` must be new or empty. A runner does
  not write a snapshot over a twin that it already has.
- The class of the snapshot must be the class of the state machine
  file: the same `id`. Another `version` is allowed and logged, and
  the values are then checked as at any restart (see
  [A New Version of a Class](../../CLASS-INSTANCE-INTERFACE.md#a-new-version-of-a-class)):
  a state that is gone starts the machine unstarted, and a value that
  no longer fits is dropped, each with a warning.
- The `id` of the instance may differ. That is how a twin moves, and
  how [24](24-what-if.md) makes a fork.
- The timeline of the new database starts with a `start` row that
  names the snapshot: the `id`, the `seq` and the `time` it came from.

### Not in this issue

- Reinstating into a runner that is running.
- Moving the command history or the timeline.
- Signing a snapshot, so that a runner can refuse one it does not
  trust.
- Copying the snapshot to another host: it is a file.

### Open questions

1. **What the scripts keep.** The runner knows the properties, not
   the files of the scripts. In the demo, the beds are in
   `run/hospital-1/ward.json`. A twin reinstated without that file
   has `free-beds: 1` and four empty beds. Three ways out:
   - **A rule for authors:** what a twin needs to go on must be in
     its properties, and a script reads them at its start. An object
     property can hold the wards. The runner needs nothing new.
   - **The run directory in the snapshot:** the runner packs
     `scripts.runDirectory` with the document. It then holds data of
     any size, and data the runner can not check.
   - **Declared files:** the class lists the files to keep.

   The plan assumes the rule, and says so to authors. A twin with a
   large simulation state needs one of the other two.

2. **What happens to the script.** The owner decided on 2026-11-23
   that a reinstated twin goes to the state of the snapshot. That
   leaves one thing to confirm. The saved machine may be in a state
   whose script was running, and no script survives a move. Either:
   - the machine is in the state with the status `interrupted`, and a
     caller moves it on, as after any restart today (S6, D28); or
   - the runner enters the state again, as a new entry, so that its
     script runs and the twin works at once.

   The plan keeps the first until the owner says which was meant.

3. **At a start, or while running.** `--reinstate` needs a restart
   and an empty database. A route, `PUT /snapshot`, could replace the
   state of a running, idle runner. It is more to get wrong: the
   requests in flight, the notifications, the stored rows. The plan
   has the option only.
4. **Who may save.** A snapshot of an earlier moment is as much as
   the timeline shows, which a `manager` may read. A snapshot is also
   what makes a second twin. The plan gives it to `client` only.

## Plan

Provisional, on the assumptions above:

1. `src/dto/snapshot.dto.ts` (new): the document and its schema.
2. `src/snapshot.ts` (new): builds a snapshot from the present state,
   or by applying the rows of the timeline from a `start` row on.
3. `src/snapshot.controller.ts` (new), the MQTT route `snapshot`, and
   its row of `src/auth/roles.ts`.
4. `src/config/commander.ts`: the option `--reinstate <file>`.
   `src/main.ts`: after the database opens and before
   `FsmService.restore()`, a new step writes the machine, the
   parameter values, the properties and the peer switches of the
   snapshot into the empty database. The restore that follows then
   checks them as it checks any stored value.
5. Documents: `README.md`, `CLASS-INSTANCE-INTERFACE.md` (moving a
   twin), `api/API.md`, and decisions in
   `docs/state-machine-design.md` that amend D12 and D28.

## Tasks

- [ ] A snapshot of the present holds the machine, the parameters,
      the properties and the peer switches. Check:
      `test/unit/snapshot.spec.ts`.
- [ ] A snapshot of an earlier `seq` or time equals the one that was
      taken then, also across a restart of the runner. Check:
      `test/unit/snapshot.spec.ts`, `test/e2e/snapshot.spec.ts`.
- [ ] A runner started with `--reinstate` shows the state of the
      snapshot, under its own `id`, and its timeline starts with the
      source. Check: `test/e2e/reinstate.spec.ts`.
- [ ] It refuses a database that is not empty, a class with another
      `id`, and a file that is no snapshot; another `version` is
      logged, and a value that no longer fits is dropped. Check:
      `test/e2e/reinstate.spec.ts`.
- [ ] Only a `client` may save. Check: `test/unit/auth.roles.spec.ts`.
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
