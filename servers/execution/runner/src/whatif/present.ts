import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type DescriptorService from '../descriptor.service.js';
import { fsmReply } from '../dto/fsm.dto.js';
import type FsmService from '../fsm/fsm.service.js';

// What the copy of a what-if learns of the present from the runner
export type Twin = Pick<DescriptorService, 'state' | 'properties' | 'peers'>;

// The present as the routes of the same names answer it; a document
// that needs a state machine is the reply of GET /fsm without one
export function presentOf(
  twin: Twin,
  fsm: FsmService,
): Record<string, unknown> {
  const none = fsmReply('no state machine', undefined);
  return {
    state: twin.state(),
    parameters: fsm.parameters()?.document() ?? none,
    properties: twin.properties().document() ?? none,
    peers: twin.peers().document(),
  };
}

// Writes each document as <name>.json into the copy
export async function writePresent(
  directory: string,
  present: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    Object.entries(present).map(([name, document]) =>
      writeFile(
        join(directory, `${name}.json`),
        `${JSON.stringify(document, null, 2)}\n`,
      ),
    ),
  );
}
