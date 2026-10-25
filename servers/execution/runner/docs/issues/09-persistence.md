# 09 Persist the Machine Across Restarts

- Status: in progress
- Depends on: 03, 04, 10; implemented after 06 and 08
- PR: none
- Research note:
  [item 9](../dtn-research-notes.md#9-persist-the-machine-across-restarts)

## Spec

A DT that forgets its state on restart reports a wrong state to the
Manager (P1 R1), and P2's orchestrator moves and restarts DTs at
runtime. D12 of the design document kept the machine in memory because
nothing asked for recovery; this feature stores it and restores it.

### What is stored

In the SQLite database that `Queue` already manages:

- the machine's current state, entry counter and script status, as one
  row of a new `machine` table, written on every entry (`enter`,
  `enterStopping`) and every completion (`run`);
- parameter values, already stored by 04.

With `database` in `runner.yaml` the store survives a restart; in
memory nothing is restored. The reply does not depend on the write: a
failed write is logged. During a graceful shutdown (D14 stands), a
script that finishes still has its status stored and only its
completion transition is skipped, so it is not reported `interrupted`.

### Recovery

`main.ts` runs, in order: the configuration, `FsmService.load()`,
`Queue.open(database)`, `FsmService.restore()`, MQTT, `listen` (08
moves MQTT after `listen`; `restore` comes before both, so no request
reaches the machine before it). `restore()`:

1. Marks every `commands` row without `finished_at` as `interrupted`,
   with the startup time as `finished_at`, with or without a state
   machine: no script survives a restart.
1. Without a state machine in `runner.yaml`, ignores a stored machine
   row, logs that it did so with the stored state, and keeps the row.
1. Otherwise applies the four recovery rules:
   - no row, or a row of an unstarted machine: unstarted, with the
     stored entry counter (`0` without a row), status `none`;
   - a stored state that is no longer in the definition: a warning
     naming the state, then unstarted with status `none`, but the
     stored entry counter kept, so entry numbers never repeat for a
     Manager;
   - a stored state with status `running`: that state and entry, with
     status `interrupted`: the script did not finish and is not re-run;
   - a stored state with any other status: that state, entry and
     status.

   It then writes the recovered machine back, so a stale or `running`
   row is overwritten at once.

1. Restores a stored parameter value only if the parameter is still
   declared and the value fits its declaration. Others (removed
   parameter, changed type, removed enum value) are dropped with one
   warning, at each start until set again, and start at the default.
   Controllability is not checked; no declared event is raised (S6).
1. Sends no notification of its own: 03's `Notifier` subscribes in
   `onModuleInit` and sends the startup document from
   `onApplicationBootstrap`, both run by `listen` (`app.init()` in
   tests) after `restore()`, so that document is the restored one.

`interrupted` is a new `ScriptStatus` and `CommandStateStatus`. The
machine is idle in it: a transition request is accepted (D7), and an
event with a transition moves it on. No script starts on recovery, so a
crash loop cannot rerun a script forever; the Manager decides what
comes next. Transitions are not added to the history (11).

After a restart, `GET /fsm` of a runner killed while `execute` ran:

```json
{ "state": "execute", "status": "interrupted", "entry": 3, "events": ["stop"] }
```

`GET /` and `GET /state` show its command as `interrupted`. A repeat of
that command's request key is `failed` at the manager (`storedResult`
maps any status it does not know to `failed`): `400 invalid command`
before 05, `200 failed` after it.

## Plan

