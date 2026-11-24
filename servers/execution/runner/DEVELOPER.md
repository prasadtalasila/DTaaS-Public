# Developer Instructions

This microservice needs a configuration file and a directory of scripts.
Please see [README](./README.md) for this information.

## Configure

The `config` directory has two sample configuration files:

- `runner.yaml.sample` is the template for running your own scripts.
  The `location` is relative to the configuration file, so
  `yarn start --config config/runner.yaml` looks for the scripts in
  `config/scripts`.
- `runner.test.yaml.sample` runs the test scripts in `test/data/scripts`.

Copy a sample and start the runner with it:

```bash
cp config/runner.test.yaml.sample config/runner.test.yaml
yarn build
yarn start --config config/runner.test.yaml
```

Only the `*.sample` files in `config` are tracked by git.

The `test/data/scripts` directory has a bash script and a PowerShell
(`.ps1`) script for each test command, so that `yarn start` and
`yarn test` work on both Linux and Windows. The tests copy the test
configuration and these scripts into the runner directory before they
run and delete them afterwards. The _loop_ and _ignore-term_ scripts
run until they are stopped, for the tests of stopping a script;
_ignore-term_ ignores `SIGTERM`, so on Linux only `SIGKILL` after the
grace period ends it. They loop on short sleeps, so that no child
process holds their output open long after a stop.

