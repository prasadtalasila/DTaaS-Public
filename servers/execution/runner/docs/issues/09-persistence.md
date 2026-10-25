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
memory the code path is the same, with nothing to restore. A write
follows the move and the reply, so a failed write is only logged.

During a graceful shutdown (D14 stands), a script that finishes still
has its status stored; only its completion transition is skipped. So a
script stopped or finished during shutdown is reported as such after
the restart, not as `interrupted`.

### Recovery

`main.ts` runs, in order: the configuration, `FsmService.load()`,
`Queue.open(database)`, `FsmService.restore()`, MQTT, `listen` (08
moves MQTT after `listen`; `restore` comes before both, so no request
reaches the machine before it). `restore()`:

1. Marks every `commands` row without `finished_at` as `interrupted`,
   with the startup time as `finished_at`, with or without a state
   machine: no script survives a restart. `GET /`, `GET /state` and a
   repeated request key then agree that the command ended.
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

1. Restores the parameter values: a stored value is kept only if its
   parameter is still declared and the value is valid for the current
   declaration. Values of a removed parameter, of a changed type or of
   a removed enum value are dropped with one warning naming them; those
   parameters start at their defaults, and the warning repeats at each
   start until they are set again. Controllability is not checked, and
   no declared event is raised (S6).
1. Sends no notification of its own. 03's `Notifier` subscribes in
   `onModuleInit` and sends the startup document from
   `onApplicationBootstrap`, both of which run in `listen` (`app.init()`
   in tests), after `restore()`, so that document carries the restored
   state and the `interrupted` status.

`interrupted` is a new `ScriptStatus` and `CommandStateStatus`. The
machine is idle in it: a transition request is accepted (D7), and an
event with a transition moves it on. No script starts on recovery, so a
crash loop cannot run the same script forever; the Manager or a client
decides what an interrupted DT does next, without `POST /stop` (10), as
nothing runs. Transitions are not added to the history (11).

After a restart, `GET /fsm` of a runner killed while `execute` ran:

```json
{ "state": "execute", "status": "interrupted", "entry": 3, "events": ["stop"] }
```

`GET /` shows its command with status `interrupted`, and a repeat of
that command's request key gets `400 invalid command`, as an unfinished
command does today: `storedResult` in `ExecaManager` maps any status it
does not know to `failed`.

## Plan

1. Start after 06 and 08 merge. `src/fsm/fsm.service.ts` is 249 lines
   today and 09 adds about 30. 06 moves `request` and `reply` to
   `src/fsm/requests.ts`; 08 folds `runIfCurrent` into `run`, inlines
   `follow` and moves the body of `check()` out. Measure with `wc -l`
   after the rebase. If the file would still reach 250, move, in this
   order: the refusal logging of `raise` and `complete` into one helper
   in `src/fsm/requests.ts` (about 8 lines), then the guarded write of
   step 6 to `storeMachine(queue, row, logger)` in a new
   `src/fsm/store-machine.ts` (about 9).
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
   `status = 'interrupted'` and `finished_at = time` on the rows whose
   `finished_at` is `NULL`. `strftime` reads the ISO `time` as it reads
   `CURRENT_TIMESTAMP`. None of them emits a change. If 05 merges first
   and the file would reach 250, the machine statements move to SQL
   constants in a new `src/queue.machine.ts`.
