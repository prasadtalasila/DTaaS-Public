# 17b Measure the Process Tree

- Status: planned
- Depends on: 17a
- PR: none yet
- Research note:
  [item 17](../dtn-research-notes.md#17-resource-and-fidelity-reporting)

## Spec

17a measures the CPU time and peak resident memory of the script's
direct child: the process that execa starts
(`src/execa-runner.ts:41-48`). That process is often not where the
work is. On Windows the direct child is always `powershell.exe`
(`src/runner-factory.service.ts:13-19`), and a script that starts a
simulator or a Python process runs it as a child of that shell. On
Linux a shell script that starts a simulator is the same, and even the
`loop` test script spends its time in `sleep` children
(`test/data/scripts/loop:3`). So 17a under-reports on Windows always
and on Linux whenever a script delegates. This issue measures the
whole tree that the direct child spawns.

### What changes in the figures

The fields of 17a keep their names, units, storage and routes; only
what they cover grows from one process to the tree.

- **CPU time** is the sum over every process seen in the tree of its
  cumulative CPU time (user and system) at the last sample that saw
  it. A process that exited after a sample keeps that sample's value.
- **Peak memory** is the largest, over all samples, of the sum of the
  tree's resident memory in that sample. A sum of per-process peaks
  would add processes that never coexist, such as two simulators run
  one after the other, giving a figure the machine never held.
- **`processes`** is new: the largest tree seen in one sample, the
  direct child included. Every sample holds the list already, so it
  costs nothing (this plan's call). It is a third column next to 17a's
  two, shown wherever they are and `null` where they are.

A process is known by its pid and its start time (`starttime` of
`/proc/<pid>/stat` on Linux, `CreationDate` on Windows), so a pid that
the system reuses within one run is counted as a new process rather
than overwriting the old one's CPU time (this plan's call).

### Discovery per platform

Each sample discovers the tree afresh, starting from the direct
child's pid.

| Platform         | Discovery                                        | Cost per sample                   |
| :--------------- | :----------------------------------------------- | :-------------------------------- |
| Linux            | `/proc/<pid>/task/*/children`, root to leaves    | a few reads per process in a tree |
| Linux, fallback  | `ppid` of every `/proc/[0-9]*/stat`, then a walk | one read per process in the host  |
| Windows          | one `Get-CimInstance Win32_Process`, then a walk | one `powershell.exe`, as 17a pays |
| macOS and others | none; the fields stay `null` as in 17a           | none                              |

The `children` file needs kernel 3.5 or later built with
`CONFIG_PROC_CHILDREN`. Without it, the scan reads every process of
the host, or of the pid namespace in a container: hundreds of small
reads per sample on a busy host, a few milliseconds. The choice is
made once per runner process, by probing
`/proc/self/task/<pid>/children` (this plan's call).

On Windows the query selects `ProcessId`, `ParentProcessId`,
`CreationDate`, `UserModeTime`, `KernelModeTime` and `WorkingSetSize`
of every process; the same rows give the tree and the figures. A pid
can be reused while an old process still names it as its parent, so a
row counts as a child only when it is not older than its parent.
`pidusage` has no tree function, so discovery is own code whatever 17a
chose; on Windows the CIM rows give the figures too, saving a second
query (this plan's call).

The measuring process is a child of the runner, not of the script, so
it is never part of the tree. No configuration is added: the sample
interval is 17a's. If 17a added `resources.sampleMs` to `runner.yaml`,
it governs the tree too; the fallback scan is the only cost that could
call for a longer interval, and only on a host with many processes.

### Limits and error bounds

- A process that starts and exits between two samples is never seen;
  one that exits after a sample loses the CPU time it used since. Each
  lost process lived at most one sample interval, so the error per
  process is at most the interval times the cores it could use. A
  script that starts many short processes, such as `loop`'s `sleep`,
  loses most of them; their CPU time is small.
- A spike in memory shorter than the interval is missed. Where 17a
  reads a kernel peak of the direct child (`VmHWM`, `PeakWorkingSet64`),
  the reported peak is the larger of that and the sampled tree peak,
  so this issue never reports less than 17a would (this plan's call).
- Resident memory counts shared pages, such as libraries, once per
  process, so the sum over the tree overstates.
- A process whose parent exits leaves the tree (Linux re-parents it
  to init; on Windows it names a dead parent), and so does every child
  once the direct child exits, when sampling ends as in 17a. Their CPU
  time up to the last sample that saw them stays counted.

### Interaction with stop

This issue does not change the stop (D18). The runner still signals
only the direct child through execa's `forceKillAfterDelay`
(`src/execa-runner.ts:42`, `:65-72`), and on Windows the processes a
script started keep running after a stop, as the README says under
Stopping Scripts. The tree is measured, not managed. A stopped run
reports the tree's figures up to the last sample before the direct
child exited; children that survive the stop are not followed. A tree
kill is set aside below.

### Example

A `simulate` script starts a simulator and loops while it runs:

```sh
#!/bin/sh
python3 sim.py &
trap 'kill $!; exit' TERM
while :; do sleep 0.1; done
```

After 60 seconds a stop ends it; `simulate.ps1` does the same on
Windows. The figures are illustrative, not measured:

| Platform | Measured                   | CPU time | Peak memory | `processes` |
| :------- | :------------------------- | -------: | ----------: | ----------: |
| Linux    | direct child (17a)         |    0.3 s |        2 MB |           — |
| Linux    | tree (17b)                 |   58.9 s |      214 MB |           3 |
| Windows  | `powershell.exe` (17a)     |    0.9 s |       71 MB |           — |
| Windows  | tree (17b), `simulate.ps1` |   59.6 s |      283 MB |           2 |

On Linux the third process is the `sleep` alive at the sample that
saw the most.

### Version

No shape breaks: the fields of 17a keep their meaning and `processes`
is added. The delivery rules bump only for a breaking change, so
`package.json` stays at 17a's version (this plan's call).

## Plan

Line numbers are of today's code; 17a changes these files first, so
review them before starting.

1. `src/resources/process-tree.ts`: a `ProcessRow` type (key of pid
   and start time, parent pid, CPU milliseconds, resident bytes), a
   `walkTree(rows, rootPid)` that returns the rows under the root
   (with the start-time check of Windows), and a `TreeTotals` class
   whose `add(rows)` keeps the last CPU time per key, the largest sum
   of resident bytes and the largest row count. Each function stays
   under complexity 5.
1. `src/resources/linux-tree.ts`: the probe, the walk through the
   `children` files and the fallback scan of `/proc/*/stat`, each
   taking the `/proc` root as a parameter so tests can point it at a
   fake directory. Parse `stat` after the last `)`, as the command
   name may hold spaces and parentheses; reuse 17a's reads of CPU and
   memory.
1. `src/resources/windows-tree.ts`: the CIM query, with `CreationDate`
   selected as `ToFileTimeUtc()` so that `ConvertTo-Json` gives a
   number, and a parser of its output into `ProcessRow`s; a single
   process comes back as an object, not a list.
1. 17a's sampler under `src/resources/`: each sample reads the tree
   through the platform's discovery and feeds `TreeTotals`; its result
   gains `processes`. The interface of 17a keeps its shape otherwise.
1. Storage and replies, next to 17a's columns: the `processes` column
   and its migration (`src/queue.service.ts` is at 245 lines today;
   use the helper 17a moved its columns into), the command record and
   reply types (`src/interfaces/command.interface.ts`,
   `src/dto/command.dto.ts`, `src/command-result.ts`).
1. Test scripts `test/data/scripts/spawn-busy` and `spawn-busy.ps1`:
   start a child that spins for about one second, then wait for it.
   The POSIX version waits with `wait`, the PowerShell one starts
   `powershell.exe -NoProfile -Command` in the foreground, so no
   process outlives the test.
1. The sweeps of the Tasks, and this file's row in
   `docs/issues/README.md`.

## Tasks

- [ ] `walkTree` and `TreeTotals`: a reused pid is a new process, an
      exited process keeps its last CPU time, the peak is the maximum
      of sums and not the sum of peaks, `processes` is the largest
      tree. Check: `test/unit/resources.process-tree.spec.ts`.
- [ ] Linux discovery through `children` files and through the
      fallback scan give the same tree from a fake `/proc`, including a
      command name with `) (`. Check:
      `test/unit/resources.linux-tree.spec.ts` (all platforms).
- [ ] The Windows parser builds rows from captured CIM output, one row
      and many, and drops a child older than its parent. Check:
      `test/unit/resources.windows-tree.spec.ts` (all platforms).
- [ ] A `spawn-busy` run reports a tree CPU time above the direct
      child's and at least two processes; a stopped `loop` run reports
      figures and the stop kills no more than before. Check:
      `test/integration/resources.tree.spec.ts`, on Linux and Windows
      only, skipped elsewhere; the Linux run in CI is the authority.
- [ ] `processes` is stored, migrated into an older database, and shown
      by `POST /`, `GET /` and the MQTT routes. Check:
      `test/integration/queue.migration.spec.ts`,
      `test/integration/queue.service.spec.ts`,
      `test/e2e/command-input.spec.ts`, `test/e2e/mqtt.spec.ts`; grep
      `test/e2e/mqtt.broker.spec.ts` for the reply shapes.
- [ ] README: the section 17a added on resource figures says the tree,
      its limits and `processes`; Stopping Scripts says the surviving
      children of a stop are not measured. Check:
      `npx markdownlint-cli -c .markdownlint.yaml` on it.
- [ ] `api/API.md`: `POST /`, `GET /` and `POST /stop` show
      `processes` and the tree. Check: the same lint.
- [ ] `docs/state-machine-design.md`: amend the decision of the number
      17a took to measure the tree; D18 unchanged. Check: the Decisions
      section.
- [ ] `DEVELOPER.md`: which resource tests are platform-conditional.
      Check: the Developer Commands section.
- [ ] `yarn syntax`, `yarn build`, `yarn test --maxWorkers=2` and
      `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` pass,
      and no function crosses the Qlty thresholds. Check: their output.

## Learnings

Written in the pull request that implements this issue.

## Considered and Set Aside

- **Kill the tree on a stop.** For: a stop on Windows, and on Linux a
  script without a `trap`, leaves orphaned simulators running and
  using the resources that this issue reports, with nobody to end
  them. Against: a kill per process races the processes spawned while
  the runner walks; a script that leaves a process behind on purpose
  loses it; `stopGrace` needs a meaning per process. A stop is D18's
  decision, so a tree kill is an issue of its own.
- **cgroups on Linux.** A cgroup per script gives exact CPU time
  (`cpu.stat`) and peak memory (`memory.peak`), short processes
  included. It needs a delegated cgroup subtree, which a runner in a
  container or under a plain user rarely has, and changes how every
  script starts. Worth revisiting when the runner controls containers.
- **Job Objects on Windows.** A job gives exact totals and can end the
  tree in one call. Node and execa cannot assign a process to a job
  without a native addon, and the assignment races the script's first
  children.
- **`cutime` and `cstime` of the direct child on Linux.** They hold the
  CPU time of descendants that were waited for, which would recover
  short processes, but adding them to the sampled values counts the
  same process twice.
