# WLDT (White Label Digital Twins): documentation and paper, primary-source summary

Prepared 2026-11-18 for the comparison with the runner in
[wldt-research-notes.md](wldt-research-notes.md). The code is mapped in
[wldt-code-map.md](wldt-code-map.md).

## Sources and versions covered

- **Docs**: `https://github.com/wldt/wldt.github.io`, read at commit `3f75b020`
  (2026-11-06). Hugo site; only the Markdown under `content/` and images under
  `assets/images/` were read. Nothing was built or run. Doc paths below are
  relative to `content/`.
  - The docs cover the **Java** library `wldt-core` up to **v0.8.1**
    (`blog/release_081.md`, dated 2026-11-06). Change logs exist for 0.3.0,
    0.4.0, 0.5.0, 0.6.0, 0.7.0, 0.8.0 and 0.8.1 (`docs/change-logs/`).
  - Adapter pages cover separate artifacts with their own versions:
    `mqtt-physical-adapter` 0.1.1, `mqtt-digital-adapter` 0.1.1,
    `http-digital-adapter` 0.2, `coap-physical-adapter` 0.1.2,
    `coap-digital-adapter` 0.1.1; compatibility tables stop at wldt-core 0.4.0
    (`docs/adapters/*.md`).
  - **No other language version** (Python etc.) is documented anywhere in the
    repo (grep for `python`, `kotlin` returned nothing). No OPC-UA adapter and
    no MongoDB storage adapter are documented; MongoDB/Redis appear only as
    hypothetical `WldtStorage` subclasses in an example
    (`docs/guides/storage.md`).
- **Paper**: M. Picone, M. Mamei, F. Zambonelli, "WLDT: A general purpose
  library to build IoT digital twins", _SoftwareX_ 13 (2021) 100661,
  doi:10.1016/j.softx.2021.100661, CC BY. **Read in full** (7 pages).
  ScienceDirect and the UNIMORE IRIS repository both returned bot challenges
  (HTTP 403 / Cloudflare); the PDF was obtained from the Internet Archive
  snapshot of the IRIS copy
  (`web.archive.org/web/20231203073443id_/https://iris.unimore.it/bitstream/11380/1232320/1/1-s2.0-S2352711021000066-main.pdf`).
  Figure values were read from the rendered page images and are approximate.

---

## Part 1. Documentation (current, v0.8.1)

### 1.1 Concept model

**Digital Twin (DT).** "A comprehensive software representation of any
individual Physical Asset (PA) in the real world. It includes the properties,
conditions, relationships, and behavior(s) of the real-life object through
models and data", with "the responsibility to represent and reflect its physical
counterpart over time maintaining its digital replica across the object's entire
lifecycle" (`_index.md`). WLDT treats DTs "as active, flexible and scalable
software components" (`_index.md`, `about/_index.md`).

**Physical Asset (PA).** "Any entity that has a manifestation or relevance in
the physical world and a well-defined lifespan"
(`docs/introduction/dt-model.md`).

**Abstract DT blueprint** (`docs/introduction/dt-model.md`):

- _Physical Interface_: does the initial digitalization (shadowing) and keeps DT
  and PA in sync; runs multiple **Physical Asset Adapters**.
- _Digital Interface_: exposes DT variations and events to external consumers;
  runs multiple reusable **Digital Adapters**.
- _DT's Model (M)_: defines behaviour and augmented functionality and keeps the
  **Digital Twin State** updated. M captures the PA "at an appropriate level of
  abstraction ... modeling only domain-level information rather than
  technological ones".

**Digital Twin State (S_DT)** = properties + events + relationships + actions,
plus a timestamp of the current synchronization
(`docs/introduction/dt-model.md`):

- _Properties_: observable attributes whose values change over time.
- _Events_: domain-level events observable in the PA.
- _Relationships_: links to other assets via their DTs; part of the operational
  context, not the PA's state.
- _Actions_: invocable on the PA via the DT, or on the DT alone when it augments
  the PA.

Since 0.3.0 the state carries an `evaluationInstant` computed by the
`DigitalTwinStateManager`, not settable by the developer
(`docs/change-logs/change-log-0.3.0.md`). Since 0.8.1 each property, event and
action carries a semantic `type` and a format `contentType`; the core never
interprets either, it only stores and forwards them
(`docs/change-logs/change-log-0.8.1.md`).

**Shadowing.** "The process that enables continuous and (almost) real-time
updating of the internal state of the DT in relation to changes that occur in
the PA". Each relevant PA change becomes a `physical_event` (e_pa), is
propagated to the DT, and the DT applies a _shadowing function_ that depends on
M. Digital actions arrive on the digital interface, are validated by the
shadowing function and forwarded to the physical interface. "A `digital_action`
does not directly change the state of the DT since any changes can only occur as
a result of the shadowing function from the PA to the DT"
(`docs/introduction/dt-model.md`).

**Physical Asset Description (PAD).** Lists the properties, actions, events and
relationships a PA exposes _through one adapter's protocol_. Each Physical
Adapter publishes its own PAD; the DT merges them; the shadowing function picks
which parts to digitalize (`docs/introduction/dt-life-cycle.md`,
`docs/introduction/library-structure.md`). PAD elements: `PhysicalAssetProperty`
(key, type, contentType, initialValue, optional immutable/writable flags),
`PhysicalAssetEvent` (key, type, contentType), `PhysicalAssetAction` (key, type,
contentType of the request body), `PhysicalAssetRelationship`
(`docs/guides/physical-adapter.md`, `docs/guides/dt-relationships.md`).

**Library layers** (`docs/introduction/library-structure.md`, image
`assets/images/wldt_structure.jpg`):

| Layer        | Components                                                                                                                   |
| :----------- | :--------------------------------------------------------------------------------------------------------------------------- |
| Adapters     | Physical Adapters (MQTT, CoAP, ...) on a Physical Adapter Core; Digital Adapters (MQTT, CoAP, ...) on a Digital Adapter Core |
| DT Modelling | DT Model, Shadowing Function, DT Life Cycle, DT State                                                                        |
| WLDT Core    | Digital Twin, Digital Twin Engine, Event Communication Bus, Metrics Manager, Logger, Utils & Commons                         |

