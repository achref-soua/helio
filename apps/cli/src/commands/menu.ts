import { readFileSync } from 'node:fs';

import { envValue } from '../lib/envfile';
import { openBrowser } from '../lib/open';
import { helioHome, installPaths, isInstalled, readManifest } from '../lib/state';
import { banner, bold, dim, type MenuItem, say, select, sun } from '../lib/ui';
import { CLI_VERSION, getCommand, registerCommand } from '../registry';

/**
 * The choices the wizard offers, by install state. Kept pure so a test can
 * assert it stays in sync with the command registry (every key but `open`
 * dispatches to a real command). `open` is handled inline below.
 */
export function menuItems(installed: boolean): MenuItem[] {
  if (!installed) {
    return [
      { key: 'install', label: 'Install Helio — download, configure, and start it' },
      { key: 'doctor', label: 'Check this machine is ready (Docker, ports, disk)' },
    ];
  }
  return [
    { key: 'open', label: 'Open the dashboard in my browser' },
    { key: 'up', label: 'Start Helio' },
    { key: 'down', label: 'Stop Helio (your data is kept)' },
    { key: 'status', label: 'Check status & health' },
    { key: 'update', label: 'Update to the latest version (backs up first)' },
    { key: 'backup', label: 'Back up the database now' },
    { key: 'doctor', label: 'Run diagnostics' },
    { key: 'uninstall', label: 'Uninstall Helio' },
  ];
}

/** Open the dashboard at the installed instance's APP_URL. */
function openDashboard(paths: ReturnType<typeof installPaths>): void {
  let url = 'http://localhost:3000';
  try {
    url = envValue(readFileSync(paths.envFile, 'utf8'), 'APP_URL') ?? url;
  } catch {
    // No env yet — fall back to the default and still try.
  }
  say(`opening ${bold(url)} …`);
  openBrowser(url);
}

/**
 * The interactive wizard: what `helio` shows when run with no command on a
 * terminal. It is a thin menu over the existing commands — install when
 * nothing is here, otherwise the day-2 lifecycle — so there is one obvious
 * front door and nothing new to learn.
 */
async function run(): Promise<number> {
  if (!process.stdin.isTTY) return 1; // main.ts prints help in non-interactive use.
  banner(CLI_VERSION, 'install and operate your Helio');
  for (;;) {
    const paths = installPaths(helioHome());
    const installed = isInstalled(paths);
    if (installed) {
      const version = readManifest(paths)?.version ?? 'unknown';
      say(dim(`  installed: Helio ${version} at ${paths.home}`));
    }
    const choice = await select(
      installed ? 'What would you like to do?' : 'Helio is not installed here. What next?',
      menuItems(installed),
    );
    if (choice === null) {
      say(`\n${sun('☀')}  see you soon.`);
      return 0;
    }
    if (choice === 'open') {
      openDashboard(paths);
      continue;
    }
    const command = getCommand(choice);
    if (command) await command.run([]);
    say('');
  }
}

registerCommand('menu', 'Open the interactive wizard (the default with no command)', run);
