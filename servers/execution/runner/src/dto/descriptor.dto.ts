import { Attributes } from '../config/attributes.js';

// What the runner tells a Manager about the digital twin it serves;
// stateMachine says whether a state machine is loaded, and manager
// lists the commands a Manager may submit; peers are the ids of the
// enabled peers, in the order of runner.yaml
export type DescriptorDto = {
  id: string;
  attributes: Attributes;
  commands: string[];
  stateMachine: boolean;
  manager: { commands: string[] };
  peers: string[];
};
