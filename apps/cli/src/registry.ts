/**
 * The command registry — its own module so command files and main.ts can
 * both import it without a cycle (main awaits the command imports at
 * startup; a cycle there deadlocks Node's top-level await).
 */

export const CLI_VERSION = process.env.HELIO_CLI_VERSION?.trim() || 'dev';

export interface Command {
  summary: string;
  run: (argv: string[]) => Promise<number>;
}

const COMMANDS = new Map<string, Command>();

export function registerCommand(
  name: string,
  summary: string,
  run: (argv: string[]) => Promise<number>,
): void {
  COMMANDS.set(name, { summary, run });
}

export function getCommand(name: string): Command | undefined {
  return COMMANDS.get(name);
}

export function listCommands(): Array<[string, Command]> {
  return [...COMMANDS.entries()];
}

registerCommand('version', 'Print the CLI version', () => {
  // eslint-disable-next-line no-console -- the CLI talks to a human
  console.log(`helio ${CLI_VERSION}`);
  return Promise.resolve(0);
});
