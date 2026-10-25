# 01 DT Identity and Descriptor

- Status: planned
- Depends on: none
- PR: none
- Research note:
  [item 1](../dtn-research-notes.md#1-dt-identity-and-descriptor)

## Spec

A Manager and the runner's own notifications must name the DT that a
runner serves. Today nothing but the port or the MQTT base topic tells
two runners apart, and only the `mqtt` section of `runner.yaml` is
validated.

### Configuration

`runner.yaml` gains three keys and is validated as a whole:

```yaml
id: hospital-1 # required; letters, digits, _, . or -, up to 64
attributes: # optional; flat map of strings, numbers and booleans
  city: Aarhus
  beds: 120
stateMachine: 'scripts/state-machine.yaml' # optional, relative to this file
port: 5000
location: 'scripts'
commands:
  - create
  - execute
```

- `id` is required and follows the name pattern of states
  (`src/fsm/definition.ts`, `NAME`). A missing or invalid `id` stops
  the runner at startup.
- `attributes` is optional. Values are strings, numbers or booleans;
  nested values are an error. Keys follow the name pattern.
- `stateMachine` replaces the fixed `state-machine.yaml` lookup in
  `location`. Without the key no machine is loaded. This amends D1 of
  the design document and is a breaking change for DTs that rely on the
  fixed name; `README.md` and `config/runner.yaml.sample` show the key.
- The whole file is parsed by one zod schema, `strict`, so an unknown
  key is an error. The message names every problem, as the `mqtt`
  check does today (`src/config/configuration.service.ts:32-40`), and
  that check folds into the schema.

### API

`GET /dt` and the MQTT route `<base>/dt` answer with the descriptor:

```json
{
  "id": "hospital-1",
  "attributes": { "city": "Aarhus", "beds": 120 },
  "commands": ["create", "execute"],
  "stateMachine": true
}
```

`attributes` is `{}` when none are configured; `stateMachine` says
whether a machine is loaded. Later features add `manager` (05) to this
document. The descriptor carries no runner version.

## Plan

1. Add `src/config/config.schema.ts`: zod schema of the whole
   configuration, with `id`, `attributes`, `stateMachine`, `port`,
   `location`, `commands`, `database` and the existing
   `mqttConfigSchema`. Derive `ConfigValues` from it in
   `src/config/config.interface.ts` and drop the unused
   `PermitCommand` type if nothing else needs it (report it, do not
   bundle unrelated removals).
1. Parse the file through the schema in `Config.loadConfig`
   (`src/config/configuration.service.ts`), resolve `stateMachine`
   against the config directory like `database`, and add `getId()`,
   `getAttributes()` and `getStateMachine()`.
1. Make `loadDefinition` in `src/fsm/definition.ts` take the file path
   instead of `location`, and have `FsmService.load` pass
   `config.getStateMachine()`; keep `parseDefinition` as it is.
1. Add `src/dto/descriptor.dto.ts` and a `descriptor()` method on a new
   `src/descriptor.service.ts` that composes `Config` and `FsmService`.
1. Add `GET /dt` to `src/app.controller.ts` and the `dt` route to
   `src/mqtt/mqtt.config.ts` and `src/mqtt/mqtt-request.handler.ts`.
1. Update `config/runner.yaml.sample`, `test/config/runner.test.yaml`,
   `test/data/config/*.yaml`, `api/dev.api.http`, `api/dev.mqtt.http`.
1. Document the keys and the route in `README.md` (Configure, API, MQTT
   API), amend D1 in `docs/state-machine-design.md` and add a decision
   for the required `id`, and update
   `docs/developer/codebase/runner.md` at the repository root.
1. Bump `package.json` to `0.5.0` for the `stateMachine` key.

## Tasks

- [ ] Configuration schema accepts the sample file and rejects a missing
      `id`, an invalid `id`, nested `attributes`, an unknown key and an
      invalid `mqtt` section, each with a message naming the problem.
      Check: `test/unit/config.schema.spec.ts`.
- [ ] `Config` resolves `stateMachine` against the config directory and
      exposes `getId`, `getAttributes`, `getStateMachine`. Check:
      `test/integration/options.service.spec.ts`.
- [ ] A runner without `stateMachine` loads no machine; one with the key
      loads the named file; a key naming a missing file stops the runner
      with a message. Check: `test/unit/fsm.definition.spec.ts`,
      `test/unit/fsm.service.spec.ts`.
- [ ] `GET /dt` returns the descriptor with `attributes: {}` when none
      are configured. Check: `test/e2e/descriptor.spec.ts`.
- [ ] The `dt` MQTT route returns the same body. Check:
      `test/unit/mqtt-request.handler.spec.ts`,
      `test/e2e/mqtt.spec.ts`.
- [ ] Sample, test and request files carry `id` and `stateMachine`.
      Check: `yarn test` runs green from the copied test config.
- [ ] README, design document (D1 amended, new decision for `id`) and
      the developer page describe the keys and the route. Check:
      `npx markdownlint-cli README.md docs/*.md` from the runner
      directory.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
