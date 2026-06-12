'use client';

import { INVITABLE_ROLES } from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@helio/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helio/ui/components/table';
import { ChevronDown, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';

interface MemberRow {
  id: string;
  role: string;
  name: string;
  email: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
}

export function MembersPanel({
  members,
  invitations,
  canManage,
}: {
  members: MemberRow[];
  invitations: InvitationRow[];
  canManage: boolean;
}) {
  const t = useTranslations('members');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>('editor');
  const [pending, setPending] = useState(false);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    const { error } = await authClient.organization.inviteMember({
      email: String(form.get('email')),
      role: role as 'admin' | 'editor' | 'viewer',
    });
    setPending(false);
    if (error) {
      toast.error(error.message ?? t('genericError'));
      return;
    }
    toast.success(t('inviteSent'));
    setOpen(false);
    router.refresh();
  }

  async function cancelInvitation(invitationId: string) {
    const { error } = await authClient.organization.cancelInvitation({ invitationId });
    if (error) {
      toast.error(error.message ?? t('genericError'));
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="grid gap-1.5">
            <CardTitle>{t('membersTitle')}</CardTitle>
            <CardDescription>{t('membersSubtitle')}</CardDescription>
          </div>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <UserPlus aria-hidden /> {t('inviteAction')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('inviteTitle')}</DialogTitle>
                  <DialogDescription>{t('inviteSubtitle')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={invite} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="invite-email">{t('email')}</Label>
                    <Input id="invite-email" name="email" type="email" required />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('role')}</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" className="justify-between">
                          {t(`roles.${role}`)}
                          <ChevronDown aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {INVITABLE_ROLES.map((value) => (
                          <DropdownMenuItem key={value} onClick={() => setRole(value)}>
                            {t(`roles.${value}`)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={pending}>
                      {pending ? t('working') : t('inviteSend')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.member')}</TableHead>
                <TableHead>{t('columns.email')}</TableHead>
                <TableHead>{t('columns.role')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`roles.${member.role}`)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('pendingTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`roles.${invitation.role}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancelInvitation(invitation.id)}
                        >
                          {t('revoke')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
