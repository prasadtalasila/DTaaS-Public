# The State Machine Format: YAML Against XState

The runner reads a DT's state machine from a YAML file. These notes
compare that format with [XState](https://stately.ai/docs/xstate), a
statechart library for JavaScript and TypeScript. They also weigh a
proposal that DT authors could ship their DT as an XState module, which
the runner would import at runtime.

Runner citations give `file:line` under `servers/execution/runner/`.
Decision numbers (D1 to D36) are those of
[state-machine-design.md](state-machine-design.md), which has since
grown to D43. Statements marked
_inference_ are this document's reading.

## How DT Authors Use the Runner Today

The runner is published to npm as `@into-cps-association/runner`
(`package.json:2`). It is installed globally with
`npm install -g @into-cps-association/runner` (`README.md:52`) and
started as the `runner` binary (`package.json:29-31`). Each DT has
three parts, each owned by one person:

| File              | Owner     | Contents                                               |
| :---------------- | :-------- | :----------------------------------------------------- |
| `runner.yaml`     | operator  | id, port, commands, MQTT, auth, peers, script account  |
| state machine     | DT author | events, states, transitions, parameters, subscriptions |
| scripts directory | DT author | shell scripts on Linux, PowerShell scripts on Windows  |

A DT author writes no JavaScript and installs no npm package. The
security model counts "a hostile DT author who ships a hostile script"
as an adversary (`SECURITY-MODEL.md:54`). "The DT author controls only
the scripts directory and the state machine file" (`SECURITY-MODEL.md:73`).
With `scripts.user` set, scripts run as a second account. That account
cannot read `runner.yaml`, the signing key, the database or the runner's
environment (issue 18, D35).

## Disadvantages of YAML Against XState

1. **Expressiveness.** The runner's machine is flat and deterministic.
   It has no guards, actions, timers, hierarchy or parallel states
   (`state-machine-design.md:613-616`). XState implements statecharts,
   which have:
   - nested and parallel states;
   - guards;
   - entry, exit and transition actions;
   - delayed transitions (`after`);
   - extended state (`context`);
   - history states;
   - invoked child actors.

   Some things the runner's YAML cannot say:
   - "Retry twice, then escalate" needs a counter. XState keeps one in
     `context`; the runner's only extended state is its parameters and,
     since 0.11.0, its properties, which no transition reads.
   - "Re-check every 30 s" needs a timer. A hospital twin keeps a
     polling loop inside its script instead, with the interval in a
     declared `env` variable such as `POLL_MS`.
   - "Admit only if beds are free" needs a guard. In the runner, that
     decision lives inside a script.

2. **Home-grown semantics.** The runner had to design, document and
   test every rule of its own:
   - completion events (D5);
   - transitions accepted only while idle (D7);
   - `stop: true` (D20);
   - the refusal of cycles made only of `$success`/`$failure` (D11);
   - edge-triggered peer subscriptions (D34).

   XState follows statechart and SCXML semantics, which are specified
   and widely known. Each new key of the state machine file costs a
   schema, a check in `definition.ts`, a validation rule, a test per
   rule and a user guide entry (`docs/issues/README.md`, Non-Goals).

3. **Tooling.** XState has:
   - a visual editor and simulator (Stately Studio);
   - an inspector for running machines;
   - test paths generated from the machine's graph (`@xstate/graph`).

   The runner has none of these. Even its cycle check is its own code
   (`src/fsm/completion-cycle.ts`). An author finds mistakes when the
   runner starts, not while editing.

4. **Typing while writing.** YAML is untyped until zod checks it at load
   (`src/fsm/definition.ts:63-77`). Without a published JSON Schema, an
   editor gives no completion and no errors. XState v5's `setup()`
   types events, context, guards and actions in TypeScript.
5. **Behaviour outside the model.** A state is only the name of a
   script (D2), so the machine cannot be analysed together with what it
   does. In XState, guards and actions are named parts of the machine.
6. **YAML pitfalls.** The runner parses with js-yaml 4 or later
   (`package.json:86`), whose YAML 1.2 core schema keeps `no` and `on`
   as strings. Even so:
   - `true`, `null`, `~`, `1e3` and `0x10` still become typed values;
   - an indentation slip silently changes the structure.

   _Inference_: a state named `true` would fail validation with a
   confusing message.

   Tools that follow YAML 1.1 still read `on` as `true`. They include
   PyYAML and the repository's yamllint check, whose `truthy` rule
   checks keys (`.yamllint.yml`). Today's format has no `on` key, but
   XState's transitions live under one, so option B must quote it as
   `'on':`, as GitHub workflow files do.

7. **No ecosystem.** The format belongs to DTaaS alone: no importers,
   no exporters, and no conversion to SCXML.

### What YAML Buys

- **It is data, not code.** The file can only name scripts and events,
  so the hostile DT author of the threat model gains nothing from it.
- **It does not depend on a language.** Authors who write PowerShell or
  shell need nothing more.
- **Its limits are deliberate.** A flat, deterministic machine is easy
  to reason about, and it can be validated strictly at load.

## Three XState Alternatives

- **A. XState as the engine only.** The runner compiles today's YAML
  into an XState machine and runs it. Authors see no change; the
  maintainers gain statechart semantics, the inspector and generated
  test paths.
- **B. An XState configuration as data.** The author writes an
  XState-shaped configuration in JSON or YAML, made only of states,
  `on`, `after`, guard names and action names. The runner implements a
  fixed catalogue of those names, for example:
  - `run` (a script);
  - `paramEquals` and `peerState` (guards);
  - `escalate` (an action).

  The author can draw the machine in Stately Studio and export it.

- **C. An imported module.** The author ships a JavaScript or
  TypeScript module that exports an XState machine, with guards and
  actions of their own. The runner loads it with `import()` at runtime.

| Aspect                  | Today (YAML)                     | A. Engine only                                      | B. Configuration as data                               | C. Imported module                              |
| :---------------------- | :------------------------------- | :-------------------------------------------------- | :----------------------------------------------------- | :---------------------------------------------- |
| What the author writes  | YAML and scripts                 | Same                                                | JSON or YAML, possibly drawn in Stately Studio         | JavaScript or TypeScript, plus scripts          |
| Skills the author needs | Shell or PowerShell              | Same                                                | Same, plus statechart concepts                         | Node, npm, XState, ES modules                   |
| What it can express     | Flat states; no guards or timers | Same, unless the YAML grows                         | Hierarchy, parallel states, `after`, `context`, guards | Everything, including arbitrary code            |
| Where behaviour runs    | Scripts, as the script account   | Same                                                | Scripts, plus guards and actions the runner owns       | Author code inside the runner's process         |
| Security model holds    | Yes                              | Yes                                                 | Yes; the file is still data                            | No; see below                                   |
| Validation at load      | Strict zod and the cycle check   | Same                                                | zod on the configuration and a check of the names      | Only "is it a machine"; code cannot be checked  |
| Design tooling          | None                             | Inspector for maintainers                           | Studio, simulator, generated test paths                | All of XState's tooling                         |
| Persistence             | The `machine` row                | A persisted XState snapshot                         | A persisted snapshot, `context` included               | A snapshot that may not fit a changed module    |
| Version coupling        | None                             | The runner's own dependency                         | The configuration format's version                     | Author and runner must share one XState major   |
| Windows authors         | Fully supported                  | Same                                                | Same                                                   | Must install Node packages in the DT folder     |
| Cost to the runner      | None                             | Large: D7, D10, D20 and completion events re-mapped | Large: A, plus the catalogue, docs and checks          | Medium to build, but it weakens every guarantee |

## Configuration Examples

All three examples describe the same DT, a hospital twin named
hospital-1. Two samples sit beside `runner.yaml.sample`:

| File                                      | Format                    | Read by the runner |
| :---------------------------------------- | :------------------------ | :----------------- |
| `config/state-machine.yaml.sample`        | today's format; also A's  | yes                |
| `config/state-machine.xstate.yaml.sample` | option B, a proposal only | no                 |

### Today

A state is the name of a script (D2). A transition is either
`event: state` or `event: {state, stop: true}`. The `open` state of the
sample:

```yaml
states:
  open:
    env:
      POLL_MS: 500
    transitions:
      full: full
      scope-changed:
        state: open
        stop: true
      close:
        state: closed
        stop: true
      $stopped: closed
```

Parameters, `env`, `escalation`, `manager` and `subscriptions` sit
beside `states` at the top of the file.

### A. Engine Only

**The DT author's file does not change.** `config/state-machine.yaml.sample`
works as it is. The operator's `runner.yaml` does not change either.
During the migration it could carry a temporary switch such as
`engine: xstate`, with today's code as the default.

At load, the runner compiles the file into an XState machine. This is
the `open` state as the compiler produces it, shown in YAML:

```yaml
open:
  entry:
    type: run # starts the script of the state
    params:
      script: open
      env:
        POLL_MS: 500
  'on':
    full:
      target: full
      guard: # D8: refused while the script of full is running
        type: canEnter
        params:
          state: full
    scope-changed: # stop: true
      target: open
      reenter: true
      actions: stop
    close:
      target: closed
      reenter: true
      actions: stop
    $stopped:
      target: closed
      guard:
        type: canEnter
        params:
          state: closed
```

How each part of today's format maps onto XState:

| Today                                                         | Compiled into                                                                |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------- |
| A state runs the script of its name (D2)                      | `entry: {type: run, params: {script, env}}`                                  |
| `event: state`                                                | `{target, guard: canEnter}` (D8)                                             |
| `event: {state, stop: true}`                                  | `{target, reenter: true, actions: stop}` (D20)                               |
| No initial state (D6)                                         | `initial: unstarted`, an empty state                                         |
| `POST /fsm/transition` (D7)                                   | One internal root event `$transition.<state>` per state, sent only when idle |
| Completion events (D5)                                        | The runner sends `$success`, `$failure` or `$stopped` when a script exits    |
| `onNoTransition` escalation (D25)                             | `actor.getSnapshot().can(event)` is false                                    |
| `parameters`, `env`, `escalation`, `manager`, `subscriptions` | Stay in the runner, outside the machine                                      |

`run` is an entry action, not an invoked actor. XState stops an invoked
actor when its state is left, which would break D10: a plain transition
leaves the old script running.

`can()` cannot tell a false guard from a missing transition. The runner
must still check `canEnter` itself, to answer `script running` (409)
rather than `no transition`.

### B. Configuration as Data

The DT author writes an XState machine under a `machine` key. The other
keys stay as they are today. The `open` state, from
`config/state-machine.xstate.yaml.sample`:

```yaml
open:
  entry:
    type: run
    params:
      script: open
      env:
        POLL_MS: 500
  'on':
    full: full
    scope-changed:
      target: open
      reenter: true
      actions: stop
    neighbour-full: # a guard on a parameter
      guard:
        type: paramEquals
        params:
          name: scope
          value: multi
      target: open
      reenter: true
      actions: stop
    $failure: # a counter in context: retry twice, then escalate
      - guard:
          type: below
          params:
            name: failures
            max: 2
        target: open
        reenter: true
        actions:
          type: increment
          params:
            name: failures
      - target: closed
        actions:
          type: escalate
          params:
            reason: open failed three times
```

The sample's `full` state also shows a timer:

```yaml
full:
  entry:
    type: run
    params:
      script: full
  after:
    300000: open # re-open after five minutes without beds-free
  'on':
    beds-free: open
```

The same concerns written in today's format and in B:

| Concern                                 | Today                              | B                                                            |
| :-------------------------------------- | :--------------------------------- | :----------------------------------------------------------- |
| Script of a state                       | Implied by its name (D2)           | `entry: {type: run, params: {script}}`; any script, or none  |
| Event list                              | `events:`                          | Taken from the `on` keys                                     |
| Plain transition                        | `full: full`                       | `full: full`                                                 |
| Stopping transition                     | `{state: open, stop: true}`        | `{target: open, reenter: true, actions: stop}`               |
| Initial state                           | None (D6)                          | `initial: unstarted`                                         |
| Environment of one state                | `env:` under the state             | `params.env` of `run`                                        |
| Escalation on `$failure`                | The flag `escalation.onFailure`    | The flag, or an `escalate` action where the author wants one |
| Guard                                   | None; a script decides             | `guard: {type, params}` from the runner's catalogue          |
| Counter                                 | None                               | `context` with the `increment` and `reset` actions           |
| Timer                                   | None; the script polls (`POLL_MS`) | `after: {<ms>: <state>}`                                     |
| Parameters, env, Manager, subscriptions | Top-level keys                     | The same top-level keys                                      |
| Lines for the machine                   | 28 (`states`)                      | 77 (`machine`), with the guard, counter and timer added      |

B is more verbose. A stopping transition takes three keys instead of
two, and every state names its script. A runner-side shorthand could
expand `stop: true` and an implied `run`. The file would then no longer
be plain XState, and the Stately tools would not read it.

B also has to quote XState's `'on'` key. Unquoted, it passes the runner
and XState, because js-yaml reads YAML 1.2. yamllint, and any YAML 1.1
parser, read it as the boolean `true`.

### How the Examples Were Checked

- **Today's format.** `config/state-machine.yaml.sample` was loaded
  with the runner's own `loadDefinition` (`src/fsm/definition.ts:224`).
  It passed, with the commands `open`, `full`, `closed`, `admit` and
  `discharge` and the peer `hospital-2`.
- **Both options on XState.** XState 5.33.4 ran both machines with a
  stub catalogue of the actions and guards named above. B was the
  sample file as it stands. A was compiled from today's sample by a
  60-line prototype of the mapping table, which is not committed.

The trace of B:

| Event                     | State after | Actions                          |
| :------------------------ | :---------- | :------------------------------- |
| `$transition.open`        | `open`      | run open                         |
| `scope-changed`           | `open`      | stop; run open                   |
| `neighbour-full` (single) | `open`      | none; guard false                |
| `neighbour-full` (multi)  | `open`      | stop; run open                   |
| `$failure` (1st, 2nd)     | `open`      | run open; failures 1, then 2     |
| `$failure` (3rd)          | `closed`    | escalate; run closed; failures 0 |
| `reopen`, then `full`     | `full`      | run open; run full               |
| 300000 ms later           | `open`      | run open                         |

In A, the compiled machine followed today's semantics:

- `beds-free` was refused while the `open` script was still running
  (D8);
- an undeclared event had no transition (`can()` false), which is the
  `onNoTransition` path.

## Importing a DT as an XState Module

The mechanics would be small. `runner.yaml` would name the module, for
example `machine: ./dt/machine.mjs`. The runner would load it with
`await import(pathToFileURL(path))` and start it with
`createActor(module.machine)`. The problems lie elsewhere.

1. **It reverses the security model.** An imported module runs inside
   the runner's process, as the runner's account. It can then:
   - read the MQTT credentials and `runner.yaml`;
   - read the signing key, and sign notifications as the DT;
   - read the database;
   - read the environment through `/proc/self/environ`.

   That undoes issue 18 (D35) for exactly the adversary the threat
   model names. Node offers no way to contain it:
   - its documentation says the `node:vm` module "is not a security
     mechanism";
   - the `--permission` flags apply to the whole process, so they would
     restrict the runner as well;
   - Node has no ShadowRealm.

2. **It bypasses the runner's controls.** An XState action can call
   `fetch`, spawn a process or write files. None of that passes through:
   - the command allow-list;
   - the history and its `by` column;
   - resource measurement (17a, 17b);
   - roles (15a);
   - signed output (15b).
3. **XState versions must match.** A machine built by one copy of
   XState and run by `createActor` from another copy may fail or
   misbehave. A v4 machine does not run on v5. The module would declare
   `xstate` as a peer dependency at a major version the runner supports.
   Resolving it is awkward because the runner is installed globally: the
   module's `import 'xstate'` looks in the DT folder's `node_modules`,
   not in the runner's.
4. **The runner's invariants become guesswork.** With arbitrary
   actions, the runner can no longer guarantee its own rules:
   - completion events come only from scripts (D5);
   - external transitions happen only while idle (D7);
   - the stop chain (D20);
   - `onNoTransition` escalation (D25);
   - edge-triggered peer events (D34).
5. **Restoring after an upgrade is fragile.** A snapshot persisted under
   version 1 of a module may not fit version 2 of the same module
   (D12, D28).
6. **Authors need a new skill set.** "DT authors just use it with
   scripts" stops holding. Authors on Windows who write PowerShell would
   need Node and npm in every DT folder.

## Recommendation

1. **Do not import authors' modules into the runner's process.** If an
   operator needs it anyway, make it an explicit opt-in such as
   `machine: {module: ./dt/machine.mjs, trusted: true}`. Refuse the
   option when `scripts.user` is set, because that setting exists to
   separate the author from the runner. Document the option as
   "the DT author is trusted". This is a new threat model and needs the
   owner's decision.
2. **Authors who want XState can use it today without any change.** A
   long-running Node script can run its own XState actor and drive the
   runner through `RUNNER_URL` and `RUNNER_TOKEN`
   (`src/fsm/script-context.ts:47-52`):
   - raise events with `POST /fsm/event`;
   - read `GET /state` and `GET /peers`;
   - escalate with `POST /escalate`.

   The author's code then runs as the script account, and the runner
   keeps every guarantee. Suggestion W10 of
   [wldt-research-notes.md](wldt-research-notes.md) (a long poll on a
   state revision) would make this pattern cheaper.

3. **For statechart semantics inside the runner, take B, built on A.**
   - First adopt XState as the engine behind today's YAML (A), and keep
     the format and replies unchanged.
   - Then accept an XState-shaped configuration as data (B), with a
     small catalogue of guards and actions that the runner owns. Its
     `after` timers and `context` counters cover the most common gaps:
     the "retry twice, then escalate" counter and the polling of the
     hospital's script.
   - Publish a JSON Schema of the format, so that editors can check the
     file while it is written.

   This reopens "guards, actions, timers, hierarchical or parallel
   states" from the out-of-scope list of the design document
   (`state-machine-design.md:613-616`), so it needs the owner's decision
   first.

## Open Questions

1. **How to map the runner's rules onto XState.**
   - Idle-only external transitions (D7): as a guard on every external
     event, or as a queue in front of the actor?
   - Completion events (D5): as events sent from the script runner to
     the actor?
   - Leaving the old script running on a plain transition (D10): as an
     invoked actor that is not stopped on exit?
2. **Persistence.** Should the `machine` row store an XState snapshot,
   or should the runner keep its own row and rebuild the actor from it?
3. **Catalogue size (B).** Which guards and actions are enough? For
   example: parameter comparisons, peer state, entry counters, `after`,
   `run` and `escalate`.
4. **Migration.** Should today's YAML stay a supported input
   indefinitely, or be converted once to the XState-shaped format?

## Sources

- Samples: `config/state-machine.yaml.sample` and
  `config/state-machine.xstate.yaml.sample`.
- Runner at `584d39f0`:
  - `package.json`, `README.md`, `SECURITY-MODEL.md`;
  - `docs/state-machine-design.md`, `docs/issues/README.md`;
  - `src/fsm/definition.ts`, `src/fsm/completion-cycle.ts`,
    `src/fsm/script-context.ts`.
- XState v5 documentation: <https://stately.ai/docs/xstate>.
- Node.js `node:vm` documentation, which carries the warning that the
  module "is not a security mechanism":
  <https://nodejs.org/api/vm.html>.
