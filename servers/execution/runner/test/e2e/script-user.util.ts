import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { type Caller, httpAuthorization } from 'test/sign.util';

// The script account that the test creates, if it is missing
export const ACCOUNT = 'dt-script-test';

export const MAIN = resolve('dist/src/main.js');

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

// Linux CI, where sudo needs no password, with a build of the runner;
// sudo is not even tried elsewhere
export function privileged(): boolean {
  if (process.platform !== 'linux' || process.env.CI !== 'true') {
    return false;
  }
  return existsSync(MAIN) && spawnSync('sudo', ['-n', 'true']).status === 0;
}

export type AccountEntry = { uid: number; gid: number; home: string };

// The passwd entry of the script account, which is created once
export function scriptAccount(): AccountEntry {
  if (spawnSync('getent', ['passwd', ACCOUNT]).status !== 0) {
    const options = ['--system', '--no-create-home'];
    const shell = ['--shell', '/usr/sbin/nologin'];
    run('sudo', ['-n', 'useradd', ...options, ...shell, ACCOUNT]);
  }
  const entry = run('getent', ['passwd', ACCOUNT]).trim().split(':');
  return { uid: Number(entry[2]), gid: Number(entry[3]), home: entry[5] };
}

export const freePort = (): Promise<number> =>
  new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });

export type Layout = {
  dir: string;
  config: string;
  key: string;
  scripts: string;
  run: string;
};

// Prints what the script is and may do, one name=value per line
const identity = ({ key, config, scripts }: Layout): string =>
  [
    '#!/bin/sh',
    'echo "user=$(id -un)"',
    'echo "groups=$(id -G)"',
    "grep -E '^(Cap(Inh|Prm|Eff|Amb)|NoNewPrivs):' /proc/$$/status |",
    "  tr -d '[:blank:]' | sed 's/:/=/'",
    'echo "home=$HOME"',
    'echo "pwd=$(pwd)"',
    'echo "url=${RUNNER_URL:+set}"',
    'echo "token=${RUNNER_TOKEN:+set}"',
    `cat '${key}' > /dev/null 2>&1; echo "key=$?"`,
    `cat '${config}' > /dev/null 2>&1; echo "config=$?"`,
    `touch '${scripts}/intruder' 2> /dev/null; echo "write=$?"`,
    '',
  ].join('\n');

const LOOP = '#!/bin/sh\nwhile :; do sleep 0.1; done\n';

const runnerYaml = (caller: Caller, port: number): string =>
  [
    'id: dt-1',
    `port: ${port}`,
    'location: scripts',
    'commands: [identity, loop]',
    'database: db/runner.db',
    'stopGrace: 2000',
    'auth:',
    '  principals:',
    `    - {name: ${caller.name}, role: client, publicKey: ${caller.publicKey}}`,
    '  key: keys/dt-1.key',
    'scripts:',
    `  user: ${ACCOUNT}`,
    '  runDirectory: run',
    '',
  ].join('\n');

function writeFile(path: string, text: string, mode: number): void {
  writeFileSync(path, text);
  chmodSync(path, mode);
}

function makeDir(path: string, mode: number): void {
  mkdirSync(path);
  chmodSync(path, mode);
}

// A runner directory under /tmp as PRIVILEGE-SETUP.md lays it out; an
// open key, and its directory, are readable by every account
export function writeLayout(caller: Caller, port: number, open = false) {
  const dir = mkdtempSync('/tmp/runner-18-');
  chmodSync(dir, 0o755);
  const layout: Layout = {
    dir,
    config: join(dir, 'runner.yaml'),
    key: join(dir, 'keys', 'dt-1.key'),
    scripts: join(dir, 'scripts'),
    run: join(dir, 'run'),
  };
  makeDir(join(dir, 'keys'), open ? 0o755 : 0o700);
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFile(layout.key, pem, open ? 0o644 : 0o600);
  makeDir(join(dir, 'db'), 0o700);
  makeDir(layout.scripts, 0o755);
  writeFile(join(layout.scripts, 'identity'), identity(layout), 0o755);
  writeFile(join(layout.scripts, 'loop'), LOOP, 0o755);
  makeDir(layout.run, 0o777);
  writeFile(layout.config, runnerYaml(caller, port), 0o600);
  return layout;
}

export type Started = {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
};

// The runner as the test's own account with the three capabilities
// ambient, started by root through setpriv, as PRIVILEGE-SETUP.md says
export function startRunner({ dir, config }: Layout): Started {
  const ids = [
    `--reuid=${process.getuid?.()}`,
    `--regid=${process.getgid?.()}`,
  ];
  const caps = [
    '--inh-caps=+setuid,+setgid,+kill',
    '--ambient-caps=+setuid,+setgid,+kill',
  ];
  const setpriv = [
    '/usr/bin/setpriv',
    '--reset-env',
    ...ids,
    '--init-groups',
    ...caps,
  ];
  const command = ['--', process.execPath, MAIN, '-c', config];
  const child = spawn('sudo', ['-n', ...setpriv, ...command], { cwd: dir });
  let output = '';
  child.stdout.on('data', (data) => (output += String(data)));
  child.stderr.on('data', (data) => (output += String(data)));
  const exited = new Promise<number | null>((done) => {
    child.on('exit', (code) => done(code));
  });
  return { child, output: () => output, exited };
}

const delay = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

// Polls GET /health until the runner answers, or fails with its output
// once it has exited
export async function waitForHealth(port: number, runner: Started) {
  let code: number | null | undefined;
  void runner.exited.then((exit) => (code = exit));
  for (let attempt = 0; attempt < 120 && code === undefined; attempt += 1) {
    const reply = await health(port).catch(() => undefined);
    if (reply !== undefined) {
      return reply;
    }
    await delay(250);
  }
  throw new Error(`The runner did not start:\n${runner.output()}`);
}

export async function health(port: number): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return response.json();
}

// SIGTERM to the runner, which runs as the test's account; sudo, which
// runs as root, exits with it
export async function stopRunner({ config }: Layout, runner: Started) {
  spawnSync('pkill', ['-TERM', '-u', String(process.getuid?.()), '-f', config]);
  await runner.exited;
}

// What the runner replies to POST / and POST /stop
export type Reply = {
  status?: string;
  result?: { stdout: string; stderr: string };
  stopped?: string[];
};

// A signed POST of the caller to the runner of dt-1
export async function post(
  port: number,
  caller: Caller,
  { path, body }: { path: string; body: object },
): Promise<Reply> {
  const text = JSON.stringify(body);
  const call = { method: 'POST', path, body: text };
  const authorization = httpAuthorization(caller, 'dt-1', call);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: text,
  });
  return (await response.json()) as Reply;
}

// The name=value lines of a script's output
export const fields = (stdout: string): Record<string, string> =>
  Object.fromEntries(
    stdout
      .trim()
      .split('\n')
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
