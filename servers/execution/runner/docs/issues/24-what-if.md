# 24 What-If: Inside the Twin, and in a Fork

- Status: planned. The design was settled with the owner on
  2026-11-23; the open questions below remain.
- Depends on: [22](22-timeline.md) (what happened),
  [23](23-snapshot.md) (the save, the copy and the reinstated twin)
- PR: none yet
- Research note: the Fluid Digital Twins paper, read in
  [integrated-simulations.md](../integrated-simulations.md#fluid-digital-twins-offloading-and-a-twin-beside-itself).
  The owner asked for the issue with W3, on 2026-11-20. It reopens the
  non-goal "forecasts and exogenous triggers" of the
  [issues](README.md#non-goals).

## Spec

Two parties ask what-if questions, and they get two answers:

| Who          | Asks                                                                  | Gets                                          | Part |
| :----------- | :-------------------------------------------------------------------- | :-------------------------------------------- | :--- |
| The Manager  | "How many beds are free in two hours if hospital-2 goes down?"        | One script of the twin, run on a private copy | A    |
| The operator | "What would the whole twin have done last night under scope `multi`?" | A second runner, a fork, fed the inputs       | B    |

Part A is one script with a model. It is quick, and the twin does it
by itself. Part B runs the state machine and every script of the
class again, and needs a second process, which the operator starts.
The runner starts no process for either (S1 and S2 stand).

### Part A: what-if inside the twin

A what-if inside the twin is a command. It needs no route of its own:
commands already have an input, an outcome, a row in the history,
resource figures, request keys and a list of what a Manager may run.

#### What the author writes

```yaml
# the state machine file, the class
snapshot:
  save: save-state
  restore: restore-state
whatIf:
  commands:
    - forecast-beds
manager:
  commands:
    - admit
    - discharge
    - forecast-beds
properties:
  free-beds:
    type: integer
    minimum: 0
    unit: beds
  free-beds-in-2h:
    type: integer
    minimum: 0
    unit: beds
```

- `whatIf.commands` are the commands that run on a private copy. Each
  must be a command of `runner.yaml`.
- A Manager may run one only if `manager.commands` lists it too, as
  for any command.
- A result that others should see is a property, declared as usual.
- The class needs `snapshot.save`: it is what makes the copy.

And three scripts: `save-state` and `restore-state` of
[23](23-snapshot.md), and the what-if script itself.

```bash
#!/usr/bin/env bash
# forecast-beds: the free beds after a horizon, under a scenario
scenario=$(cat)
beds="$DT_WHATIF_DIR/files/ward.json"
state="$DT_WHATIF_DIR/snapshot.json"
free=$(simulate "$beds" "$state" "$scenario")
curl -s -X PUT "$RUNNER_URL/properties" \
  -H "Authorization: Bearer $RUNNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"free-beds-in-2h\": $free}"
echo "{\"free-beds\": $free}"
```

#### What the operator writes

```yaml
# runner.yaml, the instance
commands:
  - open
  - full
  - closed
  - admit
  - discharge
  - save-state
  - restore-state
  - forecast-beds
snapshots:
  directory: 'run/hospital-1/snapshots'
```

Nothing is new here beyond [23](23-snapshot.md): the copies go under
the directory of the snapshots.

#### What the Manager sends

```http
POST /
{
  "name": "forecast-beds",
  "input": {
    "horizon": "PT2H",
    "change": { "parameters": { "scope": "multi" } },
    "steps": [{ "at": "PT10M", "peer": "hospital-2", "online": false }]
  }
}
```

The input is the scenario. Its shape is the class's own, as for any
command; `horizon`, `change` and `steps` are a convention that the
documents will recommend.

#### What the runner does

1. **It makes a private copy.** It saves the twin as in
   [23](23-snapshot.md), with the same pause, into a temporary
   directory named by the time,
   `<snapshots>/what-if/20261123T101502120Z/`: `snapshot.json`, and
   `files/` from the save script. No `snapshot` row is written, and
   the list of snapshots does not show it.
2. **It runs the command**, with the input on stdin and two more
   variables: `DT_MODE=what-if`, and `DT_WHATIF_DIR`, the copy.
3. **It answers as for any command**: the outcome and what the
   script printed. The history and the timeline show the run, the
   timeline with `mode: what-if`.
4. **It removes the copy** when the script ends, however it ends.

The script simulates on the copy. It never opens the files that the
scripts of the states use, so it can not change the twin by mistake.
The copy is also the mock: in the demo, `ward.json` stands for the
hospital, and the what-if script admits and discharges in its copy.

`DT_MODE` is `live` for every other script.

#### Limits

- It is one script. The state machine does not run, and no other
  script of the class does. A question about how the machine would
  move is for Part B, or for a model of the machine in the script.
- It is as fast as the script. Nothing replays in real time here, so
  there is no time scale.
- The twin pauses for as long as the save script takes, at each run.
- Two runs of one command do not overlap: the second joins the
  first, as for any command.

### Part B: a fork, for the operator

A fork is a second runner, started from a snapshot by the operator:

```bash
runner -c fork.yaml --reinstate snapshots/20261123T101502120Z --what-if --time-scale 60
```

`fork.yaml` is an instance like any other: its own `id`, port,
database and topic. `--reinstate` is that of [23](23-snapshot.md).
`--what-if` makes the runner a fork:

- **It says what it is.** `GET /dt` and the presence notice show
  `fork: {of: "hospital-1", time: "2026-11-23T10:15:02.120Z"}`. A
  Manager can not take a fork for a twin.
- **Its scripts are told.** They get `DT_MODE=what-if`, `DT_FORK_OF`
  and `DT_TIME_SCALE`. The restore script has given them their own
  copy of the files, so a script that follows the mode acts on the
  copy and not on the hospital.
- **Its class must allow it.** `whatIf.fork: true` in the class.
  Without it `--what-if` is refused: a class that was not written
  with the mode in mind would act on the real hospital from a second
  process.
- **It reaches whom its operator lets it reach.** `fork.yaml` has its
  own `relationships`. A fork with none follows no peer and notifies
  no Manager.

A snapshot reinstated without `--what-if` is a second live twin. That
is a move, or a mistake, and the operator's to tell apart.

The class of a fork may be another version: `fork.yaml` names the
state machine file and the scripts. That is how a new version of a
class is tried before the instances take it.

#### Feeding a fork

A fork starts where the snapshot was taken and then does what it is
told. A tool of the package, `runner-replay`, tells it. It reads and
sends over the public API of the runners, so the twin and the fork
may be on two hosts.

| Kind     | The inputs are                                                | Command                                                  |
| :------- | :------------------------------------------------------------ | :------------------------------------------------------- |
| Replay   | The rows of the twin's timeline after the snapshot, to an end | `runner-replay --from <twin> --to <fork> --until <time>` |
| Parallel | The same rows, and each new one as it is written              | `runner-replay --from <twin> --to <fork> --follow`       |
| Scenario | A file of steps, each at a time after the start               | `runner-replay --scenario steps.yaml --to <fork>`        |

- What is sent is what entered the twin: transitions, events of
  clients, commands with their inputs, parameter and peer changes,
  the notices of peers and the properties that a sensor wrote. What
  the scripts of the twin raised or wrote is not sent: the scripts of
  the fork do that again.
- `--change` sets parameters in the fork before the first input, such
  as `--change scope=multi`.
- A replay shows what the twin would have decided, given what it was
  told. It does not show what the world would have done. The beds
  that were free last night were free under the old scope.

#### Time

A run keeps the meaning of time, at a scale. `--speed 60` plays an
hour in a minute, `1` plays at the speed of the clock, and `0.5`
takes twice as long. The tool divides the gap between two inputs by
it. The fork is started with the same number as `--time-scale`, and
gives it to its scripts as `DT_TIME_SCALE`, to divide their own waits
by, as a convention like fidelity (17c). A script that ignores it
samples at its usual rate while the inputs arrive faster.

The timeline of a fork has real times. Each row also has `at`, the
time that it stands for: the time of the snapshot, plus the real time
since the start times the scale.

#### Comparing

`runner-compare <twin> <fork>` reads both timelines and lists, for
each `entry` row, the state, the source, the properties and the
resource figures of the script, lined up by `at`, and marks the first
row where the two differ.

### Roles

| Action                                      | `client` | `operator` | `manager`                       |
| :------------------------------------------ | :------- | :--------- | :------------------------------ |
| Run a what-if command (Part A)              | yes      | no         | if `manager.commands` lists it  |
| Save a snapshot for a fork                  | yes      | yes        | no                              |
| Start a fork: a shell on the host           | no       | yes        | no                              |
| Read the timeline of the twin, to replay it | yes      | yes        | yes                             |
| Send inputs to a fork                       | yes      | no         | parameters, peers, its commands |
| Read the timeline of a fork, to compare     | yes      | yes        | yes                             |

An operator feeds a fork as a `client` of it: the fork is the
operator's, and `fork.yaml` lists the operator's key in that role.

### API changes

| Kind               | Change                                                                                                                              |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| State machine file | `whatIf.commands`, each a command of `runner.yaml`; `whatIf.fork`, a boolean                                                        |
| Script variables   | `DT_MODE` (`live` or `what-if`) for every script; `DT_WHATIF_DIR` for a what-if command; `DT_FORK_OF` and `DT_TIME_SCALE` in a fork |
| Reply              | `POST /` of a what-if command: `409` `no snapshot directory`, and `500` when the copy fails                                         |
| Reply              | `GET /dt` and the presence notice: `fork`, `null` for a twin                                                                        |
| Timeline           | `mode` on a command row; `at` on every row of a fork                                                                                |
| Command line       | `--what-if` and `--time-scale <factor>`, both only with `--reinstate`                                                               |
| Package            | Two more commands: `runner-replay` and `runner-compare`                                                                             |

No route is added.

### Not in this issue

- A route that starts a fork, and any process that the runner starts
  for a caller. The owner dropped `POST /what-if` on 2026-11-23.
- A simulated clock in the runner: time is scaled, not stepped.
- Trying a change in the twin itself, or running it backwards.
- Forks of forks, and merging a fork into its twin.
- The model of the physical twin, which is the author's, in the
  scripts.
- A Manager that decides from the result.

### Decided

| Question                     | Decision of 2026-11-23                                                       |
| :--------------------------- | :--------------------------------------------------------------------------- |
| Who starts a fork            | The operator, as a second runner; the runner starts none                     |
| What-if without the operator | A command of the class, run on a private copy that the save script makes     |
| Who may ask                  | The Manager runs what-if commands; saving is the operator's and the client's |
| The copy                     | A temporary directory, named by the time, removed after the run              |
| How time passes in a fork    | Time keeps its meaning, at a scale that the caller gives and scripts get     |
| Kinds of what-if             | A replay of a past period and a scenario of a coming one                     |

### Open questions

1. **May a what-if command change the twin?** It gets the token of
   every script (S11), so it can raise an event or escalate. It
   should only read and write properties. Either the documents say
   so, or the runner mints a second token that can do no more. The
   plan documents it.
2. **Is the parallel kind wanted?** It costs one option of the tool,
   `--follow`, once a replay exists. The plan has it.
3. **Personal data on a second host.** A replay sends the inputs of
   commands to the fork, and the demo's `admit` names a patient.
   Should the tool be able to leave inputs out, or to replace them?
4. **May a fork publish on the broker of the twin?** It is the
   operator's `fork.yaml` that says. The documents will recommend a
   topic that a Manager's subscription does not match.
5. **Is one issue too large?** Part A is a few days on top of 23.
   Part B is a week or more and can follow it as its own pull
   request, or its own issue.

## Plan

Provisional. Part A:

1. `src/fsm/class.ts`: `whatIf`, with the cross-checks: each command
   is permitted, and `snapshot.save` is named.
2. `src/snapshot/snapshot.service.ts` of [23](23-snapshot.md): a save
   into a temporary directory, without a row and outside the list.
3. `src/execa-manager.service.ts` is at 241 lines, so a new
   `src/whatif/whatif.ts` wraps the run of a what-if command: the
   copy, the two variables, and the removal in a `finally`.
4. `src/fsm/script-context.ts`: `DT_MODE` for every script.
5. `demo/hospital`: `forecast-beds`, and a step of the story where
   the Manager asks.

Part B:

1. `src/config/commander.ts`, `src/main.ts`: `--what-if` and
   `--time-scale`. `src/dto/descriptor.dto.ts`: `fork`.
   `src/fsm/script-context.ts`: `DT_FORK_OF`, `DT_TIME_SCALE`. The
   timeline: `at`.
2. `src/tools/` (new), with two more `bin` entries in `package.json`:
   - `inputs.ts`: the inputs of a stretch of a timeline, or of a
     scenario file;
   - `replay.ts`: sends them to a runner at their times over the
     speed, signed as a principal;
   - `compare.ts`: the `entry` rows of two timelines by `at`.
3. `demo/hospital`: scripts that honour `DT_MODE` and
   `DT_TIME_SCALE`, and a replay of the story under another scope.

Documents, for both: a new `WHAT-IF.md` for authors, Managers and
operators, `README.md`, `STATE-MACHINE.md`,
`CLASS-INSTANCE-INTERFACE.md`, `SECURITY-MODEL.md`, `api/API.md`, and
decisions in `docs/state-machine-design.md`.

## Tasks

Part A:

- [ ] A class with `whatIf.commands` loads; one that names a command
      which is not permitted, or has no `snapshot.save`, is refused.
      Check: `test/unit/fsm.class.spec.ts`.
- [ ] A what-if command runs with `DT_MODE=what-if` and a copy that
      holds `snapshot.json` and what the save script wrote; the copy
      is gone after a success, a failure and a stop. Check:
      `test/e2e/whatif.spec.ts`.
- [ ] No `snapshot` row is written and the list of snapshots is
      unchanged; the timeline shows the command with its mode. Check:
      `test/e2e/whatif.spec.ts`.
- [ ] Every other script gets `DT_MODE=live`. Check:
      `test/unit/script-context.spec.ts`.
- [ ] A `manager` may run a listed what-if command and not an
      unlisted one. Check: `test/e2e/whatif.spec.ts`.

Part B:

- [ ] `--what-if` is refused without `--reinstate` and without
      `whatIf.fork`; a fork shows `fork` in `/dt` and gives its
      scripts the three variables. Check: `test/e2e/fork.spec.ts`.
- [ ] `runner-replay` sends the inputs of a timeline in their order,
      with the gaps over the speed, and not what scripts raised.
      Check: `test/unit/tools.replay.spec.ts`.
- [ ] A replay of a recorded run with no change gives a timeline that
      `runner-compare` finds equal in its `entry` rows; with a change
      it marks the first difference. Check:
      `test/e2e/replay.spec.ts`.
- [ ] A scenario file and `--follow` feed a fork. Check:
      `test/e2e/replay.spec.ts`.

Both parts:

- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.

## Learnings

To be written by the pull request that implements this issue.