Component responsibilities as documented
(`docs/introduction/library-structure.md`):

- **Digital Twin Engine**: "multi-thread engine ... allowing the execution and
  monitoring of multiple DTs (and their core components) simultaneously";
  orchestrates internal modules. "Currently, it supports the execution of twins
  on the same Java process, however the same engine abstraction might be used to
  extend the framework to support distributed execution for example through
  different processes or microservices."
- **Event Communication Bus**: internal bus; components publish events and
  register an Event Filter with a callback per event type.
- **Shadowing Function**: "based on a specific implementation of a WLDT Worker
  called Model Engine"; observes the DT life cycle; must be extended by the DT
  designer.
- **Storage Layer**: manual or automatic storage of state, events and
  variations.
- Minimum viable DT: one shadowing function (model), at least one Physical
  Adapter and one Digital Adapter, added to a `DigitalTwinEngine`.

**Kernel/Model split (since 0.6.0)** (`docs/change-logs/change-log-0.6.0.md`,
image `assets/images/dt_kernel_dt_model_change.png`): a `DigitalTwin` wraps
Physical Adapters, Digital Adapters and a **DT Kernel**. The kernel
(`DigitalTwinKernel`, formerly `DigitalTwinModel`) holds the
`DigitalTwinStateManager`, the `DigitalTwinModel` (formerly
`ShadowingFunction`), the `StorageManager`, the `ResourceManager` and the
optional `AugmentationManager`. Methods carry an optional
`@ShadowingFunction(value = ShadowingType.…)` annotation for machine-readable
metadata.

### 1.2 Life cycle

Documented as five states "based on the scientific literature"
(`docs/introduction/dt-life-cycle.md`); transitions read from
`assets/images/life_cycle.jpeg`:

| State                 | Documented meaning                                                                                             |
| :-------------------- | :------------------------------------------------------------------------------------------------------------- |
| Operating & Not Bound | After initialization: all internal modules active, no association with the PA yet                              |
| Bound                 | Binding procedure succeeded; bidirectional event flow enabled                                                  |
| Shadowed              | Shadowing has begun and the DT state is correctly synchronized with the PA                                     |
| Out of Sync           | Errors in the shadowing process; the DT can handle neither state-alignment events nor application-layer events |
| Done                  | Shadowing stopped, but the DT stays active to serve external applications                                      |

Transitions in the figure: START -INIT-> Operating Not Bound -BIND WITH PA->
Bound -EVENTS & STATE SYNC-> Shadowed -STOP-> Done -DISMISS-> STOP. Also Bound
-EVENTS OR STATE ASYNC-> Out of Sync; Shadowed -> Out of Sync (unlabelled
arrow); Out of Sync -EVENTS & STATE SYNC-> Shadowed; Out of Sync -UNBOUND->
Operating Not Bound; STOP edges from Operating Not Bound and from Out of Sync to
Done.

Binding and sync rules:

- Unbound to Bound "only when all Physical Adapters have been correctly bound
  ... and the associated Physical Asset Descriptions have been generated"
  (`docs/introduction/dt-life-cycle.md`; same rule in
  `docs/introduction/library-structure.md`). The adapter signals this with
  `notifyPhysicalAdapterBound(pad)` (`docs/guides/physical-adapter.md`).
- Bound to Shadowed: the model selects properties to observe, adapters emit
  e_pa, the shadowing function computes the state; the model calls
  `notifyShadowingSync()` to tell the core binding is complete and the state is
  evaluated (`docs/guides/shadowing-function.md`).

Lifecycle names used in the API differ from the conceptual names (_inference_:
the code enum is not listed in the docs). Callbacks expose created / started /
bound / unbound / sync / unsync / stopped / destroyed:

- Digital Adapter: `onDigitalTwinCreate`, `onDigitalTwinStart`,
  `onDigitalTwinSync(state)`, `onDigitalTwinUnSync(state)`, `onDigitalTwinStop`,
  `onDigitalTwinDestroy` (`docs/guides/digital-adapter.md`).
- Shadowing function / model: `onCreate`, `onStart`, `onStop`,
  `onDigitalTwinBound(Map<adapterId, PAD>)`,
  `onDigitalTwinUnBound(map, adapterId)`,
  `onPhysicalAdapterBidingUpdate(adapterId, PAD)`
  (`docs/guides/shadowing-function.md`).
- Augmentation handlers: `AugmentationLifeCycleListener` with `onCreate`,
  `onStart`, `onDigitalTwinBound`, `onDigitalTwinUnBound`, `onSync(state)`,
  `onUnSync(state)`, `onStop`, `onDestroy`
  (`docs/guides/augmentation_functions.md`).
- Physical Adapter (0.6.0+): only `onDigitalTwinSync()` /
  `onDigitalTwinUnSync()`, with no state argument by design, so adapters stay
  decoupled from the computed state and from each other
  (`docs/change-logs/change-log-0.6.0.md`).
- `dt_events.md` speaks of moving "from `Bound` to `Synchronized`"
  (`docs/introduction/dt_events.md`), i.e. _Synchronized_ is the API-side name
  for _Shadowed_ (_inference_).
- The monitoring metric `dt_lifecycle_value` exports the current
  `LifeCycleState` as its numeric ordinal
  (`docs/guides/monitoring-interface.md`).
- 0.4.0 fix: "Synchronized the update of the current DT Life Cycle State in
  order to avoid wrong data" (`docs/change-logs/change-log-0.4.0.md`).

### 1.3 Events (event-driven architecture)

"The entire WLDT Library ... has been designed as an event-driven system where
each component is (almost) fully decoupled"; adapters, model, storage and
shadowing function talk only through events (`docs/introduction/dt_events.md`).

