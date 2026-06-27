'use client';

import dynamic from 'next/dynamic';

// Lazy client boundaries for the /settings panels. Declared in a client module
// (not the server page) so next/dynamic actually code-splits each panel into its
// own async chunk and gives React a Suspense boundary per panel — enabling
// selective hydration: the panel you interact with hydrates first instead of
// every panel blocking the main thread on load.
//
// ssr stays on (the default), so the server still renders each panel's HTML and
// first paint is unchanged — no skeleton flash, no layout shift, identical UX.
// dynamic() infers each panel's prop types from its named export, so the typed
// call sites in page.tsx keep full type-checking.

// NB: AboutPanel is intentionally NOT here. It's a server component (it awaits
// getTranslations); dynamic-importing it from this 'use client' module would
// render it in the client tree and throw. page.tsx imports it directly.
export const AnalyticsPanel = dynamic(() =>
  import('./analytics-panel').then((m) => ({ default: m.AnalyticsPanel })),
);
export const ApiKeysPanel = dynamic(() =>
  import('./api-keys-panel').then((m) => ({ default: m.ApiKeysPanel })),
);
export const BackupsPanel = dynamic(() =>
  import('./backups-panel').then((m) => ({ default: m.BackupsPanel })),
);
export const BrandingPanel = dynamic(() =>
  import('./branding-panel').then((m) => ({ default: m.BrandingPanel })),
);
export const ChurnModelPanel = dynamic(() =>
  import('./churn-model-panel').then((m) => ({ default: m.ChurnModelPanel })),
);
export const CredentialsPanel = dynamic(() =>
  import('./credentials-panel').then((m) => ({ default: m.CredentialsPanel })),
);
export const CurrencyPanel = dynamic(() =>
  import('./currency-panel').then((m) => ({ default: m.CurrencyPanel })),
);
export const DeliverabilityPanel = dynamic(() =>
  import('./deliverability-panel').then((m) => ({ default: m.DeliverabilityPanel })),
);
export const IntegrationsPanel = dynamic(() =>
  import('./integrations-panel').then((m) => ({ default: m.IntegrationsPanel })),
);
export const MembersPanel = dynamic(() =>
  import('./members-panel').then((m) => ({ default: m.MembersPanel })),
);
export const PasswordPolicyPanel = dynamic(() =>
  import('./password-policy-panel').then((m) => ({ default: m.PasswordPolicyPanel })),
);
export const ScimPanel = dynamic(() =>
  import('./scim-panel').then((m) => ({ default: m.ScimPanel })),
);
export const SecurityPanel = dynamic(() =>
  import('./security-panel').then((m) => ({ default: m.SecurityPanel })),
);
export const SsoPanel = dynamic(() => import('./sso-panel').then((m) => ({ default: m.SsoPanel })));
export const SupportPanel = dynamic(() =>
  import('./support-panel').then((m) => ({ default: m.SupportPanel })),
);
export const UpdatesPanel = dynamic(() =>
  import('./updates-panel').then((m) => ({ default: m.UpdatesPanel })),
);
export const WebhooksPanel = dynamic(() =>
  import('./webhooks-panel').then((m) => ({ default: m.WebhooksPanel })),
);
