'use client';

import type { EmailDocument, JourneyDefinition, SegmentRule } from '@helio/core';
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
import { Skeleton } from '@helio/ui/components/skeleton';
import { cn } from '@helio/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Mail, Route, Send, Sparkles, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTION_KEYS = ['contacts', 'journeys', 'engagement'] as const;

/** The copilot's mark: a gold-lit avatar chip. */
function CopilotMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'bg-primary/12 text-primary ring-primary/20 inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-1',
        className,
      )}
      aria-hidden
    >
      <Bot className="size-4" />
    </span>
  );
}

function ProviderChip() {
  const t = useTranslations('copilot');
  const trpc = useTRPC();
  const providerInfo = useQuery(trpc.copilot.providerInfo.queryOptions());
  if (!providerInfo.data) return null;
  // An unconfigured deployment must never advertise the env defaults as a
  // working model — point at Settings instead.
  if (!providerInfo.data.configured) {
    return (
      <Badge variant="outline" data-testid="copilot-provider" asChild>
        <Link href="/settings">
          {t('providerNotConfigured')} · {t('providerConnectCta')}
        </Link>
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid="copilot-provider">
      {t(
        providerInfo.data.source === 'organization' ? 'providerOrganization' : 'providerDeployment',
        { provider: providerInfo.data.provider, model: providerInfo.data.model },
      )}
    </Badge>
  );
}

export function CopilotView() {
  const t = useTranslations('copilot');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [segmentPrompt, setSegmentPrompt] = useState('');
  const [journeyPrompt, setJourneyPrompt] = useState('');
  const [emailPrompt, setEmailPrompt] = useState('');
  const [segmentDraft, setSegmentDraft] = useState<{ name: string; rule: SegmentRule } | null>(
    null,
  );
  const [journeyDraft, setJourneyDraft] = useState<{
    name: string;
    definition: JourneyDefinition;
  } | null>(null);
  const [emailDraft, setEmailDraft] = useState<{
    name: string;
    subject: string;
    document: EmailDocument;
  } | null>(null);

  const chat = useMutation(trpc.copilot.chat.mutationOptions());
  const draftSegment = useMutation(trpc.copilot.draftSegment.mutationOptions());
  const draftJourney = useMutation(trpc.copilot.draftJourney.mutationOptions());
  const draftEmail = useMutation(trpc.copilot.draftEmail.mutationOptions());
  const createSegment = useMutation(trpc.segment.create.mutationOptions());
  const createJourney = useMutation(trpc.journey.create.mutationOptions());
  const createEmail = useMutation(trpc.emailTemplate.create.mutationOptions());

  async function onSend(text?: string) {
    const content = (text ?? draft).trim();
    if (!workspaceId || !content) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setDraft('');
    try {
      const reply = await chat.mutateAsync({ workspaceId, messages: next });
      setTurns([...next, { role: 'assistant', content: reply.text }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
      setTurns(next); // keep the user's message; let them retry
    }
  }

  async function onDraftSegment() {
    if (!workspaceId || !segmentPrompt.trim()) return;
    try {
      const result = await draftSegment.mutateAsync({ workspaceId, prompt: segmentPrompt.trim() });
      setSegmentDraft(result as { name: string; rule: SegmentRule });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    }
  }

  async function onCreateSegment() {
    if (!workspaceId || !segmentDraft) return;
    try {
      await createSegment.mutateAsync({
        workspaceId,
        name: segmentDraft.name,
        rule: segmentDraft.rule,
      });
      await queryClient.invalidateQueries(trpc.segment.list.pathFilter());
      toast.success(t('segmentCreated'));
      setSegmentDraft(null);
      setSegmentPrompt('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    }
  }

  async function onDraftJourney() {
    if (!workspaceId || !journeyPrompt.trim()) return;
    try {
      const result = await draftJourney.mutateAsync({ workspaceId, prompt: journeyPrompt.trim() });
      setJourneyDraft(result as { name: string; definition: JourneyDefinition });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    }
  }

  async function onCreateJourney() {
    if (!workspaceId || !journeyDraft) return;
    try {
      await createJourney.mutateAsync({
        workspaceId,
        name: journeyDraft.name,
        definition: journeyDraft.definition,
      });
      await queryClient.invalidateQueries(trpc.journey.list.pathFilter());
      toast.success(t('journeyCreated'));
      setJourneyDraft(null);
      setJourneyPrompt('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    }
  }

  async function onDraftEmail() {
    if (!workspaceId || !emailPrompt.trim()) return;
    try {
      const result = await draftEmail.mutateAsync({ workspaceId, prompt: emailPrompt.trim() });
      setEmailDraft(result as { name: string; subject: string; document: EmailDocument });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    }
  }

  async function onCreateEmail() {
    if (!workspaceId || !emailDraft) return;
    try {
      await createEmail.mutateAsync({
        workspaceId,
        name: emailDraft.name,
        subject: emailDraft.subject,
        document: emailDraft.document,
      });
      await queryClient.invalidateQueries(trpc.emailTemplate.list.pathFilter());
      toast.success(t('emailCreated'));
      setEmailDraft(null);
      setEmailPrompt('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    }
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="copilot-loading" />;
  }

  return (
    <div className="bg-radiant -m-6 grid gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="font-display flex items-center gap-2.5 text-3xl font-semibold tracking-tight">
            <span className="relative inline-flex" aria-hidden>
              <Sparkles className="text-primary size-6" />
              <span className="bg-primary/25 absolute inset-0 -z-10 rounded-full blur-md" />
            </span>
            {t('title')}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">{t('subtitle')}</p>
        </div>
        <ProviderChip />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" data-testid="copilot-chat">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CopilotMark />
              {t('chatTitle')}
            </CardTitle>
            <CardDescription>{t('chatSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid flex-1 content-between gap-4">
            <div className="grid max-h-[460px] min-h-64 content-start gap-3 overflow-y-auto">
              {turns.length === 0 ? (
                <div className="grid justify-items-center gap-3 py-10 text-center">
                  <p className="text-muted-foreground text-sm">{t('chatEmpty')}</p>
                  <p className="text-muted-foreground/70 text-[11px] font-medium tracking-wider uppercase">
                    {t('suggestionsLabel')}
                  </p>
                  <div className="flex max-w-md flex-wrap justify-center gap-2">
                    {SUGGESTION_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void onSend(t(`suggestions.${key}`))}
                        className="border-primary/25 text-foreground/80 hover:border-primary/50 hover:bg-primary/8 rounded-full border px-3 py-1.5 text-xs transition-colors"
                      >
                        {t(`suggestions.${key}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((turn, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex items-start gap-2.5 text-sm',
                      turn.role === 'user' && 'flex-row-reverse',
                    )}
                    data-testid={`turn-${turn.role}`}
                  >
                    {turn.role === 'assistant' && <CopilotMark className="mt-0.5" />}
                    <span
                      className={cn(
                        'max-w-[85%] rounded-2xl px-3.5 py-2 whitespace-pre-wrap',
                        turn.role === 'user'
                          ? 'bg-primary/12 rounded-tr-sm'
                          : 'bg-muted/60 rounded-tl-sm border',
                      )}
                    >
                      {turn.content}
                    </span>
                  </div>
                ))
              )}
              {chat.isPending && (
                <div className="text-muted-foreground flex items-center gap-2.5 text-sm">
                  <CopilotMark className="animate-pulse" /> {t('thinking')}
                </div>
              )}
            </div>
            <form
              className="bg-background/60 flex items-center gap-2 rounded-xl border p-1.5 pl-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onSend();
              }}
            >
              <Input
                aria-label={t('chatPlaceholder')}
                placeholder={t('chatPlaceholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="h-8 border-0 bg-transparent! p-0 shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                size="icon-sm"
                aria-label={t('send')}
                disabled={chat.isPending || !draft.trim()}
              >
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4 lg:col-span-2">
          <Card data-testid="copilot-segment">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
                  <Route className="size-3.5" aria-hidden />
                </span>
                {t('segmentTitle')}
              </CardTitle>
              <CardDescription>{t('segmentSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <div className="flex gap-2">
                <Input
                  aria-label={t('segmentPlaceholder')}
                  placeholder={t('segmentPlaceholder')}
                  value={segmentPrompt}
                  onChange={(event) => setSegmentPrompt(event.target.value)}
                />
                <Button
                  onClick={onDraftSegment}
                  disabled={draftSegment.isPending || !segmentPrompt.trim()}
                >
                  <Sparkles aria-hidden /> {t('draft')}
                </Button>
              </div>
              {segmentDraft && (
                <div
                  className="bg-muted/40 grid gap-2 rounded-lg border p-3"
                  data-testid="segment-draft"
                >
                  <Input
                    aria-label={t('draftNameLabel')}
                    className="h-8 max-w-60 text-sm font-medium"
                    value={segmentDraft.name}
                    maxLength={120}
                    onChange={(event) =>
                      setSegmentDraft((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                  />
                  <pre className="text-muted-foreground max-h-40 overflow-auto text-xs">
                    {JSON.stringify(segmentDraft.rule, null, 2)}
                  </pre>
                  <Button size="sm" onClick={onCreateSegment} disabled={createSegment.isPending}>
                    {t('createSegment')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="copilot-journey">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
                  <Workflow className="size-3.5" aria-hidden />
                </span>
                {t('journeyTitle')}
              </CardTitle>
              <CardDescription>{t('journeySubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <div className="flex gap-2">
                <Input
                  aria-label={t('journeyPlaceholder')}
                  placeholder={t('journeyPlaceholder')}
                  value={journeyPrompt}
                  onChange={(event) => setJourneyPrompt(event.target.value)}
                />
                <Button
                  onClick={onDraftJourney}
                  disabled={draftJourney.isPending || !journeyPrompt.trim()}
                >
                  <Sparkles aria-hidden /> {t('draft')}
                </Button>
              </div>
              {journeyDraft && (
                <div
                  className="bg-muted/40 grid gap-2 rounded-lg border p-3"
                  data-testid="journey-draft"
                >
                  <span className="flex items-center gap-1 text-sm font-medium">
                    <Workflow className="size-3.5" aria-hidden />
                    <Input
                      aria-label={t('draftNameLabel')}
                      className="h-8 max-w-60 text-sm font-medium"
                      value={journeyDraft.name}
                      maxLength={120}
                      onChange={(event) =>
                        setJourneyDraft((current) =>
                          current ? { ...current, name: event.target.value } : current,
                        )
                      }
                    />
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('journeySteps', { count: journeyDraft.definition.nodes.length })}
                  </span>
                  <Button size="sm" onClick={onCreateJourney} disabled={createJourney.isPending}>
                    {t('createJourney')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="copilot-email">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="bg-primary/12 text-primary inline-flex size-7 items-center justify-center rounded-md">
                  <Mail className="size-3.5" aria-hidden />
                </span>
                {t('emailTitle')}
              </CardTitle>
              <CardDescription>{t('emailSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <div className="flex gap-2">
                <Input
                  aria-label={t('emailPlaceholder')}
                  placeholder={t('emailPlaceholder')}
                  value={emailPrompt}
                  onChange={(event) => setEmailPrompt(event.target.value)}
                />
                <Button
                  onClick={onDraftEmail}
                  disabled={draftEmail.isPending || !emailPrompt.trim()}
                >
                  <Sparkles aria-hidden /> {t('draft')}
                </Button>
              </div>
              {emailDraft && (
                <div
                  className="bg-muted/40 grid gap-2 rounded-lg border p-3"
                  data-testid="email-draft"
                >
                  <span className="flex items-center gap-1 text-sm font-medium">
                    <Mail className="size-3.5" aria-hidden />
                    <Input
                      aria-label={t('draftNameLabel')}
                      className="h-8 max-w-60 text-sm font-medium"
                      value={emailDraft.name}
                      maxLength={120}
                      onChange={(event) =>
                        setEmailDraft((current) =>
                          current ? { ...current, name: event.target.value } : current,
                        )
                      }
                    />
                  </span>
                  <span className="text-muted-foreground text-xs">{emailDraft.subject}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('emailBlocks', { count: emailDraft.document.blocks.length })}
                  </span>
                  <Button size="sm" onClick={onCreateEmail} disabled={createEmail.isPending}>
                    {t('createEmail')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
