import { Injectable } from '@nestjs/common';
import Config from './config/configuration.service.js';
import { DescriptorDto } from './dto/descriptor.dto.js';
import FsmService from './fsm/fsm.service.js';

// Describes the digital twin that this runner serves
@Injectable()
export default class DescriptorService {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly config: Config,
    private readonly fsm: FsmService,
  ) {} // eslint-disable-line no-empty-function

  describe(): DescriptorDto {
    return {
      id: this.config.getId(),
      attributes: this.config.getAttributes(),
      commands: this.config.permitCommands(),
      stateMachine: this.fsm.hasMachine(),
    };
  }
}
