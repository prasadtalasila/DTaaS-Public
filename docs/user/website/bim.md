# Building Models

The Building Models page draws a building from the user's own library and
colours it with the readings its sensors report. It answers a question a
time-series dashboard cannot: which of the forty rooms is the warm one.

This page describes the asset layout, the binding manifest, and the conversion
workflow. It is the user-facing half of DTaaS issue 1762. The page is the `bim`
extension; how the client includes it is described in
[Client Extensions](../../developer/client-sdk.md).

## What the Page Needs

Up to four files, all of them in the user's library under `common/models`:

| File | Required | What it holds |
| --- | --- | --- |
| `model.ifc` | yes | The building, as the authoring tool exported it |
| `model.glb` | no | The geometry converted from the IFC file. The page writes it the first time the model is converted |
| `model.json` | no | The property tree: every object, its IFC class, its storey, its property sets |
| `model.manifest.json` | no | The binding manifest, mapping each sensor to the object it measures |

An IFC file on its own is enough to see the building. The geometry makes the
next visit load instead of convert. The property tree adds the panel behind a
click. The manifest adds the readings. Nothing fails when the last three are
missing.

## How a Model Is Named

The IFC Model menu names each model by what its own file says the building is
called: the project's long name, then its name, then the building's. Only the
first 64 KB of each file is read for this. Template text an authoring tool
leaves behind, such as `Project Name`, and a name two files share are skipped,
and those models are shown by their file name with underscores read as spaces.

