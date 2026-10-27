import { Attributes } from '../config/config.schema.js';

// What the runner tells a Manager about the digital twin it serves;
// stateMachine says whether a state machine is loaded, manager lists
// the commands a Manager may submit, and publicKey verifies what the
// runner signs, null without auth.key
export type DescriptorDto = {
  id: string;
  attributes: Attributes;
  commands: string[];
  stateMachine: boolean;
  manager: { commands: string[] };
  publicKey: string | null;
};
