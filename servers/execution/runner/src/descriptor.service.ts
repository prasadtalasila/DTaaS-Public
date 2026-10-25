import { Injectable } from '@nestjs/common';
import Config from './config/configuration.service.js';
import { DescriptorDto } from './dto/descriptor.dto.js';
import { commandState, StateDocumentDto } from './dto/state.dto.js';
import FsmService from './fsm/fsm.service.js';
import Queue from './queue.service.js';

// Describes the digital twin that this runner serves, and its state
@Injectable()
export default class DescriptorService {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly config: Config,
    private readonly fsm: FsmService,
    private readonly queue: Queue,
  ) {} // eslint-disable-line no-empty-function

  describe(): DescriptorDto {
    return {
      id: this.config.getId(),
      attributes: this.config.getAttributes(),
      commands: this.config.permitCommands(),
      stateMachine: this.fsm.hasMachine(),
    };
  }

  // No parameters are declared yet, so parameters is empty
  state(): StateDocumentDto {
    return {
      id: this.config.getId(),
      time: new Date().toISOString(),
      machine: this.fsm.check() ?? null,
      parameters: {},
      command: commandState(this.queue.activeCommand()),
    };
  }
}
