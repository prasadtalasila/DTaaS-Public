import { Attributes } from '../config/config.schema.js';

// What the runner tells a Manager about the digital twin it serves;
// stateMachine says whether a state machine is loaded
export type DescriptorDto = {
  id: string;
  attributes: Attributes;
  commands: string[];
  stateMachine: boolean;
};
