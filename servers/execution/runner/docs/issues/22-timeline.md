# 22 Durable Timeline

- Status: in progress. The code, tests and documents are on the branch
  `runner/22-timeline`; no pull request is open.
- Depends on: 19 (properties), 21 (the class of a twin)
- PR: none yet
- Research note: W3 of
  [wldt-research-notes.md](../wldt-research-notes.md). It is the base
  of [23](23-snapshot.md), [24](24-what-if.md) and [25](25-replay.md).

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
millisecond, `kind`, `by` and `data`, as JSON. `by` is the caller of
a request row (`transition`, `event`, `command`, `stop`, `parameters`,
`properties`, `peers`): the principal, `script` for a script that
calls with `RUNNER_TOKEN`, or `null` without access control. The rows
that the runner writes itself (`start`, `entry`, `exit`, `notice`,
`sent`, `shutdown`) have `by` `null`, also when a principal's request
caused them; to find who caused an entry, follow its `cause`. The
owner decided on 2026-11-23 what is recorded: everything that enters
the DT, everything that changes in it, and everything that it sends.

What enters:

| Kind         | When                                             | Data                                                                     |
| :----------- | :----------------------------------------------- | :----------------------------------------------------------------------- |
| `transition` | a client asks for a state                        | `state`, and the `reply`                                                 |
| `event`      | anyone raises an event, a script too             | `event`, `source`, and the `reply`, also when it moves nothing           |
| `command`    | a command is submitted with `POST /`             | `name`, its `input`, and `run`, the id of its run in the command history |
| `stop`       | a caller asks to stop a script with `POST /stop` | `name`, or `null` for all                                                |
| `parameters` | a caller sets parameters                         | the names and the new values                                             |
| `properties` | a script or a sensor writes properties           | the names and the new values                                             |
| `peers`      | a caller enables or disables a peer              | the ids and the switches                                                 |
| `notice`     | a notice of a followed peer arrives              | `peer`, `kind` (`state` or `presence`), and the notice as `data`         |

What changes:

| Kind       | When                        | Data                                                                                          |
| :--------- | :-------------------------- | :-------------------------------------------------------------------------------------------- |
| `start`    | the runner starts           | the `class`, the `instance` values, the whole `state` it starts with, and the enabled `peers` |
| `entry`    | the machine enters a state  | `state`, `entry`, and `cause`, the `seq` of the row that caused it                            |
| `exit`     | the script of an entry ends | `state`, `entry`, the `status` of the script, and its `run`                                   |
| `shutdown` | the runner shuts down       | nothing                                                                                       |

What is sent:

| Kind   | When                                             | Data                                                                                              |
| :----- | :----------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `sent` | the runner sends a notification over a transport | its `kind` (`state`, `escalation`, `presence`); `cause` for a state notification, else its `data` |

Issues [23](23-snapshot.md) and [24](24-what-if.md) add the kinds
`snapshot` and `whatif`.

`source` of an event is who raised it: `client`, `script`, `peer`
(with `peer` and `cause`, the `seq` of the notice) or `parameter`
(with `cause`, the `seq` of the change). A script is `script` only
when it calls with its token; without access control it has none, and
its events read `client`. There is no event row for a completion: the
`entry` that a completion leads to names the `exit` row as its
`cause`.

A `transition` or `event` row is written when the request is handled,
and completed once with its `reply`. A `command` row is completed once
with its `run`, which is `null` for a refused command. Nothing else is
ever updated. A repeat of an accepted transition or event request
with its request key makes no row, as it is not handled again; a
repeat of a refused one is handled again and writes a row. A repeated
command request makes a `command` row that names the run of the
first, as does a request that joins a run in progress.

Every `entry` has exactly one `exit` row, with the status of its
script: `valid`, `invalid` or `stopped`. This holds also when a later
entry superseded the entry, or a stop ended its script, so an `exit`
may come after the next `entry`. The exit row is written as the run
ends, before the state notification that reports that end, which
names it as its `cause`. A script that never started, because a later
entry came first or the runner began to shut down, has an exit row
with `stopped` and `run` `null`; one that could not start has
`invalid` and `run` `null`.

Two words tell of a script that the shutdown kept from starting. Its
exit row says `stopped`: what happened to that script. The stored
machine still holds the entry as `running`, so after a restart the
machine reports `interrupted`: what the runner knows of the entry
when it starts. The `shutdown` row is written in the same synchronous
step that marks the machine as stopping, so the scripts still running
at a shutdown, which the runner waits for, and those that it kept from
starting write their `exit` rows after the `shutdown` row.