1. Add `src/fsm/recovery.ts`, pure:
   `recover(definition: Definition, stored?: StoredMachine): Recovered`,
   with `Recovered = { state, entry, status, warning? }`, applying the
   four rules with one `return` (four would reach Qlty's threshold) and
   complexity at most 4, the `running` to `interrupted` mapping and the
   warning text in small helpers.
1. `src/fsm/state-machine.ts`: the constructor becomes
   `(definition, state?, entry?)`, where `state` and `entry` replace the
   `current` and `entries` fields as constructor parameters, defaulting
   to unstarted and `0`. `definition` becomes public `readonly`, unless
   08 already made it so. `src/fsm/parameters.ts` (210 lines):
   `Parameters.restore(values): string[]` commits each stored value
   whose name is declared and whose `valueProblems` is empty, and
   returns the names it dropped.
1. `src/fsm/fsm.service.ts`:
   - `restore()`, about eight lines: `markInterrupted` with the startup
     time; without a machine, log a stored row and return; otherwise
     `recover(this.machine.definition, this.queue.loadMachine())`, log
     its warning, replace `this.machine` with
     `new StateMachine(definition, state, entry)`, set `this.status`,
     write the row back, and warn about the names that
     `this.declared?.restore(this.queue.parameterValues())` dropped;
   - a private `store(machine)` that calls `saveMachine` with the state,
     entry and status inside a try/catch that logs the error;
   - `store` is called from `enter` and `enterStopping` once the status
     is `running`, and from `run` once the status is set;
   - in `run`, after the script, the status is set, emitted and stored
     whenever `machine.entry === entry`, and only `complete` is skipped
     once `stopping` is set. The check before the script starts (08's
     fold) still includes `stopping`, so the target of a stop
     transition does not start during shutdown and stays `running` in
     the row, which is `interrupted` after the restart.
1. `src/execa-manager.service.ts`: `onApplicationShutdown` awaits one
   `setImmediate` after the runs settle and before `close()`. The
   continuation of `run` that stores the status takes more microtasks
   after the run settles than the shutdown hook does, so without the
   yield the database closes first and a script that finished during
   shutdown would come back `interrupted`.
1. `src/main.ts`: add `app.get<FsmService>(FsmService).restore()` after
   `Queue.open`. No other line moves.
1. `test/unit/fsm.fixture.ts`: the fake queue gains `loadMachine`
   (returns `undefined`), `saveMachine`, `markInterrupted` and
   `parameterValues` (returns `{}`) as `jest.fn`. No constructor gains
   a parameter. `test/e2e/util.ts`: a `startStoredRunner(configFile)`
   that mirrors `main.ts` (`loadConfig`, `FsmService.load()`,
   `Queue.open(config.getDatabase())`, `FsmService.restore()`, then
   `app.init()`; MQTT is left out, as the test configuration has
   none). `startRunner` keeps its in-memory database, as
   `test/data/config/runner.mqtt.yaml` names a database file; its
   comment no longer claims to mirror `main.ts`.
1. Documents. `README.md`: Command History (the machine and the
   parameter values survive a restart; a command that was running is
   `interrupted`), the State Machine text that says the machine is lost
   on restart, `interrupted` in the `GET /` status list, in the
   `GET /fsm` status list and in the `command.status` text of
   `GET /state` (02), and the Repeated Requests sentence on a command
   that was running. `docs/state-machine-design.md`: replace D12 (the
   machine is stored and restored), add a decision with the next free
   number (D23 today; 05, 06 and 08 each plan one) for `interrupted`
   instead of a re-run, add a Behaviour item for the restart, add
   `fsm/recovery.ts` and the `Queue` machine methods to Components, and
   drop persistence from Out of Scope. `api/*.http` is unchanged; stale
   documents outside the runner are listed in the pull request. A new
   status in existing routes is a breaking change: bump the minor
   version in `package.json` and add the README line.

## Tasks

- [ ] `saveMachine` and `loadMachine` round-trip a started and an
      unstarted row, keep one row, return `undefined` before the first
      save, and survive reopening a database file; a file made without
      the `machine` table opens with its commands intact;
      `markInterrupted` marks only unfinished rows, with `finishedAt`
      equal to the given time, and `commandState` shows `interrupted`.
      Check: `test/integration/queue.machine.spec.ts` (new;
      `queue.service.spec.ts` is 247 lines).
- [ ] A repeat of the request key of an interrupted command gets
      `failed`; `onApplicationShutdown` closes the database only after a
      continuation of a run's result, a few microtasks later, wrote to
      it. Check: `test/integration/execa-manager.service.spec.ts`.
- [ ] `recover` returns unstarted for no row, keeps the entry of an
      unstarted row, warns and keeps the entry for an unknown state,
      turns `running` into `interrupted`, and keeps `valid`, `invalid`,
      `stopped` and `interrupted`. Check: `test/unit/fsm.recovery.spec.ts`
      (new).
- [ ] A `StateMachine` built with a state and an entry follows that
      state's transitions and numbers the next entry after it. Check:
      `test/unit/fsm.state-machine.spec.ts`.
- [ ] `Parameters.restore` keeps valid values of declared parameters and
      returns the names of a removed parameter, a value of another type
      and a removed enum value. Check:
      `test/unit/fsm.parameters.restore.spec.ts` (new;
      `fsm.parameters.spec.ts` is 235 lines).
- [ ] `check()` after `restore()` returns the restored document for
      each rule; `restore` marks commands interrupted with and without a
      machine, logs and ignores a row without a machine, writes the
      recovered row back, and warns about an unknown state and dropped
      parameters. From `interrupted`, a transition is accepted and an
      event with a transition moves the machine. Check:
      `test/unit/fsm.service.restore.spec.ts` (new) against the fake
      queue.
- [ ] `enter`, `enterStopping` and `run` call `saveMachine`; a throwing
      `saveMachine` is logged and the reply is still `accepted`; a
      script that finishes after `beforeApplicationShutdown` stores its
      status and does not follow its completion transition. Check:
      `test/unit/fsm.service.restore.spec.ts`.
- [ ] Restart, with `startStoredRunner` on one database file and a
      definition whose `loop` state has `$stopped: idle` and no
      `$failure`. Killed: enter `loop`, close the queue behind the
      running app (`app.get(Queue).close()`) so the row stays `running`
      on disk, `manager.stop()` to end the script, close the app; a
      second runner on the same file reports `loop`, entry 1,
      `interrupted` on `GET /fsm`, `GET /` and `GET /state`, then
      accepts a transition to `idle`. Graceful: enter `loop`, close the
      app and stop the script from a spy on
      `FsmService.beforeApplicationShutdown`; the second runner reports
      `loop` with status `stopped`. Portable to Windows. Check:
      `test/e2e/restart.spec.ts` (new).
- [ ] README, design document (D12 replaced, new decision) and the
      version updated. Check: from the repository root,
      `npx markdownlint-cli -c .markdownlint.yaml` on them.
- [ ] `yarn build` and `yarn test` pass,
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is clean
      (eslint lints no `.ts` file here), no changed file reaches 250
      lines, and no function crosses the Qlty thresholds. Check: their
      output and `wc -l`; the thresholds counted by hand.
