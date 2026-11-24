# 25 Replay and Compare a Twin

- Status: in progress, on the branch `runner/25-replay`, version
  0.14.0. The shape of the tools was settled with the owner on
  2026-11-23; the Spec below says what was built.
- Depends on: [22](22-timeline.md) (the inputs), [23](23-snapshot.md)
  (the snapshots), [24](24-what-if.md) (`DT_MODE`)
- PR: none yet
- Research note: the Test-FDT of the Fluid Digital Twins paper, in
  [integrated-simulations.md](../integrated-simulations.md#a-twin-beside-itself).
  The owner split this from 24 on 2026-11-23.

## Spec

An operator wants to ask of a twin: "What would it have done last
night under scope `multi`?" The answer needs the state machine and
every script of the class to run again, from where the twin was, on
what it was told. Two tools of the package do that, from snapshots
alone. Neither contacts the twin, and the runner of the twin starts
nothing (S1 and S2 stand).

```yaml
# hospital-1 again, from its first save, under scope multi
start: hospital-1/snapshots/20261124T183856368Z
inputs: hospital-1/snapshots/20261124T183906126Z
out: replays/scope-multi
speed: 2
settle: 2
set:
  parameters:
    scope: multi
```

```bash
runner-replay run/runner-replay.yaml
runner-compare run/hospital-1/snapshots/20261124T183906126Z run/replays/scope-multi
```

The file is that of the chapter "Replay" of the
[hospital demo](../../demo/hospital/README.md#replay), in `run/`.
[REPLAY.md](../../REPLAY.md) is the guide for operators.

A replay is described in a file, `runner-replay.yaml` by default, so
that it can be read, kept and run again. Without an argument the
tool reads the file of that name in the current directory. The owner
asked on 2026-11-24 for fewer options than the ten flags of the first
plan; the tool now takes the file and one flag.

The formats that the tools read and write, a scenario file, the
`replay.json` that a replay leaves and the list that a comparison
prints, are shown as built in [REPLAY.md](../../REPLAY.md) and in
[save-reinstate-what-if.md](../save-reinstate-what-if.md), with the
reasons for the name "replay twin".

They are two more commands of the package, beside `runner`:
`npm install -g @into-cps-association/runner` puts all three on the
path, through the `bin` of `package.json`.

### Two snapshots

A replay of a period needs a snapshot from before it and one from
after it:

- the **start** is where the replay twin begins: its database, its
  scripts and what its scripts kept;
- the **inputs** is any later snapshot of the same twin. Its
  `state.db` holds the timeline, and the rows after the `seq` of the
  start are what happened in between.

So an operator who wants to replay nights saves the twin each
evening and each morning.

### `runner-replay`

The keys of the file:

| Key      | Needed               | Meaning                                                                              |
| :------- | :------------------- | :----------------------------------------------------------------------------------- |
| `start`  | always               | The snapshot that the replay twin starts from                                        |
| `inputs` | unless `steps`       | A later snapshot of the same twin, whose timeline gives the inputs                   |
| `steps`  | in place of `inputs` | A list of inputs, each at a time: a scenario                                         |
| `out`    | always               | Where the replay twin lives; it must not exist                                       |
| `speed`  | no                   | Divide the gaps between the inputs by this number, above 0; `1` by default           |
| `until`  | no                   | Stop at the last input before this time; by default, at the last one                 |
| `settle` | no                   | Seconds to wait after the last input for the replay twin to be idle; `30` by default |
| `set`    | no                   | `parameters` and `properties` to set in the replay twin before the first input       |

Paths are relative to the file. Times are written as the names of
snapshots are: `YYYYMMDDTHHMMSSmmmZ`, in UTC, such as
`20261123T060000000Z`.

The tools take no other options but `--dry-run` of `runner-replay`,
which prints the inputs and their times and starts nothing, `--json`
of `runner-compare`, and `--help` and `--version` of both. A missing
or unknown key, a time in another form, `inputs` and `steps` together
or neither, a step with two inputs or before the start, and an `out`
that exists are refused with exit code 2 and the key, as
`✖ must be a time in the form YYYYMMDDTHHMMSSmmmZ → at steps[0].at`.

| Exit code | `runner-replay`                                    | `runner-compare`                  |
| :-------- | :------------------------------------------------- | :-------------------------------- |
| 0         | A replay or a dry run is done                      | The entries are the same          |
| 1         | The replay failed, such as a 5xx or no replay twin | The entries differ                |
| 2         | The file, the snapshots or a flag is refused       | An argument is neither, or a flag |

What it does:

1. It checks that both snapshots are of one twin, and that the class
   allows a replay twin (see below).
2. It writes a configuration for the replay twin into `out`, from the
   copy of `runner.yaml` in the start:

   | Key                             | In the replay twin                                              |
   | :------------------------------ | :-------------------------------------------------------------- |
   | `id`                            | the `id` of the twin, with `.replay`                            |
   | `port`                          | a free port of the host                                         |
   | `database`                      | a file in `out`                                                 |
   | `location`                      | `scripts`, a copy in `out` of the scripts of the start          |
   | `stateMachine`                  | the copy in the start                                           |
   | `parameters`                    | as in the copy, then `set.parameters`                           |
   | `relationships.peers`           | as in the copy, so that subscriptions bind; no peer is followed |
   | `mqtt`, `relationships.manager` | left out: a replay twin reaches nobody                          |
   | `auth`                          | one principal, `replay`, of role `operator`, with a new key     |
   | `scripts`, `snapshots`          | left out                                                        |
   | others, such as `stopGrace`     | as in the copy                                                  |

3. It starts a runner on that configuration, with
   `--reinstate <start> --what-if --time-scale <speed>`, in `out` as
   its working directory, its log in `out/runner.log`, and waits 30 s
   at most for `GET /health`. A script that writes beside itself or
   into its working directory writes into `out`, never into the
   snapshot, and two replays of one snapshot do not share a file.
4. If the script of the saved state was running at the save, it
   enters that state again. See [The first step](#the-first-step).
5. It writes `set.properties` with `PUT /properties`.
6. It sends each input to the replay twin, at its time after the start
   over the speed, signed with the key of step 2. A `4xx` counts as
   refused, and the replay goes on; a `5xx` ends it with exit code 1.
7. After the last input it waits until no script of the replay twin
   runs, for `settle` seconds at most, and stops a script that still
   runs with `POST /stop`, saying so on stderr. It stops the replay
   twin, writes `replay.json` and prints
   `Sent 23 inputs, 3 refused; the replay is in <out>`.

`out` then holds `runner.yaml`, `runner.log`, `replay.json`,
`scripts/`, what the scripts wrote, and `state.db`, the database of
the replay twin, with the timeline of what it did. `replay.json` has
`format`, `of`, `start` and `inputs` as absolute paths (`inputs` is
`null` for a scenario), `from` and `until` (each a `seq` and a
`time`), `speed`, `set` (`{}` without it), `sent`, `refused` and
`firstStep`, the `seq` of the entry that the first step made, or
`null`. On `SIGINT` or `SIGTERM` the tool stops the scripts
of the replay twin and the replay twin, and exits with 130 or 143. It
waits 10 s at most for the answer to `POST /stop`, and a second signal
during the shutdown kills the replay twin at once.

What is sent, and what is not:

| Row of the timeline                                                    | Sent to the replay twin as                |
| :--------------------------------------------------------------------- | :---------------------------------------- |
| `transition`                                                           | `POST /fsm/transition`                    |
| `event` of a client                                                    | `POST /fsm/event`                         |
| `command`, with its input                                              | `POST /`                                  |
| `parameters`, `peers`                                                  | `PUT /parameters`, `PUT /peers`           |
| `properties` that a `sensor` or a `client` wrote                       | `PUT /properties`                         |
| `notice` of a peer                                                     | `PUT /peers/<id>/notice`                  |
| `event` or `properties` of a script, `entry`, `exit`, `sent`, `whatif` | nothing: the replay twin does these again |

A `command` row whose request key got the stored reply of an earlier
run has `stored: true` beside that `run`; it is not sent, and
`--dry-run` shows it as skipped. An input that is late is sent at
once. `out` is made with mode `0700`, as it holds the inputs of
commands.

A replay from `inputs` needs a twin with access control: its
`runner.yaml` lists `auth.principals`. Without them every row has
`by: null`, and the timeline does not tell what a script wrote from
what a client or a sensor sent, so the tool refuses such inputs. A
file with `steps` works for any twin.

The tool signs every request as one principal, `replay`, of role
`operator`, which in a replay twin may call every route. Each request
also names the principal and the `seq` that the row had in the twin,
in the headers `Replay-By` and `Replay-Seq`, and the replay twin
records both in its own row as `origin`. A notice, whose row has no
principal, has `Replay-Seq` alone. The replay
twin would run the same without them. They are there for the
comparison, which lines two timelines up by that `seq`, and for a
reader, who sees `manager-1` where the twin's timeline did.

A replay twin is a reinstated twin with something changed: a
parameter or a property, under `set`. A value of a property that a script of
the replay twin writes later replaces it, as in any twin.

A replay shows what the twin would have decided, given what it was
told. It does not show what the world would have done: the beds that
were free last night were free under the old scope.

### A scenario

With `steps` in place of `inputs`, the file is a scenario of a coming
period. Each step has `at`, a time after that of the start snapshot,
and one input:

```yaml
start: hospital-1/snapshots/20261124T183856368Z
out: replays/neighbour-down
speed: 60
settle: 2
steps:
  - at: 20261124T184000000Z
    notice:
      peer: hospital-2
      kind: presence
      data:
        online: false
  - at: 20261124T184100000Z
    command:
      name: admit
      input:
        patient: p-9
        ward: cardiology
```

A step holds exactly one of `transition` (a state), `event` (an
event), `command` (`name` and `input`), `parameters`, `properties`,
`peers` and `notice` (`peer`, `kind` and `data`), and is sent as the
row of that kind is. The steps are sent in the order of their `at`,
with no `Replay-` header.

### The replay twin

A replay twin is a runner started with `--reinstate` and `--what-if`.
The operator may also start one by hand in that way. The mode
changes nine things:

- **It listens on `127.0.0.1` only**, as its scripts act for real.
- **It follows no peer and notifies nobody**, whatever its
  configuration lists.
- **It saves nothing.** It has no snapshot directory, whatever its
  configuration lists: a save and a what-if get `409`
  `no snapshot directory`.
- **It says what it is.** `GET /dt` shows
  `replay: {of: "hospital-1", time: "2026-11-24T18:38:56.368Z"}`, and
  `null` in any other runner. It logs once: `A replay twin of
hospital-1 at 2026-11-24T18:38:56.368Z, at 60 times the speed of the
clock: it connects to no MQTT broker, follows no peer and sends no
notification`.
- **Its scripts are told.** They get `DT_MODE=what-if`, `DT_REPLAY_OF`
  and `DT_TIME_SCALE`. The restore script has given them their own
  copy of the files, so a script that follows the mode acts on the
  copy and not on the hospital.
- **Its class must allow it.** `whatIf.replay: true` in the class.
  Without it the start is refused: a class that was not written with
  the mode in mind would act on the real hospital from a second
  process. `whatIf` with `replay: true` and no `commands` needs no
  `snapshot.save`.
- **It takes the notices of peers on a route.** A runner learns of
  its peers from their notices, which arrive on topics that it
  subscribes to. They raise the events of the subscriptions, and they
  are what `GET /peers` shows to the scripts. A replay twin follows no
  peer: hospital-2 as it is now is not hospital-2 as it was last
  night. So the recorded notices are handed to it, with
  `PUT /peers/<id>/notice`, which only a runner in this mode accepts,
  from an `operator`; any other runner answers `404` to every caller.
  The reply is `GET /peers`, and the notice raises the events of the
  subscriptions as over MQTT.
- **It starts knowing its peers.** It takes the last notice of each
  kind of each peer in the timeline up to the snapshot as known,
  without an event or a row, so `GET /peers` shows what the twin knew
  and a later notice raises an event only on a change.
- **It records where an input came from**: the principal and the
  `seq` of the twin, when a request names them, as `origin` on the
  rows of the input kinds written for that request. A malformed
  header gets `400`, after authentication, with a message that names
  the header and what it must be.

In a replay twin the role `operator` may call every route.
`--what-if` without `--reinstate`, and `--time-scale` without
`--what-if`, are refused; `--time-scale` takes a number above 0 and is
`1` without the flag.

### The first step

A reinstated twin waits in its saved state as `interrupted`
([23](23-snapshot.md)). For a replay that is right in one case and
wrong in another.

- **The script had ended.** The snapshot was taken at 22:00 with the
  hospital `closed`. The first input is the event `reopen` at 07:00.
  The replay twin enters `open`, its script starts, and the replay goes
  on as the night did.
- **The script was running.** The snapshot was taken at 22:00 with
  the hospital `open`, whose script samples the beds and raises
  `full` when none is free. The inputs are two admissions, at 22:10
  and 22:20, which take the last beds. In the twin, the script saw
  that and raised `full`. In the replay twin, no script is running, so
  nobody raises `full`, and it stays `open` to the end. The two
  timelines differ from the first row on, though nothing was changed.

So when the manifest says that the script was `running`, the tool
first asks the replay twin for a transition to the same state. The
script starts, as a new entry. The entry numbers of the replay twin
are then one above those of the twin, and the comparison goes by
state and source, not by entry number.

### Time

A replay keeps the meaning of time, at a scale. `speed: 60` plays an
hour in a minute, `1` plays at the speed of the clock, and `0.5`
takes twice as long. The replay twin gives the same number to its
scripts as `DT_TIME_SCALE`, to divide their own waits by, as a
convention like fidelity (17c). A script that ignores it samples at
its usual rate while the inputs arrive faster.

Each row of the timeline of a replay twin has, beside its real time,
`at`: the time that it stands for, the time of the snapshot plus the
time since the reinstate times the scale. The rows copied from the
snapshot have none. `at` and `origin` are new columns of the
timeline, which a database of an earlier version gains at the first
start.

### `runner-compare`

It takes two directories, each a snapshot or the output of a replay,
and reads the timeline in the database of each. It prints, for each
state entry, the time that it stands for, the state, what caused it
and who, side by side, and marks the first row where the two differ;
then the number of entries of each, with `the same` or the time of the
first difference, and the cpu seconds of the scripts of each side. It
has no row for the state at the end. It exits with 0 when the entries
are the same, and 1 when they differ. With `--json` it prints
`{a, b, rows, firstDifference, same}`.

- An entry is the same as another when its state and its cause are:
  a transition and who sent it, an event and who sent it (or
  `parameter`, `peer` or `script`), or the end of a script by its
  status. Entry numbers are not compared.
- Entries are lined up by the `seq` that the input which caused them
  had in the twin: its own in the twin, `origin.seq` in a replay twin.
  The entries that follow, which no transition or event of a client
  caused, are lined up by state and cause (a longest common
  subsequence), so that one extra or missing entry is one line with
  `-` on the other side.
- Each column is as wide as its longest cell.
- The entry of the first step, `firstStep`, is left out. A snapshot
  beside a replay counts its rows after the start up to its own
  `seq`; two snapshots, or two replays, are compared whole.

### Roles and API changes

The tools are run by whoever has a shell on a host with the
snapshots: the operator. They need no principal of the twin.

| Kind               | Change                                                                                  |
| :----------------- | :-------------------------------------------------------------------------------------- |
| Package            | `runner-replay` and `runner-compare`                                                    |
| Command line       | `runner --what-if` and `--time-scale <factor>`, both only with `--reinstate`            |
| Route              | `PUT /peers/<id>/notice`, in a runner started with `--what-if` only; `404` in any other |
| Request            | In that mode, `Replay-By` and `Replay-Seq`: the principal and `seq` of the first one    |
| Roles              | In that mode, `operator` may call every route; `notice` is for `operator` alone         |
| Reply              | `GET /dt`: `replay`, `null` for a twin                                                  |
| State machine file | `whatIf.replay`, a boolean                                                              |
| Script variables   | `DT_REPLAY_OF` and `DT_TIME_SCALE`, in a replay twin                                    |
| Timeline           | `at`, and `origin`: the first principal and `seq`, on the rows of a replay twin         |

### Not in this issue

- Following a twin as it runs, the parallel kind of the paper. It
  needs the timeline of the live twin, where everything else here
  needs none.
- A route that starts a replay twin, and any process that the runner
  of a twin starts for a caller.
- A simulated clock in the runner: time is scaled, not stepped.
- Replay twins of replay twins.
- Leaving personal data out of a replay.

### Decided

| Question                    | Decision of 2026-11-23                                                                                            |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| Who makes a replay twin     | The operator, with a tool; the runner of the twin starts none                                                     |
| Where the inputs come from  | A later snapshot, not the live twin                                                                               |
| What the tools talk to      | Snapshot directories; no URL of the twin and no key of it                                                         |
| The parallel kind           | Not now                                                                                                           |
| How time passes             | Time keeps its meaning, at a scale that the caller gives and the scripts get                                      |
| Its own issue               | Yes, apart from 24                                                                                                |
| The name of the second twin | Replay twin                                                                                                       |
| The options of the tools    | One file that describes a replay; almost no flags (2026-11-24)                                                    |
| Times in that file          | As the names of snapshots: `YYYYMMDDTHHMMSSmmmZ`, in UTC (2026-11-24)                                             |
| After the last input        | The tool waits `settle` seconds for the replay twin to be idle                                                    |
| The first step              | The tool enters the saved state again when its script was running                                                 |
| The key of a replay twin    | The tool makes a fresh one for each run, and is its only principal                                                |
| Who the first caller was    | Each replayed request names the principal and the `seq` that it had in the twin, and the replay twin records them |

## Plan

As built:

1. The mode, `src/replay/` (new): `replay-mode.ts` (`ReplayMode`, its
   `at`, its variables, and `listenHost`), `origin.ts` (the headers),
   `stamp.ts` (which rows get `origin`), `notice.ts` (the body of the
   notice route). `src/config/commander.ts`: `--what-if` and
   `--time-scale`; `src/config/configuration.service.ts`:
   `Config.replay()`, and no MQTT or webhook in the mode;
   `src/config/parse.ts` (new), moved out of it. `src/main.ts`: the
   host. `src/snapshot/reinstate.ts`: `beginReplay`. `src/fsm/class.ts`:
   `whatIf.replay`. `src/fsm/script-context.ts`: `DT_REPLAY_OF` and
   `DT_TIME_SCALE`. `src/dto/descriptor.dto.ts`: `replay`.
2. `src/peers/peers.controller.ts`: the notice route;
   `src/auth/roles.ts`: the route `notice`; `src/auth/access.guard.ts`:
   the `404`, the wider `operator` and the headers. The timeline:
   `src/queue.timeline.ts`, `src/queue.schema.ts` and
   `src/dto/timeline.dto.ts`, with `at` and `origin`.
3. `src/tools/` (new), with two more `bin` entries in `package.json`:
   - `replay.ts` and `compare.ts`: the commands;
   - `replay-file.ts`, `replay-plan.ts`, `snapshot-dir.ts`, `times.ts`:
     the file, the snapshots and the times;
   - `inputs.ts`: the inputs after a `seq` in a database, or of a
     scenario;
   - `replay-config.ts`, `replay-twin.ts`, `twin-client.ts`,
     `shutdown.ts`: the configuration, the key, the start, the signed
     requests and the stop;
   - `send.ts`, `replay-run.ts`: the first step, the sending at the
     times over the speed, `settle` and `replay.json`;
   - `entries.ts`, `align.ts`, `listing.ts`, `compare-run.ts`: the
     comparison;
   - `tool-error.ts`: the exit codes.
4. `demo/hospital`: `whatIf.replay`, scripts that keep their own beds
   in a replay twin and divide their samples by `DT_TIME_SCALE`, two
   snapshots in the story, and the chapter "Replay" under scope
   `multi`, with `tools/replay-file.mjs`.
5. Documents: [REPLAY.md](../../REPLAY.md) (new), `README.md`,
   `WHAT-IF.md`, `STATE-MACHINE.md`, `CLASS-INSTANCE-INTERFACE.md`,
   `SECURITY-MODEL.md`, `PRIVILEGE-SETUP.md`, `DEVELOPER.md`,
   `api/API.md`, `api/dev.api.http`, D59 to D63 in
   `docs/state-machine-design.md`, and the summary page
   [save-reinstate-what-if.md](../save-reinstate-what-if.md).

## Tasks

- [x] `--what-if` is refused without `--reinstate` and without
      `whatIf.replay`; a replay twin shows `replay` in `/dt`, gives its
      scripts the three variables, and takes a notice on the route,
      which any other runner answers with `404`. Check:
      `test/e2e/replay-twin.spec.ts`.
- [x] The inputs of a stretch of a timeline are those that entered
      the twin, in their order, and not what scripts raised. Check:
      `test/unit/tools.inputs.spec.ts`.
- [x] The configuration of a replay twin reaches nobody, keeps the
      instance values, applies each change, and lists one principal.
      Check: `test/unit/tools.replay-twin.spec.ts`.
- [x] A replay with no change gives a timeline that `runner-compare`
      finds equal in its entries, from a snapshot whose script had
      ended and from one whose script was running; with a change it
      marks the first difference. Check: `test/e2e/replay.spec.ts`.
- [x] The gaps between the inputs are those of the twin over the
      speed, and each row has its `at`. Check:
      `test/unit/tools.replay.spec.ts` (the gaps) and
      `test/e2e/replay.spec.ts` (`at`).
- [x] A file with `steps` feeds a replay twin, and a file with a
      missing or unknown key is refused with its name. Check:
      `test/e2e/replay.spec.ts` (`steps`) and
      `test/e2e/replay.refuse.spec.ts` (each refusal).
- [x] The package installs the three commands. Check:
      `test/e2e/dist.spec.ts`.
- [x] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [x] The hospital demo replays its story under scope `multi`, and the
      Linux recording shows it. Check: `node demo/hospital/tools/record.mjs`
      and `node demo/hospital/tools/check-cast.mjs`.
- [x] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

What the plan did not foresee:

- **A replay from a twin without access control can not be right.**
  Every row then has `by: null`, and a script's event reads `client`,
  so the timeline does not tell an input from what a script did. The
  tool first sent the events of scripts and dropped the properties of
  sensors; a review found it, and such a replay is now refused, while
  a scenario works for any twin.
- **A signal must stop the scripts, not only the runner.** A runner
  that shuts down waits for its scripts, and one killed leaves them
  running, acting for real. The tool calls `POST /stop` before it
  stops the replay twin, at the end and on `SIGINT` and `SIGTERM`.
- **The replay twin listened on every address.** Its port was found
  on `127.0.0.1`, but the runner listened on all interfaces. A runner
  started with `--what-if` now listens on `127.0.0.1` only.
- **The first step is an entry the twin does not have.** The tool took
  its `seq` from the last entry at first, not the first; `firstStep`
  in `replay.json` names it, so the comparison leaves it out.
- **An unchanged replay is the check of a replay.** In the demo it
  found the twin equal, entry by entry, before the changed one was
  read.
- **The demo found what the tests did not.** Its first runs showed
  seven faults: a repeated request key replayed as a new command, a
  Node warning for a late input, a listing whose columns ran into each
  other, entries paired by place after a missing one, a replay twin
  that did not know its peers, `out` readable by others, and unclear
  header messages. Each was fixed before the recording; see
  [What the Demo Showed](#what-the-demo-showed).

- **The replay twin ran the snapshot's own scripts.** Its `location`
  was `scripts/` of the start, and its working directory that of the
  tool, so a script that kept files beside itself wrote into the
  snapshot, and two replays of one snapshot shared them; the demo hid
  it with a branch on `DT_REPLAY_OF`. The final review found it: the
  tool now copies the scripts into `out` and starts the replay twin
  there, and the branch is gone. The same review found that a second
  signal left the replay twin running, and that `POST /stop` at the
  shutdown could wait for ever; both are fixed.

### What the Demo Showed

The chapter "Replay" of the hospital demo, run before the recording,
showed seven faults of the tools and the replay twin. Each was fixed,
and the Spec above states the rules:

- A `command` row was written also for a request whose key replayed a
  stored reply, and `runner-replay` sent it as a new command, which
  then ran twice. The row now has `stored: true`, and the tool skips
  it; `--dry-run` prints `skipped: the stored reply of run 3`. A row
  written by a runner before 0.14.0 has no mark, and is still sent.
- A late input gave `setTimeout` a negative delay, and Node printed a
  `TimeoutNegativeWarning`. A late input is now sent at once.
- The listing of `runner-compare` padded each side to 33 characters,
  so a long cell ran into the next column. The columns are now as wide
  as their longest cell.
- Entries that a parameter, a peer or a script caused had no key, so
  after one missing entry the rows of the two sides were paired by
  place. Blocks of one key are now lined up by their longest common
  sequence: the demo's missing restart is one row with `-`.
- A replay twin knew of a peer only what the notices after the start
  told it. It now starts knowing the last notice of each kind of each
  peer up to the save, without a row or an event.
- `out` was made with the default mode of the account; it is now
  `0700`.
- A malformed `Replay-By` or `Replay-Seq` got an unclear message; the
  message now names the header and what it must be.
