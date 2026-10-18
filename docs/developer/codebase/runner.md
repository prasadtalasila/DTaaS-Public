# Runner Microservice

The Runner microservice executes scripts for digital twins in the DTaaS
platform. It accepts HTTP requests, and optionally MQTT requests, to run
pre-configured commands and returns the execution status and logs to the
caller.

## Package Structure

```text
servers/execution/runner/
├── src/                           # Application source code
│   ├── main.ts                    # Application entry point
│   ├── app.module.ts              # Root NestJS module
│   ├── app.controller.ts          # REST API controller
│   ├── execa-manager.service.ts   # Command execution manager
│   ├── execa-runner.ts            # Command runner implementation
│   ├── queue.service.ts           # Command queue service
│   ├── runner-factory.service.ts  # Runner instance factory
│   ├── validation.pipe.ts         # Request validation pipe
│   ├── config/                    # Configuration module
│   │   ├── commander.ts           # CLI argument parsing
│   │   ├── config.interface.ts    # Configuration interface
│   │   ├── configuration.service.ts  # Configuration service
│   │   └── util.ts                # Configuration utilities
│   ├── dto/                       # Data transfer objects
│   │   ├── command.dto.ts         # Command request and response DTOs
│   │   └── fsm.dto.ts             # State machine requests and replies
│   ├── fsm/                       # State machine of script transitions
│   │   ├── definition.ts          # Reads and checks state-machine.yaml
│   │   ├── state-machine.ts       # Current state and next states
│   │   ├── recent-replies.ts      # Replies to repeated requests
│   │   ├── fsm.service.ts         # Runs the script of each state
│   │   └── fsm.controller.ts      # State machine REST API
│   ├── mqtt/                      # MQTT API
│   │   ├── mqtt.config.ts         # MQTT settings and topics
│   │   ├── mqtt-request.handler.ts  # Answers an MQTT request
│   │   └── mqtt.service.ts        # MQTT client and subscriptions
│   └── interfaces/                # Interface definitions
│       ├── command.interface.ts   # Command types
│       └── runner.interface.ts    # Runner interface
├── api/                           # API documentation
├── config/                        # Sample configuration files
├── docs/                          # Design documents
├── test/                          # Test suites
└── dist/                          # Compiled output
```

## Architecture and Design

The microservice is built with the NestJS framework and runs commands
with the `execa` library. A queue holds the execution requests, and a
factory creates the runner instances.

### Core Components

```mermaid
classDiagram
    class AppController {
        -manager: ExecaManager
        +getHistory(): ExecuteCommandDto[]
        +newCommand(dto): void
        +cmdStatus(): CommandStatus
    }

    class ExecaManager {
        -commandQueue: Queue
        -config: Config
        -running: Map
        +newCommand(name, requestKey): [boolean, Map]
        +onApplicationShutdown(): Promise~void~
        +checkStatus(): CommandStatus
        +checkHistory(): ExecuteCommandDto[]
    }

    class Queue {
        -db: DatabaseSync
        +open(file): void
        +enqueue(name, requestKey): number
        +addKey(requestKey, commandId): void
        +complete(id, result): void
        +checkHistory(): ExecuteCommandDto[]
        +activeCommand(): CommandRecord
        +findByKey(requestKey): CommandRecord
    }

    class RunnerFactory {
        +create(command): Runner
    }

    class ExecaRunner {
        -command: string
        -stdout: string
        -stderr: string
        +run(): Promise~boolean~
        +checkLogs(): Map
    }

    class Config {
        -configValues: ConfigValues
        +loadConfig(options): void
        +permitCommands(): string[]
        +getPort(): number
        +getLocation(): string
        +getMqtt(): MqttConfig
    }

    class MqttService {
        -client: MqttClient
        +start(): void
        +beforeApplicationShutdown(): Promise~void~
    }

    class MqttRequestHandler {
        -manager: ExecaManager
        -fsm: FsmService
        +handle(route, payload): Promise~unknown~
    }

    class FsmController {
        -fsm: FsmService
        +check(): FsmStateDto
        +transition(dto): FsmReplyDto
        +event(dto): FsmReplyDto
    }

    class FsmService {
        -machine: StateMachine
        -manager: ExecaManager
        +load(): void
        +transition(state, requestKey): FsmReplyDto
        +event(event, requestKey): FsmReplyDto
        +check(): FsmStateDto
    }

    AppController --> ExecaManager : uses
    MqttService --> MqttRequestHandler : uses
    MqttService --> Config : uses
    MqttRequestHandler --> ExecaManager : uses
    MqttRequestHandler --> FsmService : uses
    FsmController --> FsmService : uses
    FsmService --> ExecaManager : uses
    FsmService --> Config : uses
    ExecaManager --> Queue : uses
    ExecaManager --> Config : uses
    ExecaManager --> RunnerFactory : uses
    RunnerFactory --> ExecaRunner : creates
```

