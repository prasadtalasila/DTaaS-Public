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
| Linux     | [demo-linux-manager.cast](demo-linux-manager.cast)     | [demo-linux-network.cast](demo-linux-network.cast)     | [demo-linux.mp4](demo-linux.mp4)     | 4 min 33 s | 0.11.0, with the class of issue 21               |
| Windows   | [demo-windows-manager.cast](demo-windows-manager.cast) | [demo-windows-network.cast](demo-windows-network.cast) | [demo-windows.mp4](demo-windows.mp4) | 6 min 23 s | 0.10.0, `feature/distributed-demo` at `0885d759` |

Both were recorded with access control and signed notifications on.

The Linux recording shows the files of this folder as they are: the
`relationships` layout of `runner.yaml`, one state machine file as the
class of both hospitals, the property `free-beds`, and the MQTT topic
`parameters/set`. Its scripts are the shell scripts of
[scripts](scripts), which need `jq` and `curl`, and they run as the
account of the runner. The same story with the scripts running as a
second account (`scripts.user`) is to follow.

The Windows recording predates version 0.11.0 and shows none of that:
it has a state machine file for each hospital, the flat `peers` key,
`type: enum` with `values`, and the topic `set-parameters`, which
version 0.12.0 refuses. Its scripts are the `.ps1` files.

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

The Manager submits two commands, declared under `manager.commands`:

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
Linux one adds `GET /properties` after the state document, and the
free beds of each state notification on the right.

| Linux | Windows | Section                                       | Features                                                                                                         |
| ----: | ------: | :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
|  0:00 |    0:00 | Setup                                         | `runner.yaml` with `peers`, the keys and `auth` that `record.mjs` adds, both state machines, shell helpers       |
|  0:33 |    0:37 | Presence: online                              | Both runners start; signed online notices and first state documents, verified by the subscriber (right)          |
|  0:50 |    0:56 | Descriptor, health and access control         | `GET /dt` with `peers` and `publicKey`; `GET /health` with `scripts: null`; `401` unsigned; `403` by role        |
|  1:03 |    1:16 | Signed output                                 | MQTT `dt` response verified with the runner's public key                                                         |
|  1:08 |    1:23 | State machine and script context              | `POST /fsm/transition`; `DT_*`, `RUNNER_URL`, declared `env`, fidelity; `GET /peers` from a script; `GET /state` |
|  1:27 |    1:46 | Peers                                         | `GET /peers` with the peer's descriptor and state; `PUT /peers` refused                                          |
|  1:35 |    1:59 | Command input and request keys                | `POST /` with input on stdin; replayed key; `409` for input to a running command                                 |
|  1:58 |    2:29 | Failed command and explicit escalation        | `failed` with exit code 3; `POST /escalate` from a script; `GET /` with `resources`                              |
|  2:17 |    2:57 | Parameters and fidelity                       | `GET`/`PUT /parameters`, MQTT `set-parameters`; refused non-controllable; `fidelity` restart; history figures    |
|  2:42 |    3:36 | Peer event: neighbour full                    | `hospital-2` fills up over MQTT and HTTP; its `full` succeeds; `neighbour-full` restarts `open`                  |
|  2:59 |    4:03 | Script raises an event; escalation on failure | `full` raised over HTTP; `full` finds no open peer; `$failure` without a transition escalates                    |
|  3:15 |    4:29 | Escalation on no transition                   | `409 no transition`, escalated once per entry                                                                    |
|  3:26 |    4:46 | MQTT request/response with input              | MQTT `execute` and `fsm`, verified                                                                               |
|  3:34 |    4:59 | Disable and enable a peer                     | `PUT /peers`; the retained `full` counts again after the enable                                                  |
|  3:48 |    5:20 | Peer event: neighbour down                    | The runner of `hospital-2` is killed; its will raises `neighbour-down`                                           |
|  3:58 |    5:36 | History and metrics                           | `GET /history` with `since` and `limit`, `by` of each record; `GET /metrics` with `resources`                    |
|  4:09 |    5:52 | Stop                                          | `POST /stop`; `stopGrace`; `$stopped` transition                                                                 |
|  4:19 |    6:08 | Webhook                                       | Every notification of both DTs also posted to the webhook, verified                                              |
|  4:23 |    6:13 | Presence: offline                             | Graceful shutdown; the retained state and presence of both DTs, the will among them                              |

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
`restore-script` copies it back:

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
next recording clears. The recordings predate the snapshots and do
not show the chapter; they are recorded again after issue 25.

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
`admit` and `discharge`, with the helpers of `ward.sh`. They need
`bash`, `jq` and `curl`. The steps name the script of the platform
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
agg, and 3 minutes on Linux.
