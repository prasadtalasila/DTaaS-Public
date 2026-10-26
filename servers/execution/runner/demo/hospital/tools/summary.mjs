// One line for a notification of the runner, for the MQTT and webhook
// logs of the demo

function machine(data) {
  const { state, status, entry } = data.machine ?? {};
  return state ? `${state}#${entry} ${status}` : 'no state yet';
}

function command(data) {
  return data.command ? `${data.command.name}:${data.command.status}` : '-';
}

function state(data) {
  const scope = data.parameters?.scope;
  return `machine ${machine(data)} | scope ${scope} | command ${command(data)}`;
}

function presence(data) {
  if (!data.online) {
    return 'offline';
  }
  const { id, attributes } = data.descriptor;
  return `online  ${id} in ${attributes.city}`;
}

function escalation(data) {
  const proposal = data.proposal
    ? ` proposal ${JSON.stringify(data.proposal)}`
    : '';
  const event = data.event ? ` event ${data.event}` : '';
  return `${data.trigger} in ${data.state}#${data.entry}${event}: ${data.reason}${proposal}`;
}

const SUMMARIES = { state, presence, escalation };

export default function summary({ kind, time, data }) {
  const clock = time ? time.slice(11, 19) : 'no time ';
  const text = SUMMARIES[kind]?.(data) ?? JSON.stringify(data);
  return `${clock} ${text}`;
}
