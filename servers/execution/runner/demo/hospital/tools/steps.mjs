// The story of the demo: chapters, narration, commands typed at the
// prompt, background processes and silent waits. record.mjs plays it.
// dt1 and mq1 ask hospital-1, dt2 and mq2 hospital-2 (tools/shell.sh).
// This file holds the setup and the features of one DT; steps-peers.mjs
// the rest, from the first peer event on.
import later, {
  H1,
  H2,
  WINDOWS,
  admit,
  overflowLogged,
} from './steps-peers.mjs';

// The admit script of the platform, and how to show its escalation
const ADMIT = WINDOWS ? 'admit.ps1' : 'admit';
const SHOW_ESCALATION = WINDOWS
  ? 'grep -n -A2 "reason =" scripts/admit.ps1'
  : 'grep -n -A4 "escalation=" scripts/admit | head -n 5';
import { logHas } from './waits.mjs';

export default [
  { chapter: 'Setup' },
  {
    say: 'A DT Manager steers a network of two hospital digital twins, hospital-1 and hospital-2.',
  },
  {
    say: 'A runner serves each DT; runner.yaml names hospital-1 and lists hospital-2 as its peer.',
  },
  { run: 'cat runner.yaml' },
  {
    say: 'record.mjs made new keys: the peer key, the signing key, and the callers alice and manager-1.',
  },
  { run: 'tail -n 11 runner.auth.yaml' },
  { say: 'runner-2.yaml is the same for hospital-2, which lists hospital-1:' },
  { run: `grep -E '^(id|port|stateMachine):|- id:' runner-2.yaml` },
  {
    say: 'The state machine file is the class of both hospitals: events, and the parameters scope, capacity and fidelity.',
  },
  { run: 'head -n 45 hospital.fsm.yaml' },
  {
    say: 'The property free-beds, and subscriptions that turn a change at a neighbour into an event.',
  },
  { run: 'sed -n 46,85p hospital.fsm.yaml' },
  { run: 'tail -n +86 hospital.fsm.yaml' },
  {
    say: 'hospital-2 runs the same class, with one bed per ward and no neighbour:',
  },
  {
    run: `grep -n -E 'stateMachine|capacity|relationship:' runner.yaml runner-2.yaml`,
  },
  {
    say: 'dt1 and dt2 are curl, signed as alice; mq1 and mq2 are MQTT requests, signed as manager-1.',
  },
  { run: 'tail -n 6 tools/shell.sh' },

  { chapter: 'Presence: online' },
  {
    say: 'Start the Manager side: an MQTT broker, a subscriber (right) and a webhook receiver.',
  },
  { start: 'services', show: 'node tools/services.mjs &' },
  {
    start: H1,
    show: `node tools/runner.mjs -c runner.auth.yaml > run/${H1}/runner.log &`,
  },
  {
    start: H2,
    show: `node tools/runner.mjs -c runner-2.auth.yaml > run/${H2}/runner.log &`,
  },
  {
    say: 'Each runner joins with a signed online notice and its first state document (right).',
  },

  { chapter: 'Descriptor, health and access control' },
  { run: 'dt1 /dt' },
  {
    say: WINDOWS
      ? 'Health is open to anyone; scripts is null, as Windows runs no script user.'
      : 'Health is open to anyone; scripts is null, as runner.yaml names no script user.',
  },
  { run: 'dt1 /health' },
  {
    say: 'Intentional refusals: a request without a credential, and a manager starting a state script.',
  },
  { run: 'DT_AS=nobody dt1 /dt' },
  { run: `DT_AS=manager-1 dt1 / --json '{"name":"open"}'` },

  { chapter: 'Signed output' },
  {
    say: 'The runner signs notifications and MQTT responses; the tools verify them with its publicKey.',
  },
  {
    run: 'mq1 dt | grep -e response -e publicKey; cat run/keys/hospital-1.pub',
  },

  { chapter: 'State machine and script context' },
  {
    say: 'Open both hospitals: a transition into state open, whose script watches the beds.',
  },
  { run: `dt2 /fsm/transition --json '{"state":"open"}'` },
  { wait: logHas(`${H2}/ward.log`, 'overflow to') },
  { run: `dt1 /fsm/transition --json '{"state":"open"}'` },
  { wait: overflowLogged(1) },
  {
    say: 'open logged its context, its fidelity, and from GET /peers where overflow goes:',
  },
  { run: `cat run/${H1}/ward.log` },
  { run: 'dt1 /state' },
  {
    say: 'open wrote the property free-beds; the runner checks, keeps and publishes it, and never reads it.',
  },
  { run: 'dt1 /properties' },
  {
    say: 'The operator saves hospital-1 now, to replay the rest of the story at its end:',
  },
  { run: `dt1 /snapshot --json '{}'` },

  { chapter: 'Peers' },
  {
    say: 'hospital-1 keeps what the signed notices of hospital-2 told, verified with its key:',
  },
  { run: 'dt1 /peers' },
  {
    say: 'Intentional refusal: an unknown peer, and a value that is not a boolean.',
  },
  { run: `dt1 /peers -X PUT --json '{"hospital-9":false,"hospital-2":"off"}'` },

  { chapter: 'Command input and request keys' },
  {
    say: `The Manager admits p-1; the input reaches ${ADMIT} on stdin. A request key makes it idempotent.`,
  },
  {
    run: `dt1 / -H 'Idempotency-Key: admit-p-1' --json ${admit('p-1', 'cardiology')}`,
  },
  {
    say: 'The same key again: the stored reply, and admit does not run a second time.',
  },
  {
    run: `dt1 / -H 'Idempotency-Key: admit-p-1' --json ${admit('p-1', 'cardiology')}`,
  },
  { run: `grep -o 'Discarded.*' run/${H1}/runner.log` },
  {
    say: 'Intentional refusal: input for a command that is running (open) gets 409 command running.',
  },
  { run: `dt1 / --json '{"name":"open","input":{}}'` },

  { chapter: 'Failed command and explicit escalation' },
  { run: `dt1 / --json ${admit('p-2', 'cardiology')} | tail -n 1` },
  {
    say: 'Cardiology is full and scope is single, so p-3 is refused: status failed, exit code 3.',
  },
  { run: `dt1 / --json ${admit('p-3', 'cardiology')}` },
  {
    say: `${ADMIT} also POSTed $RUNNER_URL/escalate with a reason and a proposal (right):`,
  },
  { run: SHOW_ESCALATION },
  {
    say: 'GET / shows the last command; a script that ends before the first sample has no resources.',
  },
  { run: 'dt1 /' },

  { chapter: 'Parameters and fidelity' },
  { run: 'dt1 /parameters' },
  { say: 'Intentional refusal: capacity is not controllable.' },
  { run: `dt1 /parameters -X PUT --json '{"capacity":3}'` },
  {
    say: 'The Manager accepts the proposal: scope multi raises scope-changed, a stop: true self-transition.',
  },
  { run: `mq1 parameters/set '{"scope":"multi"}'` },
  { wait: overflowLogged(2) },
  {
    say: 'fidelity follows the convention of STATE-MACHINE.md: high samples the beds five times as often.',
  },
  {
    run: `dt1 /parameters -X PUT --json '{"fidelity":"high"}' | tail -n 1`,
  },
  { wait: overflowLogged(3) },
  { run: `grep -E 'DT_ENTRY|fidelity' run/${H1}/ward.log` },
  {
    say: 'The run at the old fidelity ended stopped with its figures; the new one shows them at its end.',
  },
  { run: `dt1 '/history?limit=2'` },
  ...later,
];
