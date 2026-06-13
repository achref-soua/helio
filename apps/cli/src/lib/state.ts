import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The installation directory (`~/.helio` by default, `HELIO_HOME` to
 * override — also what the tests use). Everything `helio` manages lives
 * here: the pinned compose file, the .env, downloaded release bundles,
 * and local backups.
 */

export function helioHome(env: Record<string, string | undefined> = process.env): string {
  return env.HELIO_HOME?.trim() || path.join(homedir(), '.helio');
}

export interface InstallPaths {
  home: string;
  composeFile: string;
  envFile: string;
  manifestFile: string;
  backupsDir: string;
  releasesDir: string;
}

export function installPaths(home: string = helioHome()): InstallPaths {
  return {
    home,
    composeFile: path.join(home, 'docker-compose.yml'),
    envFile: path.join(home, '.env'),
    manifestFile: path.join(home, 'manifest.json'),
    backupsDir: path.join(home, 'backups'),
    releasesDir: path.join(home, 'releases'),
  };
}

export interface InstallManifest {
  name: 'helio';
  version: string;
  installedAt: string;
  files: Record<string, string>;
}

export function readManifest(paths: InstallPaths): InstallManifest | null {
  if (!existsSync(paths.manifestFile)) return null;
  try {
    return JSON.parse(readFileSync(paths.manifestFile, 'utf8')) as InstallManifest;
  } catch {
    return null;
  }
}

export function writeManifest(
  paths: InstallPaths,
  manifest: Omit<InstallManifest, 'installedAt'>,
): void {
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(
    paths.manifestFile,
    `${JSON.stringify({ ...manifest, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export function isInstalled(paths: InstallPaths): boolean {
  return existsSync(paths.composeFile) && existsSync(paths.envFile);
}

/**
 * What to tell someone whose install directory already exists. `install`
 * deliberately refuses here — re-running it would generate fresh secrets
 * and overwrite the `.env`, leaving the existing database undecryptable.
 * The three lines map to the three real intents; most people who hit this
 * just ran `helio uninstall` (which keeps data by design — see
 * {@link keptDataMessage}) and simply want their stack back, so `helio up`
 * comes first.
 */
export function alreadyInstalledMessage(home: string): string {
  return [
    `Helio is already installed at ${home}. To`,
    `  • start it again with your data:  helio up`,
    `  • move to a newer release:        helio update`,
    `  • wipe it and reinstall fresh:    helio uninstall --purge-data, then reinstall`,
  ].join('\n');
}

/**
 * What `uninstall` (without `--purge-data`) says after stopping the stack.
 * It keeps the directory, so the next step is `helio up`, not a reinstall —
 * the one-line installer would land on {@link alreadyInstalledMessage}.
 */
export function keptDataMessage(home: string): string {
  return `kept ${home} (config, .env, backups) — "helio up" brings it back; "helio uninstall --purge-data" removes it for good`;
}
