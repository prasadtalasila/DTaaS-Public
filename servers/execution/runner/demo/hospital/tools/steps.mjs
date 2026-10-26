// The story of the demo: chapters, narration, commands typed at the
// prompt, background processes and silent waits. record.mjs plays it.
import { fsmIs, logHas } from './waits.mjs';

const admit = (patient, ward) =>
  `'{"name":"admit","input":{"patient":"${patient}","ward":"${ward}"}}'`;

export default [
  { chapter: 'Setup' },
  {
    say: 'A DT Manager watches hospital-1, one hospital of a network of hospital digital twins.',
  },
  {
    say: 'The runner serves the DT: runner.yaml names it, the state machine file gives its behaviour.',
  },
  { run: 'cat runner.yaml' },
  { run: 'head -n 34 hospital.fsm.yaml' },
  { run: 'tail -n +35 hospital.fsm.yaml' },
  {
    say: 'dt is curl plus a pretty-printer; mq sends an MQTT request and prints the response.',
  },
  { run: 'cat tools/shell.sh' },

  { chapter: 'Presence: online' },
  {
    say: 'Start the Manager side: an MQTT broker, a subscriber and a webhook, each logging one line per notification.',
  },
  { start: 'services', show: 'node tools/services.mjs &' },
  {
    start: 'runner',
    show: 'node tools/runner.mjs -c runner.yaml > run/runner.log &',
  },
  {
    say: 'The runner joins: presence online with its descriptor, and its first state document.',
  },
  { run: 'cat run/mqtt.log' },
  { run: 'cat run/webhook.log' },

  { chapter: 'DT identity and descriptor' },
  { run: 'dt /dt' },
  { say: 'The same descriptor over the MQTT request/response API:' },
  { run: 'mq dt' },

  { chapter: 'Health' },
  { run: 'dt /health' },

  { chapter: 'One state document' },
  { run: 'dt /state' },

  { chapter: 'State machine and script context' },
  {
    say: 'Open the hospital: a transition into state open, whose script watches the beds.',
  },
  { run: `dt /fsm/transition --json '{"state":"open"}'` },
  { wait: logHas('ward.log', 'RUNNER_URL') },
  {
    say: 'The script of open logged its context: DT_* variables, the state env POLL_MS and HINT built with ${...}.',
  },
  { run: 'cat run/ward.log' },

  { chapter: 'Command input and request keys' },
  {
    say: 'The Manager admits patient p-1; the input reaches admit.ps1 on stdin. A request key makes it idempotent.',
  },
  {
    run: `dt / -H 'Idempotency-Key: admit-p-1' --json ${admit('p-1', 'cardiology')}`,
  },
  {
    say: 'The same key again: the stored reply, and admit does not run a second time.',
  },
  {
    run: `dt / -H 'Idempotency-Key: admit-p-1' --json ${admit('p-1', 'cardiology')}`,
  },
  { run: `grep -o 'Discarded.*' run/runner.log` },
  {
    say: 'Intentional refusal: input for a command that is running (open) gets 409 command running.',
  },
  { run: `dt / --json '{"name":"open","input":{}}'` },

  { chapter: 'Failed command and explicit escalation' },
  { run: `dt / --json ${admit('p-2', 'cardiology')}` },
  {
    say: 'Cardiology has 2 beds and scope is single, so p-3 is refused: status failed, exit code 3.',
  },
  { run: `dt / --json ${admit('p-3', 'cardiology')}` },
  {
    say: 'admit.ps1 also POSTed $RUNNER_URL/escalate with a reason and a proposal:',
  },
  { run: 'grep -n -A2 "reason =" scripts/admit.ps1' },
  { run: 'tail -n 2 run/mqtt.log' },

  { chapter: 'Baseline: last command' },
  { say: 'GET / shows the last command, now with its exit code:' },
  { run: 'dt /' },

  { chapter: 'Declared parameters' },
  { run: 'dt /parameters' },
  { say: 'Intentional refusal: capacity is not controllable.' },
  { run: `dt /parameters -X PUT --json '{"capacity":3}'` },
  {
    say: 'The Manager accepts the proposal: scope multi raises scope-changed, a stop: true self-transition.',
  },
  { run: `dt /parameters -X PUT --json '{"scope":"multi"}' | tail -n 1` },
  { wait: logHas('ward.log', 'open#2 scope') },
  { run: 'tail -n 3 run/ward.log' },

  { chapter: 'Script raises an event; escalation on failure' },
  {
    say: 'Under multi, p-3 gets a fallback bed in maternity; p-4 takes the last bed.',
  },
  { run: `dt / --json ${admit('p-3', 'cardiology')}` },
  { run: `dt / --json ${admit('p-4', 'maternity')}` },
  { wait: fsmIs('full', 'invalid') },
  {
    say: 'open.ps1 raised the event full over HTTP; the script of full failed and full has no $failure transition.',
  },
  { run: 'tail -n 2 run/ward.log' },
  { run: 'tail -n 4 run/mqtt.log' },

  { chapter: 'Escalation on no transition' },
  {
    say: 'Intentional refusal: full has no transition for close. The runner escalates once per entry.',
  },
  { run: `dt /fsm/event --json '{"event":"close"}'` },
  { run: `dt /fsm/event --json '{"event":"close"}' | tail -n 1` },
  { run: 'grep -c no-transition run/mqtt.log' },

  { chapter: 'MQTT request/response with input' },
  {
    say: 'The Manager discharges p-1 over MQTT; discharge.ps1 raises beds-free, which reopens the hospital.',
  },
  { run: `mq execute '{"name":"discharge","input":{"patient":"p-1"}}'` },
  { wait: fsmIs('open', 'running', 4) },
  { run: 'mq fsm' },
  {
    say: 'A Manager that subscribes late gets the retained state and presence, but no old escalation:',
  },
  { run: 'mq retained' },

  { chapter: 'Baseline: history' },
  { run: 'dt /history' },

  { chapter: 'Stop' },
  {
    say: 'Stop the script of open: the runner raises $stopped, and open goes to closed.',
  },
  { run: `dt /stop --json '{"name":"open"}'` },
  { wait: fsmIs('closed', 'valid') },
  { run: 'dt /fsm' },
  { run: 'tail -n 5 run/mqtt.log' },

  { chapter: 'Webhook' },
  {
    say: 'The webhook received every notification too; here those that are not state documents:',
  },
  { run: "grep -v '^POST state' run/webhook.log" },

  { chapter: 'Presence: offline' },
  {
    say: 'Graceful shutdown, as on Ctrl+C: the runner leaves with an offline notice.',
  },
  { run: 'touch run/shutdown' },
  { stop: 'runner' },
  { run: 'tail -n 1 run/mqtt.log; tail -n 1 run/webhook.log' },
  { run: 'mq retained' },
  { say: 'End of the demo.' },
];
