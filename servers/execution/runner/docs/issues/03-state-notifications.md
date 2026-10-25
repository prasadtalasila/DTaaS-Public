# 03 State Change Notifications

- Status: planned
- Depends on: 02
- PR: none
- Research note:
  [item 3](../dtn-research-notes.md#3-state-change-notifications)

## Spec

P1's Manager runs a Monitor that collects the states of the DTs. Today
it can only poll. This feature publishes the state document of 02
whenever it changes, over MQTT and over an optional HTTP webhook, and
gives 06 and 07 the same path for their notifications.

### When

A notification is sent when:

- the machine enters a state (`FsmService.enter`);
- the script of a state completes (`FsmService.run`, after `status` is
  set);
- a parameter value changes (04);
- the runner has started and loaded its configuration (and, with 09,
  restored its state).

### Envelope

Every notification, over both transports, is one JSON object:

```json
{
  "kind": "state",
  "id": "hospital-1",
  "time": "2026-10-25T10:00:00.000Z",
  "data": { "...": "the state document of 02" }
}
```

`kind` is `state`, `escalation` (06) or `presence` (07). `id` and
`time` repeat the document's values so a receiver can route on the
envelope alone.

### MQTT

Published on `<base>/notify/state`, QoS 1, retained, so a Manager that
connects later gets the current document. This is two levels under the
base topic and amends D16, which keeps request routes one level down;
requests stay where they are, and the client subscribes to exact
request topics (`src/mqtt/mqtt.service.ts:62`), so the `notify`
sub-tree cannot be mistaken for a request. The `mqtt.js` client stores
QoS 1 publishes while offline and sends them on connect.

### Webhook

```yaml
notify: # optional
  url: 'https://manager.example.org/dt-events'
  token: 'secret' # optional; sent as Authorization: Bearer <token>
```

Each notification is one `POST` of the envelope, `Content-Type:
application/json`, with a 5 s timeout, retried after 1 s, 2 s and 4 s
on a network error or a `5xx` response. A `4xx` response is not
retried. Notifications are sent independently and may arrive out of
order; `time` and `data.machine.entry` let a receiver order them. A
failure is logged once per URL until a delivery succeeds, as the MQTT
service logs repeated errors (`src/mqtt/mqtt.service.ts:72-81`).

Neither transport is required. Without both, `GET /state` is the only
observation.

## Plan

1. Add `src/notify/notify.config.ts` with the zod schema of the
   `notify` key and add the key to the configuration schema of 01.
1. Add `src/notify/changes.ts`: an injectable, typed Node
   `EventEmitter` with one event, `state`. `FsmService` emits it from
   `enter` and `run` instead of depending on the notifier, which
   avoids a dependency cycle through `StateDocumentService`.
1. Add `MqttService.publish(topic, body, { retain })` next to
   `respond` (`src/mqtt/mqtt.service.ts:106`), returning without
   effect when MQTT is not configured, and `notifyTopic(base, kind)`
   in `src/mqtt/mqtt.config.ts`.
1. Add `src/notify/webhook.client.ts` using the global `fetch` with
   `AbortSignal.timeout`, the retry schedule above and the
   once-per-URL error log.
1. Add `src/notify/notifier.service.ts`: subscribes to `Changes` on
   module init, builds the envelope from `StateDocumentService`, and
   fans out to `MqttService.publish` and `WebhookClient`. Exposes
   `send(kind, data)` for 06 and 07. Sends the startup notification
   from `onApplicationBootstrap`.
1. Register the units in `src/app.module.ts`.
1. Document the topic, the `notify` key and the envelope in
   `README.md`; amend D16 and A4 in `docs/state-machine-design.md`;
   add a subscription example to `api/dev.mqtt.http`.

## Tasks

- [ ] `notify` schema accepts `url` alone, `url` with `token`, and
      rejects a non-URL and an unknown key. Check:
      `test/unit/notify.config.spec.ts`.
- [ ] `FsmService` emits `state` on entry and on completion, once each,
      and not for a refused request. Check:
      `test/unit/fsm.service.spec.ts`.
- [ ] `MqttService.publish` publishes QoS 1 with the given retain flag
      and does nothing without MQTT. Check:
      `test/unit/mqtt.service.spec.ts`.
- [ ] Webhook client retries on network error and `5xx` at 1, 2 and
      4 s, stops after the third retry, does not retry `4xx`, sends the
      bearer token, and logs a repeated failure once. Check:
      `test/unit/webhook.client.spec.ts` with fake timers and a fake
      `fetch`.
- [ ] Notifier wraps the document in the envelope and sends it over
      both transports; the startup notification is sent once. Check:
      `test/unit/notifier.service.spec.ts`.
- [ ] A transition over HTTP produces a retained message on
      `<base>/notify/state` that a late subscriber receives. Check:
      `test/e2e/mqtt.broker.spec.ts`.
- [ ] A transition produces a `POST` on a local test server configured
      as `notify.url`. Check: `test/e2e/webhook.spec.ts`.
- [ ] README, design document (D16, A4) and request files updated.
      Check: `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
