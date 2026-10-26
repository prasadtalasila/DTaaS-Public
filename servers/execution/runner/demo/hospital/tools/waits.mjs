// Conditions that the recorder waits for between steps, without showing
// the wait
import { readFileSync } from 'node:fs';
import { RUNNER_URL } from './settings.mjs';

// The JSON reply of the runner, or undefined when the request fails: a
// keep-alive socket that the runner closes can reset a poll
async function get(path) {
  try {
    return await (await fetch(`${RUNNER_URL}${path}`)).json();
  } catch {
    return undefined;
  }
}

// The machine is in the state, its script has the status and, if given,
// the entry has the number
export function fsmIs(state, status, entry) {
  return async () => {
    const machine = await get('/fsm');
    return (
      machine?.state === state &&
      machine.status === status &&
      (entry === undefined || machine.entry === entry)
    );
  };
}

// The log in run/ has the text
export function logHas(file, text) {
  return async () => {
    try {
      return readFileSync(`run/${file}`, 'utf8').includes(text);
    } catch {
      return false;
    }
  };
}

export async function healthy() {
  const health = await get('/health');
  return health?.mqtt === 'connected';
}
