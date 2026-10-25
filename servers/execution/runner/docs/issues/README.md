# Runner Issues

Specifications, plans and task lists for the work that turns the runner
into a stateful manager of one digital twin (DT) that an external
Manager can observe and steer. The features come from
[dtn-research-notes.md](../dtn-research-notes.md); each file here is
one feature, numbered by its item in the research notes so that the two
documents cross-reference by one number. Items 11 and 13 to 17 are
deferred (see below) and have no file.

## Status

| File                                                   | Feature                    | Size | Status    | PR  |
| :----------------------------------------------------- | :------------------------- | :--- | :-------- | :-- |
| [01-dt-identity.md](01-dt-identity.md)                 | DT identity and descriptor | S    | done      | #74 |
| [02-state-document.md](02-state-document.md)           | One state document         | M    | done      | #77 |
| [03-state-notifications.md](03-state-notifications.md) | State change notifications | M    | in review | #79 |
| [04-parameters.md](04-parameters.md)                   | Declared parameters        | M    | done      | #78 |
| [05-command-input.md](05-command-input.md)             | Command input and outcome  | M    | planned   |     |
| [06-escalation.md](06-escalation.md)                   | Escalation signal          | M    | planned   |     |
| [07-presence.md](07-presence.md)                       | Presence: join and leave   | S    | planned   |     |
| [08-script-context.md](08-script-context.md)           | Runner context for scripts | S    | planned   |     |
| [09-persistence.md](09-persistence.md)                 | Persist the machine        | M    | planned   |     |
| [10-stop.md](10-stop.md)                               | Stop a running script      | M    | done      | #76 |
| [12-health.md](12-health.md)                           | Health endpoint            | S    | done      | #75 |

Sizes: S is a day or less, M a few days with tests and documentation.

## Order

A feature starts when the features it depends on are merged.

```text
01 identity ─┬─> 02 state-document ─┬─> 03 notifications ─> 06 escalation
             ├─> 04 parameters ─────┼─> 05 command-input
             │                      └─> 08 script-context
             ├─> 07 presence
             └─> 10 stop ─> 09 persistence

12 health
```

02 comes before 04 because the state document is where parameter values
are first exposed; 10 before 09 because an `interrupted` script needs
the stop path to exist before recovery is designed around it. 07 needs
03's notifier for its webhook, so in practice it follows 03.

## Delivery

- One branch per file, named `runner/NN-slug`, pushed to the
  `prasad-public` remote with a pull request against its
  `feature/distributed-demo` branch.
- The file's `Status`, `PR` and ticked tasks change in the same pull
  request as the code. A task is ticked only after its check ran.
- Breaking changes to existing routes are allowed with a minor version
  bump of `package.json` and a line in the README; the runner is at
  `0.4.0` and nothing in this repository consumes its API.
- Each pull request sweeps `README.md`, `api/*.http`,
  `docs/state-machine-design.md` (amend the decision or assumption the
  feature changes) and `DEVELOPER.md`.
- No pull request changes files outside `servers/execution/runner`,
  other than by merging `feature/distributed-demo`. Documentation
  elsewhere that a feature makes stale, such as
  `docs/developer/codebase/runner.md` or the user documentation copy
  of the README, is listed in the pull request for a separate change.

## File Shape

Each file opens with a header list (`Status`, `Depends on`, `PR`,
`Research note`), then:

- **Spec**: the behaviour, configuration and API, with one example.
- **Plan**: ordered steps that name the files they touch.
- **Tasks**: a checkbox list; each task ends with its check, which is a
  named test file, a lint or build command, or a document section.

`Status` is `planned`, `in progress`, `in review` (a pull request is
open) or `done`.

## Decisions Shared by All Features

| #   | Decision                                                                                                                                                                                       |
| :-- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | The runner is a managed DT only. It never acts as the Manager of a network.                                                                                                                    |
| S2  | One runner serves one DT, as one process. A1 of the design document stands.                                                                                                                    |
| S3  | Outbound notifications go over MQTT, under `<base>/notify/<kind>`, and over an optional HTTP webhook. Polling always works.                                                                    |
| S4  | `runner.yaml` is the operator's file: identity, port, paths, broker, webhook. The state machine file is the DT author's: states, parameters, exposed commands, escalation, script environment. |
| S5  | `runner.yaml` names the state machine file by path; the fixed name in `location` goes (amends D1).                                                                                             |
| S6  | The runner never restarts a script on its own. A parameter change takes effect at the next script start, or through a declared event.                                                          |
| S7  | Notification payloads share one envelope: `{ kind, id, time, data }`.                                                                                                                          |

## Deferred

From the research notes, with the decision that blocks each:

- **11 Richer history and metrics**: format (Prometheus or JSON) and
  which counters a Manager needs.
- **13 Peer list and relationships**: a shared base topic convention
  for discovering peers, and what a relationship attribute is.
- **14 Machine-readable API description**: whether to generate OpenAPI
  from the controllers or write it by hand.
- **15 Access control by role**: whether the DTaaS gateway or the
  runner authenticates a Manager; the `manager.commands` list of 05 is
  declared but not enforced until then.
- **16 React to peer state**: a mechanism for peer-to-peer coordination
  that the papers do not give.
- **17 Resource and fidelity reporting**: child process metrics need a
  dependency or platform-specific reads.

## Non-Goals

Out of scope for every file here, with what could reopen each:

- More than one DT per runner (research notes, open question 12).
- The runner as Manager, or any runner-side policy evaluation such as
  P1's `γ_i` (open questions 5 and 6).
- Forecasts and exogenous triggers (open question 9).
- Server-sent events as a push transport (open question 2); the
  webhook of 03 covers HTTP.
- A stdout line protocol for scripts to raise events (open question
  13); scripts use the HTTP API.
- A script that mirrors physical-twin state into the state document
  (item 2 of the research notes).
- A declared `recover` state after a restart (open question 11).
- Per-command input schemas (open question 10).
- Enforcing `manager.commands` or any role (item 15).
- Showing DTN state in the DTaaS client or library (open question 14).
