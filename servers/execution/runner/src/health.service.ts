import { Injectable } from '@nestjs/common';
import Config from './config/configuration.service.js';
import {
  HealthDto,
  healthReport,
  MqttHealth,
  scriptsHealth,
} from './dto/health.dto.js';
import FsmService from './fsm/fsm.service.js';
import Queue from './queue.service.js';

// Reports whether the runner answers and its connections are up, with
// the MQTT status that the caller passes, the account of the scripts,
// and whether a save runs
@Injectable()
export default class HealthService {
  constructor(
    private readonly queue: Queue,
    private readonly config: Config,
    private readonly fsm: FsmService,
  ) {}

  check(mqtt: MqttHealth): HealthDto {
    return healthReport(mqtt, {
      database: this.queue.mode(),
      scripts: scriptsHealth(this.config.getScriptUser()),
      saving: this.fsm.pause.saving,
    });
  }
}
