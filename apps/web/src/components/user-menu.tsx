'use client';

import { Avatar, AvatarFallback } from '@helio/ui/components/avatar';
import { Button } from '@helio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { playSunset } from '@/components/sun-splash';
import { authClient, useSession } from '@/lib/auth-client';

export function UserMenu() {
  const t = useTranslations('userMenu');
  const router = useRouter();
  const { data: session } = useSession();
  if (!session) return null;

  const initials = (session.user.name || session.user.email)
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('open')}>
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="grid gap-0.5">
          <span>{session.user.name}</span>
          <span className="text-muted-foreground text-xs font-normal">{session.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            // The day ends before the session does: play the sunset, then
            // sign out under its final frame so the dashboard never flashes.
            await playSunset();
            await authClient.signOut();
            router.push('/login');
            router.refresh();
          }}
        >
          <LogOut aria-hidden /> {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
