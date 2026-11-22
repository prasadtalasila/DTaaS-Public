# 19 and 20: DT Properties and the Grouped runner.yaml

- Status: in progress. The code, tests and documents are on the branch
  `runner/19-properties-and-config`; no pull request is open yet.
- Depends on: 04 (the declaration and storage pattern), 15a (the roles)
- PR: none yet
- Research note: item 2 and open question 9 of
  [dtn-research-notes.md](../dtn-research-notes.md) (the mirrored state
  `x_i`), the properties of
  [wldt-research-notes.md](../wldt-research-notes.md), and C2 of
  [dt-capabilities-comparison.md](../dt-capabilities-comparison.md).

This file replaces the separate issues 19 (properties) and 20 (the
sections of `runner.yaml`), which the owner merged on 2026-11-22. It
also carries C2, the types of the properties.

## Spec

P1 writes a DT's state as `s_i = (x_i, λ_i, θ_i)`: the state mirrored
from the physical twin (PT), the active policy, and the shared
parameters. The state document had `machine` (`λ_i`, 02) and
`parameters` (`θ_i`, 04), but nothing for `x_i`. Only the scripts know
the PT. This issue lets them hand the runner the latest values they
sensed or computed. The runner checks the values against their
declarations, stores them, and shows and publishes them. It never
interprets them.

The issue adds a role and a setting to `runner.yaml`, which had grown
to twelve top-level keys. Part A groups the file first.

### Part A: the layout of runner.yaml

The operator's settings are of three kinds: what runs, who the DT
deals with, and security. The keys of the second kind move under a new
key, `relationships`:

```yaml
id: 'hospital-1'
port: 5100
location: 'scripts'
commands:
  - open
stateMachine: 'hospital.fsm.yaml'
database: 'runner.db'
stateInterval: 1000
mqtt:
  url: 'mqtt://localhost:1883'
  topic: 'dtaas/hospital-1'
relationships:
  manager:
    notify:
      url: 'https://manager.example.org/dt-events'
      token: 'secret'
  peers:
    - id: 'hospital-2'
      topic: 'dtaas/hospital-2'
auth:
  principals:
    - name: 'ward-gateway'
      role: 'sensor'
      publicKey: 'mCpoaytWvGJ9K0lxNlSNw6sjUG7UezRWtxPvL1pyxKA'
scripts:
  user: 'dt-script'
  runDirectory: '/var/lib/dt/hospital-1/run'
```

| Before 0.11 | From 0.11                      |
| :---------- | :----------------------------- |
| `notify`    | `relationships.manager.notify` |
| `peers`     | `relationships.peers`          |

The schema of each moved section does not change. `mqtt` stays at the
top, because it carries the API as well as the notifications.

`auth` and `scripts` stay where they are. The first plan moved both
under a `security` key. The owner kept `scripts` at the top, as it
says as whom the scripts run, which belongs to "what runs". A
`security` key would then only have renamed `auth`, so it was dropped.

Migration:

- Version 0.11 accepts either layout. A file with an old key starts
  with one warning for each, which names the old key and its new path.
- A section set in both places, such as `peers` and
  `relationships.peers`, is a startup error.
- A problem in an old key is reported at its new path.
- Version 0.12 removes the old keys.

### Part B: properties

A property differs from a parameter in who writes it:

| Value                    | Written by                                   | Example     |
| :----------------------- | :------------------------------------------- | :---------- |
| uncontrollable parameter | the DT author, as `default`                  | `capacity`  |
| controllable parameter   | a Manager or client (04)                     | `scope`     |
| property                 | a script, or a feeder with the role `sensor` | `free-beds` |

The first plan told sensed from computed properties with a `source`
key. The owner dropped it: the runner never acted on it, the line
between the two is blurred (an occupancy is computed from sensed
values), and a label that nothing checks can be wrong.

#### Declaration

Properties are declared in the state machine file, in YAML, next to
`parameters`. The types are those of JSON Schema, as a Thing
Description of the Web of Things uses them (C2):

```yaml
properties:
  free-beds:
    type: integer
    minimum: 0
    unit: beds
  ward-status:
    type: string
    enum:
      - open
      - full
      - closed
  forecast:
    type: array
    items:
      type: number
      unit: beds
```

