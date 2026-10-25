# 12 Health Endpoint

- Status: planned
- Depends on: 02
- PR: none
- Research note:
  [item 12](../dtn-research-notes.md#12-health-endpoint)

## Spec

A Manager's Monitor must tell a silent DT from a dead one, and the
DTaaS platform needs a liveness check to deploy the runner behind its
gateway. The runner has none.

### API

`GET /health` and `<base>/health`:

```json
{
  "status": "ok",
  "uptime": 3724,
  "mqtt": "connected",
  "stateMachine": true,
  "database": "file"
}
```

- `status` is `ok`, or `degraded` when MQTT is configured but not
  connected or the database is closed. HTTP answers `200` in both
  cases; it answers `503` with `"status": "stopping"` once shutdown has
  begun, so a load balancer drains the instance.
- `uptime` is seconds since the process started, an integer.
- `mqtt` is `connected`, `disconnected` or `disabled`.
- `stateMachine` says whether a machine is loaded; `database` is `file`,
  `memory` or `closed`.
- The reply carries no version.

Over MQTT the route answers only while connected, so a reply at all is
the liveness signal; the body still names the other components.

## Plan

1. Add `isConnected()` to `src/mqtt/mqtt.service.ts` from
   `client.connected`, and `mode()` to `src/queue.service.ts` returning
   `file`, `memory` or `closed`.
1. Add `src/dto/health.dto.ts` and `src/health.service.ts` composing
   `Config`, `MqttService`, `FsmService` and `Queue`, with the stopping
   flag set in `beforeApplicationShutdown`.
1. Add `GET /health` to `src/app.controller.ts` and the `health` MQTT
   route.
1. Document the route in `README.md` and `api/*.http`, and add a note
   to `DOCKER.md` on using it as the container health check.

## Tasks

- [ ] Service reports `ok` with everything up, `degraded` with MQTT
      configured but disconnected and with a closed database, and
      `disabled` without MQTT. Check: `test/unit/health.service.spec.ts`.
- [ ] `GET /health` answers `200` normally and `503 stopping` after
      shutdown begins. Check: `test/e2e/health.spec.ts`.
- [ ] MQTT `health` route returns the body with `mqtt: connected`.
      Check: `test/unit/mqtt-request.handler.spec.ts`,
      `test/e2e/mqtt.spec.ts`.
- [ ] README, `DOCKER.md` and request files updated. Check:
      `npx markdownlint-cli README.md DOCKER.md`.
- [ ] `yarn syntax`, `yarn build` and `yarn test` pass. Check: their
      output.
