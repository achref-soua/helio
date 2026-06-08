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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Mail, Send, Sparkles, User, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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

  async function onSend() {
    if (!workspaceId || !draft.trim()) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: draft.trim() }];
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
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-primary size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline">{t('beta')}</Badge>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:row-span-2" data-testid="copilot-chat">
          <CardHeader>
            <CardTitle className="text-base">{t('chatTitle')}</CardTitle>
            <CardDescription>{t('chatSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid max-h-[420px] gap-3 overflow-y-auto">
              {turns.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">{t('chatEmpty')}</p>
              ) : (
                turns.map((turn, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 text-sm"
                    data-testid={`turn-${turn.role}`}
                  >
                    {turn.role === 'user' ? (
                      <User className="mt-0.5 size-4 shrink-0" aria-hidden />
                    ) : (
                      <Bot className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    )}
                    <span className="whitespace-pre-wrap">{turn.content}</span>
                  </div>
                ))
              )}
              {chat.isPending && (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Bot className="size-4 animate-pulse" aria-hidden /> {t('thinking')}
                </div>
              )}
            </div>
            <form
              className="flex gap-2"
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
              />
              <Button
                type="submit"
                size="icon"
                aria-label={t('send')}
                disabled={chat.isPending || !draft.trim()}
              >
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card data-testid="copilot-segment">
          <CardHeader>
            <CardTitle className="text-base">{t('segmentTitle')}</CardTitle>
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
                className="bg-muted/40 grid gap-2 rounded-md border p-3"
                data-testid="segment-draft"
              >
                <span className="text-sm font-medium">{segmentDraft.name}</span>
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
            <CardTitle className="text-base">{t('journeyTitle')}</CardTitle>
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
                className="bg-muted/40 grid gap-2 rounded-md border p-3"
                data-testid="journey-draft"
              >
                <span className="flex items-center gap-1 text-sm font-medium">
                  <Workflow className="size-3.5" aria-hidden /> {journeyDraft.name}
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
            <CardTitle className="text-base">{t('emailTitle')}</CardTitle>
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
              <Button onClick={onDraftEmail} disabled={draftEmail.isPending || !emailPrompt.trim()}>
                <Sparkles aria-hidden /> {t('draft')}
              </Button>
            </div>
            {emailDraft && (
              <div
                className="bg-muted/40 grid gap-2 rounded-md border p-3"
                data-testid="email-draft"
              >
                <span className="flex items-center gap-1 text-sm font-medium">
                  <Mail className="size-3.5" aria-hidden /> {emailDraft.name}
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
  );
}
