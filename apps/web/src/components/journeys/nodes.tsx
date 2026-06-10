'use client';

import { Input } from '@helio/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import { Handle, type NodeProps, Position, useReactFlow } from '@xyflow/react';
import {
  AppWindow,
  Bell,
  GitBranch,
  Mail,
  MessageCircle,
  MessageSquare,
  Percent,
  Play,
  Square,
  Tag,
  Timer,
  Webhook,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ThemedSelect } from '@/components/themed-select';
import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

import type {
  AbSplitData,
  BranchData,
  SendEmailData,
  SendInAppData,
  SendPushData,
  SendSmsData,
  SendWhatsappData,
  TriggerData,
  UpdateTraitData,
  WaitData,
  WebhookData,
} from './graph';

function shell(selected: boolean | undefined): string {
  return `bg-card w-60 rounded-md border p-3 text-sm shadow-sm ${selected ? 'ring-ring ring-2' : ''}`;
}

function Header({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium uppercase">
      <Icon className="size-3.5" aria-hidden /> {label}
    </div>
  );
}

export function TriggerNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const trigger = data as TriggerData;
  return (
    <div className={shell(selected)} data-testid="node-trigger">
      <Header icon={Play} label={t('trigger')} />
      <Input
        aria-label={t('triggerEvent')}
        placeholder={t('triggerEventPlaceholder')}
        value={trigger.event}
        onChange={(event) => updateNodeData(id, { event: event.target.value })}
        className="nodrag h-8"
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function SendEmailNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const trpc = useTRPC();
  const workspaceId = useActiveWorkspaceId();
  const { updateNodeData } = useReactFlow();
  const send = data as SendEmailData;
  const templates = useQuery({
    ...trpc.emailTemplate.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  return (
    <div className={shell(selected)} data-testid="node-send">
      <Header icon={Mail} label={t('sendEmail')} />
      <ThemedSelect
        aria-label={t('template')}
        value={send.templateId || undefined}
        onValueChange={(templateId) => updateNodeData(id, { templateId })}
        className="nodrag w-full"
        size="sm"
        placeholder={t('pickTemplate')}
        options={(templates.data ?? []).map((template) => ({
          value: template.id,
          label: template.name,
        }))}
      />
      <label className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="nodrag"
          checked={send.optimizeSendTime ?? false}
          onChange={(event) => updateNodeData(id, { optimizeSendTime: event.target.checked })}
        />
        {t('optimizeSendTime')}
      </label>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function WaitNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const wait = data as WaitData;
  return (
    <div className={shell(selected)} data-testid="node-wait">
      <Header icon={Timer} label={t('wait')} />
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('waitHours')}
          type="number"
          min={0.01}
          step="any"
          value={wait.hours}
          onChange={(event) => updateNodeData(id, { hours: event.target.value })}
          className="nodrag h-8 w-24"
        />
        <span className="text-muted-foreground text-xs">{t('hours')}</span>
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function BranchNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const branch = data as BranchData;
  return (
    <div className={shell(selected)} data-testid="node-branch">
      <Header icon={GitBranch} label={t('branch')} />
      <div className="grid gap-1.5">
        <Input
          aria-label={t('branchAttribute')}
          placeholder={t('branchAttributePlaceholder')}
          value={branch.attributeKey}
          onChange={(event) => updateNodeData(id, { attributeKey: event.target.value })}
          className="nodrag h-8"
        />
        <div className="flex gap-1.5">
          <ThemedSelect
            aria-label={t('branchOperator')}
            value={branch.operator}
            onValueChange={(operator) => updateNodeData(id, { operator })}
            className="nodrag w-28"
            size="sm"
            options={[
              { value: 'equals', label: t('equals') },
              { value: 'not_equals', label: t('notEquals') },
            ]}
          />
          <Input
            aria-label={t('branchValue')}
            placeholder={t('branchValuePlaceholder')}
            value={branch.value}
            onChange={(event) => updateNodeData(id, { value: event.target.value })}
            className="nodrag h-8"
          />
        </div>
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between text-[10px] uppercase">
        <span>{t('yes')}</span>
        <span>{t('no')}</span>
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '25%' }} />
      <Handle id="no" type="source" position={Position.Bottom} style={{ left: '75%' }} />
    </div>
  );
}

export function EndNode({ selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  return (
    <div className={`${shell(selected)} w-36`} data-testid="node-end">
      <Header icon={Square} label={t('end')} />
      <Handle type="target" position={Position.Top} />
    </div>
  );
}

export function AbSplitNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const split = data as AbSplitData;
  return (
    <div className={shell(selected)} data-testid="node-ab-split">
      <Header icon={Percent} label={t('abSplit')} />
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('ratioA')}
          type="number"
          min={1}
          max={99}
          value={split.ratioA}
          onChange={(event) => updateNodeData(id, { ratioA: event.target.value })}
          className="nodrag h-8 w-20"
        />
        <span className="text-muted-foreground text-xs">{t('ratioHint')}</span>
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between text-[10px] uppercase">
        <span>A</span>
        <span>B</span>
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle id="a" type="source" position={Position.Bottom} style={{ left: '25%' }} />
      <Handle id="b" type="source" position={Position.Bottom} style={{ left: '75%' }} />
    </div>
  );
}

