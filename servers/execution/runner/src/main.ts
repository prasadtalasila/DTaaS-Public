#!/usr/bin/env node

import { NestFactory } from '@nestjs/core';
import Keyv from 'keyv';
import AppModule from './app.module.js';
import Config from './config/configuration.service.js';
import CLI, { createCommand } from './config/commander.js';
import MqttService from './mqtt/mqtt.service.js';
import DescriptorService from './descriptor.service.js';
import FsmService from './fsm/fsm.service.js';
import { runnerUrl } from './fsm/script-context.js';
import { openTwin } from './snapshot/reinstate.js';

/*
The js file extension in import is a limitation of typescript.
See: https://stackoverflow.com/questions/62619058/appending-js-extension-on-relative-import-statements-during-typescript-compilat
     https://github.com/microsoft/TypeScript/issues/16577
*/

const PROGRAM_NAME = 'runner';
const [program, CLIOptions] = createCommand(PROGRAM_NAME);
await CLI(program, CLIOptions); // function fills the CLIOptions

async function bootstrap(options: Keyv) {
  // the access guard hashes the raw body of a request
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get<Config>(Config);
  await config.loadConfig(options);
  app.get<FsmService>(FsmService).load();
  await openTwin(app, await options.get('reinstate'));
  app.enableShutdownHooks();
  // a save with stop shuts down as a signal does, and the process ends
  app
    .get<DescriptorService>(DescriptorService)
    .snapshots()
    .onStop(() => app.close());
  // MQTT starts before listen, so that the startup state notification
  // reaches the broker. init and listen yield only to microtasks and
  // nextTick, so no MQTT request is read before RUNNER_URL is set; keep
  // start right before listen.
  app.get<MqttService>(MqttService).start();
  await app.listen(config.getPort());
  const fsm = app.get<FsmService>(FsmService);
  const token = config.access()?.scriptToken;
  fsm.setRunnerApi(runnerUrl(app.getHttpServer()), token);
}
bootstrap(CLIOptions);