- **Physical Asset events**: New / Updated PAD; Property Variation; Event
  Notification; Relation Instance Variation; Physical Asset Action Request (core
  to adapter).
- **DT events**: Life Cycle Variation; DT State Variation (new state + change
  list); DT State Event Notification; Digital Action Request (external app to
  DT).
- **Augmentation events** (0.7.0+): base type `dt.augmentation.function`, e.g.
  `dt.augmentation.function.registered`,
  `dt.augmentation.function.execution.execute.<handlerId>.<functionId>`,
  `…result.<handlerId>.<functionId>`, `…error`. Wildcard
  `dt.augmentation.function.*` lets the storage layer persist all of them
  (`docs/introduction/dt_events.md`).
- Bus features: multi-level wildcard `*` subscriptions, `WldtEventTypes`
  constants, static `EventManager` publishing helpers
  (`docs/change-logs/change-log-0.4.0.md`), `WldtEventObserver` +
  `IWldtEventObserverListener` for filtered observation (0.4.0). 0.8.0 fixed a
  `ConcurrentModificationException` by iterating over a copy of the subscription
  set (`docs/change-logs/change-log-0.8.0.md`).
- Since 0.6.0 every `PhysicalAssetWldtEvent` carries `physicalAdapterId`, set
  automatically, to disambiguate same-key properties from different adapters
  (`docs/change-logs/change-log-0.6.0.md`).
- A custom event logger can be set with
  `WldtEventBus.getInstance().setEventLogger(...)`
  (`docs/guides/dt-process.md`).

### 1.4 State management (transactions)

Since 0.3.0 the model never writes state directly; it uses
`DigitalTwinStateManager` (`docs/guides/shadowing-function.md`,
`docs/change-logs/change-log-0.3.0.md`):

- `startStateTransaction()` → `createProperty` / `updateProperty` /
  `updatePropertyValue` / `deleteProperty` / `enableAction` / `updateAction` /
  `disableAction` / `registerEvent` / `updateRegisteredEvent` /
  `unRegisterEvent` / `createRelationship` / `addRelationshipInstance` /
  `deleteRelationship` / `deleteRelationshipInstance` →
  `commitStateTransaction()`.
- The change log also mentions rollback: "start, commit, or rollback
  transactions" (`docs/change-logs/change-log-0.3.0.md`).
- Only a **committed** variation is notified. Digital Adapters receive
  `onStateUpdate(newState, previousState, List<DigitalTwinStateChange>)`, where
  each change has an `Operation` (`OPERATION_UPDATE`, `OPERATION_UPDATE_VALUE`,
  `OPERATION_ADD`, `OPERATION_REMOVE`) and a `ResourceType` (`PROPERTY`,
  `PROPERTY_VALUE`, `EVENT`, `ACTION`, `RELATIONSHIP`, `RELATIONSHIP_INSTANCE`)
  (`docs/guides/digital-adapter.md`).
- Event notifications are not state: `notifyDigitalTwinStateEvent(...)` goes to
  adapters through `onEventNotificationReceived(...)`, and adapters must opt in
  with `observeDigitalTwinEventsNotifications(keys)` /
  `observeAllDigitalTwinEventsNotifications` (`docs/guides/digital-adapter.md`).
- The model must opt in to physical notifications per element:
  `observePhysicalAssetProperty`, `observePhysicalAssetEvent`,
  `observePhysicalAssetRelationship`, `observeDigitalActionEvents()`
  (`docs/guides/shadowing-function.md`, `docs/guides/dt-relationships.md`).
- Action path: Digital Adapter `publishDigitalActionWldtEvent(key, body)` →
  model `onDigitalActionEvent` →
  `publishPhysicalAssetActionWldtEvent(key, body)` → Physical Adapter
  `onIncomingPhysicalAction` (`docs/guides/digital-actions.md`).

### 1.5 Engine API and multi-DT

`docs/guides/dt-process.md`:

- `new DigitalTwin(id, model)`; `addPhysicalAdapter(...)`;
  `addDigitalAdapter(...)`.
- "DTs cannot be directly run but it should be added to the
  `DigitalTwinEngine`".
- Engine: `addDigitalTwin(dt[, autoStart])`, `startDigitalTwin(id)`,
  `startAll()`, `stopDigitalTwin(id)`, `stopAll()`, `removeDigitalTwin(id)`
  (stops then deletes the reference), `removeAll()`.
- Multi-DT means several twins in one Java process under one engine
  (`docs/introduction/library-structure.md`). Monitoring metrics carry
  `digitalTwinId` so one handler can serve several DTs in the same process
  (`docs/guides/monitoring-interface.md`).

### 1.6 Relationships

`docs/guides/dt-relationships.md`: _Relationship_ = semantic declaration
(`name`, target `type`), e.g. `has_room`; _Relationship Instance_ = a concrete
link to a target DT, with key and metadata. Physical Adapters declare
relationships in the PAD and publish instance created / deleted events; the
model creates the matching `DigitalTwinStateRelationship` /
`DigitalTwinStateRelationshipInstance` inside a transaction. Relationships link
DTs by target id; the docs describe no cross-DT runtime messaging or composition
(_inference_ from the absence of such pages).

### 1.7 Adapters and configuration

Generic adapter API (`docs/guides/physical-adapter.md`,
`docs/guides/digital-adapter.md`, `docs/guides/configurable-adapters.md`):

- `PhysicalAdapter`: `onAdapterStart`, `onAdapterStop`,
  `onIncomingPhysicalAction`; publishes with
  `publishPhysicalAssetPropertyWldtEvent`, `publishPhysicalAssetEventWldtEvent`,
  `publishPhysicalAssetRelationshipCreatedWldtEvent`.
- `DigitalAdapter<C>`: generic in its configuration type; `onAdapterStart/Stop`,
  life-cycle callbacks, `onStateUpdate`, `onEventNotificationReceived`; has a
  `digitalTwinState` reference and a `queryExecutor`.
