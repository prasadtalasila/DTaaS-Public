# 21 The State Machine File as a DT Class

- Status: in progress. The code, tests and documents are on the branch
  `runner/21-dt-class`; no pull request is open.
- Depends on: 19 (the value types, the `relationships` layout), 13 and
  16 (peers and their subscriptions)
- PR: none yet
- Research note: C1 and C3 of
  [dt-capabilities-comparison.md](../dt-capabilities-comparison.md),
  and W8 of [wldt-research-notes.md](../wldt-research-notes.md).

## Spec

Each DT had its own state machine file. Two twins of one kind, such as
the two hospitals of the demo, kept two copies that differed in one
number and in a block that named a peer. The owner wants to deploy
many twins of one kind from one file, and later to export a
description of the kind.

The state machine file is now a **class**, and `runner.yaml` describes
one **instance** of it. The **interface** is what a caller sees of a
class; it follows from the class and is not exported here.
[CLASS-INSTANCE-INTERFACE.md](../../CLASS-INSTANCE-INTERFACE.md) is
the account for users. The mental model is:

1. the DT author gives a state machine file and its scripts;
2. the operator fills in `runner.yaml` and runs the DT.

### Class identity (C1)

```yaml
class:
  id: 'urn:dtaas:demo:hospital'
  version: '1.0.0'
```

The section is optional. `id` is up to 200 characters and `version` up
to 64, both without spaces. `GET /dt` and the presence notice show
`class`, or `null`. The runner never interprets the id and never
compares versions.

The id is not what makes sharing work: two runners share a class by
naming one file. It is built here because it is small and a Manager
can use it at once, to group twins by kind. Later it names what is
exported (C4) and what a saved twin is a twin of.

### Instance values (C3)

`runner.yaml` may set the value of any declared parameter:

```yaml
stateMachine: 'hospital.fsm.yaml'
parameters:
  capacity: 1
```

- The value takes the place of the `default` of the class for this
  instance, for a controllable parameter too.
- It is checked against the declaration at the start. A name that is
  not declared, or a value that does not fit, stops the runner.
- A value that a Manager set and the database stored still wins after
  a restart.
- `parameters` without a `stateMachine` stops the runner.

The research note proposed placeholders in the file, such as
`{{CAPACITY}}`. The owner chose instance values: the class stays a
valid file that loads alone, a value has a declared type, and an
instance can change only what the class declares.

### Relationships by name (W8)

The owner asked whether W8 could wait. It could have been added later
without breaking anything, as `relationship` is a new key beside
`peer`. It is in this issue because the owner also wants both demo
hospitals to share one file, which a subscription to `peer: hospital-2`
does not allow.

```yaml
# the class
subscriptions:
  - relationship: neighbour
    when:
      state: full
    event: neighbour-full
```

```yaml
# the instance
relationships:
  peers:
    - id: 'hospital-2'
      topic: 'dtaas/hospital-2'
      relationship: neighbour
```

- A subscription names a peer or a relationship, never both.
  `peer: <id>` stays valid.
- At the start, a subscription to a relationship becomes one for each
  peer that `runner.yaml` gives the relationship. Each peer is watched
  by itself.
- A relationship that no peer has is no error. Its subscriptions are
  idle, and the runner logs one line.
- A peer has one relationship or none, and `GET /peers` shows it.

### What the two files must agree on

Nothing new is checked, but the rule is now written down: every state
and every command of `manager.commands` is under `commands` of
`runner.yaml`, as a state or a command is the name of its script.

### A new version of a class

The runner does not compare versions, because it can not know which
changes are compatible. It keeps what it did: a stored state that the
file no longer has starts the machine unstarted, and a stored value
that no longer fits is dropped, each with a warning. An instance value
that no longer fits stops the runner, as the operator wrote it.

### Not in this issue

- Exporting the interface as a Thing Description or DTDL (C4).
- Typed relationships with a target class (C5).
- Inheritance or composition of classes.
- A registry of classes.
- Instance values for anything but parameters.
- Several relationships for one peer.

### Open

