import { describe, expect, it } from '@jest/globals';
import { toLayout } from 'src/config/layout';

const notify = { url: 'https://manager.example.org/dt-events' };

const peers = [{ id: 'hospital-2', topic: 'dtaas/hospital-2' }];

describe('Layout of runner.yaml', () => {
  it('Should leave a file of the new layout as it is', () => {
    const content = { id: 'dt', relationships: { manager: { notify }, peers } };

    expect(toLayout(content)).toEqual({ content, warnings: [], problems: [] });
  });

  it('Should move each old key and warn of it', () => {
    expect(toLayout({ id: 'dt', notify, peers })).toEqual({
      content: { id: 'dt', relationships: { manager: { notify }, peers } },
      warnings: [
        'notify moved to relationships.manager.notify',
        'peers moved to relationships.peers',
      ],
      problems: [],
    });
  });

  it('Should move an old key beside a new section', () => {
    const { content, warnings } = toLayout({
      notify,
      relationships: { peers },
    });

    expect(content).toEqual({ relationships: { manager: { notify }, peers } });
    expect(warnings).toEqual(['notify moved to relationships.manager.notify']);
  });

  it('Should refuse a section that is set in both places', () => {
    const content = {
      notify,
      peers,
      relationships: { manager: { notify }, peers },
    };

    expect(toLayout(content).problems).toEqual([
      'notify and relationships.manager.notify are both set',
      'peers and relationships.peers are both set',
    ]);
  });

  it.each([[null], ['text'], [[1]], [undefined]])(
    'Should leave %j for the schema to refuse',
    (content) => {
      expect(toLayout(content)).toEqual({
        content,
        warnings: [],
        problems: [],
      });
    },
  );

  it('Should leave an old key when relationships is no mapping', () => {
    const { content } = toLayout({ peers, relationships: 'none' });

    expect(content).toEqual({ relationships: 'none' });
  });
});
