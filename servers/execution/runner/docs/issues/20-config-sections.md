# 20 Group the Sections of runner.yaml

- Status: planned. This is a breaking change to `runner.yaml`, so it
  waits for the owner's approval of the layout below before any code
  changes (`AGENTS.md`, Restrictions).
- Depends on: none. Land it before 19, so that 19 adds `stateInterval`
  and the `sensor` role to the new layout.
- PR: none yet
- Research note: none

## Spec

`runner.yaml` has grown to twelve top-level keys, each added by its
own issue. The operator's settings fall into three kinds:

- **what runs:** id, port, scripts directory, state machine, database;
- **who the DT deals with:** the Manager it notifies, and the peers it
  follows;
- **security:** who may call it, how it signs, and as whom its scripts
  run.

The flat layout does not show these kinds. This issue groups the last
two under two new keys.

### Layout

```yaml
id: 'hospital-1'
attributes:
  city: 'Aarhus'
port: 5100
location: 'scripts'
commands:
  - open
  - full
  - closed
stateMachine: 'hospital.fsm.yaml'
database: 'runner.db'
stopGrace: 1000
mqtt:
  url: 'mqtt://localhost:1883'
  topic: 'dtaas/hospital-1'
relationships: # the other parties of this DT in the network
  manager:
    notify: # the webhook that receives the notifications
      url: 'https://manager.example.org/dt-events'
      token: 'secret'
  peers: # the DTs that this one follows
    - id: 'hospital-2'
      topic: 'dtaas/hospital-2'
      attributes:
        distance: 12.4
security: # who may call, how the runner signs, as whom scripts run
  principals:
    - name: 'manager-1'
      role: 'manager'
      publicKey: 'mCpoaytWvGJ9K0lxNlSNw6sjUG7UezRWtxPvL1pyxKA'
  key: 'keys/hospital-1.key'
  scripts:
    user: 'dt-script'
    runDirectory: '/var/lib/dt/hospital-1/run'
```

| Today             | New path                       |
| :---------------- | :----------------------------- |
| `notify`          | `relationships.manager.notify` |
| `peers`           | `relationships.peers`          |
| `auth.principals` | `security.principals`          |
| `auth.key`        | `security.key`                 |
| `scripts`         | `security.scripts`             |

The schema of each moved section does not change. Only where it sits
changes. `mqtt` stays at the top: it carries the API as well as the
notifications, so it belongs to "what runs".

### Why not one `relationship` section

The first proposal put `notify`, `auth`, `peers` and `scripts` under
one `relationship` key. Only two of them describe the DT's relations
with other parties:

| Key               | What it describes                                  | A relationship?                                                 |
| :---------------- | :------------------------------------------------- | :-------------------------------------------------------------- |
| `notify`          | where notifications go: the Manager                | yes                                                             |
| `peers`           | the DTs it follows: P1's `R`, WLDT's relationships | yes                                                             |
| `auth.principals` | who may call, with which role                      | partly: the callers are parties, but the list is access control |
| `auth.key`        | the DT's own signing identity, used for everyone   | no: identity, like `id`                                         |
| `scripts`         | the local Linux account of its own scripts (18)    | no: privilege separation on one machine                         |

"Relationship" already means a link between DTs in the DTN papers, in
WLDT, and in the comment on a peer's `attributes`. Security settings
under that name would be hard to find for an operator reading
`SECURITY-MODEL.md` and `PRIVILEGE-SETUP.md`, which are built around
them. `principals` could also sit under `relationships.manager`, but
that would split the access list across two sections.

### Migration

- For one minor version (0.11), the runner accepts either layout. A
  file that uses an old key starts with one warning in the log, which
  names each old key and its new path.
- A file that sets the same section in both places, such as `peers`
  and `relationships.peers`, is a startup error.
- The next minor version (0.12) removes the old keys; the strict schema
  then refuses them.
- `package.json` goes to `0.11.0`, and the README gets a line under its
  changes, as the [Delivery](README.md#delivery) rules require for a
  breaking change.

## Plan

1. `src/config/config.schema.ts`: add `relationships` and `security`
   objects built from the existing section schemas. A `preprocess` step
   moves the old keys to their new paths and records each one it moved,
   so the rest of the code sees only the new layout. `refuseSelf` reads
   `relationships.peers`.
2. `src/config/configuration.service.ts`: the getters (`getNotify`,
   `getPeers`, `getScriptUser`, the signer and the principals) read the
   new paths, and the deprecation warning is logged once. The
   consumers use only these getters (`descriptor.service.ts`,
   `execa-manager.service.ts`, `fsm.service.ts`, `subscriptions.ts`,
   `health.service.ts`, `mqtt.service.ts`, `webhook.client.ts`), so
   none of them change.
3. Move the configs to the new layout: `config/runner.yaml.sample`,
   `config/runner.test.yaml.sample`, `demo/hospital/runner.yaml`,
   `demo/hospital/runner-2.yaml`, and the test configs that set these
   keys.
4. Documentation: `README.md`, `api/API.md`, `SECURITY-MODEL.md`,
   `PRIVILEGE-SETUP.md`, and a decision in
   `docs/state-machine-design.md` that amends S4's list of what
   `runner.yaml` holds. Issue files 03, 13, 15a, 15b and 18 keep their
   old examples, because they record what was built; this file is the
   pointer.

## Tasks

- [ ] The new layout loads, the old layout loads with one warning that
      names every moved key, and a section set in both places is
      refused. Check: `test/unit/config.schema.spec.ts`.
- [ ] Every getter returns the same value for both layouts of one
      configuration. Check: `test/integration/config.layout.spec.ts`
      (new), beside `config.auth.spec.ts` and `config.scripts.spec.ts`.
- [ ] Samples, demo configs and test configs use the new layout, and
      the full suite passes. Check: `yarn test`; yamllint from the
      repository root on the samples.
- [ ] Documents updated. Check: markdownlint from the repository root.
- [ ] `yarn build` and `yarn test` pass, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is clean.

## Learnings

To be written by the pull request that implements this issue.
