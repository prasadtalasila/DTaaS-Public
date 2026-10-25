# 06 Escalation Signal

- Status: in progress
- Depends on: 03
- PR: none
- Research note:
  [item 6](../dtn-research-notes.md#6-escalation-signal-r3-endogenous)

## Spec

P1's requirement R3: a DT signals the Manager when its local adaptation
space is exhausted or it wants a shared-policy parameter changed. P1's
prototype left this endogenous signal to future work. The runner cannot
judge what "exhausted" means for a DT, so the DT author declares which
observable conditions count, and scripts can escalate explicitly.

### Declaration

```yaml
escalation:
  onFailure: true # a $failure the state has no transition for
  onNoTransition: true # a client event the state has no transition for
```

The section is optional and both flags default to `false`; without it,
only explicit requests escalate. It is a strict object of booleans, so
an unknown key, `__proto__` included, or a non-boolean value is a
startup error.

### Automatic triggers

- `failure`, with `onFailure`: the script of the current state ends
  `failed` and the state has no `$failure` transition. A `$failure`
  whose transition exists but is refused (`script running`) has a
  transition, is logged as today, and does not escalate. `$stopped`
  (10) and `$success` never escalate. Each entry completes once, so
  `failure` needs no deduplication.
- `no-transition`, with `onNoTransition`: a client event, over
  `POST /fsm/event` or the `event` MQTT route, gets `no transition`
  in a started machine. It escalates at most once per entry and event,
  so a client that repeats an event does not flood the Manager; the
  record resets when the machine enters a state. Nothing escalates
  before the first transition (state `null`), for an `invalid event`,
  for a request refused as `stopping`, or for an event that a
  parameter change raises (04). The reply stays `409 no transition`.

### Explicit request

`POST /escalate` and `<base>/escalate`:

```json
{ "reason": "capacity", "proposal": { "scope": "multi" } }
```

- `reason` is a required, non-empty string. `proposal` is an optional
  JSON object, by convention the parameter values the DT would like
  (P1's `θ'`); the runner forwards it as received and does not
  interpret it. Each value is measured as
  `Buffer.byteLength(JSON.stringify(value), 'utf8')`, the rule of 05:
  `reason` up to 1 KiB (1024 bytes), `proposal` up to 4 KiB. Any other
  body is `400 Validation Failed`; over MQTT, the same body.
- Reply `202 { "status": "accepted" }`, with or without a state
  machine, so a plain DT can escalate too. Without a machine, or before
  its first transition, the notification has `state: null, entry: 0`.
- An optional `Idempotency-Key` (MQTT 5: `idempotency-key`) is kept in
  a `RecentReplies` of its own, apart from the keys of the `fsm`
  routes (D13). Every escalation is the same request, `'escalate'`,
  and every reply is kept, so a repeated key gets the stored reply and
  escalates nothing, even with a different body; no reply is
  `invalid request key`, and there is no new `400` variant.

### Notification

Sent through the notifier of 03 with `kind: "escalation"`, on
`<base>/notify/escalation`, QoS 1, not retained (the `RETAINED` table
of `src/notify/notifier.service.ts` already says so), and to the
webhook:

```json
{
  "kind": "escalation",
  "id": "hospital-1",
  "time": "2026-10-25T10:00:00.000Z",
  "data": {
    "trigger": "request",
    "state": "execute",
    "entry": 3,
    "event": null,
    "reason": "capacity",
    "proposal": { "scope": "multi" }
  }
}
```

- `trigger` is `failure`, `no-transition` or `request`. `state` and
  `entry` are those of the machine when the trigger fired. `event`
  names the client event for `no-transition`, else `null`.
- `reason` is the request's, or the runner's text for the automatic
  triggers: `script of state execute failed`,
  `no transition for restart in state execute`. `proposal` is the
  request's, else `null`.
- Once shutdown has begun the notifier sends nothing; a request is
  still answered `202`.

## Plan

1. Make room in `src/fsm/fsm.service.ts` (249 lines). Move the
   `replies` field (line 40) and the private `request` and `reply`
   methods (lines 147-170) to a new `src/fsm/requests.ts`: a plain
   class `Requests`, built with a getter of `{ machine, stopping }`,
   that holds the `RecentReplies<FsmReplyDto>` and offers
   `reply(request, requestKey, handle)` (the old `request`, which
   replays a repeated key) and `answer(handle)` (the old `reply`:
   `no state machine`, `stopping`, or the handler's reply). This frees
   28 lines (249 to 221); the field that replaces them takes 5. The
   behaviour does not change.
1. Split the handler of `event` (lines 116-127) into a private
   `move(machine, event)`, and fold `follow` (lines 138-145), whose
   only caller it was, into `move` (-8 lines). Move the body of
   `check()` (lines 75-85) to `StateMachine.describe(status)` in
   `src/fsm/state-machine.ts` (-7 lines). 05 makes the same move; the
   later merge keeps one copy.
1. Add `src/dto/escalation.dto.ts`: `escalateSchema` with the size
   refinements; `proposal` is a refinement on `z.unknown()` that
   accepts an object that is not an array, as `z.record` would drop a
   `__proto__` key silently. Also `EscalateBody`,
   `EscalateReplyDto = { status: 'accepted' }`, and `EscalationData`
   with its `trigger` union. The size rule has a small helper of its
   own, `fits(limit)`, which tests
   `Buffer.byteLength(JSON.stringify(value), 'utf8')`; 05 is unmerged
   and has the same rule, so the later merge moves it to one place.
1. Add `src/fsm/escalation.ts`, which exports `escalationSchema` (the
   section, with `.prefault({})` so that both defaults apply when it is
   missing), its type `Escalation`, `EscalationListener`, and a plain
   class `Escalations` that holds the flags, the entry and the events
   already escalated in it, a `RecentReplies<EscalateReplyDto>` and the
   listeners. `on(listener)` adds a listener; `declare(flags)` is
   called from `FsmService.load()`, rather than a new object per load,
   as `test/e2e/mqtt.broker.spec.ts:105` loads after `app.init()` and a
   new object would lose the notifier's listener. Each of the others
   emits one `EscalationData` to every listener:
   - `failure(machine)`: emits when `onFailure` is set.
   - `noTransition(machine, event)`: emits when `onNoTransition` is
     set, `machine.state` is defined, and the pair
     `(machine.entry, event)` was not sent; a new entry clears the
     record. It keeps two branches: a helper
     `firstTime(machine, event): boolean` owns the record, which keeps
     Qlty headroom.
   - `request(body, requestKey, machine)`: resolves `'escalate'` with
     `keep: () => true`; `compute` emits and returns the reply.
     `mismatch` cannot fire and returns the same reply. `machine` may
     be `undefined`.
1. In `src/fsm/definition.ts` (239 lines) add one line each: the
   import, `escalation: escalationSchema` in `fileSchema`,
   `escalation: Escalation` in `Definition`, and `escalation` in
   `toDefinition`, whose parameter becomes
   `{ events, states, ...sections }` (a fourth name would make prettier
   break it over five lines). `hasProtoKey` is unchanged: a strict
   object refuses `__proto__` as an unknown key. The file reaches 243.
   05 (`manager`) and 08 add sections here in parallel; the last of the
   three to merge moves the cycle search, `LOOPING_EVENTS` through
   `completionCycle` (lines 130-165), to `src/fsm/completion-cycle.ts`,
   the name 05's plan uses, if the file passes 250, so that whichever
   branch moves it produces the same file.
1. In `src/fsm/fsm.service.ts`, without a new constructor parameter:
   - an `escalations = new Escalations()` field;
     `this.escalations.declare(definition?.escalation)` in `load()`;
   - `onEscalation(listener)` and `escalate(body, requestKey)`, which
     passes `this.machine` and works without one;
   - `event()` calls `move` and, on `no transition`, calls
     `noTransition(machine, event)`; `raise` (04) calls
     `this.requests.answer((machine) => this.move(machine, event))`;
   - `complete()` (lines 235-248) calls `failure(machine)` when `next`
     is `undefined` and the event is `$failure`. A prettier-formatted
     draft of the service with every change of this plan is 241 lines.
1. `DescriptorService.onEscalation(listener)` forwards to
   `FsmService.onEscalation`, as `onChange` does. `Notifier.onModuleInit`
   adds `this.descriptor.onEscalation((data) => this.send('escalation', data))`.
   The fakes of `DescriptorService` and `FsmService` in
   `test/unit/notifier.service.spec.ts` and
   `test/unit/descriptor.service.spec.ts` get `onEscalation` before the
   first run.
1. Add `POST /escalate` to `src/app.controller.ts`: `FsmService`
   becomes its third constructor parameter, under the limit of four,
   rather than an `escalate` passthrough on `DescriptorService`, which
   describes the DT; `@HttpCode(HttpStatus.ACCEPTED)`, the zod pipe and
   `validRequestKey`. Add `escalate` to `mqttRoutes` in
   `src/mqtt/mqtt.config.ts` and to the routes of
   `src/mqtt/mqtt-request.handler.ts`:
   `this.whenValid(escalateSchema, (body, key) => this.fsm.escalate(body, key))`.
1. For the end-to-end test, move `startBroker` and `stopBroker` from
   `test/e2e/mqtt.spec.ts` to `test/e2e/mqtt.util.ts`, and the `Webhook`
   server of `test/e2e/webhook.spec.ts` to `test/e2e/webhook.util.ts`,
   with `received` checking the whole body. The test starts the runner
   with `startRunner` of `test/e2e/util.ts` on a `digitalTwin` folder,
   which loads the state machine, after
   `jest.spyOn(Config.prototype, 'getMqtt')` and `'getNotify'`, as
   `test/e2e/webhook.spec.ts:200-202` does, and then starts
   `MqttService`; so MQTT, the webhook and the state machine run in one
   runner. That an escalation is not retained is checked on the broker:
   aedes's retained stream for `<base>/notify/+` holds only the state
   topic. `lateSubscriber` resolves on the first message, so it can not
   show that a message is missing.
1. Sweep the documentation:
   - `README.md`: a `/escalate` row in the HTTP route table and the
     sentence that counts the routes; an `escalate` row in the MQTT
     table; an `escalation` subsection under State Machine with the
     declaration and the triggers; a request section with the body,
     limits, reply and key handling; `escalation` in the kind list of
     Notifications, not retained.
   - `api/dev.api.http` and `api/dev.mqtt.http`: an escalation request,
     with a key over HTTP.
   - `docs/state-machine-design.md`: the Validation section's list of
     top-level keys; amend A4 (the runner raises escalations by itself
     on the declared triggers; an escalation raises no event); add D25
     (D23 and D24 are 05's): opt-in triggers declared by the DT author,
     deduplicated per entry, and an explicit request that needs no
     machine.
   - `src/dto/notify.dto.ts:1`: the comment says that only presence is
     left, for 07.
   - `docs/issues/README.md`: the status row of 06. No version bump:
     the change adds routes and breaks none.
   - `DEVELOPER.md` names no route or notification, so it needs no
     change; the pull request says so. `docs/developer/codebase/runner.md`
     documents the route set and goes stale; the pull request lists it
     for a separate change, as no change leaves
     `servers/execution/runner`.

## Tasks

- [ ] After the moves of steps 1 and 2 the service answers as before,
      and `StateMachine.describe(status)` returns the machine document.
      Check: `test/unit/fsm.service.requests.spec.ts`,
      `test/unit/fsm.service.spec.ts`,
      `test/unit/fsm.state-machine.spec.ts`.
- [ ] The section defaults both flags to `false` when missing or
      partial, and rejects an unknown key, `__proto__` and a
      non-boolean; `parseDefinition` carries it. `Escalations` emits
      nothing without flags, `failure` once per call, `no-transition`
      once per entry and event and again after a new entry, nothing
      before the first transition; `request` emits with `state: null`
      and `entry: 0` without a machine, emits once per key, also for a
      repeat with another body, and every time without a key. Check:
      `test/unit/fsm.escalation.spec.ts`.
- [ ] `escalateSchema` accepts a 1024-byte `reason` and a 4096-byte
      `proposal`, and rejects a missing or empty `reason`, one byte
      more of either, and a `proposal` that is an array or `null`.
      Check: `test/unit/escalation.dto.spec.ts`.
- [ ] Through `FsmService` with a `scriptFolder` definition that has
      the section: a `$failure` without a transition escalates; one
      whose target's script is running does not; `$stopped` does not;
      a repeated client event escalates once per entry; an event that
      a parameter raises does not; nothing escalates with the flags
      off. Check: `test/unit/fsm.service.escalation.spec.ts`.
- [ ] `DescriptorService.onEscalation` forwards; the notifier sends an
      escalation unretained. Check: `test/unit/descriptor.service.spec.ts`,
      `test/unit/notifier.service.spec.ts`.
- [ ] The MQTT `escalate` route returns `{ "status": "accepted" }`,
      the validation body for a bad payload or key, and passes the key.
      Check: `test/unit/mqtt-request.escalate.spec.ts`,
      `test/unit/mqtt.config.spec.ts` (route list).
- [ ] `POST /escalate` answers `202` with and without a machine, `400`
      for a bad body, and replays a repeated key without a second
      notification; the escalation reaches the webhook, and a client
      that subscribes to `<base>/notify/+` on the local aedes broker
      after the escalation receives the retained `state` notification;
      the broker retains nothing on `<base>/notify/escalation`. Check:
      `test/e2e/escalation.spec.ts`.
- [ ] README, request files, design document (Validation, A4, D25) and
      the index updated. Check: from the repository root,
      `npx markdownlint-cli -c .markdownlint.yaml` on them.
- [ ] `yarn build` and `yarn test` pass. eslint lints no `.ts` file,
      so `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` must
      be clean, no file passes 250 lines, and no function crosses the
      Qlty thresholds. Check: their output; the Qlty thresholds counted
      by hand, as the CLI runs in CI.
