# Replay Guide

This guide is for operators of digital twins (DTs) and for the
authors of the classes that they run. It explains what a replay is,
which snapshots it needs, how the replay file is written and run, what
a replay leaves behind, how two timelines are compared, and what a
class must do to allow a replay. The design is in
[docs/state-machine-design.md](docs/state-machine-design.md), and the
issue in [docs/issues/25-replay.md](docs/issues/25-replay.md). Version
0.14.0 added replays.

## What a Replay Is

An operator wants to ask of a twin: "What would hospital-1 have done
last night with three beds a ward?" The answer needs the state machine
and every script of the class to run again, from where the twin was,
on what it was told. Two commands of the package do that from
snapshots alone:

- `runner-replay` starts a second runner, a **replay twin**, from one
  snapshot, with something changed, and sends it the inputs that the
  twin took after that snapshot, which a later snapshot holds;
- `runner-compare` lists the state entries of two timelines side by
  side, and marks the first row where they differ.

`npm install -g @into-cps-association/runner` puts both on the path,
beside `runner`.

A replay is:

- a run of the real class, with its state machine and every script;
- made by the operator at a shell, from snapshot directories; neither
  tool contacts the twin, and the runner of the twin starts nothing;
- run in time that keeps its meaning, at a scale.

A replay is not:

- a question that the Manager asks the twin; that is a
  [what-if](WHAT-IF.md);
- the world again: the replay twin decides as the twin would have, on
  what the twin was told. The patients who came last night came to a
  hospital with two beds a ward;
- a twin that follows a live twin as it runs.

## Two Snapshots

