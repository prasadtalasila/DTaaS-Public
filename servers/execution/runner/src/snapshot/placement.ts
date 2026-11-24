import path from 'node:path';

// The paths of runner.yaml that a snapshot depends on, resolved
export type Placement = {
  location: string;
  stateMachine?: string;
  snapshots?: string;
};

const inside = (dir: string, parent: string): boolean => {
  const relative = path.relative(parent, dir);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

// A snapshot directory inside location would copy the scripts into
// themselves, and a state machine file named runner.yaml would replace
// the copy of the configuration in a snapshot
export function placementProblems({
  location,
  stateMachine,
  snapshots,
}: Placement): string[] {
  if (snapshots === undefined) {
    return [];
  }
  const problems = [];
  if (inside(snapshots, location)) {
    problems.push(
      `✖ snapshots.directory ${snapshots} is inside location ${location}, whose scripts every save copies`,
    );
  }
  if (
    stateMachine !== undefined &&
    path.basename(stateMachine) === 'runner.yaml'
  ) {
    problems.push(
      `✖ stateMachine ${stateMachine} is named runner.yaml, the name of the copy of the configuration in a snapshot`,
    );
  }
  return problems;
}