The end of a command of `POST /` has no row; the command history has
it.

The `start` row holds the initial values: the machine as restored,
every parameter, every property and the enabled peers. With it, what
the runner knew of the DT at any `seq` is the `start` row before it
and the rows between, applied in order. What the scripts kept at that
moment is not in the rows: it exists only where a snapshot of
[23](23-snapshot.md) took it.

A `sent` row is written only when a transport is configured for the
notification: MQTT or a webhook. A state notification is recorded as
`{kind, cause}`, without its document, where `cause` is the last row
that was not `sent`. The presence notice is recorded once at start for
the webhook, at each connect to the broker, and once for each
transport at shutdown.

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

A write to the timeline that fails is logged, and stops nothing: no
reply depends on it.

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
| `count` | `true` answers `{"count": <n>}`, and no rows         |

A reader that wants everything asks again with `after` set to the last
`seq` it has. Every role but `sensor` may read. The `input` of a
`command` row is shown to `client`, and to every caller without access
control; another role gets the row without it. Issue
[23](23-snapshot.md) adds the role `operator`, which will see it too.

### Not in this issue

- Metrics that survive a restart, which could later be computed from
  the timeline.
- A limit on the rows, by number or by age. The owner decided on
  2026-11-23 to have none for now; the command history has none
  either.
- Deleting or changing a row.
- The webhook's retries, and whether a notification arrived.
- A row for the end of a command of `POST /`.

### Decided

| Question                              | Decision                                                                                                                                                              |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is recorded                      | Commands with their inputs, the notices of peers, every change of the state, every event of every participant, what the DT sends, and the initial values (2026-11-23) |
| How long rows are kept                | No limit now (2026-11-23)                                                                                                                                             |
| A revision in the state document (W1) | Not yet (2026-11-24)                                                                                                                                                  |
| A route of its own                    | `GET /timeline`                                                                                                                                                       |
| The row of a runner shutdown          | Kind `shutdown`; kind `stop` is a request to stop a script, which a replay needs (2026-11-24)                                                                         |
| A completion                          | No event row; the `entry` names the `exit` row as its `cause` (2026-11-24)                                                                                            |
| What is updated                       | A request row once with its `reply`, a command row once with its `run`; nothing else (2026-11-24)                                                                     |
| The id of a run                       | `run` in both `command` and `exit` rows (2026-11-24)                                                                                                                  |
| Exits                                 | One `exit` row per `entry`, also when it was superseded, stopped, or never started (2026-11-24)                                                                       |
| `sent` rows                           | Only when a transport is configured (2026-11-24)                                                                                                                      |
| Who sees the `input` of a command     | `client`, and all without access control; `operator` with issue 23 (2026-11-24)                                                                                       |

### Why a state notification is a row without its document

The `sent` row of a state notification says that one was sent, and the
`seq` of the row that caused it. Notifications of the other kinds are
recorded whole. The state document of the hospital is 466 bytes, 542
with its envelope, and every change sends one. Over a week:

| The hospital                     | Notifications | Recorded whole | Recorded as a row |
| :------------------------------- | ------------: | -------------: | ----------------: |
| Quiet: 200 commands a day        |         5,600 |           3 MB |            0.5 MB |
| Busy: a change every 10 seconds  |        60,480 |          33 MB |              5 MB |
| A feed that changes every second |       604,800 |         328 MB |             54 MB |

Nothing is lost by the row: the document of any moment follows from
the rows before it.

The `input` of a command may name a person, as the demo's `admit`
takes a patient. So with access control only a `client` reads it over
the API. The database holds every input, and a snapshot carries them
all.

## Plan

As built:

1. `src/queue.timeline.ts` (new): the table, the class `Timeline` that
   writes and reads it, and the cause of each entry. `Queue` owns it,
   so every writer that holds the queue reaches it.
2. `src/auth/caller-context.ts` (new): the caller of the request in
   progress, in an `AsyncLocalStorage`. The access guard and the MQTT
   handler set it; a subscription to a peer and a parameter that
   raises an event set the source.
3. The writers: `Requests` (transitions and events), `MachineStore`
   (entries), `scriptOutcome` (exits), `Queue` (parameters, properties
   and peers), `DescriptorService` (start, shutdown and notices),
   `AppController` and the MQTT handler (commands and stops), and
   `Notifier` (what is sent).
