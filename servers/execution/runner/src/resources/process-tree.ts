import {
  NO_RESOURCES,
  roundSeconds,
  type ScriptResources,
} from './resources.js';

// One process as a sample saw it. Its pid and start time name it, as a
// pid may be reused; the start is in the platform's own unit. CPU time
// is user plus system so far; peakBytes is the peak resident memory that
// the system keeps for the process, 0 where it keeps none.
export type ProcessRow = {
  readonly pid: number;
  readonly ppid: number;
  readonly start: number;
  readonly cpuSeconds: number;
  readonly rssBytes: number;
  readonly peakBytes: number;
};

// What places a process in a tree
export type TreeLink = Pick<ProcessRow, 'pid' | 'ppid' | 'start'>;

function childrenByParent<T extends TreeLink>(
  rows: readonly T[],
): Map<number, T[]> {
  const children = new Map<number, T[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  return children;
}

// The root and the processes below it, root first. A row counts as a
// child only when it is not older than its parent, as a pid may be
// reused while an old process still names it as its parent.
export function walkTree<T extends TreeLink>(
  rows: readonly T[],
  rootPid: number,
): T[] {
  const root = rows.find(({ pid }) => pid === rootPid);
  if (root === undefined) {
    return [];
  }
  const children = childrenByParent(rows);
  const tree = new Set([root]);
  for (const parent of tree) {
    (children.get(parent.pid) ?? [])
      .filter(({ start }) => start >= parent.start)
      .forEach((child) => tree.add(child));
  }
  return [...tree];
}

// The figures of a run from the trees of its samples: the last CPU time
// of every process seen, the largest sum of resident memory in one
// sample or the largest peak of one process, and the largest tree
export class TreeTotals {
  private readonly cpu = new Map<string, number>();

  private peakBytes = 0;

  private largest = 0;

  add(tree: readonly ProcessRow[]): void {
    let resident = 0;
    for (const row of tree) {
      this.cpu.set(`${row.pid}@${row.start}`, row.cpuSeconds);
      resident += row.rssBytes;
      this.peakBytes = Math.max(this.peakBytes, row.peakBytes);
    }
    this.peakBytes = Math.max(this.peakBytes, resident);
    this.largest = Math.max(this.largest, tree.length);
  }

  totals(): ScriptResources {
    if (this.largest === 0) {
      return NO_RESOURCES;
    }
    let cpuSeconds = 0;
    this.cpu.forEach((seconds) => {
      cpuSeconds += seconds;
    });
    return {
      cpuSeconds: roundSeconds(cpuSeconds),
      peakRssBytes: this.peakBytes || null,
      processes: this.largest,
    };
  }
}
