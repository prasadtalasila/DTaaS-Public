// The second half of the story of the demo (steps.mjs): the peer
// events, the escalations, history, metrics, stop and shutdown
import { MOVED } from './configs.mjs';
import { fsmIs, logHas, whatIfEnded } from './waits.mjs';

// Windows runs <name>.ps1 of scripts/, and Linux the script <name>
export const WINDOWS = process.platform === 'win32';
export const H1 = 'hospital-1';
export const H2 = 'hospital-2';
export const admit = (patient, ward) =>
  `'{"name":"admit","input":{"patient":"${patient}","ward":"${ward}"}}'`;
// hospital-1's open logs where overflow goes at each entry
export const overflowLogged = (times) =>
  logHas(`${H1}/ward.log`, 'overflow to', times);
const raised = `grep -o 'Raised.*' run/${H1}/runner.log`;
// The question of the Manager: the free beds in two hours, if
// hospital-2 stays offline from ten minutes on
const SCENARIO =
  '{"name":"forecast-beds","input":{"horizon":"PT2H","steps":[{"at":"PT10M","peer":"hospital-2","online":false}]}}';
const WHATIF_ID = `$(grep -o '"id": [0-9]*' run/whatif.txt | cut -d' ' -f2)`;

export default [
  { chapter: 'Peer event: neighbour full' },
  {
    say: 'hospital-2 admits two patients, one over MQTT, and has no bed left.',
  },
  { run: `mq2 execute ${admit('p-5', 'cardiology')}` },
  { run: `dt2 / --json ${admit('p-6', 'maternity')} | tail -n 1` },
  { wait: fsmIs(H2, 'full', 'valid') },
  { wait: overflowLogged(4) },
  {
    say: 'hospital-2 went full, and its full found hospital-1 open (right). hospital-1 raised:',
  },
  { run: `${raised}; tail -n 1 run/${H1}/ward.log` },

  { chapter: 'Script raises an event; escalation on failure' },
  { say: 'Under multi, p-3 gets a bed in maternity; p-4 takes the last bed.' },
  { run: `dt1 / --json ${admit('p-3', 'cardiology')} | tail -n 1` },
  { run: `dt1 / --json ${admit('p-4', 'maternity')} | tail -n 1` },
  { wait: fsmIs(H1, 'full', 'invalid') },
  {
    say: 'open raised full over HTTP; full found no open peer and failed, which escalates (right).',
  },
  { run: `tail -n 2 run/${H1}/ward.log` },

  { chapter: 'Escalation on no transition' },
  {
    say: 'Intentional refusal: full has no transition for close. The runner escalates once per entry.',
  },
  { run: `dt1 /fsm/event --json '{"event":"close"}'` },
  { run: `dt1 /fsm/event --json '{"event":"close"}' | tail -n 1` },
  { run: 'grep -c no-transition run/mqtt.log' },

  { chapter: 'MQTT request/response with input' },
  {
    say: 'The Manager discharges p-1 over MQTT; discharge raises beds-free, which reopens hospital-1.',
  },
  { run: `mq1 execute '{"name":"discharge","input":{"patient":"p-1"}}'` },
  { wait: fsmIs(H1, 'open', 'running', 6) },
  { wait: overflowLogged(5) },
  { run: 'mq1 fsm' },

  { chapter: 'Disable and enable a peer' },
  {
    say: 'Disabling hospital-2 unsubscribes from it and forgets what it told:',
  },
  { run: `dt1 /peers -X PUT --json '{"hospital-2":false}'` },
  {
    say: 'Enabled again, its retained full counts as a change: neighbour-full restarts open.',
  },
  { run: `dt1 /peers -X PUT --json '{"hospital-2":true}' | tail -n 1` },
  { wait: overflowLogged(6) },
  { run: `${raised} | tail -n 1` },

  { chapter: 'Peer event: neighbour down' },
  {
    say: 'The runner of hospital-2 crashes; the broker publishes its will, offline with no time (right).',
  },
  { kill: H2, show: 'kill -9 %3' },
  { wait: overflowLogged(7) },
  { run: `${raised} | tail -n 1` },
  { run: 'dt1 /peers | head -n 8' },

  { chapter: 'History and metrics' },
  {
    say: 'The history since a time, newest last; state scripts have no caller, commands have one:',
  },
  { run: `dt1 "/history?since=$(date -u -d '-90 sec' +%FT%TZ)&limit=2"` },
  { run: `dt1 /history | grep '"by"' | sort | uniq -c` },
  { run: 'dt1 /metrics' },

  { chapter: 'Stop' },
  {
    say: WINDOWS
      ? 'A stop sends SIGTERM, then SIGKILL after stopGrace; on Windows PowerShell ends at once.'
      : 'A stop sends SIGTERM to the script and its children, then SIGKILL after stopGrace.',
  },
  { run: 'grep stopGrace runner.yaml' },
  { run: `dt1 /stop --json '{"name":"open"}'` },
  { wait: fsmIs(H1, 'closed', 'valid') },
  { say: '$stopped led open to closed:' },
  { run: 'dt1 /fsm | head -n 4' },

  { chapter: 'Webhook' },
  {
    say: 'The webhook received every notification of both DTs; here those that are not state documents:',
  },
  { run: "grep -v ' | ' run/webhook.log" },

  { chapter: 'What-if' },
  {
    say: 'The Manager asks hospital-1 about a state it is not in. The class names the command for it:',
  },
  { run: 'grep -A2 whatIf: hospital.fsm.yaml' },
  {
    say: 'The runner saves a private copy of the twin, answers 202 with the id, and runs forecast-beds on it.',
  },
  {
    run: `DT_AS=manager-1 dt1 /whatif --json '${SCENARIO}' | tee run/whatif.txt`,
  },
  { wait: whatIfEnded(H1, 'whatif.txt') },
  {
    say: 'The result is what the script printed; token absent: it had no RUNNER_TOKEN, nor RUNNER_URL.',
  },
  { run: `DT_AS=manager-1 dt1 /whatif/${WHATIF_ID}` },
  {
    say: 'A whatif notification told the end (right). The twin did not change, and the copy is gone:',
  },
  {
    run: `dt1 /fsm | head -n 3; echo "copies left: $(ls -A run/${H1}/snapshots/what-if | wc -l)"`,
  },

  { chapter: 'Save and reinstate' },
  {
    say: 'The operator takes hospital-1 out of execution: it saves a snapshot, then shuts down.',
  },
  { run: `dt1 /snapshot --json '{"stop":true}'` },
  { stop: H1 },
  {
    say: 'The beds are lost with the host; the twin comes back on port 5300 from the snapshot.',
  },
  { run: `rm run/${H1}/ward.json` },
  {
    start: MOVED.id,
    show: `node tools/runner.mjs -c ${MOVED.config} --reinstate ${MOVED.snapshots}/* > ${MOVED.log} &`,
  },
  {
    say: 'restore-script brought the patients back, and the machine is where it was:',
  },
  { run: `cat run/${H1}/ward.json` },
  { run: 'dt3 /fsm' },
  { run: `dt3 '/timeline?kind=start' | grep -o '"reinstated":[^}]*}'` },

  { chapter: 'Replay' },
  {
    say: 'The operator saved hospital-1 twice: early in the story, and before it moved.',
  },
  { run: `ls run/${H1}/snapshots` },
  {
    say: 'What would it have done under scope multi from the first save on? A replay file says:',
  },
  {
    run: 'node tools/replay-file.mjs multi > run/runner-replay.yaml; cat run/runner-replay.yaml',
  },
  {
    say: 'The dry run lists the inputs between the saves, without bodies; a stored reply is skipped:',
  },
  {
    run: `runner-replay --dry-run run/runner-replay.yaml | sed 's/ {.*}//' | head -n 6`,
  },
  {
    say: 'runner-replay starts a replay twin on 127.0.0.1, which reaches nobody, and feeds it the inputs.',
  },
  { run: 'runner-replay run/runner-replay.yaml | sed "s|$PWD/||"' },
  {
    say: 'Its scripts kept beds of their own; those of hospital-1 are untouched:',
  },
  { run: `cat run/${H1}/ward.json run/${H1}.replay/ward.json` },
  {
    say: 'runner-compare lists the state entries side by side, and marks the first difference:',
  },
  {
    run: `runner-compare "$(ls -d run/${H1}/snapshots/2* | tail -n 1)" run/replays/scope-multi`,
  },
  {
    say: 'Under multi from the start, the change of scope was no change, and open did not restart.',
  },

  { chapter: 'Presence: offline' },
  {
    say: 'Graceful shutdown, as on Ctrl+C: hospital-1 leaves with an offline notice (right).',
  },
  { run: 'touch run/shutdown' },
  { stop: MOVED.id },
  {
    say: 'A Manager that subscribes now gets the retained state and presence of both DTs:',
  },
  { run: 'mq retained' },
  { say: 'End of the demo.' },
];
