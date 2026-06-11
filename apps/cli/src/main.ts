#!/usr/bin/env node
/* eslint-disable no-console -- the CLI talks to a human */

/**
 * helio — install and operate a self-hosted Helio.
 *
 * Zero runtime dependencies; compiled to single binaries per platform at
 * release time (bun build --compile). Command modules register here; the
 * pure logic they share lives in src/lib with unit coverage.
 */

export const CLI_VERSION = process.env.HELIO_CLI_VERSION?.trim() || 'dev';

const COMMANDS: Record<string, { summary: string; run: (argv: string[]) => Promise<number> }> = {
  version: {
    summary: 'Print the CLI version',
    run: () => {
      console.log(`helio ${CLI_VERSION}`);
      return Promise.resolve(0);
    },
  },
};

export function registerCommand(
  name: string,
  summary: string,
  run: (argv: string[]) => Promise<number>,
): void {
  COMMANDS[name] = { summary, run };
}

function help(): void {
  console.log(`helio ${CLI_VERSION} — self-hosted Helio, one command at a time

Usage: helio <command> [options]

Commands:`);
  for (const [name, command] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(12)} ${command.summary}`);
  }
  console.log(`\nDocs: https://github.com/achref-soua/helio`);
}

async function main(): Promise<void> {
  // Command modules self-register on import.
  await import('./commands/index');

  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    help();
    process.exit(command ? 0 : 1);
  }
  if (command === '--version' || command === '-v') {
    console.log(`helio ${CLI_VERSION}`);
    process.exit(0);
  }
  const entry = COMMANDS[command];
  if (!entry) {
    console.error(`unknown command "${command}"\n`);
    help();
    process.exit(1);
  }
  process.exit(await entry.run(rest));
}

await main();
