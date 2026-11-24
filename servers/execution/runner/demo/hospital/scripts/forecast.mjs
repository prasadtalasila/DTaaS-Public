// The forecast of forecast-beds and forecast-beds.ps1, which run it
// with node only as a what-if. Not a command. It reads the copy in
// DT_WHATIF_DIR and the scenario on stdin, and prints a JSON result.
//
// What it computes, a guess for the demo and no model of a hospital:
// - free now: capacity (parameters.json) times the wards, less the
//   patients of files/ward.json, the beds that save-script copied;
// - the rate: the admit requests less the discharge requests of the
//   last hour in the timeline of state.db, per hour; a request counts
//   also when its script failed, as the timeline is all that a
//   what-if may rely on and it records requests;
// - free at the horizon: free now less the rate times the horizon, and
//   each step that takes a peer offline doubles the rate from its time
//   on, as the patients of that peer come here; never below 0.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const copy = process.env.DT_WHATIF_DIR;
const read = (file) => JSON.parse(readFileSync(join(copy, file), 'utf8'));

// The minutes of an ISO 8601 duration of hours and minutes, PT2H30M
function minutes(duration) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration);
  if (match === null) {
    throw new Error(`not a duration of hours and minutes: ${duration}`);
  }
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function freeNow() {
  const capacity = read('parameters.json').capacity.value;
  const beds = read('files/ward.json');
  return Object.values(beds).reduce(
    (free, patients) => free + capacity - patients.length,
    0,
  );
}

// Admit less discharge requests of the last hour, from the timeline
function ratePerHour() {
  const database = new DatabaseSync(join(copy, 'state.db'), {
    readOnly: true,
  });
  const since = new Date(Date.now() - 3600000).toISOString();
  const count = (name) =>
    database
      .prepare(
        `SELECT count(*) AS n FROM timeline WHERE kind = 'command'
         AND json_extract(data, '$.name') = ? AND time > ?`,
      )
      .get(name, since).n;
  const rate = count('admit') - count('discharge');
  database.close();
  return rate;
}

// The admissions over the horizon, with the steps of the scenario
function admissions(rate, horizon, steps) {
  const doubled = steps
    .filter((step) => step.online === false)
    .reduce(
      (extra, step) => extra + Math.max(horizon - minutes(step.at), 0),
      0,
    );
  return (rate * (horizon + doubled)) / 60;
}

const scenario = JSON.parse(readFileSync(0, 'utf8') || '{}');
const horizon = scenario.horizon ?? 'PT2H';
const now = freeNow();
const rate = ratePerHour();
const coming = admissions(rate, minutes(horizon), scenario.steps ?? []);
const offline = Object.entries(read('peers.json'))
  .filter(([, peer]) => peer.online === false)
  .map(([id]) => id);
const result = {
  'free-beds': Math.max(Math.floor(now - coming), 0),
  horizon,
  'free-now': now,
  'admissions-per-hour': rate,
  'state-now': read('state.json').machine?.state ?? null,
  'peers-offline-now': offline,
  token: process.env.RUNNER_TOKEN === undefined ? 'absent' : 'present',
};
console.log(JSON.stringify(result));