4. `ExecaManager`: `CommandOptions` gains `onRun`, called at once when
   a request is given a run, and `ended`, called as a run ends and
   before it is stored. Its command status moved to `commandStatus()`
   of `src/command-result.ts` to make room.
5. `src/timeline.controller.ts` (new), `src/dto/timeline.dto.ts`
   (new), and the MQTT route in `src/mqtt/mqtt.config.ts`,
   `src/mqtt/mqtt-request.handler.ts` and `src/auth/roles.ts`.
6. Documents: `README.md`, `STATE-MACHINE.md`, `SECURITY-MODEL.md`,
   `api/API.md`, `api/*.http`, `docs/state-machine-design.md` and
   `docs/save-reinstate-what-if.md`.

## Tasks

- [x] Each kind of row is written once, with its cause and caller, in
      the order things happened. Check:
      `test/unit/fsm.timeline.spec.ts`, `test/e2e/timeline.spec.ts`.
- [x] Every entry has one exit row, also when superseded, stopped or
      never started, and it comes before the state notification of
      that end. Check: `test/unit/fsm.timeline.spec.ts`,
      `test/unit/fsm.script-outcome.spec.ts`,
      `test/unit/notifier.timeline.spec.ts`,
      `test/integration/execa-manager.timeline.spec.ts`,
      `test/e2e/timeline.exit.spec.ts`.
- [x] The `start` row holds the whole state, and the state at any
      later `seq` follows from the rows. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [x] A command row holds its input and its run, or `null` when
      refused, a notice row the notice, and a `sent` row the
      notification, only with a transport. A property write that
      changes no value makes no row. Check:
      `test/unit/fsm.timeline.spec.ts`,
      `test/unit/notifier.timeline.spec.ts`,
      `test/unit/mqtt-request.timeline.spec.ts`.
- [x] The table opens in a database of 0.11.0, and the rows survive a
      restart, which adds a `start` row. Check:
      `test/integration/queue.timeline.spec.ts`,
      `test/e2e/restart.spec.ts`.
- [x] The queries filter and page as specified, over HTTP and MQTT,
      the input is shown to a client only, and `sensor` is refused.
      Check: `test/integration/queue.timeline.spec.ts`,
      `test/e2e/timeline.spec.ts`, `test/e2e/mqtt.timeline.spec.ts`,
      `test/unit/mqtt-request.timeline.spec.ts`,
      `test/unit/auth.roles.spec.ts`.
- [x] A write that fails is logged and stops nothing. Check:
      `test/unit/fsm.timeline.spec.ts`.
- [x] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [x] `yarn build` and `yarn test` pass (1453 tests, against 1354
      before), and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

- **A stored machine is not the end of a run.** The plan wrote the
  exit row where the machine is stored. A run that a stop transition
  ended, or that a later entry superseded, is never stored, so its
  entry had no exit. The row now comes from the end of the run itself,
  through `ended` of `CommandOptions`.
- **Order is part of the record.** The runner signalled a change
  before it stored it, so the state notification of a script's end
  named the entry, not the exit. The exit row is now written before
  the queue signals the end of the run.
- **The id of a run exists only after it is queued.** A command row
  is written first, so that it comes before what it causes, and
  `onRun` completes it in the same synchronous step. An SQL lookup of
  the run by request key was tried first and named a wrong run for a
  refused request.
- **`json_patch` drops a key whose value is `null`.** A row completed
  with `run: null` lost the key; `json_set` keeps it. The integration
  test found it.
- **The caller does not reach the writer through the arguments.** The
  access guard sets it with `AsyncLocalStorage.enterWith`, so that
  `Requests`, `Queue` and the others need no new parameter.
- **A `sent` row needs a transport.** Without MQTT or a webhook
  nothing is sent, and the first build still wrote rows for it.
- **A slow stop delays the exit row.** A stopped script whose child
  holds its output pipes, such as `sleep 30`, ends only when the child
  does, and the scripts that wait on it start, or are marked stopped,
  that much later.
- **Room was made by moving a whole function.** `ExecaManager` was at
  241 lines; its command status moved to `command-result.ts`.
- **A state script can join a run.** A client command of the state's
  name that runs while a stop transition waits makes the state script
  join that run, whose `ended` belongs to the client. `scriptOutcome`
  hears `onRun` too, and writes the exit row when the joined run
  settles, with its outcome and its `run`. Check:
  `test/integration/execa-manager.timeline.spec.ts`.
