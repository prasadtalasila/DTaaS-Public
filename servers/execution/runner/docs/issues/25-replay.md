# 25 Replay and Compare a Twin

- Status: planned. The shape of the tools was settled with the owner
  on 2026-11-23; two assumptions below await the owner's word.
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

```bash
runner-replay --start snapshots/20261122T220000000Z \
  --inputs snapshots/20261123T060000000Z \
  --out replays/scope-multi --speed 60 --change scope=multi

runner-compare snapshots/20261123T060000000Z replays/scope-multi
```

They are two more commands of the package, beside `runner`:
`npm install -g @into-cps-association/runner` puts all three on the
path, through the `bin` of `package.json`.

### Two snapshots

A replay of a period needs a snapshot from before it and one from
after it:

- the **start** is where the side twin begins: its database, its
  scripts and what its scripts kept;
- the **inputs** is any later snapshot of the same twin. Its
  `state.db` holds the timeline, and the rows after the `seq` of the
  start are what happened in between.

So an operator who wants to replay nights saves the twin each
evening and each morning.

### `runner-replay`

| Flag                      | Needed                 | Meaning                                                                          |
| :------------------------ | :--------------------- | :------------------------------------------------------------------------------- |
| `--start <directory>`     | always                 | The snapshot that the side twin starts from                                      |
| `--inputs <directory>`    | unless `--scenario`    | A later snapshot of the same twin, whose timeline gives the inputs               |
| `--scenario <file>`       | in place of `--inputs` | A YAML file of steps, each at a time after the start                             |
| `--out <directory>`       | always                 | Where the side twin keeps its database and files; it must not exist              |
| `--until <time>`          | no                     | Stop at the last row before this time; by default, at the last row of the inputs |
| `--speed <factor>`        | no                     | Divide the gaps between the inputs by this number; `1` by default                |
| `--change <name>=<value>` | no                     | Set a parameter in the side twin before the first input; may be repeated         |
| `--dry-run`               | no                     | Print the inputs and their times, and start nothing                              |
| `--help`, `--version`     | no                     | The usual                                                                        |

What it does:

1. It checks that both snapshots are of one twin, and that the class
   allows a side twin (see below).
2. It writes a configuration for the side twin into `--out`, from the
   copy of `runner.yaml` in the start:

   | Key                             | In the side twin                                                |
   | :------------------------------ | :-------------------------------------------------------------- |
   | `id`                            | the `id` of the twin, with `.replay`                            |
   | `port`                          | a free port of the host                                         |
   | `database`                      | a file in `--out`                                               |
   | `location`, `stateMachine`      | the copies in the start                                         |
   | `parameters`                    | as in the copy, then each `--change`                            |
   | `relationships.peers`           | as in the copy, so that subscriptions bind; no peer is followed |
   | `mqtt`, `relationships.manager` | left out: a side twin reaches nobody                            |
   | `auth`                          | one principal, with a key made for this run                     |
   | `scripts`, `snapshots`          | left out                                                        |

3. It starts a runner on that configuration, with
   `--reinstate <start> --what-if --time-scale <speed>`.
