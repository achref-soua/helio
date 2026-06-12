import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ICON_PNG_BASE64 } from './icon-data';

/**
 * A desktop icon right after `helio install` (Windows): an .ico written
 * into the installation plus a .url shortcut on the Desktop. The PWA
 * install in the dashboard gives the full windowed-app feel; this makes
 * Helio findable the moment the terminal closes.
 */

/** Wrap a PNG (≤256px) as a single-image, PNG-compressed .ico (Vista+). */
export function pngToIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image bytes
  entry.writeUInt32LE(22, 12); // offset: 6 + 16
  return Buffer.concat([header, entry, png]);
}

/** The user's real Desktop folder (OneDrive moves it), with a sane fallback. */
function windowsDesktopDir(): string {
  try {
    const query = spawnSync(
      'reg',
      [
        'query',
        String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`,
        '/v',
        'Desktop',
      ],
      { stdio: 'pipe', encoding: 'utf8' },
    );
    const match = /Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(query.stdout ?? '');
    if (query.status === 0 && match?.[1]) {
      return match[1]
        .trim()
        .replace(/%USERPROFILE%/gi, os.homedir())
        .replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
    }
  } catch {
    // fall through to the default location
  }
  return path.join(os.homedir(), 'Desktop');
}

/**
 * Write the icon + shortcut; returns the shortcut path, or null when the
 * Desktop isn't writable — the install never fails over a nicety.
 */
export function writeWindowsDesktopShortcut(installHome: string, appUrl: string): string | null {
  try {
    const icoPath = path.join(installHome, 'helio.ico');
    writeFileSync(icoPath, pngToIco(Buffer.from(ICON_PNG_BASE64, 'base64'), 180));
    const shortcutPath = path.join(windowsDesktopDir(), 'Helio.url');
    const lines = ['[InternetShortcut]', `URL=${appUrl}`, `IconFile=${icoPath}`, 'IconIndex=0', ''];
    writeFileSync(shortcutPath, lines.join('\r\n'));
    return shortcutPath;
  } catch {
    return null;
  }
}
