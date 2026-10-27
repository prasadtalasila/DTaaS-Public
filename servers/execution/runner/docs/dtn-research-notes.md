# Research Notes: The Runner in Digital Twin Networks

Two draft papers by the DTaaS authors describe how digital twins (DTs)
should adapt themselves and coordinate inside a digital twin network
(DTN). These notes read them against the runner as it stands on branch
`feature/runner-fsm` (commit `af4d0f44`) and derive feature suggestions
for turning the runner into a stateful DT manager that can take part in
a DTN.

The papers live in the gitignored, untracked `.research-papers/`
directory at the repository root. The notes refer to them as:

| Name | Directory                                           | Title                                                                                       |
| :--- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| P1   | `Generalization_of_Self_Adaptation_in_DT_Networks/` | Self-Adaptation in Digital Twin Networks: A Hospital Bed Management Coordination Case Study |
| P2   | `SiSSy_2026__Self_organising_Vision/`               | A Vision of System-level Adaptation in Digital Twin Networks                                |

P1 builds on P2 and cites it as `talasila26sissy`. Paper citations name
the `.tex` file under each directory and the section heading; runner
citations give `file:line` under `servers/execution/runner/`. Statements
marked _inference_ are this document's reading, not something a source
says.

## Suggestions at a Glance

The order is a priority. P1 defines a concrete interface between a DT
and a network Manager (requirements R1 to R4) and has evaluated it, so
the items that give the runner that interface come first. The
decentralised items come from the vision paper (P2) alone, which leaves
their mechanisms open, so they come later.

