// Measure the /settings route's first-load client JS from a production build.
// Reads the route's client-reference-manifest (the authoritative route -> client
// chunk map) and sums the on-disk bytes of the chunks its synchronous client
// modules reference. Run after `pnpm --filter @helio/web build`:
//   node scripts/perf/measure-settings-bundle.mjs apps/web/.next
// Bytes are uncompressed — a consistent before/after metric, not the wire size.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const NEXT = process.argv[2] || '.next';
const src = readFileSync(
  join(NEXT, 'server/app/(dashboard)/settings/page_client-reference-manifest.js'),
  'utf8',
);
const g = {};
new Function('globalThis', src)(g);
const man = g.__RSC_MANIFEST[Object.keys(g.__RSC_MANIFEST)[0]];
const cm = man.clientModules || {};
const sizeOf = (c) => {
  const p = join(NEXT, c.replace(/^\/_next\//, ''));
  return existsSync(p) ? statSync(p).size : 0;
};
const syncChunks = new Set(),
  allChunks = new Set();
let asyncMods = 0,
  syncMods = 0;
for (const m of Object.values(cm)) {
  m.async ? asyncMods++ : syncMods++;
  for (const c of m.chunks || []) {
    if (typeof c === 'string' && c.endsWith('.js')) {
      allChunks.add(c);
      if (!m.async) syncChunks.add(c);
    }
  }
}
const sum = (set) => [...set].reduce((t, c) => t + sizeOf(c), 0);
const kb = (b) => +(b / 1024).toFixed(1);
console.log(
  JSON.stringify(
    {
      clientModules: Object.keys(cm).length,
      syncMods,
      asyncMods,
      panelModules: Object.keys(cm).filter((k) => /-panel/.test(k)).length,
      syncChunkFiles: syncChunks.size,
      asyncOnlyChunkFiles: [...allChunks].filter((c) => !syncChunks.has(c)).length,
      syncFirstLoadKB: kb(sum(syncChunks)),
      asyncDeferredKB: kb(sum(allChunks) - sum(syncChunks)),
      totalKB: kb(sum(allChunks)),
    },
    null,
    2,
  ),
);