- `ConfigurablePhysicalAdapter<C>` and `DigitalAdapter<C>` take a plain
  configuration object in the constructor, read with `getConfiguration()`.

Documented adapters:

| Adapter                                          | Configuration                                                                                                                                                                                                                                                                                                                                                                                                               | Notes                                                                                                                                                                                                                                                                              |
| :----------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MQTT Physical (`docs/adapters/mqtt_physical.md`) | `MqttPhysicalAdapterConfiguration.builder(host, port)`; `addPhysicalAssetPropertyAndTopic(key, init, topic, parseFn)`, `addPhysicalAssetEventAndTopic`, `addPhysicalAssetActionAndTopic(key, type, contentType, topic, toPayloadFn)`, `addIncomingTopic` (many properties per topic), `addOutgoingTopic`, `setConnectionTimeout`, `setCleanSessionFlag`, `setAutomaticReconnectFlag`, `setMqttClientPersistence`, `build()` | PAD generated automatically from the topic mapping; needs an external broker                                                                                                                                                                                                       |
| MQTT Digital (`docs/adapters/mqtt_digital.md`)   | `MqttDigitalAdapterConfiguration.builder(host, port[, clientId])`; `addPropertyTopic(key, topic, qos, fn)`, `addEventNotificationTopic`, `addActionTopic(key, topic, fn)`; username/password, clean session, timeout, reconnect, persistence                                                                                                                                                                                | Needs an external broker                                                                                                                                                                                                                                                           |
| HTTP Digital (`docs/adapters/http_digital.md`)   | `HttpDigitalAdapterConfiguration(id, host, port)` plus whitelist filters for properties, actions, events, relationships (empty = all)                                                                                                                                                                                                                                                                                       | REST: `GET /instance`, `/state`, `/state/changes`, `/state/previous`, `/state/properties`, `/properties/{key}`, `/state/events`, `/state/actions`, `POST /state/actions/{key}`, `/state/relationships[/{name}/instances]`, `GET /storage`, `POST /storage/query` (JSON query body) |
| CoAP Physical (`docs/adapters/coap_physical.md`) | Builder or YAML (`fromYaml`); resource discovery on/off, ignored resources, custom discovery, manual `addResource`; observation or polling (`enableObservability`, `enableAutoUpdateTimer`, `setAutoUpdateInterval`); payload/event/action translators; default and per-resource event/action types                                                                                                                         | PAD generated from discovery or configuration                                                                                                                                                                                                                                      |
| CoAP Digital (`docs/adapters/coap_digital.md`)   | Builder or YAML; CoRE RT/IF/CT; custom GET/POST/PUT handlers; filters                                                                                                                                                                                                                                                                                                                                                       | `/.well-known/core` discovery; observable resources mirror the HTTP tree plus `/state/events/notifications` and `/storage`                                                                                                                                                         |

The docs repeatedly refer to a `ConsoleDigitalAdapter` and a
`DefaultShadowingFunction` in examples (`docs/adapters/mqtt_physical.md`,
`docs/adapters/http_digital.md`) but do not document them.

### 1.8 Storage and query

`docs/guides/storage.md` (introduced in 0.4.0):

- `StorageManager` (per DT; a `DigitalTwinWorker` on its own thread, observer of
  the event bus): `putStorage`, `getStorageIdList`, `isStorageAvailable`,
  `getStorage`, `removeStorage`, `setQueryManager`.
- `WldtStorage` (abstract): persists DT state with change list, state event
  notifications, digital events, life-cycle states, PADs, property variations,
  relationship instances, digital and physical action requests, physical event
  notifications, storage statistics (augmentation records since 0.7.0). Each
  storage can observe all events or only selected classes, so different stores
  can hold different streams (e.g. Redis for all events, MongoDB for state
  only).
- `DefaultWldtStorage` is in-memory and "serves _only_ for basic development and
  testing purposes".
- Read access: model has read/write; Digital Adapters and Augmentation Functions
  get read-only access through the **Query System**: `QueryExecutor` (sync and
  async, event-based internally), `QueryRequest`, `QueryRequestType`
  (`TIME_RANGE`, `SAMPLE_RANGE`, `LAST_VALUE`, `COUNT`), `QueryResourceType`
  (property variations, event notifications, physical/digital action requests,
  DT state, DT state event notifications (0.6.0+), new/updated PAD, relationship
  instance created/deleted, life-cycle events, storage stats), `QueryResult`,
  `IQueryResultListener`. `LAST_VALUE` exists only for DT state, life-cycle
  events and storage stats.
- `QueryManager` is pluggable; `DefaultQueryManager.getTargetStorage` returns
  the first storage in the map.

### 1.9 Management interface (resources)

`docs/guides/resource_and_management_interface.md` (introduced in 0.5.0):

- `ManagedResource<R, …>`: id, type, name, wrapped object; CRUD hooks
  `onCreate`, `onRead`, `onUpdate`, `onDelete`; one level of sub-resources;
  observers via `IResourceObserver`
  (`onCreate/onUpdate/onDelete(resourceId, subResourceId)`).
- `ResourceManager` (per DT): `addResource`, `removeResource`, `updateResource`,
  `clearResourceList`, `getResourceById`, `getResourceList`, `containsResource`;
  observers via `IResourceManagerObserver`.
- `ResourceRequest<T>` (resourceId, optional subResourceId, content, metadata)
  and `ResourceResponse<T>` (resource, ids, metadata, `isError`, `errorCode`,
  `errorMessage`; examples use HTTP-like codes 400/404).
- `ManagementInterface`: abstract; `onStart(resources)`, `onStop`,
  `onResourceAdded/Updated/Removed`; attached with
  `digitalTwin.setManagementInterface(...)`.
- "The core ... only provides an **abstract interface for the Management
  Interface**. It is the responsibility of the developer to implement the actual
  logic ... (e.g., via REST, MQTT, gRPC, etc.)."
- Purpose: runtime tuning of DT parameters (thresholds, limits) used by the
  model. It is **not** a lifecycle control API: start/stop of DTs stays on
  `DigitalTwinEngine` (_inference_ from the documented method sets).

