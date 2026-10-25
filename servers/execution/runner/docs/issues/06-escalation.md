# 06 Escalation Signal

- Status: planned
- Depends on: 03
- PR: none
- Research note:
  [item 6](../dtn-research-notes.md#6-escalation-signal-r3-endogenous)

## Spec

P1's requirement R3: a DT signals the Manager when its local adaptation
space is exhausted or it wants a shared-policy parameter changed. P1's
prototype left this endogenous signal to future work. The runner cannot
evaluate what "exhausted" means for a DT, so the DT author declares
which observable conditions count, and scripts can escalate explicitly.

### Declaration

```yaml
escalation:
  onFailure: true # a $failure the current state has no transition for
  onNoTransition: true # a client event the current state has no transition for
```

Both default to `false`. Without the section, only explicit requests
escalate. A `$stopped` completion (10) never escalates.

### Explicit request

`POST /escalate` and `<base>/escalate`:

```json
{ "reason": "capacity", "proposal": { "scope": "multi" } }
```

- `reason` is a string of at most 1 KiB; `proposal` is an optional JSON
  object of at most 4 KiB, by convention the parameter values the DT
  would like (P1's `θ'`). The runner does not interpret it.
- Reply `202 { "status": "accepted" }`. The route works with or
  without a state machine, so a plain DT can escalate too. It takes an
  optional `Idempotency-Key`, handled like the `fsm` routes
  (`RecentReplies`), so a QoS 1 duplicate does not escalate twice.

### Notification

Sent through the notifier of 03 with `kind: "escalation"`, on
`<base>/notify/escalation`, QoS 1, not retained, and to the webhook:

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

- `trigger` is `failure`, `no-transition` or `request`. `event` names
  the client event for `no-transition`, else `null`. `reason` is the
  request's reason, or the runner's text for the automatic triggers
  (`script of state execute failed`, `no transition for restart`).
- The automatic triggers fire at most once per trigger per state entry,
  so a client that repeats an event does not flood the Manager.
- The caller of an event with no transition still gets `409
no transition`; escalation is a side effect, not a change of the
  reply.

## Plan

1. Add the `escalation` section to `fileSchema` and `Definition` in
   `src/fsm/definition.ts`.
1. Add `src/dto/escalation.dto.ts` with the request schema and size
   refinements, and the `EscalationData` type.
1. Add `src/escalation.service.ts`: builds `data` from `FsmService`
   state, tracks the (entry, trigger) pairs already sent, and calls
   `Notifier.send('escalation', data)`.
1. Hook the automatic triggers in `src/fsm/fsm.service.ts`: in `event`
   where `no transition` is returned (line 78-81) and in `complete`
   where `$failure` has no next state (line 155-158). Pass the decision
   to `EscalationService` so the service, not `FsmService`, grows.
1. Add `POST /escalate` to `src/app.controller.ts` with `RecentReplies`
   handling, and the `escalate` MQTT route.
1. Update `api/*.http`, `README.md`, the design document (amend A4: the
   runner now raises escalations by itself; add a decision for the
   opt-in triggers) and the developer page.

## Tasks

- [ ] Schema accepts the section, defaults both flags to `false`, and
      rejects an unknown key. Check: `test/unit/fsm.definition.spec.ts`.
- [ ] Request schema rejects a missing `reason`, one over 1 KiB and a
      `proposal` over 4 KiB. Check: `test/unit/escalation.dto.spec.ts`.
- [ ] Service sends `failure` once for a `$failure` with no transition
      when `onFailure` is set, nothing when it is not, `no-transition`
      once per entry for repeated events, and never for `$stopped`.
      Check: `test/unit/escalation.service.spec.ts`,
      `test/unit/fsm.service.spec.ts`.
- [ ] `POST /escalate` answers 202 with and without a machine and
      replays for a repeated key. Check: `test/e2e/escalation.spec.ts`.
- [ ] An escalation reaches `<base>/notify/escalation` unretained and
      the webhook. Check: `test/e2e/mqtt.broker.spec.ts`,
      `test/e2e/webhook.spec.ts`.
- [ ] MQTT `escalate` route returns the same body. Check:
      `test/unit/mqtt-request.handler.spec.ts`.
- [ ] README, design document and request files updated. Check:
      `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
