# Client Extensions and the DTaaS SDK

This page records how domain extensions ("plugins", "kits") are included in the
web client (`client/`), why it was done this way, and what is still open. It is
written from the design conversation of 2026-09-29 on the branch
`dtaas-sdk-plugin-structure-for-webclient`, and describes what that branch
implements.

## 1. Background

### 1.1 The problem

Until this change the Buildings page was wired into the client by hand in five
places: the route table (`src/routes.tsx`), the left menu
(`src/page/MenuItems.tsx`), the icon registry (`src/components/appIcons.tsx`),
a page adapter (`src/route/bim/`) and `package.json`
(`@into-cps-association/bim-kit`). Every new domain (wind turbines, water
networks, hospitals, …) would have touched all five again. There was no
contract saying what a domain package may contribute, how it reaches the
signed-in user's library, how it gets live data, or how a deployment switches
it off. The adapter also reached into the store, `util/envUtil` and the auth
utilities directly.

### 1.2 The SDK

[`prasadtalasila/dtaas-sdk`](https://github.com/prasadtalasila/dtaas-sdk) is
the contract between the client (the _host_) and extensions. Its `docs/` hold
the motivation and design:

| Document                                        | Content                                                                                  |
| :---------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `docs/dtaas-client-modular-architecture.md`     | Problem, goals, options A–D, target architecture, the contract, host changes, increments |
| `docs/visualization/tex/` (`main.pdf`)          | The visualisation report: problem P1–P6, requirements R1–R11, six-layer architecture     |
| `docs/superpowers/specs/2026-09-27-dtaas-sdk-design.md` | The SDK design as built                                                          |
| `docs/superpowers/specs/2026-09-28-bim-example-design.md` | The bim extension ported onto the SDK                                          |
| `docs/host-integration.md`                      | What a host has to do                                                                    |
| `docs/extension-authoring.md`                   | How to write an extension                                                                |

The SDK (`@into-cps-association/dtaas-sdk` 0.1.0) ships:

- the contract types: `DtaasExtension` (id, name, version, `sdk: 1`, routes,
  navigation, digital-twin tabs, asset previews, reducer, config schema,
  `setup`, visualisation contribution) and `HostServices` (`auth`, `library`,
  `contents`, `git`, `signals`, `viz`, `ui`, `logger`, `settings`, `config`);
- `HostProvider` / `useHost()`, the React context that hands one extension its
  services;
- `validateExtension()`, `readExtensionConfig()`, `isExtensionDisabled()`;
- `./schema` (zod schemas for `visualisation.json`), `./testing` (a fake host
  and a conformance check) and `./eslint` (rules forbidding a kit to import
  client internals or open sockets).

It deliberately leaves out everything a host must build: the registry
(`createExtensionHost`), the `HostServices` implementation, and the
visualisation core (`dtaas-visualisation`, transports, time store, substrates).

`examples/bim` in the same repository (`@into-cps-association/bim-example`,
private) is `bim-kit` 0.1.1 ported onto the contract as the extension `bim`. It
mounts at `/bim/*`, reads models from a folder chosen with `?dir=`, and uses
`ui.Page`, `logger`, `config`, `library`, `contents.list`/`put` and
`signals.subscribe` plus `signals.connection`.

When this change was made neither package was on npm: the SDK's publish job
runs only when the repository owner is `INTO-CPS-Association`, and
`bim-example` is `private: true`.

## 2. Decisions

| Question                                  | Decision                                                                                           |
| :---------------------------------------- | :------------------------------------------------------------------------------------------------- |
| How the client discovers extensions       | **Option A**: a static manifest, `client/src/extensions.ts`, read by a registry at start-up        |
| How the packages reach `client/`          | **Option b**: tarballs in `client/vendor/`, **gitignored**, built by a script from a pinned commit |
| How a fresh checkout gets the tarballs    | `node vendor/fetch.mjs` (`yarn vendor`) builds them; CI and Docker builds run it before install    |
| Section split                             | Host plumbing and the switch of Buildings to the extension land together; bim is enabled at once   |
| Live readings (`HostServices.signals`)    | **Placeholder for now**: no transport, connection reported `down`; see §8 for the options          |

### 2.1 Discovery options considered

The architecture document ranks these; the ranking was kept.

| Option                                                         | Verdict                                                                                                                                              |
| :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Static manifest + registry**                              | Chosen. Type-checked, reviewable in a diff, works with Jest, Playwright and madge. `REACT_APP_EXTENSIONS_DISABLED` still hides one without a rebuild. |
| B. Vite virtual module scanning `package.json`                 | Invisible to Jest and madge; mistakes fail late. Can be layered on A later.                                                                          |
| C. Runtime loading (Module Federation, `import()` from a URL)   | React, MUI and three.js become fragile shared singletons, CSP widens, type checking stops at the boundary. The contract keeps it possible later.     |
| D. iframe per domain                                           | No shared store, auth session or playhead. Rejected as the general mechanism.                                                                        |

### 2.2 Delivery options considered

The architecture document placed the SDK in `client/sdk/` as a yarn workspace.
It was built as a standalone repository instead, which reopened the question.

| Option                                          | For                                                  | Against                                                                               |
| :---------------------------------------------- | :--------------------------------------------------- | :------------------------------------------------------------------------------------ |
| a. Publish to npm                               | Same model as `bim-kit` 0.1.1; semver; own cadence   | Needs the repository under INTO-CPS-Association (or the owner guard relaxed)          |
| **b. Vendored tarballs + `file:` dependencies** | Works today, no registry                             | Tarballs must be built before install; updating is a manual pin bump                  |
| c. Git dependency (`github:…#tag`)              | No registry                                          | Yarn 1 cannot install a subdirectory (`examples/bim`) from git; needs a build on install |
| d. Move the SDK into `client/sdk/`              | Lock-step versions                                   | Reverses the standalone-repository decision; bim still needs a home                   |

Option b was chosen as the step before a; moving to npm later changes only the
two `package.json` entries and removes `vendor/`.

## 3. What changed in `client/`, in plain terms

1. **How the packages arrive.** `vendor/dtaas-sdk.json` pins a dtaas-sdk commit.
   `yarn vendor` clones that commit, builds the SDK and the bim extension, and
   writes `vendor/dtaas-sdk-<commit>.tgz` and `vendor/bim-example-<commit>.tgz`.
   `package.json` installs from those files. The files are gitignored.
2. **A list of plugins.** `src/extensions.ts` holds `[bim]`.
3. **A small registry.** At start-up `extension/createExtensionHost.ts` checks
   each listed extension and drops one that is switched off in `env.js`,
   malformed, misconfigured, or clashing with another. Each remaining one gets
   its routes under `/<id>/…` and its menu entry.
4. **A toolbox for each plugin.** Extensions never import client code. The
   client hands each one a `HostServices` object: who is signed in, where the
   library is, read/list/write workspace files, show a snackbar, draw the
   standard page frame, log, read settings, read its own `env.js` keys. Live
   data, git and stored visualisations are honest placeholders.
5. **Buildings became a plugin.** `src/route/bim/`, the hand-written route and
   menu entry, `BuildingModelsIcon`, the `bim-kit` dependency (and `three`,
   which the client only declared for `bim-kit`) and the old tests are gone.
   Visible differences: the page is headed **Buildings** (was "Building
   Models"), a model has its own address `/bim/models/<name>`, a folder picker
   chooses the folder (kept in `?dir=`), and the page says the live feed is not
   connected.

### 3.1 Files

| File                                    | Role                                                                                       |
| :-------------------------------------- | :----------------------------------------------------------------------------------------- |
| `src/extensions.ts`                     | The manifest                                                                               |
| `src/extension/createExtensionHost.ts`  | Pure registry: disabled, invalid, misconfigured, reducer, duplicate-claim rules            |
| `src/extension/registry.ts`             | Runs the registry once against the manifest and `env.js`, logs rejections                  |
| `src/extension/hostServices.ts`         | One `HostServices` per extension; runs each `setup` once                                   |
| `src/extension/platformServices.ts`     | `auth`, `library`, `ui`, `settings`, `logger` over the store and `env.js`                  |
| `src/extension/contentsService.ts`      | `contents`: Jupyter Contents API, with the workspace path guard                            |
| `src/extension/contentsWrite.ts`        | Chunked, XSRF-aware write through a `.part` file (moved from `route/bim/persistGeometry.ts`) |
| `src/extension/stubServices.ts`         | Placeholders for `signals`, `viz`, `git`                                                   |
| `src/extension/ExtensionRoutes.tsx`     | Mounts one extension under `/<id>/*` inside `HostProvider` and `Suspense`                  |
| `src/extension/ExtensionPage.tsx`       | `ui.Page`: `Layout` + `PageShell`                                                          |
| `src/routes.tsx`, `src/page/MenuItems.tsx` | Append extension routes and menu entries                                                |
| `src/index.tsx`                         | `startExtensions()` before the router is created                                           |
| `src/util/envUtil.ts`                   | `libraryURLfor(username)` for code that is not a component                                 |
| `vendor/dtaas-sdk.json`, `vendor/fetch.mjs` | The pin and the build script (committed)                                               |
| `jest.config.json`                      | Transforms the ESM-only SDK and bim packages; ignores `vendor/`                            |

## 4. How it works

### 4.1 Registry rules

`createExtensionHost(extensions, env)` returns `{ enabled, rejected }`. An
extension is rejected, with its reasons logged once to the console, when:

- its id is listed in `REACT_APP_EXTENSIONS_DISABLED`;
- `validateExtension()` fails (id format, reserved ids such as `library`, `sdk`
  version, lazy pages and loaders, duplicates within the extension, navigation
  under `/<id>`, …);
- it ships a `reducer` (mounting `state.ext.<id>` is not built yet; see §9);
- `readExtensionConfig()` rejects its `REACT_APP_EXT_<ID>_*` keys;
- its id, an anchor kind, a preset id or a substrate id was already claimed by
  an extension listed earlier in the manifest.

A rejected extension has no route and no menu entry, so its address shows the
client's Not Found page.

### 4.2 Host services

| Member     | Implementation                                                                                                                                         |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`     | `useUser()` reads `state.auth.userName`; `user()` resolves once sign-in has stored it                                                                  |
| `library`  | `baseUrl()`/`useBaseUrl()` from the same `env.js` keys as `useURLforLIB`; conventions `common/models`, `digital_twins`, `common/visualisations`; `resolve()` handles `lib://` and http(s) |
| `contents` | `list`, `get`, `exists`, `put` over `api/contents` and `files` of the user's workspace                                                                |
| `git`      | Placeholder: rejects "not available in this host yet"                                                                                                  |
| `signals`  | Placeholder: no samples, empty history, wall-clock playhead, connection always `down`                                                                  |
| `viz`      | Placeholder: `load` → `null`, `save` rejects, no substrates; lists the merged anchor kinds and presets                                                   |
| `ui`       | `snackbar` dispatches `showSnackbar`; `Page` is `Layout` + `PageShell`                                                                                 |
| `logger`   | The browser console, each line tagged `[ext:<id>]`                                                                                                     |
| `settings` | `get(key)` reads `state.settings`                                                                                                                      |
| `config`   | `readExtensionConfig(ext.id, schema, env)`; throws when invalid                                                                                        |

`setup(host)` runs once per extension from `startExtensions()`. A failure is
logged and the extension's pages show "could not start"; it never blocks the
rest of the client. `ExtensionRoutes` waits for `setup` through React's `use()`
inside the same `Suspense` boundary as the lazy pages.

### 4.3 Workspace writes (security)

Carried over from `route/bim/README.md`:

- Every path is relative to the workspace root and checked before it reaches a
  credentialed request: no leading `/`, no `\`, no empty, `.` or `..` segment.
  Each segment is URL-encoded.
- The request address is assembled from the deployment's own configuration and
  the signed-in user name, which is what makes sending credentials acceptable.
- A write goes to `<path>.part` in pieces of 512 KB (retried once at half the
  size on HTTP 413) and takes its real name with a rename. A failed write
  deletes its `.part`.
- `put` replaces an existing file by default, as the SDK contract says; with
  `{ overwrite: false }` it refuses when the file exists.
- A Jupyter server with XSRF protection and an `HttpOnly` `_xsrf` cookie still
  refuses every write; the bim extension then converts the model again on the
  next visit. This is unchanged from before.

### 4.4 Menu and routes

Core menu entries carry fixed orders (Library 10, Digital Twins 11,
Automation 12, Workbench 90); extension entries are merged by their `order`
(default 50), so bim's `order: 20` keeps Buildings where it was. An entry is
active on the pages nested under it. An entry without an icon gets
`DefaultExtensionIcon`. Each extension is mounted at `<id>/*` behind
`PrivateRoute`.

## 5. Vendored packages

```text
client/vendor/
  dtaas-sdk.json               committed: { repository, commit }
  fetch.mjs                    committed: the build script
  dtaas-sdk-<commit>.tgz       gitignored
  bim-example-<commit>.tgz     gitignored
  .build/<commit>/             gitignored: work folder, kept only after a failed build
```

`node vendor/fetch.mjs` checks that `package.json` names the tarballs of the
pinned commit, and does nothing when they exist. Otherwise it fetches the pinned
commit, runs `yarn install --frozen-lockfile`, `yarn build` and `yarn pack` for
the SDK, then `yarn install`, unpacks the SDK tarball into bim's
`node_modules` (what bim's own `yarn sdk` does), `yarn build` and `yarn pack`
for `examples/bim`, and removes tarballs of earlier pins. It does not call
`yarn sdk` because that script starts `yarn` without a shell, which cannot run
`yarn.cmd` on Windows. A build that fails keeps
its work folder, so running the script again resumes instead of downloading
everything again. A full build took about eight minutes on a slow connection.

**Bumping the SDK.** Change `commit` in `vendor/dtaas-sdk.json`, change the two
`file:vendor/…-<commit>.tgz` entries in `package.json` to the new short hash,
run `yarn vendor` and `yarn install`, and commit `package.json`, `yarn.lock`
and the pin.

**Why the commit is in the file name.** Found while implementing: `yarn pack`
output differs byte for byte between builds of the same commit, and yarn 1
caches a `file:` tarball under the SHA-1 recorded in `yarn.lock`. A test with a
tarball of different content under the same name installed the _cached old_
content without any warning, even with `--frozen-lockfile`. A name per commit
gives every pin its own lock entry and cache key. A rebuild at the same pin
differs only in packing metadata, so a cache hit there is harmless, and a fresh
CI runner has no cache.

**Why the script edits `yarn.lock`.** The same byte differences made every CI
install fail with `Integrity check failed for "@into-cps-association/dtaas-sdk"`:
`yarn.lock` held the SHA-1 of the tarball built on a developer's machine, and
each runner builds its own. So `fetch.mjs` finishes by setting the two
`resolved "file:vendor/<tarball>#<sha1>"` hashes to the tarballs present. After
a local rebuild those two lines show as changed; commit them only together with
a pin bump. Making `yarn pack` reproducible across Windows and Linux (line
endings, path separators in generated declarations, gzip headers) would remove
this, and is not worth it while the step to npm is planned.

**Windows.** The script unpacks with `tar`. Under Git for Windows that name
finds GNU tar, which reads `C:\…` as a remote host and fails. The script puts
`%SystemRoot%\System32` (Windows' own `tar.exe`) first on the child processes'
`PATH`.

**CI and Docker.**

- `client.yml`, `docker-ghcr.yml`, `docker-dockerhub.yml`: `node vendor/fetch.mjs`
  before `yarn install`.
- `docker-build.yml`: sets up Node and builds the tarballs for both client
  images; `developer/client.dockerfile` copies `client/vendor/*.tgz` before its
  install.
- `client.yml` gains `client-no-ext`: it removes bim from `package.json`,
  writes an empty manifest and runs `yarn build`, proving the host does not
  depend on any extension.
- Runners and Docker builds need git and network access to github.com.

## 6. How the bim extension gets data points to annotate a model

bim never connects to a broker; the SDK's lint rules forbid kits from opening
sockets or importing `mqtt`.

1. Next to `hx.ifc` sits `hx.manifest.json`. Each binding names an IFC element
   (`selector.globalId`), the topic its sensor publishes on
   (`source.live.topic`, e.g. `swim/B1/temperature/TS-01`) and a colour range
   (`display.ramp`).
2. `BuildingModels` loads the manifest and reports the bindings to
   `BuildingsPage` (`onBindingsChange`).
3. `useReadings` calls `host.signals.subscribe(topics, 'measured', sink)`, seeds
   from `host.signals.valueAt(topic, 'measured')`, and reads
   `host.signals.connection.use(topics)`. **The MQTT topic is the signal path.**
4. Each numeric sample becomes `readings[globalId] = { value, receivedAt: ts }`.
5. The viewer colours each bound element on `display.ramp`; the sensor cards
   show the value and its age, or "not live" when the connection is down.

With the placeholder `signals` no sample arrives and nothing is annotated. That
is no worse than before: the old `Bim.tsx` passed no readings to the viewer.

## 7. Requirements R1–R11 against the design

| Req                           | SDK contract                                        | Host in this change                        | Gap                                                                                          |
| :---------------------------- | :-------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------- |
| R1 Substrate independence     | `SubstrateAdapter`, `substrates` contribution       | Registry empty                             | bim ships its own three.js renderer instead of a shared `aec` substrate. Accepted for now.   |
| R2 Authored anchoring         | `Anchor` (`ifc-guid`), `visualisation.json` schema  | —                                          | bim reads its `.manifest.json`; `manifestToVisualisation` exists but the page does not use it |
| R3 Transport agnosticism      | `subscribe` → `SignalSample`                        | **Placeholder**                            | No transport; the manifest also fixes `transport: 'mqtt'`                                    |
| R4 Temporal addressing        | `playhead`, `valueAt(path, channel, t)`             | Wall-clock playhead                        | bim shows the latest pushed sample and does not re-read on scrub                             |
| R5 Dual channel               | `Channel` on every sample                           | —                                          | bim uses `measured` only                                                                     |
| R6 Sustained update           | Adapter `apply()` is O(1)                           | —                                          | Inside bim's viewer                                                                          |
| R7 Visualisation as an asset  | `viz.load/save`, `git.commit`                       | **Placeholders**                           | Deferred                                                                                     |
| R8 Licence cleanliness        | —                                                   | bim brings three (MIT), web-ifc (MPL-2.0), zod (MIT) | No licence gate in CI yet                                                          |
| R9 Graceful degradation       | `connection` state                                  | "not live" shown; builds with no extension | Met                                                                                          |
| R10 Reuse the installed stack | —                                                   | —                                          | Met once `signals` uses the deployed RabbitMQ and InfluxDB                                   |
| R11 Media synchronisation     | —                                                   | —                                          | Not applicable to bim                                                                        |

The contract carries the requirements. What the host still owes, to meet R3 and
R10 and to annotate anything, is a real `signals` service (one transport, a
small store per `(path, channel)`, connection state) and a payload convention.
Proposed convention: a bare number, or JSON `{ value, ts?, unit?, kind? }`.

## 8. Backend requirements

**For this change: none at run time.**

- The extension uses the same workspace endpoints Buildings used: list a folder,
  fetch files, upload the converted `.glb`. The folder picker and `?dir=` can
  now list any folder of the user's workspace, not only `common/models`, through
  the same API and behind the path guard.
- The client is served with `serve -s`, so deep links such as
  `/bim/models/<name>` load `index.html`.
- `servers/lib` MIME types and range requests for `.glb`/`.ifc`, listed in the
  architecture document, are not needed yet.
- New optional `env.js` keys: `REACT_APP_EXTENSIONS_DISABLED` (comma-separated
  ids) and `REACT_APP_EXT_BIM_MODELS_DIRECTORY` (another models folder).
  Existing `env.js` files keep working.

At build time CI runners and Docker builds need git and network access to
github.com (§5).

**For live readings (next step), one of:**

| | A. Browser subscribes to RabbitMQ over WebSocket (recommended) | B. A platform service relays readings |
| :-- | :-- | :-- |
| Host code | `mqtt.js` (MIT) transport behind `signals`; keys `REACT_APP_VIZ_MQTT_URL` and credentials | HTTP/SSE client for that service |
| Backend | Enable `rabbitmq_web_mqtt` (today only `rabbitmq_management`, `rabbitmq_mqtt`, `rabbitmq_prometheus`); add a WSS listener (15676) with the existing certificates; expose it through a port or Traefik; create a **read-only, topic-scoped MQTT user** whose credentials can sit in `env.js`, which every visitor can read (or RabbitMQ's OAuth2 backend, which needs JWTs) | A new service (the "MQTT Agent" of issue 1762) that subscribes, validates, stores and serves latest values and history, holding broker credentials server side and checking each user's rights |
| Fit | The report's MQTT-over-WSS adapter; no parallel broker (R10) | Better separation and security; the service does not exist yet |

Option A is the smallest step that annotates models. It puts one security
decision on the deployment: a broker account exposed to browsers.

## 9. Departures from the agreed design and known gaps

- **No `manualChunks` for extensions.** Forcing bim into one named chunk would
  put its small, eagerly imported `dtaas/index` entry together with its lazy
  page, making the entry chunk load the renderer. `React.lazy` already gives
  the page its own chunk.
- **Extension reducers are rejected**, not mounted at `state.ext.<id>`. No
  extension ships one yet; saying so beats a reducer that is never called.
- **`put` replaces by default**, per the contract. The old route never replaced
  an existing `.glb`; bim now asks to store one only when its listing showed
  none. A write is no longer aborted when the page is left, because
  `ContentsService.put` takes no signal; a failed write still deletes its
  `.part`.
- **Not wired yet:** digital-twin tabs, asset previews, an Extensions section on
  the Account page, the generic Visualise tab.
- **`visualisationsDirectory` is `common/visualisations`**, a provisional
  convention; nothing uses it yet.
- **`Reading.unit` and `kind`** from bim-kit's payloads are not carried by
  `SignalSample` (an SDK gap).
- **SDK gaps recorded by the bim port:** `ScopeContext` carries no element
  properties; `FieldKernel` has no geometry for bim's flood fill.

## 10. Next steps

1. Decide option A or B of §8 and implement a real `signals` service with its
   payload convention.
2. Publish the SDK and bim (`bim-kit` 0.2.0) to npm and replace the vendored
   tarballs (delivery option a).
3. Add a licence gate to CI (architecture document §11).
4. Wire digital-twin tabs and asset previews when an extension contributes them.

## 11. Verification

- `yarn typecheck` and ESLint on the changed files pass.
- `yarn test:unit` passes (967 tests), including the new tests for the
  registry, host services, contents client, write path, placeholders, route
  mount and menu (`test/unit/extension/`, `test/unit/page/MenuItems.test.tsx`).
- `yarn install --frozen-lockfile` from the vendored tarballs works on Windows.
- **Not yet verified:** `yarn test:int` and `yarn build` (the run was stopped
  for lack of memory on the development machine), the new CI jobs, and the
  Playwright tests (`test/e2e/tests/Bim.test.ts`), which need a GitLab sign-in.
