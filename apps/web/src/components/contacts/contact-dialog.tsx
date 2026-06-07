'use client';

import { Button } from '@helio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useTRPC } from '@/trpc/client';

interface EditingContact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export function ContactDialog({
  workspaceId,
  open,
  onOpenChange,
  editing,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: EditingContact | null;
}) {
  const t = useTranslations('contacts');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // pathFilter matches both the plain and infinite list queries —
  // queryKey() would stamp `type: 'query'` and miss the infinite table.
  const invalidate = () => queryClient.invalidateQueries(trpc.contact.list.pathFilter());

  const create = useMutation(trpc.contact.create.mutationOptions());
  const update = useMutation(trpc.contact.update.mutationOptions());
  const pending = create.isPending || update.isPending;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = {
      firstName: String(form.get('firstName') ?? '').trim() || undefined,
      lastName: String(form.get('lastName') ?? '').trim() || undefined,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...fields });
      } else {
        await create.mutateAsync({
          workspaceId,
          email: String(form.get('email')),
          ...fields,
          attributes: {},
        });
      }
      await invalidate();
      toast.success(editing ? t('updated') : t('createdToast'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('dialogSubtitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="contact-email">{t('columns.email')}</Label>
            <Input
              id="contact-email"
              name="email"
              type="email"
              required
              defaultValue={editing?.email}
              disabled={!!editing}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="contact-first">{t('firstName')}</Label>
              <Input id="contact-first" name="firstName" defaultValue={editing?.firstName ?? ''} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-last">{t('lastName')}</Label>
              <Input id="contact-last" name="lastName" defaultValue={editing?.lastName ?? ''} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t('working') : editing ? t('saveAction') : t('createAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