| Keyword                  | Applies to                    | Needed            |
| :----------------------- | :---------------------------- | :---------------- |
| `type`                   | every value                   | yes               |
| `enum`                   | `string`, `number`, `integer` | no                |
| `minimum`, `maximum`     | `number`, `integer`           | no                |
| `unit`                   | `number`, `integer`           | yes               |
| `items`                  | `array`                       | yes               |
| `properties`, `required` | `object`                      | `properties` only |

`type` is `string`, `number`, `integer`, `boolean`, `object` or
`array`. No other keyword of JSON Schema is accepted, and the runner
builds its check from these with zod, without a new dependency.

Rules:

- Every number names its unit, also inside an object or an array. A
  number without a dimension is written with `unit: '1'`, so that a
  missing unit is always an error.
- There is no `default`. A property is `null` until its first write.
- A name may not be both a parameter and a property.
- The names `set` and `response` are reserved, for parameters,
  properties and peers alike (see [MQTT topics](#mqtt-topics)).

#### Parameters share the types

Parameters use the scalar part of the same vocabulary: `string`,
`number`, `integer` and `boolean`, with `enum`, `minimum` and
`maximum`. A parameter takes no unit: it is a setting of a policy, not
a measurement.

An enum is therefore written as JSON Schema writes it:

```yaml
# before 0.11
scope:
  type: enum
  values:
    - single
    - multi
  default: single
# from 0.11
scope:
  type: string
  enum:
    - single
    - multi
  default: single
```

The old spelling loads in 0.11, with one warning that names the
parameters, and goes in 0.12. `GET /parameters` shows the new spelling
for both, which changes its reply.

#### A file without states

The declarations live in the state machine file because it is the DT
author's file (S4, D21). The file needed at least one state, so a DT
that only runs commands could have neither parameters nor properties.
`states` is now optional. A file without states declares `parameters`,
`properties` and `manager.commands`, and the DT has no machine:
`GET /fsm` and the transition and event routes answer
`no state machine`, as they do without a file. Such a file is refused
if it has `events` or `subscriptions`, which have nothing to act on.

#### Writing

`PUT /properties` takes a flat object of names to values, such as
`{"free-beds": 1}`. The runner:

1. checks the whole body, and changes nothing if any entry is not
   declared or does not fit; every problem is listed in the `400`;
2. accepts `null` for every type, as "not known", for example while a
   sensor is offline;
3. stamps each written property with `time`, the runner's clock, and
   `by`, the principal name, `script`, or `null` without access
   control;
4. stores the latest value of each name, then applies it;
5. raises no event. A script that wants the machine to react raises
   an event itself, as today.

Writing the same value again updates `time`, so a feed shows that it
is alive. `{}` is `200` and changes nothing.

| Role      | `set-properties` | Why                                                  |
| :-------- | :--------------- | :--------------------------------------------------- |
| `script`  | yes              | Scripts know the PT; over HTTP only, as always (S11) |
| `sensor`  | yes (new role)   | A gateway outside the runner feeds values            |
| `client`  | yes              | Tests and manual operation (S10)                     |
| `manager` | no               | A Manager tunes `θ_i`; it must not fake `x_i`        |

The role `sensor` may call only `properties`, `set-properties` and
`health`. Its principals are listed in `runner.yaml` like the others
(S9).

#### Reading

`GET /properties` is open to every role. It answers `404` without a
state machine file, like `GET /parameters`:

```json
{
  "free-beds": {
    "value": 1,
    "time": "2026-11-22T10:15:02.120Z",
    "by": "script",
    "type": "integer",
    "minimum": 0,
    "unit": "beds"
  }
}
```

There is no `DT_PROP_*` variable: a value copied when a script starts
would go stale during a long run.

#### State document and notifications

The state document gains a `properties` map of each name to
`{value, time}`.

A state notification whose only change is in property values is held
until `stateInterval` milliseconds after the last state notification.
The setting is in `runner.yaml`, because rates are the operator's
call, and defaults to `1000`. A change of machine, parameters or
command is sent at once and carries the values that were held. A fast
feed therefore gives at most one notification per interval, and
control changes are never delayed.

#### Persistence

A `properties` table holds one row per name: the value as JSON, `time`
and `by`. Each write replaces the row, so the table does not grow with
the write rate. At a restart the values come back with their original
`time`. A stored value that no longer fits its declaration is dropped
with a warning. There is no history of values.

### MQTT topics

The first plan named the write topic `<base>/set-properties`, after
`set-parameters` and `set-peers`. The owner asked for
`<base>/properties/set` and `<base>/properties/get`. The hierarchy is
right: one resource is one subtree, and a broker can grant a sensor
`<base>/properties/#`. Two things were changed in it:

- **No `get`.** Every read of the runner is the bare noun, such as
  `<base>/parameters` and `<base>/state`.
- **All three resources.** One resource with its own pattern would be
  worse than either pattern.

| Resource   | Read                | Write                   | Write before 0.11       |
| :--------- | :------------------ | :---------------------- | :---------------------- |
| properties | `<base>/properties` | `<base>/properties/set` | none                    |
| parameters | `<base>/parameters` | `<base>/parameters/set` | `<base>/set-parameters` |
| peers      | `<base>/peers`      | `<base>/peers/set`      | `<base>/set-peers`      |

- The old write topics answer in 0.11, with one warning at their
  first use, and go in 0.12.
- The route names of the role table do not change (`set-parameters`,
  `set-peers`, `set-properties`), as HTTP and MQTT share them.
- `set` and `response` are reserved names, because a write topic and
  its default response topic sit under the read topic. That leaves
  room for a topic per name, `<base>/properties/<name>` (C7).
- The default response topic of a write is two levels under the
  resource, such as `<base>/parameters/set/response`. A subscription
  to `<base>/+/response` does not match it; a client adds
  `<base>/+/set/response`, or names a response topic with MQTT 5.

### Not in this issue

- **Intermediate simulation data.** Series, checkpoints and traces
  stay in the run directory (18) or in an external store.
- **A sampler script** kept alive by the runner, outside the machine
  (decided against on 2026-11-20).
- **The runner reading PT protocols itself**, which would make it a
  physical adapter.
- **Peer subscriptions on property values.**
- **Telemetry streams** (C6): a property keeps its latest value only.
- **Knowing which script wrote a value.** Every script shares one
  `RUNNER_TOKEN` (S11), so `by` is `script`.
- **A unit on parameters.**

## Plan

As built. Part A:

1. `src/config/layout.ts` (new): moves the old keys of the parsed file
   to their new paths, and returns a warning for each and a problem
   for each section set twice.
2. `src/config/config.schema.ts`: the `relationships` object and
   `stateInterval`. `src/config/configuration.service.ts`: the getters
   read the new paths, so their consumers do not change.
3. `src/mqtt/mqtt.config.ts`: the write topics and the table of the
   old ones. `src/mqtt/request-topics.ts` (new): the request topics of
   a runner and the warning at the first use of an old one.
4. The samples, the demo configs and the test configs in the new
   layout; `demo/hospital/tools/configs.mjs` indents the peer key.

Part B:

1. `src/fsm/value-schema.ts` (new): the vocabulary, the problems of a
   declaration that zod can not see, and the check built from one.
2. `src/fsm/parameters.ts`: the shared vocabulary and the old enum.
   `src/fsm/name.ts`: the reserved names.
3. `src/fsm/properties.ts` (new): the section, its cross-checks, and
   the plain class `Properties`, loaded like `Peers`.
4. `src/fsm/definition.ts`: the section and optional states; the
   `__proto__` helpers moved to `src/fsm/proto.ts` to make room.
   `machineOf` in `src/fsm/state-machine.ts` gives no machine without
   states.
5. `src/queue.properties.ts` (new): the table and its upsert.
6. `src/descriptor.service.ts` owns `Properties`, as it owns `Peers`,
   so that no constructor grows.
7. `src/auth/auth.config.ts` and `src/auth/roles.ts`: the role and the
   two routes. `src/properties.controller.ts` (new) and
   `src/mqtt/mqtt-request.handler.ts`: the routes.
8. `src/notify/state-hold.ts` (new) and
   `src/notify/notifier.service.ts`: the hold of notifications.
9. `demo/hospital`: `free-beds` in both state machine files, written
   by `open.ps1`.
10. The documents: `README.md`, `STATE-MACHINE.md`, `api/API.md`,
    `api/*.http`, `SECURITY-MODEL.md`, `docs/state-machine-design.md`.

## Tasks

Part A:

- [x] The new layout loads, the old layout loads with one warning for
      each moved key, and a section set in both places is refused.
      Check: `test/unit/config.layout.spec.ts`.
- [x] Every getter returns the same value for both layouts. Check:
      `test/integration/config.layout.spec.ts`.
- [x] The write topics sit under the read topics, the old ones answer
      with one warning, and properties have no old topic. Check:
      `test/unit/mqtt.request-topics.spec.ts`,
      `test/e2e/mqtt.write-topics.spec.ts`.
- [x] Samples, demo and test configs use the new layout. Check:
      `yarn test`; yamllint from the repository root.

Part B:

- [x] The vocabulary accepts each type and keyword, names every
      misplaced or missing one, and checks values at any depth. Check:
      `test/unit/fsm.value-schema.spec.ts`.
- [x] Parameters take the new types, and the old enum loads with a
      warning. Check: `test/unit/fsm.parameters.schema.spec.ts`.
- [x] The section rejects a number without a unit, a reserved name and
      a name shared with a parameter. Check:
      `test/unit/fsm.properties.schema.spec.ts`.
- [x] `Properties` rejects a whole body if any entry is bad, accepts
      `null`, stamps `time` and `by`, and restores what still fits.
      Check: `test/unit/fsm.properties.spec.ts`.
- [x] A file without states loads and has no machine. Check:
      `test/unit/fsm.stateless.spec.ts`.
- [x] The table keeps one row per name, opens a database of 0.10.0,
      and keeps the values across a restart. Check:
      `test/integration/queue.properties.spec.ts`.
- [x] `manager` gets `403` on `set-properties`; `sensor` gets `403` on
      every route but the property routes and `health`. Check:
      `test/unit/auth.roles.spec.ts`,
      `test/e2e/properties.access.spec.ts`.
- [x] The HTTP and MQTT routes behave as specified, with `404` without
      a state machine file. Check: `test/e2e/properties.spec.ts`,
      `test/unit/mqtt-request.properties.spec.ts`,
      `test/e2e/mqtt.spec.ts`.
- [x] Notifications that change only properties are held to one per
      `stateInterval`, and a machine change is sent at once with the
      held values. Check: `test/unit/notify.state-hold.spec.ts`,
      `test/unit/notifier.properties.spec.ts`.

Both parts:

- [x] `yarn build` and `yarn test` pass (1354 tests, against 1162
      before), `yarn syntax` is clean, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.
- [x] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] The demo runs with the new files. `pwsh` was not on the machine
      that built this, so `open.ps1` and `ward.ps1` are unrun. Check:
      `node tools/record.mjs` on Windows.
- [ ] `qlty check --upstream` and the checks of the pull request.

## Learnings

- **A record key hides its message.** zod reports a refused key of a
  record as `Invalid key in record`, whatever the refinement says. The
  reserved names are therefore checked with the cross-checks, which
  name the reason.
- **A union hides the type it expected.** A `default` declared as a
  union of string, number and boolean answered `Invalid input` for
  `.nan`. The default is now any value, checked against the
  declaration, which says `expected number, received NaN`.
- **`<base>/+/response` misses the write replies.** The MQTT test
  client subscribed with one wildcard level and saw no reply on
  `parameters/set/response`. Clients written against 0.10 have the
  same subscription, which the documents now say.
- **A write without a state machine file must answer as the read.**
  The first `Properties.set` answered `400 not declared` there, while
  `PUT /parameters` answers `404`; a test that sent `{}` hid it.
- **Line limits shape the design.** `fsm.service.ts`,
  `definition.ts`, `queue.service.ts` and `mqtt.service.ts` were all
  within ten lines of 250. `Properties` went to the descriptor
  service, `inTransaction` to `queue.schema.ts`, and the topic table
  out of the MQTT service.
- **`mqtt.broker.spec.ts` has no room.** It is at 248 lines, so the
  write topics are not in it. They were run once by hand against
  Mosquitto 2 in Docker, with a test that was then removed.
- **The demo appends to its config.** `configs.mjs` writes the peer's
  public key as the last line of `runner.yaml`, with a fixed indent,
  which the new layout deepened by two spaces.
