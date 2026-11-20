# 19 Properties: Latest Sensed and Computed Values

- Status: planned
- Depends on: 04 (the declaration and storage pattern), 15a (the new
  role), 20 (the `runner.yaml` layout its settings go into)
- PR: none yet
- Research note: none in the DTN notes' table. It reopens item 2 of
  [dtn-research-notes.md](../dtn-research-notes.md#2-one-state-document-r1)
  (the mirrored state `x_i`) and answers open question 9 there. It
  follows WLDT's properties
  ([wldt-research-notes.md](../wldt-research-notes.md)).

## Spec

P1 writes a DT's state as `s_i = (x_i, λ_i, θ_i)`: the state mirrored
from the physical twin (PT), the active policy, and the shared
parameters. The state document has `machine` (`λ_i`, 02) and
`parameters` (`θ_i`, 04), but nothing for `x_i`. Only the scripts
know the PT. This issue lets them hand the runner the latest values
they sensed or computed. The runner holds the values, checks them
against their declarations, stores them, and shows and publishes them.
It never interprets them.

A property differs from a parameter in who writes it:

| Value                        | Written by                                   | Read by  | Example           |
| :--------------------------- | :------------------------------------------- | :------- | :---------------- |
| uncontrollable parameter     | the DT author, as `default`                  | everyone | `capacity`        |
| controllable parameter       | a Manager or client (04)                     | everyone | `scope`           |
| property, `source: sensed`   | a script, or a feeder with the role `sensor` | everyone | `free-beds`       |
| property, `source: computed` | a script                                     | everyone | `free-beds-in-2h` |

### Declaration

Properties are declared in the state machine file, the DT author's
file (S4, D21), next to `parameters`:

```yaml
properties:
  free-beds:
    type: number
    source: sensed
  occupancy:
    type: number
    source: sensed
    unit: '%'
  free-beds-in-2h:
    type: number
    source: computed
```

The keys of a property:

- **`type`**: `string`, `number`, `boolean` or `enum`, with `values`.
  These are the value types of 04, with the same checks.
- **`source`**: `sensed` (the default) or `computed`. It lets a
  Manager tell a measured value from a simulated one. The runner shows
  `source` and never acts on it.
- **`unit`**: optional. It is stored and shown, never interpreted.

Rules:

- There is no `default`. A property is `null` until its first write.
- Names follow the name pattern of states and parameters, and a name
  may not be both a parameter and a property.
- Properties need a state machine file. A DT without one has none,
  just as it has no parameters (D21).

### Writing values

`PUT /properties` (HTTP) and `<base>/set-properties` (MQTT) take a flat
object of names to values, such as `{"free-beds": 1, "occupancy": 80}`.
The runner:

1. Checks the whole body first, and changes nothing if any entry has a
   problem. Every problem is listed in the `400` reply. A problem is a
   property that is not declared or a value of the wrong type. `null`
   is accepted for every type and marks the value as unknown, for
   example while a sensor is offline.
2. Stamps each written property with `time`, the runner's clock at the
   write, and `by`, the principal name or `script`.
3. Stores the values, keeping only the latest per name, then applies
   them.
4. Raises no event. A script that wants the machine to react to a
   value raises an event itself with `POST /fsm/event`, as it does
   today.

Rewriting the same value still updates `time`, so a feed that keeps
writing shows that it is alive. On success the reply is `200` with the
document of `GET /properties`. `{}` is `200` and changes nothing.

Who may write:

| Role      | `set-properties` | Why                                                                 |
| :-------- | :--------------- | :------------------------------------------------------------------ |
| `script`  | yes              | Scripts know the PT; HTTP only, as for every script call (S11)      |
| `sensor`  | yes (new role)   | A gateway or flow outside the runner feeds values over HTTP or MQTT |
| `client`  | yes              | Tests and manual operation; `client` may call every route (S10)     |
| `manager` | no               | A Manager tunes `θ_i`. It should not be able to fake `x_i`          |

The new role `sensor` may call only `properties`, `set-properties` and
`health`. Its principals are listed in `runner.yaml` like any other
(S9), so the operator decides who may feed a DT.

### Reading values

`GET /properties` and `<base>/properties` are open to every role. They
answer `200`, or `404` without a state machine, like `GET /parameters`:

```json
{
  "free-beds": {
    "value": 1,
    "time": "2026-11-20T10:15:02.120Z",
    "by": "script",
    "type": "number",
    "source": "sensed"
  },
  "free-beds-in-2h": {
    "value": null,
    "time": null,
    "by": null,
    "type": "number",
    "source": "computed"
  }
}
```

Scripts read properties with `GET $RUNNER_URL/properties`. There is no
`DT_PROP_*` variable: a value copied when the script starts would go
stale during a long run.

### State document and notifications

The state document gains a `properties` map of each name to
`{value, time}`.

A state notification whose only difference from the last one sent is
in property values is held back. It is sent once `stateInterval`
milliseconds have passed since the last state notification. The
setting goes in `runner.yaml`, because rates are the operator's call,
and defaults to `1000`. A change of machine, parameters or command is
sent at once, and carries any properties that were held back. A fast
feed therefore produces at most one notification per interval, while
control changes are never delayed.

### Persistence

A `properties` table holds one row per name: the value as JSON, `time`
and `by`. Each write is an upsert, so the table never grows with the
write rate. At restart, the stored values are restored with their
original `time`, so a reader sees how old they are. A stored value
that no longer fits its declaration is dropped with a warning, as for
parameters (09). There is no history of values; the latest value is
all the runner keeps.

### Example: the hospital

The `open` script of `demo/hospital` already counts free beds as it
samples them. It would write the count on each sample:

```powershell
$body = @{ 'free-beds' = (Get-FreeBeds) } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Put -Uri "$env:RUNNER_URL/properties" `
  -Headers $RunnerHeaders -ContentType 'application/json' -Body $body
```

```sh
curl -sf -X PUT "$RUNNER_URL/properties" \
  -H "Authorization: Bearer $RUNNER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"free-beds": 1}'
```

A Manager then sees `free-beds: 1` in `hospital-1`'s state document,
not only the state name `open`.

### Not in This Issue

- **Intermediate simulation data.** Series, checkpoints, traces and
  hand-offs between scripts stay in the run directory (18) or in an
  external store. Only results that a Manager or peer should see
  become properties, as their latest value.
- **A sampler script** kept alive by the runner, outside the machine.
  This was decided against on 2026-11-20. Sensing lives in state
  scripts or in a `sensor` feeder.
- **The runner reading PT protocols itself**, such as a mapping from
  MQTT topics to properties. That would make the runner a physical
  adapter.
- **Peer subscriptions on property values**, for example
  `when: {property: free-beds, equals: 0}`.
- **A `json` type** for structured computed results, such as a short
  forecast series.
- **Knowing which script wrote a value.** Every script shares one
  `RUNNER_TOKEN` (S11), so `by` is `script` and the runner cannot tell
  which state or entry wrote it.

## Plan

1. `src/fsm/properties.ts` (new):
   - the zod schema of the section, reusing the value schemas of
     `parameters.ts`;
   - `propertyProblems(definition)` for the cross-checks: `values` for
     an `enum`, and no name shared with a parameter;
   - a plain class `Properties` with `values()`, `document()`,
     `check(body)` and `commit(changes)`, modelled on `Parameters`.
2. `src/fsm/definition.ts`: the section in `fileSchema`, `Definition`
   and `toDefinition`. The file is at 237 lines, so first move the
   `hasProtoKey` helpers to `src/fsm/proto.ts`.
3. `src/queue.properties.ts` (new): the table and its upsert, kept
   beside `queue.service.ts` (241 lines) in the way
   `queue.machine.ts` and `queue.peers.ts` already are. Add a guarded
   migration, with a test that opens a database of the earlier version.
4. `src/fsm/fsm.service.ts` is at 249 lines, so it does not grow.
   `Properties` belongs to a new `PropertiesService`, which takes the
   definition from `FsmService.declared()` and the `Queue`. Restore
   runs after `FsmService.restore()` in `src/main.ts`.
5. `src/auth/auth.config.ts`: add `sensor` to the principal roles.
   `src/auth/roles.ts`: add `properties` (every role, `sensor`
   included) and `set-properties` (`client`, `script`, `sensor`), and
   allow `sensor` on `health`.
6. `src/properties.controller.ts` (new), plus the two MQTT routes in
   `src/mqtt/mqtt.config.ts` and `src/mqtt/mqtt-request.handler.ts`.
7. `src/descriptor.service.ts` and `src/dto/state.dto.ts`: add the
   `properties` map. `src/notify/notifier.service.ts`: hold back
   notifications whose only change is in properties, using
   `stateInterval` from `src/config/config.schema.ts`.
8. Documentation:
   - `README.md` and `STATE-MACHINE.md`: a Properties section;
   - `api/API.md` and `api/*.http`: the routes and the role;
   - `SECURITY-MODEL.md`: the `sensor` role;
   - `docs/state-machine-design.md`: new decisions for the declaration
     and writers, the role, and the notification interval;
   - `config/state-machine.yaml.sample` and `config/runner.yaml.sample`:
     an example of each new key;
   - `docs/issues/README.md`: the non-goal "a script that mirrors
     physical-twin state into the state document" was dropped when this
     issue was planned; mark 19 done in the status table.
9. `demo/hospital`: `open.ps1` writes `free-beds`. Re-record the casts
   only if the issue owner asks.

## Tasks

- [ ] The schema accepts the example, and rejects an unknown `source`,
      an `enum` without `values`, and a name shared with a parameter.
      Check: `test/unit/fsm.properties.spec.ts`.
- [ ] `Properties.check` rejects a whole body if any entry is bad,
      accepts `null`, and stamps `time` and `by`. Check:
      `test/unit/fsm.properties.spec.ts`.
- [ ] The table keeps one row per name, the migration opens an earlier
      database, and restore keeps the original `time`. Check:
      `test/integration/queue.properties.spec.ts`.
- [ ] The roles: `manager` gets `403` on `set-properties`; `sensor`
      gets `403` on every other route except `properties` and
      `health`. Check: `test/unit/auth.roles.spec.ts`,
      `test/e2e/properties.spec.ts`.
- [ ] `GET` and `PUT /properties` and the MQTT routes behave as
      specified, including `404` without a machine. Check:
      `test/e2e/properties.spec.ts`, `test/e2e/mqtt.spec.ts`,
      `test/e2e/mqtt.broker.spec.ts`.
- [ ] Notifications that change only properties are held to one per
      `stateInterval`, and a machine change is sent at once with the
      held values. Check: `test/unit/notifier.properties.spec.ts`.
- [ ] Documents and samples updated. Check: markdownlint and yamllint
      from the repository root.
- [ ] `yarn build` and `yarn test` pass, `npx tsc --noEmit
    --noUnusedLocals --noUnusedParameters` is clean, and no function
      crosses the Qlty thresholds.

## Learnings

To be written by the pull request that implements this issue.
