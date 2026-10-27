# Hospital Bed Management Demo

A terminal recording of every feature of the runner, told as the
hospital bed-management case study of the paper _Self-Adaptation in
Digital Twin Networks: A Hospital Bed Management Coordination Case
Study_ (`.research-papers/Generalization_of_Self_Adaptation_in_DT_Networks`).
One runner manages the digital twin (DT) of one hospital; the person at
the terminal plays the DT Manager of the network.

The recording is [hospital.cast](hospital.cast), an
[asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/) file of
about 50 kB and 3 min 23 s, with a video of it,
[hospital.mp4](hospital.mp4) (H.264, 1078×738, about 4 MB, stored in
Git LFS). It was recorded on Windows against runner version 0.7.0
(`feature/distributed-demo` at `f0f7f083`).

## Play

Open `hospital.mp4` in any video player, or play the cast in a
terminal:

```bash
asciinema play hospital.cast
```

Or in a web page, with
[asciinema-player](https://docs.asciinema.org/manual/player/):

```html
<div id="demo"></div>
<script src="asciinema-player.min.js"></script>
<script>
  AsciinemaPlayer.create('hospital.cast', document.getElementById('demo'));
</script>
```

The recording has a marker at each section, so the player can jump
between them.

## Scenario

`hospital-1` in Aarhus has two wards, cardiology and maternity, of
`capacity` beds each. Its state machine
([hospital.fsm.yaml](hospital.fsm.yaml)) has three states, each running
the script of the same name in [scripts](scripts):

| State    | Script       | Meaning                                                            |
| :------- | :----------- | :----------------------------------------------------------------- |
| `open`   | `open.ps1`   | Admits patients; watches the beds and raises `full` when none free |
| `full`   | `full.ps1`   | No free bed and no early discharge; fails, which escalates         |
| `closed` | `closed.ps1` | Admits nobody                                                      |

The Manager submits two commands, declared under `manager.commands`:

- `admit` with input `{"patient": "p-1", "ward": "cardiology"}` on
  stdin. Under scope `single` the patient goes to the requested ward
  only; under `multi`, to any ward with a free bed. Without a bed the
  script escalates with a proposal of scope `multi` and exits 3.
- `discharge` with input `{"patient": "p-1"}`, which frees the bed and
  raises `beds-free`.

`scope` is the shared-policy parameter θ ∈ {single, multi} of the
paper, controllable by the Manager; changing it raises `scope-changed`,
a `stop: true` self-transition that restarts `open`. `capacity` is
declared but not controllable.

## Sections

| Time | Section                                       | Features                                                                         |
| ---: | :-------------------------------------------- | :------------------------------------------------------------------------------- |
| 0:00 | Setup                                         | `runner.yaml`, state machine file, demo shell helpers                            |
| 0:15 | Presence: online                              | Retained online notice with the descriptor; first state document                 |
| 0:31 | DT identity and descriptor                    | `GET /dt`, the MQTT `dt` route                                                   |
| 0:37 | Health                                        | `GET /health`                                                                    |
| 0:40 | One state document                            | `GET /state`                                                                     |
| 0:42 | State machine and script context              | `POST /fsm/transition`; `DT_*`, `RUNNER_URL`, declared `env`                     |
| 0:53 | Command input and request keys                | `POST /` with input on stdin; replayed key; `409` for input to a running command |
| 1:18 | Failed command and explicit escalation        | `failed` with exit code 3; `POST /escalate` from a script                        |
| 1:39 | Baseline: last command                        | `GET /` with the exit code                                                       |
| 1:43 | Declared parameters                           | `GET`/`PUT /parameters`; refused non-controllable; event raised                  |
| 2:01 | Script raises an event; escalation on failure | `full` raised over HTTP; `$failure` without a transition                         |
| 2:23 | Escalation on no transition                   | `409 no transition`, escalated once per entry                                    |
| 2:36 | MQTT request/response with input              | MQTT `execute`; late subscriber gets retained state and presence                 |
| 2:51 | Baseline: history                             | `GET /history`                                                                   |
| 2:54 | Stop                                          | `POST /stop`; `$stopped` transition                                              |
| 3:05 | Webhook                                       | Every notification also posted to the webhook                                    |
| 3:10 | Presence: offline                             | Graceful shutdown leaves a retained offline notice                               |

## Assumptions

- One hospital DT; the other DTs of the network and the Manager's
  allocation algorithm are out of scope. The terminal user acts as the
  Manager.
- Two wards, cardiology and maternity, with 2 beds each; the beds live
  in `run/ward.json`, a stand-in for the hospital's information system.
- A patient the hospital cannot take is refused by `admit` (exit 3)
  rather than queued; the escalation carries the proposal the paper's
  DT would send (scope `multi`).
- The broker is a local aedes broker on port 18830 (MQTT 3.1.1), and the
  webhook is a local receiver on port 18080; both only log what they
  receive.

## Record Again

From `servers/execution/runner`, after `yarn install` and `yarn build`:

```bash
node demo/hospital/tools/record.mjs
node demo/hospital/tools/check-cast.mjs
```

`record.mjs` starts the broker, subscriber, webhook receiver and runner
([tools/services.mjs](tools/services.mjs)), plays the steps of
[tools/steps.mjs](tools/steps.mjs) in Git Bash (`DEMO_BASH` overrides
the shell) with real output and simulated typing, and writes
`hospital.cast`. Everything the run writes goes to `run/`, which git
ignores. On Linux the runner starts the state scripts with `/bin/sh`, so
it needs shell versions of the `.ps1` scripts in `scripts/`.

The recording runs the runner with access control (runner 0.9.0 and
later): `record.mjs` writes new key pairs of `alice` (role `client`)
and `manager-1` (role `manager`) into `run/keys/` with
[tools/keygen.mjs](tools/keygen.mjs), and a git-ignored
`runner.auth.yaml`, which is `runner.yaml` with an `auth` section
listing both. [tools/sign.mjs](tools/sign.mjs) signs each request: `dt`
and the waits as `alice`, `mq` as `manager-1`; `DT_AS` names another
principal. Without the keys the tools send unsigned requests, as the
runner of `runner.yaml` expects. The present `hospital.cast` was
recorded before access control, so its view of `tools/shell.sh` is the
shorter one.

The recording stays unsigned. The subscriber and webhook receiver of
[tools/services.mjs](tools/services.mjs) and `mq` mark each message
with [tools/jws.mjs](tools/jws.mjs): `UNSIGNED` for plain JSON,
`verified` for a JWS that the runner's public key in
`run/keys/hospital-1.pub` checks, and `INVALID` for one that fails or
that no public key can check, which is not summarised. To see signed
output ([Signed Output](../../README.md#signed-output)), give the runner a key
and add `auth.key` to the `runner.auth.yaml` of a recording, then
start the services and the runner by hand from this folder:

```bash
node tools/keygen.mjs hospital-1 run/keys
echo '  key: run/keys/hospital-1.key' >> runner.auth.yaml
node tools/services.mjs &
node tools/runner.mjs -c runner.auth.yaml
```

`record.mjs` writes `runner.auth.yaml` anew, without the key, on each
run.

## Convert to MP4

asciinema has no video output, so [tools/to-mp4.sh](tools/to-mp4.sh)
renders the cast as a GIF with [agg](https://github.com/asciinema/agg)
and encodes the GIF with ffmpeg. It runs on Linux or in WSL. Install the
tools once; the release binaries of asciinema and agg need no root:

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

Then, from this folder (in WSL, under `/mnt/c/...`):

```bash
bash tools/to-mp4.sh
```

It checks the cast with `asciinema convert`, writing the plain-text
transcript to `run/hospital.txt`, renders `run/hospital.gif` at font
size 16 with idle gaps capped at 2 s, and writes `hospital.mp4` with
libx264 at CRF 32. The conversion takes about two minutes.