4. If the script of the saved state was running at the save, it
   enters that state again. See [The first step](#the-first-step).
5. It sends each input to the side twin, at its time after the start
   over the speed, signed with the key of step 2.
6. After the last input it waits until the side twin is idle, or for
   a time, stops it, and leaves `--out`.

`--out` then holds the database of the side twin, with the timeline
of what it did.

What is sent, and what is not:

| Row of the timeline                                                    | Sent to the side twin as                |
| :--------------------------------------------------------------------- | :-------------------------------------- |
| `transition`                                                           | `POST /fsm/transition`                  |
| `event` of a client                                                    | `POST /fsm/event`                       |
| `command`, with its input                                              | `POST /`                                |
| `parameters`, `peers`                                                  | `PUT /parameters`, `PUT /peers`         |
| `properties` that a `sensor` wrote                                     | `PUT /properties`                       |
| `notice` of a peer                                                     | `PUT /peers/<id>/notice`                |
| `event` or `properties` of a script, `entry`, `exit`, `sent`, `whatif` | nothing: the side twin does these again |

Each request names the principal and the `seq` that it had in the
twin. The side twin records both in its own row, so its timeline says
`manager-1` where the twin's did, and the two can be lined up row by
row.

A replay shows what the twin would have decided, given what it was
told. It does not show what the world would have done: the beds that
were free last night were free under the old scope.

### The side twin

A side twin is a runner started with `--reinstate` and `--what-if`.
The operator may also start one by hand in that way. The mode
changes five things:

- **It says what it is.** `GET /dt` shows
  `fork: {of: "hospital-1", time: "2026-11-22T22:00:00.000Z"}`.
- **Its scripts are told.** They get `DT_MODE=what-if`, `DT_FORK_OF`
  and `DT_TIME_SCALE`. The restore script has given them their own
  copy of the files, so a script that follows the mode acts on the
  copy and not on the hospital.
- **Its class must allow it.** `whatIf.fork: true` in the class.
  Without it the start is refused: a class that was not written with
  the mode in mind would act on the real hospital from a second
  process.
- **It takes the notices of peers on a route.** A runner learns of
  its peers from their notices, which arrive on topics that it
  subscribes to. They raise the events of the subscriptions, and they
  are what `GET /peers` shows to the scripts. A side twin follows no
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
  The side twin enters `open`, its script starts, and the replay goes
  on as the night did.
- **The script was running.** The snapshot was taken at 22:00 with
  the hospital `open`, whose script samples the beds and raises
  `full` when none is free. The inputs are two admissions, at 22:10
  and 22:20, which take the last beds. In the twin, the script saw
  that and raised `full`. In the side twin, no script is running, so
  nobody raises `full`, and it stays `open` to the end. The two
  timelines differ from the first row on, though nothing was changed.

So when the manifest says that the script was `running`, the tool
first asks the side twin for a transition to the same state. The
script starts, as a new entry. The entry numbers of the side twin
are then one above those of the twin, and the comparison goes by
state and source, not by entry number.

### Time

A replay keeps the meaning of time, at a scale. `--speed 60` plays an
hour in a minute, `1` plays at the speed of the clock, and `0.5`
takes twice as long. The side twin gives the same number to its
scripts as `DT_TIME_SCALE`, to divide their own waits by, as a
convention like fidelity (17c). A script that ignores it samples at
its usual rate while the inputs arrive faster.

Each row of the timeline of a side twin has, beside its real time,
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
| Reply              | `GET /dt`: `fork`, `null` for a twin                                                    |
| State machine file | `whatIf.fork`, a boolean                                                                |
| Script variables   | `DT_FORK_OF` and `DT_TIME_SCALE`, in a side twin                                        |
| Timeline           | `at`, and the first principal and `seq`, on the rows of a side twin                     |

### Not in this issue

- Following a twin as it runs, the parallel kind of the paper. It
  needs the timeline of the live twin, where everything else here
  needs none.
- A route that starts a side twin, and any process that the runner
  of a twin starts for a caller.
- A simulated clock in the runner: time is scaled, not stepped.
- Side twins of side twins.
- Leaving personal data out of a replay.

### Decided

| Question                   | Decision of 2026-11-23                                                       |
| :------------------------- | :--------------------------------------------------------------------------- |
| Who makes a side twin      | The operator, with a tool; the runner of the twin starts none                |
| Where the inputs come from | A later snapshot, not the live twin                                          |
| What the tools talk to     | Snapshot directories; no URL of the twin and no key of it                    |
| The parallel kind          | Not now                                                                      |
| How time passes            | Time keeps its meaning, at a scale that the caller gives and the scripts get |
| Its own issue              | Yes, apart from 24                                                           |
| The first step             | The tool enters the saved state again when its script was running            |

### Assumed, for the owner to confirm

1. **A key for each run.** The tool is the only caller of the side
   twin. It makes a key pair, lists it as the one principal of the
   side twin, and signs with it. Without that, any process of the
   host could send the side twin a request while it runs.
2. **Who the first caller was** is carried in each request and
   recorded by the side twin, which trusts the tool for it.

## Plan

Provisional:

1. `src/config/commander.ts`, `src/main.ts`: `--what-if` and
   `--time-scale`. `src/fsm/class.ts`: `whatIf.fork`.
   `src/dto/descriptor.dto.ts`: `fork`. `src/fsm/script-context.ts`:
   `DT_FORK_OF`, `DT_TIME_SCALE`.
2. `src/peers/peers.controller.ts`: the notice route, which answers
   `404` unless the runner is a side twin. The timeline: `at`, and
   the first principal and `seq`.
3. `src/tools/` (new), with two more `bin` entries in `package.json`:
   - `inputs.ts`: the inputs after a `seq` in a database, or of a
     scenario file;
   - `side-twin.ts`: the configuration, the key, the start and the
     stop;
   - `replay.ts`: the command, and the sending at the times over the
     speed;
   - `compare.ts`: the command, over two databases.
4. `demo/hospital`: `whatIf.fork`, scripts that honour `DT_MODE` and
   `DT_TIME_SCALE`, and a replay of the story under another scope.
5. Documents: `WHAT-IF.md` of [24](24-what-if.md), a part for
   operators; `README.md`, `CLASS-INSTANCE-INTERFACE.md`,
   `api/API.md`, and decisions in `docs/state-machine-design.md`.

## Tasks

- [ ] `--what-if` is refused without `--reinstate` and without
      `whatIf.fork`; a side twin shows `fork` in `/dt`, gives its
      scripts the three variables, and takes a notice on the route,
      which any other runner answers with `404`. Check:
      `test/e2e/side-twin.spec.ts`.
- [ ] The inputs of a stretch of a timeline are those that entered
      the twin, in their order, and not what scripts raised. Check:
      `test/unit/tools.inputs.spec.ts`.
- [ ] The configuration of a side twin reaches nobody, keeps the
      instance values, applies each change, and lists one principal.
      Check: `test/unit/tools.side-twin.spec.ts`.
- [ ] A replay with no change gives a timeline that `runner-compare`
      finds equal in its entries, from a snapshot whose script had
      ended and from one whose script was running; with a change it
      marks the first difference. Check: `test/e2e/replay.spec.ts`.
- [ ] The gaps between the inputs are those of the twin over the
      speed, and each row has its `at`. Check:
      `test/unit/tools.replay.spec.ts`.
- [ ] A scenario file feeds a side twin. Check:
      `test/e2e/replay.spec.ts`.
- [ ] The package installs the three commands. Check:
      `test/e2e/dist.spec.ts`.
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
