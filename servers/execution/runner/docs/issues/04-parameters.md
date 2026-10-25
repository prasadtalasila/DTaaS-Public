# 04 Declared Parameters With a Controllable Subset

- Status: planned
- Depends on: 02
- PR: none
- Research note:
  [item 4](../dtn-research-notes.md#4-declared-parameters-with-a-controllable-subset-r2)

## Spec

P1's requirement R2: a DT declares which of its shared-policy
parameters the Manager may change. The DT author declares them in the
state machine file; the Manager reads and sets them over the API; the
values reach scripts as environment variables (08) and appear in the
state document (02).

### Declaration

```yaml
events:
  - restart
  - scope-changed
parameters:
  scope:
    type: enum
    values: [single, multi]
    default: single
    controllable: true
    event: scope-changed # optional; raised when the value changes
  capacity:
    type: number
    default: 20
    controllable: false
states:
  create:
    transitions:
      $success: execute
  execute:
    transitions:
      restart: create
      scope-changed: create
```

- Names follow the name pattern. `type` is `string`, `number`,
  `boolean` or `enum`; `enum` requires `values`, a non-empty list of
  strings. `default` must match the type and is required.
- `controllable` defaults to `false`. Only controllable parameters can
  be set over the API; the others are read-only configuration the DT
  shares with the Manager.
- `event`, if present, must be in `events`. A change of the value
  raises it through the machine's event path; an event the current
  state has no transition for is ignored (logged at debug), as is one
  before the first transition.
- Two parameters whose environment variable names (08) collide, such as
  `a-b` and `a_b`, are a startup error.
- Parameters require a state machine file, as decided in the design
  summary (S4); a DT without one has none.

### API

- `GET /parameters` and `<base>/parameters`: `200` with the
  declarations and current values; `404 no state machine` without one.

  ```json
  {
    "scope": {
      "value": "multi",
      "type": "enum",
      "values": ["single", "multi"],
      "default": "single",
      "controllable": true
    },
    "capacity": {
      "value": 20,
      "type": "number",
      "default": 20,
      "controllable": false
    }
  }
  ```

- `PUT /parameters` and `<base>/set-parameters`: body is a flat object
  of names to values, `{ "scope": "multi" }`. All values are checked
  before any is applied: an unknown name, an uncontrollable parameter
  or a value of the wrong type is `400` with a message naming every
  problem. On success, `200` with the document of `GET /parameters`.
  The route is idempotent; it takes no request key. A value equal to
  the current one changes nothing and raises no event.

Each change is recorded, so 09 can restore values and 11 can report
them.

### State document

`parameters` in the document of 02 becomes `{ "scope": "multi",
"capacity": 20 }`: names to current values only.

## Plan

1. Add `src/fsm/parameters.ts`: zod schema of the `parameters` section,
   a `Parameter` type, value validation per type, and the environment
   variable name function (`DT_PARAM_` plus the upper-cased name with
   `.` and `-` turned into `_`). Extend `fileSchema` and `Definition`
   in `src/fsm/definition.ts` with the section and the cross-checks
   (`event` declared, no name collisions).
1. Add a `parameters` table to `src/queue.service.ts`
   (`name`, `value` as JSON text, `changed_at`), with
   `setParameter(name, value)` and `parameterValues()` returning the
   latest value per name.
1. Add `src/parameters.service.ts`: holds the declarations and current
   values, validates a `PUT` body as a whole, writes changes to
   `Queue`, raises the declared events through `FsmService.event`
   (bypassing request keys), and emits `state` on `Changes` (03).
1. Add `src/dto/parameters.dto.ts`, `src/parameters.controller.ts`
   with `GET` and `PUT /parameters`, and the `parameters` and
   `set-parameters` MQTT routes.
1. Fill the parameters hook of `StateDocumentService` (02).
1. Update `test/data/scripts/state-machine.yaml`, `api/*.http`,
   `README.md` (State Machine and API sections), the design document
   (new decisions for declaration placement and change effect, S6) and
   the developer page.

## Tasks

- [ ] Schema accepts the example, rejects a missing `default`, a
      `default` of the wrong type, `enum` without `values`, an `event`
      not in `events`, and two names with one variable name, each with
      a message. Check: `test/unit/fsm.parameters.spec.ts`,
      `test/unit/fsm.definition.spec.ts`.
- [ ] `Queue` stores changes and returns the latest value per name.
      Check: `test/integration/queue.service.spec.ts`.
- [ ] Service rejects a body with any bad entry without applying the
      good ones, applies a valid body, raises the declared event once
      per changed parameter, and raises none for an unchanged value.
      Check: `test/unit/parameters.service.spec.ts`.
- [ ] `GET` and `PUT /parameters` behave as specified, including `404`
      without a machine. Check: `test/e2e/parameters.spec.ts`.
- [ ] MQTT routes return the same bodies. Check:
      `test/unit/mqtt-request.handler.spec.ts`, `test/e2e/mqtt.spec.ts`.
- [ ] `GET /state` shows the current values. Check:
      `test/e2e/state.spec.ts`.
- [ ] README, design document and request files updated. Check:
      `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
