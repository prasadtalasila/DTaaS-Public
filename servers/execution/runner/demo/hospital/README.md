# Hospital Bed Management Demo

A terminal recording of the features of the runner, told as the
hospital bed-management case study of the paper _Self-Adaptation in
Digital Twin Networks: A Hospital Bed Management Coordination Case
Study_ (`.research-papers/Generalization_of_Self_Adaptation_in_DT_Networks`).
Two runners manage the digital twins (DTs) of two hospitals,
`hospital-1` and `hospital-2`, which are peers of each other; the
person at the terminal plays the DT Manager of the network.

There are two recordings, each of two
[asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/) files
on one clock, which end together: the Manager's terminal, which types
to both runners, and the notifications of both DTs as an MQTT
subscriber to `dtaas/+/notify/+` receives them, one line each. A video
shows the two side by side, the Manager on the left (H.264, 1966×918,
stored in Git LFS).

| Recording | Manager                                                | Notifications                                          | Video                                | Length     | Runner                                           |
| :-------- | :----------------------------------------------------- | :----------------------------------------------------- | :----------------------------------- | :--------- | :----------------------------------------------- |
| Linux     | [demo-linux-manager.cast](demo-linux-manager.cast)     | [demo-linux-network.cast](demo-linux-network.cast)     | [demo-linux.mp4](demo-linux.mp4)     | 6 min 7 s  | 0.14.0, with the class of issue 25               |
| Windows   | [demo-windows-manager.cast](demo-windows-manager.cast) | [demo-windows-network.cast](demo-windows-network.cast) | [demo-windows.mp4](demo-windows.mp4) | 6 min 23 s | 0.10.0, `feature/distributed-demo` at `0885d759` |

Both were recorded with access control and signed notifications on.