1. Start after 06 and 08 merge; make room first in
   `src/fsm/fsm.service.ts` (249 lines; about 247 after 06's moves and
   08's net 14). 09 adds about 14 even with step 6's `MachineStore`.
   Moves, behaviour unchanged: `isCurrent` folds into its one remaining
   caller, the start check of `run` (-4); the refusal logging of
   `raise` and `complete` becomes one `logStay(logger, reply, event)` in
   06's `src/fsm/requests.ts` (-9). That leaves about 248; above 245,
   also move `pendingStop` and the stop-then-run chain of
   `enterStopping` to a plain `StopChain` in `src/fsm/stop-chain.ts`.
1. `src/dto/fsm.dto.ts`: `interrupted` joins `ScriptStatus`, and the
   type `StoredMachine` holds `state: string | undefined`,
   `entry: number` and `status: ScriptStatus`. In `src/dto/state.dto.ts`
   it joins `CommandStateStatus`, whose comment names it. It is not a
   `RunOutcome`, so neither `STATUS` map gains it (05 adds `failed` to
   the one in `src/queue.service.ts`). In `src/execa-manager.service.ts`
   the comment of `OUTCOME` says `invalid` and `interrupted` are failed.
1. `src/queue.service.ts` (197 lines, gains about 35): add
   `CREATE TABLE IF NOT EXISTS machine` to `SCHEMA` (`id` fixed to 1 by
   a `CHECK`, `state TEXT` nullable, `entry`, `status`, `updated_at`).
   That statement is the whole migration: an existing database file
   gains the table on `open`, and no `ALTER` is needed. Add
   `saveMachine(machine: StoredMachine)` (`INSERT OR REPLACE`, row 1),
   `loadMachine(): StoredMachine | undefined` (`NULL` state as
   `undefined`), and `markInterrupted(time: string)`, which sets
   `status = 'interrupted'` and `finished_at = datetime(?)` on the rows
   whose `finished_at` is `NULL`; `datetime` keeps the column in the
   `YYYY-MM-DD HH:MM:SS` of `CURRENT_TIMESTAMP` in `complete`. None
   emits a change. Should 05 push the file to 250, the machine SQL
   moves to constants in a new `src/queue.machine.ts`.
1. Add `src/fsm/recovery.ts`, pure:
   `recover(definition: Definition, stored?: StoredMachine): Recovered`,
   with `Recovered = { state, entry, status, warning? }`, applying the
   four rules with one `return` (four would reach Qlty's threshold) and
   complexity at most 4, the `running` to `interrupted` mapping and the
   warning text in small helpers.
1. `src/fsm/state-machine.ts`: the constructor becomes
   `(definition, state?, entry?)`, where `state` and `entry` replace the
   `current` and `entries` fields as constructor parameters, defaulting
   to unstarted and `0`; `definition` stays private, and
   `FsmService.load()` keeps it in a private field unless 08's
   `RunnerContext` exposes it. `src/fsm/parameters.ts`:
   `Parameters.restore(values): string[]` commits each value whose name
   is declared and whose `valueProblems` is empty, and returns the rest.
1. Add `src/fsm/machine-store.ts`: a plain class `MachineStore`, built
   from `(queue, logger)`, with `save(machine, status)` (the guarded
   write: `saveMachine` in a try/catch that logs),
   `markInterrupted(time)`, `load()` and
   `restore(definition?, parameters?): Recovered`. `restore` marks the
   commands interrupted; without a definition it logs a stored row and
   returns the unstarted machine; otherwise it applies `recover`, writes
   the result back with `save`, and restores the parameter values. One
   private helper logs both warnings, the unknown state and the dropped
   parameters, keeping `restore` within Qlty's complexity.
1. `src/fsm/fsm.service.ts`:
   - a `MachineStore` field, built in the constructor body from the
     queue and the logger (a field initializer cannot read a parameter
     property under `target: ES2022`); no constructor gains a parameter;
   - `restore()`, about five lines: take `state`, `entry` and `status`
     from `this.store.restore(definition, this.declared)`, and set
     `this.machine` (with the definition) and `this.status`;
   - `enter` and `enterStopping` call `this.store.save` once the status
     is `running`, and `run` once the status is set;
   - after the script, `run` sets, emits and stores the status whenever
     `machine.entry === entry`, and skips only `complete` once
     `stopping` is set. The start check keeps `stopping`, so a stop
     transition's target does not start during shutdown and comes back
     `interrupted`.
1. `src/execa-manager.service.ts`: `onApplicationShutdown` awaits one
   `setImmediate` between the runs settling and `close()`, which comes
   two microtasks after a settle, while `run` writes a microtask later.
   Its comment states the invariant: nothing between a run settling and
   that write awaits I/O, so one macrotask suffices. Chosen over an
   `awaitBeforeClose(promise)` set: one line instead of a set, a method
   and two call sites, in files near their limits.
1. `src/main.ts`: add `app.get<FsmService>(FsmService).restore()` after
   `Queue.open`. No other line moves.
1. `test/unit/fsm.fixture.ts`: the fake queue gains `loadMachine`
   (returns `undefined`), `saveMachine`, `markInterrupted` and
   `parameterValues` (returns `{}`) as `jest.fn`. `test/e2e/util.ts`:
   `startStoredRunner(configFile)` mirrors `main.ts` (`loadConfig`,
   `FsmService.load()`, `Queue.open(config.getDatabase())`,
   `FsmService.restore()`, then `app.init()`; MQTT is left out, as the
   test configuration has none). `startRunner` keeps its in-memory
   database, as `test/data/config/runner.mqtt.yaml` names a database
   file; its comment no longer claims to mirror `main.ts`.
1. Documents. `README.md`: Command History (the machine and the
   parameter values survive a restart; a command that was running is
   `interrupted`), the State Machine text that says the machine is lost
   on restart, `interrupted` in the `GET /` and `GET /fsm` status lists
   and in the `command.status` text of `GET /state` (02), and the
   Repeated Requests sentence on a command that was running, including
   05's "a row that never finished replays as `failed`", which becomes
   a row interrupted by a restart. `docs/state-machine-design.md`:
   replace D12, add a decision with the next free number for
   `interrupted` instead of a re-run, a Behaviour item for the restart,
   `fsm/recovery.ts`, `fsm/machine-store.ts` and the `Queue` machine
   methods in Components, and drop persistence from Out of Scope.
   `docs/issues/README.md`: the status row, and "after 06 and 08" at
   09 in the Order diagram. A new status in existing routes breaks: the
   next free minor version (05 claims `0.7.0`) and a README line. This
   file gains `## Learnings`; `api/*.http` is unchanged.

## Tasks

- [ ] `saveMachine` and `loadMachine` round-trip a started and an
      unstarted row, keep one row, return `undefined` before the first
      save, and survive reopening a database file; a file made without
      the `machine` table opens with its commands intact;
      `markInterrupted` marks only unfinished rows, stores the time as
      `YYYY-MM-DD HH:MM:SS`, and `commandState` shows `interrupted`.
      Check: `test/integration/queue.machine.spec.ts` (new;
      `queue.service.spec.ts` is 247 lines).
- [ ] A repeat of the request key of an interrupted command gets
      `failed`; `onApplicationShutdown` closes the database only after a
      continuation of a run's result, three microtasks later, wrote to
      it. Check: `test/integration/execa-manager.service.spec.ts`.
- [ ] `recover` returns unstarted for no row, keeps the entry of an
      unstarted row, warns and keeps the entry for an unknown state,
      turns `running` into `interrupted`, and keeps `valid`, `invalid`,
      `stopped` and `interrupted`. Check: `test/unit/fsm.recovery.spec.ts`
      (new). A `StateMachine` built with a state and an entry follows
      that state's transitions and numbers the next entry after it.
      Check: `test/unit/fsm.state-machine.spec.ts`.
- [ ] `Parameters.restore` keeps valid values of declared parameters and
      returns the names of a removed parameter, a value of another type
      and a removed enum value. Check:
      `test/unit/fsm.parameters.restore.spec.ts` (new;
      `fsm.parameters.spec.ts` is 235 lines).
- [ ] `MachineStore` logs a throwing `saveMachine` without throwing,
      marks commands interrupted with and without a definition, logs
      and ignores a row without one, writes the recovered row back, and
      warns about an unknown state and dropped parameters. Check:
      `test/unit/fsm.machine-store.spec.ts` (new), against a fake queue.
- [ ] `check()` after `restore()` returns the restored document; from
      `interrupted`, a transition is accepted and an event with a
      transition moves the machine; `enter`, `enterStopping` and `run`
      store the machine, and the reply stays `accepted` when the write
      throws; a script that finishes after `beforeApplicationShutdown`
      stores its status and does not follow its completion transition.
      Check: `test/unit/fsm.service.restore.spec.ts` (new).
- [ ] Restart, portable to Windows. `digitalTwin(DEFINITION, ['loop'])`
      makes the folder and the test appends `database: runner.db` to its
      `runner.yaml`, so the file is in the folder `afterAll` removes;
      `loop` has a `halt` event to `create` and no completion
      transitions. Killed: start with `startStoredRunner`, enter `loop`,
      open a second `DatabaseSync` on the file and expect the row
      `loop`, entry 1, `running`; `manager.stop()`, `app.close()`; then
      `UPDATE machine SET status = 'running'` and
      `UPDATE commands SET finished_at = NULL` through it, as a killed
      runner leaves them, and close it. A second runner reports `loop`,
      entry 1, `interrupted` on `GET /fsm`, `GET /` and `GET /state`,
      and accepts a transition to `create`. Graceful: enter `loop`, spy
      on `beforeApplicationShutdown` with an implementation that calls
      the bound original, then `void manager.stop()`; `app.close()`; the
      second runner reports `loop`, `stopped`. Check:
      `test/e2e/restart.spec.ts` (new), with Jest `expect` assertions.
- [ ] Documents and version updated. Check: from the repository root,
      `npx markdownlint-cli -c .markdownlint.yaml` on them.
- [ ] `yarn build` and `yarn test` pass,
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is clean
      (eslint lints no `.ts` file here), no changed file reaches 250
      lines, and no function crosses the Qlty thresholds. Check: their
      output and `wc -l`; the thresholds counted by hand.
