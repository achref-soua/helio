import { readFileSync, writeFileSync } from 'node:fs';

import { compose } from '../lib/docker';
import { envValue } from '../lib/envfile';
import { generateVaultKey } from '../lib/secrets';
import { helioHome, installPaths, isInstalled } from '../lib/state';
import { confirm, fail, say } from '../lib/ui';
import { registerCommand } from '../registry';

/**
 * Vault-key rotation (ADR-0019): mint a new key, keep the old one
 * readable as _PREVIOUS, restart, run the re-encrypt walk in the migrate
 * image, then retire the old key. Idempotent and resumable at every step.
 */
async function run(): Promise<number> {
  const paths = installPaths(helioHome());
  if (!isInstalled(paths)) fail(`no installation at ${paths.home}`);
  let env = readFileSync(paths.envFile, 'utf8');
  const currentKey = envValue(env, 'HELIO_ENCRYPTION_KEY');
  if (!currentKey) fail('HELIO_ENCRYPTION_KEY is not set in .env — nothing to rotate');

  if (!(await confirm('Rotate the credential-vault key now? (services restart twice)', false))) {
    return 1;
  }

  // 1. New key live, old key still readable.
  const newKey = generateVaultKey();
  env = env.replace(/^HELIO_ENCRYPTION_KEY=.*$/m, `HELIO_ENCRYPTION_KEY=${newKey}`);
  env = env.replace(/^#?\s*HELIO_ENCRYPTION_KEY_PREVIOUS=.*$/m, '').trimEnd();
  env += `\nHELIO_ENCRYPTION_KEY_PREVIOUS=${currentKey}\n`;
  writeFileSync(paths.envFile, env);
  const profiles = (envValue(env, 'COMPOSE_PROFILES') ?? 'core').split(',').filter(Boolean);
  say('restarting with both keys readable…');
  await compose(paths, ['up', '-d', '--wait'], { profiles });

  // 2. The walk: re-seal everything under the new key.
  say('re-encrypting stored credentials…');
  if ((await compose(paths, ['run', '--rm', 'migrate', 'rotate'], { profiles: ['ops'] })) !== 0) {
    fail(
      'the re-encrypt walk failed — both keys remain readable; fix the issue and re-run helio rotate-key (it resumes safely)',
    );
  }

  // 3. Retire the old key.
  env = readFileSync(paths.envFile, 'utf8').replace(/^HELIO_ENCRYPTION_KEY_PREVIOUS=.*\n?/m, '');
  writeFileSync(paths.envFile, env);
  say('restarting with the old key retired…');
  await compose(paths, ['up', '-d', '--wait'], { profiles });
  say('rotation complete — update your offline copy of .env');
  return 0;
}

registerCommand('rotate-key', 'Rotate the credential-vault encryption key', () => run());
