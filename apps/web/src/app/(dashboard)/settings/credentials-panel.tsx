'use client';

import {
  type ConfigFieldSpec,
  type CredentialChannel,
  type CredentialKind,
  credentialKindsForChannel,
  credentialSpec,
  type MaskedCredential,
} from '@helio/core';
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
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@helio/ui/components/tooltip';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, KeyRound, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
import { useTRPC } from '@/trpc/client';

const CHANNELS: CredentialChannel[] = ['email', 'sms', 'whatsapp', 'ai', 'model', 'import'];

const STATUS_TONE = {
  VERIFIED: 'default',
  UNVERIFIED: 'outline',
  FAILED: 'destructive',
} as const;

/**
 * A field label with an optional info "i" — hover (or focus) it for a
 * one-line explanation of what the field wants. The hint text lives on the
 * credential spec in @helio/core, so it stays next to the schema it documents.
 */
function HintLabel({ htmlFor, label, hint }: { htmlFor?: string; label: string; hint?: string }) {
  if (!hint) return <Label htmlFor={htmlFor}>{label}</Label>;
  return (
    <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            className="text-muted-foreground hover:text-foreground inline-flex"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{hint}</TooltipContent>
      </Tooltip>
    </Label>
  );
}

function ConfigField({ field, defaultValue }: { field: ConfigFieldSpec; defaultValue?: unknown }) {
  const id = `cred-${field.name}`;
  if (field.type === 'select') {
    return (
      <div className="grid gap-1.5">
        <HintLabel htmlFor={id} label={field.label} hint={field.hint} />
        <ThemedSelect
          id={id}
          name={`config.${field.name}`}
          defaultValue={typeof defaultValue === 'string' ? defaultValue : field.options?.[0]}
          options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
        />
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-1.5 text-sm">
        <label className="flex items-center gap-2" htmlFor={id}>
          <input
            id={id}
            name={`config.${field.name}`}
            type="checkbox"
            defaultChecked={Boolean(defaultValue)}
            className="accent-primary size-4"
          />
          {field.label}
        </label>
        {field.hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${field.label}`}
                className="text-muted-foreground hover:text-foreground inline-flex"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
              {field.hint}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <HintLabel htmlFor={id} label={field.label} hint={field.hint} />
      <Input
        id={id}
        name={`config.${field.name}`}
        type={field.type === 'number' ? 'number' : 'text'}
        step={field.type === 'number' ? 'any' : undefined}
        placeholder={field.placeholder}
        required={field.required}
        defaultValue={defaultValue == null ? '' : String(defaultValue)}
      />
    </div>
  );
}

function buildPayload(kind: CredentialKind, form: FormData) {
  const spec = credentialSpec(kind);
  const config: Record<string, unknown> = {};
  for (const field of spec.configFields) {
    if (field.type === 'checkbox') {
      config[field.name] = form.get(`config.${field.name}`) === 'on';
      continue;
    }
    const raw = String(form.get(`config.${field.name}`) ?? '').trim();
    if (!raw) continue;
    config[field.name] = field.type === 'number' ? Number(raw) : raw;
  }
  const secrets: Record<string, string> = {};
  for (const field of spec.secretFields) {
    const raw = String(form.get(`secret.${field.name}`) ?? '').trim();
    if (raw) secrets[field.name] = raw;
  }
  return { config, secrets };
}

export function CredentialsPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('credentials');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MaskedCredential | null>(null);
  const [kind, setKind] = useState<CredentialKind>('EMAIL_SMTP');

  const list = useQuery({ ...trpc.credentials.list.queryOptions(), enabled: canManage });
  const save = useMutation(trpc.credentials.save.mutationOptions());
  const verify = useMutation(trpc.credentials.verify.mutationOptions());
  const remove = useMutation(trpc.credentials.remove.mutationOptions());
  const sendTest = useMutation(trpc.credentials.sendTest.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries(trpc.credentials.list.pathFilter());
  const credentials = list.data?.credentials ?? [];
  const activeKind = editing ? editing.kind : kind;
  const spec = credentialSpec(activeKind);

  function openAdd(forKind: CredentialKind) {
    setEditing(null);
    setKind(forKind);
    setDialogOpen(true);
  }

  function openEdit(credential: MaskedCredential) {
    setEditing(credential);
    setDialogOpen(true);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { config, secrets } = buildPayload(activeKind, form);
    try {
      await save.mutateAsync({
        id: editing?.id,
        kind: activeKind,
        name: String(form.get('name') ?? '').trim(),
        config,
        secrets,
      });
      await invalidate();
      toast.success(t('saved'));
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onVerify(id: string) {
    try {
      const result = await verify.mutateAsync({ id });
      await invalidate();
      if (result.status === 'VERIFIED') toast.success(t('verified'));
      else toast.error(result.lastError ?? t('verifyFailed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('verifyFailed'));
    }
  }

  async function onSendTest(credential: MaskedCredential) {
    try {
      const result = await sendTest.mutateAsync({ id: credential.id });
      if (result.ok) toast.success(t('testSent', { to: result.to }));
      else toast.error(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onRemove(credential: MaskedCredential) {
    if (!window.confirm(t('confirmDelete', { name: credential.name }))) return;
    try {
      await remove.mutateAsync({ id: credential.id });
      await invalidate();
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!canManage) return null;

  return (
    <Card data-testid="credentials-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {list.data && !list.data.encryptionReady ? (
          <p className="text-destructive text-sm">{t('encryptionMissing')}</p>
        ) : null}
        {CHANNELS.map((channel) => {
          const kinds = credentialKindsForChannel(channel);
          const kindSet = new Set(kinds.map((entry) => entry.kind));
          const rows = credentials.filter((credential) => kindSet.has(credential.kind));
          return (
            <section key={channel} className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t(`channels.${channel}`)}</h3>
                <ThemedSelect
                  size="sm"
                  aria-label={t('addFor', { channel: t(`channels.${channel}`) })}
                  placeholder={t('add')}
                  value=""
                  onValueChange={(value) => openAdd(value as CredentialKind)}
                  options={kinds.map((entry) => ({ value: entry.kind, label: entry.label }))}
                />
              </div>
              {rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {channel === 'email' ? t('emailFallbackNotice') : t('emptyChannel')}
                </p>
              ) : (
                <ul className="grid gap-2">
                  {rows.map((credential) => (
                    <li
                      key={credential.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{credential.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {credentialSpec(credential.kind).label}
                          </span>
                          <Badge variant={STATUS_TONE[credential.status]}>
                            {t(`status.${credential.status}`)}
                          </Badge>
                        </div>
                        <div className="text-muted-foreground truncate font-mono text-xs">
                          {Object.values(credential.secretPreviews).join('  ')}
                        </div>
                        {credential.status === 'FAILED' && credential.lastError ? (
                          <p className="text-destructive text-xs">{credential.lastError}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onVerify(credential.id)}
                          disabled={verify.isPending}
                        >
                          <ShieldCheck aria-hidden />
                          {t('verify')}
                        </Button>
                        {credential.kind.startsWith('EMAIL_') ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSendTest(credential)}
                            disabled={sendTest.isPending}
                          >
                            <Send aria-hidden />
                            {t('testSend')}
                          </Button>
                        ) : null}
                        <Button variant="outline" size="sm" onClick={() => openEdit(credential)}>
                          {t('edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('deleteAria', { name: credential.name })}
                          onClick={() => onRemove(credential)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('editTitle', { name: editing.name }) : t('addTitle')}
            </DialogTitle>
            <DialogDescription>
              {editing ? spec.label : t('addSubtitle', { kind: spec.label })}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="cred-name">{t('name')}</Label>
              <Input
                id="cred-name"
                name="name"
                required
                placeholder={t('namePlaceholder')}
                defaultValue={editing?.name ?? ''}
              />
            </div>
            {spec.configFields.map((field) => (
              <ConfigField
                key={`${activeKind}-${field.name}`}
                field={field}
                defaultValue={editing?.config[field.name]}
              />
            ))}
            {spec.secretFields.map((field) => (
              <div key={`${activeKind}-${field.name}`} className="grid gap-1.5">
                <HintLabel
                  htmlFor={`cred-secret-${field.name}`}
                  label={field.label}
                  hint={field.hint}
                />
                <Input
                  id={`cred-secret-${field.name}`}
                  name={`secret.${field.name}`}
                  type="password"
                  autoComplete="off"
                  required={!editing && !field.optional}
                  placeholder={
                    editing?.secretPreviews[field.name]
                      ? t('secretKeep', { mask: editing.secretPreviews[field.name]! })
                      : undefined
                  }
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