### 1.10 Monitoring and metrics

`docs/guides/monitoring-interface.md` (introduced in 0.8.0):

- One `MonitoringInterface` per DT, injected into model, adapters, augmentation
  functions and storage. Opt-in: active only when both a
  `MonitoringInterfaceConfiguration` (builder flags `withDtModelMonitoring`,
  `withPhysicalAdapterMonitoring`, `withDigitalAdapterMonitoring`,
  `withAugmentationMonitoring`, `withStorageMonitoring`, `withAllMonitoring`,
  `withCustomNamespace`) and a `MonitoringInterfaceHandler` are set; set them
  before start.
- Backend-agnostic: handler callbacks `onMetricRegistered` (empty snapshot) and
  `onMetricUpdated` (independent copy). Tested with Prometheus + Grafana;
  dashboards in the core repo's `prometheus` folder.
- Five metric types: `WldtCounter`, `WldtUpDownCounter`, `WldtGauge`,
  `WldtTimer`, `WldtHistogram`; full name `namespace.name`; per-instance slots
  keyed by adapter, handler, function or storage id. Convenience update methods
  swallow and log errors: "the metric updates never affect the normal execution
  of the program".
- Framework-native metrics under namespace `core`, pattern `<op>_exec_time` /
  `<op>_exec_success_count` / `<op>_exec_error_count`: shadowing callbacks
  (`pt_property_variation_*`, `digital_action_*`, `dt_state_computation_*`),
  life cycle (`dt_lifecycle_value`), adapter publish/processing counters,
  augmentation and storage write/query metrics.
- `library-structure.md` still lists a "Metrics Manager" in the core layer; the
  docs do not describe it separately from the 0.8.0 Monitoring Interface.

### 1.11 Logging

`docs/guides/logging.md` (0.5.0): dependency-free logging facade `WldtLogger`,
`WldtLoggerFactory`, `WldtLoggerProvider.setFactory(...)` (set once at startup),
default `WldtDefaultLogger` writing to `System.out`; adapters for
SLF4J/Log4j/Logback are left to the developer.

### 1.12 Augmentation functions (0.7.0+)

`docs/guides/augmentation_functions.md`:

