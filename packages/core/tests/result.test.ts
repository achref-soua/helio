import { describe, expect, it } from 'vitest';

import {
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapOr,
} from '../src/result';

describe('Result', () => {
  it('constructs and narrows ok/err', () => {
    const success = ok(42);
    const failure = err(new Error('nope'));
    expect(isOk(success)).toBe(true);
    expect(isErr(failure)).toBe(true);
    if (isOk(success)) expect(success.value).toBe(42);
    if (isErr(failure)) expect(failure.error.message).toBe('nope');
  });

  it('map transforms only ok values', () => {
    expect(unwrap(map(ok(2), (n) => n * 2))).toBe(4);
    const failure = map(err<Error>(new Error('x')), (n: number) => n * 2);
    expect(isErr(failure)).toBe(true);
  });

  it('mapErr transforms only errors', () => {
    const wrapped = mapErr(err(new Error('low-level')), (e) => new Error(`wrapped: ${e.message}`));
    expect(isErr(wrapped) && wrapped.error.message).toBe('wrapped: low-level');
    expect(unwrap(mapErr(ok(1), () => new Error('unused')))).toBe(1);
  });

  it('unwrap throws the contained error, unwrapOr falls back', () => {
    expect(() => unwrap(err(new Error('boom')))).toThrowError('boom');
    expect(() => unwrap(err('string failure'))).toThrowError('string failure');
    expect(unwrapOr(err(new Error('x')), 7)).toBe(7);
    expect(unwrapOr(ok(1), 7)).toBe(1);
  });

  it('tryCatch captures throws, including non-Error throws', () => {
    expect(unwrap(tryCatch(() => 'fine'))).toBe('fine');
    const thrown = tryCatch(() => {
      throw 'raw string';
    });
    expect(isErr(thrown) && thrown.error).toBeInstanceOf(Error);
  });

  it('tryCatchAsync captures rejections', async () => {
    expect(unwrap(await tryCatchAsync(async () => 5))).toBe(5);
    const rejected = await tryCatchAsync(async () => {
      throw new Error('async boom');
    });
    expect(isErr(rejected) && rejected.error.message).toBe('async boom');
  });
});
