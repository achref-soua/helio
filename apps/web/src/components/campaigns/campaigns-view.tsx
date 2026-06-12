'use client';

import type { EmailDocument } from '@helio/core';
import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ThemedSelect } from '@/components/themed-select';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

const STATUS_VARIANT = {
  DRAFT: 'outline',
  SENDING: 'secondary',
  SENT: 'secondary',
  FAILED: 'destructive',
} as const;

export function CampaignsView() {
  const t = useTranslations('campaigns');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [audience, setAudience] = useState(''); // "segment:<id>" | "list:<id>"
  const [subjectB, setSubjectB] = useState('');
  const [autoWinner, setAutoWinner] = useState(false);

  const engagementQuery = useQuery({
    ...trpc.analytics.campaignEngagement.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
  const campaignsQuery = useQuery({
    ...trpc.campaign.list.queryOptions(
      { workspaceId: workspaceId ?? '' },
      {
        refetchInterval: (query) =>
          query.state.data?.some((campaign) => campaign.status === 'SENDING') ? 2000 : false,
      },
    ),
    enabled: !!workspaceId,
  });
  const templatesQuery = useQuery({
    ...trpc.emailTemplate.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId && createOpen,
  });
  const segmentsQuery = useQuery({
    ...trpc.segment.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId && createOpen,
  });
  const listsQuery = useQuery({
    ...trpc.contactList.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId && createOpen,
  });

  const createCampaign = useMutation(trpc.campaign.create.mutationOptions());
  const sendCampaign = useMutation(trpc.campaign.send.mutationOptions());
  const deleteCampaign = useMutation(trpc.campaign.delete.mutationOptions());
  const invalidate = () => queryClient.invalidateQueries(trpc.campaign.list.pathFilter());

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !templateId || !audience) return;
    const [kind, id] = audience.split(':', 2);
    try {
      await createCampaign.mutateAsync({
        workspaceId,
        name: name.trim(),
        templateId,
        subjectB: subjectB.trim() || undefined,
        abAutoWinner: autoWinner && subjectB.trim() ? true : undefined,
        segmentId: kind === 'segment' ? id : undefined,
        listId: kind === 'list' ? id : undefined,
      });
      await invalidate();
      toast.success(t('created'));
      setCreateOpen(false);
      setName('');
      setTemplateId('');
      setAudience('');
      setSubjectB('');
      setAutoWinner(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onSend(id: string) {
    try {
      await sendCampaign.mutateAsync({ id });
      await invalidate();
      toast.success(t('sendStarted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteCampaign.mutateAsync({ id });
      await invalidate();
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="campaigns-loading" />;
  }

  const campaigns = campaignsQuery.data ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline">{t('total', { count: campaigns.length })}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> {t('newCampaign')}
          </Button>
        </div>
      </div>

      {createOpen && (
        <Card data-testid="campaign-create">
          <CardHeader>
            <CardTitle>{t('createTitle')}</CardTitle>
            <CardDescription>{t('createSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="grid max-w-2xl gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="campaign-name">{t('name')}</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="campaign-template">{t('template')}</Label>
                <ThemedSelect
                  id="campaign-template"
                  value={templateId || undefined}
                  onValueChange={setTemplateId}
                  required
                  className="w-full"
                  placeholder={t('pickTemplate')}
                  options={(templatesQuery.data ?? []).map((template) => ({
                    value: template.id,
                    label: template.name,
                  }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="campaign-audience">{t('audience')}</Label>
                <ThemedSelect
                  id="campaign-audience"
                  value={audience || undefined}
                  onValueChange={setAudience}
                  required
                  className="w-full"
                  placeholder={t('pickAudience')}
                  options={[
                    ...(segmentsQuery.data ?? []).map((segment) => ({
                      value: `segment:${segment.id}`,
                      label: t('segmentPrefix', { name: segment.name }),
                    })),
                    ...(listsQuery.data ?? []).map((list) => ({
                      value: `list:${list.id}`,
                      label: t('listPrefix', { name: list.name }),
                    })),
                  ]}
                />
              </div>
              <div className="grid gap-2 sm:col-span-3">
                <Label htmlFor="campaign-subject-b">{t('subjectB')}</Label>
                <Input
                  id="campaign-subject-b"
                  value={subjectB}
                  onChange={(event) => setSubjectB(event.target.value)}
                  placeholder={t('subjectBPlaceholder')}
                  maxLength={300}
                />
                {subjectB.trim() && (
                  <label className="text-muted-foreground flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={autoWinner}
                      onChange={(event) => setAutoWinner(event.target.checked)}
                      data-testid="campaign-auto-winner"
                    />
                    {t('autoWinner')}
                  </label>
                )}
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit" disabled={createCampaign.isPending}>
                  {t('createAction')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
            {templateId && <CampaignEmailPreview templateId={templateId} />}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {campaignsQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : campaigns.length === 0 && !createOpen ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-base font-medium">{t('emptyTitle')}</CardTitle>
              <CardDescription>{t('emptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          campaigns.map((campaign) => (
            <Card key={campaign.id} data-testid="campaign-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{campaign.name}</CardTitle>
                  <span className="flex gap-1">
                    {campaign.subjectB && <Badge variant="outline">{t('abBadge')}</Badge>}
                    {campaign.abAutoWinner && !campaign.abWinner && (
                      <Badge variant="outline">{t('autoWinnerBadge')}</Badge>
                    )}
                    {campaign.abWinner && (
                      <Badge variant="secondary">
                        {t('winnerBadge', { variant: campaign.abWinner.toUpperCase() })}
                      </Badge>
                    )}
                    <Badge variant={STATUS_VARIANT[campaign.status]}>
                      {t(`status.${campaign.status}`)}
                    </Badge>
                  </span>
                </div>
                <CardDescription className="flex items-center gap-1">
                  <Megaphone className="size-3.5" aria-hidden />
                  {campaign.template.name} →{' '}
                  {campaign.segment
                    ? t('segmentPrefix', { name: campaign.segment.name })
                    : t('listPrefix', { name: campaign.list?.name ?? '' })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                {campaign.status !== 'DRAFT' && (
                  <span className="text-muted-foreground" data-testid="send-counts">
                    {t('counts', {
                      sent: campaign.sendCounts.SENT ?? 0,
                      failed: campaign.sendCounts.FAILED ?? 0,
                    })}
                    {engagementQuery.data?.byCampaign[campaign.id] &&
                      ` · ${t('engagement', {
                        opens: engagementQuery.data.byCampaign[campaign.id]!.uniqueOpens,
                        clicks: engagementQuery.data.byCampaign[campaign.id]!.clicks,
                      })}`}
                    {campaign.subjectB &&
                      engagementQuery.data?.byCampaign[campaign.id]?.variants &&
                      Object.keys(engagementQuery.data.byCampaign[campaign.id]!.variants).length >
                        0 &&
                      ` · ${t('variantSplit', {
                        a:
                          engagementQuery.data.byCampaign[campaign.id]!.variants.a?.uniqueOpens ??
                          0,
                        b:
                          engagementQuery.data.byCampaign[campaign.id]!.variants.b?.uniqueOpens ??
                          0,
                      })}`}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {(campaign.status === 'DRAFT' || campaign.status === 'FAILED') && (
                    <Button
                      size="sm"
                      onClick={() => onSend(campaign.id)}
                      disabled={sendCampaign.isPending}
                      aria-label={t('sendAction', { name: campaign.name })}
                    >
                      <Send aria-hidden /> {t('send')}
                    </Button>
                  )}
                  {campaign.status === 'DRAFT' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('deleteAction', { name: campaign.name })}
                      onClick={() => onDelete(campaign.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

/** The selected template, rendered by the real send-path renderer. */
function CampaignEmailPreview({ templateId }: { templateId: string }) {
  const t = useTranslations('campaigns');
  const trpc = useTRPC();
  const template = useQuery(trpc.emailTemplate.get.queryOptions({ id: templateId }));
  const document = template.data?.document as unknown as EmailDocument;
  const preview = useQuery({
    ...trpc.emailTemplate.preview.queryOptions(
      { subject: template.data?.subject ?? '', document },
      { placeholderData: (previous) => previous },
    ),
    enabled: Boolean(template.data),
  });
  if (!template.data) return null;
  return (
    <div className="mt-4 grid max-w-2xl gap-2" data-testid="campaign-preview">
      <Label>{t('preview')}</Label>
      <iframe
        title={t('preview')}
        sandbox=""
        srcDoc={preview.data?.html ?? ''}
        className="h-80 w-full rounded-md border bg-white"
      />
    </div>
  );
}
