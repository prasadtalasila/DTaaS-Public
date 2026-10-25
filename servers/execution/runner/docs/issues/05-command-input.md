# 05 Command Input, Outcome and Exposure

- Status: planned
- Depends on: 01, 04
- PR: none
- Research note:
  [item 5](../dtn-research-notes.md#5-command-input-outcome-and-exposure-r2)

## Spec

P1's Manager submits `admit(p)` to a DT and depends on whether it
succeeded. Today `POST /` takes a command name only, passes nothing to
the script, and answers `success` or `invalid command` whether the
script failed or was not permitted. This feature adds input, a result
in the reply, and the list of commands a Manager may submit.

### Request

```json
{ "name": "admit", "input": { "patient": "p-17", "ward": "B" } }
```

- `input` is optional and, when present, a JSON object. Its serialised
  form may be at most 64 KiB; a larger one is `400` with a message
  naming the limit. There is no per-command schema; scripts validate
  their own input.
- The input is written to the script's stdin as one line of JSON
  followed by a newline, and stdin is closed. Without input, stdin is
  closed empty, so a script that reads stdin never hangs. Nothing goes
  on the command line, which keeps arguments out of a remote execution
  path. Scripts started by the state machine get empty stdin.
- A repeated request (same `Idempotency-Key`) gets the stored result,
  as today; a repeat with different `input` is treated as a repeat and
  gets the original result.

### Reply

```json
{
  "status": "success",
  "result": { "exitCode": 0, "stdout": "{\"bed\":\"B-4\"}", "stderr": "" }
}
```

- `status` is `success` (`200`, exit code 0), `failed` (`200`, the
  script ran and exited non-zero or could not start) or
  `invalid command` (`400`, not in `commands`). Today a failing script
  is reported as `invalid command`; this is the breaking change.
- `result` is present for `success` and `failed`; `exitCode` is `null`
  when the script could not start.
- `GET /` and the `status` route gain `exitCode`; `GET /history`
  stays as it is (11 extends it).

### Exposure

The state machine file lists the commands a Manager may submit:

```yaml
manager:
  commands: [admit]
```

Each must be in `commands` of `runner.yaml`. The descriptor of 01 gains
`"manager": { "commands": ["admit"] }` (`{ "commands": [] }` without
a machine or a `manager` section). Nothing enforces the list until 15;
the README says so.

## Plan

1. Extend `Runner` (`src/interfaces/runner.interface.ts`) to
   `run(options: { input?: string }): Promise<RunOutcome>` with
   `RunOutcome = { success, exitCode }`; implement in
   `src/execa-runner.ts` with execa's `input` option and
   `reject: false`, so a non-zero exit is an outcome, not an exception.
1. Extend `CommandResult` and `CommandRecord`
   (`src/interfaces/command.interface.ts`) with `exitCode` and
   `input`; add `input TEXT` and `exit_code INTEGER` to the `commands`
   table and the queries in `src/queue.service.ts`.
1. Extend `executeCommandSchema` and the reply builders in
   `src/dto/command.dto.ts`, with the size check as a zod refinement.
1. Thread `input` through `ExecaManager.newCommand`, `start` and
   `execute` (`src/execa-manager.service.ts:84-106`) and return the
   outcome; `FsmService.succeeds` adapts to the new return type.
1. Update `src/app.controller.ts` and the `execute` and `status` MQTT
   routes.
1. Add the `manager` section to `fileSchema` and `Definition` in
   `src/fsm/definition.ts` with the cross-check against `commands`;
   add it to the descriptor (`src/descriptor.service.ts`).
1. Add a test script that echoes its stdin to
   `test/data/scripts/` (shell and `.ps1`).
1. Update `api/*.http`, `README.md` (POST request, Create Commands,
   State Machine, and a note that `manager.commands` is not enforced),
   the design document (new decision on stdin delivery) and the
   developer page. Bump `package.json` minor version for the reply
   change.

## Tasks

- [ ] `ExecaRunner` passes input on stdin, closes stdin without input,
      and reports the exit code of a failing script without throwing.
      Check: `test/integration/execa-runner.spec.ts`.
- [ ] `Queue` stores and returns `input` and `exitCode`. Check:
      `test/integration/queue.service.spec.ts`.
- [ ] Schema rejects a non-object `input` and one over 64 KiB with a
      message. Check: `test/unit/validation.pipe.spec.ts` or a new
      `test/unit/command.dto.spec.ts`.
- [ ] `ExecaManager` returns `success`, `failed` and `invalid command`
      outcomes and replays the stored outcome for a repeated key. Check:
      `test/integration/execa-manager.service.spec.ts`.
- [ ] `POST /` returns the result and the right status codes; the echo
      script's stdout carries the input. Check:
      `test/integration/app.controller.spec.ts`,
      `test/e2e/commander.spec.ts`.
- [ ] MQTT `execute` returns the same body. Check:
      `test/unit/mqtt-request.handler.spec.ts`, `test/e2e/mqtt.spec.ts`.
- [ ] `manager.commands` is validated against `commands` and shown in
      `GET /dt`. Check: `test/unit/fsm.definition.spec.ts`,
      `test/e2e/descriptor.spec.ts`.
- [ ] The state machine still moves on `$success` and `$failure` with
      the new outcome type. Check: `test/unit/fsm.service.spec.ts`,
      `test/e2e/fsm.spec.ts`.
- [ ] README, design document and request files updated. Check:
      `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
