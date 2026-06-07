import { z } from 'zod';

/**
 * Parse and validate environment variables against a Zod shape.
 *
 * Services call this once at startup so a missing or malformed variable
 * fails fast with a readable list of every problem, instead of surfacing
 * as an undefined somewhere deep in a request handler.
 */
export function createEnv<T extends z.ZodRawShape>(
  shape: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<z.ZodObject<T>> {
  const parsed = z.object(shape).safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
