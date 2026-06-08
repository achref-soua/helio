'use client';

import '@xyflow/react/dist/style.css';

import type { JourneyDefinition } from '@helio/core';
import { Button } from '@helio/ui/components/button';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { GitBranch, Mail, Percent, Square, Tag, Timer, Webhook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import {
  type CanvasNode,
  canvasToDefinition,
  danglingNodeId,
  DEFAULT_SETTINGS,
  definitionToCanvas,
  type JourneySettings,
  nextCanvasId,
  settingsFromDefinition,
  TRIGGER_ID,
} from './graph';
import { nodeTypes } from './nodes';

const EMPTY: { nodes: CanvasNode[]; edges: Edge[] } = {
  nodes: [
    {
      id: TRIGGER_ID,
      type: 'trigger',
      position: { x: 40, y: 40 },
      data: { event: '' },
      deletable: false,
    },
  ],
  edges: [],
};

export interface JourneyEditorProps {
  initialName: string;
  initialDefinition: JourneyDefinition | null;
  saving: boolean;
  onSave: (name: string, definition: JourneyDefinition) => void;
  onCancel: () => void;
}

function Editor({ initialName, initialDefinition, saving, onSave, onCancel }: JourneyEditorProps) {
  const t = useTranslations('journeys.editor');
  const initial = useMemo(
    () => (initialDefinition ? definitionToCanvas(initialDefinition) : EMPTY),
    [initialDefinition],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initialName);
  const [settings, setSettings] = useState<JourneySettings>(() =>
    initialDefinition ? settingsFromDefinition(initialDefinition) : DEFAULT_SETTINGS,
  );

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge({ ...connection, label: connection.sourceHandle ?? undefined }, current),
      ),
    [setEdges],
  );

  /** Palette: add a node and wire it from the first dangling exit. */
  function addNode(
    type: 'send_email' | 'wait' | 'branch' | 'ab_split' | 'update_trait' | 'webhook' | 'end',
  ) {
    const id = nextCanvasId(type);
    const tailId = danglingNodeId(nodes, edges);
    const tail = nodes.find((node) => node.id === tailId);
    const position = tail
      ? { x: tail.position.x, y: tail.position.y + 150 }
      : { x: 40, y: 40 + nodes.length * 150 };
    const data =
      type === 'send_email'
        ? { templateId: '' }
        : type === 'wait'
          ? { hours: '24' }
          : type === 'branch'
            ? { attributeKey: '', operator: 'equals', value: '' }
            : type === 'ab_split'
              ? { ratioA: '50' }
              : type === 'update_trait'
                ? { key: '', value: '' }
                : type === 'webhook'
                  ? { url: 'https://' }
                  : {};
    setNodes((current) => [...current, { id, type, position, data }]);
    if (tailId) {
      const tailNode = nodes.find((node) => node.id === tailId);
      const sourceHandle =
        tailNode?.type === 'branch'
          ? edges.some((edge) => edge.source === tailId && edge.sourceHandle === 'yes')
            ? 'no'
            : 'yes'
          : tailNode?.type === 'ab_split'
            ? edges.some((edge) => edge.source === tailId && edge.sourceHandle === 'a')
              ? 'b'
              : 'a'
            : undefined;
      setEdges((current) =>
        addEdge(
          {
            source: tailId,
            target: id,
            sourceHandle: sourceHandle ?? null,
            targetHandle: null,
            label: sourceHandle,
          } as Edge,
          current,
        ),
      );
    }
  }

  const conversion = useMemo(
    () => canvasToDefinition(nodes, edges, settings),
    [nodes, edges, settings],
  );
  const savable = !!name.trim() && conversion.definition !== undefined;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="journey-name">{t('name')}</Label>
          <Input
            id="journey-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className="w-64"
            required
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            onClick={() => conversion.definition && onSave(name.trim(), conversion.definition)}
            disabled={!savable || saving}
          >
            {t('save')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => addNode('send_email')}>
          <Mail aria-hidden /> {t('addSend')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode('wait')}>
          <Timer aria-hidden /> {t('addWait')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode('branch')}>
          <GitBranch aria-hidden /> {t('addBranch')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode('ab_split')}>
          <Percent aria-hidden /> {t('addAbSplit')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode('update_trait')}>
          <Tag aria-hidden /> {t('addUpdateTrait')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode('webhook')}>
          <Webhook aria-hidden /> {t('addWebhook')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode('end')}>
          <Square aria-hidden /> {t('addEnd')}
        </Button>
        <span className="text-muted-foreground self-center text-xs">{t('connectHint')}</span>
      </div>

      <div className="h-[520px] rounded-md border" data-testid="journey-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div
        className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
        data-testid="journey-settings"
      >
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.quietHoursEnabled}
            onChange={(event) =>
              setSettings({ ...settings, quietHoursEnabled: event.target.checked })
            }
            aria-label={t('quietHours')}
          />
          {t('quietHours')}
          {settings.quietHoursEnabled && (
            <span className="flex items-center gap-1">
              <Input
                aria-label={t('quietStart')}
                type="time"
                value={settings.quietStart}
                onChange={(event) => setSettings({ ...settings, quietStart: event.target.value })}
                className="h-8 w-28"
              />
              –
              <Input
                aria-label={t('quietEnd')}
                type="time"
                value={settings.quietEnd}
                onChange={(event) => setSettings({ ...settings, quietEnd: event.target.value })}
                className="h-8 w-28"
              />
              <Input
                aria-label={t('quietTimezone')}
                value={settings.quietTimezone}
                onChange={(event) =>
                  setSettings({ ...settings, quietTimezone: event.target.value })
                }
                className="h-8 w-36"
              />
            </span>
          )}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.capEnabled}
            onChange={(event) => setSettings({ ...settings, capEnabled: event.target.checked })}
            aria-label={t('frequencyCap')}
          />
          {t('frequencyCap')}
          {settings.capEnabled && (
            <span className="flex items-center gap-1">
              <Input
                aria-label={t('capMax')}
                type="number"
                min={1}
                value={settings.capMax}
                onChange={(event) => setSettings({ ...settings, capMax: event.target.value })}
                className="h-8 w-20"
              />
              {t('capPer')}
              <Input
                aria-label={t('capDays')}
                type="number"
                min={1}
                value={settings.capDays}
                onChange={(event) => setSettings({ ...settings, capDays: event.target.value })}
                className="h-8 w-20"
              />
              {t('capDaysSuffix')}
            </span>
          )}
        </label>
      </div>

      {conversion.issues.length > 0 && (
        <ul className="text-muted-foreground text-xs" data-testid="journey-issues">
          {conversion.issues.slice(0, 5).map((issue) => (
            <li key={issue}>• {issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function JourneyEditor(props: JourneyEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
