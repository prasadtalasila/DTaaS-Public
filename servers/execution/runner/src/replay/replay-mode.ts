// The snapshot that a replay twin started from: the id of the twin and
// the time of the save
export type ReplayOf = { of: string; time: string };

// A runner started with --reinstate and --what-if: a replay twin. It
// reaches nobody, and its timeline stands for a time that starts at the
// save and runs at the scale given.
export default class ReplayMode {
  private origin: ReplayOf | undefined;

  private started = 0;

  constructor(
    readonly scale: number,
    private readonly now: () => number = Date.now,
  ) {}

  // The reinstate calls it once the manifest of the snapshot is read
  begin(origin: ReplayOf): void {
    this.origin = origin;
    this.started = this.now();
  }

  // What GET /dt shows, null before the reinstate
  describe(): ReplayOf | null {
    return this.origin ?? null;
  }

  // The time that a row written now stands for
  at(): string | undefined {
    if (this.origin === undefined) {
      return undefined;
    }
    const passed = (this.now() - this.started) * this.scale;
    return new Date(Date.parse(this.origin.time) + passed).toISOString();
  }

  // The variables that its scripts get beside DT_MODE=what-if
  variables(): Record<string, string> {
    return {
      DT_REPLAY_OF: this.origin?.of ?? '',
      DT_TIME_SCALE: `${this.scale}`,
    };
  }
}

// The host that a runner listens on: a replay twin, whose scripts act
// for real, only on the loopback address; any other on every address
export const listenHost = (replay?: ReplayMode): string | undefined =>
  replay === undefined ? undefined : '127.0.0.1';
