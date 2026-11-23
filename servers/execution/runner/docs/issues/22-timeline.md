# 22 Durable Timeline

- Status: planned. What is recorded was decided on 2026-11-23; the
  open questions below are for the owner.
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

Every row has `seq`, a number that only rises, `time`, to the
millisecond, `kind`, `by` (the principal, `script`, or `null`) and
`data`, as JSON. The owner decided on 2026-11-23 what is recorded:
everything that enters the DT, everything that changes in it, and
everything that it sends.

What enters:

| Kind         | When                                   | Data                                                              |
| :----------- | :------------------------------------- | :---------------------------------------------------------------- |
| `transition` | a client asks for a state              | `state`, and the reply                                            |
| `event`      | anyone raises an event, a script too   | `event`, `source`, and the reply, also when it moves nothing      |
| `command`    | a command is submitted with `POST /`   | `name`, its `input`, and the id of its row in the command history |
| `parameters` | a caller sets parameters               | the names and the new values                                      |
| `properties` | a script or a sensor writes properties | the names and the new values                                      |
| `peers`      | a caller enables or disables a peer    | the ids and the switches                                          |
| `notice`     | a notice of a followed peer arrives    | `peer`, `kind` (`state` or `presence`), and the notice            |

What changes:

| Kind    | When                        | Data                                                               |
| :------ | :-------------------------- | :----------------------------------------------------------------- |
| `start` | the runner starts           | the class, the instance values, and the whole state it starts with |
| `entry` | the machine enters a state  | `state`, `entry`, and the `seq` of the row that caused it          |
| `exit`  | the script of an entry ends | `entry`, the outcome, the id of its row in the command history     |
| `stop`  | the runner shuts down       | nothing                                                            |

What is sent:

| Kind   | When                            | Data                                                          |
| :----- | :------------------------------ | :------------------------------------------------------------ |
| `sent` | the runner sends a notification | its `kind` (`state`, `escalation`, `presence`) and its `data` |

`source` of an event is who raised it: `client`, `script`, `peer`
(with the `seq` of the notice), `parameter` (with the `seq` of the
change) or `completion` (with the `seq` of the exit).

The `start` row holds the initial values: the machine as restored,
every parameter and every property. With it, the state of the DT at
any `seq` is the `start` row before it and the rows between, applied
in order. [23](23-snapshot.md) builds a snapshot of any moment that
way, not only of an entry.

This reverses one line of issue 19, "there is no history of values":
a property write is now a row. Two things keep the table from
growing with the rate of a sensor:

- a write that changes no value makes no row, although it still moves
  the `time` of the property;
- the state notifications are already held to one per `stateInterval`,
  so the `sent` rows are too.

A feed that changes a value at every write still makes a row at every
write. With no limit on the table, the operator of such a feed has to
watch the size of the database.

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

- Metrics that survive a restart, which could later be computed from
  the timeline.
- A limit on the rows, by number or by age. The owner decided on
  2026-11-23 to have none for now; the command history has none
  either.
- Deleting or changing a row.
- The webhook's retries, and whether a notification arrived.

### Decided

| Question               | Decision of 2026-11-23                                                                                                                                   |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is recorded       | Commands with their inputs, the notices of peers, every change of the state, every event of every participant, what the DT sends, and the initial values |
| How long rows are kept | No limit now                                                                                                                                             |

### Open questions

1. **A route of its own, or `GET /history`?** The research note put
   the rows under `GET /history?kind=`. `/history` answers commands,
   with their own shape and query. A new route keeps both simple. The
   plan assumes `/timeline`.
2. **Personal data.** The input of a command is now stored, and the
   demo's `admit` takes a patient. Every role but `sensor` may read
   the timeline. Should `input` be shown to `client` only, as the
   logs of a command are?
3. **Is `seq` the revision of W1?** Every change of the state
   document now makes a row, so the `seq` of the last row is a
   revision. W1 could be closed by showing it in the state document.

## Plan

Provisional, on the assumptions above:

1. `src/queue.timeline.ts` (new): the table, its insert and its query,
   beside `queue.properties.ts`. `queue.service.ts` is at 240 lines,
   so it gains two thin methods at most.
2. `src/fsm/timeline.ts` (new): a plain class `Timeline` that builds
   the rows. `FsmService` is at 248 lines; it already signals each
   answer (`onAnswer`), each change (`onChange`) and each escalation.
   The source of an event is not in those signals, so `Requests` and
   `enter` pass it on, which needs room made first.
3. The other writers call `Timeline` where they already store:
   `Parameters`, `Properties`, `Peers` (switches and notices),
   `ExecaManager` (commands) and `Notifier` (what is sent).
4. `src/descriptor.service.ts` owns `Timeline`, as it owns `Peers` and
   `Properties`, and writes the `start` and `stop` rows.
5. `src/timeline.controller.ts` (new), `src/dto/timeline.dto.ts`
   (new), and the MQTT route in `src/mqtt/mqtt.config.ts`,
   `src/mqtt/mqtt-request.handler.ts` and `src/auth/roles.ts`.
6. Documents: `README.md`, `STATE-MACHINE.md`, `api/API.md`,
   `api/*.http`, and decisions in `docs/state-machine-design.md`.

## Tasks

- [ ] Each kind of row is written once, with its cause and caller, in
      the order things happened. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [ ] The `start` row holds the whole state, and the state at any
      later `seq` follows from the rows. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [ ] A command row holds its input, a notice row the notice, and a
      `sent` row the notification. A property write that changes no
      value makes no row. Check: `test/unit/fsm.timeline.spec.ts`.
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