The _print-context_ script prints the runner variables that it gets,
and _raise-event_ raises the event `done` through `RUNNER_URL` and
prints the status code of the reply, for the tests of the
[script environment](README.md#script-environment). On Linux,
_raise-event_ needs `curl`; on Windows it uses `Invoke-RestMethod`.
_echo-input_ writes its stdin back, for the tests of command input, and
_fail_ exits with code 3, for those of a failed command.

The _busy_ script spins for about a second of CPU time, for the tests
of the [resources](README.md#resources) of a run. The POSIX version
reads `/proc/uptime` with the `read` builtin, so it starts no process
and runs on Linux only; the PowerShell version spins for three seconds,
as the sampler of a run is a second PowerShell that needs time to
start. The _spawn-busy_ script starts _busy_ as a child, or on Windows
a second PowerShell that spins for three seconds, and waits for it, for
the tests of the process tree. Neither script is in the test
configuration, as the tests start them by path.

The resource tests that run real scripts depend on the platform:
`test/integration/execa-runner.resources.spec.ts` runs its Linux case
on Linux and its Windows case on Windows, and
`test/integration/resources.tree.spec.ts` runs on both and is skipped
elsewhere, so CI runs the Linux cases. The parsers of both platforms,
the Linux discovery against a fake `/proc` in a temporary directory,
the tree totals and the samplers with fakes are tested everywhere.

The directory also has a `state-machine.yaml` for the _create_ and
_execute_ scripts, which `runner.test.yaml.sample` permits and names
with its `stateMachine` key. A `config/runner.test.yaml` copied from
an older sample stops the runner at startup, as it lacks the required
`id`, permits only _create_ or lists no peer `hospital-2`, which the
file's subscription names; copy the sample again. A copy with `peers`
at the top level, as before version 0.11.0, stops it too, with an
error that the key moved to `relationships.peers`. The file also
declares three parameters, for trying out the parameters requests, one
of them the `fidelity` of the
[fidelity pattern](STATE-MACHINE.md#pattern-fidelity), and
subscribes to the state `full` of the peer `hospital-2`, for trying out
[peer events](README.md#peer-events) with the `peerFull` request of
`api/dev.mqtt.http`. It declares no
[property](README.md#properties) and names no
[class](README.md#class-and-instance), so `GET /dt` shows
`"class": null`; `config/state-machine.yaml.sample` does both, and
subscribes by `relationship` where the test file names its peer by
`id`. The
[state machine design](docs/state-machine-design.md) explains the file
and the decisions behind it.

## Developer Commands

```bash
yarn install    # Install dependencies for the microservice
yarn syntax     # Analyze code for errors and style issues
yarn format     # Format .ts, .tsx, .css and .scss files with prettier
yarn graph      # Generate dependency graphs in the code
yarn build      # Compile TypeScript into the dist/ directory
yarn test       # Run tests
yarn test:unit  # Run only unit tests
yarn test:int   # Run only integration tests
yarn test:e2e   # Run only end-to-end tests
yarn test:broker # Run the MQTT 5 tests against the broker in MQTT_BROKER_URL
yarn test:nocov # Run the tests but do not report coverage
yarn test:watchAll # Watch changes in test/ and run the tests
yarn start      # Start the application
yarn clean      # Deletes "build", "node_modules", "coverage", "dist" and graph files
yarn check:final # Run syntax, format, graph, build and test together
```

### MQTT Tests

`yarn test` checks the MQTT API against an in-process
[aedes](https://github.com/moscajs/aedes) broker, which supports
MQTT 3.1.1 only. `yarn test:broker` checks the MQTT 5 features against
a real broker, such as a public one:

```bash
MQTT_BROKER_URL=mqtt://test.mosquitto.org:1883 yarn test:broker
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883 yarn test:broker
```

The tests use topics with a random part, so runs do not interfere on a
shared broker. The GitHub Actions workflow runs them against a
Mosquitto container.

`test/e2e/mqtt.peers.spec.ts` checks [peers](README.md#peers) against
aedes with two runners in one process: `startRunner` of
`test/e2e/mqtt.util.ts` takes a `prepare` hook that spies `getId` and
`getPeers`, so `hospital-1` lists `hospital-2` and each runner has its
own base topic on the same broker.

`test/e2e/peer-events.spec.ts` checks [peer events](README.md#peer-events)
on aedes with one runner, built from a state machine file by
`digitalTwin` of `test/e2e/fsm.util.ts`, and a plain MQTT client that
publishes the notices of the peer `hospital-2`, a will among them. The
unit tests replay the worked example of issue 16 on `PeerEvents`
(`test/unit/fsm.peer-events.spec.ts`), and `fsm.fixture.ts` lists
`hospital-2` as the peer of its configuration.

### Access Control Tests

The tests of [access control](README.md#access-control) generate their
Ed25519 keys at run time with `test/sign.util.ts`, which also signs
HTTP tokens and MQTT envelopes; no key file is committed. The end-to-end
tests start the runner from a configuration without `auth` and spy
`Config.access()` to return an `Access` of the test's principals, as
`test/e2e/mqtt.util.ts` spies `getMqtt`; the guard and the MQTT service
read it on every request. `test/e2e/auth.script.spec.ts` checks that a
state's script raises an event with `RUNNER_TOKEN`, so _raise-event_
always sends `Authorization: Bearer $RUNNER_TOKEN`.

To try a runner with access control by hand, write a key pair with the
demo's tool and list its public key under `auth` in
`config/runner.test.yaml`:

```bash
node demo/hospital/tools/keygen.mjs alice keys
```

It writes `keys/alice.key` (PKCS#8 PEM) and `keys/alice.pub`, and
prints the public key. [api/README.md](api/README.md#access-control)
tells how the request files sign with it.

### Signed Output Tests

The tests of [signed output](README.md#signed-output) also generate
their keys at run time, with `generateKeyPairSync('ed25519')`, and
write a key file only to a temporary directory. The unit fakes of
`Config` give `getSigner()`, a `Signer` without a key unless a test
passes one. Tests verify a JWS with `verifiedPayload(text, key, kid?)`
of `test/sign.util.ts`, which calls the runner's own `parseJws` and
`verifyJws` rather than a verifier of its own. The end-to-end helpers
unwrap what the runner sends with `unwrap(text, key?)` of
`test/e2e/jws.util.ts`, which parses plain JSON or a JWS, and with a
key takes only a JWS that the key signed; `nextNotification` and the
webhook receiver keep the payload as received in `raw`.
`test/e2e/signed.spec.ts` spies `Config.getSigner()` and verifies with
the `publicKey` of `GET /dt`;
`test/e2e/mqtt.peers.signed.spec.ts` has one runner follow another
that signs, as a peer of 13 does.

### Script User Tests

The checks of the [script user](README.md#script-user) run everywhere
on fakes: `test/unit/scripts.*.spec.ts` pass the texts of
`/etc/passwd`, `/etc/group` and `/proc/self/status`, and a fake file
system of `test/unit/scripts.fake-fs.ts` with modes, owners and links.
`test/integration/config.scripts.spec.ts` loads a `runner.yaml` with a
`scripts` section after replacing the members of `HOST` in
`src/scripts/separation.ts` with `jest.spyOn` and
`jest.replaceProperty`, and `test/integration/scripts.host.spec.ts`
tries the real `HOST` and file system on a temporary directory. The
unit fakes of `Config` give `getScriptUser()`, `undefined` unless a
test passes a user.

`test/e2e/script-user.spec.ts` runs the build as a second account for
real. It needs root for `setpriv`, so it runs only on Linux with
`CI=true`, a `sudo -n true` that succeeds and a built `dist/`, as in
the `test-runner` job of `.github/workflows/runner.yml`; it is skipped
on Windows and on any other Linux host, WSL included. It creates the
account `dt-script-test` unless it exists, lays out a runner in the
temporary directory of `os.tmpdir()`, `/tmp/runner-18-*` in CI, which
the script account must be able to search, and starts
`dist/src/main.js` with `sudo -n` and the `setpriv` line of
[PRIVILEGE-SETUP.md](PRIVILEGE-SETUP.md), as the test's own account
with the three capabilities.

To run it in WSL or on another Linux host, work in a copy on the Linux
file system, as `/mnt/c` has no real modes, and let `sudo` cache your
password first, so that `sudo -n` succeeds for a few minutes:

```bash
yarn install && yarn build
sudo -v
CI=true NODE_OPTIONS=--experimental-vm-modules npx jest --coverage=false test/e2e/script-user
```

The test leaves the account `dt-script-test` behind; remove it with
`sudo userdel dt-script-test`.

### Snapshot Code and Tests

Saving and reinstating (issue 23) live in `src/snapshot/`, with the
routes in `src/snapshot.controller.ts`. Before changing them:

- `Pause` (`pause.ts`) is a plain object that `FsmService` owns, and
  `Snapshots` (`snapshots.ts`) one that `DescriptorService` owns, as
  `Peers` is. A new injectable would push a constructor of the MQTT
  handler or of `DescriptorService` to four parameters. `Snapshots`
  runs the save script through `fsm.manager`, which is public for it.
- `FsmService.run` awaits `pause.hold(...)` for the outcome of a
  script, and `PeerEventsService` passes the events of peers through
  `pause.defer(...)`. Both go into one queue, which drains in order
  when the save ends; anything that a save must hold goes through it
  too. `src/fsm/fsm.service.ts` is at 247 lines: move code out before
  adding.
- `Snapshots.copyDatabase` copies the database with `VACUUM INTO`,
  reads the last `seq` and then the machine, in one synchronous step.
  Do not put an `await` between them, or a row can come between the
  copy and its manifest.
- `Snapshots.onStop` takes the shutdown after a save with `stop`;
  `main.ts` gives `app.close`. Without a listener nothing shuts down,
  so a test gives its own, which closes the app and resolves a promise.
- `openTwin` (`reinstate.ts`) is the one place that opens the database
  and resumes the machine, with or without `--reinstate`. `main.ts`
  and `startStoredRunner` of `test/e2e/util.ts` both call it, so the
  tests start a twin as the runner does. A refusal is a thrown `Error`;
  `main.ts` catches it, as it catches an invalid `runner.yaml` and a
  misuse of the flags, prints its message with `startFailure`
  (`src/config/start-failure.ts`) and exits with 1.
- `placement.ts` adds its lines to the problems of `Config.loadConfig`;
  `configuration.service.ts` is at 247 lines.

The end-to-end tests build a twin in a temporary directory:
`snapshotTwin` of `test/e2e/snapshot.util.ts` writes a class whose
`work` waits for the file `go` and whose `save-ward` waits for the file
`release`, so a test holds a save open with `touch`, asks the routes
during it, and then releases it. `reinstateTwin` of
`test/e2e/reinstate.util.ts` writes one with a restore script. Each
script has a shell and a PowerShell version. The unit tests of the
save use the fake manager of `test/unit/snapshot.fixture.ts`. The test
of mode `0700` is skipped on Windows, and `test/e2e/dist.spec.ts` runs
the build with `--reinstate` on a directory that is no snapshot.

### What-If Code and Tests

What-ifs (issue 24) live in `src/whatif/`, with the routes in
`src/whatif.controller.ts` and the replies in `src/dto/whatif.dto.ts`.
[WHAT-IF.md](WHAT-IF.md) is the user guide, and D55 to D58 of the
[design](docs/state-machine-design.md) the reasons. Before changing
them:

- `WhatIfs` (`whatifs.ts`, 215 lines) is a plain object that
  `DescriptorService` owns, as `Snapshots` is. The notifier hears the
  end of each run through `onEnd`. `DescriptorService.onModuleInit`
  calls `clearLeftovers`, and its `beforeApplicationShutdown` calls
  `stop`.
- The copy is a save: `Snapshots.saveInto` with `record: false` and a
  `whatIf` hook that writes the four documents of `present.ts` before
  the save script runs. The save run is stored with mode
  `what-if-copy`, the run of the command with `what-if`; `ACTIVE` of
  `queue.history.ts` (`mode IS NULL`) keeps both out of `GET /`, the
  state document and the state notifications.
- `asked` holds the id of each what-if from the request until its copy
  is gone, so a request during the copy joins; `running` holds the end
  of each run. `begin` checks `isRunning` before the save and again
  after it, and nothing is awaited from the second check to
  `newCommand`: keep it so, or a live run can start between them.
- `refuseOtherMode` in `src/command-result.ts` keeps live runs and
  what-ifs of one command apart in `ExecaManager`.
- The environment comes from `FsmService.environment(name, copy)`;
  `apiVariables` and `withoutApi` of `src/fsm/script-context.ts` leave
  out `RUNNER_URL` and `RUNNER_TOKEN`. `fsm.service.ts` is at 248
  lines and `queue.service.ts` at 246: move code out before adding.

The end-to-end tests build a twin with `whatIfTwin` of
`test/e2e/whatif.util.ts`, turn access control on with
`controlAccess`, and sign with `call`. `forecast` copies its copy and
its environment into the twin's directory and prints its mode and
input; `forecast-slow` waits for the file `go`, and `save-slow` for
`release`, so a test holds a run or a copy open. Each script has a
shell and a PowerShell version; the PowerShell ones have not run on
Windows. The tests are split by subject: `whatif.spec.ts` (the run,
the copy, an unchanged twin), `whatif.run.spec.ts` (joins, stops,
modes, roles), `whatif.copy.spec.ts` (during the copy, and the save's
refusals), `whatif.refuse.spec.ts` and `whatif.notify.spec.ts`.

### Replay Code and Tests

Replays (issue 25) have two parts. The replay twin is a mode of the
runner, in `src/replay/`; the tools `runner-replay` and
`runner-compare` are in `src/tools/`, outside the Nest application,
which they start as a child process. [REPLAY.md](REPLAY.md) is the
user guide, and D59 to D63 of the [design](docs/state-machine-design.md)
the reasons. Before changing them:

- The mode is one object, `ReplayMode` of `replay-mode.ts`, that
  `Config.replay()` returns, `undefined` in a twin. Each place that
  differs asks it: `getMqtt()`, `getNotify()` and `getSnapshots()`
  return `undefined`, so a replay twin saves nothing,
  `listenHost` of `main.ts` gives `127.0.0.1`, `AccessGuard` lets an
  `operator` call every route and parses the headers with
  `replayOrigin` of `origin.ts`, and `RunnerContext.load` adds the
  script variables. `beginReplay` of `src/snapshot/reinstate.ts` checks
  `whatIf.replay` and starts the clock of `at`.
- `stamp.ts` decides which rows get `origin`: the input kinds, written
  in the context of a request, without a `source`.
- `src/tools/replay.ts` and `compare.ts` are the two `bin` entries and
  the only files that parse the command line; jest leaves them out of
  coverage, as `main.ts`. The flow is in `replay-run.ts` and
  `compare-run.ts`. Every function there has at most 3 parameters and
  a complexity of 4 at most; keep them so, as Qlty fails a function at 5.
- `ToolError` carries the exit code: 2 for a refusal, 1 for a failure.
  The tools write with `say` and `complain` of `tool-error.ts`, as
  eslint bans `console`.
- The tools reuse the runner's code by import: `readManifest`,
  `readConfig`, `Timeline.rows` on a read-only `DatabaseSync`,
  `Signer`, `bodyHash`, `snapshotName` and `whatIfSchema`. Change those
  with the tools in mind.
- `replay-run.ts` copies `scripts/` of the start into `out/scripts`,
  and `ReplayTwin.start` spawns the runner with `out` as its working
  directory, so that a script that writes beside itself never changes
  the snapshot.
- `shutdown.ts` stops the scripts of the replay twin with
  `POST /stop` before it ends the runner, on the normal end and on
  `SIGINT` and `SIGTERM`, as a runner that shuts down waits for its
  scripts. It waits 10 s at most for the answer, and a second signal
  during the shutdown kills the replay twin.

The tests of `src/replay/` are `test/unit/replay.*.spec.ts`,
`test/integration/config.replay.spec.ts`,
`test/integration/queue.timeline.replay.spec.ts` and
`test/e2e/replay-twin*.spec.ts`. Those of the tools are
`test/unit/tools.*.spec.ts`, `test/integration/tools.replay*.spec.ts`,
`test/e2e/replay.spec.ts`, `test/e2e/replay.refuse.spec.ts` and
`test/e2e/dist.spec.ts`. The integration and end-to-end tests of the
tools run the built `dist/src/main.js` and `dist/src/tools/*.js`, and
are skipped without them: run `yarn build` first. The twins of
`test/e2e/replay.util.ts` have access control, as a replay from
`inputs` needs it. `test/e2e/commander.spec.ts` fails when jest runs it
alone with extra flags, as commander then parses the flags of jest; in
the full suite it passes.

### On Filenames in Tests

The jest and nestjs combination can not detect tests in files
with _config_ in their names. Hence, the config word has been
replaced with _options_ in the names of test files.

## NPM package

The package version lives in `package.json` only; the code does not
repeat it and the CLI has no `--version` flag.

### Github Package Registry

The Github actions workflow of
[runner](../../../.github/workflows/runner.yml) publishes the **runner**
into
[packages](https://github.com/orgs/INTO-CPS-Association/packages?repo_name=DTaaS).

### Verdaccio - Local Package Registry

Use the instructions in [publish npm
package](../../../docs/developer/contributions/npm-packages.md) for help
with publishing **runner npm package**.

Application of the advice given on that page for **runner** will require
running the following commands.

### Publish

```bash
yarn install
yarn build #the dist/ directory is needed for publishing step
yarn publish --no-git-tag-version #increments version and publishes to registry
yarn publish #increments version, publishes to registry and adds a git tag
```

### Unpublish

```bash
npm unpublish  --registry http://localhost:4873/ @into-cps-association/runner@0.0.2
```

## Access the service

## Service Endpoint

The URL endpoint for this microservice is located at: `localhost:<port>`

The `api` directory has request files for the HTTP API
(`api/dev.api.http`) and the MQTT API (`api/dev.mqtt.http`).
[api/README.md](api/README.md) lists the VS Code extensions they need,
and explains how to start the runner and a broker and send the
requests from VS Code or the command line.

## Use in Docker Environment

The `compose.runner.dev.yml` file builds the runner image from the source
code and runs it with `config/runner.test.yaml` and the test scripts.

**NOTE**: the docker compose file is located in the
`servers/execution/runner` directory.

```bash
cp config/runner.test.yaml.sample config/runner.test.yaml
docker compose -f compose.runner.dev.yml up -d --build
docker compose -f compose.runner.dev.yml down
```

See [DOCKER.md](./DOCKER.md) for running the runner with your own scripts.

Please see [README](./README.md) for more information.
