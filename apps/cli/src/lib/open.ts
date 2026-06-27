import { spawn } from 'node:child_process';

/** Open a URL in the default browser, cross-platform; never throws. */
export function openBrowser(url: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Best-effort — the URL is also printed for the user to click.
  }
}
