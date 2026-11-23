# Integrated Simulations

How a digital twin (DT) on the runner can run simulations and other
computations that augment its state, and what it should take from
other designs. In the runner, the scripts run the models (simulators,
FMUs, analytic code) as processes; see
[dt-capabilities-comparison.md](dt-capabilities-comparison.md#models-and-simulations).
These notes cover:

1. WLDT's augmentation functions, as built in its code;
2. how the runner can offer the same with little new runtime;
3. whether task frameworks such as Celery or BullMQ help.
4. the INTO-CPS simulation bridge, as a way to run simulations on
   agents outside the runner's host.

WLDT paths are under `src/main/java/it/wldt/augmentation/` of
<https://github.com/wldt/wldt-core-java> at commit `0f76c6ba`, unless
they start with `core/`, which is under `src/main/java/it/wldt/`.
Runner paths are under `servers/execution/runner/`. Statements marked
_inference_ are this document's reading.

## Since These Notes

Runner 0.11.0 ([issue 19](issues/19-properties.md)) built the
properties that these notes rely on, with three differences from what
they assume:

- **No computed kind.** A property is not marked as sensed or
  computed. "A computed property" below reads as a property that a
  script computed.
- **Units.** Every number names its unit, so `free-beds-in-2h` is
  declared with `unit: beds`.
- **The hold is built.** The coalescing of streaming frames is the
  `stateInterval` of `runner.yaml`.

The `PUT /properties` call of the examples is as built.

## WLDT's Augmentation Functions

Augmentation functions arrived in WLDT 0.7.0. They are Java plug-ins
that run inside the twin's process. Each computes results from a
snapshot of the twin's state, and the twin's model decides whether to
apply them.

### Parts

| Part               | Class                                                                         | Role                                                                                                                                                                                                                                                                                                |
| :----------------- | :---------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function           | `AugmentationFunction`, abstract                                              | `id`, `name`, `description`, `version`, a type (`STATELESS` or `STATEFUL`) and a context request (`function/AugmentationFunction.java:36-100`).                                                                                                                                                     |
| Stateless function | `StatelessAugmentationFunction`                                               | One abstract `run(request)` that returns an `AugmentationFunctionResultList`. `handleRun` wraps it with timing and success and error counters (`function/StatelessAugmentationFunction.java:144-177`).                                                                                              |
| Stateful function  | `StatefulAugmentationFunction`                                                | `start(request)` and `stop(request)`. While it runs it receives `onStateUpdate`, `onEventNotificationReceived` and `onQueryResultRefresh`. It calls `notifyResult(list)` at any time, and `refreshQueryResult()` to poll the twin's history (`function/StatefulAugmentationFunction.java:156-345`). |
| Handler            | `AugmentationFunctionHandler`, a worker; `DefaultAugmentationFunctionHandler` | Registers functions and executes, starts or stops them. It subscribes to the twin's state updates and event notifications and passes them to running stateful functions (`handler/AugmentationFunctionHandler.java:577-864`, `:1134-1200`).                                                         |
| Manager            | `AugmentationManager`                                                         | One per twin. It hosts at most five handlers (`AugmentationManager.java:60`, `:181`), and announces functions to the model only while the twin is in sync.                                                                                                                                          |
| Request            | `AugmentationFunctionRequest`                                                 | `requestId`, `timestamp`, `type` (`EXECUTE`, `START` or `STOP`) and a context: a snapshot of the state, a storage query result, or both.                                                                                                                                                            |
| Result             | `AugmentationFunctionResult<T>`                                               | A `type` (`PROPERTY_RESULT`, `EVENT_RESULT`, `RELATIONSHIP_RESULT`, `RELATIONSHIP_INSTANCE_RESULT` or `GENERIC_RESULT`), `key`, `value`, `metadata`, metrics (execution time, records processed and generated) and the request it answers.                                                          |
| Error              | `AugmentationFunctionError`                                                   | A severity (`INFO`, `WARNING`, `ERROR`, `CRITICAL`), a message, the request id and metadata.                                                                                                                                                                                                        |

### One Stateless Run

1. The model calls
   `executeAugmentationFunction(handlerId, functionId, requestId)`
   (`core/model/DigitalTwinModel.java:1085`).
2. The model builds the request from the function's context request.
   It attaches the current state if `observeState` is set, and the
   result of a storage query if `queryRequest` is set.
3. The request is published on the event bus as
   `dt.augmentation.function.execution.execute.<handler>.<function>`.
4. The handler's `onEvent` finds the function and calls `handleRun`,
   which calls the user's `run`. The run is synchronous, on the
   handler's bus thread.
5. An error in the result list becomes an error event, and the model's
   `onAugmentationFunctionError(...)` is called. Otherwise the results
   are published, and the model's
   `onAugmentationFunctionResultEvent(handler, function, results)` is
   called (`core/model/DigitalTwinModel.java:2208-2223`).
6. The model decides whether to apply the results, usually in a state
   transaction. The framework "never applies results automatically"
   (WLDT docs, `docs/change-logs/change-log-0.7.0.md`).

A stateful function follows the same path with a `START` request.
While it runs, the handler passes every committed state update and
event notification to it, and the function publishes results whenever
it likes, until a `STOP` request.

### Limits in the Code

- The context request has `propertyNameFilter`, `eventNameFilter` and
  `relationshipNameFilter`, but nothing reads them. The model attaches
  the whole state, and a TODO in the model says so
  (`core/model/DigitalTwinModel.java:1135`, `:1272`, `:1413`).
- A slow `run` blocks the handler's bus thread, and every other
  function of that handler with it.
- A run has no timeout and cannot be cancelled. Functions are trusted
  Java in the same JVM, with no isolation. There is no simulation
  clock.
- Functions are announced only while the twin is in sync. After an
  out-of-sync and in-sync cycle, the model may be told about the same
  function twice, and must tolerate it.

## WLDT's Concepts Against the Runner

| WLDT                                  | Runner today                                                                                                                | Notes                                                                                |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| Stateless function                    | A command: `POST /` with input on stdin; exit code, stdout and stderr in the reply; one run per command name                | Already isolated, timed, measured (17a, 17b), recorded in the history and idempotent |
| Stateful function                     | A state's script: it starts when the state is entered and stops at a `stop: true` transition or `POST /stop`                | The same life as `start` and `stop`                                                  |
| A function bound to a state           | Built in: a script belongs to its state                                                                                     | WLDT has nothing like it                                                             |
| Context: a state snapshot, a query    | Scripts read it themselves: `GET /state`, `/parameters`, `/peers`, `/history`                                               | Separate reads may mix moments; W1's `revision` makes a read consistent              |
| Updates pushed to a stateful function | None; scripts poll (`POLL_MS`)                                                                                              | W10, a long poll on the revision                                                     |
| `notifyResult`, the result list       | stdout, events (`POST /fsm/event`), escalation `proposal`, and computed properties with [issue 19](issues/19-properties.md) | No structured result contract                                                        |
| The model decides what to apply       | The caller decides: a script, a Manager, or the state machine through events                                                | The same principle                                                                   |
| The model triggers a run              | Missing: the `script` role cannot call `execute` (`src/auth/roles.ts:22`)                                                   | The only real gap                                                                    |
| Typed errors                          | Exit status (`failed`), stderr, the escalation trigger `failure`                                                            | Enough                                                                               |
| Per-function metrics                  | Resource figures; W4 adds run timings                                                                                       |                                                                                      |
| At most five handlers in one JVM      | One run per command name, each a separate process                                                                           | No artificial cap                                                                    |

W1, W4 and W10 are suggestions of
[wldt-research-notes.md](wldt-research-notes.md).

## Augmentation Functions in the Runner

Little new runtime is needed. The hospital twin of `demo/hospital` is
the example throughout: its `open` script asks a forecast for the free
beds in two hours.

### Stateless Functions as Commands That Scripts May Run

This is the one new piece, of size S. The DT author lists the commands
that the `script` role may execute, as `manager.commands` does for the
Manager:

```yaml
# the state machine file
augmentation:
  commands: # functions that scripts may run through POST /
    - forecast-beds
```

```powershell
# open.ps1: run the function, then decide what to apply
$reply = Invoke-RestMethod -Method Post -Uri "$env:RUNNER_URL/" -Headers $RunnerHeaders `
  -ContentType 'application/json' `
  -Body (@{ name = 'forecast-beds'; input = @{ horizon = 'PT2H' } } | ConvertTo-Json -Compress)
$forecast = $reply.stdout | ConvertFrom-Json
if ($forecast.'free-beds' -le 0) { Send-Runner 'fsm/event' @{ event = 'full-soon' } }
Invoke-RestMethod -Method Put -Uri "$env:RUNNER_URL/properties" -Headers $RunnerHeaders `
  -ContentType 'application/json' -Body (@{ 'free-beds-in-2h' = $forecast.'free-beds' } | ConvertTo-Json)
```

- **The calling script plays WLDT's model.** It receives the result and
  decides whether to write a computed property (issue 19), raise an
  event, or escalate. Nothing is applied automatically.
- **What the change involves.** `src/auth/roles.ts` already checks the
  Manager's `execute` against `manager.commands`; the same rule extends
  `execute` to `script` for `augmentation.commands`. The declaration
  needs a check that each name is in `commands`, and documentation.
- **What comes free:**
  - history rows, with `by: script`;
  - resource figures and the outcome;
  - idempotency keys;
  - one run per name: a second caller joins the running forecast.
- **The risk.** All scripts share one token (S11), so the runner cannot
  tell which script calls. A function that calls itself would join its
  own run and wait forever. The documentation must forbid that, and
  callers should set an HTTP timeout. A cap on the run time of commands
  would be the general fix.

### Stateful Functions Stay State Scripts

A function that runs on and reacts to updates is what a state's script
already is: it lives from the state's entry to its exit. It needs two
planned pieces:

- W10, so that updates arrive without polling;
- issue 19, so that its results appear as computed properties.

A stateful function that runs outside the machine, across several
states, would be the sampler script decided against on 2026-11-20, so
it stays out.

### Context as a Consistent Snapshot

WLDT hands a function a snapshot so that it computes on one consistent
state. The runner's equivalent is the state document with W1's
`revision`:

1. A function reads `GET /state` once.
2. It records the revision it used in its result.
3. Its caller can then drop a result computed on an outdated state,
   such as "a forecast from revision 41, while the state is at 44".

### Later, if Needed: a Result Contract

Entries of `augmentation.commands` could declare that stdout is a JSON
result list of `{type: property | event, key, value}`. The runner would
parse it once, at exit, and apply only the keys the declaration names,
so the declaration takes the part of WLDT's model.

This is not the stdout line protocol that was rejected (open question
13 of [dtn-research-notes.md](dtn-research-notes.md)). It is parsed
once per run, not streamed, so a script cannot flood the machine with
events. It still adds a protocol, so it should wait until the pattern
above proves too loose. It is the owner's decision.

### What Stays Out

- Caps of five handlers.
- In-process plug-ins; [xstate.md](xstate.md) gives the reasons.
- A simulation clock, which C8 of the capabilities comparison covers as
  a convention.

### The Hospital Example

| Element           | Kind of function                               | Role                                   |
| :---------------- | :--------------------------------------------- | :------------------------------------- |
| `forecast-beds`   | Stateless                                      | Forecasts the free beds for a horizon  |
| `open`            | Stateful: samples, calls the forecast, decides | The model's part                       |
| `free-beds-in-2h` | Computed property                              | Holds the applied result               |
| `full-soon`       | A new event                                    | Lets the machine react to the forecast |

The net new runtime is one role rule. The rest comes from W1, W10 and
issue 19, which are planned or proposed already.

## Task Distribution Frameworks

Do frameworks such as Celery, or a JavaScript or TypeScript equivalent,
help implement augmentation functions? Not inside the runner. They
duplicate what the runner already does for one twin, bring
infrastructure, and contradict decisions taken. They do help one layer
up, as a shared compute service for heavy simulations.

### The Candidates

| Framework                | Language       | Needs                                           | Main features                                                                                                                       |
| :----------------------- | :------------- | :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| Celery                   | Python         | A broker (RabbitMQ or Redis) and a result store | Workers on many machines; retries; `chain`, `group` and `chord` to compose tasks; a periodic scheduler (beat)                       |
| BullMQ                   | TypeScript     | Redis                                           | Delayed and repeating jobs; retries with backoff; priorities; rate limits; parent and child flows; processors in separate processes |
| pg-boss, Graphile Worker | TypeScript     | PostgreSQL                                      | A job queue in Postgres; cron schedules                                                                                             |
| Temporal                 | TypeScript SDK | A Temporal server cluster                       | Durable workflows written as code; durable timers; retries; survives crashes                                                        |

### What Each Feature Means for the Runner

| Feature                                           | For augmentation functions in the runner                                                                                                                                                         | Fit                                                                                    |
| :------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| Running a job in isolation, with outcome and logs | Exists: a command is a process with its exit code, stdout and stderr, history, resource figures and idempotency key (`src/execa-manager.service.ts`)                                             | Duplicate                                                                              |
| Workers on other machines                         | Only for simulations too heavy for the twin's host. Resource figures measure the local process tree (17a, 17b); the separate script account (18) and `RUNNER_URL` on `127.0.0.1` assume one host | Breaks the runner's model                                                              |
| Queueing several runs                             | Today a second request joins the running one. A queue changes that behaviour                                                                                                                     | A new decision; an in-process queue would do                                           |
| Automatic retries                                 | Conflicts with S6 (the runner never restarts a script on its own) and with side effects on the physical twin                                                                                     | Conflicts                                                                              |
| Jobs that survive a restart and run again         | Conflicts with D28: a script running at a restart is `interrupted` and not run again                                                                                                             | Conflicts                                                                              |
| Scheduled and repeating jobs                      | Needed: the runner has no time triggers, and a periodic forecast wants one                                                                                                                       | A real gap, but small: a persisted timer, or XState's `after` ([xstate.md](xstate.md)) |
| Composing jobs                                    | The state machine already chains scripts through `$success` and `$failure`, and a script can call a function                                                                                     | Overlaps the machine. Temporal would replace it with in-process workflow code          |
| Storing results                                   | The history, and issue 19's computed properties                                                                                                                                                  | Duplicate                                                                              |

### What They Would Cost

- **Infrastructure for every twin.** A runner is one process per twin,
  often per user, installed from npm, with SQLite and an optional MQTT
  broker. A Redis, RabbitMQ, PostgreSQL or Temporal server per runner
  is heavy. A broker that many runners share becomes a trust boundary
  between users' twins, which `SECURITY-MODEL.md` leaves to the
  orchestrator.
- **Remote code execution.** A worker that runs any task a message
  names is what the command allow-list and the roles prevent today.
  Celery's early use of pickle is the well-known case.
- **Platforms.** Celery does not support Windows officially, and the
  hospital demo runs on Windows. BullMQ runs there, but needs Redis.
- **Dependencies.** `PROJECT.md` admits a dependency only when the task
  requires it. The runner needs none of what only these frameworks
  provide.

### Where a Framework Helps: the Platform

Heavy simulations need shared compute: P2's compute `C` and its
orchestrator. A platform service, such as an Execution Manager built on
BullMQ, Temporal, Celery, Kubernetes Jobs or Slurm, can run them on a
pool of machines for many twins, and the runner does not change:

```text
open.ps1 ──POST / forecast-beds──▶ runner ──spawns──▶ forecast-beds, a thin client
                                                        │ submits the job, waits or polls
                                                        ▼
                                         the platform's job service
                                                        │ result
open.ps1 ◀── reply, stdout holding the results ◀────────┘
         └─ decides: PUT /properties free-beds-in-2h, or raise an event
```

- The augmentation function stays a command. Its script is a client of
  the job service, so history, outcome, idempotency and "the caller
  decides" all hold.
- The resource figures would cover only the thin client, not the
  remote simulation. The job service would report the simulation's
  cost, for example in the result.
- `SECURITY-MODEL.md` (lines 520 to 553) already plans a deploy issue
  for a future Execution Manager and microVMs. A job service belongs
  there.

### Recommendation on Task Frameworks

1. **Inside the runner:** no task framework. Implement augmentation
   functions as planned:
   - commands that scripts may run;
   - W1, for a consistent snapshot;
   - W10, for pushed updates;
   - issue 19, for results.
2. **Time triggers,** the one real gap: a small persisted timer in the
   runner, or XState's `after` if option B of `xstate.md` goes ahead.
   A periodic forecast does not need a broker.
3. **Heavy or distributed simulations:** a platform-level job service
   that function scripts call as clients. Which framework to use there
   is a platform decision: BullMQ for a TypeScript platform, Temporal
   for durable multi-step workflows, Slurm or Kubernetes Jobs for
   high-performance runs.

## The INTO-CPS Simulation Bridge

The [simulation bridge](https://github.com/into-cps-association/simulation-bridge)
offers a way to run simulations outside the runner's host. Clients send
it simulation requests, it hands them to simulation agents, and the
agents' results come back to the client. The proposal examined here:

- the state machine file declares the simulations each state needs;
- the runner sends the requests with the data they need and receives
  the results;
- the choice between stateless and stateful is left to the simulation
  types the agents support: batch, streaming and interactive.

The whole repository was read at commit `52e7ba5` (2026-06-18);
[simulation-bridge-code-map.md](simulation-bridge-code-map.md) maps it
with `path:line` citations. Paths below are relative to that
repository's root, or to `agents/matlab/matlab_agent/src/` for the
MATLAB agent's files.

### What the Bridge Is

- **The bridge** (`simulation_bridge/`) is middleware in Python 3.12,
  version 0.2.0. Clients reach it in four ways:
  - MQTT;
  - RabbitMQ;
  - REST, with a JWT, and results streamed back as NDJSON;
  - a Python call in the same process.

  The bridge talks to agents only over RabbitMQ.

- **The agents** (`agents/matlab`, `agents/simul8`) each run one
  simulator and consume their own queue, `Q.sim.{agent_id}`.
- **A request** looks like this. The bridge validates it, drops unknown
  fields, and adds `bridge_meta`, the client's protocol, and an
  anti-spoofing `bridge_index`.

  ```yaml
  simulation:
    request_id: abcdef12345
    client_id: dt
    simulator: matlab
    type: batch
    file: SimulationBatch.m
    timeout: 60
    inputs: { x_i: 10, y_i: 9 }
    outputs: { x_f: Final x position }
  ```

- **A result** has `request_id`, `status`, `simulation` (`name`,
  `type`, `outputs`), and, depending on the type, `sequence`,
  `progress`, `data`, `metadata` or `error`, plus `source`,
  `destinations` and `timestamp`. The statuses agents send are
  `in_progress`, `Simulation Started`, `streaming`, `working`,
  `completed` and `error`. The bridge also treats `failed`, `aborted`
  and `cancelled` as final, but no agent sends them.

### Three Corrections to the Proposal

1. **A request's field chooses the agent, not an MQTT topic.** For every
   protocol, the bridge publishes to the exchange `ex.bridge.output`
   with the routing key `{client_id}.{simulator}`. Each agent binds its
   queue with `*.{agent_id}` (`simulation_bridge/src/core/bridge_publisher.py:96`,
   `simulation_bridge/src/protocol_adapters/mqtt/mqtt_adapter.py:138-139`).
   `simulation.simulator` must therefore equal the agent's id. MQTT has
   one input topic for everything, `bridge/input`. The state machine
   file would name a simulator, not a topic. A topic per simulator,
   such as `bridge/input/<simulator>`, would be a new bridge feature.
2. **Every MQTT client receives every result.** All results go to one
   topic, `bridge/output` (`mqtt_adapter.py:233-240`). The RabbitMQ
   path does the same through the binding `*.result`. Every twin
   receives every other twin's results and must filter on `request_id`,
   and `client_id` is whatever a client claims. For DTaaS, with many
   users, that leaks data between them.
3. **Interactive inputs do not pass through the bridge.** For an
   interactive run, the MATLAB agent binds its own queue,
   `Q.{agent}.interactive.{request_id}`, to the RabbitMQ exchange
   `ex.input.stream`. The routing key comes from `inputs.stream_source`,
   such as `rabbitmq://streaming.inputs.sim123`
   (`core/interactive.py:256-270`). Inputs during the run must be
   published to RabbitMQ directly, so a runner that speaks only MQTT
   and HTTP cannot drive an interactive simulation through the bridge.

### Simulation Types Are the Kinds of Augmentation Function

| Type        | What the code does                                                                                                                            | WLDT's equivalent                                            | Agents         |
| :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------- | :------------- |
| batch       | Inputs at the start, one result at the end. MATLAB starts a new Engine per request; Simul8 runs the model through COM and exchanges CSV files | A stateless function, `run`                                  | MATLAB, Simul8 |
| streaming   | Inputs once, then a `streaming` frame with a `sequence` for each result the model sends over TCP port 5678, then `completed`                  | A stateful function that pushes, `notifyResult`              | MATLAB         |
| interactive | Inputs during the run through `ex.input.stream`, `working` frames back, then `completed`                                                      | A stateful function that also takes updates, `onStateUpdate` | MATLAB         |

Leaving stateless and stateful to the simulation type is sound. The
runner then handles three message patterns: one request and one
result; one request and many results; many messages each way.

### Declaring Simulations in the State Machine File

A sketch, using the hospital twin:

```yaml
# the state machine file, the DT author's
simulations:
  forecast:
    simulator: matlab # the agent's id; this routes the request
    type: batch
    file: forecast_beds.m
    timeout: 300 # always set: a batch route expires after 60 s otherwise
    inputs:
      free_beds:
        property: free-beds # filled from issue 19's properties
      scope:
        parameter: scope
      horizon_h: 2
    outputs:
      free_beds_in_2h: Free beds in two hours
    results:
      properties:
        free-beds-in-2h: free_beds_in_2h # an output into a computed property
      events:
        completed: forecast-ready # raised as events of the machine
        error: forecast-failed
states:
  open:
    simulations:
      - forecast # sent on each entry of open
    transitions:
      forecast-ready: open
      forecast-failed:
        state: closed
        stop: true
```

```yaml
# runner.yaml, the operator's: how to reach the bridge
simulationBridge:
  mqtt:
    url: 'mqtts://bridge.example.org:8883'
    inputTopic: 'bridge/input'
    outputTopic: 'bridge/output'
```

How the runner would behave:

1. **Sending.** On entry to the state, the runner:
   - fills `inputs` from parameters and properties;
   - sets `client_id` to the DT's id;
   - sets a unique `request_id`, such as `<dt>:<state>:<entry>:<uuid>`;
   - publishes the request and records it, as it records a command.
2. **Batch results.** `completed` writes the named outputs to computed
   properties (issue 19), then raises the declared event. The runner
   decides nothing itself; the machine's transitions decide, which keeps
   WLDT's rule that the model decides.
3. **Streaming results.** Each frame updates the named properties,
   keeping the latest value with the coalescing that issue 19 plans.
   Only `completed` and `error` raise events, so the machine is not
   flooded.
4. **Interactive inputs.** Changes of the named properties or
   parameters would go out as input frames. That needs either a
   RabbitMQ client in the runner or a bridge that relays inputs from
   MQTT.
5. **Stale results.** The bridge cannot cancel a run. When the state is
   left, the runner can only stop listening: it ignores a result of an
   earlier entry, as it ignores the completion of an earlier entry
   today.
6. **Deadlines.** Each request needs a deadline in the runner. Without
   one, a batch error is never seen (see the next section), and the
   twin waits for ever.

Decisions this would need from the owner:

- **D2**, a state is a script: may a state have simulations and no
  script?
- **S6**: sending a request on entry is the machine acting by itself,
  though running a state's script is too.
- **Names**: runner ids may contain `.`, and a `.` in `client_id`
  silently breaks the bridge's routing key.

### Gaps in the Bridge

| Gap, as found in the code                                                                                                | Effect on the twin                                                          | Runner workaround                                          | Fix in the bridge                                                                           |
| :----------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| Batch errors carry `request_id='unknown'` (`core/batch.py:203-204`; the same in Simul8), so the bridge cannot route them | A failed simulation looks like silence                                      | A deadline per request that raises `$failure` or escalates | Carry `request_id` and `bridge_meta` on error paths                                         |
| Invalid, duplicate or unroutable requests, and unknown simulators, are only logged                                       | Silence                                                                     | The same deadline                                          | Error replies; a list of known agents                                                       |
| A route expires after `timeout`, clamped to 30 to 1200 s, and 60 s by default for batch                                  | A long or queued run loses its result                                       | Always send `timeout`; raise the bridge's maximum          | Keep the route while the agent reports progress                                             |
| All results go to `bridge/output`, and `client_id` is self-declared                                                      | Twins see each other's results                                              | Filter on `request_id`; no protection possible             | A result topic per client (`bridge/output/<client_id>`), bound to an authenticated identity |
| No cancel or stop request                                                                                                | Leaving a state cannot stop a simulation                                    | Ignore stale results                                       | A `cancel` request type                                                                     |
| Interactive inputs only through RabbitMQ's `ex.input.stream`                                                             | The runner cannot use interactive simulations                               | A RabbitMQ client, or a helper script                      | Relay inputs from MQTT or REST                                                              |
| One run at a time per agent: fixed TCP ports, and Simul8's clean-up kills every `s8.exe`                                 | Twins queue behind each other, and with a 60 s route their results are lost | Longer timeouts                                            | Ports per run; several agent processes                                                      |
| No registration or health check for agents                                                                               | The runner cannot report "no agent for matlab"                              | The deadline, and an error in the history                  | A heartbeat or a list of agents                                                             |

The bridge's tests mock the broker, MATLAB and COM; there is no
end-to-end test.

### Recommendation for the Bridge

1. **First, a bridge client script, with no change to the runner.** A
   script per state, or a command such as `forecast-beds`:
   - sends the request over MQTT or REST;
   - filters `bridge/output` on its `request_id`;
   - applies a deadline;
   - writes results to computed properties, or raises events.

   Everything above works this way today, including the twin deciding
   what to apply. It shows, on the hospital example, which gaps of the
   bridge matter.

2. **Upstream, in the same association,** the bridge would gain:
   - error routing;
   - result topics per client;
   - input topics per simulator, which would make the topic-based
     proposal literally true;
   - cancellation;
   - interactive inputs relayed over MQTT.

   These make a native integration safe for many users.

3. **Then native support in the runner:** the `simulations` key and the
   lists per state sketched above. Results arrive as issue 19's computed
   properties and as events; streaming frames are coalesced; deadlines
   and the filtering of stale results are built in. Interactive
   simulations stay with scripts until the bridge relays inputs over
   MQTT.

## Fluid Digital Twins: Offloading and a Twin Beside Itself

The WLDT authors extend the library into Fluid Digital Twins (FDT) in
a later paper, cited as FDT with its section numbers (see
[Sources](#sources)). Sections 2 to 4 were read for two things that
issues [22](issues/22-timeline.md), [23](issues/23-snapshot.md) and
[24](issues/24-what-if.md) plan: moving work between places, and
running a second twin next to the first.

### What Moves in the Paper

Fluid computing moves **functions and data**, not a twin:

- A function `f(x)` that runs on the physical twin (PT) can be
  offloaded to the DT, and the DT can add functions that the PT never
  had (FDT §2, Fig. 1).
- Functions are chained into a **pipeline**, where the output of one
  is the input of the next. Where each step runs is decided at run
  time, from "processing speed, energy consumption, system workload"
  (FDT §2.1).
- Three kinds of function exist: computing, sensing and actuation, and
  storage (FDT §3.1). Storage is a function of its own, so the others
  hold no state.
- Inside the DT, a **fluid layer** holds a registry of pipelines and
  functions, with the language of each, and a pool of workers that
  run them on function events (FDT §3, Fig. 4).

Against the runner:

| FDT                                 | Runner                                                                                                 |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------- |
| A fluid function                    | A command: a script that takes input on stdin and answers on stdout                                    |
| A pipeline                          | A script that runs commands in turn, as [above](#stateless-functions-as-commands-that-scripts-may-run) |
| The registry, with languages        | `commands` of `runner.yaml`; a script is in any language                                               |
| The pool of workers                 | One process per run, with its resource figures (17a, 17b)                                              |
| Offloading to the edge or the cloud | The simulation bridge, or the same command on another runner of the class                              |
| A function triggered every minute   | The time triggers that these notes [found missing](#recommendation-on-task-frameworks)                 |

**Lesson 1: what is stateless moves for free.** The paper never
transfers the state of a computation. It keeps functions stateless
and makes storage explicit, so offloading is only "run this, with
this input, over there". The runner's commands are the same. A
command of a class can run on any runner that has the class and its
scripts, with nothing saved first. Only what a state's script holds
in memory, or in its run directory, needs the snapshot of issue 23.
That is the argument for the rule of 23: keep what must survive in
the properties.

### A Twin Beside Itself

The closest thing in the paper to saving a twin and starting another
is the **Test-FDT** (T-FDT): a replica of a production FDT, made to
try a new function before it is deployed (FDT §4.2, Fig. 5). An
orchestrator makes the replica, synchronises it, validates the
function, and then promotes the function or drops it. Three patterns:

| Pattern    | Where the inputs come from                                    | In issue 24                              |
| :--------- | :------------------------------------------------------------ | :--------------------------------------- |
| History    | Recorded data and "the production FDT's computational state"  | A replay, fed to a fork                  |
| Parallel   | The live data of the PT, as the production FDT receives it    | Not planned: it needs the live twin      |
| Simulation | A synthetic environment, in the paper SimPy in real-time mode | A scenario, in the twin or fed to a fork |

What the paper adds to the plan of issue 24:

- **Lesson 2: a third kind, in parallel.** A fork that receives the
  live inputs of the twin answers "what is the changed twin doing
  right now?". It needs no recording of the future and no model of
  the world, as the world answers for itself. With the timeline of
  issue 22, a replayer that keeps asking for rows after the last one
  is that feed.
- **Lesson 3: the thing under test may be the class.** The paper
  never tests a parameter. It tests a new function. For the runner,
  that is a new version of the class: other scripts, or another state
  machine. "Would version 1.1 have escalated last night?" is a replay
  with another file, and it is how a class should be tried before
  every instance takes it.
- **Lesson 4: a run ends in a decision.** A T-FDT reports and is
  deactivated, and the function is promoted or not. Nothing is merged
  back. A fork is the same: its timeline is the answer, and the
  Manager or the operator then changes the twin by the usual routes.
- **Lesson 5: measure the run, not only its result.** The validation
  result is "execution time, resource consumption, output accuracy"
  (FDT §4.2). A comparison of two timelines should set the resource
  figures of the scripts side by side too, which the command history
  already holds.
- **Lesson 6: the simulated world sits next to the replica.** The
  simulation runs "within the same container" as the T-FDT, and
  feeds it over MQTT as a PT would (FDT §5.1.5). That is the mock of
  the hospital that the owner proposed for issue 24. As planned
  there, the mock is a copy: the save script of the class copies what
  the scripts keep, and a what-if runs on the copy.
- **Lesson 7: real time at a factor is known ground.** SimPy's
  real-time mode ties simulated time to the clock by a factor. The
  speed of a replay in issue 24 and `DT_TIME_SCALE` are the same
  idea.

### One Runner or Another

A fork has to be started and fed by something. The first plan of
issue 24 was an API call to the runner of the twin, and the owner
noted that one runner managing parallel simulations is useful but
complex. The paper does it the other way: the twin only hands over
its data, and an orchestrator outside it starts and stops the
replicas, as Docker containers (FDT §5.0.1, §5.1.5). Both ways are
weighed here; what the owner decided follows the tables.

**The runner of the twin starts its forks.**

| For                                                                   | Against                                                                                                                |
| :-------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| One call answers a question; a small deployment needs nothing else    | The fork runs on the host of the twin and takes its CPU. In the paper a replay drives the T-FDT to 100% (FDT Fig. 10a) |
| The snapshot and the timeline are local, so nothing crosses a network | The work can not go where there is room for it, which is the point of fluid computing                                  |
| The runner knows the class and can refuse one without a mock          | The runner becomes a supervisor: ports, directories, limits, orphans after a crash                                     |
| One place has both timelines, so a comparison is one route            | A fault in a fork, or in the code that feeds it, is now inside the process that serves the twin                        |
| The limits are the operator's, in one `runner.yaml`                   | It ends S1 and S2 as they stood, and a new version of the class can not be tried: the host has one install             |

**Another runner is the fork**, started by an operator, a tool or the
platform, and fed over the public API.

| For                                                                                  | Against                                                                                                 |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| S1 and S2 stand: a runner serves a twin and starts nothing                           | Something else must orchestrate, which a single user does not have                                      |
| The fork can run in the cloud, with more room, as the paper's FDT' does (FDT Fig. 2) | The snapshot and the timeline cross a network. In the paper the sync is the visible cost (FDT Fig. 10c) |
| The twin is safe from the load and the faults of a fork                              | The inputs of commands leave the host of the twin, with the personal data in them                       |
| It is the same step as moving a twin (issue 23), so one mechanism serves both        | The other host needs the class and its scripts, in the version wanted                                   |
| A new version of the class is tried where it is installed                            | Two clocks: the times of two timelines need care before they are compared                               |
| The DTaaS platform starts runners already                                            | A fork in parallel lags its twin by the time a row takes to travel                                      |

**The two do not have to be chosen between.** What differs is who
starts the process. What is the same is everything else:

1. a fork is a runner started from a snapshot (issue 23);
2. a feed reads the rows of one timeline, or a scenario, and sends
   them to a runner over its public API;
3. a comparison reads two timelines over their public APIs.

If 2 and 3 use only the public API, they work from anywhere. The
orchestrator of the paper is then a tool that does 1 to 3 against two
hosts.

**What the owner decided, on 2026-11-23.** The runner starts no
process. The two needs are met apart:

- **The operator replays in a replay twin** (issue
  [25](issues/25-replay.md)). A tool of the package starts another
  runner from a snapshot, feeds it the inputs that a later snapshot
  recorded, and a second tool compares the two timelines. Neither
  contacts the twin. This is the second table, with the tool as the
  orchestrator, and without its costs of a network: a snapshot holds
  the database, the class and its scripts, so everything is in two
  directories.
- **The twin answers a what-if by itself with a script** (issue
  [24](issues/24-what-if.md)). A command that the class lists runs on
  a private copy of the twin, which the save script of the class
  makes. It is what the first table wanted, one call and no operator,
  without a second process to supervise. It runs one script with a
  model, not the state machine, and it can change nothing: it gets no
  token.

What the first table held against a runner that supervises forks
does not arise. What it held for it is kept in the smaller form: one
call, local data, and no network.

### What the Paper Leaves Open

- **The state that is transferred has no format.** "Computational
  state" and "sync specs" are named and not defined. A snapshot with
  a `format` number, and a timeline with a `seq`, are more than the
  paper gives.
- **Consistency during the sync is not treated.** "Master–slave" is
  named. Nothing says what a replica sees if the twin changes while
  it copies.
- **Nothing keeps a replica from acting on the PT.** The "controlled
  environment" is asserted. Issue 24 has two rules for it: a
  what-if inside the twin runs on a copy, and a fork is refused
  unless its class allows one.
- **Time is the time of the clock.** Only the simulation pattern has
  a notion of scaled time, and it is SimPy's.

## Sources

- WLDT core at `0f76c6ba`: the `augmentation` package and
  `core/model/DigitalTwinModel.java`; the WLDT documentation's
  augmentation guide and its 0.7.0 change log. Both are summarised in
  [wldt-code-map.md](wldt-code-map.md) and
  [wldt-docs-and-paper.md](wldt-docs-and-paper.md).
- Runner at `01c3ea75`: `src/auth/roles.ts`,
  `src/execa-manager.service.ts`, `SECURITY-MODEL.md`,
  `docs/issues/19-properties.md`, `demo/hospital`; `PROJECT.md` at
  the repository root.
- FDT: Bedogni, Mamei, Picone, Pietri, Zambonelli, "Fluid Computing & Digital
  Twins for intelligent interoperability in the IoT ecosystem", _Future
  Generation Computer Systems_ 171 (2025) 107855,
  doi:10.1016/j.future.2025.107855;
  sections 2 to 4 for the design, and 5 for how it was run. Read from
  the PDF that the owner supplied.
- Simulation bridge at `52e7ba5`: the whole repository, mapped in
  [simulation-bridge-code-map.md](simulation-bridge-code-map.md).
