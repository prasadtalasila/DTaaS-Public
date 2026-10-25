import { Controller, Get } from '@nestjs/common';
import { HealthDto } from './dto/health.dto.js';
import HealthService from './health.service.js';
import MqttService from './mqtt/mqtt.service.js';

@Controller('health')
export default class HealthController {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly health: HealthService,
    private readonly mqtt: MqttService,
  ) {} // eslint-disable-line no-empty-function

  // 200 also when degraded, as this is a liveness check
  @Get()
  check(): HealthDto {
    return this.health.check(this.mqtt.status());
  }
}
