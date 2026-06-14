/* eslint-disable no-console -- operator-facing script */
/**
 * Builds the self-host install bundle for one release:
 *
 *   dist/bundle/
 *     docker-compose.yml        (image tags pinned to the version)
 *     .env.template             (secret markers for the installer)
 *     manifest.json             (version + per-file sha256)
 *   dist/helio-bundle-<version>.tar.gz
 *   dist/checksums.txt
 *
 * Run: pnpm exec tsx scripts/release/build-bundle.ts [--version vX.Y.Z]
 * (defaults to the root package.json version). The release workflow and
 * `task release:bundle` both call this.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');
const { values } = parseArgs({ options: { version: { type: 'string' } } });

const packageVersion = (
  JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version;
const rawVersion = values.version ?? `v${packageVersion}`;
const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`refusing to build a bundle for malformed version "${version}"`);
  process.exit(1);
}

const distDir = path.join(root, 'dist');
const bundleDir = path.join(distDir, 'bundle');
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

// 1. Compose, with every image literally pinned to this release.
const composeTemplate = readFileSync(
  path.join(root, 'infra/compose/docker-compose.selfhost.yml'),
  'utf8',
);
if (!composeTemplate.includes('__HELIO_VERSION__')) {
  console.error('compose template has no __HELIO_VERSION__ markers — wrong file?');
  process.exit(1);
}
const compose = composeTemplate.replaceAll('__HELIO_VERSION__', version);
writeFileSync(path.join(bundleDir, 'docker-compose.yml'), compose);

// 2. The env template, verbatim (the CLI fills the markers at install).
const envTemplate = readFileSync(path.join(root, 'infra/compose/selfhost.env.template'), 'utf8');
writeFileSync(path.join(bundleDir, '.env.template'), envTemplate);

// 3. Manifest with per-file digests (the CLI verifies after download).
const files = ['docker-compose.yml', '.env.template'];
const manifest = {
  name: 'helio',
  version,
  files: Object.fromEntries(
    files.map((file) => [file, sha256(readFileSync(path.join(bundleDir, file)))]),
  ),
};
writeFileSync(path.join(bundleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 4. Sanity: the pinned compose must parse (skipped when docker is absent).
const probeEnv = Object.fromEntries(
  [...envTemplate.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => [
    match[1]!,
    match[1]!.endsWith('_PORT')
      ? '65000'
      : match[1]!.endsWith('_PATH')
        ? './placeholder'
        : 'placeholder-value-x',
  ]),
);
const config = spawnSync(
  'docker',
  ['compose', '-f', path.join(bundleDir, 'docker-compose.yml'), 'config', '--quiet'],
  { env: { ...process.env, ...probeEnv, COMPOSE_PROFILES: 'core,full,ops,update' } },
);
if (config.error) {
  console.warn('docker not available — skipped compose validation');
} else if (config.status !== 0) {
  console.error(`pinned compose failed validation:\n${config.stderr.toString()}`);
  process.exit(1);
}

// 5. The backup image's pg_dump major must match the bundled server major
// (a newer pg_dump cannot be read by an older server on restore).
const composeMajor = /pgvector\/pgvector:pg(\d+)/.exec(compose)?.[1];
const backupMajor = /FROM postgres:(\d+)-alpine/.exec(
  readFileSync(path.join(root, 'infra/docker/backup.Dockerfile'), 'utf8'),
)?.[1];
if (composeMajor !== backupMajor) {
  console.error(
    `postgres major mismatch: compose pg${composeMajor} vs backup image pg${backupMajor}`,
  );
  process.exit(1);
}

// 6. Tarball + checksums.
const tarName = `helio-bundle-${version}.tar.gz`;
const tar = spawnSync(
  'tar',
  ['-czf', path.join(distDir, tarName), '-C', bundleDir, ...files, 'manifest.json'],
  {
    stdio: 'inherit',
  },
);
if (tar.status !== 0) process.exit(tar.status ?? 1);

const tarBytes = readFileSync(path.join(distDir, tarName));
// Append: the release flow writes the CLI binaries' checksums first, and
// this file is the single published manifest covering every asset.
appendFileSync(path.join(distDir, 'checksums.txt'), `${sha256(tarBytes)}  ${tarName}\n`);
console.log(`bundle: dist/${tarName} (${(tarBytes.length / 1024).toFixed(1)} KiB)`);
console.log(`sha256: ${sha256(tarBytes)}`);
