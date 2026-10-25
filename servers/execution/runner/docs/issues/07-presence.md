# 07 Presence: Join and Leave

- Status: in review
- Depends on: 01, 03
- PR: [#82](https://github.com/prasadtalasila/DTaaS-Public/pull/82)
- Research note:
  [item 7](../dtn-research-notes.md#7-presence-join-and-leave)

## Spec

P2 assumes DTs join and leave the network at runtime, and P1's Manager
keeps a database of DT addresses. Today nothing is published without a
request, so a Manager learns of a runner only when it asks. This
feature announces the runner when it connects and when it leaves, over
the transports of 03, as notifications of kind `presence`.

### Envelope

The online notice carries the descriptor of 01 (`GET /dt`):

```json
{
  "kind": "presence",
  "id": "hospital-1",
  "time": "2026-10-25T10:00:00.000Z",
  "data": { "online": true, "descriptor": { "...": "GET /dt of 01" } }
}
```

The offline notice is `{ "online": false }` with the current time. The
MQTT will is the same notice with `"time": null`, as the will is fixed
when the client connects. That is the one exception to S7's envelope:
`NotificationDto.time` becomes `string | null`, not a separate will
type, because the will and the offline notice share one topic and one
shape, so a receiver cannot tell their types apart anyway, and a
separate type would turn the parameter of `MqttService.notify` and
`WebhookClient.post` into a union for no gain.

### MQTT

- On every `connect` (first connection and each reconnect), the online
  notice is published on `<base>/notify/presence`, QoS 1, retained. A
  reconnect publishes over MQTT only, not to the webhook.
- The client connects with a will on the same topic, QoS 1, retained.
  The broker publishes it only when the runner disappears without a
  clean shutdown: a crash, a kill or a lost connection.
- At shutdown, `MqttService.beforeApplicationShutdown`:
  1. publishes the offline notice with the current time, retained, and
     races it against 2 s;
  1. if the publish settled (acknowledged or failed), ends gracefully
     with `endAsync()`, which sends DISCONNECT, so the broker drops the
     will and the retained notice keeps its time; the end is raced
     against 2 s too;
  1. if the publish did not settle, ends with `endAsync(true)`;
  1. if the graceful end did not finish, destroys the socket with
     `client.stream.destroy()`. A second `end()`, forced or not, is a
     no-op once a graceful one has started: mqtt.js calls it back at
     once while `disconnecting` is set (`client.js` ~929), and the
     graceful end may still wait for `outgoingEmpty` (~826).
  1. Either fallback logs a warning that names the leave, "the broker
     did not confirm the leave", so that it can not be taken for the
     error that `notify()` logs for a failed publish. The broker may
     then publish the will, which overwrites the retained notice with
     `time: null`; it still says offline.

The race timers are cleared when the promise settles, so they do not
hold the process open. The leave adds at most 4 s to the shutdown.

### Webhook

With `notify.url`, the online notice is posted once at startup with the
retries of 03. The offline notice is posted once at shutdown, with one
attempt and a timeout of 2 s, so the retry schedule of 03 cannot hold
the shutdown. Nest runs the `beforeApplicationShutdown` hooks of the
module concurrently, so the webhook's 2 s overlap the MQTT wait.

Without MQTT and without a webhook, nothing is announced. Presence
adds a kind and a topic and breaks no route, so the version stays.

### Ownership

Nest calls the `beforeApplicationShutdown` hooks of one module in
provider order in one tick (`Promise.all` over an async `map`):
`MqttService`, then `WebhookClient`, then `Notifier`
(`src/app.module.ts:27-40`). By the time the notifier's hook runs, the
MQTT client is already disconnecting, so `MqttService` publishes the
offline notice itself. It builds the will and the offline notice from
`Config` alone (`getId()`, `new Date()`), and gains no constructor
parameter.

The online notice needs the descriptor, which `MqttService` cannot
reach without a fourth constructor parameter. So `MqttService` gains
`onConnect(listener)`, backed by a `Changes` instance of 03 and emitted
from its `connect` handler; `Notifier.onModuleInit` subscribes and
publishes the online notice through `MqttService.notify`. No
constructor changes anywhere.

`main.ts` calls `start()` right before `app.listen()`, which runs
`app.init()`, and `test/e2e/mqtt.util.ts` calls it before `app.init()`.
The first `connect` event follows the CONNACK and the
drain of the outgoing store, both I/O, while `init()` reaches
`onModuleInit` through promises alone, so the listener is registered
first. Were it not, the online notice would wait for a reconnect; the
broker tests below would show it. As a fallback for that case,
`onConnect` calls a listener at once when `client.connected` is already
true, so a missed first `connect` still announces the runner.

## Plan

1. In `src/dto/notify.dto.ts`, make `time` `string | null` with a
   comment naming the will, and add
   `offlineNotification(id, time): NotificationDto`, as `commandState`
   sits in `state.dto.ts`.
1. In `src/mqtt/mqtt.config.ts`, add a pure
   `presenceWill(base, id): IClientOptions['will']` (topic
   `notifyTopic(base, 'presence')`, payload
   `offlineNotification(id, null)`, QoS 1, retained), and move
   `clientOptions` there from `mqtt.service.ts` (lines 106-114) as
   `clientOptions(options, id)`, adding `will`. This keeps
   `mqtt.service.ts`, which would otherwise land near 240 lines, well
   under 250.
1. Widen the comment of `src/notify/changes.ts`, which names the state
   document only, to any signal.
1. In `src/mqtt/mqtt.service.ts`:
   - `start` passes `this.config.getId()` to `clientOptions`;
   - a field `connects = new Changes()`, `onConnect(listener)`, and
     `this.connects.emit()` in the `connect` handler of `listen`
     (lines 76-79);
   - `beforeApplicationShutdown` (lines 93-97) follows the sequence of
     the spec, publishing through `this.notify('presence', ..., true)`,
     which resolves on success and on failure. Split it into a leave
     and an end step, each under 25 lines, with a module-level
     `settles(promise, ms): Promise<boolean>` that clears its timer.
1. In `src/notify/webhook.client.ts`:
   - `attempt(webhook, body, signal)` takes its signal; `deliver`
     passes the signal that `attempt` builds today,
     `AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT)])`,
     and returns before an attempt once the controller is aborted, the
     check that `attempt` makes today (lines 63-65);
   - `sendOnce(notification)` makes one attempt with
     `AbortSignal.timeout(2000)` and no retry, so the controller that
     the client's own hook has aborted does not stop it;
   - `failed` skips its log while the controller is aborted (line 97),
     which would hide every failure of `sendOnce`. Instead, the catch
     of `attempt` treats an error named `AbortError` as no failure:
     only the controller aborts so, as a timeout rejects with a
     `TimeoutError`. `failed` drops its check.
1. In `src/notify/notifier.service.ts`:
   - `onModuleInit` also subscribes `mqtt.onConnect`, publishing the
     online notice with `RETAINED.presence` unless stopped;
   - `onApplicationBootstrap` also posts the online notice with
     `webhook.post`, unless stopped, as the state document;
   - `beforeApplicationShutdown` becomes async: it sets `stopped`, then
     awaits `webhook.sendOnce` of
     `offlineNotification(id, new Date().toISOString())`;
   - a private `online()` builds the online notice from `describe()`.
1. Tests and fixtures:
   - `test/unit/mqtt.fixture.ts`: the fake `Config` gets
     `getId: () => 'hospital-1'`; `FakeClient` gets
     `stream = { destroy: jest.fn() }`.
   - `test/unit/mqtt.service.spec.ts`: the exact
     `toHaveBeenCalledWith` of the client options (line 16) gains the
     will. The shutdown test (lines 196-201) expects `endAsync(true)`;
     it moves to the new spec as the settled path.
   - New `test/unit/mqtt.presence.spec.ts` (pattern:
     `mqtt.notify.spec.ts`), not `mqtt.service.spec.ts` (219 lines).
   - `test/unit/webhook.client.spec.ts` has 194 lines; the four
     `sendOnce` cases go to a new `test/unit/webhook.once.spec.ts` if
     the file would cross 250.
   - `test/e2e/mqtt.util.ts`: `nextNotification` takes a type parameter
     for `data`, defaulting to `StateDocumentDto`, so existing callers
     stay as they are.
1. Document, in `README.md`: the presence topic under MQTT API, the
   `presence` kind and its notices under Notifications (with the
   `time: null` exception and the shutdown sequence), and the shutdown
   post under Webhook. In `DOCKER.md` (lines 120-122), add that leaving
   the broker can take up to 4 s of the stop grace period. In
   `api/dev.mqtt.http`, amend the comment of the `notifications`
   request: `notify/+` also brings the retained presence notice. In
   `docs/state-machine-design.md`, add a decision with the next free D
   number (05, 06 and 08 add decisions in parallel): presence is a
   retained notice per connect, an offline notice at shutdown and a
   will for a disappearance, with the graceful end that keeps the
   will for that case; and extend A4's amendment to presence.

## Tasks

- [x] `presenceWill` gives a retained QoS 1 will on
      `<base>/notify/presence` with `online: false` and `time: null`;
      `clientOptions` carries it. Check: `test/unit/mqtt.config.spec.ts`
      and the options test of `test/unit/mqtt.service.spec.ts`.
- [x] `onConnect` listeners run on each `connect`. Shutdown publishes
      the offline notice retained with the current time (fake clock)
      and then calls `endAsync()` without `true`; without MQTT it does
      nothing. Check: `test/unit/mqtt.presence.spec.ts`.
- [x] With fake timers, a `publishAsync` returning
      `new Promise(() => {})`, then `jest.advanceTimersByTimeAsync(2000)`,
      leads to `endAsync(true)` and a warning; an `endAsync()` that
      never settles leads, 2 s later, to `stream.destroy()`. Check:
      `test/unit/mqtt.presence.spec.ts`.
- [x] `sendOnce` posts once, does not retry a failure, logs it even
      after `beforeApplicationShutdown`, and posts nothing without a
      webhook; the existing retry and abort tests pass unchanged.
      Check: `test/unit/webhook.once.spec.ts` and
      `test/unit/webhook.client.spec.ts`.
- [x] The notifier publishes the online notice with the descriptor,
      retained, on each connect and posts nothing then; posts it at
      startup; awaits `sendOnce` with the offline notice at shutdown;
      and publishes nothing on a connect after shutdown. Check:
      `test/unit/notifier.service.spec.ts`, its fakes extended with
      `onConnect` and `sendOnce`.
- [ ] A late subscriber receives the retained online notice; after
      `app.close()`, it receives the offline one with a time. `afterEach`
      also deletes the retained presence topic, as it does the state
      topic, since the public broker is shared. Check:
      `test/e2e/mqtt.broker.spec.ts`, `lateSubscriber` unchanged; it
      runs in CI only, as port 1883 is blocked on the development host.
      The same two checks run locally against aedes in
      `test/e2e/mqtt.presence.spec.ts`.
- [x] Destroying the runner's socket makes the broker publish the will
      (`time: null`), and the reconnect publishes the online notice
      again. The test subscribes to the presence topic before the
      destroy, destroys the stream through a helper rather than bracket
      access to a private member, which SonarCloud flags, and waits
      across the 1 s `reconnectPeriod` of mqtt.js, with a timeout above
      Jest's default 5 s. Check: `test/e2e/mqtt.presence.spec.ts`
      (local aedes broker).
- [x] `received()` of the test webhook first filters by `kind`, as a
      presence post has no `machine` and would pass the startup check;
      then the webhook receives one online post at startup and, after
      `app.close()` in the test, one offline post with a time. Check:
      `test/e2e/webhook.spec.ts`.
- [x] README, `DOCKER.md`, design document and request file updated.
      Check: from the repository root,
      `npx markdownlint-cli -c .markdownlint.yaml` on them.
- [x] `yarn syntax`, `yarn build` and `yarn test` pass; eslint lints no
      `.ts` file, so
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean; every changed file stays under 250 lines and every
      function under 25. Check: their output and `wc -l`.

## Learnings

- With `settles` module-level, `mqtt.service.ts` reached 249 lines, not
  well under 250 as planned: the shutdown sequence and `onConnect`
  outweigh the moved `clientOptions`. `settles` moved to
  `src/mqtt/settles.ts` in review, which leaves the service at 240
  lines for 05, 06 and 08.
- The will-and-reconnect test cuts the runner's connection on the
  broker's side, through the typed `conn` of the aedes `Client` that
  the `clientReady` event hands over. That needs neither bracket access
  nor an accessor on `MqttService` for its private client, and the
  runner sees what a network failure gives it. With local copies of
  the retained-notice and leave checks beside it, the presence tests
  would have taken `mqtt.spec.ts` (203 lines) past 250, so they went to
  `test/e2e/mqtt.presence.spec.ts`, with `startBroker` and `stopBroker`
  moved to `mqtt.util.ts`.
- aedes publishes the will on a forced end: replacing the graceful
  `endAsync()` with `endAsync(true)` made the local leave test fail,
  as the will replaced the retained offline notice. The local test
  guards the graceful end; the Mosquitto test runs only in CI.
- New tests spy on `Logger.prototype` instead of `service['logger']`.
  The webhook test helpers moved into `test/unit/webhook.fixture.ts`
  for `webhook.once.spec.ts`, so they count as new code for SonarCloud
  and use the prototype spy.
- The webhook e2e test closes the runner inside the test to see the
  offline post, so `app` became optional, as in the broker test.
- The presence decision is D26: 08 took D23, and 05 and 06 claim D24
  and D25. It is worded to fit the existing column widths of the
  decision table, so prettier does not realign every row and conflict
  with 05 and 06, which add decisions in parallel.
- 08 (PR #81) keeps `start()` before `app.listen()`, so the order the
  Ownership paragraph relies on holds; were `start()` ever moved after
  `listen()`, `onConnect` registers the listener before the client
  exists and the first `connect` still announces the runner.
- The version stays at 0.6.0, as the Spec says: presence adds a kind
  and a topic and breaks no route.
