import { Attributes } from '../config/attributes.js';
import type { DtClass } from '../fsm/class.js';
import type { ReplayOf } from '../replay/replay-mode.js';

// What the runner tells a Manager about the digital twin it serves;
// class is the kind of twin that the state machine file defines, null
// when it names none, stateMachine says whether a state machine is loaded, manager lists
// the commands a Manager may submit, peers are the ids of the enabled
// peers, in the order of runner.yaml, and publicKey verifies what the
// runner signs, null without auth.key; replay names the snapshot that a
// replay twin started from, null for any other runner
export type DescriptorDto = {
  id: string;
  attributes: Attributes;
  commands: string[];
  class: DtClass | null;
  stateMachine: boolean;
  manager: { commands: string[] };
  peers: string[];
  publicKey: string | null;
  replay: ReplayOf | null;
};
