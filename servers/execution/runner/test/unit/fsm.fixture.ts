import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';

const DEFINITION = `
events: [stop, reset]
states:
  create: {transitions: {$success: execute, $failure: terminate}}
  execute: {transitions: {stop: terminate}}
  terminate: {transitions: {reset: create}}`;

// Any name will do, as runner.yaml names the file
export const MACHINE_FILE = 'machine.yaml';

export const settle = () => new Promise(setImmediate);

// A script folder with the state machine of the service tests
export function scriptFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fsm-'));
  writeFileSync(join(dir, MACHINE_FILE), DEFINITION);
  return dir;
}

// Runs each script until the test finishes it
function fakeManager() {
  const finishers = new Map<string, (success: boolean) => void>();
  const manager = {
    isRunning: jest.fn((name: string) => finishers.has(name)),
    newCommand: jest.fn(
      (name: string) =>
        new Promise<[boolean, Map<string, string>]>((resolve) => {
          finishers.set(name, (success) => {
            finishers.delete(name);
            resolve([success, new Map()]);
          });
        }),
    ),
  };
  const finish = async (name: string, success: boolean) => {
    finishers.get(name)?.(success);
    await settle();
  };
  return { manager, finish };
}

// The service with the state machine of the file, if one is given
export function createService(file: string | undefined) {
  const { manager, finish } = fakeManager();
  const config = {
    getStateMachine: () => file,
    permitCommands: () => ['create', 'execute', 'terminate'],
  } as unknown as Config;
  const service = new FsmService(manager as unknown as ExecaManager, config);
  service.load();
  return { service, manager, finish };
}
