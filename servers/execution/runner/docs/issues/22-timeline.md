# 22 Durable Timeline

- Status: planned. The open questions below are for the owner.
- Depends on: 19 (properties), 21 (the class of a twin)
- PR: none yet
- Research note: W3 of
  [wldt-research-notes.md](../wldt-research-notes.md). It is the base
  of [23](23-snapshot.md) and [24](24-what-if.md).

## Spec

The runner knows where a DT is, and not how it came there. The
machine is one row, written over at each entry. The time spent in
each state is counted in memory and lost at a restart. A command is
stored without the state it ran in, and an event that moved nothing is
only counted. So "why is this DT in `full`?" has no answer after a
restart, and no earlier moment can be rebuilt.

This issue adds a timeline: one table that only grows, with a row for
each thing that changed the DT or asked it to change.

### Rows

Every row has `seq`, a number that only rises, `time`, `kind`, `by`
(the principal, `script`, or `null`) and `data`, as JSON.

| Kind         | When                                 | Data                                                               |
| :----------- | :----------------------------------- | :----------------------------------------------------------------- |
| `start`      | the runner starts                    | the class id and version, the instance values, what was restored   |
| `entry`      | the machine enters a state           | `state`, `entry`, `cause`, and the parameters and properties then  |
| `exit`       | the script of an entry ends          | `entry`, the outcome, and the id of its row in the command history |
| `event`      | an event is raised and moves nothing | `event`, `state`, and the reply: `no transition`, `invalid event`  |
| `parameters` | a parameter changes                  | the names and the new values                                       |
| `command`    | a command is submitted with `POST /` | `name`, the id of its row in the command history                   |
| `peers`      | a peer is enabled or disabled        | the ids and the switches                                           |
| `stop`       | the runner shuts down                | nothing                                                            |

`cause` of an entry says what led to it:

| `cause.kind` | `cause.name`                                      |
| :----------- | :------------------------------------------------ |
| `transition` | none: a client asked for the state                |
| `event`      | the event that a caller raised                    |
| `completion` | `$success`, `$failure` or `$stopped`              |
| `peer`       | the event, with the `peer` whose notice raised it |
| `parameter`  | the event, with the `parameter` that changed      |

An `entry` row carries the values of every parameter and property at
that moment. Issue 19 keeps only the latest value of a property, on
purpose: a history of every write would grow with the rate of a
sensor. The values at each entry grow with the rate of transitions,
and they are what [23](23-snapshot.md) needs to rebuild the DT at an
entry.

### Reading

`GET /timeline` and the MQTT route `timeline` answer the rows, oldest
first:

| Query   | Meaning                                              |
| :------ | :--------------------------------------------------- |
| `after` | only rows with a `seq` above this one                |
| `since` | only rows at or after this time                      |
| `until` | only rows before this time                           |
| `kind`  | only rows of these kinds, separated by commas        |
| `limit` | at most this many rows, 100 by default, 1000 at most |
| `count` | `true` answers the number of rows, and no rows       |

A reader that wants everything asks again with `after` set to the last
`seq` it has. Every role but `sensor` may read.

### Not in this issue

- A history of every property write.
- The raw notices of peers. See the open questions.
- Metrics that survive a restart, which could later be computed from
  the timeline.
- A revision number on the state document (W1). See the open
  questions.
- Deleting or changing a row.

### Open questions

1. **A route of its own, or `GET /history`?** The research note put
   the rows under `GET /history?kind=`. `/history` answers commands,
   with their own shape and query. A new route keeps both simple. The
   plan below assumes `/timeline`.
2. **What is an input?** For [24](24-what-if.md) to replay a night,
   the timeline must hold everything that came from outside. Requests
   are rows already. Three more things come from outside:
   - the input of a command, such as the patient of `admit`;
   - the notices of peers, which the scripts read with `GET /peers`;
   - the property values that a `sensor` writes.

   Each costs space, and the first may hold personal data. The plan
   records none of them; 24 says what a replay loses without them.

3. **How long are rows kept?** The table only grows, like the command
   history, which is never pruned either. A limit in `runner.yaml`, by
   rows or by age, could prune both. Without a decision, the plan
   keeps every row.
4. **Is `seq` the revision of W1?** W1 asks for a number on the state
   document that rises with every change. `seq` rises with every row,
   but a property write makes no row. Either the state document gets
   its own counter, stored with each row, or W1 stays apart. The plan
   keeps W1 apart.

## Plan

Provisional, on the assumptions above:

1. `src/queue.timeline.ts` (new): the table, its insert and its query,
   beside `queue.properties.ts`. `queue.service.ts` is at 240 lines,
   so it gains two thin methods at most.
2. `src/fsm/timeline.ts` (new): a plain class `Timeline` that builds
   the rows. `FsmService` is at 248 lines; it already signals each
   answer (`onAnswer`), each change (`onChange`) and each escalation.
   The cause of an entry is not in those signals, so `Requests` and
   `enter` pass it on, which needs room made first.
3. `src/descriptor.service.ts` owns `Timeline`, as it owns `Peers` and
   `Properties`, and writes the `start` and `stop` rows.
4. `src/timeline.controller.ts` (new), `src/dto/timeline.dto.ts`
   (new), and the MQTT route in `src/mqtt/mqtt.config.ts`,
   `src/mqtt/mqtt-request.handler.ts` and `src/auth/roles.ts`.
5. Documents: `README.md`, `STATE-MACHINE.md`, `api/API.md`,
   `api/*.http`, and decisions in `docs/state-machine-design.md`.

## Tasks

- [ ] Each kind of row is written once, with its cause and caller, in
      the order things happened. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [ ] An `entry` row holds the parameters and properties of that
      moment, and an `exit` row names its command. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [ ] The table opens in a database of 0.11.0, and the rows survive a
      restart, which adds a `start` row. Check:
      `test/integration/queue.timeline.spec.ts`,
      `test/e2e/restart.spec.ts`.
- [ ] The queries filter and page as specified, over HTTP and MQTT,
      and `sensor` is refused. Check: `test/e2e/timeline.spec.ts`,
      `test/unit/auth.roles.spec.ts`.
- [ ] A write that fails is logged and stops nothing. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
