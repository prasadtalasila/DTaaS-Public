import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import ExecaManager from 'src/execa-manager.service';
import { DEFINITION_FILE } from 'src/fsm/definition';
import FsmService from 'src/fsm/fsm.service';

const DEFINITION = `
events: [stop, reset]
states:
  create: {on: {$success: execute, $failure: terminate}}
  execute: {on: {stop: terminate}}
  terminate: {on: {reset: create}}`;

export const settle = () => new Promise(setImmediate);

// A script folder with the state machine of the service tests
export function scriptFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fsm-'));
  writeFileSync(join(dir, DEFINITION_FILE), DEFINITION);
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

export function createService(location: string) {
  const { manager, finish } = fakeManager();
  const config = {
    getLocation: () => location,
    permitCommands: () => ['create', 'execute', 'terminate'],
  } as unknown as Config;
  const service = new FsmService(manager as unknown as ExecaManager, config);
  service.load();
  return { service, manager, finish };
}
