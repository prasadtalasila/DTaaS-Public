import type { NoticeKind } from '../peers/peers.js';
import type Timeline from '../queue.timeline.js';

export type Known = { peer: string; kind: NoticeKind; data: unknown };

// The last notice of each kind of each peer in the timeline up to a
// seq: what the twin knew of its peers when it was saved
export function knownPeers(timeline: Timeline, upTo: number): Known[] {
  const query = {
    after: 0,
    kind: ['notice' as const],
    limit: Number.MAX_SAFE_INTEGER,
    count: false,
  };
  const last = new Map<string, Known>();
  timeline
    .rows(query)
    .filter(({ seq }) => seq <= upTo)
    .forEach(({ data }) => {
      const known = data as Known;
      last.set(`${known.peer}/${known.kind}`, known);
    });
  return [...last.values()];
}
