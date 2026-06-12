'use client';

import { Button } from '@helio/ui/components/button';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { authClient, useSession } from '@/lib/auth-client';

interface SessionRow {
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
}

/**
 * Active sessions (M1): see every signed-in device, sign any of them
 * out — or everything except this one. Plain auth-kernel calls; the
 * tokens never render, only metadata.
 */
export function SessionsList() {
  const t = useTranslations('sessions');
  const { data: current } = useSession();
  const [rows, setRows] = useState<SessionRow[] | null>(null);

  const load = useCallback(async () => {
    const result = await authClient.listSessions().catch(() => null);
    setRows((result?.data as SessionRow[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load]);

  async function revoke(token: string) {
    try {
      await authClient.revokeSession({ token });
      await load();
      toast.success(t('revoked'));
    } catch {
      toast.error(t('failed'));
    }
  }

  async function revokeOthers() {
    try {
      await authClient.revokeOtherSessions();
      await load();
      toast.success(t('revokedOthers'));
    } catch {
      toast.error(t('failed'));
    }
  }

  if (rows === null) return null;
  return (
    <div className="grid min-w-0 gap-2 border-t pt-3" data-testid="sessions-list">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('title')}</p>
        {rows.length > 1 && (
          <Button variant="outline" size="sm" onClick={revokeOthers}>
            {t('revokeOthers')}
          </Button>
        )}
      </div>
      <ul className="grid min-w-0 gap-1.5">
        {rows.map((row) => {
          const isCurrent = row.token === current?.session.token;
          return (
            <li
              key={row.token}
              className="flex min-w-0 items-center justify-between gap-3 text-sm"
              data-testid="session-row"
            >
              <span className="text-muted-foreground min-w-0 truncate">
                {row.userAgent?.slice(0, 60) || t('unknownDevice')}
                {row.ipAddress ? ` · ${row.ipAddress}` : ''}
                {isCurrent && <span className="text-foreground"> · {t('thisDevice')}</span>}
              </span>
              {!isCurrent && (
                <Button variant="ghost" size="sm" onClick={() => revoke(row.token)}>
                  {t('revoke')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
