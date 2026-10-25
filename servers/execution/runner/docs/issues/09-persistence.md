# 09 Persist the Machine Across Restarts

- Status: planned
- Depends on: 03, 04, 10
- PR: none
- Research note:
  [item 9](../dtn-research-notes.md#9-persist-the-machine-across-restarts)

## Spec

A DT that forgets its state on restart reports a wrong state to the
Manager (P1 R1), and P2's orchestrator moves and restarts DTs at
runtime. D12 of the design document kept the machine in memory because
nothing asked for recovery; this feature stores it and restores it.

### What is stored

In the SQLite database that `Queue` already manages, on every change:

- the machine's current state, entry counter and script status, as one
  row;
- parameter values (already stored by 04).

With `database` in `runner.yaml` the store survives a restart. Without
it the database is in memory and a restart starts fresh, as today; the
code path is the same, there is nothing to restore.

### Recovery

At startup, after the configuration and the state machine file are
loaded and the database is open:

1. If no row is stored, the machine starts unstarted.
1. If the stored state is not in the current definition (the file
   changed), the runner logs a warning naming the state and starts
   unstarted.
1. Otherwise the state and entry counter are restored. If the stored
   status was `running`, the status becomes `interrupted`: the script
   did not finish and is not re-run. A `commands` row with no
   `finished_at` is marked `interrupted` with the startup time, so
   `GET /` and `GET /history` agree.
1. Parameter values are restored from their table.
1. The state notification of 03 is published, so the Manager sees the
   restored state and the `interrupted` status.

`interrupted` is a new `ScriptStatus`. The machine is idle in it: a
transition request is accepted (D7), and an event with a transition
moves it on. No script is started on recovery, so a crash loop cannot
run the same script forever; the Manager or a client decides what an
interrupted DT should do, with `POST /stop` (10) not needed because
nothing runs.

## Plan

1. Add a `machine` table (single row: `state`, `entry`, `status`,
   `updated_at`) to `src/queue.service.ts` with `saveMachine` and
   `loadMachine`, and `markInterrupted(time)` for unfinished commands.
1. Let `StateMachine` (`src/fsm/state-machine.ts`) be constructed with
   an initial state and entry, and let `FsmService` write the row from
   `enter` and `run` and add `interrupted` to `ScriptStatus`
   (`src/dto/fsm.dto.ts`).
1. Reorder `bootstrap` in `src/main.ts` so `Queue.open` precedes
   `FsmService.load`, and add `FsmService.restore()` after both, which
   applies the recovery rules and emits `state` on `Changes`.
1. Restore parameter values in `ParametersService` from `Queue` at the
   same point.
1. Document the behaviour in `README.md` (Command History, State
   Machine: replace the lines that say the machine is lost on restart),
   replace D12 in the design document and add a decision for
   `interrupted`.

## Tasks

- [ ] `Queue` saves and loads the machine row and marks unfinished
      commands interrupted, with a file database and in memory. Check:
      `test/integration/queue.service.spec.ts`.
- [ ] `FsmService.restore` applies the four rules: nothing stored,
      unknown state, restored idle state, restored running state as
      `interrupted`; it emits one state notification. Check:
      `test/unit/fsm.service.spec.ts` against a fake `Queue`.
- [ ] From `interrupted`, a transition is accepted and an event with a
      transition moves the machine. Check:
      `test/unit/fsm.service.spec.ts`.
- [ ] Parameter values survive a restore. Check:
      `test/unit/parameters.service.spec.ts`.
- [ ] Two runner instances started in turn on one database file: the
      second reports the first's state, `interrupted` when the first
      was killed mid-script. Check: `test/e2e/restart.spec.ts`.
- [ ] README and design document (D12) updated. Check:
      `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
