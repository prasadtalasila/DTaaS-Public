# 07 Presence: Join and Leave

- Status: planned
- Depends on: 01, 03
- PR: none
- Research note:
  [item 7](../dtn-research-notes.md#7-presence-join-and-leave)

## Spec

P2 assumes DTs join and leave the network at runtime, and P1's Manager
keeps a database of DT addresses. Today nothing is published without a
request, so a Manager learns of a runner only when it asks. This
feature announces the runner when it connects and when it leaves, over
the transports of 03.

### MQTT

- On every `connect` (first connection and each reconnect), publish on
  `<base>/notify/presence`, QoS 1, retained:

  ```json
  {
    "kind": "presence",
    "id": "hospital-1",
    "time": "2026-10-25T10:00:00.000Z",
    "data": { "online": true, "descriptor": { "...": "GET /dt of 01" } }
  }
  ```

- Register an MQTT Last Will on the same topic, retained, QoS 1:

  ```json
  {
    "kind": "presence",
    "id": "hospital-1",
    "time": null,
    "data": { "online": false }
  }
  ```

  The will is fixed when the client connects, so it carries no time;
  the broker publishes it when the runner disappears without a
  disconnect.

- In `beforeApplicationShutdown`, publish `online: false` with the
  current time, retained, and wait at most 2 s for it before the
  forced `endAsync(true)`, so a clean shutdown does not hang on an
  unreachable broker.

### Webhook

With `notify.url`, the online envelope is posted once at startup and the
offline one once at shutdown, with one attempt and a 2 s timeout, so
shutdown is not held by the retry schedule of 03.

Without MQTT and without a webhook, nothing is announced.

## Plan

1. Add `presence(online)` to the notifier of 03
   (`src/notify/notifier.service.ts`), building the envelope with the
   descriptor of 01; give `WebhookClient` a `sendOnce(envelope)` for
   the shutdown case.
1. In `src/mqtt/mqtt.service.ts`, add the will to `clientOptions`
   (lines 96-104), publish the online envelope from the `connect`
   handler in `listen` (lines 73-76), and publish the offline envelope
   in `beforeApplicationShutdown` (lines 90-94) with a 2 s race before
   `endAsync(true)`.
1. Call the webhook presence from `onApplicationBootstrap` and
   `beforeApplicationShutdown` of the notifier.
1. Document the topic and the will in `README.md` (MQTT API), add a
   subscription example to `api/dev.mqtt.http`, and record the decision
   in the design document.

## Tasks

- [ ] `clientOptions` carries a retained QoS 1 will on the presence
      topic with `online: false`. Check: `test/unit/mqtt.service.spec.ts`.
- [ ] The online envelope is published on each `connect`, retained,
      with the descriptor. Check: `test/unit/mqtt.service.spec.ts`.
- [ ] Shutdown publishes `online: false` and still ends within 2 s when
      the publish never resolves. Check: `test/unit/mqtt.service.spec.ts`
      with fake timers.
- [ ] A late subscriber receives the retained online message; after the
      runner closes, it receives the offline one. Check:
      `test/e2e/mqtt.broker.spec.ts`.
- [ ] The webhook receives one online post at startup and one offline
      post at shutdown. Check: `test/e2e/webhook.spec.ts`.
- [ ] README, design document and request files updated. Check:
      `npx markdownlint-cli README.md docs/*.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
