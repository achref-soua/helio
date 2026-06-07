import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createEnv } from '../src/env';

describe('createEnv', () => {
  it('parses and types a valid environment', () => {
    const env = createEnv(
      { DATABASE_URL: z.string().url(), PORT: z.coerce.number().int().default(3000) },
      { DATABASE_URL: 'postgres://localhost:5432/helio' },
    );
    expect(env.DATABASE_URL).toBe('postgres://localhost:5432/helio');
    expect(env.PORT).toBe(3000);
  });

  it('coerces numeric strings', () => {
    const env = createEnv({ PORT: z.coerce.number().int() }, { PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('fails fast listing every missing or invalid variable', () => {
    expect(() =>
      createEnv(
        { DATABASE_URL: z.string().url(), REDIS_URL: z.string().min(1) },
        { DATABASE_URL: 'not a url' },
      ),
    ).toThrowError(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('ignores unrelated variables in the source', () => {
    const env = createEnv({ A: z.string() }, { A: 'x', UNRELATED: 'y' });
    expect(env).toEqual({ A: 'x' });
  });
});
