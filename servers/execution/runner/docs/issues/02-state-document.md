# 02 One State Document

- Status: planned
- Depends on: 01
- PR: none
- Research note:
  [item 2](../dtn-research-notes.md#2-one-state-document-r1)

## Spec

P1's requirement R1 asks each DT to make its state observable to the
Manager in one place. Today the machine's state is on `GET /fsm` and
the last command on `GET /`. This feature adds a document that joins
them, which 03 publishes on every change.

### API

`GET /state` and the MQTT route `<base>/state` answer `200` always,
machine or not:

```json
{
  "id": "hospital-1",
  "time": "2026-10-25T10:00:00.000Z",
  "machine": {
    "state": "execute",
    "status": "running",
    "entry": 3,
    "events": ["restart"]
  },
  "parameters": {},
  "command": {
    "name": "execute",
    "status": "running",
    "receivedAt": "2026-10-25T09:59:58.000Z",
    "finishedAt": null
  }
}
```

- `machine` is `null` when no state machine is loaded; `state` is
  `null` before the first transition, as on `GET /fsm`. `entry` is the
  entry counter of `StateMachine`, so a Manager can tell two entries
  into the same state apart.
- `parameters` holds the current parameter values once 04 lands; `{}`
  until then. The key exists from the start so the shape does not
  change.
- `command` is the most recent command, or `null` before the first;
  `status` is `running`, `valid` or `invalid` (`interrupted` arrives
  with 09). Logs stay on `GET /`: the document is published on every
  change and script output can be large.
- `time` is when the document was built, ISO 8601 UTC.

`GET /fsm` and `GET /` stay as they are.

## Plan

1. Extend `CommandRecord` (`src/interfaces/command.interface.ts`) and
   `Queue.activeCommand` (`src/queue.service.ts`, `RECORD` query) with
   `receivedAt` and `finishedAt`; store the timestamps as ISO strings
   rather than SQLite's `CURRENT_TIMESTAMP` format, converting in
   `toRecord`.
1. Add `entry` to `FsmStateDto` and `FsmService.check`
   (`src/dto/fsm.dto.ts`, `src/fsm/fsm.service.ts:49-58`). `GET /fsm`
   gains the field; nothing else about it changes.
1. Add `src/dto/state.dto.ts` with `StateDocumentDto` and
   `src/state-document.service.ts` that composes `Config`,
   `FsmService` and `ExecaManager`; the parameters hook is a method
   that returns `{}` until 04 fills it.
1. Add `GET /state` to `src/app.controller.ts` and the `state` route to
   `src/mqtt/mqtt.config.ts` and `src/mqtt/mqtt-request.handler.ts`.
1. Update `api/dev.api.http`, `api/dev.mqtt.http`, `README.md` (API and
   MQTT API) and the developer page.

## Tasks

- [ ] `Queue.activeCommand` returns `receivedAt` and `finishedAt`, with
      `finishedAt` null while running. Check:
      `test/integration/queue.service.spec.ts`.
- [ ] `FsmService.check` returns `entry`, 0 before the first
      transition. Check: `test/unit/fsm.service.spec.ts`.
- [ ] The document has `machine: null` without a machine,
      `command: null` before the first command, and the fields above
      otherwise. Check: `test/unit/state-document.service.spec.ts`
      against fake `FsmService` and `ExecaManager`.
- [ ] `GET /state` answers 200 in both configurations. Check:
      `test/e2e/state.spec.ts`.
- [ ] The `state` MQTT route returns the same body. Check:
      `test/unit/mqtt-request.handler.spec.ts`,
      `test/e2e/mqtt.spec.ts`.
- [ ] README and request files show the route. Check:
      `npx markdownlint-cli README.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
