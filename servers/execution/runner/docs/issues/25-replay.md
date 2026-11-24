# 25 Replay and Compare a Twin

- Status: planned. The shape of the tools was settled with the owner
  on 2026-11-23.
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
# runner-replay.yaml
start: run/hospital-1/snapshots/20261122T220000000Z
inputs: run/hospital-1/snapshots/20261123T060000000Z
out: replays/scope-multi
speed: 60
set:
  parameters:
    scope: multi
```

```bash
runner-replay runner-replay.yaml
runner-compare run/hospital-1/snapshots/20261123T060000000Z replays/scope-multi
```

A replay is described in a file, `runner-replay.yaml` by default, so
that it can be read, kept and run again. Without an argument the
tool reads the file of that name in the current directory. The owner
asked on 2026-11-24 for fewer options than the ten flags of the first
plan; the tool now takes the file and one flag.

The formats that the tools read and write, a scenario file, the
`replay.json` that a replay leaves and the list that a comparison
prints, are shown in
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
| `speed`  | no                   | Divide the gaps between the inputs by this number; `1` by default                    |
| `until`  | no                   | Stop at the last input before this time; by default, at the last one                 |
| `settle` | no                   | Seconds to wait after the last input for the replay twin to be idle; `30` by default |
| `set`    | no                   | `parameters` and `properties` to set in the replay twin before the first input       |

Paths are relative to the file. Times are written as the names of
snapshots are: `YYYYMMDDTHHMMSSmmmZ`, in UTC, such as
`20261123T060000000Z`.

The tools take no other options but `--dry-run` of `runner-replay`,
which prints the inputs and their times and starts nothing, `--json`
of `runner-compare`, and `--help` and `--version` of both.

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
   | `location`, `stateMachine`      | the copies in the start                                         |
   | `parameters`                    | as in the copy, then `set.parameters`                           |
   | `relationships.peers`           | as in the copy, so that subscriptions bind; no peer is followed |
   | `mqtt`, `relationships.manager` | left out: a replay twin reaches nobody                          |
   | `auth`                          | one principal, with a key made for this run                     |
   | `scripts`, `snapshots`          | left out                                                        |

3. It starts a runner on that configuration, with
   `--reinstate <start> --what-if --time-scale <speed>`.
4. If the script of the saved state was running at the save, it
   enters that state again. See [The first step](#the-first-step).
5. It sends each input to the replay twin, at its time after the start
   over the speed, signed with the key of step 2.
6. After the last input it waits until the replay twin is idle, or for
   a time, stops it, and leaves `out`.

`out` then holds the database of the replay twin, with the timeline
of what it did.

What is sent, and what is not:

| Row of the timeline                                                    | Sent to the replay twin as                |
| :--------------------------------------------------------------------- | :---------------------------------------- |
| `transition`                                                           | `POST /fsm/transition`                    |
| `event` of a client                                                    | `POST /fsm/event`                         |
| `command`, with its input                                              | `POST /`                                  |
| `parameters`, `peers`                                                  | `PUT /parameters`, `PUT /peers`           |
| `properties` that a `sensor` wrote                                     | `PUT /properties`                         |
| `notice` of a peer                                                     | `PUT /peers/<id>/notice`                  |
| `event` or `properties` of a script, `entry`, `exit`, `sent`, `whatif` | nothing: the replay twin does these again |

The tool signs every request as one principal, `replay`. Each
request also names the principal and the `seq` that it had in the
twin, and the replay twin records both in its own row. The replay
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
start: run/hospital-1/snapshots/20261123T101502120Z
out: replays/neighbour-down
steps:
  - at: 20261123T102500000Z
    notice:
      peer: hospital-2
      kind: presence
      data:
        online: false
  - at: 20261123T103500000Z
    command:
      name: admit
      input:
        patient: p-9
        ward: cardiology
```

A step holds one of `transition`, `event`, `command`, `parameters`,
`properties`, `peers` and `notice`, and is sent as the row of that
kind is.

