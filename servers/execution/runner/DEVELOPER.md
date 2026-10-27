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

The directory also has a `state-machine.yaml` for the _create_ and
_execute_ scripts, which `runner.test.yaml.sample` permits and names
with its `stateMachine` key. A `config/runner.test.yaml` copied from
an older sample stops the runner at startup, as it lacks the required
`id` or permits only _create_; copy the sample again. The file also
declares two parameters, for trying out the parameters requests. The
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
yarn test:e2e   # Run only end-to-end tests
yarn test:broker # Run the MQTT 5 tests against the broker in MQTT_BROKER_URL
yarn test:nocov # Run the tests but do not report coverage
yarn test:watchAll # Watch changes in test/ and run the tests
yarn start      # Start the application
yarn clean      # Deletes "build", "node_modules", "coverage", "dist" and graph files
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
passes one. The end-to-end helpers unwrap what the runner sends with
`unwrap(text, key?)` of `test/e2e/jws.util.ts`, which parses plain
JSON or decodes a JWS, and with a key takes only a JWS that the key
signed; `nextNotification` and the webhook receiver keep the payload
as received in `raw`. `test/e2e/signed.spec.ts` spies
`Config.getSigner()` and verifies with the `publicKey` of `GET /dt`.

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

Use the instructions in
[publish npm package](../../../docs/developer/npm-packages.md) for help
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
