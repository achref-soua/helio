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
 * The sunrise that greets installs and updates: a glowing two-tone sun —
 * golden rays, bright solid core — with the wordmark at its side. Pure
 * ASCII so every console renders it; the trailing space on the last ray
 * exists because a raw template cannot end in a backslash.
 */
export function banner(version: string, tagline: string): void {
  const ray = paint('33');
  const core = paint('93;1');
  const art: Array<{ line: string; width: number }> = [
    { line: ray(String.raw`       \    |    /`), width: 18 },
    { line: ray(String.raw`    \    `) + core('.#####.') + ray(String.raw`    /`), width: 21 },
    { line: ray('  --   ') + core('(#######)') + ray('   --'), width: 21 },
    { line: ray(String.raw`    /    `) + core(`'#####'`) + ray(String.raw`    \ `), width: 21 },
    { line: ray(String.raw`       /    |    \ `), width: 18 },
  ];
  const text = ['', bold(`Helio ${version}`), dim(tagline), '', ''];
  say('');
  for (let i = 0; i < art.length; i += 1) {
    const { line, width } = art[i]!;
    say(`  ${line}${' '.repeat(Math.max(28 - width, 1))}${text[i] ?? ''}`.trimEnd());
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