export function UpdateTraitNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const trait = data as UpdateTraitData;
  return (
    <div className={shell(selected)} data-testid="node-update-trait">
      <Header icon={Tag} label={t('updateTrait')} />
      <div className="flex gap-1.5">
        <Input
          aria-label={t('traitKey')}
          placeholder={t('traitKeyPlaceholder')}
          value={trait.key}
          onChange={(event) => updateNodeData(id, { key: event.target.value })}
          className="nodrag h-8"
        />
        <Input
          aria-label={t('traitValue')}
          placeholder={t('traitValuePlaceholder')}
          value={trait.value}
          onChange={(event) => updateNodeData(id, { value: event.target.value })}
          className="nodrag h-8"
        />
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function WebhookNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const hook = data as WebhookData;
  return (
    <div className={shell(selected)} data-testid="node-webhook">
      <Header icon={Webhook} label={t('webhook')} />
      <Input
        aria-label={t('webhookUrl')}
        placeholder="https://"
        value={hook.url}
        onChange={(event) => updateNodeData(id, { url: event.target.value })}
        className="nodrag h-8"
      />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function SendPushNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const push = data as SendPushData;
  return (
    <div className={shell(selected)} data-testid="node-send-push">
      <Header icon={Bell} label={t('sendPush')} />
      <div className="grid gap-1.5">
        <Input
          aria-label={t('pushTitle')}
          placeholder={t('pushTitlePlaceholder')}
          value={push.title}
          onChange={(event) => updateNodeData(id, { title: event.target.value })}
          className="nodrag h-8"
        />
        <Input
          aria-label={t('pushBody')}
          placeholder={t('pushBodyPlaceholder')}
          value={push.body}
          onChange={(event) => updateNodeData(id, { body: event.target.value })}
          className="nodrag h-8"
        />
        <Input
          aria-label={t('pushUrl')}
          placeholder={t('pushUrlPlaceholder')}
          value={push.url}
          onChange={(event) => updateNodeData(id, { url: event.target.value })}
          className="nodrag h-8"
        />
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function SendSmsNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const sms = data as SendSmsData;
  return (
    <div className={shell(selected)} data-testid="node-send-sms">
      <Header icon={MessageSquare} label={t('sendSms')} />
      <Input
        aria-label={t('smsBody')}
        placeholder={t('smsBodyPlaceholder')}
        value={sms.body}
        onChange={(event) => updateNodeData(id, { body: event.target.value })}
        className="nodrag h-8"
      />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function SendWhatsappNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const { updateNodeData } = useReactFlow();
  const whatsapp = data as SendWhatsappData;
  return (
    <div className={shell(selected)} data-testid="node-send-whatsapp">
      <Header icon={MessageCircle} label={t('sendWhatsapp')} />
      <Input
        aria-label={t('whatsappBody')}
        placeholder={t('whatsappBodyPlaceholder')}
        value={whatsapp.body}
        onChange={(event) => updateNodeData(id, { body: event.target.value })}
        className="nodrag h-8"
      />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function SendInAppNode({ id, data, selected }: NodeProps) {
  const t = useTranslations('journeys.nodes');
  const trpc = useTRPC();
  const workspaceId = useActiveWorkspaceId();
  const { updateNodeData } = useReactFlow();
  const inApp = data as SendInAppData;
  const messages = useQuery({
    ...trpc.inAppMessage.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });
  return (
    <div className={shell(selected)} data-testid="node-send-in-app">
      <Header icon={AppWindow} label={t('sendInApp')} />
      <ThemedSelect
        aria-label={t('inAppMessage')}
        value={inApp.messageId || undefined}
        onValueChange={(messageId) => updateNodeData(id, { messageId })}
        className="nodrag w-full"
        size="sm"
        placeholder={t('pickInAppMessage')}
        options={(messages.data ?? []).map((message) => ({
          value: message.id,
          label: message.name,
        }))}
      />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  send_email: SendEmailNode,
  wait: WaitNode,
  branch: BranchNode,
  ab_split: AbSplitNode,
  update_trait: UpdateTraitNode,
  webhook: WebhookNode,
  send_push: SendPushNode,
  send_sms: SendSmsNode,
  send_whatsapp: SendWhatsappNode,
  send_in_app: SendInAppNode,
  end: EndNode,
};
