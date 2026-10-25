# 05 Command Input, Outcome and Exposure

- Status: in progress
- Depends on: 01, 04
- PR: none
- Research note:
  [item 5](../dtn-research-notes.md#5-command-input-outcome-and-exposure-r2)

## Spec

P1's Manager submits `admit(p)` to a DT and depends on its outcome.
Today `POST /` takes a name only, passes nothing to the script, and
answers `400 invalid command` both for a failed script and for a
command that is not permitted. This feature adds input, a result in
the reply, a `failed` status, and the commands a Manager may submit.
Unlike the research note, the input is not recorded and has no
per-command schema (a non-goal).

### Request

```json
{ "name": "admit", "input": { "patient": "p-17", "ward": "B" } }
```

- `input` is optional and, when present, a JSON object; `{}` is valid,
  an array, a string or `null` is not. Its serialised form,
  `Buffer.byteLength(JSON.stringify(input))`, is at most 64 KiB (65 536
  bytes). Any other `input` gets the existing `400 Validation Failed`.
  Over HTTP, Express refuses a body over its 100 kB `json` limit with
  `413` before validation; MQTT payloads have only the 64 KiB cap.
- The input goes to stdin as one line of JSON and a newline, and stdin
  is closed; without input, or for a script the state machine starts,
  stdin is closed empty, so a script that reads it never hangs. Nothing
  goes on the command line, which keeps arguments out of a remote
  execution path.
- The input is not stored: it can hold personal data, such as a
  patient, and nothing reads it back. A script that prints its input
  puts it in the stored logs; the README says so.
- A repeated request key gets the stored result, whatever its `input`.
- A request with `input` for a command that is running is refused with
  `409 command running`, as joining the run would drop its input. It is
  not added to the history and its key is not kept, so a retry is
  checked again. A request without `input` joins the run as today.

### Reply

```json
{
  "status": "failed",
  "result": { "exitCode": 3, "stdout": "", "stderr": "no free bed" }
}
```

| `status`          | HTTP | When                                                                            |
| :---------------- | :--- | :------------------------------------------------------------------------------ |
| `success`         | 200  | The script exited with 0                                                        |
| `failed`          | 200  | A permitted script exited non-zero, was killed from outside, or could not start |
| `stopped`         | 200  | A stop request stopped the script                                               |
| `invalid command` | 400  | The command is not in `commands`, or the request key is of another command      |
| `command running` | 409  | The request has `input` and the command is running                              |

- `result` is present for `success`, `failed` and `stopped`, with the
  logs whatever the outcome (before, those of a failed or stopped run
  were empty). `exitCode` is `null` when the script could not start,
  was killed by a signal or was stopped, as execa gives `undefined`
  then; a stopped script that exits with a code still gets `null`.
- MQTT `execute` answers the same bodies. A failing script was
  `400 invalid command`: the breaking change, at version `0.7.0`.

### Stored status

`commands.status` is `valid`, `failed` (new), `invalid` (not
permitted) or `stopped`, and a new `exit_code` column holds the code:

- `GET /` and MQTT `status` may show `failed` and gain `exitCode`
  (`null` before the first command); `command.status` of `GET /state`
  may be `failed` (`CommandStateStatus` of 02, `src/dto/state.dto.ts`).
- A replayed key (`storedResult`) gets `failed` with the stored
  `result`; a row that never finished, as after a crash, now replays as
  `failed` with `exitCode: null`. Rows from before 0.7.0 keep `invalid`
  for failed scripts and replay as `invalid command`, as they did.
- `GET /history` stays as it is (11 extends it). `GET /fsm` keeps
  `invalid` for a failed script: `ScriptStatus` is the machine's, and
  `FsmService` is left alone.

### Exposure

The state machine file lists the commands a Manager may submit:

```yaml
manager:
  commands: [admit]
```

Each must be in `commands` of `runner.yaml`, or the runner does not
start. `GET /dt` gains `"manager": { "commands": ["admit"] }`, with
`[]` without a machine or a list, as for a bare `manager:`. Nothing
enforces the list until 15; the README says so.

## Plan

1. `src/interfaces/runner.interface.ts` gains
   `export type RunOptions = { input?: string }` (08 adds `env`);
   `Runner` gets `run(options?: RunOptions): Promise<RunOutcome>` and
   `checkExitCode(): number | null`. In `command.interface.ts`,
   `CommandResult` becomes `[RunOutcome, Map<string, string>, number | null]`,
   `CommandRecord` and `CommandStatus` gain `exitCode: number | null`,
   and `Manager.newCommand` a third parameter, `options?: RunOptions`.
   A tuple element, not a `run()` object, keeps
   `const [outcome] = await manager.newCommand(state)` compiling
   (`script-outcome.ts:13`): `scriptOutcome` and `RunnerFactory` stay.
1. In `src/execa-runner.ts:31-44`, pass `input: options?.input ?? ''`
   and `reject: false`, take the logs from the result whatever the
   outcome, the outcome from `result.failed` and `stopped`, and keep
   `stopped ? null : (result.exitCode ?? null)` for `checkExitCode()`.
1. In `src/dto/command.dto.ts`:
   - `executeCommandSchema` gains
     `input: z.record(z.string(), z.unknown()).refine(fits).optional()`
     (`MAX_INPUT_BYTES = 64 * 1024`) and loses `.required()`, which
     would make `input` required;
   - `runOptions(dto): RunOptions` serialises `input` with a newline;
   - `CommandRefused`, an `Error` with
     `status: 'invalid command' | 'command running'`, with which
     `newCommand` rejects a request that runs nothing, as `RunOutcome`
     has no value for one (the machine, whose states are permitted and
     which sends no key or input, never meets one);
   - `EXECUTE_STATUS_CODES` (the reply table, as `FSM_STATUS_CODES`),
     `ExecuteResponseDto`, and `executeReply(run: Promise<CommandResult>)`,
     which builds the body, turns a `CommandRefused` into `{ status }`
     and lets other errors through (`500`), replacing `EXECUTE_STATUS`
     and `executeResponse`; `CommandResult` is an `import type`.
1. In `src/execa-manager.service.ts` (from 206 to about 222 lines):
   - `newCommand` (line 51) takes `options`; after the repeat check, a
     running command and `options?.input !== undefined` reject with
     `command running`, before `join` (71-84); `start` passes
     `options` to `execute`;
   - `execute` (136-143): without a runner, `commandQueue.refuse(id)`,
     then reject with `invalid command`; with one,
     `[await runner.run(options), runner.checkLogs(), runner.checkExitCode()]`;
   - `repeat` (88-104) rejects a key of another command with
     `invalid command` instead of returning `['failed', new Map()]`;
   - `storedResult` (16-28) rejects a finished `invalid` row with
     `invalid command`, and otherwise returns
     `[OUTCOME[status] ?? 'failed', logs, exitCode]`; an unfinished row
     keeps the default `invalid`, so it falls through to `failed`;
   - `checkStatus` and `createStatus` (176-197) add `exitCode`;
   - a refused run's `result` rejects like any other: the caller of
     `start` or `join` awaits it, and `stop` and shutdown await it with
     `allSettled`; no `.catch` swallows it.
1. In `src/queue.service.ts`, `SCHEMA` gains `exit_code INTEGER`.
   `connect()` (103-107) runs `exec(SCHEMA)` first, then adds the
   column to an older file: when `PRAGMA table_info(commands)` has no
   `exit_code`, it runs `ALTER TABLE commands ADD COLUMN exit_code INTEGER`.
   `STATUS` (50-54) maps `failed` to `failed`; `complete()` stores the
   third element; the new `refuse(id)` sets only `finished_at`, keeping
   the default `invalid`, and signals a change as `complete()` does
   (03); `RECORD` and `toRecord` read `exit_code AS exitCode`.
   `CommandStateStatus` (`state.dto.ts:6`) gains `failed`.
1. `AppController.newCommand` (`src/app.controller.ts:51-65`) awaits
   `executeReply(this.manager.newCommand(name, key, runOptions(dto)))`
   and sends it with `EXECUTE_STATUS_CODES[reply.status]`; the MQTT
   `execute` route (`src/mqtt/mqtt-request.handler.ts:54-57`) returns
   the same `executeReply(...)`.
1. Add `src/fsm/manager.ts`, as `parameters.ts`: `managerSchema`
   (strict, `commands: z.array(z.string()).default([])`, `.nullish()`
   as `stateSchema`) and `managerProblems(commands, permitted)`, one
   `manager command <name> is not a permitted command` each.
   `definition.ts` gains `manager` in `fileSchema`, `managerCommands`
   in `Definition`, `manager?.commands ?? []` in `toDefinition` (a bare
   `manager:` has none), and one call in `crossCheck`; at about 249
   lines, its completion-cycle search (130-165) moves to
   `src/fsm/completion-cycle.ts`.
1. `FsmService.managerCommands()` returns `StateMachine`'s, or `[]`.
   `FsmService` is at 249 lines after 03, so the body of `check()`
   moves to `StateMachine.describe(status)`. `DescriptorService` and
   `DescriptorDto` add `manager: { commands: ... }`.
1. Add test scripts to `test/data/scripts/`: `echo-input` (`cat`),
   `echo-input.ps1` (`[Console]::In.ReadToEnd()`), `fail`
   (`echo 'no free bed' >&2; exit 3`) and `fail.ps1`
   (`[Console]::Error.WriteLine('no free bed'); exit 3`, as
   `Write-Error` prints an error record; `-File` passes the code on).
   Shell scripts get mode 100755. Both join `runner.test.yaml` and the
   lists of `test/e2e/mqtt.spec.ts:142` and `options.service.spec.ts:53`.
   execa strips one final newline: `cat` gives back the exact line, but
   PowerShell adds its own CRLF, so the input's newline stays; tests
   compare `JSON.parse(stdout)` of ASCII input, as Windows PowerShell
   decodes stdin in the console code page.
1. Update `api/dev.api.http` and `api/dev.mqtt.http` (execute with
   input); `README.md`: Create Commands (stdin; input not stored, logs
   are), State Machine (`manager`, unenforced until 15), POST /
   (request, reply table, `409`, `413`, and "Version 0.7.0 added
   `input`, `result` and the `failed` status; before it, a script that
   failed was answered `invalid command`."), GET /, GET /dt, GET /state,
   Repeated Requests (input, `409`, an unfinished row) and MQTT API
   (`execute` payload); `docs/state-machine-design.md` (Validation
   gains `manager`; D23: `manager.commands` in the DT author's file,
   S4; D24: input on stdin, not stored); `package.json` to `0.7.0`.
   The pull request lists `docs/developer/codebase/runner.md` and the
   user documentation copy of the README as stale.

## Tasks

- [ ] `ExecaRunner` passes input on stdin, closes empty stdin (`cat`
      ends without input), returns the exit code and logs of a failing
      script, and `null` for one that could not start (the ENOENT test,
      kept with `reject: false`), was killed from outside or was
      stopped. Check: `test/integration/execa-runner.spec.ts`.
- [ ] `Queue` opens a file made with the 0.6.0 `CREATE TABLE` (copied
      into the test), adds `exit_code` once over two opens, returns
      `null` for the old row and the code of a new one, stores
      `failed`, and `refuse` leaves a finished `invalid` row. Check:
      `test/integration/queue.migration.spec.ts` (new; the service spec
      is at 247 lines).
- [ ] The schema accepts `{}` and an input of 65 536 bytes with
      multi-byte characters, and refuses one byte more, an array, a
      string and `null` with `Validation Failed`. Check:
      `test/unit/validation.pipe.spec.ts`.
- [ ] `ExecaManager` gives `success`, `failed` and `invalid command`;
      the echo script gets the input; input for a running command is
      `command running`, not in the history; one without input joins;
      a repeated key replays whatever its input, a stored `failed` and
      an unfinished row as specified. Check:
      `test/integration/execa-manager.input.spec.ts` (new; the service
      spec, at 216 lines, expects the rejection for an invalid one).
- [ ] `manager` is accepted, has no commands when left out or bare
      (`manager:`), and an unknown key or a command not permitted stops
      loading with the file name; the cycle check still works. Check:
      `test/unit/fsm.manager.spec.ts` (new), `fsm.definition.spec.ts`.
- [ ] `POST /` answers each row of the reply table with its code; the
      echo script's stdout is the input; `GET /` has `exitCode`;
      `GET /state` shows `failed`; `GET /dt` shows `manager`. Check:
      `test/e2e/descriptor.spec.ts`, `descriptor.service.spec.ts`,
      `test/integration/app.controller.spec.ts`, `test/e2e/util.ts`,
      `test/e2e/commander.spec.ts`, `test/e2e/state.spec.ts`.
- [ ] MQTT `execute` answers the same bodies, `status` has `exitCode`.
      Check: `test/unit/mqtt-request.execute.spec.ts` (new; the execute
      tests move there from the handler spec at 241 lines),
      `test/unit/mqtt.fixture.ts`, `test/e2e/mqtt.spec.ts`.
- [ ] The machine still moves on `$success` and `$failure`, with the
      fake `newCommand` of `test/unit/fsm.fixture.ts` resolving
      `[outcome, new Map(), null]`. Check: `test/e2e/fsm.spec.ts`,
      `test/unit/fsm.service.spec.ts`, and no diff in `script-outcome.ts`
      or in `fsm.service.ts` beyond `managerCommands` and `check()`.
- [ ] README, design document and request files updated. Check:
      `npx markdownlint-cli -c .markdownlint.yaml` from the root.
- [ ] `yarn build` and `yarn test` pass; eslint lints no `.ts`, so
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean; no file over 250 lines, function over 25 or Qlty threshold
      crossed. Check: their output, and `wc -l` on the changed files.
