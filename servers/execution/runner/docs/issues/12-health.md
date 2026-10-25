# 12 Health Endpoint

- Status: in progress
- Depends on: none
- PR: none
- Research note:
  [item 12](../dtn-research-notes.md#12-health-endpoint)

## Spec

A Manager's Monitor must tell a silent DT from a dead one, and the
DTaaS platform needs a liveness check to deploy the runner behind its
gateway. The runner has none. This is a liveness check only: it says
whether the process answers and whether its connections are up, not
whether the DT is doing its job.

### API

`GET /health` and `<base>/health`:

```json
{
  "status": "ok",
  "uptime": 3724,
  "mqtt": "connected",
  "database": "file"
}
```

- `mqtt` is `connected`, `disconnected` (configured, not connected,
  including while the client reconnects) or `disabled` (no `mqtt`
  section).
- `database` is `file` with a `database` file configured, else
  `memory`.
- `status` is `degraded` when `mqtt` is `disconnected`, else `ok`. HTTP
  answers `200` either way; MQTT connects asynchronously, so the first
  replies after start may say `degraded`.
- `uptime` is whole seconds since the process started
  (`process.uptime()`).
- The reply carries no version and no state machine information; the
  descriptor of 01 (`GET /dt`) says whether a machine is loaded.

Over MQTT the route can answer only while connected, so its reply
always says `connected`; that a reply arrives at all is the liveness
signal.

There is no `stopping` state: Nest closes the HTTP server right after
the `beforeApplicationShutdown` hooks, before the scripts drain, so a
`503` during shutdown could never be observed.

## Plan

1. Add `status()` to `src/mqtt/mqtt.service.ts`, returning `disabled`
   without an `mqtt` configuration, else `connected` or `disconnected`
   from `client?.connected`. Add `mode()` to `src/queue.service.ts`,
   returning `memory` when `db.location()` is `null`, else `file`.
1. Add `src/dto/health.dto.ts` and `src/health.service.ts`.
   `HealthService` injects only `Queue` and has
   `check(mqtt: MqttHealth): HealthDto`; it does not know `MqttService`,
   which would close an injection cycle through `MqttRequestHandler`.
   Register it in `src/app.module.ts`.
1. Add `GET /health` to `src/app.controller.ts`, passing
   `this.mqtt.status()`; add `health` to `mqttRoutes` in
   `src/mqtt/mqtt.config.ts` and its entry in
   `src/mqtt/mqtt-request.handler.ts`, passing `'connected'`.
1. Update `test/unit/mqtt.service.spec.ts` (the subscription list),
   `test/unit/mqtt-request.handler.spec.ts` (the constructor) and
   `test/integration/app.controller.spec.ts` if its setup needs the new
   provider.
1. Document the route in `README.md` (API section and the MQTT table),
   `api/dev.api.http` and `api/dev.mqtt.http`. In `DOCKER.md` and
   `compose.runner.yml`, add a health check that uses node, as the
   image has neither curl nor wget:

   ```yaml
   healthcheck:
     test:
       - CMD
       - node
       - -e
       - "fetch('http://localhost:5000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
   ```

   with the port of the mounted `runner.yaml`. Say that `degraded` is
   still `200`, so the check is liveness only.

1. In `docs/issues/README.md`, mark row 12 of the status table (status,
   and the PR once open), remove the `02 -> 12` edge from the order
   figure and give `12 health` a line of its own with no predecessor.

## Tasks

- [ ] `MqttService.status` reports `disabled`, `connected` and
      `disconnected`, including after a close. Check:
      `test/unit/mqtt.service.spec.ts`.
- [ ] `Queue.mode` reports `memory` and `file`. Check:
      `test/integration/queue.service.spec.ts`.
- [ ] `HealthService.check` reports `ok` and `degraded`, `file` and
      `memory`, and a whole number of seconds. Check:
      `test/unit/health.service.spec.ts`.
- [ ] `GET /health` answers `200` with the fields above. Check:
      `test/e2e/health.spec.ts`, using supertest with
      `expect.objectContaining` and an integer check on `uptime`.
- [ ] The MQTT `health` route returns the body with `mqtt: connected`.
      Check: `test/unit/mqtt-request.handler.spec.ts`.
- [ ] README, `DOCKER.md`, `compose.runner.yml`, the request files and
      the issue index updated. Check: from the repository root,
      `npx markdownlint-cli -c .markdownlint.yaml` on the markdown
      files.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass, and no function
      crosses the Qlty thresholds. Check: their output.
