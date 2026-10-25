# 10 Stop a Running Script

- Status: planned
- Depends on: 01
- PR: none
- Research note:
  [item 10](../dtn-research-notes.md#10-stop-a-running-script)

## Spec

A parameter update (04) or a DT's removal may need the current script
to end. D10 of the design document says the runner cannot cancel a
script: `ExecaRunner.run` awaits execa and keeps no handle
(`src/execa-runner.ts:20-32`), and a long state is left only by an
event while its script keeps running. This feature adds a stop.

### Mechanism

A stop sends `SIGTERM` and, if the process is still alive after the
grace period, `SIGKILL` (execa's `forceKillAfterDelay`). The grace
period is `stopGrace` in `runner.yaml`, in milliseconds, default
`5000`. On Windows execa's kill ends the process at once; the README
says so.

### `$stopped`

A stopped script completes with a new completion event, `$stopped`,
next to `$success` and `$failure`. It is distinct so that a deliberate
stop never looks like a crash: it does not count for `onFailure`
escalation (06), and the command's history status is `stopped`, not
`invalid`. A state with no `$stopped` transition goes idle silently in
that state, with script status `stopped` (a new `ScriptStatus`). The
completion cycle check includes `$stopped` transitions.

### API

`POST /stop` and `<base>/stop`, body optional:

```json
{ "name": "execute" }
```

Without a body every run in progress is stopped (there is usually one);
with `name`, that run only. Reply `200 { "stopped": ["execute"] }`,
with `[]` when nothing was running or the name was not running. The
reply returns when the processes have exited, so it may take up to the
grace period plus a moment.

### Transition with stop

A transition may stop the current state's script before entering the
next state:

```yaml
states:
  execute:
    transitions:
      restart: { state: create, stop: true }
      stop: idle
```

A transition value is a state name, as today, or an object
`{ state, stop: true }`. On the event, the runner stops the script of
the current state, waits for it to exit, then enters the target. The
stopped script's completion is attributed to the earlier entry and
ignored, as any late completion is today
(`src/fsm/fsm.service.ts:135`), so `$stopped` fires only for a
`POST /stop` of the current state's script. The event reply is still
`202 accepted` when the stop begins; `GET /state` shows the result.

A `transition` request while a script runs stays `409 busy` (D7): a
Manager that wants to force a state calls `POST /stop` first.

## Plan

1. Add `stopGrace` to the configuration schema of 01.
1. Add `stop(): Promise<void>` to `Runner`
   (`src/interfaces/runner.interface.ts`); in `src/execa-runner.ts`
   keep the subprocess handle and implement the signal and grace
   period. Report `stopped` as a third outcome of `run` (`success`,
   `failed`, `stopped`), building on the `RunOutcome` of 05 or adding
   it here if 05 has not landed.
1. Keep the `Runner` in `ExecaManager.running`
   (`src/execa-manager.service.ts:30`, `84-96`), add `stop(name?)`
   that stops and awaits the runs, and record `stopped` in `Queue`.
1. Add `$stopped` to `COMPLETION_EVENTS` in `src/fsm/definition.ts`,
   extend the transition value schema to the object form, and carry the
   `stop` flag in `Transitions`.
1. In `src/fsm/fsm.service.ts`, map a `stopped` outcome to `$stopped`
   in `run`, and make `event` stop the current script before `enter`
   when the transition says so.
1. Add `POST /stop` to `src/app.controller.ts` and the `stop` MQTT
   route.
1. Add a long-running test script (sleep loop, shell and `.ps1`) to
   `test/data/scripts/`.
1. Update `api/*.http`, `README.md` (State Machine: rewrite the
   long-state guidance; API; MQTT API), the design document (replace
   D10, amend D7, add a decision for `$stopped`) and the developer
   page.

## Tasks

- [ ] `ExecaRunner.stop` ends a sleeping script with the `stopped`
      outcome; a script that ignores `SIGTERM` is killed after the grace
      period. Check: `test/integration/execa-runner.spec.ts` (the
      ignore case on POSIX only).
- [ ] `ExecaManager.stop` stops one named run or all, awaits them, and
      records `stopped`. Check:
      `test/integration/execa-manager.service.spec.ts`,
      `test/integration/queue.service.spec.ts`.
- [ ] Definition accepts the object transition form, rejects
      `stop: false` and unknown keys, and finds a completion cycle
      through `$stopped`. Check: `test/unit/fsm.definition.spec.ts`.
- [ ] A `POST /stop` of the current state's script raises `$stopped`
      and follows its transition, or goes idle with status `stopped`;
      a stop-transition enters the target after the script exits and
      ignores the late completion. Check: `test/unit/fsm.service.spec.ts`
      with a fake manager, `test/e2e/fsm.spec.ts` with the sleep script.
- [ ] `POST /stop` and the MQTT route reply as specified. Check:
      `test/e2e/commander.spec.ts`,
      `test/unit/mqtt-request.handler.spec.ts`.
- [ ] README, design document (D7, D10) and request files updated.
      Check: `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