- **One file or two for the operator.** `runner.yaml` holds the
  settings of the process and those of the instance. The document for
  users argues both ways; the runner keeps one file until the owner
  decides.

## Plan

As built:

1. `src/fsm/class.ts` (new): the `class` section, and `instantiate`,
   which gives a definition the parameter values and the peers of one
   instance.
2. `src/fsm/load.ts` (new): `loadDefinition`, moved out of
   `definition.ts` to make room, now ending in `instantiate`.
3. `src/fsm/definition.ts`: the section; `Definition.dtClass`.
4. `src/config/config.schema.ts` and `configuration.service.ts`:
   `parameters` and its getter.
5. `src/fsm/subscriptions.ts`: `relationship` beside `peer`; `bind`
   resolves the subscriptions of an instance, so that `PeerEvents`
   does not change; `known` gathers the peers of each relationship.
6. `src/peers/peers.config.ts`, `src/peers/peers.ts`,
   `src/dto/peers.dto.ts`: the `relationship` of a peer.
7. `src/dto/descriptor.dto.ts`, `src/descriptor.service.ts`: `class`.
8. `demo/hospital`: one class file for both runners.
9. Documents: `CLASS-INSTANCE-INTERFACE.md` (new), `README.md`,
   `STATE-MACHINE.md`, `api/API.md`, `docs/state-machine-design.md`.

## Tasks

- [x] The `class` section is read, optional, and refused when it is
      incomplete or has spaces. Check: `test/unit/fsm.class.spec.ts`.
- [x] `/dt` shows the class, or `null`. Check:
      `test/unit/descriptor.service.spec.ts`,
      `test/e2e/descriptor.spec.ts`.
- [x] An instance value becomes the default, a stored value of a
      controllable parameter still wins, and every value that is not
      declared or does not fit is named. Check:
      `test/unit/fsm.class.spec.ts`.
- [x] `runner.yaml` takes `parameters`, and a runner started with them
      shows the value. Check: `test/integration/config.layout.spec.ts`,
      `test/e2e/properties.spec.ts`.
- [x] A subscription names a peer or a relationship; a relationship is
      bound to each of its peers, and is idle without one. Check:
      `test/unit/fsm.relationships.spec.ts`.
- [x] A peer takes a relationship, and `GET /peers` shows it. Check:
      `test/unit/peers.schema.spec.ts`, `test/unit/peers.spec.ts`.
- [x] Both demo configurations load the one class file, with their
      own capacity and subscriptions. Check: loaded once by hand with
      the built runner; yamllint from the repository root.
- [x] `yarn build` and `yarn test` pass (1390 tests, against 1354
      before), `yarn syntax` is clean, and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` is
      clean.
- [ ] Documents updated. Check: markdownlint and prettier from the
      repository root.
- [ ] The demo runs with the one file. `pwsh` was not on the machine
      that built this. Check: `node tools/record.mjs` on Windows.

## Learnings

- **Resolve at the start, not at each notice.** A subscription to a
  relationship is turned into one per peer when the definition is
  loaded. `PeerEvents`, its edge detection and its log lines did not
  change, and each peer is watched by itself for free.
- **An instance is a definition with other defaults.** `instantiate`
  returns a `Definition` whose defaults are the instance values, so
  `Parameters`, the script environment and `GET /parameters` needed no
  change.
- **Check a class without its instances.** The events of a
  subscription to a relationship are checked on the file, before it
  is bound. Checked after, a mistake would show in one instance and
  hide in another that has no such peer.
- **Sharing a file found a second difference.** The two demo files
  differed in a default and in a block of subscriptions that one of
  them lacked. An idle relationship is what lets hospital-2 share the
  file and still follow no one.
- **The demo prints its files by line number.** `steps.mjs` shows
  ranges of `hospital.fsm.yaml`; issue 19 had already shifted them
  without anyone noticing, and this issue set them again.
- **Room was made by moving a whole function.** `definition.ts` was
  at 249 lines, and `fsm.service.ts` reached 250 with one more
  import. `loadDefinition` moved to `load.ts`, which also took the
  call that builds its argument.
