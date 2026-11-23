# 24 What-If Runs

- Status: planned. Who starts a fork and how time passes were decided
  on 2026-11-23; the open questions below are for the owner.
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

A fork is an instance like any other: its own port, database and
topic. The owner decided on 2026-11-23 that a caller asks the runner
of the twin for it:

```http
POST /what-if
{ "from": { "seq": 412 }, "until": { "seq": 980 },
  "change": { "parameters": { "scope": "multi" } }, "speed": 60 }
```

```json
{
  "id": "hospital-1.what-if-1",
  "url": "http://127.0.0.1:5101",
  "topic": "dtaas/hospital-1/what-if/1",
  "status": "running"
}
```

The runner writes the configuration of the fork, starts it as a
process of its own from the snapshot of `from`, feeds it the inputs,
and stops it at the end. `GET /what-if` lists the forks and
`DELETE /what-if/<n>` stops one. The caller then reads the fork like
any twin, at its `url`.

This amends S1 and S2. One runner still serves one twin, but the
runner of a twin now starts and feeds the runners of its forks. The
operator allows that in `runner.yaml`, and it is off without it:

```yaml
whatIf:
  directory: 'run/what-if'
  ports: [5101, 5110]
  most: 2
```

- **It says what it is.** `GET /dt` of a fork and its presence notice
  show `fork: {of: "hospital-1", seq: 412}`. A Manager can not take a
  fork for a twin.
- **Its scripts are told.** They get `DT_MODE=what-if`, `DT_FORK_OF`
  and `DT_TIME_SCALE`. In a twin that is not a fork, `DT_MODE` is
  `live`.
- **Its class must allow it.** See question 1.
- **It reaches nobody.** A fork has no Manager webhook and follows no
  peer. The notices of peers come from the recording or the scenario.
- **It keeps its own time.** See [Time](#time).

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
- It replays everything that entered the twin, as
  [22](22-timeline.md) records all of it: the requests, the commands
  with their inputs, the notices of peers and the property values
  that a sensor wrote. What a script of the twin wrote or raised is
  not replayed: the scripts of the fork do that again.

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

It is the body of `POST /what-if`, in place of `until`. The same
replayer sends its steps. The scripts of the fork do the rest:
in `what-if` mode they model the physical twin, and write what they
compute as properties, as they do when live.

### Time

The owner decided on 2026-11-23 that a what-if run keeps the meaning
of time, at a scale. `speed` is the factor: `1` runs at the speed of
the clock, `60` runs an hour in a minute, and `0.5` takes twice as
long, to watch a fast sequence. The replayer divides the gap between
two inputs by it.

The runner can not make a script wait less. The scripts get the
factor as `DT_TIME_SCALE` and divide their own waits by it, as a
convention like fidelity (17c). A script that ignores it samples at
its usual rate while the inputs arrive faster, and the run is wrong
without saying so.

The timeline of a fork records real times. Each row also has `at`,
the time that it stands for: the time of the snapshot plus the real
time since the start times `speed`. A comparison lines the rows of a
fork up with those of the twin by `at`.

### Comparing

The answer to a what-if question is the timeline of the fork, set
against the timeline of the twin for a replay, or read by itself for
a scenario. A comparison lists, for each `entry` row, the state, the
source and the properties, and marks the first row where the two
differ.

### Not in this issue

- A simulated clock in the runner: time is scaled, not stepped.
- Running a twin backwards, or trying a change in the twin itself.
- Forks of forks, and merging a fork into its twin.
- A model of the physical twin. That is the class author's, in the
  scripts; see question 1.
- A Manager that decides from the result.

### Decided

| Question              | Decision of 2026-11-23                                                   |
| :-------------------- | :----------------------------------------------------------------------- |
| Who starts a fork     | A caller, with an API call to the runner of the twin                     |
| How time passes       | Time keeps its meaning, at a scale that the caller gives and scripts get |
| Both kinds of what-if | A replay of a past period, and a scenario of a coming one                |

### Open questions

1. **Must a class opt in, and what stands in for the hospital?** A
   script acts on something outside the runner. In the demo, `admit`
   writes a patient into `run/hospital-1/ward.json`, which stands for
   the real hospital. In a fork, the same script must not write
   there. Three ways to make sure:
   - **The author writes the mode into the scripts**, and the class
     says `whatIf: true`. Without it, `POST /what-if` is refused.
   - **The class names a mock**, a second set of scripts or a second
     target, and the runner swaps it in for a fork.
   - **Nothing:** the runner forks any class, and trusts it.

   The owner asked for an example, and suggested a mock of the real
   hospital; the reply to the owner has one. The plan assumes the
   first until this is settled.

2. **Who may ask for a fork?** A fork costs a process and runs the
   scripts. The plan gives `POST /what-if` to `client` and `manager`,
   within the `most` of `runner.yaml`.
3. **As which account do the scripts of a fork run?** With
   `scripts.user` (18), a fork needs a run directory of its own that
   the script account can write. The plan makes one under
   `whatIf.directory` at each fork, which the operator has to have
   prepared as `PRIVILEGE-SETUP.md` describes.
4. **What ends a fork, and what is kept?** The last input, plus a
   time for the scripts to settle; or `DELETE`. Its database is the
   answer, so the plan keeps the file until the caller deletes the
   fork.
5. **How are two timelines compared?** As `GET /what-if/<n>/compare`
   of the runner of the twin, which has both, or left to the caller.
   The plan has the route, over `entry` rows only.
6. **May a fork publish on the broker of the twin?** Its topic is
   under the topic of the twin. A Manager that subscribes to
   `dtaas/+/notify/+` does not see it; one that subscribes to
   `dtaas/#` does. The plan publishes, with `fork` in every presence
   notice.

## Plan

Provisional, on the assumptions above:

1. `src/config/config.schema.ts`: the `whatIf` section.
   `src/fsm/class.ts`: `whatIf` in the class.
2. `src/whatif/` (new):
   - `inputs.ts`: the inputs of a stretch of the timeline, or of a
     scenario;
   - `fork.ts`: writes the configuration and the snapshot of a fork,
     starts the process and stops it;
   - `replayer.ts`: sends the inputs to a fork at their times over
     `speed`;
   - `forks.service.ts`: the forks of this runner and their limits;
   - `compare.ts`: the `entry` rows of two timelines by `at`.
3. `src/whatif.controller.ts` (new), the MQTT routes, and their rows
   of `src/auth/roles.ts`.
4. `src/config/commander.ts`, `src/main.ts`: the options that a fork
   is started with, on top of `--reinstate` of [23](23-snapshot.md).
   `src/dto/descriptor.dto.ts`: `fork`. `src/fsm/script-context.ts`:
   `DT_MODE`, `DT_FORK_OF`, `DT_TIME_SCALE`. The timeline: `at`.
5. `demo/hospital`: scripts that honour `DT_MODE` and
   `DT_TIME_SCALE`, and one question of each kind in the story.
6. Documents: a new `WHAT-IF.md` for authors and Managers,
   `README.md`, `CLASS-INSTANCE-INTERFACE.md`, `SECURITY-MODEL.md`,
   `api/API.md`, and decisions in `docs/state-machine-design.md` that
   amend S1 and S2.

## Tasks

To be written once question 1 is settled, as it decides what a class
and its scripts must provide.

## Learnings

To be written by the pull request that implements this issue.
