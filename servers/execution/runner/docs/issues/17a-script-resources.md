# 17a Script Resources

- Status: planned
- Depends on: 11
- PR: none yet
- Research note:
  [item 17](../dtn-research-notes.md#17-resource-and-fidelity-reporting)

## Spec

P2 says DTs "compete for the computational resources provided by the
shared infrastructure", and its DT Orchestrator adjusts their fidelity
to load. P1 leaves placement to the platform. The runner therefore
reports what each script used and decides nothing: an Orchestrator or a
Manager reads the figures and acts. 17 is split in three; this file
measures the direct child process of every script run, the commands of
`POST /` and the scripts of states alike. Size M.

### What Is Measured

`cpuSeconds` is user plus system CPU time in seconds, rounded to the
millisecond; `peakRssBytes` is the peak resident memory in bytes.

| Platform | `cpuSeconds`                                     | `peakRssBytes`                                            | Process measured                    |
| :------- | :----------------------------------------------- | :-------------------------------------------------------- | :---------------------------------- |
| Linux    | fields 14 and 15 of `/proc/<pid>/stat`, in ticks | `VmHWM` of `/proc/<pid>/status`                           | the script                          |
| Windows  | `TotalProcessorTime` of `Get-Process -Id <pid>`  | `PeakWorkingSet64`, or the largest `WorkingSet64` sampled | `powershell.exe` running the script |
| other    | `null`                                           | `null`                                                    | none                                |

Linux converts ticks with the clock tick of `getconf CLK_TCK`, read once
at the first measurement, or 100 when that fails. On Windows the direct
child is `powershell.exe -File <name>.ps1`
(`src/runner-factory.service.ts:13-19`), so the figures are PowerShell's
own plus the script's: an idle PowerShell loop on a Windows 11 host
peaked at 115 646 464 bytes. Processes the script starts are not counted
on either platform; that is 17b.

### Sampling and Its Limits

A process that has exited can no longer be read, so the runner samples
it while it runs and reports the last successful sample.

- **Linux.** One read right after the spawn, then one every 500 ms
  (this plan's call), each reading `stat` and `status` of the pid; a
  read still pending when the timer fires skips that tick. `VmHWM` is
  the kernel's peak up to the read.
- **Windows.** One sampler per run (this plan's call): a
  `powershell.exe -NoProfile -NonInteractive -Command` loop that holds
  the process from `Get-Process -Id`, waits for its exit for up to
  500 ms (`WaitForExit(500)`), and prints `TotalProcessorTime.Ticks`,
  `WorkingSet64` and `PeakWorkingSet64` as integers, so no culture
  formats a decimal. After the exit it prints one more line, as the
  held handle still reads the final `TotalProcessorTime` (checked on
  Windows 11 with Windows PowerShell 5.1). It prints nothing for a
  process whose `StartTime` is later than the run's start, since
  Windows reuses a pid quickly. One PowerShell per run, not per sample:
  a start takes about a second, 1.4 to 3.4 s under load (05).
- **End of a run.** When execa resolves, the runner takes the latest
  sample it holds, stops the timer or kills the sampler, and waits for
  nothing. The figures are lower bounds: up to one interval of use
  before the exit is missed, unless the Windows line after the exit
  arrived first.
- **Short scripts.** On Linux a script under one interval reports the
  first read, near-zero CPU and the memory it held then, and `null`
  only when that read lost the race with the exit. On Windows a script
  that ends before the sampler starts reports `null`.

### Replies

The two figures sit in a `resources` object (this plan's call), so that
17b can add to it without crowding the record. Both are `null` when not
measured: other platforms, a failed read, a refused command, a row
written before 17a. `POST /` and MQTT `execute` add it to `result`;
`admit` of the API reference becomes:

```json
{
  "status": "success",
  "result": {
    "exitCode": 0,
    "stdout": "hospital-1 in state open#1, scope single\r\np-1 admitted to cardiology",
    "stderr": "",
    "resources": { "cpuSeconds": 0.469, "peakRssBytes": 115646464 }
  }
}
```

`GET /` and MQTT `status` add `resources` after `exitCode`, with both
`null` before the first command and while the latest one runs; each
record of 11's `GET /history` adds it after `by`. `GET /state` is
unchanged (this plan's call), so a measurement raises no state
notification. 11's `GET /metrics` gains a top-level `resources` object
next to its `commands` counts (this plan's call on the shape):

```json
{
  "resources": {
    "admit": { "cpuSeconds": 2.031, "peakRssBytes": 117440512 },
    "open": { "cpuSeconds": 0.812, "peakRssBytes": 115646464 }
  }
}
```

Like `commands`, it covers the rows received since the start.
`cpuSeconds` is the sum over the command's runs, `peakRssBytes` the
largest peak of one run; a `null` adds nothing, and a command with no
measured run is left out, so the object is `{}` before any.

### Storage, Failure and Version

The `commands` table gains `cpu_seconds REAL` and
`peak_rss_bytes INTEGER`, `NULL` when not measured, added to an older
database file as `exit_code` was (`src/queue.service.ts:68-74`, which
11 turns into `addColumn`). A replayed request key gets the stored
figures; an `interrupted` row has `null`.

A read that fails (permission, process gone, unparsable output, a
sampler that does not start) logs once per run at debug level and
leaves that sample out. Measurement never fails, delays or blocks a run
or a stop: the sampler is not awaited, and the timer is `unref`'d.

No shape breaks, so no bump is due; the version stays 11's.

### What 17b and 17c Add

17b measures the process tree, so Windows figures become the script's
and children count; 17c documents a `fidelity` parameter convention.

### Considered and Set Aside

- **Linux-only `/proc`**: the owner wants Windows too.
- **`process.resourceUsage()`**: the runner's own process only.
- **cgroup accounting**: needs a cgroup per script, so a container.
- **Measuring in the shell wrapper** (`/usr/bin/time`, a PowerShell
  prologue): changes how every script starts and mixes the figures
  into its output.

## Plan

1. Decide the mechanism. `pidusage` 4.1.0 (latest, 2026-10-13) runs
   `wmic` on Windows whenever `System32\wbem\WMIC.exe` exists, and
   `gwmi win32_process` through `powershell.exe` otherwise or with
   `useGwmi: true` (`lib/stats.js`, `lib/gwmi.js`). It passes the
   `wmic` criterion only with `useGwmi`, and then starts one
   PowerShell per poll, reports current memory only (`WorkingSetSize`;
   on Linux `rss` times the page size), no peak, and adds a dependency.
   The plan uses own reads (this plan's call, on those facts); the
   design decision records why.
1. `src/resources/resources.ts` (new): `ScriptResources`,
   `NO_RESOURCES`, `Sample`, `ResourceWatch` with
   `finish(): ScriptResources`, `Meter` (a pid, possibly `undefined`,
   and the start time to a watch), and `meterFor(platform)`, which
   gives the Linux or Windows meter or one that yields `NO_RESOURCES`.
1. `src/resources/linux.ts` (new): `parseStat` splits after the last
   `)`, as the command name may hold spaces and parentheses;
   `parseStatus` reads `VmHWM` in kB; `clockTicks()` caches
   `getconf CLK_TCK` (`execFileSync`, 1 s timeout) or 100;
   `readLinux(pid)` reads both files with `fs/promises`.
1. `src/resources/polling-watch.ts` (new): the Linux watch, sampling
   as the Spec says; `finish()` clears the timer.
1. `src/resources/windows.ts` (new): `windowsSampler(pid, start)`
   builds the loop with both as numbers, so no string reaches the
   command, starts it with execa (`windowsHide`, `reject: false`),
   parses each line into a `Sample`, keeps the largest `WorkingSet64`
   for a `PeakWorkingSet64` of 0, and `finish()` kills the sampler
   without awaiting it.
1. `src/execa-runner.ts`: the constructor has three parameters
   (`:27-31`), so `stopGrace` and the meter move into one options
   object, `{ stopGrace?, meter? }`, without a meter measuring nothing.
   `run` (`:40-54`) starts a watch on `subprocess.pid` after `execa` and
   calls `finish()` after the await; `checkResources()` returns it.
   `RunnerFactory.create` (`src/runner-factory.service.ts:8-21`) passes
   `meterFor(platform)`.
1. `checkResources()` joins `Runner`
   (`src/interfaces/runner.interface.ts`); `CommandResult`
   (`src/interfaces/command.interface.ts:6`) gains `ScriptResources` as
   a fourth element, so destructuring three keeps compiling;
   `CommandRecord` and `CommandStatus` gain `resources`.
   `ExecaManager.execute` (`src/execa-manager.service.ts:134-151`),
   `createStatus` (`:188-198`) and `checkStatus` (`:200-211`) add it;
   `storedResult` (`src/command-result.ts:16-28`) returns the stored
   figures.
1. Queue, after 11, which moves `RECORD`, `RECORD_BY_KEY` and
   `toRecord` to `src/queue.history.ts` and makes `addExitCode` an
   `addColumn(db, column, type)`: `connect`
   (`src/queue.service.ts:124-129`) adds the two columns, `RECORD` and
   11's `HISTORY` select them, and `complete` (`:151-165`) writes them.
   If `queue.service.ts` is still over 240 lines, `SCHEMA` (`:23-47`)
   moves to `src/queue.history.ts` too.
1. `CommandResultDto` and `resultDto` (`src/dto/command.dto.ts:62-75`)
   add `resources`, as does 11's `HistoryEntryDto`.
1. Metrics: `RESOURCE_TOTALS` next to 11's `COMMAND_COUNTS` in
   `src/queue.history.ts` (rows above the start's highest id,
   `SUM(cpu_seconds)` and `MAX(peak_rss_bytes)` by name, rows with both
   `NULL` left out); `Queue.resourceTotals()` returns it,
   `DescriptorService.metrics()` adds it and `MetricsDto` types it.
1. `test/data/scripts/busy` (a second of CPU, mode 100755), `busy.ps1`,
   in `test/config/runner.test.yaml`, `config/runner.test.yaml.sample`.
1. Documentation, as in Tasks; the README's new Resources section
   holds the platform table, the PowerShell note and the lower bounds,
   and `docs/issues/README.md` gets a status row.

## Tasks

- [ ] `parseStat` reads fields 14 and 15 behind a name with spaces and
      `)`, `parseStatus` reads `VmHWM`, malformed text yields no sample.
      Check: `test/unit/resources.linux.spec.ts`.
- [ ] The polling watch keeps the last sample, skips overlapping reads,
      logs repeated failures once, gives `NO_RESOURCES` without any;
      `meterFor('darwin')` measures nothing. Check:
      `test/unit/resources.polling.spec.ts` with fake timers.
- [ ] The Windows sampler parses integer lines, prefers
      `PeakWorkingSet64`, ignores a malformed line and is killed by
      `finish()` without being awaited. Check:
      `test/unit/resources.windows.spec.ts` with a fake subprocess.
- [ ] `ExecaRunner` reports CPU above 0.3 s and a peak above 1 MB for
      `busy`, `null` without a meter, and a stop is not delayed by the
      meter. Check: `test/integration/execa-runner.resources.spec.ts`
      (new; the Linux case on `linux` only, the Windows case on `win32`
      only, so CI runs the first).
- [ ] The queue adds both columns once to a file of 11's version,
      returns `null` for its old rows, and stores and replays new
      figures. Check: `test/integration/queue.migration.spec.ts`,
      `test/integration/queue.resources.spec.ts` (new, as
      `queue.service.spec.ts` is at 249 lines).
- [ ] `POST /`, `GET /`, `GET /history` and MQTT `execute`, `status`
      and `history` carry `resources`; `GET /metrics` sums by name;
      fakes and tuples of `CommandResult` gain `NO_RESOURCES`. Check:
      `test/e2e/command-input.spec.ts`,
      `test/unit/mqtt-request.execute.spec.ts`, 11's metrics specs,
      `test/unit/fsm.fixture.ts`, and `test/e2e/mqtt.broker.spec.ts`
      grepped for the old shapes (CI only).
- [ ] README (POST /, GET /, GET /history, Resources), `DEVELOPER.md`
      (the `busy` script), `api/API.md` (POST /, GET /, GET /history,
      the metrics section) and `api/dev.api.http` updated; `DOCKER.md`
      needs nothing, as the image is Linux. Check: markdownlint-cli and
      prettier.
- [ ] `docs/state-machine-design.md`: a decision with the next free D
      number when the pull request is opened (own reads, not
      `pidusage`; the direct child only; lower bounds), and Components
      lists `src/resources/`. Check: markdownlint-cli.
- [ ] `yarn syntax`, `yarn build`, `yarn test --maxWorkers=2` and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` pass, no
      file is over 250 lines and no function crosses the Qlty limits.
      Check: their output, with Linux CI as the authority.

## Learnings

Written in the pull request that implements this issue.
