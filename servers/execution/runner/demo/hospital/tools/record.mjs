// Records the demo: plays steps.mjs against the real runner, broker and
// webhook, and writes hospital.cast. Run it from anywhere with
// `node tools/record.mjs` after `yarn build` in the runner directory.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import Cast from './cast.mjs';
import steps from './steps.mjs';
import { healthy } from './waits.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const WINDOWS_BASH = String.raw`C:\Program Files\Git\bin\bash.exe`;
const BASH =
  process.env.DEMO_BASH ??
  (process.platform === 'win32' ? WINDOWS_BASH : 'bash');
const RUN_FILES = [
  'hospital.db',
  'mqtt.log',
  'webhook.log',
  'ward.log',
  'runner.log',
];
const cast = new Cast(110, 32, 'DTaaS runner: hospital bed management');
const processes = {};
const chapters = [];

function reset() {
  mkdirSync('run', { recursive: true });
  for (const file of [...RUN_FILES, 'shutdown', 'transcript.txt']) {
    rmSync(`run/${file}`, { force: true });
  }
  writeFileSync('run/ward.json', '{"cardiology":[],"maternity":[]}\n');
}

async function poll(condition, deadline) {
  if (await condition()) {
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(`timed out waiting for ${condition}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await poll(condition, deadline);
}

async function waitFor(condition, timeoutMs = 30000) {
  const started = Date.now();
  await poll(condition, started + timeoutMs);
  cast.since(started);
}

function run(command) {
  cast.type(command);
  const started = Date.now();
  const script = `exec 2>&1; source tools/shell.sh; ${command}`;
  const { stdout, status } = spawnSync(BASH, ['-c', script], {
    encoding: 'utf8',
  });
  cast.since(started);
  cast.output(stdout);
  cast.pause(1);
  appendFileSync(
    'run/transcript.txt',
    `$ ${command}  [exit ${status}]\n${stdout}\n`,
  );
}

async function startServices() {
  const child = spawn(process.execPath, ['tools/services.mjs']);
  processes.services = child;
  const [ready] = await once(child.stdout, 'data');
  cast.output(ready.toString());
}

async function startRunner() {
  const log = openSync('run/runner.log', 'w');
  processes.runner = spawn(
    process.execPath,
    ['tools/runner.mjs', '-c', 'runner.yaml'],
    {
      stdio: ['ignore', log, log],
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  await waitFor(healthy);
}

async function start({ start: name, show }) {
  cast.type(show);
  const started = Date.now();
  await (name === 'services' ? startServices() : startRunner());
  cast.since(started);
  cast.pause(1);
}

const runnerExited = () =>
  processes.runner.exitCode !== null || processes.runner.signalCode !== null;

// What each kind of step does, in the order a step is matched
const actions = {
  chapter: ({ chapter }) => {
    cast.marker(chapter);
    chapters.push([chapter, cast.clock]);
  },
  say: ({ say }) => cast.say(say),
  run: (step) => run(step.run),
  start: (step) => start(step),
  wait: ({ wait }) => waitFor(wait),
  stop: () => waitFor(runnerExited),
};

async function play(step) {
  const kind = Object.keys(actions).find((key) => step[key]);
  await actions[kind]?.(step);
}

function report() {
  const time = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  for (const [chapter, seconds] of chapters) {
    console.log(`| ${time(seconds)} | ${chapter} |`);
  }
  console.log(`length ${time(cast.clock)}, ${cast.events.length} events`);
  console.log('for the video, run tools/to-mp4.sh on Linux or in WSL');
}

reset();
try {
  // one step after the other
  await steps.reduce(
    (played, step) => played.then(() => play(step)),
    Promise.resolve(),
  );
  cast.save('hospital.cast', Math.floor(Date.now() / 1000));
  report();
} finally {
  Object.values(processes).forEach((child) => child.kill());
}
