# @helio/core

Shared domain logic for all Helio services. Framework-free by design — anything importing Express/Next/Prisma does not belong here.

## What's inside

- **`createEnv(shape)`** — fail-fast environment validation with Zod; lists every missing/invalid variable at startup.
- **`HelioError` + `toProblemDetails`** — the error taxonomy (`validation`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal`) with HTTP status mapping and RFC 9457 problem-details serialization. Unexpected errors never leak internals.
- **`Result<T, E>`** — `ok`/`err` helpers (`map`, `mapErr`, `unwrap`, `tryCatch`, `tryCatchAsync`) for expected failure paths.
- **`newId(prefix)`** — TypeID-style identifiers (`ws_01jx…`, 26-char Crockford base32 over UUIDv7): lexicographically time-ordered, index-friendly, debuggable. With `isId` guards and `idTimestamp` extraction.

## Usage

```ts
import { createEnv, HelioError, newId, ok, err } from '@helio/core';
```

This is an internal package: it exports TypeScript source directly and is compiled by each consumer's toolchain.
