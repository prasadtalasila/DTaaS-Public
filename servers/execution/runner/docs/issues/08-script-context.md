# 08 Runner Context and Events for Scripts

- Status: planned
- Depends on: 04
- PR: none
- Research note:
  [item 8](../dtn-research-notes.md#8-runner-context-and-events-for-scripts)

## Spec

P2 places a MAPE-K loop inside each DT. In the runner, a long-running
state's script is the natural place for the Monitor and Analyse steps,
and the events it raises are the Plan. Today scripts receive no
environment from the runner (`src/execa-runner.ts:23`) and the contract
for raising events is undocumented. This feature gives scripts their
context and makes the contract explicit.

### Runner variables

Every script, whether started by the machine or by `POST /`, gets:

| Variable          | Value                                                        |
| :---------------- | :----------------------------------------------------------- |
| `RUNNER_URL`      | `http://127.0.0.1:<port>`, the runner's own HTTP API         |
| `DT_ID`           | `id` of `runner.yaml`                                        |
| `DT_STATE`        | the machine's current state, or empty                        |
| `DT_ENTRY`        | the machine's entry counter, or `0`                          |
| `DT_PARAM_<NAME>` | each parameter value of 04, stringified; see 04 for the name |

The process environment is inherited as today, so `PATH` and friends
remain; runner variables override same-named inherited ones.

### Declared environment

The state machine file may add variables, at the file level and per
state:

```yaml
env:
  LOG_LEVEL: info
  MANAGER_HINT: '${DT_ID}-${DT_PARAM_SCOPE}'
states:
  monitor:
    env:
      INTERVAL: 5
    transitions:
      stop: idle
```

- Values are strings, numbers or booleans and are stringified. A value
  may interpolate runner variables with `${NAME}`; only runner
  variables are available, not the process environment, so a file is
  reproducible across hosts. An unknown name is a startup error.
- Merge order, later wins: process environment, runner variables,
  file-level `env`, state-level `env`. A script started by `POST /`
  gets the file-level `env` and, if the command is a state, that
  state's `env` too.
- Variable names follow `/^[A-Z][A-Z0-9_]*$/` and may not start with
  `DT_` or `RUNNER_`, which are reserved.

### Contract

The README documents, with a shell and a PowerShell example:

- raise a declared event: `POST ${RUNNER_URL}/fsm/event` with
  `{ "event": "<name>" }`, and what the `202`, `400` and `409` replies
  mean for a script;
- escalate: `POST ${RUNNER_URL}/escalate` (06);
- read parameters: `GET ${RUNNER_URL}/parameters` (04), or the
  `DT_PARAM_*` variables as they were when the script started.

No stdout protocol: a script that cannot make HTTP calls has no way to
raise events (non-goal in the index).

## Plan

1. Add `src/script-context.ts`: a pure function from the runner's
   identity, port, machine state, parameter values and the declared
   `env` maps to the final environment, including interpolation.
1. Add the `env` schema and interpolation check to
   `src/fsm/definition.ts` (file level and `stateSchema`).
1. Extend `Runner.run` options (05) with `env` and pass it to execa in
   `src/execa-runner.ts`; `RunnerFactory.create` is unchanged.
1. Build the environment in `ExecaManager.execute`
   (`src/execa-manager.service.ts:98-106`) from `Config`,
   `FsmService.check()`, `FsmService.parameters()` and the definition.
1. Document the variables, `env` and the contract in `README.md`
   (Create Commands, State Machine), with examples in
   `test/data/scripts/` that read them; amend A4 in the design
   document.

## Tasks

- [ ] `scriptContext` produces the runner variables, applies the merge
      order, interpolates `${…}` and rejects an unknown name and a
      reserved name. Check: `test/unit/script-context.spec.ts`.
- [ ] Definition schema accepts `env` at both levels and rejects a
      nested value and a bad variable name. Check:
      `test/unit/fsm.definition.spec.ts`.
- [ ] `ExecaRunner` passes the environment to the child; a test script
      prints `DT_ID` and a declared variable. Check:
      `test/integration/execa-runner.spec.ts`,
      `test/integration/execa-manager.service.spec.ts`.
- [ ] A script started by a transition sees `DT_STATE` and `DT_ENTRY`
      of that entry; one started by `POST /` sees the file-level `env`.
      Check: `test/e2e/fsm.spec.ts`, `test/e2e/commander.spec.ts`.
- [ ] A test script raises an event through `RUNNER_URL` and the
      machine moves. Check: `test/e2e/fsm.spec.ts`.
- [ ] README (contract with both examples) and design document updated.
      Check: `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