The Linux recording shows the files of this folder as they are: the
`relationships` layout of `runner.yaml`, one state machine file as the
class of both hospitals, the property `free-beds`, the MQTT topic
`parameters/set`, and the chapters of issues 23 to 25:
[save and reinstate](#save-and-reinstate), [what-if](#what-if) and
[replay](#replay). It was recorded again after issue 25, and after
the final review of issues 22 to 25. Its
scripts are the shell scripts of [scripts](scripts), which need `jq`
and `curl`, and they run as the account of the runner. The same story
with the scripts running as a second account (`scripts.user`) is to
follow.

The Windows recording predates version 0.11.0, is not recorded again,
and shows none of that: it has a state machine file for each hospital,
the flat `peers` key, `type: enum` with `values`, and the topic
`set-parameters`, which version 0.12.0 refuses. Its scripts are the
`.ps1` files.

## Play

Open `demo-linux.mp4` or `demo-windows.mp4` in any video player, or
play a cast in a terminal, the two in two terminals side by side:

```bash
asciinema play demo-linux-manager.cast
asciinema play demo-linux-network.cast
```

Or in a web page, with
[asciinema-player](https://docs.asciinema.org/manual/player/):

```html
<div id="manager"></div>
<div id="network"></div>
<script src="asciinema-player.min.js"></script>
<script>
  for (const pane of ['manager', 'network']) {
    AsciinemaPlayer.create(
      `demo-windows-${pane}.cast`,
      document.getElementById(pane),
    );
  }
</script>
```

Each cast has a marker at each section, so the player can jump between
them.

## Scenario

`hospital-1` and `hospital-2`, both in Aarhus and 12.4 km apart, have
two wards each, cardiology and maternity. Each runner reads its own
configuration, [runner.yaml](runner.yaml) and
[runner-2.yaml](runner-2.yaml), which list the other hospital under
`relationships.peers` with a `distance` attribute. Both name one state
machine file, [hospital.fsm.yaml](hospital.fsm.yaml), which is the
class `urn:dtaas:demo:hospital` of the two DTs
([CLASS-INSTANCE-INTERFACE.md](../../CLASS-INSTANCE-INTERFACE.md)). It
has three states, each running the script of the same name in
[scripts](scripts): `open.ps1` on Windows, and the shell script `open`
on Linux, which do the same:

| State    | Script       | Meaning                                                                                      |
| :------- | :----------- | :------------------------------------------------------------------------------------------- |
| `open`   | `open.ps1`   | Admits patients; logs where overflow goes, samples the beds and raises `full` when none free |
| `full`   | `full.ps1`   | No free bed; succeeds when a peer is open to take overflow, else fails, which escalates      |
| `closed` | `closed.ps1` | Admits nobody                                                                                |

The two instances differ in their `runner.yaml` in two places only:

- `runner-2.yaml` sets `capacity` to 1 under `parameters`, in place of
  the 2 of the class, so `hospital-2` has one bed per ward and two
  admissions fill it.
- `runner.yaml` gives its peer `hospital-2` the `relationship`
  `neighbour`, and `runner-2.yaml` gives `hospital-1` none.

The `subscriptions` of the class follow the relationship `neighbour`:
they raise `neighbour-full` when a neighbour reports state `full`, and
`neighbour-down` when it goes offline. So `hospital-1` follows
`hospital-2`, and `hospital-2`, without a neighbour, follows no one;
its runner logs at startup that the subscriptions are idle. Both
events are `stop: true` self-transitions of `open`, so its script
starts again and logs the new place for overflow. `open` and `full`
read that place from `GET $RUNNER_URL/peers`: the nearest peer that is
online and in state `open`, or none.

The Manager submits two commands, declared under `manager.commands`,
and asks the [what-if](#what-if) `forecast-beds`, listed there too:

- `admit` with input `{"patient": "p-1", "ward": "cardiology"}` on
  stdin. Under scope `single` the patient goes to the requested ward
  only; under `multi`, to any ward with a free bed. Without a bed the
  script escalates with a proposal of scope `multi` and exits 3.
- `discharge` with input `{"patient": "p-1"}`, which frees the bed and
  raises `beds-free`.

Three parameters are declared:

- `scope` is the shared-policy parameter θ ∈ {single, multi} of the
  paper, controllable by the Manager; changing it raises
  `scope-changed`, a `stop: true` self-transition that restarts `open`.
- `capacity`, the beds per ward, is declared but not controllable. It
  is an integer of at least 1, with the default 2, which `hospital-2`
  replaces with 1.
- `fidelity`, of values `low`, `medium` and `high`, follows the
  [fidelity convention](../../STATE-MACHINE.md#pattern-fidelity):
  `open` samples the beds every `POLL_MS` milliseconds times 4, 1 or
  0.2, and `fidelity-changed` restarts it, so the Manager trades the
  freshness of the DT against the CPU time that the runner reports.

One property is declared: `free-beds`, an integer of unit `beds`, the
free beds of all wards. `open` writes it with `PUT /properties`
(`Send-FreeBeds` of [scripts/ward.ps1](scripts/ward.ps1), `send_free_beds`
of [scripts/ward.sh](scripts/ward.sh)) at its start
and whenever a sample gives another number, and writes `0` before it
raises `full`. The Manager and the peer read it in `GET /properties`
and in the state document; the runner never reads it.

## Sections

The times are those of the casts and of the video of each recording.
The features are described as the Windows recording shows them; the
Linux one adds `GET /properties` after the state document, the free
beds of each state notification on the right, and the last three
chapters before "Presence: offline", which the Windows recording
lacks (—).

| Linux | Windows | Section                                       | Features                                                                                                                             |
| ----: | ------: | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
|  0:00 |    0:00 | Setup                                         | `runner.yaml` with `peers`, the keys and `auth` that `record.mjs` adds, both state machines, shell helpers                           |
|  0:33 |    0:37 | Presence: online                              | Both runners start; signed online notices and first state documents, verified by the subscriber (right)                              |
|  0:49 |    0:56 | Descriptor, health and access control         | `GET /dt` with `peers` and `publicKey`; `GET /health` with `scripts: null`; `401` unsigned; `403` by role                            |
|  1:02 |    1:16 | Signed output                                 | MQTT `dt` response verified with the runner's public key                                                                             |
|  1:08 |    1:23 | State machine and script context              | `POST /fsm/transition`; `DT_*`, `RUNNER_URL`, declared `env`, fidelity; `GET /peers` from a script; `GET /state`; the first snapshot |
|  1:31 |    1:46 | Peers                                         | `GET /peers` with the peer's descriptor and state; `PUT /peers` refused                                                              |
|  1:39 |    1:59 | Command input and request keys                | `POST /` with input on stdin; replayed key; `409` for input to a running command                                                     |
|  2:02 |    2:29 | Failed command and explicit escalation        | `failed` with exit code 3; `POST /escalate` from a script; `GET /` with `resources`                                                  |
|  2:21 |    2:57 | Parameters and fidelity                       | `GET`/`PUT /parameters`, MQTT `set-parameters`; refused non-controllable; `fidelity` restart; history figures                        |
|  2:46 |    3:36 | Peer event: neighbour full                    | `hospital-2` fills up over MQTT and HTTP; its `full` succeeds; `neighbour-full` restarts `open`                                      |
|  3:04 |    4:03 | Script raises an event; escalation on failure | `full` raised over HTTP; `full` finds no open peer; `$failure` without a transition escalates                                        |
|  3:20 |    4:29 | Escalation on no transition                   | `409 no transition`, escalated once per entry                                                                                        |
|  3:31 |    4:46 | MQTT request/response with input              | MQTT `execute` and `fsm`, verified                                                                                                   |
|  3:39 |    4:59 | Disable and enable a peer                     | `PUT /peers`; the retained `full` counts again after the enable                                                                      |
|  3:53 |    5:20 | Peer event: neighbour down                    | The runner of `hospital-2` is killed; its will raises `neighbour-down`                                                               |
|  4:03 |    5:36 | History and metrics                           | `GET /history` with `since` and `limit`, `by` of each record; `GET /metrics` with `resources`                                        |
|  4:14 |    5:52 | Stop                                          | `POST /stop`; `stopGrace`; `$stopped` transition                                                                                     |
|  4:24 |    6:08 | Webhook                                       | Every notification of both DTs also posted to the webhook, verified                                                                  |
|  4:28 |       — | What-if                                       | `POST /whatif` by the Manager, `GET /whatif/<id>` with `"token": "absent"`, the `whatif` notification                                |
|  4:55 |       — | Save and reinstate                            | `POST /snapshot` with `stop`; `--reinstate` on port 5300; the restored beds, `GET /fsm`, `reinstated`                                |
|  5:21 |       — | Replay                                        | A replay file under scope `multi`; `runner-replay --dry-run`, `runner-replay`; the live beds untouched; `runner-compare`             |
|  5:58 |    6:13 | Presence: offline                             | Graceful shutdown; the retained state and presence of both DTs, the will among them                                                  |

## Save and Reinstate

The class names two commands that copy the beds into a snapshot and
back from one ([README](../../README.md#saving-and-reinstating)):

```yaml
# the commands that copy the beds into a snapshot and back from one
snapshot:
  save: save-script
  restore: restore-script
```

Both runners permit them, and each saves into a directory of its own:
`run/hospital-1/snapshots` and `run/hospital-2/snapshots`, under the
`snapshots` key of `runner.yaml` and `runner-2.yaml`. The beds in
`run/<id>/ward.json` are all that the scripts keep beside the
properties, so `save-script` copies that file to `DT_SNAPSHOT_DIR` and
`restore-script` copies it back, to the place that `ward.sh` and
`ward.ps1` give the beds: `run/<id>/` beside the scripts, which in a
[replay twin](#replay) is under its `out`:

| Script           | Linux                                    | Windows                                          |
| :--------------- | :--------------------------------------- | :----------------------------------------------- |
| `save-script`    | [save-script](scripts/save-script)       | [save-script.ps1](scripts/save-script.ps1)       |
| `restore-script` | [restore-script](scripts/restore-script) | [restore-script.ps1](scripts/restore-script.ps1) |

The bash scripts were run; the PowerShell ones have not been run yet.

The chapter "Save and reinstate" of
[tools/steps-peers.mjs](tools/steps-peers.mjs) comes before "Presence:
offline". `dt1 /snapshot` with `{"stop": true}` saves `hospital-1` and
shuts its runner down; the step removes `run/hospital-1/ward.json` and
starts hospital-1 again on port 5300 with `runner-moved.auth.yaml`,
which `record.mjs` writes from `runner.auth.yaml` with a database of
its own, and `--reinstate` with the snapshot. `dt3` of
[tools/shell.sh](tools/shell.sh) asks it. The restored `ward.json`
has the patients, `GET /fsm` the saved `closed`, and the `start` row
names the snapshot. Everything is under `run/hospital-1`, which the
next recording clears. The Linux recording shows the chapter; the
Windows one predates it.

A copy of the demo without its `mqtt` section, with `hospital-1` in
`open` after `admit` of `p-1` to cardiology, answered
`POST /snapshot` with `{"stop": true}`:

```json
{
  "time": "2026-11-24T12:57:05.005Z",
  "seq": 5,
  "path": "run/hospital-1/snapshots/20261124T125705005Z"
}
```

and shut down. With `run/hospital-1` removed, the snapshot moved to
`snaps/`, and `runner -c runner.yaml --reinstate
snaps/20261124T125705005Z`, the runner restored
`run/hospital-1/ward.json` as `{"cardiology":["p-1"],"maternity":[]}`,
and `GET /fsm` answered:

```json
{
  "state": "open",
  "status": "interrupted",
  "entry": 1,
  "events": [
    "beds-free",
    "close",
    "fidelity-changed",
    "full",
    "neighbour-down",
    "neighbour-full",
    "reopen",
    "scope-changed"
  ]
}
```

An event or a transition moves the hospital on.

## What-If

The Manager asks `hospital-1` how many beds are free after a horizon,
under a scenario, and the runner answers on a private copy of the twin
([WHAT-IF.md](../../WHAT-IF.md)). The class names the command, and
lists it for the Manager too:

```yaml
# the commands that POST /whatif runs on a private copy of the twin
whatIf:
  commands:
    - forecast-beds
```

Both runners permit `forecast-beds`. It reads the scenario on stdin,
and refuses to run when `DT_MODE` is not `what-if`. The forecast
itself is [scripts/forecast.mjs](scripts/forecast.mjs), which both
versions run with node and which says what it computes: the free beds
now, from the capacity of `parameters.json` and the patients of
`files/ward.json`, that `save-script` copied; the `admit` less the
`discharge` requests of the last hour, failed ones included, from the
`timeline` table of `state.db`,
read with `node:sqlite`; and the free beds at the horizon, where each
step that takes a peer offline doubles the rate from its time on. It
prints a JSON result, with `"token": "absent"` when the script has no
`RUNNER_TOKEN`.

| Script          | Linux                                  | Windows                                        |
| :-------------- | :------------------------------------- | :--------------------------------------------- |
| `forecast-beds` | [forecast-beds](scripts/forecast-beds) | [forecast-beds.ps1](scripts/forecast-beds.ps1) |

The bash script was run; the PowerShell one has not been run yet.

The chapter "What-if" of [tools/steps-peers.mjs](tools/steps-peers.mjs)
comes after "Webhook" and before "Save and reinstate", with
`hospital-1` in `closed` and `hospital-2` killed. `manager-1` asks
`POST /whatif` for `forecast-beds` with a horizon of two hours and
`hospital-2` offline from ten minutes on; the reply, `202` with the
id, goes to `run/whatif.txt`, and the step waits until
`GET /whatif/<id>` has ended (`whatIfEnded` of
[tools/waits.mjs](tools/waits.mjs)). `GET /whatif/<id>` shows the
result, the network pane its `whatif` notification
([tools/summary.mjs](tools/summary.mjs)), and the last line the
machine, still `closed` `valid`, and no copy left under
`run/hospital-1/snapshots/what-if`. `record.mjs` reinstates from the
last snapshot beside that directory. The Linux recording shows the
chapter; the Windows one predates it. In the run of the recording, the
chapter showed:

```json
{
  "id": 18,
  "name": "forecast-beds",
  "status": "valid",
  "mode": "what-if",
  "receivedAt": "2026-11-24T18:39:05.000Z",
  "by": "manager-1",
  "exitCode": 0,
  "result": {
    "free-beds": 0,
    "horizon": "PT2H",
    "free-now": 1,
    "admissions-per-hour": 5,
    "state-now": "closed",
    "peers-offline-now": ["hospital-2"],
    "token": "absent"
  },
  "finishedAt": "2026-11-24T18:39:05.000Z",
  "resources": { "cpuSeconds": 0, "peakRssBytes": 970752, "processes": 1 }
}
```

## Replay

The operator runs `hospital-1` again from a snapshot, under scope
`multi` from the start, and compares the two
([REPLAY.md](../../REPLAY.md)). The class allows a replay twin, as its
scripts keep to their own beds in one:

```yaml
# the commands that POST /whatif runs on a private copy of the twin;
# replay: the scripts keep to their own beds in a replay twin, so
# runner-replay may start one
whatIf:
  commands:
    - forecast-beds
  replay: true
```

A replay twin runs a copy of the scripts in its `out`, so `ward.sh`
and `ward.ps1` keep its beds and ward log in `run/<DT_ID>/` there:
`run/replays/scope-multi/run/hospital-1.replay/` in the demo.
`restore-script` copies the beds of the snapshot there, and `open`
divides its interval between samples by `DT_TIME_SCALE`. The bash
scripts were run; the PowerShell ones have not been run.

The story takes two snapshots of `hospital-1`: the first at the end of
"State machine and script context", with `open` running, and the second
in "Save and reinstate". The chapter "Replay" of
[tools/steps-peers.mjs](tools/steps-peers.mjs) comes after it, with
`hospital-1` reinstated on port 5300:

1. [tools/replay-file.mjs](tools/replay-file.mjs) writes
   `run/runner-replay.yaml`: from the first snapshot to the last, at
   speed 2, with `settle: 2` and `scope: multi`.
2. `runner-replay --dry-run` lists the first inputs, without their
   bodies, and marks the second `admit` of `p-1`, whose request key
   replayed a stored reply, as skipped; then
   `runner-replay` runs the replay into `run/replays/scope-multi`.
   `runner-replay` and `runner-compare` of
   [tools/shell.sh](tools/shell.sh) run the tools built in this
   repository.
3. `cat` shows the beds of `hospital-1`, untouched, beside those of
   the replay twin in its `out`.
4. `runner-compare` lists the state entries of the second snapshot
   and of the replay, and marks the first difference.

In the run of the recording, the replay sent 23 inputs, of which the
replay twin refused three, as the twin did: the input to the running
`open` and the two `close` events. Its `open` still ran after
`settle`, so the tool stopped it. The replay twin started knowing what
`hospital-2` had told before the save, so its `open` logged overflow
to `hospital-2` as the twin's did. The beds:

```text
{"cardiology":["p-2"],"maternity":["p-3","p-4"]}
{"cardiology":["p-2"],"maternity":["p-3","p-3"]}
```

Under `multi` from the start, `admit` of `p-3` got a bed in maternity
at the first request, and `admit` sent the same patient to maternity
again at the second, as the script does not check for a patient that
it already has. The comparison:

```text
at        hospital-1                            hospital-1.replay
19:09:38  open    scope-changed     parameter   -   <- first difference
19:09:38  open    fidelity-changed  parameter   open    fidelity-changed  parameter
19:09:40  open    neighbour-full    peer        open    neighbour-full    peer
19:09:41  full    full              script      full    full              script
19:09:42  open    beds-free         script      open    beds-free         script
19:09:43  open    neighbour-full    peer        open    neighbour-full    peer
19:09:43  open    neighbour-down    peer        open    neighbour-down    peer
19:09:44  closed  stopped                       closed  stopped

entries: 8 and 7; first difference at 19:09:38
cpu seconds: 0.0 and 0.1
```

The Manager's change of scope was no change in the replay twin, so
`open` did not restart: one entry fewer, shown as `-`, and the other
seven lined up beside their counterparts. The same replay without
`set` was found equal to the twin, with 8 entries on each side.
Everything of the chapter is under `run/`, which the next recording
clears.

## Assumptions

- Two hospital DTs; the other DTs of the network and the Manager's
  allocation algorithm are out of scope. The terminal user acts as the
  Manager and as the operator of both runners.
- Each hospital keeps its beds in `run/<id>/ward.json`, a stand-in for
  the hospital's information system, and its scripts log to
  `run/<id>/ward.log`.
- A patient the hospital cannot take is refused by `admit` (exit 3)
  rather than queued; the escalation carries the proposal the paper's
  DT would send (scope `multi`).
- The broker is a local aedes broker on port 18830 (MQTT 3.1.1), and the
  webhook is a local receiver on port 18080; both only log what they
  receive. Both runners use them.

## Record Again

From `servers/execution/runner`, after `yarn install` and `yarn build`:

```bash
node demo/hospital/tools/record.mjs
node demo/hospital/tools/check-cast.mjs
```

`record.mjs` starts the broker, subscriber and webhook receiver
([tools/services.mjs](tools/services.mjs)) and both runners
([tools/runner.mjs](tools/runner.mjs)), plays the steps of
[tools/steps.mjs](tools/steps.mjs) and
[tools/steps-peers.mjs](tools/steps-peers.mjs) in Git Bash (`DEMO_BASH`
overrides the shell) with real output and simulated typing, and writes
`demo-windows-manager.cast` and `demo-windows-network.cast`, or
`demo-linux-*` on Linux. A recording takes about three minutes on
Windows, as each PowerShell script needs seconds to start, and about
one minute on Linux. Everything
the run writes goes to `run/`, which git ignores; `run/transcript.txt`
has each command with its output, and `run/notify.jsonl` each
notification as it came. `check-cast.mjs` checks every pair of casts
in the folder: valid asciicast v2, times that never go back, and the
same height and end time for the two casts of a pair.

The casts share one clock ([tools/clock.mjs](tools/clock.mjs)).
Typing and narration move it by set amounts, and commands and waits by
the real time they took. The subscriber writes the real time at which
each notification arrived, which the clock turns into a time of the
network cast. Gaps longer than 2 s are then shortened in both casts
together, so that they stay in step and end at the same time.

On Linux the runner starts a script by its bare name, so `scripts/`
has a shell version of each `.ps1` script: `open`, `full`, `closed`,
`admit`, `discharge`, `save-script`, `restore-script` and
`forecast-beds`, with the helpers of `ward.sh`. They need
`bash`, `jq` and `curl`; `forecast-beds` needs `bash` and `node`.
The steps name the script of the platform
where they show one, and their narration differs in two lines.

### Keys, Access Control and Signatures

`record.mjs` writes new key pairs into `run/keys/` with
[tools/keygen.mjs](tools/keygen.mjs), so that no private key is
committed: `alice` (role `client`), `manager-1` (role `manager`), and
one key of each runner. It then writes `runner.auth.yaml` and
`runner-2.auth.yaml`, git-ignored, which are `runner.yaml` and
`runner-2.yaml` with the peer's `publicKey` appended to the peer's
entry, which is last in each file, and an `auth` section: `key`, the
runner's signing key, and `principals`, alice and manager-1.

[tools/sign.mjs](tools/sign.mjs) signs each request: `dt1`, `dt2` and
the waits as `alice`, `mq1` and `mq2` as `manager-1`; `DT_AS` names
another principal, and one without a key file, such as `DT_AS=nobody`,
sends the request unsigned. `DT_ID` names the runner, and
[tools/settings.mjs](tools/settings.mjs) gives its address and base
topic.

The subscriber and webhook receiver of
[tools/services.mjs](tools/services.mjs) and `mq` mark each message
with [tools/jws.mjs](tools/jws.mjs): `verified` for a JWS that the
public key of its DT, `run/keys/<id>.pub`, checks, `UNSIGNED` for plain
JSON, and `INVALID` for one that fails or that no public key can check.
An `INVALID` line gives the reason (no key file, unreadable key file,
malformed, wrong `alg` or `kid`, bad signature) and the payload as it
came, marked unverified, instead of the summary
([tools/summary.mjs](tools/summary.mjs)).

To try a runner by hand after a recording, start the services and the
runners from this folder; `run/keys/` and the two `*.auth.yaml` files
stay until the next recording:

```bash
node tools/services.mjs &
node tools/runner.mjs -c runner.auth.yaml &
node tools/runner.mjs -c runner-2.auth.yaml &
source tools/shell.sh
dt1 /peers
```

`touch run/shutdown` shuts down gracefully the runners that watch for
it, as Ctrl+C would; the first runner that sees the file removes it.

## Convert to MP4

asciinema has no video output, so [tools/to-mp4.sh](tools/to-mp4.sh)
renders each cast as a GIF with [agg](https://github.com/asciinema/agg)
and joins the two side by side with ffmpeg's `hstack`. It runs on
Linux or in WSL. Install the tools once; the release binaries of
asciinema and agg need no root:

```bash
mkdir -p ~/.local/bin && cd ~/.local/bin
base=https://github.com/asciinema
musl=x86_64-unknown-linux-musl
curl -fsSL -o asciinema \
  "$base/asciinema/releases/download/v3.2.1/asciinema-$musl"
curl -fsSL -o agg "$base/agg/releases/download/v1.9.0/agg-$musl"
chmod +x asciinema agg
sudo apt-get install ffmpeg # or any ffmpeg build with libx264
```

The script looks in `~/.local/bin` before the `PATH`. Then, from this
folder (in WSL, under `/mnt/c/...`):

```bash
bash tools/to-mp4.sh windows # or linux
```

With asciinema 3 it checks each cast with `asciinema convert`, writing
its plain-text transcript to `run/demo-windows-*.txt`; with an older
asciinema it says so and goes on, as `check-cast.mjs` checks the casts
too. It renders `run/demo-windows-*.gif`
at font size 16 with an idle limit of 60 s, so that agg keeps the gaps
as `record.mjs` set them, and writes `demo-windows.mp4` with libx264 at
CRF 32. The conversion took 14 minutes in WSL under `/mnt/c`, most of it in
agg, and 6 minutes on Linux for the Linux recording of 6 min 8 s.
