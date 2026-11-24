# Digital Twin Capabilities: DTDL, WoT, WLDT and the Runner

How accurately can each of these technologies represent a digital twin
(DT)?

- **DTDL v4**, the Digital Twins Definition Language of Azure Digital
  Twins.
- **WLDT** 0.8.1, the Java library mapped in
  [wldt-code-map.md](wldt-code-map.md).
- **The runner** 0.10.0, this package, with the properties of
  [issue 19](issues/19-properties.md) where noted.

[The Web of Things](#the-web-of-things), the W3C's Thing Description
and Scripting API, follows as a fourth point of comparison.

Runner 0.11.0 has built issue 19, with suggestion C2: the properties
take the types of JSON Schema, and every number names its unit. A
property is not marked as sensed or computed, as the plan of issue 19
had it when this was written.

[Issue 21](issues/21-dt-class.md) has built C1 and C3, and W8 of the
WLDT notes. The state machine file is a class with an id and a
version, and `runner.yaml` sets the values of one instance. It does
so with typed values under `parameters`, not with the placeholders
that C3 proposed;
[CLASS-INSTANCE-INTERFACE.md](../CLASS-INSTANCE-INTERFACE.md) gives
the reasons. With W8, `runner.yaml` gives each peer a `relationship`.

Runner 0.12.0 to 0.14.0, issues [22](issues/22-timeline.md) to
[25](issues/25-replay.md), built a durable timeline of every change,
snapshots and reinstating, what-if inside the twin and a replay twin
([A Twin Over Time](#a-twin-over-time-history-transfer-and-trial)). The
tables below compare runner 0.10.0 where they say "today"; these
paragraphs say what later versions changed. The history row, for one,
now has the timeline as well.

A hospital twin serves as the running example: `hospital-1` and
`hospital-2` share the states `open`, `full` and `closed` and differ in
`capacity` and in the peers they follow.
Runner citations give `file:line` under `servers/execution/runner/`;
WLDT citations follow [wldt-research-notes.md](wldt-research-notes.md).
Statements marked _inference_ are this document's reading.

## What Each One Is

The three do not do the same job. DTDL describes a twin, WLDT mirrors
an asset's data, and the runner controls a twin's behaviour.

|               | DTDL v4                                             | WLDT 0.8.1                                         | Runner 0.10.0                                                                       |
| :------------ | :-------------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------- |
| Kind          | A modelling language in JSON-LD                     | A Java runtime library                             | A runtime service for one DT                                                        |
| Represents    | The twin's type: what any twin of that kind exposes | The current physical state of one asset            | The policy and control state of one twin: which behaviour runs, with which settings |
| Does not have | A runtime, behaviour or lifecycle                   | A portable description or explicit behaviour model | Mirrored physical state, until issue 19                                             |

DTDL's own definition: "a language for describing digital twin models
of smart devices, assets, spaces, and environments". Its metamodel
classes are Interface, Telemetry, Property, Command, Relationship and
Component, together with a schema language (DTDL v4, "Digital Twins
Definition Language").

In the terms of P1 of [dtn-research-notes.md](dtn-research-notes.md),
a DT's state is `s_i = (x_i, λ_i, θ_i)`:

- `x_i` is the state mirrored from the physical twin (PT);
- `λ_i` is the active policy;
- `θ_i` is the shared parameters.

WLDT is strong on `x_i`, the runner on `λ_i` and `θ_i`. DTDL describes
the shape of `x_i` and `θ_i` but not their values.

## Accuracy, Dimension by Dimension

"Partial" or "none" in a cell marks a gap that makes the representation
less faithful.

| Dimension                         | DTDL v4                                                                                                   | WLDT                                                                                        | Runner today                                                                     | Runner with issue 19                                           |
| :-------------------------------- | :-------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------- | :------------------------------------------------------------- |
| Model identity and version        | DTMI with a major.minor version; reuse by `extends` ("Model Versioning", "Digital Twin Model Identifier") | None; a twin is assembled in Java code                                                      | Instance `id` only; no model id or version                                       | Same                                                           |
| Model separate from instance      | Yes: an Interface is the model, and the platform holds the instances                                      | No                                                                                          | No: hospital-2's file repeats hospital-1's except `capacity` and `subscriptions` | Same                                                           |
| Observed state (`x_i`)            | Read-only `Property`; `Telemetry` for streams                                                             | Typed properties built from each adapter's asset description, committed in transactions     | None                                                                             | Latest value per property, `sensed` or `computed`, with `time` |
| Settings others change (`θ_i`)    | `writable: true` Property                                                                                 | Managed resources: abstract, no transport                                                   | Declared parameters; `controllable`; all-or-nothing writes; events on change     | Same                                                           |
| Data types                        | 19 primitives; Array, Enum, Map, Object; geospatial; scaled decimal                                       | Any Java class; `type` and `contentType` tags, never interpreted                            | `string`, `number`, `boolean`, `enum`                                            | The same four                                                  |
| Units and semantics               | QuantitativeTypes extension; RDF-compatible JSON-LD                                                       | An uninterpreted `type` tag                                                                 | None                                                                             | A free-text `unit`                                             |
| Operations                        | `Command` with request and response schemas                                                               | Fire-and-forget actions, with no result                                                     | Allow-listed commands; input not validated; outcome and logs returned            | Same                                                           |
| Behaviour and policy (`λ_i`)      | None; DTDL describes, it does not behave                                                                  | Hidden in the model's Java callbacks                                                        | An explicit state machine: states, transitions, completion events, escalation    | Same                                                           |
| Lifecycle and sync with the asset | Each Property has sync information, kept by the platform and outside the model ("Property")               | Bound, synchronized, out of sync; declared by the model (`DigitalTwinModel.java:2303-2316`) | Presence, health and script status; no sync flag (W6)                            | Per-value `time` shows a stale feed                            |
| Composition                       | `Component`: an Interface included by value                                                               | Several adapters merged into one state; no composition                                      | None: one DT per runner (S2)                                                     | Same                                                           |
| Relationships                     | Named, with target type, multiplicity, typed properties and `writable`                                    | Named relationships and instances; `targetId` never resolved                                | Peers with opaque `attributes`; the runner follows their notices                 | Same (W8 adds names)                                           |
| History                           | Historization extension                                                                                   | Opt-in storage; queries by time range, sample range, last value, count                      | Command history and the machine; values of parameters                            | Latest property values only, by design                         |
| Provenance and trust              | None                                                                                                      | None                                                                                        | Ed25519 roles, signed output, a separate script account                          | Properties signed like all output                              |

### Verdicts

- **DTDL** is the most precise **description**:
  - typed schemas, with units through an extension;
  - components and relationships with multiplicity;
  - inheritance and versioned identifiers.

  It represents nothing at run time, and it has no vocabulary for
  behaviour or lifecycle.

- **WLDT** gives the most faithful **snapshot of the physical asset**:
  typed state built from what each adapter declares, transactional
  commits, a lifecycle that the model declares, and stored history.
  Its weak points:
  - an opaque behaviour model;
  - a description that never leaves the JVM;
  - no versions;
  - a shallow copy that can corrupt the "previous state"
    (`DigitalTwinState.java:85-91`).
- **The runner** is the only one of the three that makes the
  **behaviour** explicit and inspectable: which policy is active, why
  it changed, and with which settings. Its outputs are signed, and it
  survives restarts. Its gaps:
  - observed state, which issue 19 fills;
  - the range of its types;
  - model identity;
  - typed relationships;
  - composition.

An accurate DT needs all three: a description (DTDL), mirrored state
(WLDT, or the runner's properties) and behaviour (the runner's state
machine). The runner with issue 19 and an exported description (a WoT
TD or DTDL, C4) would cover all three at its interface.

## The Hospital in DTDL

hospital-1 as a DTDL v4 Interface. The JSON parses, and all 27 element
names match DTDL's name rule. The official DTDL parser is a .NET
library that was not run, so the model is not validated beyond those
two checks.

```json
{
  "@context": "dtmi:dtdl:context;4",
  "@id": "dtmi:org:intocps:dtaas:Hospital;1",
  "@type": "Interface",
  "displayName": "Hospital",
  "contents": [
    {
      "@type": "Property",
      "name": "scope",
      "writable": true,
      "schema": "dtmi:org:intocps:dtaas:Hospital:scope;1"
    },
    {
      "@type": "Property",
      "name": "fidelity",
      "writable": true,
      "schema": "dtmi:org:intocps:dtaas:Hospital:fidelity;1"
    },
    {
      "@type": "Property",
      "name": "capacity",
      "schema": "integer"
    },
    {
      "@type": "Property",
      "name": "state",
      "schema": "dtmi:org:intocps:dtaas:Hospital:state;1"
    },
    {
      "@type": "Property",
      "name": "freeBeds",
      "schema": "integer"
    },
    {
      "@type": "Property",
      "name": "occupancy",
      "schema": "double"
    },
    {
      "@type": "Property",
      "name": "overflowTo",
      "schema": "string"
    },
    {
      "@type": "Property",
      "name": "freeBedsIn2h",
      "schema": "integer"
    },
    {
      "@type": "Command",
      "name": "admit",
      "request": {
        "name": "admission",
        "schema": {
          "@type": "Object",
          "fields": [
            {
              "name": "patient",
              "schema": "string"
            },
            {
              "name": "ward",
              "schema": "string"
            }
          ]
        }
      }
    },
    {
      "@type": "Command",
      "name": "discharge",
      "request": {
        "name": "discharge",
        "schema": {
          "@type": "Object",
          "fields": [
            {
              "name": "patient",
              "schema": "string"
            }
          ]
        }
      }
    },
    {
      "@type": "Command",
      "name": "close"
    },
    {
      "@type": "Command",
      "name": "reopen"
    },
    {
      "@type": "Relationship",
      "name": "neighbour",
      "target": "dtmi:org:intocps:dtaas:Hospital;1",
      "properties": [
        {
          "@type": "Property",
          "name": "distance",
          "schema": "double"
        }
      ]
    }
  ],
  "schemas": [
    {
      "@id": "dtmi:org:intocps:dtaas:Hospital:scope;1",
      "@type": "Enum",
      "valueSchema": "string",
      "enumValues": [
        {
          "name": "single",
          "enumValue": "single"
        },
        {
          "name": "multi",
          "enumValue": "multi"
        }
      ]
    },
    {
      "@id": "dtmi:org:intocps:dtaas:Hospital:fidelity;1",
      "@type": "Enum",
      "valueSchema": "string",
      "enumValues": [
        {
          "name": "low",
          "enumValue": "low"
        },
        {
          "name": "medium",
          "enumValue": "medium"
        },
        {
          "name": "high",
          "enumValue": "high"
        }
      ]
    },
    {
      "@id": "dtmi:org:intocps:dtaas:Hospital:state;1",
      "@type": "Enum",
      "valueSchema": "string",
      "enumValues": [
        {
          "name": "open",
          "enumValue": "open"
        },
        {
          "name": "full",
          "enumValue": "full"
        },
        {
          "name": "closed",
          "enumValue": "closed"
        }
      ]
    }
  ]
}
```

What maps across, and what does not:

- **Maps cleanly:**
  - parameters become Properties, `writable` when controllable;
  - the properties of issue 19 become read-only Properties;
  - `manager.commands` and the external events `close` and `reopen`
    become Commands. The request shapes come from the scripts:
    `admit.ps1` reads `{"patient", "ward"}` on stdin, and
    `discharge.ps1` reads `{"patient"}`;
  - peers become a `neighbour` Relationship whose `distance` is a
    typed property instead of an opaque attribute.
- **Does not map:** DTDL has no vocabulary for behaviour, which is what
  the runner adds.
  - The state machine shrinks to an enum `state` Property.
  - Which commands are allowed in which state is lost.
  - So are completion events, escalation, peer subscriptions, and the
    effect of `fidelity`.
- **Names clash.** A DTDL name contains only letters, digits and
  underscores, starts with a letter and ends with a letter or digit.
  The runner's names fail that rule: `free-beds`, `neighbour-full` and
  `$success`. An export needs a mapping, such as `free-beds` to
  `freeBeds`.
- **Telemetry or Property?** DTDL's `Telemetry` is a stream that is not
  kept as state. The properties of issue 19 keep the latest value, so
  they are Properties.

## The Web of Things

The W3C Web of Things (WoT) is a fourth point of comparison. Both of
its documents read here are Editor's Drafts (`specStatus: "ED"`):

- **Thing Description (TD) 2.0** continues the TD 1.1 Recommendation
  of 5 December 2023.
- **The Scripting API** has Eclipse Thingweb's node-wot as its
  reference implementation.

Neither document uses the term "digital twin".

### What WoT Provides

**Thing Description.** A JSON-LD document that describes one thing.
The spec calls it "the entry point of a Thing (much like the index.html
of a Web site)". It has five parts:

- metadata;
- interaction affordances: properties, actions and events;
- data schemas: a JSON Schema subset with `unit`, ranges, `readOnly`
  and `writeOnly`;
- security definitions;
- links to other things.

Each affordance carries **forms**, its protocol bindings: an `href`,
an operation and a content type. One affordance may have HTTP and MQTT
forms side by side.

- **Properties** may be `observable`. Their operations are
  `readproperty`, `writeproperty`, `observeproperty` and
  `unobserveproperty`.
- **Actions** have `input` and `output` schemas and the flags `safe`,
  `idempotent` and `synchronous`. Their operations are `invokeaction`,
  `queryaction` and `cancelaction`.
- **Events** have a `data` schema, and `subscription` and
  `cancellation` schemas. Those schemas let a consumer set up a
  webhook (TD, "Webhook Event Example").

**Thing Model (TM).** A template for TDs that leaves out communication
and security details. It adds:

- `{{PLACEHOLDER}}` values, substituted when a TD is derived;
- `tm:extends` for inheritance and `tm:ref` for imports;
- `tm:submodel` for composition;
- `version.model`.

**Scripting API.** The runtime side:

- `WOT.produce(td)` returns an **ExposedThing**. Handlers are attached
  with `setPropertyReadHandler`, `setActionHandler` and their
  siblings; values are pushed with `emitPropertyChange` and
  `emitEvent`; `expose()` starts serving.
- `WOT.consume(td)` returns a **ConsumedThing**, with `readProperty`,
  `observeProperty`, `invokeAction` and `subscribeEvent`.
- `discover()` and `exploreDirectory()` find things, including through
  TD directories.

### WoT Against the Other Three

| Dimension               | WoT (TD 2.0, Scripting API)                                                                             | DTDL v4                                 | WLDT                    | Runner                                                                             |
| :---------------------- | :------------------------------------------------------------------------------------------------------ | :-------------------------------------- | :---------------------- | :--------------------------------------------------------------------------------- |
| What is described       | An instance and how to reach it (TD); a class (TM)                                                      | A class (Interface)                     | Nothing portable        | Its own descriptor at `/dt`, in a format of its own                                |
| Model against instance  | A TM with placeholders, from which TDs are derived                                                      | Interface against platform twin         | None                    | None (C3)                                                                          |
| Protocol bindings       | Forms per operation (HTTP, MQTT, CoAP), several per affordance                                          | MQTT extension only                     | Adapter code            | Every route over HTTP and MQTT, undescribed                                        |
| State                   | Properties: observable, read-only, write-only                                                           | Property, Telemetry                     | Typed properties        | Machine and parameters; properties with issue 19                                   |
| Operations              | Actions: input, output, `synchronous`, `idempotent`, `safe`; query and cancel                           | Command with request and response       | Fire-and-forget actions | Synchronous commands; asynchronous transitions and events (`202`, then `GET /fsm`) |
| Events                  | Events with `data`, subscribe and cancel; webhooks                                                      | Telemetry, roughly                      | Bus events in the JVM   | Notifications: state, escalation, presence                                         |
| Data types              | JSON Schema subset: `integer`, `number`, `string`, `boolean`, `object`, `array`, `null`; `unit`, ranges | 19 primitives, complex schemas          | Java classes            | Four types                                                                         |
| Semantics               | JSON-LD; ontologies such as SAREF and SSN; state annotations that link data to physical state           | JSON-LD; QuantitativeTypes              | Tag strings             | None                                                                               |
| Relationships           | `links` with `rel`; no multiplicity, no typed link properties                                           | Typed, with multiplicity and properties | Name and target id      | Peers with opaque attributes                                                       |
| Composition             | `tm:submodel`                                                                                           | Component                               | None                    | None                                                                               |
| Security                | Described, for example `bearer` with `format: jws` and `alg`; enforcement is the implementation's       | None                                    | None                    | Enforced: Ed25519 request tokens, roles, signed output                             |
| Discovery               | Discovery and TD directories                                                                            | None                                    | None                    | None, by design (S8)                                                               |
| Behaviour and lifecycle | None: handlers are opaque code; the lifecycle is `expose()` and `destroy()`                             | None                                    | Hidden in callbacks     | An explicit state machine                                                          |

### The Runner as a WoT Thing

The runner already behaves like a WoT server for one thing:

| Runner                                                          | WoT                                                 |
| :-------------------------------------------------------------- | :-------------------------------------------------- |
| `/dt`, the descriptor                                           | the TD                                              |
| every route over HTTP and MQTT                                  | two forms per affordance                            |
| the retained `notify/state` notification                        | `observeproperty`                                   |
| escalation and presence notifications                           | events                                              |
| controllable parameters                                         | writable properties                                 |
| `manager.commands` through `POST /`                             | actions with `synchronous: true`                    |
| `POST /fsm/event` and `/fsm/transition`, `202`, then `GET /fsm` | actions with `synchronous: false` and `queryaction` |
| following peers (13, 16)                                        | `ConsumedThing.observeProperty` on each peer        |
| scripts                                                         | action handlers                                     |

hospital-1, in part, as a TD. It parses as JSON. It was not checked
against the TD's JSON Schema, and the MQTT terms follow the TD's own
example binding (prefix `mqv`).

```json
{
  "@context": [
    "https://www.w3.org/ns/wot-next/td",
    {
      "mqv": "http://www.example.org/mqtt-binding#"
    }
  ],
  "id": "urn:dtaas:hospital-1",
  "title": "hospital-1",
  "links": [
    {
      "rel": "type",
      "href": "./hospital.tm.jsonld",
      "type": "application/tm+json"
    }
  ],
  "securityDefinitions": {
    "jws_sc": {
      "scheme": "bearer",
      "format": "jws",
      "alg": "EdDSA"
    }
  },
  "security": "jws_sc",
  "properties": {
    "parameters": {
      "type": "object",
      "observable": false,
      "properties": {
        "scope": {
          "type": "string",
          "enum": ["single", "multi"]
        },
        "capacity": {
          "type": "integer",
          "readOnly": true
        }
      },
      "forms": [
        {
          "href": "http://localhost:5100/parameters",
          "op": ["readproperty", "writeproperty"]
        },
        {
          "href": "mqtt://localhost:1883",
          "mqv:filter": "dtaas/hospital-1/parameters",
          "op": "readproperty"
        }
      ]
    },
    "state": {
      "type": "object",
      "readOnly": true,
      "observable": true,
      "forms": [
        {
          "href": "http://localhost:5100/state",
          "op": "readproperty"
        },
        {
          "href": "mqtt://localhost:1883",
          "mqv:filter": "dtaas/hospital-1/notify/state",
          "mqv:controlPacket": "subscribe",
          "op": "observeproperty"
        }
      ]
    }
  },
  "actions": {
    "admit": {
      "input": {
        "type": "object",
        "properties": {
          "patient": {
            "type": "string"
          },
          "ward": {
            "type": "string"
          }
        }
      },
      "synchronous": true,
      "forms": [
        {
          "href": "http://localhost:5100/",
          "op": "invokeaction"
        }
      ]
    },
    "close": {
      "synchronous": false,
      "idempotent": false,
      "forms": [
        {
          "href": "http://localhost:5100/fsm/event",
          "op": "invokeaction"
        },
        {
          "href": "http://localhost:5100/fsm",
          "op": "queryaction"
        }
      ]
    }
  },
  "events": {
    "escalation": {
      "data": {
        "type": "object",
        "properties": {
          "trigger": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        }
      },
      "forms": [
        {
          "href": "mqtt://localhost:1883",
          "mqv:filter": "dtaas/hospital-1/notify/escalation",
          "mqv:controlPacket": "subscribe",
          "op": "subscribeevent"
        }
      ]
    }
  }
}
```

Where the runner and WoT do not line up:

1. **Generic routes against one endpoint per affordance.** The runner
   names the command or the event in the body: `POST /` with
   `{name: "admit", input}`, and `POST /fsm/event` with
   `{event: "close"}`. A TD expects each affordance to have its own
   form, so the sketch simplifies here: its `admit` input leaves out
   the runner's wrapper. An exact TD needs per-affordance routes (C7),
   or forms that fix the body. This is the largest gap.
2. **Part of the runner's security cannot be described.** A TD can say
   "a bearer token, JWS, EdDSA". It cannot say that the token is bound
   to the method, the path and a hash of the body (15a), nor that the
   runner signs its output (15b). The TD has no term for a signed
   payload; it treats tampering only as a security consideration.
3. **Who chooses the webhook.** In WoT, the consumer passes its
   callback when it subscribes. The runner's webhook is fixed by the
   operator in `runner.yaml` (03).
4. **Handlers in the same process.** `setActionHandler` runs JavaScript
   inside the server, which is the model that [xstate.md](xstate.md)
   argues against for code written by DT authors. In WoT terms, the
   runner is an ExposedThing whose handlers are separate processes,
   under another account (18).
5. **Discovery.** WoT expects things to be found through directories.
   The runner lists its peers by hand (S8); a TD directory could become
   an optional source of that list.
6. **Behaviour.** The TD's state annotations link data to an ontology's
   notion of state; they describe no transitions. Which commands are
   allowed in which state, completion events and escalation have no WoT
   equivalent, just as they have none in DTDL.

### Verdict

- **WoT fits the runner better than DTDL.** A TD describes a networked
  service: its bindings, operations, asynchronous actions and security.
  The runner is such a service.
- **DTDL fits better for ingestion into a platform** such as Azure
  Digital Twins, and for typed relationships and composition.
- **Behaviour.** Neither standard can express the runner's state
  machine. That part of the twin stays the runner's own.

## Models and Simulations

### What "Model" Means in Each

| Technology | What "model" means                                                                                                                                                                                                                                                                                                             | Kind                                            | Does it run?                                                                   |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- | :----------------------------------------------------------------------------- |
| DTDL       | An Interface, identified by a DTMI: a reusable, versioned type that lists the telemetry, properties, commands, relationships and components of a twin. DTDL calls itself "a language for describing digital twin models" (DTDL v4, "Introduction").                                                                            | A type or schema                                | No. Twins that conform to it live in a platform such as Azure Digital Twins.   |
| WoT        | A Thing Model: a template for Thing Descriptions, without protocol or security details, with placeholders, `tm:extends` and `tm:submodel`. A Thing Description is one instance (TD 2.0, "Thing Model").                                                                                                                        | A class or template                             | No. Behaviour is the handler code of the Scripting API.                        |
| WLDT       | `DigitalTwinModel`, the "shadowing function": Java callbacks that turn physical events into changes of the twin's state and route digital actions to the asset. The model captures the asset "at an appropriate level of abstraction ... modeling only domain-level information" (WLDT docs, `docs/introduction/dt-model.md`). | Behaviour code that maps data                   | Yes, inside the JVM. It mirrors the asset; it does not simulate it.            |
| Runner     | Two kinds. The state machine file is the policy model: states, transitions, parameters. The computational models, `M_i` in P1 (simulators, FMUs, analytic scripts), sit in the scripts directory and are opaque to the runner.                                                                                                 | A policy model, and opaque computational models | Scripts run the computational models as processes; the runner runs the policy. |

DTDL and WoT models describe a twin's interface. WLDT's model maps data.
The runner holds a policy model, and its scripts hold the computational
models, which are the ones that simulators execute.

### How Each Handles Simulations

| Technology | Support                                                                                                                                                                      | How a simulation fits in                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTDL       | None. The spec does not mention simulation.                                                                                                                                  | Outputs are modelled as data. Telemetry covers "a computed stream of data, such as occupancy" (DTDL v4, "Telemetry"), so a simulator's output is a Property or Telemetry. The simulator runs outside DTDL, such as a platform function that updates the twin.                                                                                                                                                                                                  |
| WoT        | None as a concept. "Simulator" appears only in an example's description string, "Smart Pump live plant and simulator" (TD 2.0, "Derivation of Thing Description Instances"). | A Thing may be "a physical or a virtual entity", so a simulator can be a Thing of its own. A run is an Action with `input`, `output` and `synchronous: false`, which a consumer can query with `queryaction` or stop with `cancelaction`. Actions "model invocation of physical (and hence time-consuming) processes" (TD 2.0, "Introduction"). Results are properties or events. The code runs in a Scripting API handler.                                    |
| WLDT       | Augmentation functions (0.7.0 and later) are the explicit hook for computation.                                                                                              | Stateless functions run once per request; the guide's example is `StatelessPredictionFunction` (WLDT docs, `docs/guides/augmentation_functions.md`). Stateful functions start and stop, and receive state updates or query history. Results are typed suggestions, such as a `PROPERTY_RESULT` with a "predicted temperature", which the model may apply or ignore. They run in the JVM, at most five handlers, with no simulation clock and no co-simulation. |
| Runner     | Scripts run simulators; this is the runner's main use.                                                                                                                       | A state's script starts the simulator. The `fidelity` parameter (17c) selects the model's fidelity, and the resource figures (17a, 17b) show its cost. Results come back through the outcome (`$success`, `$failure`), stdout, events (`POST /fsm/event`), escalation proposals and, with [issue 19](issues/19-properties.md), computed properties. Intermediate data stays in the run directory.                                                              |

None of the four handles three things:

- **Simulation time.** None has a simulated clock, a forecast horizon,
  or a time at which a result is valid, as distinct from the time it
  was written.
- **Co-simulation.** None coordinates several models, in the manner of
  FMI with Maestro.
- **Simulated against measured values.** None keeps a simulated and a
  measured value side by side and flags when they diverge, which is the
  check that separates a digital twin from a digital shadow.

For the runner, the first gap is the smallest. It can be a convention,
as fidelity is (17c), and needs no runtime feature (C8). Co-simulation
belongs inside the scripts.

## A Twin Over Time: History, Transfer and Trial

The dimensions above describe a twin at one moment. A fourth question
is what can be done with a twin over time: read its past, move it,
and try a change without touching it. Fluid Digital Twins (FDT), the
WLDT authors' later work (see [Sources](#sources)), make this a
capability of its own, and issues [22](issues/22-timeline.md) to
[25](issues/25-replay.md) built it for the runner, by version 0.14.0.

| Capability                          | DTDL v4                                               | WoT                                                | WLDT with FDT                                                            | Runner                                                       |
| :---------------------------------- | :---------------------------------------------------- | :------------------------------------------------- | :----------------------------------------------------------------------- | :----------------------------------------------------------- |
| The past of a twin                  | Not in the language; the platform keeps a history     | Not in the TD; a consumer records what it observes | `S_DT` at each timestamp, as a sequence; storage and queries in the core | The command history; a timeline of every change (22)         |
| A twin as one document              | An instance of an Interface, exported by the platform | None: a TD describes, and holds no values          | Not defined: "computational state" is synchronised, with no format       | A snapshot: the database, the class, the scripts' files (23) |
| Moving work to another place        | None                                                  | None; a TD may point at another server             | Fluid functions offloaded between PT, edge and cloud                     | Commands, the simulation bridge; a twin by snapshot (23)     |
| A second twin to try a change       | None                                                  | None                                               | A Test-FDT: history, parallel and simulation                             | A command on a copy (24); a replay twin, replayed (25)       |
| Keeping a trial from the real asset | Not applicable                                        | Not applicable                                     | A "controlled environment", not specified                                | A copy (24); a replay twin whose class allows one (25)       |
| Time in a trial                     | Not applicable                                        | Not applicable                                     | The clock; scaled only inside the simulator                              | In a replay: the clock, at a factor for scripts (25)         |

The parallel kind of test twin, which follows a live twin, is not
planned for the runner.

What this adds to the verdicts:

- **A description standard can not say this.** Neither DTDL nor a
  Thing Description has a place for the past of a twin or for a
  second copy of it. Both are about the interface, which a twin and
  its fork share by being of one class.
- **FDT has the richest patterns and the least defined state.** It
  shows that history, parallel and simulation runs are worth having,
  and measures what they cost. It does not say what is transferred.
  The runner's state is small and explicit: a machine, parameters,
  properties and peer switches. That makes the runner's part of a
  snapshot a short document. What the scripts keep is saved by a
  script that the class names, as only its author knows it.
- **The runner's gap is the other way round.** It has the document
  and the record, and has nothing like the fluid layer: it
  can not decide by itself where a computation runs. For the runner
  that decision is the Manager's or the platform's.

## IoT and DT Concepts

How each technology captures common concepts of IoT and DT applications.
In the runner column, plain text is what exists today, **bold** is
issue 19, and _italic_ is a proposal.

| Concept                                                   | WoT (TD, TM, Scripting API)                                                                                                                                                         | DTDL v4                                                                                                         | WLDT                                                                                                                                                                                | Runner                                                                                                                                                                                                                                                                                          |
| :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Things or entities (room, sensor, door)                   | A Thing, physical or virtual; the Thing Model as class; a semantic `@type` such as `saref:TemperatureSensor`; parts through `tm:submodel`                                           | An Interface as type and a twin in the platform; a Component for parts by value                                 | A `DigitalTwin` per physical asset; the `DigitalTwinEngine` hosts many in one JVM                                                                                                   | One twin per runner, named by `id`; other twins are peers. No sub-entities: a room's sensors are not things of the runner                                                                                                                                                                       |
| Attributes: static information (sensor id, model)         | Thing-level metadata (`title`, `version`, `id`) and terms of any ontology through `@context`, such as `schema:serialNumber` (TD 2.0, "Example I"); `const` or `readOnly` properties | A read-only Property; the spec's own example is a serial number (DTDL v4, "Property"); the Annotation extension | A property of the asset description with `immutable`, which is not enforced, or a state property that is not writable                                                               | `attributes` in `runner.yaml`, an opaque map shown in `/dt`; uncontrollable parameters for values that scripts read                                                                                                                                                                             |
| Properties: changing values, telemetry in IoT             | A PropertyAffordance, `observable`; a stream may also be an Event                                                                                                                   | Telemetry, a stream that is not stored; Property, kept as state                                                 | Physical property events become state properties; history if storage is on                                                                                                          | None today; **properties: the latest value, `sensed` or `computed`, with `time`**                                                                                                                                                                                                               |
| Events (door opened, temperature too low)                 | An EventAffordance with `data`. Events "MAY be triggered through conditions that are not exposed as Properties", such as a threshold (TD 2.0, "EventAffordance")                    | No Event class. Telemetry also covers "an occasional alert or information message" (DTDL v4, "Telemetry")       | Events in the asset description, published again by the model as transient event notifications                                                                                      | FSM events move the machine: from clients, scripts, peers, parameter changes, and `$success`, `$failure`, `$stopped`. Outbound notifications: state, escalation, presence. _W9: domain events_                                                                                                  |
| Actions (open door, close door)                           | An ActionAffordance: `input`, `output`, `synchronous`, `idempotent`, `safe`; query and cancel                                                                                       | A Command with a request and a response                                                                         | A digital action routed by the model to a physical action; fire-and-forget                                                                                                          | Commands (`POST /`, the allow-list, `manager.commands`) with outcome and logs; transitions and events as asynchronous actions on the twin. The physical effect is in the script                                                                                                                 |
| State (room is comfortable, room is under repair)         | No first-class concept: a property, with state annotations that link data to an ontology's notion of state, such as `saref:hasState` and `ssn:forProperty` (TD 2.0, "Example II")   | No first-class concept: an enum Property                                                                        | `DigitalTwinState` is the snapshot of values; a qualitative state would be a property that the model computes. The lifecycle (bound, synchronized) is about the twin, not the asset | First-class: the state of the state machine (`open`, `full`, `closed`), with entry count, script status, persistence and history. "Under repair" is a state with its own script                                                                                                                 |
| Rules: conditions on data or events that produce triggers | None in the TD; rules are application code that consumes, observes and invokes                                                                                                      | None in the language; platforms run them outside, in event routes and functions                                 | Java code in the model's callbacks; augmentation functions for derived logic                                                                                                        | Partly declarative: transitions (an event leads to a state); peer subscriptions (`when: {state: full}` raises an event, edge-triggered); a parameter's `event`; the escalation flags. Conditions on data, such as thresholds, live in scripts. No guards (_option B of [xstate.md](xstate.md)_) |
| Triggers: anything that starts the evaluation of rules    | Events and observed properties, which the consumer subscribes to                                                                                                                    | None                                                                                                            | Messages on the event bus invoke the model's callbacks: physical events, digital actions, lifecycle changes                                                                         | Anything that raises an FSM event: a client or Manager request, a script's call, a script's completion, a parameter change, a peer's condition. Escalation has its own triggers (`request`, `failure`, `no-transition`). No time triggers (_XState's `after`_)                                  |
| Relations (the thermometer is in the office room)         | `links` with `rel` and `anchor`; `tm:submodel`; no multiplicity and no typed link properties                                                                                        | A Relationship: `target`, multiplicity, typed `properties`, `writable`; a Component for parts                   | A relationship (name, type) with instances (`targetId`, metadata), from the asset description; `targetId` is never resolved                                                         | Peers (`id`, `topic`, `url`, opaque `attributes`), followed through signed notices. Relations exist only between twins. _W8 and C5: named, typed relationships_                                                                                                                                 |

What the table shows:

- **The runner's strengths are state, rules and triggers.** It is the
  only one of the four with a first-class qualitative state, partly
  declarative rules (transitions, subscriptions, escalation) and an
  explicit list of triggers. The two standards describe things and
  data, WLDT mirrors data, and in all three of them behaviour is code.
- **The runner's gaps are on the data side:**
  - properties, which issue 19 fills;
  - events as domain notifications (W9);
  - typed relations (C5);
  - time triggers;
  - sub-entities. The runner models one twin per process, so a room's
    thermometer is either a value of the room (a property) or a twin of
    its own (a peer). Nothing in the runner matches DTDL's Component or
    WoT's `tm:submodel`.
- **Simulations fit the runner's model.** A simulator is a script, its
  fidelity a parameter, its cost the resource figures, and its outputs
  computed properties. The missing pieces are conventions for
  simulation time and for comparing simulated with measured values.

## Suggestions for the Runner

In priority order. C2, C3 and C4 take the Web of Things into account;
C8 comes from [Models and Simulations](#models-and-simulations). C1,
C2 and C3 are built (issues 19 and 21); the rest are open, in the
proposed work of [issues/README.md](issues/README.md#proposed-work).

| #   | Suggestion                                 | Size | Notes                                                                                                                                                                                                                                                                                                                                                  |
| :-- | :----------------------------------------- | :--- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Model identity                             | S    | An optional model identifier and version in the state machine file, shown in `/dt`, such as a DTMI or a Thing Model URI. A Manager can then tell that hospital-1 and hospital-2 are the same kind of twin.                                                                                                                                             |
| C2  | Standard types in issue 19, before release | S    | Use the TD's JSON Schema types: `integer`, `number`, `string`, `boolean`, `object`, `array`, with `unit` and ranges. They map onto DTDL too (`number` to `double`), and zod validates them as they are. This also answers 19's open `json` question. Changing types after release breaks configs.                                                      |
| C3  | Model separate from instance               | M    | The state machine file becomes a model with placeholders, in the manner of a WoT Thing Model (`"capacity": "{{CAPACITY}}"`). `runner.yaml` supplies each instance's values, such as `capacity: 1` for hospital-2. The author sets the model, the operator the instance. This amends S4 and fits the split of [issue 20](issues/19-properties.md#spec). |
| C4  | Export the descriptor                      | M    | First as a TD: `GET /dt` with `Accept: application/td+json`, carrying both bindings and the security scheme. Then as DTDL for platforms such as Azure Digital Twins, with names mapped. Together they give the description side of deferred item 14.                                                                                                   |
| C5  | Typed relationships                        | M    | W8 together with DTDL: a peer gets a relationship name, a target model and typed relationship properties, in place of opaque `attributes`. WoT links carry no multiplicity or typed properties, so DTDL is the model here.                                                                                                                             |
| C6  | No telemetry streams                       | –    | Issue 19's properties are DTDL Properties and observable TD properties. A true telemetry stream is data-plane work and stays out, unless a stream-only notification kind is needed later.                                                                                                                                                              |
| C7  | One endpoint per affordance                | M    | Routes such as `POST /actions/<name>`, `POST /events/<name>` and `GET /properties/<name>`, beside today's generic routes, so that a TD can describe each operation exactly. They only add routes, so nothing breaks.                                                                                                                                   |
| C8  | Simulation-time convention                 | S    | A convention, like fidelity (17c): a computed property carries a companion `<name>-valid-at` property, or the state machine file declares a `horizon` parameter, so a reader can tell when a simulated value applies. No runtime feature; documentation and the hospital's `free-beds-in-2h` as the example.                                           |

## Sources

- DTDL v4:
  <https://github.com/Azure/opendigitaltwins-dtdl/blob/master/DTDL/v4/DTDL.v4.md>,
  read in full on 2026-11-20. Also the Overriding extension
  (`DTDL.overriding.v2.md`). It overrides an extension property of an
  element, such as a `unit`, from an instance; it is not a general way
  for an instance to override a model.
- Web of Things, both Editor's Drafts, read on 2026-11-20:
  - Thing Description 2.0: <https://w3c.github.io/wot-thing-description/>;
  - Scripting API: <https://w3c.github.io/wot-scripting-api/>.
- FDT: Bedogni, Mamei, Picone, Pietri, Zambonelli, "Fluid Computing &
  Digital Twins for intelligent interoperability in the IoT
  ecosystem", _Future Generation Computer Systems_ 171 (2025) 107855,
  doi:10.1016/j.future.2025.107855, sections 2 to 4. Its lessons are
  in [integrated-simulations.md](integrated-simulations.md#fluid-digital-twins-offloading-and-a-twin-beside-itself).
- WLDT: [wldt-code-map.md](wldt-code-map.md) and
  [wldt-docs-and-paper.md](wldt-docs-and-paper.md).
- Runner at `e5c12fd4`: the state machine files and scripts of two
  hospital twins, `src/fsm/parameters.ts`,
  `docs/issues/19-properties.md`, `docs/dtn-research-notes.md`.