### The replay twin

A replay twin is a runner started with `--reinstate` and `--what-if`.
The operator may also start one by hand in that way. The mode
changes six things:

- **It follows no peer and notifies nobody**, whatever its
  configuration lists.
- **It says what it is.** `GET /dt` shows
  `replay: {of: "hospital-1", time: "2026-11-22T22:00:00.000Z"}`.
- **Its scripts are told.** They get `DT_MODE=what-if`, `DT_REPLAY_OF`
  and `DT_TIME_SCALE`. The restore script has given them their own
  copy of the files, so a script that follows the mode acts on the
  copy and not on the hospital.
- **Its class must allow it.** `whatIf.replay: true` in the class.
  Without it the start is refused: a class that was not written with
  the mode in mind would act on the real hospital from a second
  process.
- **It takes the notices of peers on a route.** A runner learns of
  its peers from their notices, which arrive on topics that it
  subscribes to. They raise the events of the subscriptions, and they
  are what `GET /peers` shows to the scripts. A replay twin follows no
  peer: hospital-2 as it is now is not hospital-2 as it was last
  night. So the recorded notices are handed to it, with
  `PUT /peers/<id>/notice`, which only a runner in this mode accepts.
- **It records where an input came from**: the principal and the
  `seq` of the twin, when a request names them.

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
`at`: the time that it stands for.

### `runner-compare`

It takes two directories, each a snapshot or the output of a replay,
and reads the timeline in the database of each. It prints, for each
state entry, the state, what caused it, and the resource figures of
its script, side by side, and marks the first row where the two
differ. It exits with 0 when the entries are the same, and 1 when
they differ.

### Roles and API changes

The tools are run by whoever has a shell on a host with the
snapshots: the operator. They need no principal of the twin.

| Kind               | Change                                                                                  |
| :----------------- | :-------------------------------------------------------------------------------------- |
| Package            | `runner-replay` and `runner-compare`                                                    |
| Command line       | `runner --what-if` and `--time-scale <factor>`, both only with `--reinstate`            |
| Route              | `PUT /peers/<id>/notice`, in a runner started with `--what-if` only; `404` in any other |
| Request            | In that mode, a header that names the principal and the `seq` of the first request      |
| Reply              | `GET /dt`: `replay`, `null` for a twin                                                  |
| State machine file | `whatIf.replay`, a boolean                                                              |
| Script variables   | `DT_REPLAY_OF` and `DT_TIME_SCALE`, in a replay twin                                    |
| Timeline           | `at`, and the first principal and `seq`, on the rows of a replay twin                   |

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

Provisional:

1. `src/config/commander.ts`, `src/main.ts`: `--what-if` and
   `--time-scale`. `src/fsm/class.ts`: `whatIf.replay`.
   `src/dto/descriptor.dto.ts`: `replay`. `src/fsm/script-context.ts`:
   `DT_REPLAY_OF`, `DT_TIME_SCALE`.
2. `src/peers/peers.controller.ts`: the notice route, which answers
   `404` unless the runner is a replay twin. The timeline: `at`, and
   the first principal and `seq`.
3. `src/tools/` (new), with two more `bin` entries in `package.json`:
   - `inputs.ts`: the inputs after a `seq` in a database, or of a
     scenario file;
   - `replay-twin.ts`: the configuration, the key, the start and the
     stop;
   - `replay.ts`: the command, and the sending at the times over the
     speed;
   - `compare.ts`: the command, over two databases.
4. `demo/hospital`: `whatIf.replay`, scripts that honour `DT_MODE` and
   `DT_TIME_SCALE`, and a replay of the story under another scope.
5. Documents: `WHAT-IF.md` of [24](24-what-if.md), a part for
   operators; `README.md`, `CLASS-INSTANCE-INTERFACE.md`,
   `api/API.md`, and decisions in `docs/state-machine-design.md`.

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
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [x] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
