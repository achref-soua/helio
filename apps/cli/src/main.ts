#!/usr/bin/env node
/* eslint-disable no-console -- the CLI talks to a human */

/**
 * helio — install and operate a self-hosted Helio.
 *
 * Zero runtime dependencies; compiled to single binaries per platform at
 * release time (bun build --compile). Command modules live under
 * src/commands and register themselves in src/registry; the pure logic
 * they share lives in src/lib with unit coverage.
 */

import './commands/index';

import { cleanupSelfUpdateLeftover } from './lib/self-update';
import { CLI_VERSION, getCommand, listCommands } from './registry';

function help(): void {
  console.log(`helio ${CLI_VERSION} — self-hosted Helio, one command at a time

Usage: helio <command> [options]

Commands:`);
  for (const [name, command] of listCommands()) {
    console.log(`  ${name.padEnd(12)} ${command.summary}`);
  }
  console.log(`\nDocs: https://github.com/achref-soua/helio`);
}

async function main(): Promise<void> {
  // Clear a Windows self-update leftover from a previous run (no-op elsewhere).
  cleanupSelfUpdateLeftover();
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    help();
    process.exit(command ? 0 : 1);
  }
  if (command === '--version' || command === '-v') {
    console.log(`helio ${CLI_VERSION}`);
    process.exit(0);
  }
  const entry = getCommand(command);
  if (!entry) {
    console.error(`unknown command "${command}"\n`);
    help();
    process.exit(1);
  }
  process.exit(await entry.run(rest));
}

await main();
