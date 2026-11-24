// Conditions that the recorder waits for between steps, without showing
// the wait. Each names the DT whose runner it asks.
import { readFileSync } from 'node:fs';
import { DTS } from './settings.mjs';
import { authorization } from './sign.mjs';

// The JSON reply of the DT's runner, or undefined when the request
// fails: a keep-alive socket that the runner closes can reset a poll
async function get(id, path) {
  try {
    const header = authorization('GET', path, '', DTS[id].aud ?? id);
    const headers = header === undefined ? {} : { Authorization: header };
    return await (await fetch(`${DTS[id].url}${path}`, { headers })).json();
  } catch {
    return undefined;
  }
}

// The DT's machine is in the state, its script has the status and, if
// given, the entry has the number
export function fsmIs(id, state, status, entry) {
  return async () => {
    const machine = await get(id, '/fsm');
    return (
      machine?.state === state &&
      machine.status === status &&
      (entry === undefined || machine.entry === entry)
    );
  };
}

// The log in run/ has the text the given number of times or more
export function logHas(file, text, times = 1) {
  return async () => {
    try {
      const log = readFileSync(`run/${file}`, 'utf8');
      return log.split(text).length > times;
    } catch {
      return false;
    }
  };
}

export function healthy(id) {
  return async () => (await get(id, '/health'))?.mqtt === 'connected';
}

// The what-if whose reply is in the file of run/ has ended
export function whatIfEnded(id, file) {
  return async () => {
    const reply = readFileSync(`run/${file}`, 'utf8');
    const run = /"id": (\d+)/.exec(reply)[1];
    return ['valid', 'invalid', 'stopped'].includes(
      (await get(id, `/whatif/${run}`))?.status,
    );
  };
}
