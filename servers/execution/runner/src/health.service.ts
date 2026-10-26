import { Injectable } from '@nestjs/common';
import { HealthDto, healthReport, MqttHealth } from './dto/health.dto.js';
import Queue from './queue.service.js';

// Reports whether the runner answers and its connections are up, with
// the MQTT status that the caller passes
@Injectable()
export default class HealthService {
  constructor(private readonly queue: Queue) {}

  check(mqtt: MqttHealth): HealthDto {
    return healthReport(mqtt, this.queue.mode());
  }
}