| #   | Suggestion                               | Group                      | Size | Rationale                                                                    | Status                           |
| :-- | :--------------------------------------- | :------------------------- | :--- | :--------------------------------------------------------------------------- | :------------------------------- |
| 1   | DT identity and descriptor               | DT-level state & lifecycle | S    | A Manager and peers must name and locate each DT (P1 case study, P2 model).  | done (#74)                       |
| 2   | One state document (R1)                  | DTN: centralised           | M    | P1 R1 asks each DT to expose its state, policy and shared parameters.        | done (#77)                       |
| 3   | State change notifications               | Observability              | M    | The Manager's Monitor collects DT states; today it can only poll.            | done (#79)                       |
| 4   | Declared parameters, controllable subset | DTN: centralised           | M    | P1 R2: a DT declares which shared-policy parameters may be changed.          | done (#78)                       |
| 5   | Command input, outcome and exposure (R2) | DTN: centralised           | M    | P1's Manager submits `admit(p)` and needs to know whether it succeeded.      | done (#84)                       |
| 6   | Escalation signal (R3, endogenous)       | DTN: centralised           | M    | P1 leaves endogenous signalling to future work; the runner can carry it.     | done (#83)                       |
| 7   | Presence: join and leave                 | DTN: decentralised         | S    | P2 assumes DTs join and leave the network at runtime.                        | done (#82)                       |
| 8   | Runner context and events for scripts    | Self-adaptation loop       | S    | Lets a script act as the DT's own MAPE-K loop and raise events.              | done (#81)                       |
| 9   | Persist the machine across restarts      | DT-level state & lifecycle | M    | Observability (R1) needs a DT that remembers its policy after a restart.     | done (#86)                       |
| 10  | Stop a running script                    | DT-level state & lifecycle | M    | Parameter updates and DT removal need a way to end the current script.       | done (#76)                       |
| 11  | Richer history and metrics               | Observability              | S/M  | P1 evaluates outcomes over time; the runner records names only.              | done (#91)                       |
| 12  | Health endpoint                          | Observability              | S    | Liveness for the Manager and the platform; P2 names robustness a challenge.  | done (#75)                       |
| 13  | Peer list and relationships (R)          | DTN: decentralised         | M    | Both papers model relationships between DTs; the runner knows none.          | done (#92)                       |
| 14  | Machine-readable API description         | API/protocol               | M    | P2's "common communication interface"; `api/` has request files only.        | deferred                         |
| 15  | Access control by role                   | API/protocol               | M    | P2 names malevolent DTs; R2 distinguishes Manager-submitted commands.        | 15a, 15b done (#90, #93)         |
| 16  | React to peer state                      | DTN: decentralised         | L    | Peer-to-peer coordination of P2, as events raised by peer notifications.     | in review (#95)                  |
| 17  | Resource and fidelity reporting          | Platform/orchestrator      | L    | P2's orchestrator trades fidelity for shared compute; needs process metrics. | 17a done (#94), 17b, 17c planned |

Sizes: S is a day or less, M a few days with tests and documentation, L
a week or more or a design of its own. Status is that of the
[issue files](issues/README.md#status), with the pull request of each.

## Detailed Suggestions

### 1. DT Identity and Descriptor

**Add.** An `id` in `runner.yaml`, matching the name pattern of states,
and an optional `attributes` map of opaque values (for example the
coordinates of a hospital). Validate the whole configuration with a
zod schema, as the `mqtt` section is validated today, and answer
`GET /dt` (HTTP) and `<topic>/dt` (MQTT) with the descriptor: `id`,
`attributes`, runner version, permitted commands, and whether a state
machine is loaded.

**Touches.** `src/config/config.interface.ts`,
`src/config/configuration.service.ts`, `src/app.controller.ts`,
`src/mqtt/mqtt.config.ts`, `src/mqtt/mqtt-request.handler.ts`.

**Why.** P1 `sections/case-study.tex`, "Instantiating the DTN": the
Manager keeps "a database for storing the address for the DTs
instances, alongside their location and identifiers". P1
`sections/contribution.tex`, "Requirements for Shared Policy
Adaptation", R1: the Manager "also knows the relationships among DTs",
which presupposes identities. P2 `sections/problem-statement.tex`:
"all DTs expose a common communication interface, allowing DTs to
dynamically join and leave the network". The runner's `ConfigValues`
has `port`, `location`, `commands`, `database` and `mqtt` only
(`src/config/config.interface.ts:9-21`), and only `mqtt` is validated
(`src/config/configuration.service.ts:27-40`). `README.md:9` says
"Multiple runner instances can be active simultaneously on one
machine", yet nothing but the port or the MQTT topic tells them apart.

**Size.** S. The schema validation is a prerequisite for items 4, 13
and 15, which add sections to the configuration.

### 2. One State Document (R1)

**Add.** `GET /state` and `<topic>/state` returning one document for
the whole DT: `id`, the machine's `state`, `status` and `entry`, the
declared parameters (item 4), the last command and its result, and a
timestamp. Let a DT declare an optional `state` script in
`state-machine.yaml` whose JSON on stdout is merged into the document
as the state mirrored from the physical twin (_inference_: the runner
does not know the physical twin, only the scripts do).

**Touches.** `src/fsm/fsm.service.ts` (`check`, lines 49-58),
`src/dto/fsm.dto.ts`, `src/fsm/fsm.controller.ts`,
`src/mqtt/mqtt.config.ts`, `src/mqtt/mqtt-request.handler.ts`.

**Why.** P1 `sections/contribution.tex`, R1: "Each DT makes its state,
including its current local policy and the parameters of the shared
policy it applies, observable to the Manager". Definition 1 there
writes the state as `s_i = (x_i, λ_i, θ_i)`: the mirrored state, the
active local policy and the shared-policy parameters. The
"Architecture" subsection gives each DT "a policy interface that
exposes its state `s_i` (R1)". P1 `sections/case-study.tex`, "The
BedreFlyt Digital Twin": "we expose only the knowledge graph as the
state of each DT, since forecasts are not necessarily available", so a
partial state document is acceptable. Today `GET /fsm` returns the
state, script status and events (`src/fsm/fsm.service.ts:49-58`,
`src/dto/fsm.dto.ts:41-45`) and `GET /` the last command
(`src/execa-manager.service.ts:132-142`): the runner knows something
like `λ_i`, but has no `θ_i` and no `x_i`.

**Size.** M.

### 3. State Change Notifications

**Add.** Publish the document of item 2 whenever the machine enters a
state or a script completes, on a notification topic apart from the
request topics, for example `<topic>/notify/state`, retained, so that
a Manager that connects later sees the current state. For HTTP-only
deployments, offer an optional `notify.url` webhook or a server-sent
events stream (decision below).

**Touches.** `src/fsm/fsm.service.ts` (`enter` at lines 119-127,
`run` at 129-140), `src/mqtt/mqtt.service.ts` (a publish method next
to `respond`, lines 106-136), `src/mqtt/mqtt.config.ts`.

**Why.** P1 `sections/contribution.tex`, "Architecture": the Manager's
"Monitor collects the states `s_i` and the escalation signals". P1
`sections/case-study.tex`: the prototype Manager "reacts to new
requests appearing in the state of a DT", so it watches DT state. P1
`figures/centralised-dtn.tex` draws arrows from each DT's Executor to
the DT Manager and from the Manager to each DT's Monitor. P2
`sections/roadmap.tex`, "Robustness and Synchronisation in the DTN":
"Changes introduced into DTs by linked PTs must be propagated to the
DTN". The runner's MQTT service is request-reply only: it subscribes to
its request topics (`src/mqtt/mqtt.service.ts:52-66`) and publishes
only replies (`src/mqtt/mqtt.service.ts:128-132`). It ignores retained
_requests_ (`src/mqtt/mqtt.service.ts:118-121`), which does not affect
a retained notification on another topic.

**Size.** M.

### 4. Declared Parameters With a Controllable Subset (R2)

**Add.** A `parameters` section in `state-machine.yaml` (or a new DT
file, see the open questions): each parameter has a type or an
enumeration, a default and `controllable: true` or `false`. Answer
`GET /parameters`; accept `PUT /parameters` for controllable ones only,
validated against the declaration; record each change in the database;
hand the current values to every script as environment variables
(item 8). Optionally let a parameter declare an event to raise when it
changes, so the machine can react.

**Touches.** `src/fsm/definition.ts` (schema, lines 38-47),
`src/fsm/fsm.service.ts`, a new `src/fsm/parameters.ts`,
`src/execa-manager.service.ts` (`execute`, lines 98-106),
`src/execa-runner.ts`, controllers and MQTT routes.

**Why.** P1 `sections/contribution.tex`, R2: "Each DT declares which of
its shared-policy parameters may be changed and which of its commands
may be submitted from the Manager". Definition 3: "Each `d_i` exposes a
set `Θ_i^c ⊆ Θ_i` of shared-policy parameters that the Manager may
assign". R4: the Manager "never replaces local policies", so a
parameter update must not rewrite `state-machine.yaml`. P1
`sections/case-study.tex`: the shared parameter is the allocation
scope, `θ_i ∈ {single, multi}`. P2 `sections/solution.tex`, "Adaptation
for the Digital Twin Network": the process "can be guided by a shared
policy or database". The runner runs each script with no environment
and no input (`src/execa-runner.ts:23`), so a script can be configured
only by editing it.

**Size.** M.

### 5. Command Input, Outcome and Exposure (R2)

**Add.** Let `POST /` carry an optional `input` object, validated
against a per-command schema declared in the configuration (or capped
free-form JSON), delivered to the script on stdin rather than as
arguments, and recorded in the history. Return the script's result in
the reply, for example `stdout` or a `result` field, since the caller
of a command needs to know its outcome and not only that it ran. Mark
each command with who may submit it: a `manager` list in the
descriptor names the commands `K_i^c` (enforcement needs item 15).

**Touches.** `src/dto/command.dto.ts` (`executeCommandSchema`, lines
3-7, `executeResponse`, lines 21-23), `src/execa-manager.service.ts`,
`src/execa-runner.ts`, `src/runner-factory.service.ts:8-22`,
`src/queue.service.ts` (schema, lines 11-26), `src/app.controller.ts`.

**Why.** P1 `sections/contribution.tex`, Definition 3: "a set
`K_i^c ⊆ K_i` of commands that the Manager may submit", applied so that
`d_j` issues `k_j` "through its active local policy `λ_j`, which fixes
any detail that `k_j` leaves open". P1 `sections/case-study.tex`:
`K_i^c = {admit(p)}`, "which asks `d_i` to allocate patient `p` with
its own local policy", and "a target DT may fail to allocate `p`, in
which case the next one is tried", so the Manager depends on the
outcome of each command. The runner accepts a command `name` only
(`src/dto/command.dto.ts:3-7`), passes no arguments
(`src/runner-factory.service.ts:8-22`, `src/execa-runner.ts:23`), and
replies with `success` or `invalid command`
(`src/dto/command.dto.ts:17-23`); the logs are available only through
a later `GET /` (`src/execa-manager.service.ts:132-142`).

**Size.** M. Stdin avoids argument injection, which matters because the
runner is a remote execution service (`src/config/commander.ts:19`).

### 6. Escalation Signal (R3, Endogenous)

**Add.** An outbound escalation, published on `<topic>/notify/escalation`
(QoS 1, not retained) and, for HTTP-only deployments, posted to the
webhook of item 3. Triggers, declared per DT rather than hard coded:
the `$failure` of a state's script; an event for which the current
state has `no transition`, which is the runner's observable form of an
exhausted local adaptation space (_inference_); and an explicit request
from a script (item 8) that may carry a proposal, such as a wanted
parameter value. The payload names the DT, state, event, reason,
proposal and time.

**Touches.** `src/fsm/fsm.service.ts` (`event`, lines 73-84,
`complete`, lines 154-165), `src/fsm/definition.ts`,
`src/mqtt/mqtt.service.ts`.

**Why.** P1 `sections/contribution.tex`, R3: an escalation "can be
evaluated by the DT, which signals the Manager (endogenous trigger),
e.g., when it requires changing shared-policy parameters or its local
adaptation space is exhausted". Definition 4: `e_i` holds "iff `d_i` is
exhausted or its proposal `(λ', θ')` has `θ' ≠ θ_i`". The "Escalation"
subsection: "our prototype exercises escalation by exhaustion, which the
Manager detects from the observed states", and
`sections/conclusion.tex`: "Future work will extend the prototype with
endogenous signalling and the exogenous trigger". P2
`sections/solution.tex`: triggers can be "endogenous, originating from
within the DT itself". In the runner, `no transition` is a 409 to the
caller and nothing else (`src/fsm/fsm.service.ts:78-81`,
`src/dto/fsm.dto.ts:20`), and a `$failure` without a transition leaves
the machine idle in silence (`src/fsm/fsm.service.ts:155-158`).

**Size.** M.

### 7. Presence: Join and Leave

**Add.** On connecting to the broker, publish a retained
`<topic>/notify/presence` message with `id`, `online`, the descriptor
and the runner version; register an MQTT Last Will that publishes
`offline` on the same topic; publish `offline` in
`beforeApplicationShutdown` before the client ends.

**Touches.** `src/mqtt/mqtt.service.ts` (`clientOptions`, lines
96-104, `beforeApplicationShutdown`, lines 90-94, `listen`, lines
69-86).

**Why.** P2 `sections/problem-statement.tex`: DTs "dynamically join and
leave the network while remaining interoperable". P2
`sections/solution.tex`: "an open system where different DTs can join
and leave the network, and the adaptation process can be designed to
handle these changes"; the DT Orchestrator adds and removes "the
corresponding DTs from the DTN". P1 `sections/case-study.tex`: the
Manager's database of DT addresses, which presence messages would
populate. The runner's client options have no will
(`src/mqtt/mqtt.service.ts:96-104`), and nothing is published without a
request.

**Size.** S.

### 8. Runner Context and Events for Scripts

**Add.** Pass environment variables to every script: `RUNNER_URL`
(the local HTTP address), `DT_ID`, `DT_STATE`, `DT_ENTRY` and the
parameters of item 4 as `DT_PARAM_<NAME>`. Document that a script may
call `POST /fsm/event` on `RUNNER_URL` to raise a declared event, and
`POST /escalate` (item 6) to escalate. Optionally recognise a line
protocol on stdout, such as `@event stop`, for scripts that cannot make
HTTP calls. A long-running state, say `monitor`, then becomes the
Monitor and Analyse steps of the DT's own loop, and its events the Plan.

**Touches.** `src/execa-runner.ts:15-32`,
`src/runner-factory.service.ts`, `src/execa-manager.service.ts:98-106`,
`README.md`.

**Why.** P2 `sections/solution.tex`, "Adaptation for Single Digital
Twin": the DT's MAPE-K loop, whose Monitor step collects "data from its
linked PT and other DTs", and whose Execute step "is not the control of
the PT but a dedicated control step for the adaptation of the DT"; "The
MAPE-K loop can also be used as an adaptation policy". P1
`sections/background.tex`: adaptation "is commonly structured as a
MAPE-K loop". The design document's assumption A4 reads "Events come
from clients over HTTP or MQTT. Script exit is the only event the
runner raises by itself" (`docs/state-machine-design.md:196-197`), and
scripts receive no environment (`src/execa-runner.ts:23`). A script can
already call the HTTP API if it knows the port; this item makes the
contract explicit and testable.

**Size.** S; the stdout protocol would make it M.

### 9. Persist the Machine Across Restarts

**Add.** Store the current state, entry number, script status and
parameter values in the SQLite database on each entry and completion,
and load them at startup. Decide the recovery policy: report the state
with status `interrupted` and wait for a transition, or re-enter a
declared `recover` state (open question). Record transitions in the
history as well.

**Touches.** `src/queue.service.ts` (schema, lines 11-26),
`src/fsm/state-machine.ts:7-9`, `src/fsm/fsm.service.ts:35-41`,
`src/main.ts:22-31` (the machine loads before the database opens, at
lines 26-27, which would have to swap).

**Why.** P1 R1 makes the DT's policy observable; a DT that forgets `λ_i`
on restart reports a wrong state. P2 `sections/roadmap.tex`,
"Robustness and Synchronisation": DTs "are connected over a potentially
volatile network, which introduces the problems related to
intermittency". P2 `sections/solution.tex`, "DT Orchestrator": the
orchestrator deploys DTs at runtime across the "DT continuum", which
means runners are restarted and moved. The design document's D12 keeps
"The machine lives in memory" because "Nothing asks for recovery after
a restart" (`docs/state-machine-design.md:184`); the papers now do.
`README.md:198-199` documents the loss.

**Size.** M.

### 10. Stop a Running Script

**Add.** Keep the execa subprocess of each run in `ExecaManager` and
add a way to end it: `POST /stop` for the current command, and a
`stop: true` option on a transition that first stops the script of the
current state. Decide whether a stopped script raises `$failure` or a
new completion event such as `$stopped` (open question).

**Touches.** `src/execa-runner.ts:20-32`, `src/execa-manager.service.ts`
(`running`, line 30, `start`, lines 84-96), `src/fsm/fsm.service.ts`,
`src/interfaces/runner.interface.ts`.

**Why.** P1 `sections/contribution.tex`, Definition 3: applying an
update "sets `θ_j := θ_j'` and makes `d_j` issue `k_j` through its
active local policy", which may require the policy's script to restart
with the new value. P2 `sections/solution.tex`: the orchestrator
removes DTs and adjusts "the fidelity of DTs based on current needs",
and multi-fidelity DTs "switch between different fidelities of the same
model", each of which ends a running computation. The design document's
D10 says "The runner can not cancel a script"
(`docs/state-machine-design.md:182`), `ExecaRunner.run` awaits execa
and keeps no handle (`src/execa-runner.ts:20-32`), and `README.md:187-196`
asks each DT to give long states an event out, with a restart as the
only other way.

**Size.** M.

### 11. Richer History and Metrics

**Add.** Return the status, the received and finished times, the
duration and (item 5) the input of each command from `GET /history`,
with `since` and `limit` query parameters. Add `GET /metrics` with
counts of commands by status, transitions, completion events and
escalations, and the time spent in each state, in Prometheus text
format or JSON (open question).

**Touches.** `src/queue.service.ts` (`checkHistory`, lines 111-116),
`src/dto/command.dto.ts`, `src/app.controller.ts:26-29`,
`src/fsm/fsm.service.ts`.

**Why.** P1 `sections/evaluation.tex`, "Metrics": "Fallback
Occurrences", "Patient Distribution", "Travel Distance" and "Score",
with results such as a success rate failing "28.6% with single-ward
allocation" and a mean placement score rising "from 0.57 to 0.83". Such
measures come from the outcomes of DT commands over time, which a
Manager can only compute if each DT keeps them with timestamps. P2
`sections/related-work.tex` lists "anomaly monitoring, system state
estimation" among DTN functions. The runner's table already stores
`received_at` and `finished_at` (`src/queue.service.ts:18-19`), but the
history returns names only (`src/queue.service.ts:111-116`,
`README.md:314-331`).

**Size.** S for the history, M for metrics.

### 12. Health Endpoint

**Add.** `GET /health` with the runner status, uptime, whether the MQTT
client is connected, whether a state machine is loaded and whether the
database is open; `<topic>/health` over MQTT.

**Touches.** `src/app.controller.ts`, `src/mqtt/mqtt.service.ts`
(expose the connection state), `src/mqtt/mqtt.config.ts`.

**Why.** P1's Manager Monitor must distinguish a silent DT from a dead
one; P2 `sections/roadmap.tex` names robustness and a "single point of
failure" among the challenges. The DTaaS platform and the orchestrator
of P2 (`sections/solution.tex`, "DT Orchestrator"), which "is
responsible for the deployment of DTs at runtime", need a liveness
check for the same reason. The runner has none.

**Size.** S.

### 13. Peer List and Relationships (R)

**Add.** A `peers` section in the configuration: each peer has an `id`,
an HTTP `url` or an MQTT `topic`, and an `attributes` map (for example
`distance`). Answer `GET /peers`, and give the list to scripts as a
JSON file named in `DT_PEERS`. Later, discover peers from their
presence messages (item 7), which needs a shared base topic convention.

**Touches.** `src/config/config.interface.ts`,
`src/config/configuration.service.ts`, `src/app.controller.ts`,
`src/execa-manager.service.ts`.

**Why.** P1 `sections/contribution.tex`, Definition 2: the network
state is `O = (s_1, …, s_n, R)`, and R1 says the Manager "knows the
relationships among DTs"; `sections/case-study.tex`: "The relationships
`R` are the distances between hospitals", which drive the order in
which the Manager tries hospitals. P2 `sections/problem-statement.tex`:
`R ⊆ D × D` are relationships that "capture dependencies and
interactions among DTs that mirror those occurring in the physical
world". P2 `sections/solution.tex`: in the decentralised approach "the
DTs communicate with each other through communication infrastructure
to share data and coordinate their adaptation". The runner has no
notion of another runner; assumption A1 is "One runner serves one DT"
(`docs/state-machine-design.md:192`).

**Size.** M.

### 14. Machine-Readable API Description

**Add.** An OpenAPI 3 document for the HTTP API and an AsyncAPI document
for the MQTT topics in `api/`, kept in step with the controllers by a
test, and served at `GET /openapi.json`. The descriptor of item 1 links
to them.

**Touches.** `api/`, `src/app.controller.ts`, `test/e2e/`.

**Why.** P2 `sections/problem-statement.tex`: "all DTs expose a common
communication interface"; `sections/solution.tex`: DTs connect "over
standard data and protocol interfaces (W3C standards / RFCs)", and
standards such as the DT Definition Language "can form a basis for a
standardised approach to adaptation"; `figures/adaptation-graph.tex`
draws an "API Layer" above the DTs. P2 `sections/related-work.tex`
describes DT ecosystems with "an interface that allows external
consumers to seamlessly interact with DTs and dynamically discover
their relationships". The runner's `api/` directory holds httpYac
request files and a README (`api/README.md:1-9`); there is no OpenAPI
or AsyncAPI document today, although the API is documented in prose in
`README.md:233-486`.

**Size.** M.

### 15. Access Control by Role

**Add.** Optional bearer tokens (or mutual TLS) for HTTP with two roles,
`manager` and `client`, and a documented mapping to broker ACLs for
MQTT. The `manager` role alone may call `PUT /parameters` (item 4) and
the commands listed as `K_i^c` (item 5).

**Touches.** `src/config/`, a NestJS guard, `src/mqtt/mqtt.service.ts`
(MQTT 5 user properties or per-topic ACL documentation), `README.md`.

**Why.** P2 `sections/roadmap.tex`, "Security": protection "against
both external malevolent parties and the introduction of malevolent DTs
into the network"; "Trustworthiness and correctness". P1 R2 separates
the commands and parameters open to the Manager from the rest, which
needs the runner to know who is calling. The design document's A8 reads
"Anyone who can call the API can drive the machine"
(`docs/state-machine-design.md:205-207`), and `README.md:482-486`
leaves access control to the network and the broker.

**Size.** M.

### 16. React to Peer State

**Add.** A `subscriptions` section in `state-machine.yaml` that maps a
peer notification to a local event, for example "when peer `hospital-2`
reports state `full`, raise `neighbour-full`". The runner subscribes to
the `notify/state` topic of each named peer (items 3 and 13) and raises
the event through the existing `event` path, with rate limiting against
notification storms. _Inference_: the papers describe peer-to-peer
coordination without a mechanism; this is one way to express it in the
runner's event vocabulary.

**Touches.** `src/fsm/definition.ts`, `src/fsm/fsm.service.ts`,
`src/mqtt/mqtt.service.ts` (`subscribe`, line 62, `respond`, lines
106-136).

**Why.** P2 `sections/solution.tex`: "the decentralised approach
involves the DTs coordinating their adaptation through peer-to-peer
communication", adapting "based on the collective knowledge of the
network"; `sections/introduction.tex`: coordination "can either be
distributed among the DTs themselves, i.e. decentralised adaptation, or
coordinated by a single Manager". P1 `sections/conclusion.tex` plans
"to compare the centralised Manager with the decentralised and hybrid
variants". The runner subscribes only to its own request topics
(`src/mqtt/mqtt.service.ts:52-54`, `62`).

**Size.** L.

### 17. Resource and Fidelity Reporting

**Add.** Measure the CPU time, memory and duration of each script run
and include them in the history and metrics; let a DT declare a
`fidelity` parameter that scripts read. Child process metrics need a
dependency or platform-specific reads, so this is a design of its own.

**Touches.** `src/execa-runner.ts`, `src/queue.service.ts`,
`src/fsm/parameters.ts` (item 4).

**Why.** P2 `sections/problem-statement.tex`: "DTs compete for the
computational resources provided by the shared infrastructure", which
"motivates the need for adaptation at the network level"; P2
`sections/solution.tex`, "DT Orchestrator": "adjust the fidelity of DTs
based on current needs and constraints of a DTN". P1
`sections/background.tex`: "resource adaptation, which trades accuracy
for computational cost, e.g., by switching between multi-fidelity
models"; P1 `sections/conclusion.tex`: future work will "schedule DTs
to manage shared computational resources". P1 explicitly leaves
placement to the platform (`sections/contribution.tex`,
"Architecture": "we do not model the Orchestrator"), so this is the
lowest priority.

**Size.** L.

## Paper Summaries

### P1: Self-Adaptation in Digital Twin Networks

A short paper (the comment in `main.tex` targets SEAMS). It takes the
vision of P2 and makes the centralised option concrete.

**Problem** (`sections/introduction.tex`). Among a DT's adaptations it
singles out _application-policy adaptation_: "changes to the rules
through which the DT decides how to act on its PT". In a DTN such a
policy is often _shared_: "its effects, and often its parameters, span
several DTs". A DT that adapts for its own good "may relieve its own PT
at the cost of shifting load onto its neighbours". Research questions:
RQ1 asks "Which information, interfaces, and escalation criteria does a
centralised Manager need"; RQ2 asks when network-level adaptation pays
off and at what cost.

**Background** (`sections/background.tex`). A DT is
`d_i = (M_i, s_i, K_i, α_i)`: models, state sequence, controls to the
PT, and adaptation policy. Three kinds of adaptation: _model_
(recalibration, new models), _resource_ (multi-fidelity) and
_application-policy_. A DTN is "an ensemble of interconnected DTs that
exchange information to address tasks beyond the scope of any single DT
and are typically operated by a single organisational entity".
Existing orchestration work "acts on where and how DTs run"; the paper
instead coordinates the adaptations DTs decide for themselves, with a
Manager that "runs a second feedback loop on top of the local
adaptation loops".

**Requirements** (`sections/contribution.tex`):

| Requirement             | Statement                                                                                                                                                                                                            |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Policy observability | Each DT exposes its state, its local policy and the shared-policy parameters it applies; the Manager also knows the relationships among DTs.                                                                         |
| R2 Controllability      | Each DT declares which shared-policy parameters may be changed and which commands the Manager may submit; commands run through the DT's own local policy.                                                            |
| R3 Escalation criterion | An explicit condition decides what is handled at network level: _endogenous_ (the DT signals exhaustion or a need to change shared parameters) or _exogenous_ (the Manager sees a network goal violated or at risk). |
| R4 Preserved autonomy   | Non-escalated adaptations stay with the DT; the Manager only changes exposed parameters and submits exposed commands, "and never replaces local policies".                                                           |

"Consistent enactment of policy changes across DTs and stability under
repeated adaptations" are out of scope.

**System model** (`sections/contribution.tex`, "System Model"). A DTN is
`N = (P, D, R, I, C)`; the communication infrastructure `I` is assumed
reliable. The state of a DT is `s_i = (x_i, λ_i, θ_i)`; `Λ_i` is the
_local adaptation space_ of policies, `γ_i` a predicate saying whether a
policy meets local goals, and `α_i` maps the state to a _proposal_
`(λ', θ')`. The shared policy is `σ = (θ_1, …, θ_n)`. The Manager sees
the network state `O = (s_1, …, s_n, R)` and goals `G`. A
_network-level adaptation_ `u` assigns parameters from `Θ_i^c` and
submits commands from `K_i^c`; "An update writes no local policy". A DT
is _exhausted_ when no local policy satisfies `γ_i`; the endogenous
condition `e_i` holds when exhausted or when the proposal needs other
shared parameters; the exogenous `e_M(O)` when a goal is violated "in O
or in a forecast of O within a horizon H".

**Architecture** (`sections/contribution.tex`, "Architecture";
`figures/architecture.pdf`). Two layers. In the local layer each DT
runs its own MAPE-K loop and a _policy interface_ that exposes `s_i`
(R1), accepts parameter updates and commands (R2) and signals `e_i`
(R3). In the network layer the Manager runs a MAPE-K loop over a
knowledge base holding `O`, `G` and `σ`: Monitor collects states and
escalations, Analyse evaluates `G` and `e_M`, Plan computes `u`, Execute
applies it. Placement of DTs is "left to the underlying platform", so
the Orchestrator of P2 is not modelled. The companion figure
`figures/centralised-dtn.tex` shows a "DT Manager" feedback loop
feeding the Monitor of each DT's MAPE-K loop and fed by each DT's
Executor.

**Case study** (`sections/case-study.tex`). Four synthetic hospitals,
each mirrored by a BedreFlyt DT whose state is a runtime knowledge
graph "including the pending allocation requests". `R` is the distance
between hospitals. The shared parameter is the allocation scope,
single-ward or multi-ward. The only exposed command is `admit(p)`. On a
request the Manager (i) submits `admit(p)` to the receiving hospital
and then to others by distance in single-ward scope; (ii) if all fail,
sets the receiving hospital to multi-ward and retries; (iii) then does
the same for the next hospitals by distance. A multi-ward placement is
a _fallback_. Network goals: allocate every patient, avoid fallbacks,
keep travel short. The Manager is "implemented in Rust with the Actix
web framework and communicates with the DTs through REST APIs", with a
database of DT addresses, locations and identifiers. Limitations: all
requests route through the Manager, which detects escalation from the
observed state rather than from a DT signal, and the exogenous trigger
is not implemented.

**Evaluation** (`sections/evaluation.tex`). Metrics: fallback
occurrences, patient distribution, travel distance and a placement
score. A lone hospital with single-ward allocation fails to allocate
28.6% of patients; with multi-ward allocation it allocates all but at a
mean score of 0.57; the Manager allocates all at a mean score of 0.83,
"at the cost of a median travel distance of about 2.2 km".

**Future work** (`sections/conclusion.tex`): endogenous signalling, the
exogenous trigger, more loads and topologies, a Manager that adapts
system-level and DT-level goals, DT scheduling on shared compute, and a
comparison with decentralised and hybrid variants.

### P2: A Vision of System-level Adaptation in Digital Twin Networks

A vision paper for SISSY 2026 by Talasila, Sieve, Casadei, Burattini
and Esterle (`main.tex`).

**Position** (`sections/introduction.tex`). Adaptation is _structural_
(the PT changes shape, so must the DT) or _behavioural_ (the DT changes
strategy or policy). It happens at two levels: the single DT, and "a
coordinated adaptation among a network of DTs" that "are dynamically
integrated and removed at runtime". Coordination is _decentralised_
(among the DTs) or _centralised_ (a Manager); "The degree of autonomy
and capabilities of DTs determines the suitability".

**System model** (`sections/problem-statement.tex`). The same tuple
`N = (P, D, R, I, C)` and DT tuple as P1 (P1 adopts them from here).
Relationships "capture dependencies and interactions among DTs that
mirror those occurring in the physical world". All DTs "expose a common
communication interface, allowing DTs to dynamically join and leave the
network". DTs "compete for the computational resources", so one DT's
adaptation can degrade the QoS of others. Adaptation responds to changes
in `P`, `D`, `R` or `C`; `I` is assumed reliable. The paper wants both
_passive_ adaptation (local, DT-level) and _managed_ adaptation
(network-wide goals) "while preserving the autonomy of individual DTs".

**Solutions** (`sections/solution.tex`). A single DT adapts through a
MAPE-K loop whose Monitor gathers data from the PT and from other DTs,
and whose Execute step "is not the control of the PT but a dedicated
control step for the adaptation of the DT"; the loop itself can be the
adaptation policy `α_i`. Models may be fine- or coarse-grained, or
multi-fidelity. For the network, centralised and decentralised
adaptation are "possibly concurrent"; triggers are "endogenous,
originating from within the DT itself, or exogenous, where the manager
takes responsibility for adaptation if the DT does not have this
capability"; coordination "can be guided by a shared policy or
database"; a _hybrid_ scheme gives the Manager "high-level guidance"
and the DTs "low-level adaptation". DTs talk "over standard data and
protocol interfaces (W3C standards / RFCs)" and form "an open system
where different DTs can join and leave". The Manager must accommodate
"diverging requirements", from real-time to gradual adaptation. A _DT
Orchestrator_ deploys DTs at runtime, adds and removes them as PTs come
and go, negotiates "limited resources among DTs", supports the DT
continuum and adjusts model fidelity to load and resources.

**Reference architecture** (`figures/adaptation-graph.tex`). A DT
Orchestrator deploys a DT set onto compute infrastructure; DTs have
peer-to-peer links and an "API Layer" above them; each DT is linked to
its PT over an "IoT W3C Standard"; a "Manager / Control" box exchanges
with the infrastructure in both directions; an actor stands beside the
DT set.

**Related work** (`sections/related-work.tex`). Orchestration has four
functions, "federation, translation, brokering, and synchronisation"
(Nguyen et al.). DT _ecosystems_ offer "an interface that allows
external consumers to seamlessly interact with DTs and dynamically
discover their relationships" but have "no common orchestration". "No
contributions address self-adaptation at the DT network level."

**Challenges** (`sections/roadmap.tex`): security against "malevolent
DTs"; trustworthiness through runtime verification and self-organising
trust, ideally distributed to avoid "a single point of computation and
potential failure"; robustness and synchronisation over "a potentially
volatile network", where a centralised Manager "becomes a single point
of failure"; migration from IoT systems; semantic interoperability;
self-improving integration of "open ensembles of DTs"; and "Runtime
Changes in Adaptation Policies", that is, switching between managed and
decentralised adaptation.

### Vocabulary of the Papers Against the Runner

| Symbol or term            | Meaning in the papers                                         | Runner today                                                                         |
| :------------------------ | :------------------------------------------------------------ | :----------------------------------------------------------------------------------- |
| `P`, PT                   | physical twins                                                | Unknown to the runner; scripts talk to the PT.                                       |
| `D`, DT                   | one DT per PT                                                 | One runner per DT (`docs/state-machine-design.md:192`).                              |
| `R`                       | relationships between DTs                                     | None.                                                                                |
| `I`                       | communication infrastructure                                  | HTTP, and an MQTT broker when configured.                                            |
| `C`                       | shared compute                                                | The host; placement is the platform's.                                               |
| `M_i`                     | models                                                        | _Inference_: the scripts and files in `location`.                                    |
| `s_i`, `x_i`              | state; mirrored PT state                                      | Command history and machine state; no `x_i`.                                         |
| `λ_i`, `Λ_i`              | active local policy; local adaptation space                   | _Inference_: the current state; the set of states.                                   |
| `θ_i`, `Θ_i^c`            | shared parameters; controllable subset                        | None.                                                                                |
| `K_i`, `K_i^c`            | controls; commands the Manager may submit                     | `commands` allowlist; anyone may run any of them.                                    |
| `α_i`                     | adaptation policy                                             | `state-machine.yaml` transitions, driven by client events and script exit.           |
| `γ_i`, exhausted, `e_i`   | local goal; no policy meets it; endogenous trigger            | None; `no transition` and `$failure` are the nearest observable signals.             |
| `O`, `G`, `σ`, `e_M`, `u` | Manager-side knowledge, goals, shared policy, trigger, update | Not the runner's concern, except that `u` arrives as parameter updates and commands. |
| MAPE-K                    | the loop of a DT and of the Manager                           | No loop in the runner; a script may implement one.                                   |
| Orchestrator              | deploys and removes DTs, allocates resources                  | The DTaaS platform; the runner is what it would deploy.                              |

## The Runner Today

The runner is a NestJS service that runs the permitted scripts of one
`location` folder, keeps their history in SQLite and serves one API
over HTTP and, optionally, MQTT (`README.md:3-11`). It is version
`0.4.0` (`src/config/commander.ts:7`, `package.json:3`) and describes
itself as "Remote code execution for humans"
(`src/config/commander.ts:19`).

### API Surface

| HTTP                   | MQTT request topic   | Body                  | Handler                           |
| :--------------------- | :------------------- | :-------------------- | :-------------------------------- |
| `POST /`               | `<topic>/execute`    | `{"name": "create"}`  | `src/app.controller.ts:31-45`     |
| `GET /`                | `<topic>/status`     | ignored               | `src/app.controller.ts:47-50`     |
| `GET /history`         | `<topic>/history`    | ignored               | `src/app.controller.ts:26-29`     |
| `POST /fsm/transition` | `<topic>/transition` | `{"state": "create"}` | `src/fsm/fsm.controller.ts:40-50` |
| `POST /fsm/event`      | `<topic>/event`      | `{"event": "stop"}`   | `src/fsm/fsm.controller.ts:52-62` |
| `GET /fsm`             | `<topic>/fsm`        | ignored               | `src/fsm/fsm.controller.ts:30-38` |

The MQTT routes are listed in `src/mqtt/mqtt.config.ts:24-31` and
answered by `src/mqtt/mqtt-request.handler.ts:35-52` with the same JSON
as HTTP. Replies go to the MQTT 5 response topic of the request or to
`<topic>/<route>/response` (`src/mqtt/mqtt.service.ts:140-150`).
Retained requests are ignored (`src/mqtt/mqtt.service.ts:118-121`). An
`Idempotency-Key` header or MQTT 5 user property makes a repeated
request return the earlier reply (`src/execa-manager.service.ts:40-62`;
`src/fsm/fsm.service.ts:89-105`, with the last 256 keys,
`src/fsm/recent-replies.ts:11`). Nothing is published without a
request.

### State Machine Today

`state-machine.yaml` in `location` declares `events` and `states`, each
state a permitted script with a map of event to next state
(`src/fsm/definition.ts:38-47`). Names match
`^[A-Za-z0-9][\w.-]{0,63}$` (`src/fsm/definition.ts:23`). Validation
refuses an unpermitted state, an undeclared target or event, and a
cycle of `$success`/`$failure` transitions
(`src/fsm/definition.ts:85-131`). The machine is a current state and an
entry counter in memory (`src/fsm/state-machine.ts:7-9`). A transition
request is accepted only when idle (`src/fsm/fsm.service.ts:61-71`);
an event follows the current state's transition
(`src/fsm/fsm.service.ts:73-84`); entering a state starts its script
and replies `accepted` at once (`src/fsm/fsm.service.ts:119-127`); on
exit the runner raises `$success` or `$failure` for the same entry only
(`src/fsm/fsm.service.ts:129-140`). Leaving a state does not stop its
script, and a running target state is refused
(`src/fsm/fsm.service.ts:120-122`). Reply statuses and HTTP codes are in
`src/dto/fsm.dto.ts:14-24`. Requests stop in `beforeApplicationShutdown`
(`src/fsm/fsm.service.ts:45-47`).

### Execution and History

`ExecaManager.newCommand` refuses or joins repeated requests, then
`execute` checks the allowlist and runs `join(location, name)` through
`RunnerFactory` (`src/execa-manager.service.ts:98-106`). On Windows the
factory runs `powershell.exe -File <name>.ps1`
(`src/runner-factory.service.ts:8-22`). `ExecaRunner.run` awaits
`execa(command, args)` with no arguments, environment, stdin or
timeout, and turns any error into `false` (`src/execa-runner.ts:20-32`).
The result is `[success, logs]` (`src/interfaces/command.interface.ts:4`).
`Queue` keeps a `commands` table with status, logs and timestamps and a
`request_keys` table (`src/queue.service.ts:11-26`), in memory unless
`database` names a file (`src/queue.service.ts:54-62`); the history is
the list of names (`src/queue.service.ts:111-116`) and the status is the
latest row (`src/queue.service.ts:118-122`).

### Configuration Today

`runner.yaml` has `port`, `location`, `commands`, and optional
`database` and `mqtt` (`src/config/config.interface.ts:9-21`,
`config/runner.yaml.sample`). Only `mqtt` is schema-checked
(`src/config/configuration.service.ts:27-40`, schema in
`src/mqtt/mqtt.config.ts:12-20`). Startup order: configuration, state
machine, database, shutdown hooks, MQTT, HTTP (`src/main.ts:22-31`).

### Single DT, and What Is Missing for a Network

The runner serves one DT: one script folder, one machine
(`docs/state-machine-design.md:192`, `README.md:9`). Measured against
the papers it lacks: an identity; a state document with mirrored state
and shared parameters (R1); declared, settable parameters and commands
with input (R2); any outbound signal, so no escalation (R3), no state
notifications and no presence; knowledge of peers or relationships; a
way to stop a script; persistence of the machine; metrics beyond the
command names; and a machine-readable interface description.

## Open Questions and Design Decisions

The papers leave these undecided, or do not reach them:

1. **Where declarations live.** Parameters, exposed commands, peers and
   subscriptions could go in `runner.yaml` (operator's file),
   `state-machine.yaml` (DT author's file) or a new DT file. P1 puts
   `Θ_i^c` and `K_i^c` with the DT (R2), which argues for the DT
   author's file.
1. **Notification transport without MQTT.** Webhook, server-sent
   events or polling only. P1's prototype used REST and polled state;
   P2 names no protocol beyond "W3C standards / RFCs".
1. **Topic layout.** Notifications need topics apart from the request
   topics and their `/response` suffixes (D16 of the design document
   keeps every route one level under the base topic,
   `docs/state-machine-design.md:188`), a retention and QoS policy,
   and a shared base topic if peers are to be discovered by wildcard;
   today the base topic is per user (`README.md:112`).
1. **Effect of a parameter change.** Apply at the next script start,
   raise a declared event, or stop and restart the current script. P1
   excludes "consistent enactment of policy changes across DTs".
1. **What "exhausted" means for a script-based DT.** P1 defines it
   through `γ_i`, which the runner cannot evaluate. Candidates: an event
   with no transition, `$failure` with no transition, or an explicit
   call from the script.
1. **Who the Manager is.** P1's Manager is a separate Rust service and
   DTaaS has none. Whether a runner may also act as Manager (P2's
   hybrid) or only as a managed DT changes the API.
1. **Trust and multi-tenancy.** How a Manager authenticates to many
   runners of many users, and whether the DTaaS gateway or the runner
   enforces roles.
1. **Relationship attributes.** P1's `R` is a distance; in general a
   domain-specific, opaque map seems the only portable choice.
1. **Exogenous triggers and forecasts.** `e_M` needs a forecast
   horizon `H`; P1 notes forecasts "are not necessarily available". The
   runner would at most expose forecast output of a script.
1. **Command input delivery.** stdin JSON, environment variables or
   both; size limits; PowerShell parity on Windows.
1. **Recovery after restart.** Resume the stored state, mark it
   `interrupted`, or run a declared recovery state.
1. **One runner, one DT.** The papers assume one DT per PT; P2's
   orchestrator deploys and removes whole DTs. Keeping one process per
   DT matches both, so a multi-DT runner is not suggested here.
1. **Script-raised events.** A stdout protocol lets any script flood
   the machine with events; the HTTP path can be rate limited and, with
   item 15, authenticated.
1. **Platform surfacing.** How the DTaaS client and library show DTN
   state is outside the runner and these notes.

## Sources

Papers, under `.research-papers/` (gitignored):

- P1 `Generalization_of_Self_Adaptation_in_DT_Networks/`: `main.tex`,
  `sections/introduction.tex`, `sections/background.tex`,
  `sections/contribution.tex`, `sections/case-study.tex`,
  `sections/evaluation.tex`, `sections/conclusion.tex`,
  `figures/centralised-dtn.tex`, `figures/architecture.pdf`,
  `references.bib` (titles only).
- P2 `SiSSy_2026__Self_organising_Vision/`: `main.tex`,
  `sections/introduction.tex`, `sections/problem-statement.tex`,
  `sections/related-work.tex`, `sections/solution.tex`,
  `sections/roadmap.tex`, `figures/adaptation-graph.tex`,
  `references.bib` (titles only).

Runner, under `servers/execution/runner/`, at commit `af4d0f44`:

- `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`,
  `src/execa-manager.service.ts`, `src/execa-runner.ts`,
  `src/runner-factory.service.ts`, `src/queue.service.ts`,
  `src/validation.pipe.ts`.
- `src/fsm/definition.ts`, `src/fsm/state-machine.ts`,
  `src/fsm/fsm.service.ts`, `src/fsm/fsm.controller.ts`,
  `src/fsm/recent-replies.ts`, `src/dto/fsm.dto.ts`,
  `src/dto/command.dto.ts`.
- `src/mqtt/mqtt.service.ts`, `src/mqtt/mqtt-request.handler.ts`,
  `src/mqtt/mqtt.config.ts`.
- `src/config/commander.ts`, `src/config/configuration.service.ts`,
  `src/config/config.interface.ts`, `src/interfaces/*.ts`.
- `README.md`, `DEVELOPER.md`, `api/README.md`, `api/dev.api.http`,
  `api/dev.mqtt.http`, `config/runner.yaml.sample`,
  `test/data/scripts/state-machine.yaml`,
  `docs/state-machine-design.md`, and
  `docs/developer/codebase/runner.md` at the repository root.
