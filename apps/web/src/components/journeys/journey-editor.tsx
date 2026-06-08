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
import { GitBranch, Mail, Square, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import {
  type CanvasNode,
  canvasToDefinition,
  danglingNodeId,
  definitionToCanvas,
  nextCanvasId,
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

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge({ ...connection, label: connection.sourceHandle ?? undefined }, current),
      ),
    [setEdges],
  );

  /** Palette: add a node and wire it from the first dangling exit. */
  function addNode(type: 'send_email' | 'wait' | 'branch' | 'end') {
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
            : {};
    setNodes((current) => [...current, { id, type, position, data }]);
    if (tailId) {
      const tailNode = nodes.find((node) => node.id === tailId);
      const sourceHandle =
        tailNode?.type === 'branch'
          ? edges.some((edge) => edge.source === tailId && edge.sourceHandle === 'yes')
            ? 'no'
            : 'yes'
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

  const conversion = useMemo(() => canvasToDefinition(nodes, edges), [nodes, edges]);
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
