import Config from 'src/config/configuration.service';

export const configFilename = 'runner.test.yaml';
export const nonExistingCommand = 'asdfghjkl';

export const permittedCommand = (config: Config): string =>
  config.permitCommands()[0];

// The names of the commands of a history, oldest first, for the tests
// in which only the names matter
export const commandNames = (history: { name: string }[]): string[] =>
  history.map(({ name }) => name);