- Hierarchy: Model ↔ `AugmentationManager` (per DT, created automatically) →
  `AugmentationFunctionHandler`s (each a `DigitalTwinWorker` on a thread from
  the manager's `ExecutorService`; **max 5 handlers**) → functions.
- **Stateless** functions: `run(request)` per `execute`, no lifecycle.
  **Stateful** functions: `start` / `stop`, receive `onStateUpdate` and
  `onEventNotificationReceived` (push) or call `refreshQueryResult()` (polling),
  emit with `notifyResult()` at any time; `isRunning()` since 0.8.0.
- Request types `EXECUTE`, `START`, `STOP`; context = current DT state +
  optional storage `QueryResult`. Results typed `PROPERTY_RESULT`,
  `EVENT_RESULT`, `RELATIONSHIP_RESULT`, `RELATIONSHIP_INSTANCE_RESULT`,
  `GENERIC_RESULT`; errors typed `INFO`, `WARNING`, `ERROR`, `CRITICAL`.
- "The Digital Twin Model retains **full autonomy** over whether and how to
  apply any result ... the framework never applies results automatically"
  (`docs/change-logs/change-log-0.7.0.md`).
- Availability is notified only when the DT is in Sync; functions registered
  earlier are caught up at the first synchronization; the model must tolerate
  duplicate availability callbacks after an out-of-sync/in-sync cycle.
- Documented gaps: `propertyNameFilter`, `eventNameFilter`,
  `relationshipNameFilter` "are **currently not read by the framework**";
  self-registration of external functions is commented out as "NOT YET
  IMPLEMENTED".

### 1.13 Recommended usage patterns and best practices (as stated)

- Wrap every state change in `startStateTransaction()` /
  `commitStateTransaction()` (`docs/guides/shadowing-function.md`).
- Observe physical properties explicitly; static properties may need only their
  initial value (`docs/guides/shadowing-function.md`).
- Call `notifyShadowingSync()` after building the state in `onDigitalTwinBound`
  (`docs/guides/shadowing-function.md`).
- Use `updatePropertyValue()` rather than `updateProperty()` to keep `type` and
  `contentType` (0.8.1) (`docs/guides/shadowing-function.md`).
- Validate and adapt digital actions in the model before forwarding; validate
  key and body type in the physical adapter (`docs/guides/digital-actions.md`,
  `docs/guides/physical-adapter.md`).
- Generate the PAD from discovery or configuration where possible
  (`docs/guides/physical-adapter.md`).
- Keep Physical Adapters ignorant of DT state and of each other
  (`docs/change-logs/change-log-0.6.0.md`).
- Do not use the in-memory storage in production (`docs/guides/storage.md`).
- Configure monitoring before starting the DT
  (`docs/guides/monitoring-interface.md`).
- Prefer `DefaultAugmentationFunctionHandler`; keep stateless functions free of
  instance state (`docs/guides/augmentation_functions.md`).

### 1.14 Documentation inconsistencies observed (_inference_ unless quoted)

- The guides mix three generations of naming: `ShadowingModelFunction`
  (pre-0.3.0) in the shadowing-function code sample, `ShadowingFunction`
  (0.3.0–0.5.x) in prose, and `DigitalTwinModel` (0.6.0+) only in change logs
  (`docs/guides/shadowing-function.md`, `docs/change-logs/change-log-0.6.0.md`).
- `docs/guides/configurable-adapters.md` still starts a DT with
  `new WldtEngine(...).startLifeCycle()`, an API removed in 0.3.0
  (`docs/change-logs/change-log-0.3.0.md`).
- `docs/guides/augmentation_functions.md` shows `run()` returning
  `List<AugmentationFunctionResult<?>>`, replaced by
  `AugmentationFunctionResultList` in 0.8.0
  (`docs/change-logs/change-log-0.8.0.md`).
- Adapter compatibility tables stop at wldt-core 0.4.0.
- `dt-life-cycle.md` names five conceptual states; the code-level
  `LifeCycleState` enum is never listed.

---

## Part 2. The paper (SoftwareX 2021, code version v1.0)

### 2.1 Metadata

Code metadata table (front matter): current code version **v1.0**; permanent
link `https://github.com/ElsevierSoftwareX/SOFTX-D-20-00018`; licence
**GPL-3.0**; Git; "Java and Android"; "Java 8 or greater"; docs
`https://github.com/wldt/wldt-core`. Received 3 Aug 2020, accepted 7 Jan 2021.
Keywords: IoT, Digital twin, Library, Software agent.

### 2.2 Motivation (Section 1, "Motivation and significance")

- DT definition used: "a comprehensive software representation of an individual
  physical object (e.g., a single IoT device or a more complex composite
  machinery), reflecting properties, conditions, and behavior of the physical
  object through models and data", citing Minerva et al. [1]. Physical object
  and DT "mutually communicate and collaborate ... through bidirectional
  interactions" (telemetry, commands, configurations).
- Key benefit: "a solid, standard and scalable abstraction layer on top of
  physical assets", so applications need not know data collection and networking
  details.
- Problems: no standards, platform-specific DTs ("IBM DTs are different from AWS
  ones, called 'shadows' and from MS Azure ones, called 'replicas'"),
  fragmentation per Tao & Qi [7]. Abstract: existing frameworks "mainly operate
  in the cloud and are based on platform-specific solutions, harming
  interoperability and adaptability".
- Eclipse Ditto is "the state of the art of open source frameworks for DTs
  management and orchestration", cloud-oriented, but "mainly focused on a
  monolithic vision of DTs, where the entire complexity of a physical object is
  managed by a single software entity, without the possibility to handle each
  DT's feature and task as an independent and flexible agent".
- Goal: a Java library "designed to maximize modularity, re-usability and
  flexibility", modelling "each DT as an independent and autonomous software
  component" suited to microservice IoT architectures, at the edge and in the
  cloud. Target users: "software developers operating in IoT ecosystems".

### 2.3 Design principles stated

The paper does not number requirements. It states: modularity, re-usability,
flexibility (Section 1); DTs as independent software agents (Section 2);
scalability and extensibility (Section 2.1); microservice and container
deployment, cloud and edge (Section 4). The explicit list _Simplicity /
Extensibility / Portability & Microservice Readiness_ is in the docs
(`docs/introduction/library-structure.md`), not in the paper.

### 2.4 Architecture as described (Sections 2, 2.1, 2.2, Figs. 1–2)

Layered stack (Fig. 1, bottom to top): **WLDT Engine** → **WLDT Configuration
Management** → **Processing Pipeline** → supporting modules **Metrics / Cache /
Utils** → **WLDT Workers** → **WLDT Worker Configuration** → built-in workers
**CoAP2CoAP**, **MQTT2MQTT**, "...".

- **Engine**: "handle and orchestrate available and active modules – denoted as
  Workers – defining the behavior of the DT"; "multi-threading core engine".
- **Worker**: "the active module of the library ... designed to implement a
  specific DT's task or feature", e.g. synchronization through an IoT protocol
  (CoAP, MQTT, HTTP, WebSocket; legacy protocols via custom workers). Handles
  request/response or pub/sub and both incoming and outgoing packets.
- **Configuration Manager**: DT unique id, namespace, startup delay, metrics
  on/off; per-worker configuration (endpoints, topics, resources).
- **Run sequence (Fig. 2)**: (i) engine starts with a configuration and a worker
  list; (ii) instantiates workers with configuration and optional pipeline;
  (iii) "executes each worker on an independent thread"; (iv) workers send
  callbacks "related to their operational phases (start, stop, error, warning,
  etc.)" to the engine; (v) workers read and write the internal cache; (vi)
  workers use processing pipelines.
- **Caching** (2.2.1): `IWldtCache<K,V>` / `WldtCache<K,V>`; string id, optional
  expiration time and size limit.
- **Processing pipelines** (2.2.2): `IProcessingPipeline` (`addStep()`,
  `removeStep()`, `start()`), `ProcessingStep`, `PipelineData`; listeners
  `ProcessingPipelineListener` / `ProcessingStepListener` with
  `onPipelineDone(Optional<PipelineData>)` and `onPipelineError()`; steps
  reusable across pipelines and DT instances.
- **Metrics** (2.2.3): singleton `WldtMetricsManager` with
  `getTimer(metricId, timerKey)` and `measureValue(metricId, key, value)`;
  reporters to local CSV or a Graphite collector.
- **MQTT-to-MQTT worker** (2.3): `Mqtt2MqttWorker` + `Mqtt2MqttConfiguration`;
  four topic kinds (telemetry, events, command requests, command responses)
  "inspired by ... Eclipse Hono and Ditto", Mustache placeholders such as
  `telemetry/{{device_id}}`. Listing 1:
  `new WldtEngine(new WldtConfiguration())`, `eng.addNewWorker(...)`,
  `eng.startWorkers()`.
- **CoAP-to-CoAP worker** (2.4): `Coap2CoapWorker`; resource discovery through
  `/.well-known/core`, CoRE Link Format and CoRE Interface, so a DT attaches to
  a standard CoAP object "without the need of any additional information".
- There is **no** DT state model, PAD, shadowing function, life cycle,
  digital/physical adapter split or storage layer in the paper. "Mirroring" in
  the paper is protocol-level packet forwarding between the physical side and a
  digital endpoint (_inference_ from Sections 2.3–2.4 and Listing 1).

### 2.5 Evaluation (Section 2.5, Fig. 3)

Setup: local Linux edge node, Intel i7, 16 GB RAM. Three aims: (i) delay versus
the state of the art, (ii) CPU and memory cost, (iii) modularity and development
complexity. Ditto configurations included objects using Ditto's SDK and objects
needing an intermediate module; external consumer applications measured
bidirectional traffic.

| Measure                                                               | Result                                                                                                                                                                                                                             |
| :-------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overhead vs message rate (payload 100 B; 5–100 msg/s)                 | Text: Ditto overhead "significantly higher" than WLDT for MQTT and CoAP. Fig. 3(a), approximate: Ditto about 15–16 ms, about 20 ms at 100 msg/s; WLDT MQTT about 1 ms; CoAP without cache about 2–3 ms; CoAP with cache below 1 ms |
| Overhead vs payload (10 msg/s; 100–5000 B)                            | Same trend (Fig. 3(b)). Approximate: Ditto 16 to 20 ms; CoAP without cache rises to about 6–7 ms at 3000–5000 B; MQTT and cached CoAP stay near 1 ms                                                                               |
| Memory (about 15 min, device with 10 resources; heap caps 8/16/32 MB) | Text: "8 Mbytes for MQTT and 10 Mbytes for CoAP"; Fig. 3(c) shows saw-tooth heap usage bounded by the configured heap                                                                                                              |
| CPU                                                                   | Fig. 3(d): mostly below about 2%, peaks about 6%                                                                                                                                                                                   |
| Code size (Droidcon MEC Hackathon 2020 vehicle/RSU DTs)               | Fig. 3(e)/(f), approximate: core about 5,300 Java lines and about 210 KB; vehicle DT, RSU DT and SenML module each a few hundred lines and under about 15 KB                                                                       |

The authors attribute Ditto's overhead to its "extensive and inventory-oriented
features ... structured storage and multiple architectural layers. This
monolithic design introduce a relevant overhead if compared with the effective
one-to-one DT mirroring". "Ditto remains excellent for a centralized DT
management and it can potentially work side-by-side with the WLDT library."

### 2.6 Illustrative examples (Section 3)

- 3.1 MQTT-to-MQTT with a pipeline: `MqttAverageProcessingStep` (cache-backed
  n-sample average) then `MqttSenmlBuilderProcessingStep` (SenML+JSON); DTs
  isolate devices from consumers (Fig. 4).
- 3.2 Legacy worker: `PhilipsHueLightWorker` exposes Hue HTTP lights as standard
  CoAP resources (CoRE Link Format, CoRE Interface, SenML), answering from cache
  when possible (Fig. 5).
- 3.3 Real-time monitoring: several DTs export metrics to CSV and Graphite,
  shown in Grafana (Fig. 6).

### 2.7 Impact, limitations and future work (Sections 4–5)

- Deployments: POLIS-EYE project (presence/traffic sensors), Bosch Smart Parking
  Pilot in Mantua, Droidcon MEC Hackathon 2020 (Sections 2.5, 4).
- Forward-looking claim: "A containerized WLDT enabled DT has the possibility to
  easily migrate or be cloned to one or multiple locations ... in 5G MEC"
  (Section 4). The paper does not evaluate migration or cloning.
- **No explicit limitations section.** Future work is only: "As WLDT is an
  ongoing project, we hope that developers and researchers will join it ...
  extending the range of provided features" (Section 5).
- Unstated limitations visible in the text (_inference_): single-node
  evaluation, no scalability test with many DTs, no security or persistence
  discussion, comparison against Ditto only.

### 2.8 Related work in the paper

Brief and in Section 1 only: IBM, AWS ("shadows") and Azure ("replicas") as
platform-specific DTs; Eclipse IoT and Eclipse Ditto as open platforms; Eclipse
Hono for topic conventions (Section 2.3). There is **no comparison with Azure
Digital Twins (DTDL)** or other DT frameworks beyond these mentions, and no
related-work section.

---

## Part 3. How the architecture evolved (paper v1.0 → docs 0.8.1)

The docs' version line (0.2.1 … 0.8.1) restarts below the paper's "v1.0"; the
docs link issues to `github.com/wldt/wldt-core-java`
(`docs/change-logs/change-log-0.6.0.md`) while the paper points to
`github.com/wldt/wldt-core`. _inference_: the current library is a re-designed
codebase with its own version numbering, not an increment of v1.0.

| Aspect                | Paper (v1.0, 2021)                                                          | Docs (0.8.1, 2026)                                                                                                                                                         |
| :-------------------- | :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit of execution     | `WldtEngine` = one DT running a list of **Workers**, each on its own thread | `DigitalTwinEngine` runs many `DigitalTwin`s; each DT = Kernel + adapters; internal parts are `DigitalTwinWorker`s (`docs/guides/dt-process.md`, `docs/guides/storage.md`) |
| DT notion             | Protocol mirror / proxy of a device (MQTT2MQTT, CoAP2CoAP)                  | Explicit model: PA, PAD, DT State, shadowing function, physical and digital interfaces (`docs/introduction/dt-model.md`)                                                   |
| Behaviour             | Processing-pipeline steps transforming packets                              | `DigitalTwinModel` (ex-`ShadowingFunction`) callbacks plus transactional state manager; augmentation functions for extra computation                                       |
| Protocol split        | One worker handles both sides of one protocol                               | Separate Physical Adapters (bind, PAD, e_pa) and Digital Adapters (expose state, accept actions)                                                                           |
| Life cycle            | Worker callbacks only: "start, stop, error, warning, etc."                  | Five-state DT life cycle (Not Bound → Bound → Shadowed ↔ Out of Sync → Done) with callbacks to model, adapters and augmentation handlers                                   |
| Communication         | Engine callbacks and shared cache                                           | Internal event bus with typed events and wildcards                                                                                                                         |
| Data                  | `WldtCache` (TTL, size limit)                                               | Storage Manager with pluggable `WldtStorage` and a Query System; the cache is not mentioned in the docs                                                                    |
| Metrics               | `WldtMetricsManager` singleton; CSV / Graphite                              | Per-DT `MonitoringInterface`, five metric types, framework-native metrics, handler to any backend (Prometheus/Grafana tested)                                              |
| Runtime configuration | Static `WldtConfiguration` and worker configurations                        | Plus `ResourceManager` / `ManagementInterface` for runtime CRUD on DT parameters                                                                                           |
| Logging               | "metrics and logs" to collectors                                            | Pluggable logger facade                                                                                                                                                    |
| Built-in protocols    | MQTT, CoAP in core                                                          | MQTT, HTTP, CoAP as separate Maven artifacts (`io.github.wldt:*`)                                                                                                          |

Rename trail from the change logs: `WldtEngine` → `DigitalTwin`, plus a new
`DigitalTwinEngine` (0.3.0); `ShadowingModelFunction` → `ShadowingFunction`
(0.3.0); internal `ModelEngine` → `DigitalTwinModel` (0.4.0); `DigitalTwinModel`
→ `DigitalTwinKernel` and `ShadowingFunction` → `DigitalTwinModel` (0.6.0).

What stayed: the "general purpose software entity ... attachable to any physical
thing" framing, the agent/microservice orientation, Java, the multi-threaded
engine, and MQTT/CoAP focus (`docs/introduction/library-structure.md` repeats
the paper's wording almost verbatim).

---

## Part 4. Glossary

| Term                                                        | Meaning (source)                                                                                                                                                               |
| :---------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical Asset (PA)                                         | Real-world entity with a well-defined lifespan that the DT digitalizes (`docs/introduction/dt-model.md`)                                                                       |
| Digital Twin (DT)                                           | Software representation of one PA; in WLDT a `DigitalTwin` instance run by the engine (`_index.md`, `docs/guides/dt-process.md`)                                               |
| Physical Interface / Physical Adapter                       | Side that binds to the PA, publishes a PAD and physical events, executes physical actions (`docs/introduction/dt-model.md`, `docs/guides/physical-adapter.md`)                 |
| Digital Interface / Digital Adapter                         | Side that exposes DT state and events to external apps and accepts digital actions (`docs/guides/digital-adapter.md`)                                                          |
| Physical Asset Description (PAD)                            | Per-adapter list of properties, events, actions, relationships of the PA (`docs/introduction/dt-life-cycle.md`)                                                                |
| DT Model (M)                                                | Abstraction of the PA; since 0.6.0 also the class `DigitalTwinModel` holding the shadowing callbacks (`docs/introduction/dt-model.md`, `docs/change-logs/change-log-0.6.0.md`) |
| DT Kernel                                                   | Internal orchestrator holding model, state manager, storage, resource and augmentation managers (0.6.0) (`docs/change-logs/change-log-0.6.0.md`)                               |
| Shadowing / shadowing function                              | Process and function mapping physical events (and validated digital actions) to DT state and physical actions (`docs/introduction/dt-model.md`)                                |
| Digital Twin State (S_DT)                                   | Properties, events, relationships, actions and evaluation instant (`docs/introduction/dt-model.md`, `docs/change-logs/change-log-0.3.0.md`)                                    |
| DigitalTwinStateManager                                     | Transactional API to modify state; notifies committed changes (`docs/guides/shadowing-function.md`)                                                                            |
| DigitalTwinStateChange                                      | One change in a commit: operation plus resource type (`docs/guides/digital-adapter.md`)                                                                                        |
| e_pa / e_DT                                                 | Physical-asset events and DT events (`docs/introduction/dt-life-cycle.md`)                                                                                                     |
| Digital action / physical action                            | Action request from an app to the DT / from the DT to the PA (`docs/introduction/dt-model.md`)                                                                                 |
| Relationship / relationship instance                        | Semantic link type / concrete link to a target DT (`docs/guides/dt-relationships.md`)                                                                                          |
| Bound, Shadowed (Synchronized), Out of Sync, Done           | Life-cycle states (`docs/introduction/dt-life-cycle.md`)                                                                                                                       |
| DigitalTwinEngine                                           | Runs, stops and removes DTs in one JVM (`docs/guides/dt-process.md`)                                                                                                           |
| WLDT Event Bus                                              | Internal publish/subscribe bus with typed events and wildcards (`docs/introduction/library-structure.md`, `docs/change-logs/change-log-0.4.0.md`)                              |
| StorageManager / WldtStorage                                | Per-DT storage registry / pluggable store (`docs/guides/storage.md`)                                                                                                           |
| Query System (QueryExecutor, QueryManager)                  | Read-only access to stored history (`docs/guides/storage.md`)                                                                                                                  |
| ManagedResource / ResourceManager / ManagementInterface     | Runtime-configurable DT parameters and their external CRUD API (`docs/guides/resource_and_management_interface.md`)                                                            |
| MonitoringInterface / MonitoringInterfaceHandler            | Per-DT metric hub and developer sink (`docs/guides/monitoring-interface.md`)                                                                                                   |
| Augmentation Function (stateless / stateful)                | Extra computation units suggesting results to the model (`docs/guides/augmentation_functions.md`)                                                                              |
| AugmentationManager / AugmentationFunctionHandler           | Per-DT coordinator / threaded host of functions (max 5 handlers) (`docs/guides/augmentation_functions.md`)                                                                     |
| Worker (paper)                                              | Active, threaded module implementing one DT task, e.g. protocol sync (paper §2.1)                                                                                              |
| WldtEngine (paper)                                          | Engine that configures and runs workers for one DT (paper §2.1, Listing 1)                                                                                                     |
| Processing Pipeline / ProcessingStep / PipelineData (paper) | Chain of reusable steps transforming messages (paper §2.2.2)                                                                                                                   |
| WldtCache (paper)                                           | Internal key-value cache with optional TTL and size limit (paper §2.2.1)                                                                                                       |
| WldtMetricsManager (paper)                                  | Singleton metrics API with CSV/Graphite reporters (paper §2.2.3)                                                                                                               |
| Mqtt2MqttWorker / Coap2CoapWorker (paper)                   | Built-in protocol mirroring workers (paper §2.3, §2.4)                                                                                                                         |
