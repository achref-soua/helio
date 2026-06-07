import { apiKeyClient } from '@better-auth/api-key/client';
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { ac, roles } from './permissions';

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles }), twoFactorClient(), apiKeyClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