A replay of a period needs a snapshot from before it and one from
after it ([saving](README.md#saving-and-reinstating)):

| Snapshot | Taken             | Gives                                                                   |
| :------- | :---------------- | :---------------------------------------------------------------------- |
| `start`  | Before the period | Where the replay twin begins: its database, class, scripts and files    |
| `inputs` | After the period  | The timeline, whose rows after the `seq` of the start are what happened |

Both must be of one twin and one class, and the inputs must be later
than the start. So an operator who wants to replay nights saves the
twin each evening and each morning.

The inputs come from the timeline, which must tell what came from
outside from what a script did. Without access control every row has
`by: null`, so the tool refuses a replay from `inputs` of a twin whose
`runner.yaml` lists no `auth.principals`; a file with `steps` works
for any twin.

## The Replay File

A replay is described in a file, so that it can be read, kept and run
again. `runner-replay` reads `runner-replay.yaml` of the current
directory, or the file that it is given. The examples of this guide
are of a hospital twin, `hospital-1`, whose class has two states,
`open` and `full`, and a parameter `capacity`, the beds of each of its
two wards; the commands `admit` and `discharge` book and free a bed,
and raise `full` and `beds-free`. Its one peer, `hospital-2`, is a
neighbour, and a subscription of the class raises `neighbour-down`
when a neighbour goes offline. A file in `run/`, beside the snapshot
directory of the twin:

```yaml
# hospital-1 again, from its first save, with three beds a ward
start: hospital-1/snapshots/20261124T222403208Z
inputs: hospital-1/snapshots/20261124T222416431Z
out: replays/capacity-3
speed: 2
settle: 2
set:
  parameters:
    capacity: 3
```

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
`20261123T060000000Z`. A missing or unknown key, a time in another
form, `inputs` and `steps` together, or an `out` that exists is
refused with exit code 2 and the key:

```text
Error: Invalid replay file .../run/bad.yaml:
✖ must be a time in the form YYYYMMDDTHHMMSSmmmZ
  → at steps[1].at
```

`set.parameters` goes into the configuration of the replay twin, as
the values of the instance; `set.properties` is written with
`PUT /properties` once the replay twin is up.

### What Is Sent

The rows of the timeline of `inputs` after the `seq` of the start,
up to the `seq` of `inputs` and before `until`, are sent in their
order:

| Row of the timeline                                                    | Sent to the replay twin as                |
| :--------------------------------------------------------------------- | :---------------------------------------- |
| `transition`                                                           | `POST /fsm/transition`                    |
| `event` of a client                                                    | `POST /fsm/event`                         |
| `command`, with its input                                              | `POST /`                                  |
| `parameters`, `peers`                                                  | `PUT /parameters`, `PUT /peers`           |
| `properties` that a `sensor` or a `client` wrote                       | `PUT /properties`                         |
| `notice` of a peer                                                     | `PUT /peers/<id>/notice`                  |
| `event` or `properties` of a script, `entry`, `exit`, `sent`, `whatif` | nothing: the replay twin does these again |

`stop`, `snapshot`, `start` and `shutdown` rows are not sent either,
nor a `command` row marked `stored: true`: the twin answered that
request from the stored reply of an earlier request with the same
`Idempotency-Key`, and ran nothing. Such a row of a runner before
0.14.0 has no mark, so it is sent, and the command runs again in the
replay twin. An input that the replay twin refuses with a `4xx` is
counted as refused and the replay goes on; a `5xx` ends it with exit
code 1. An input that is late, as the one before took long, is sent
at once.

### A Scenario

With `steps` in place of `inputs`, the file is a scenario of a coming
period. Each step has `at`, a time after that of the start, and
exactly one of `transition` (a state), `event` (an event),
`command` (`name` and `input`), `parameters`, `properties`, `peers`
and `notice` (`peer`, `kind` and `data`), and is sent as the row of
that kind is. A scenario of two admissions on the first snapshot:

```yaml
start: hospital-1/snapshots/20261124T222403208Z
out: replays/rush
speed: 60
settle: 2
steps:
  - at: 20261124T222500000Z
    command:
      name: admit
      input:
        patient: p-9
        ward: cardiology
  - at: 20261124T222600000Z
    command:
      name: admit
      input:
        patient: p-10
        ward: cardiology
```

### The Dry Run

`runner-replay --dry-run` checks the file and the snapshots, prints
each input with its time, its offset after the start over the speed,
its kind, who sent it, and the request, and starts nothing. Of the
scenario above:

```text
20261124T222500000Z +0.947s command - POST / {"name":"admit","input":{"patient":"p-9","ward":"cardiology"}}
20261124T222600000Z +1.947s command - POST / {"name":"admit","input":{"patient":"p-10","ward":"cardiology"}}
```

And of the replay file above, where the second `admit` of `p-1`
repeated a request key:

```text
20261124T222404376Z +0.584s command alice POST / {"name":"admit","input":{"patient":"p-1","ward":"cardiology"}}
20261124T222405544Z +1.168s command alice POST / {"name":"admit","input":{"patient":"p-1","ward":"cardiology"}} skipped: the stored reply of run 3
20261124T222406633Z +1.712s command manager-1 POST / {"name":"admit","input":{"patient":"p-2","ward":"cardiology"}}
20261124T222407806Z +2.299s command manager-1 POST / {"name":"admit","input":{"patient":"p-3","ward":"surgery"}}
20261124T222408965Z +2.878s command manager-1 POST / {"name":"admit","input":{"patient":"p-4","ward":"surgery"}}
20261124T222414158Z +5.475s command manager-1 POST / {"name":"discharge","input":{"patient":"p-2"}}
```

## Running a Replay

```bash
runner-replay run/runner-replay.yaml
```

1. The tool checks that both snapshots are of one twin, that the
   inputs are later, and that the class has `whatIf.replay: true`.
2. It writes `runner.yaml` of the replay twin into `out`, from the
   copy in the start (below), with a key pair made for this run, and
   copies `scripts/` of the start into `out/scripts`.
3. It starts `runner -c <out>/runner.yaml --reinstate <start>
--what-if --time-scale <speed>` in `out` as its working directory,
   with its log in `out/runner.log`, and waits for `GET /health`, 30 s
   at most.
4. **The first step.** If the script of the saved state was running
   at the save, it asks for a transition to that state, so that the
   script runs, as it did in the twin. Otherwise the replay twin waits
   in the saved state, as any reinstated twin does.
5. It writes `set.properties`.
6. It sends each input at its time after the start, over the speed,
   signed as `replay`.
7. It waits until no script runs, for `settle` seconds at most. A
   script that still runs then is stopped with `POST /stop`, and the
   tool says so on stderr. It stops the replay twin, writes
   `replay.json` and prints a summary.

Of the file above:

```text
Sent 5 inputs, 0 refused; the replay is in .../run/replays/capacity-3
```

A script that still ran after `settle`, such as one that samples a
device until a stop, is named first on stderr:
`The replay twin still ran a script after 2 s: stopped`. Ctrl+C or
`SIGTERM` to the tool stops the scripts of the replay twin and the
replay twin, and the tool exits with 130 or 143. The tool waits 10 s
at most for the answer to its `POST /stop`. A second Ctrl+C or
`SIGTERM` during that shutdown kills the replay twin at once, and the
tool exits.

The configuration that the tool wrote:

```yaml
id: hospital-1.replay
port: 41177
location: scripts
commands:
  - open
  - full
  - admit
  - discharge
  - save-script
  - restore-script
  - forecast-beds
database: state.db
stateMachine: ../../hospital-1/snapshots/20261124T222403208Z/hospital.fsm.yaml
parameters:
  capacity: 3
relationships:
  peers:
    - id: hospital-2
      topic: dtaas/hospital-2
      url: http://localhost:5200
      relationship: neighbour
      attributes:
        distance: 12.4
auth:
  principals:
    - name: replay
      role: operator
      publicKey: -lHAH3YwbLIKKLamz2o9-2giw7EGhF1QldLEC7rKlmc
```

- `mqtt`, `relationships.manager`, `scripts` and `snapshots` are left
  out: a replay twin reaches nobody and saves nothing.
- `location` is the copy of the scripts in `out`. The state machine
  file stays the copy in the start.
- The peers are kept, so that the subscriptions of the class bind.
  None is followed.
- The one principal is `replay`, of role `operator`. Its private key
  stays in the memory of the tool and is never written.
- The port is free on `127.0.0.1` when the tool looks; the replay twin
  listens on `127.0.0.1` alone.

## What Is Left in `out`

```text
replays/capacity-3/
├── replay.json
├── run
│   └── hospital-1.replay
├── runner.log
├── runner.yaml
├── scripts
└── state.db
```

`state.db` is the database of the replay twin, with the timeline of
what it did. `replay.json` says what the replay was (paths shortened):

```json
{
  "format": 1,
  "of": "hospital-1",
  "start": ".../run/hospital-1/snapshots/20261124T222403208Z",
  "inputs": ".../run/hospital-1/snapshots/20261124T222416431Z",
  "from": {
    "seq": 10,
    "time": "2026-11-24T22:24:03.208Z"
  },
  "until": {
    "seq": 44,
    "time": "2026-11-24T22:24:16.431Z"
  },
  "speed": 2,
  "set": {
    "parameters": {
      "capacity": 3
    }
  },
  "sent": 5,
  "refused": 0,
  "firstStep": null
}
```

| Field       | Meaning                                                                                            |
| :---------- | :------------------------------------------------------------------------------------------------- |
| `start`     | The start snapshot, as an absolute path                                                            |
| `inputs`    | The inputs snapshot, as an absolute path; `null` for a scenario                                    |
| `from`      | The `seq` and `time` of the start                                                                  |
| `until`     | The last row sent from, and its time; for a scenario `{seq: null, time: <until or null>}`          |
| `set`       | What the file set; `{}` without `set`                                                              |
| `sent`      | The inputs sent                                                                                    |
| `refused`   | Those that the replay twin refused with a `4xx`                                                    |
| `firstStep` | The `seq` of the entry that the first step made in the replay twin, or `null` without a first step |

`refused` counts inputs such as an event with no transition in the
state that the replay twin was then in. That is a finding, not a
fault: the changed twin may be somewhere else. `firstStep` is `null`
here, as the script of `open` had ended at the save.

`scripts/` is the copy of the scripts of the start that the replay
twin ran, and `out` is its working directory. A script that writes
beside itself, or into its working directory, writes into `out`, and
never into the snapshot: here, the beds in
`run/hospital-1.replay/ward.json`. Two replays of one snapshot each
have their own `out`, and do not see each other's files. The tool makes `out`
with mode `0700`, as `state.db` holds the inputs of commands.

## Compare

```bash
runner-compare run/hospital-1/snapshots/20261124T222416431Z run/replays/capacity-3
```

Each argument is a snapshot or the `out` of a replay. The tool reads
the timeline in the database of each and lists, for each state entry,
the time that it stands for (`at` in a replay twin), the state, what
caused it and who, side by side. With three beds a ward:

```text
at        hospital-1                hospital-1.replay
22:24:09  full  full       script   -   <- first difference
22:24:14  open  beds-free  script   -

entries: 2 and 0; first difference at 22:24:09
cpu seconds: 0.0 and 0.0
```

Four patients did not fill six beds, so the replay twin stayed in
`open`, and `admit` raised no `full`. The same file without `set` gave
a replay that the tool found equal:

```text
at        hospital-1                hospital-1.replay
22:24:09  full  full       script   full  full       script
22:24:14  open  beds-free  script   open  beds-free  script

entries: 2 and 2; the same
cpu seconds: 0.0 and 0.0
```

- A cause is a transition and who sent it, an event and who sent it
  (or `parameter`, `peer` or `script` for one raised from within), or
  the end of a script by its status: `valid`, `invalid` or `stopped`.
  Entries are the same when the state and the cause are; entry
  numbers are not compared.
- Entries are lined up by the `seq` that the input which caused them
  had in the twin: its own `seq` in the twin, `origin.seq` in the
  replay twin. Each such entry and the entries after it that no
  transition or event of a client caused form a block. Two blocks of
  one key are lined up by the longest common sequence of state and
  cause, so an entry that one side lacks is one row with `-`, and a
  changed entry sits beside the one that it replaces.
- The state and cause columns are as wide as the longest on either
  side.
- The entry of the first step is left out of the replay's side. A
  snapshot beside a replay counts the rows after the start up to the
  `seq` of the snapshot.
- The cpu seconds are those that the runs of the scripts of the
  entries used.

`--json` prints the same as one document:
`{a: {dir, id, entries, cpuSeconds}, b: {...}, rows: [{at, a, b,
same}], firstDifference, same}`, where `a` and `b` of a row are `null`
or `{seq, at, state, cause: {kind, name, by}, key, cpuSeconds}`.

| Exit code | Meaning                                                     |
| :-------- | :---------------------------------------------------------- |
| 0         | The entries are the same                                    |
| 1         | They differ                                                 |
| 2         | An argument is neither a snapshot nor the `out` of a replay |

`runner-replay` exits with 0 after a replay or a dry run, 2 when it
refuses the file, the snapshots or a flag, and 1 when the replay
fails, such as a replay twin that does not come up.

## What a Class Must Do

The scripts of a replay twin run for real, on the host of the tool.
A class that was not written with the mode in mind would act on the
real hospital from a second process, so the class must say that it
allows a replay twin, in the `whatIf` section
([STATE-MACHINE.md](STATE-MACHINE.md#what-if)):

```yaml
# the commands that POST /whatif runs on a private copy of the twin;
# replay: the scripts keep to their own beds in a replay twin, so
# runner-replay may start one
whatIf:
  commands:
    - forecast-beds
  replay: true
```

Without it the tool refuses with exit code 2, and a runner started
with `--what-if` stops: `the class has no whatIf.replay: true, and a
class that was not written for a replay twin would act on the real
twin from a second process`. A class with `replay: true` and no
`commands` needs no `snapshot.save`.

Every script of a replay twin gets three variables:

| Variable        | Value                                                     |
| :-------------- | :-------------------------------------------------------- |
| `DT_MODE`       | `what-if`                                                 |
| `DT_REPLAY_OF`  | The `id` of the twin that was saved, such as `hospital-1` |
| `DT_TIME_SCALE` | The `speed`, such as `2`                                  |

`DT_ID` is that of the replay twin, such as `hospital-1.replay`, and
`RUNNER_URL` and `RUNNER_TOKEN` are those of the replay twin, so its
scripts raise events and write properties as in the twin. A replay
twin started by hand without `auth` gives no `RUNNER_TOKEN`, as any
runner without access control: a script that needs the variable set
fails there. A script of a class that allows a replay:

- keeps its files beside itself or in its working directory, which
  in a replay twin of `runner-replay` are in `out`, and the restore
  script puts them there;
- divides its own waits by `DT_TIME_SCALE`, so that it samples as
  often, in the time that the replay twin stands for, as in the twin;
- does nothing to the world: no message to a device, a person or
  another system, unless that system is a copy too.

The hospital keeps its beds in `run/<DT_ID>/ward.json` beside its
scripts, which in a replay twin is `run/hospital-1.replay/` of `out`.
Its scripts find the file so, in `scripts/ward.sh`, which `open`,
`admit` and `discharge` source:

```bash
WARD_FILE="$(dirname "${BASH_SOURCE[0]}")/../run/$DT_ID/ward.json"
```

and its `restore-script` puts the beds there:

```bash
#!/usr/bin/env bash
# Restores the beds from a snapshot, to run/<DT_ID>/ beside the scripts
set -euo pipefail
dir="$(dirname "$0")/../run/$DT_ID"
mkdir -p "$dir"
cp "$DT_SNAPSHOT_DIR/ward.json" "$dir/ward.json"
```

A script that samples every half second waits so:

```bash
# a replay twin runs DT_TIME_SCALE times as fast, and so do the waits
sleep "$(awk -v scale="${DT_TIME_SCALE:-1}" 'BEGIN { print 0.5 / scale }')"
```

A script that ignores `DT_TIME_SCALE` samples at its usual rate while
the inputs arrive faster.

## A Replay Twin by Hand

A replay twin is a runner started with `--reinstate` and `--what-if`;
`--time-scale <factor>`, a number above 0, is `1` without the flag.
Neither is accepted alone: `--what-if is accepted only with
--reinstate`, `--time-scale is accepted only with --what-if`. The
operator may start one with a `runner.yaml` of its own, such as the
one above, with `auth` and a principal whose key the operator holds.
Keep `auth`: a replay twin without it is open to every process of the
host, which may then call every route, start its scripts and hand it
notices.

A replay twin saves nothing, whatever its `runner.yaml` lists under
`snapshots`: `POST /snapshot`, and `POST /whatif` of a command of
`whatIf.commands`, answer `409` with `no snapshot directory`, and the
start leaves the `what-if/` directory of the live twin alone. Its
scripts are those of `location`, and its working directory is that
of the shell: give it a copy of the scripts and a directory of its
own, as `runner-replay` does, if the scripts write beside themselves.
A refusal at the start, such as a class without `whatIf.replay: true`,
prints its message and exits with 1.

The replies below are from a replay twin started without `auth`, so
that `curl` needs no token, with a `runner.yaml` like the one above
but without `auth` and `parameters`, on port 5662, in a directory
`run/replays/by-hand/` that holds a copy of the scripts:

```bash
runner -c runner.yaml \
  --reinstate ../../hospital-1/snapshots/20261124T222403208Z \
  --what-if --time-scale 60
```

It logs once: `A replay twin of hospital-1 at
2026-11-24T22:24:03.208Z, at 60 times the speed of the clock: it
connects to no MQTT broker, follows no peer and sends no
notification`. It listens on `127.0.0.1:5662` only, `GET /health`
shows `"mqtt": "disabled"`, and `GET /dt` ends with:

```json
"replay": {"of": "hospital-1", "time": "2026-11-24T22:24:03.208Z"}
```

It waits in the saved state: here `open`, with the status `valid` of
the script that had ended before the save; a script that ran at the
save shows `interrupted`. It knows its peers as the twin knew them at
the save: the last notice of each kind of each peer up to the
snapshot's `seq`, without a row or an event. Right after the start,
`GET /peers` showed `hospital-2` with `online: null`, as the twin had
heard nothing of it. A notice of a peer is handed to it on a route
that only a replay twin answers, here with the header
`Replay-Seq: 57`:

```http
PUT /peers/hospital-2/notice
Replay-Seq: 57

{"kind": "presence", "data": {"online": false}}
```

It answered with the reply of `GET /peers`, where `hospital-2` was
`online: false`, and its timeline then held the notice and the event
of the subscription, each with `at`, the time that it stands for:

```json
[
  {
    "seq": 12,
    "time": "2026-11-24T22:27:46.954Z",
    "kind": "notice",
    "by": null,
    "data": {
      "peer": "hospital-2",
      "kind": "presence",
      "data": { "online": false }
    },
    "at": "2026-11-24T22:29:59.128Z",
    "origin": { "by": null, "seq": 57 }
  },
  {
    "seq": 13,
    "time": "2026-11-24T22:27:46.956Z",
    "kind": "event",
    "by": null,
    "data": {
      "event": "neighbour-down",
      "source": "peer",
      "peer": "hospital-2",
      "cause": 12,
      "reply": { "status": "accepted", "state": "open" }
    },
    "at": "2026-11-24T22:29:59.248Z"
  }
]
```

The same notice once more was recorded, and raised nothing: a notice
equal to what the replay twin knows raises nothing.

`Replay-By` names the principal that sent the input to the twin, and
`Replay-Seq` its `seq` there; the replay twin records them as
`origin`. A malformed header gets `400` with a message that names it,
such as `Replay-Seq must be a whole number above 0, not "x"` or
`Replay-Seq is missing: Replay-By needs it, a whole number above 0`.
In a replay twin the role `operator` may call every route.
A runner that shuts down waits for its scripts, so stop the script
with `POST /stop` before Ctrl+C. The routes
and headers are in [API.md](api/API.md#replay-twins).

## Limits

- **A replay answers for the twin, not for the world.** What the
  physical twin and the peers did is what they did under the old
  values.
- **A replay repeats only what the inputs decide.** A script that
  draws random numbers, reads the clock or races an input goes
  another way. Compare an unchanged replay with the twin first: if it
  differs, so will a changed one, for reasons that are not the
  change.
- **Some rows are not inputs.** A `stop` of a script, a save and a
  what-if are not sent. A script that the twin's operator stopped
  with `POST /stop` is not stopped in the replay twin; if it still
  runs after the last input, the tool stops it after `settle`.
- **Old rows of a repeated request key.** A runner before 0.14.0 did
  not mark the row of a request answered from a stored reply, so the
  tool sends it, and the command runs a second time in the replay
  twin.
- **Scripts act for real on the host.** They run as the account of
  the tool, with the files, the network and the devices of the host.
  `whatIf.replay: true` is the author's promise that they keep to
  their own files.
- **Personal data travels.** The timeline holds the inputs of
  commands, and every replay twin gets a copy.