A file that carries no name can be given one with `ifc-set-name` from the
[ifc-utils](https://github.com/INTO-CPS-Association/ifc-utils) repository,
which writes it into the file and changes nothing else. Nothing about the names
is kept in DTaaS.

## The Geometry Format

The model is converted to **glTF binary**, `.glb`. The issue offered OBJ as an
alternative and it was rejected on one ground, which is the same ground the
issue itself argues from.

The binding key is the IFC `GlobalId`, a 22 character identifier that survives
every export of the same model. glTF carries arbitrary data per node in its
`extras` field, so the converter writes the `GlobalId` there and the viewer
resolves a binding by reading it back. OBJ has no such field. A marker on an
OBJ model can only be placed by node name, and a name is not an identifier:
two walls are frequently both called `Wall`, and the resolver refuses that case
instead of guessing which one the reading belongs to.

Supporting OBJ would therefore deliver the weaker half of the contract the
manifest exists to enforce. A model with no stable identity per object cannot
carry a reviewable binding.

## The Binding Manifest

The manifest is plain JSON beside the model, and it is validated with `zod`
before anything is drawn. It is written by a person and it will frequently be
wrong, so every error names the binding and the field that caused it, for
example `bindings[3].display.ramp`, instead of reporting that the file is
invalid.

```json
{
  "model": {
    "source": "substation.ifc",
    "source_sha256": "60b1b94ee88a2b087080200c3c347edaf2347e768c1accb4b3608c6a129fbb09",
    "converter": "ifc_explorer.to_manifest 0.1.0"
  },
  "bindings": [
    {
      "selector": { "globalId": "0_sgz7bzz4Jh2ckU1ehFe$" },
      "label": "HX-1 temperature TS-01",
      "source": {
        "live": { "transport": "mqtt", "topic": "swim/B1/temperature/TS-01" },
        "history": { "bucket": "swim", "measurement": "temperature" }
      },
      "display": { "unit": "°C", "ramp": [10, 50] }
    }
  ]
}
```

Four things about the shape are worth stating, because each was a decision:

- `selector` is a small union of `globalId`, `nodeName` and `expressId`, so a
  non-IFC asset can reuse the same manifest instead of needing a second schema.
  A selector names exactly one of the three. Naming two would leave the
  resolver choosing, and a manifest should not depend on which it chose.
- `live` and `history` are separate. MQTT supplies the current value on the
  model, and the time-series database supplies the panel behind a click.
  Charting is not reimplemented inside the 3D view.
- `source_sha256` is required. Without it there is no way to tell whether a
  derived artifact still describes the file beside it. The literal `unknown` is
  accepted, for a generator that never read the source, and anything else has
  to be a SHA-256.
- `display.ramp` is the range the colour scale spans, and the viewer also reads
  it as the range the sensor is expected to stay inside. A value outside it
  raises an alert on the sensor card.

A binding whose object is absent from the geometry is reported and counted, not
dropped. That is the ordinary consequence of a model being re-exported, because
re-exporting changes every `GlobalId`, and a viewer that silently draws four
markers where the manifest asked for six is worse than one that says which two
are missing.

## Conversion

Conversion runs in the browser of whoever is looking at the model. Putting an
IFC file in the library is the whole workflow: no terminal, no service, no
step that has to be repeated when the file changes.

### Why the Parser Ships Inside the Package

The issue asked that the WebAssembly parser and its workers be served from the
DTaaS origin, so the feature works in a localhost install with no external
network, and it proposed a `postinstall` copy step to achieve that.

The converter package takes a different route to the same requirement: the
`web-ifc` WebAssembly binary is embedded in the JavaScript as base64 at build
time, so the published package contains it and there is no separate `.wasm`
file to serve. A production build of the client contains zero `.wasm` files and
fetches none.

This was chosen over the copy step for three reasons.

**Nothing can be forgotten.** A `postinstall` copy is a step that exists
outside the dependency graph. It has to be present in the host's build, it has
to survive every change to that build, and when it is missing the failure
appears at runtime in somebody else's deployment as a parser that cannot load.
An embedded binary either installs or does not.

**It is one fewer request and one fewer content type.** Serving `.wasm`
requires the right MIME type from whatever reverse proxy sits in front of the
deployment, and a Content Security Policy permitting `wasm-unsafe-eval`. Both
are configuration in a file this project does not own. A base64 payload inside
a JavaScript chunk is served as JavaScript, which every deployment already
serves correctly.

**The cost is paid once and only when needed.** Base64 is one third larger than
the binary it encodes, which is the honest cost of the choice. It does not
reach the main bundle: the parser sits in a chunk that is fetched the first
time a model actually has to be converted, and a user who never opens the page
never downloads it. A production build of the client places no reference to the
renderer or the parser in its entry chunk.

The trade is a larger artifact on the one download that needs it, against a
deployment step that cannot be got wrong. For a platform whose install stories
include localhost and air-gapped, the second matters more.

### Converting Once Instead of on Every Visit

When a model has no `.glb` beside it, the page converts it in the browser and
then writes the result back into the library, next to the `.ifc`. The next visit
finds the file and loads it, so the conversion is paid for once by whoever
opened the model first.

The write goes through the workspace's own Jupyter Contents API, the same
interface the Library page reads through, and in pieces of 512 KB, because the
server in front of Jupyter refuses a request body of a megabyte. It is bounded:
the destination has to be a single file directly inside `common/models`, and an
address that already holds a file is left alone, so a geometry produced outside
the browser is never replaced. When the page cannot tell whether a file is
there, it does not write.

The bytes are written to `model.glb.part`, and the file takes its real name only
when the last piece has landed. A write that fails, or that stops because the
person left the page, deletes its `model.glb.part`. One that could not be
deleted, because the tab was closed, can be seen in JupyterLab beside the model.
It is safe to delete, and the next conversion of that model replaces it anyway.

If the server in front of the workspace refuses a piece as too large, the write
starts over once in pieces of half the size.

It can fail without anything visible going wrong, and that is by design: a model
that is not stored simply converts again. The one case worth knowing about is a
workspace with Jupyter XSRF protection enabled, where the token sits in an
`HttpOnly` cookie that script cannot read, so every write is refused. The
failure is written to the browser console.

Producing the `.glb` outside the browser is still the better route for a large
model, with `ifc-to-glb` from the
[ifc-utils](https://github.com/INTO-CPS-Association/ifc-utils) repository, and
it is what the administrator documentation recommends. This is what happens
when nobody has.

### Recording Where an Artifact Came From

The manifest records the hash of the source it was made from and the name and
version of the converter that made it, and the schema refuses a manifest
without them. This is what makes a stale manifest detectable instead of merely
wrong. A `.glb` does not carry that record yet, whether `ifc-to-glb` wrote it
or the browser did: it names the tool that generated it and nothing about the
source.

## Live Readings

The viewer draws whatever readings it is given and subscribes to nothing. It
knows neither the broker nor the topic scheme, which is what lets the same
component serve a demonstration fed by a local publisher and a deployment fed
by the platform.

How readings reach the client is **still open**. Two shapes are possible and
they are not equivalent:

- The client subscribes to MQTT over WebSocket against the platform's RabbitMQ,
  through the `rabbitmq_web_mqtt` plugin, and passes the latest value to the
  viewer.
- A platform service, the MQTT Agent described in the DTaaS material,
  subscribes, validates, stores, and serves the latest value to the client.

The second is the better separation and depends on that service existing and
running, which has not yet been confirmed. Until it is settled the route shows
a model with no readings, which is the correct behaviour for a model that
declares no sensors anyway, and the majority of architectural models do.

## What Is Not Built Yet

- **History behind a click.** The manifest already carries the `history` block,
  with bucket, measurement and tags, so the Grafana address can be built from
  it. Opening that panel from a marker is not implemented.
- **Federation.** Several discipline models viewed together as one building is
  not supported. Each model is drawn on its own.
