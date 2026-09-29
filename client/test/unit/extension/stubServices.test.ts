import { stubGit, stubSignals, stubViz } from 'extension/stubServices';

describe('stubServices', () => {
  it('delivers no samples and reports the connection down', async () => {
    const sink = jest.fn();
    const unsubscribe = stubSignals.subscribe(['a/b'], 'measured', sink);
    unsubscribe();
    expect(sink).not.toHaveBeenCalled();
    expect(stubSignals.valueAt('a/b', 'measured')).toBeUndefined();
    await expect(stubSignals.range(['a/b'], 'measured', 0, 1)).resolves.toEqual(
      [],
    );
    expect(stubSignals.connection.get(['a/b'])).toBe('down');
    expect(stubSignals.connection.use()).toBe('down');
    await expect(stubSignals.registry.search('x')).resolves.toEqual([]);
    await expect(stubSignals.registry.get('x')).rejects.toThrow(
      /not available/,
    );
  });

  it('keeps the playhead on the wall clock', () => {
    const before = Date.now();
    stubSignals.playhead.set(0);
    stubSignals.playhead.follow(false);
    expect(stubSignals.playhead.get()).toBeGreaterThanOrEqual(before);
    expect(stubSignals.playhead.use()).toBeGreaterThanOrEqual(before);
  });

  it('refuses git access', async () => {
    await expect(stubGit.read('r', 'p')).rejects.toThrow(/not available/);
    await expect(stubGit.commit('r', 'b', [], 'm')).rejects.toThrow(
      /not available/,
    );
  });

  it('lists contributions but stores and renders nothing', async () => {
    const viz = stubViz([], []);
    await expect(
      viz.load({ id: 'dt', name: 'dt', files: [] } as never),
    ).resolves.toBeNull();
    await expect(viz.save({} as never, {} as never)).rejects.toThrow();
    await expect(viz.substrates.get('aec')).rejects.toThrow();
    expect(viz.substrates.list()).toEqual([]);
    expect(viz.anchorKinds).toEqual([]);
  });
});
