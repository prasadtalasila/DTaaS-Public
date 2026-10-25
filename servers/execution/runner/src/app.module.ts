import { connect } from 'mqtt';
import { Module } from '@nestjs/common';
import RunnerFactory from './runner-factory.service.js';
import AppController from './app.controller.js';
import ExecaManager from './execa-manager.service.js';
import Queue from './queue.service.js';
import Config from './config/configuration.service.js';
import DescriptorService from './descriptor.service.js';
import MqttRequestHandler from './mqtt/mqtt-request.handler.js';
import MqttService, { MQTT_CONNECT } from './mqtt/mqtt.service.js';
import FsmController from './fsm/fsm.controller.js';
import FsmService from './fsm/fsm.service.js';
import HealthService from './health.service.js';
import HealthController from './health.controller.js';

@Module({
  imports: [],
  controllers: [AppController, FsmController, HealthController],
  providers: [
    ExecaManager,
    Queue,
    RunnerFactory,
    Config,
    FsmService,
    DescriptorService,
    MqttRequestHandler,
    MqttService,
    { provide: MQTT_CONNECT, useValue: connect },
    HealthService,
  ],
})
export default class AppModule {}
