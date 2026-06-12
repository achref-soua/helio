/* eslint-disable no-console -- the CLI talks to a human */
import { createInterface } from 'node:readline/promises';

/**
 * Output helpers. Color is plain ANSI (zero deps), applied only on a
 * real terminal and silenced by NO_COLOR — piped output stays clean.
 */

const COLOR = process.stdout.isTTY === true && !process.env.NO_COLOR;

function paint(code: string): (text: string) => string {
  return (text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
}

/** Helio's yellow — the sun, headings, and the final hand-off. */
export const sun = paint('93');
export const bold = paint('1');
export const dim = paint('2');
export const good = paint('92');

/**
 * The Helio logo in half-block pixels: a glowing disc (near-white core
 * cooling through yellows, xterm-256) and eight short rounded rays at
 * 45° steps with a clear gap — the same geometry as icon.svg. Cells are
 * one pixel wide and two tall, so the mark is drawn at double vertical
 * resolution and comes out round.
 */
function sunShade(dx: number, dy: number): number | null {
  const d = Math.hypot(dx, dy);
  // The disc, core to rim.
  if (d <= 1.2) return 230;
  if (d <= 2.4) return 226;
  if (d <= 3.4) return 220;
  if (d <= 4.3) return 214;
  // The rays: short strokes from r 5.8 to 8.3, two pixels thick.
  if (d >= 5.8 && d <= 8.3) {
    for (let k = 0; k < 8; k += 1) {
      const angle = (k * Math.PI) / 4;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const along = dx * ux + dy * uy;
      const across = Math.abs(dx * uy - dy * ux);
      if (along >= 5.8 && along <= 8.3 && across <= 0.95) return 208;
    }
  }
  return null;
}

const fg256 = (n: number) => `38;5;${n}`;
const bg256 = (n: number) => `48;5;${n}`;

/** One terminal row = two pixel rows, via the upper-half block. */
function discRow(y: number, size: number): string {
  const center = (size - 1) / 2;
  let row = '';
  for (let x = 0; x < size; x += 1) {
    const top = sunShade(x - center, y - center);
    const bottom = sunShade(x - center, y + 1 - center);
    if (top === null && bottom === null) row += ' ';
    else if (top !== null && bottom !== null)
      row += `\u001b[${fg256(top)};${bg256(bottom)}m▀\u001b[0m`;
    else if (top !== null) row += `\u001b[${fg256(top)}m▀\u001b[0m`;
    else row += `\u001b[${fg256(bottom!)}m▄\u001b[0m`;
  }
  return row;
}

/**
 * The sunrise that greets installs and updates: a real sun — a round,
 * radially glowing disc in half-block pixels — with the wordmark at its
 * side. Without a color terminal it stays quiet and just states itself.
 */
export function banner(version: string, tagline: string): void {
  say('');
  if (!COLOR) {
    say(`  Helio ${version} — ${tagline}`);
    say('');
    return;
  }
  const SIZE = 18; // pixels per side → 9 terminal rows
  const rows = Math.ceil(SIZE / 2);
  const wordmarkRow = Math.floor(rows / 2) - 1;
  for (let r = 0; r < rows; r += 1) {
    const art = discRow(r * 2, SIZE);
    const text =
      r === wordmarkRow ? bold(`Helio ${version}`) : r === wordmarkRow + 1 ? dim(tagline) : '';
    say(`   ${art}${' '.repeat(6)}${text}`.trimEnd());
  }
  say('');
}

/** A stage heading: everything the installer does reads as one story. */
export function step(title: string): void {
  say('');
  say(`${sun('──')} ${bold(title)}`);
}

/** A quiet green confirmation under the current step. */
export function ok(message: string): void {
  say(`${good('   ok')} ${message}`);
}

export function say(message: string): void {
  console.log(message);
}

export function warn(message: string): void {
  console.error(`! ${message}`);
}

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export async function prompt(question: string, fallback: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, byDefault = false): Promise<boolean> {
  if (!process.stdin.isTTY) return byDefault;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${byDefault ? '[Y/n]' : '[y/N]'}: `))
      .trim()
      .toLowerCase();
    if (!answer) return byDefault;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/** Destructive actions require typing a word, never just "y". */
export async function confirmTyped(question: string, word: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} Type "${word}" to continue: `);
    return answer.trim() === word;
  } finally {
    rl.close();
  }
}
