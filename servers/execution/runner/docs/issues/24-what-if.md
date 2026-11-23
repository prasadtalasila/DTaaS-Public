# 24 What-If Runs

- Status: planned. The open questions below are for the owner, and
  the first three decide the shape of the issue.
- Depends on: [22](22-timeline.md) (what happened),
  [23](23-snapshot.md) (a twin started from a saved moment)
- PR: none yet
- Research note: none. The owner asked for it with W3, on 2026-11-20,
  and for both kinds below on 2026-11-23. It reopens the non-goal
  "forecasts and exogenous triggers" of the
  [issues](README.md#non-goals).

## Spec

A Manager wants to ask two questions of a DT:

- **Looking back:** "What would hospital-1 have done last night under
  scope `multi`?" The inputs are those that happened; one thing is
  changed.
- **Looking ahead:** "What happens in the next hour if hospital-2
  goes down?" The inputs are a scenario that somebody writes.

Both are answered by a second twin, a **fork**: a runner started from
a snapshot of the first, given inputs, and watched. The twin itself is
never run backwards or put in a trial state.

### A fork

A fork is an instance like any other (S2): its own `runner.yaml`,
port, database and topic. It is started with the snapshot and one
more option:

```bash
runner -c fork.yaml --reinstate snapshot.json --what-if
```

- **It says what it is.** `GET /dt` and its presence notice show
  `fork: {of: "hospital-1", seq: 412}`. A Manager can not take a fork
  for a twin.
- **Its scripts are told.** They get `DT_MODE=what-if`, and
  `DT_FORK_OF`. A script that would act on the physical twin does not,
  and a script that reads a sensor takes a model or a recorded value.
  In a twin that is not a fork, `DT_MODE` is `live`.
- **Its class must allow it.** The class says `whatIf: true`. Without
  that, `--what-if` is refused: a script written without the mode in
  mind would act on the real hospital from a second process.
- **It reaches nobody by default.** The fork takes the `relationships`
  of its own `runner.yaml`, which the operator leaves empty or points
  at other forks. It signs with its own key, or with none.
- **Its machine starts idle**, as [23](23-snapshot.md) leaves it, and
  the first input moves it.

### Looking back: replay

The inputs are the rows of the [timeline](22-timeline.md) of the
twin, from the `seq` of the snapshot to a later one: the transitions,
the events, the parameter changes and the commands. A replayer reads
them and sends them to the fork, in their order, with the one change
that the question asks for, such as `scope: multi` from the start.

What a replay can and can not show:

- It shows **what the twin would have decided**, given what it was
  told. Its machine, its scripts and its escalations run for real.
- It does not show **what the world would have done**. The beds that
  were free last night were free under scope `single`. A script in
  `what-if` mode has to model that, or the replay answers a narrower
  question than the one asked.
- It replays only what the timeline holds. Without the inputs of
  commands, `admit` runs with no patient. Without the notices of
  peers, `GET /peers` in the fork knows no one. Question 2 of
  [22](22-timeline.md) decides this.

### Looking ahead: a scenario

The inputs are a scenario file: a list of requests, each at a time
after the start.

```yaml
from: hospital-1
horizon: 3600
steps:
  - at: 0
    parameters:
      scope: multi
  - at: 600
    event: neighbour-down
  - at: 1200
    command:
      name: admit
      input:
        patient: p-9
        ward: cardiology
```

The same replayer sends them. The scripts of the fork do the rest:
in `what-if` mode they model the physical twin, and write what they
compute as properties, as they do when live.

### Comparing

The answer to a what-if question is the timeline of the fork, set
against the timeline of the twin for a replay, or read by itself for
a scenario. A comparison lists, for each `entry` row, the state, the
cause and the properties, and marks the first row where the two
differ.

### Not in this issue

- A simulated clock in the runner. A script that waits a minute waits
  a minute; see question 3.
- Running a twin backwards, or trying a change in the twin itself.
- Forks of forks, and merging a fork into its twin.
- A model of the physical twin. That is the class author's, in the
  scripts.
- A Manager that decides from the result.

### Open questions

1. **Who starts a fork?** A fork is a process, a port and a
   database. Three candidates:
   - **The operator, by hand**, as above. Nothing new runs.
   - **A tool of the package**, `runner-whatif`, that writes
     `fork.yaml` beside the twin, starts the fork, feeds it and
     stops it. One command per question.
   - **The Manager, over the API of the twin**, such as
     `POST /what-if`. The runner would then start processes for a
     caller, which S1 and S2 have kept out, and which the platform
     may want to own.

   The plan assumes the tool.

2. **Where does the replayer live?** It reads one timeline and sends
   requests to another runner, both over the public API. It can be a
   part of the tool above, outside the runner, which keeps the runner
   a managed twin and nothing more (S1). The plan assumes that.
3. **How does time pass?** The recorded night took eight hours. A
   replay can:
   - keep the gaps, and take eight hours;
   - divide the gaps by a factor, which scripts that sleep or sample
     do not follow;
   - send the next input as soon as the last was answered, which
     changes what a sampling script sees between two inputs.

   A scenario of an hour has the same problem. Scripts could be given
   `DT_TIME_SCALE` to scale their own waits, as a convention like
   fidelity (17c). The plan divides the gaps by a factor and passes
   it to the scripts.

4. **Must a class opt in?** `whatIf: true` protects the physical twin
   from a class that was not written for forks. It also means that no
   existing class can be forked until its author says so. The plan
   requires it.
5. **How are two timelines compared?** By `entry` rows only, or by
   every row? As a route of the runner, a part of the tool, or left
   to the Manager? The plan puts a comparison of `entry` rows in the
   tool.
6. **What ends a fork?** The horizon of the scenario, the last row of
   the replay, or a caller. And what is kept: its database is the
   answer. The plan stops the fork at the end and keeps the file.
7. **May a fork follow real peers?** Looking ahead, a fork of
   hospital-1 could follow the real hospital-2, or a fork of it, or a
   scripted one. The first mixes a trial with the world. The plan
   leaves `relationships` to the operator and documents the risk.

## Plan

Provisional, on the assumptions above:

1. `src/config/commander.ts`, `src/main.ts`: `--what-if`, refused
   without `--reinstate` and without `whatIf: true` in the class.
2. `src/fsm/class.ts`: `whatIf` in the class. `src/dto/descriptor.dto.ts`:
   `fork`. `src/fsm/script-context.ts`: `DT_MODE`, `DT_FORK_OF` and
   `DT_TIME_SCALE`.
3. `src/whatif/` (new), a second `bin` of the package:
   - `inputs.ts`: the requests of a timeline, or of a scenario file;
   - `replayer.ts`: sends them to a runner, at their times over the
     factor;
   - `fork.ts`: writes the configuration of a fork, starts it and
     stops it;
   - `compare.ts`: the `entry` rows of two timelines, side by side.
4. `demo/hospital`: `whatIf: true`, scripts that honour `DT_MODE`, and
   one question of each kind in the story.
5. Documents: a new `WHAT-IF.md` for authors and Managers, `README.md`,
   `CLASS-INSTANCE-INTERFACE.md`, `api/API.md`, and decisions in
   `docs/state-machine-design.md`.

## Tasks

To be written once the first three questions are settled: they decide
whether the work is in the runner, in a tool, or in both.

## Learnings

To be written by the pull request that implements this issue.
