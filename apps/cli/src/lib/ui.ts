/* eslint-disable no-console -- the CLI talks to a human */
import { createInterface } from 'node:readline/promises';

/** Plain, non-TTY-safe output helpers — no spinners, no emoji noise. */

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
