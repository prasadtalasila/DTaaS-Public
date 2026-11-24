import { z } from 'zod';
import { DATA } from '../peers/peer-notice.js';

// What a notice carries, as a replay twin takes it on a route; null
// stands for an empty payload, which clears a retained notice
export const noticeBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('presence'),
    data: DATA.presence.nullable(),
  }),
  z.strictObject({
    kind: z.literal('state'),
    data: DATA.state.refine((data) => data !== undefined, 'data is needed'),
  }),
]);

export type NoticeBody = z.infer<typeof noticeBodySchema>;