## Main Components

### REST API Controller

The `AppController` exposes three endpoints, and the `FsmController`
three more for the state machine:

| Endpoint          | Method | Purpose                               |
| :---------------- | :----- | :------------------------------------ |
| `/`               | POST   | Submit a new command for execution    |
| `/`               | GET    | Get status of the current command     |
| `/history`        | GET    | Retrieve execution history            |
| `/fsm/transition` | POST   | Move an idle state machine to a state |
| `/fsm/event`      | POST   | Send an event to the state machine    |
| `/fsm`            | GET    | Get the state of the state machine    |

### MQTT API

The `MqttService` starts when the configuration has an `mqtt` section.
It subscribes to the `execute`, `status`, `history`, `transition`,
`event` and `fsm` topics under the configured base topic. The
`MqttRequestHandler` answers each request through the same
`ExecaManager` and `FsmService` as the REST API, so both protocols share
one command queue and return the same JSON. The reply goes to the MQTT 5
response topic of the request, or to the request topic followed by
`/response`.

### Execution Manager

The `ExecaManager` service runs each command in these steps:

1. Returns the result of an earlier request, without running anything,
   when the request repeats it: the request has the request key of an
   earlier request for the same command (the `Idempotency-Key` HTTP
   header or MQTT 5 user property), or asks for a command that is still
   running. A request key of another command is refused.
2. Adds the command to the queue, marked `invalid`.
3. Checks the command against the list of permitted commands.
4. For a permitted command, creates a runner through the factory and
   runs the script from the configured location.
5. Stores the status (`valid` if the script succeeds) and the logs in
   the queue, and returns them.

### Command Queue

The `Queue` service keeps the execution history in an SQLite database,
through the `node:sqlite` module of Node.js. Each command is stored with
its execution status (`valid` or `invalid`), its logs, and the times
it was received and finished. A second table maps each request key to
the command that the request ran or joined. The database is in memory
unless the `database` setting names a file. At shutdown, the
`MqttService` disconnects first, and the `ExecaManager` closes the
database once the commands in progress have finished.

### State Machine

A digital twin may have a state machine in the `state-machine.yaml` file
of its script directory. Each state is a permitted command, and each
state maps events to next states. `main.ts` has the `FsmService` load
the file at startup, before the database opens; `definition.ts` refuses
a file that names an unpermitted command, an undeclared state or event,
or a loop of `$success` and `$failure` transitions, and the runner does
not start.

1. A transition request moves an idle machine to a state. The pure
   `StateMachine` records the state and numbers the entry.
2. The `FsmService` starts the script of the state through the
   `ExecaManager`, without waiting for it, and replies `accepted`.
   It refuses a state whose script is still running, since the
   `ExecaManager` would join that run instead of starting the script.
3. An event moves the machine along the transition of its current state,
   while the script of that state may still run.
4. When the script exits, the service raises `$success` or `$failure`
   if the machine is still in the same entry of that state.
5. At shutdown, the service stops in `beforeApplicationShutdown`, so
   that no completion starts a script after the database closes.

The `RecentReplies` store keeps the replies to the latest 256 accepted
requests with a request key, so a repeated MQTT delivery does not apply an event
twice. `servers/execution/runner/docs/state-machine-design.md` records
the design decisions and assumptions.

### Runner Interface

The `Runner` interface defines the contract for command executors:

```typescript
interface Runner {
  run(): Promise<boolean>;
  checkLogs(): Map<string, string>;
}
```

### Configuration

The service reads its configuration from a YAML file
(see `config/runner.yaml.sample`) with these settings:

| Setting     | Purpose                                      |
| :---------- | :------------------------------------------- |
| `port`      | HTTP server port                             |
| `location`  | Base directory for executable scripts        |
| `commands`  | Allowlist of permitted command names         |
| `database`  | Optional SQLite file for the command history |
| `mqtt`      | Optional MQTT broker `url`, base `topic`, credentials and `protocolVersion` |

The optional `state-machine.yaml` file in the `location` directory
holds the [state machine](#state-machine) of the digital twin.

## Security Considerations

The runner only executes commands that are listed in the configuration
file. A request for any other command is recorded as `invalid` and not
run, which prevents arbitrary command execution. The same allowlist
applies to MQTT requests; the broker's access control decides who may
publish to the request topics. The state machine runs only permitted
commands, and its state names can not be paths.
