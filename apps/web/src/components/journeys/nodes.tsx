'use client';

import { Input } from '@helio/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import { Handle, type NodeProps, Position, useReactFlow } from '@xyflow/react';
import { GitBranch, Mail, Percent, Play, Square, Tag, Timer, Webhook } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

import type {
  AbSplitData,
  BranchData,
  SendEmailData,
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

/** Styled native select consistent with the builders. */
function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`border-input bg-transparent dark:bg-input/30 h-8 w-full rounded-md border px-2 text-sm outline-none ${className ?? ''}`}
      {...props}
    />
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
      <Select
        aria-label={t('template')}
        value={send.templateId}
        onChange={(event) => updateNodeData(id, { templateId: event.target.value })}
        className="nodrag"
      >
        <option value="" disabled>
          {t('pickTemplate')}
        </option>
        {templates.data?.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>
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
          <Select
            aria-label={t('branchOperator')}
            value={branch.operator}
            onChange={(event) => updateNodeData(id, { operator: event.target.value })}
            className="nodrag w-28"
          >
            <option value="equals">{t('equals')}</option>
            <option value="not_equals">{t('notEquals')}</option>
          </Select>
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

export const nodeTypes = {
  trigger: TriggerNode,
  send_email: SendEmailNode,
  wait: WaitNode,
  branch: BranchNode,
  ab_split: AbSplitNode,
  update_trait: UpdateTraitNode,
  webhook: WebhookNode,
  end: EndNode,
};
