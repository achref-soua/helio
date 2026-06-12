'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { authClient } from '@/lib/auth-client';
import { useTRPC } from '@/trpc/client';

/**
 * Org-mandated two-factor (M2): members without 2FA are steered to the
 * Security panel until they enroll — navigation keeps landing there, and
 * a banner says why. Enrollment itself stays the user's action (an admin
 * cannot scan a QR code for someone else's phone).
 */
export function RequireTwoFactor() {
  const t = useTranslations('require2fa');
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const policy = useQuery(trpc.security.passwordPolicy.queryOptions());

  const mustEnroll =
    policy.data?.require2fa === true && session?.user && session.user.twoFactorEnabled !== true;

  useEffect(() => {
    if (mustEnroll && pathname !== '/settings') {
      router.replace('/settings');
    }
  }, [mustEnroll, pathname, router]);

  if (!mustEnroll) return null;
  return (
    <div
      className="bg-destructive text-destructive-foreground rounded-md p-3 text-sm"
      role="alert"
      data-testid="require-2fa-banner"
    >
      {t('banner')}
    </div>
  );
}
