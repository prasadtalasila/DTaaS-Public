import type { Server } from 'node:http';
import type { ParameterValue } from '../dto/parameters.dto.js';
import type { Definition } from './definition.js';
import type { Inherited } from '../scripts/launch.js';
import { type Env, REFERENCE } from './declared-env.js';
import Parameters, { variableName } from './parameters.js';

export type { Env } from './declared-env.js';

// What the environment of one script is built from. Without a state
// machine there is no entry, definition or parameter value, and without
// access control no token. whatIf is the copy of a what-if run, which
// gets no address and no token. inherited and platform default to those
// of the runner process.
export type ScriptContext = {
  id: string;
  url?: string;
  token?: string;
  command: string;
  state?: string;
  entry?: number;
  whatIf?: string;
  values?: Readonly<Record<string, ParameterValue>>;
  definition?: Definition;
  inherited?: Inherited;
  platform?: NodeJS.Platform;
};

// The state is empty before the first transition
const machineVariables = (state?: string, entry?: number): Env =>
  entry === undefined ? {} : { DT_STATE: state ?? '', DT_ENTRY: `${entry}` };

const parameterVariables = (values: ScriptContext['values'] = {}): Env =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      variableName(name),
      String(value),
    ]),
  );

// The address and the token of the API, which a what-if does not get
function apiVariables({ url, token, whatIf }: ScriptContext): Env {
  if (whatIf !== undefined) {
    return {};
  }
  return {
    ...(url === undefined ? {} : { RUNNER_URL: url }),
    ...(token === undefined ? {} : { RUNNER_TOKEN: token }),
  };
}

const modeVariables = (whatIf?: string): Env =>
  whatIf === undefined
    ? { DT_MODE: 'live' }
    : { DT_MODE: 'what-if', DT_WHATIF_DIR: whatIf };

function runnerVariables(context: ScriptContext) {
  const { id, state, entry, values, whatIf } = context;
  return {
    ...apiVariables(context),
    DT_ID: id,
    ...modeVariables(whatIf),
    ...machineVariables(state, entry),
    ...parameterVariables(values),
  };
}

// The env of the file, then that of the command's state, with the
// runner variables interpolated; an unset one, such as RUNNER_URL
// before the server listens, is empty
function declaredVariables(context: ScriptContext, variables: Env): Env {
  const { definition, command } = context;
  const env = { ...definition?.env, ...definition?.stateEnv.get(command) };
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [
      name,
      value.replaceAll(
        REFERENCE,
        (_, reference: string) => variables[reference] ?? '',
      ),
    ]),
  );
}

// Windows names are case-insensitive, so there an inherited name that
// matches a name the runner sets is dropped, lest the child see both
function inheritedVariables(
  inherited: NonNullable<ScriptContext['inherited']>,
  platform: NodeJS.Platform,
  names: Set<string>,
): Env {
  return Object.fromEntries(
    Object.entries(inherited).filter(
      (variable): variable is [string, string] =>
        variable[1] !== undefined &&
        (platform !== 'win32' || !names.has(variable[0].toUpperCase())),
    ),
  );
}

// The inherited environment without an address or a token of the API,
// in any case, as Windows names are case-insensitive
const withoutApi = (base: Env): Env =>
  Object.fromEntries(
    Object.entries(base).filter(
      ([name]) => !/^RUNNER_(URL|TOKEN)$/i.test(name),
    ),
  );

// The whole environment of a script; later wins: the inherited
// environment, the runner variables, the file's env, the state's env.
// A what-if inherits no address or token of the API either.
export function scriptEnvironment(context: ScriptContext): Env {
  const { inherited = process.env, platform = process.platform } = context;
  const variables = runnerVariables(context);
  const own = { ...variables, ...declaredVariables(context, variables) };
  const names = new Set(Object.keys(own));
  const base = inheritedVariables(inherited, platform, names);
  return {
    ...(context.whatIf === undefined ? base : withoutApi(base)),
    ...own,
  };
}

// The address of the runner's HTTP API for its scripts: listen(port)
// binds all interfaces, so the loopback address reaches it. A server
// that does not listen yet, or listens on a pipe, has none.
export function runnerUrl(server: Pick<Server, 'address'>): string | undefined {
  const address = server.address();
  return address !== null && typeof address === 'object'
    ? `http://127.0.0.1:${address.port}`
    : undefined;
}

// Where the machine is, and the copy of a what-if
export type ScriptAt = Pick<ScriptContext, 'state' | 'entry' | 'whatIf'>;

// What the scripts of a runner learn about it: its identity, the
// address of its API and the token for it, and the declared env and
// parameters of its DT
export class RunnerContext {
  private id = '';

  private url: string | undefined;

  private token: string | undefined;

  private definition: Definition | undefined;

  private parameters: Parameters | undefined;

  private inherited: Inherited | undefined;

  load(id: string, definition?: Definition, parameters?: Parameters): void {
    this.id = id;
    this.definition = definition;
    this.parameters = parameters;
  }

  setApi(url: string | undefined, token: string | undefined): void {
    this.url = url;
    this.token = token;
  }

  // What every script's environment starts from; the runner's own
  // without a call
  inherit(base: Inherited): void {
    this.inherited = base;
  }

  // The environment of the command's script, for the entry of the
  // state, or for a what-if on the copy
  environment(command: string, at: ScriptAt = {}): Env {
    return scriptEnvironment({
      id: this.id,
      url: this.url,
      token: this.token,
      command,
      ...at,
      values: this.parameters?.values(),
      definition: this.definition,
      inherited: this.inherited,
    });
  }
}
