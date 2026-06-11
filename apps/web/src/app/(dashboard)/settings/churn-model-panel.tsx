'use client';

import { CHURN_FEATURE_NAMES, type ChurnFeatureName } from '@helio/core';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

/**
 * Bring-your-own churn model (ADR-0021): upload ONNX/XGBoost artifacts or
 * register an HTTPS model server, map Helio's features onto the model's
 * inputs, validate, and activate — with every failure explained in plain
 * words on the row. Training data exports as CSV for offline model work.
 */

type MappingState = Record<string, boolean>;

function FeaturePicker({
  features,
  state,
  onToggle,
  idPrefix,
}: {
  features: string[];
  state: MappingState;
  onToggle: (name: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {features.map((name) => (
        <label
          key={name}
          htmlFor={`${idPrefix}-${name}`}
          className="flex items-center gap-2 text-sm"
        >
          <input
            id={`${idPrefix}-${name}`}
            type="checkbox"
            className="accent-primary size-4"
            checked={state[name] ?? true}
            onChange={() => onToggle(name)}
          />
          <code className="text-xs">{name}</code>
        </label>
      ))}
    </div>
  );
}

function selectedInputs(features: string[], state: MappingState): ChurnFeatureName[] {
  return features.filter((name) => state[name] ?? true) as ChurnFeatureName[];
}

const STATUS_VARIANT = {
  ACTIVE: 'default',
  DISABLED: 'secondary',
  VALIDATING: 'secondary',
  FAILED: 'destructive',
} as const;

export function ChurnModelPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('churnModel');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploadName, setUploadName] = useState('');
  const [uploadMapping, setUploadMapping] = useState<MappingState>({});
  const [uploading, setUploading] = useState(false);
  const [endpointName, setEndpointName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [endpointAuth, setEndpointAuth] = useState('');
  const [endpointMapping, setEndpointMapping] = useState<MappingState>({});

  const list = useQuery({
    ...trpc.churnModel.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: canManage && Boolean(workspaceId),
  });
  const registerHttp = useMutation(trpc.churnModel.registerHttp.mutationOptions());
  const activate = useMutation(trpc.churnModel.activate.mutationOptions());
  const disable = useMutation(trpc.churnModel.disable.mutationOptions());
  const revalidate = useMutation(trpc.churnModel.revalidate.mutationOptions());
  const remove = useMutation(trpc.churnModel.remove.mutationOptions());

  if (!canManage) return null;
  // The canonical list ships with the client too, so the forms work (and
  // never submit an empty mapping) before the first list fetch resolves.
  const features: string[] = list.data?.featureNames ?? [...CHURN_FEATURE_NAMES];

  async function refresh() {
    await queryClient.invalidateQueries(trpc.churnModel.list.pathFilter());
  }

  // The active-workspace hook is null until the workspace list loads; a
  // submit that lands in that window waits for it instead of no-oping.
  async function ensureWorkspaceId(): Promise<string | null> {
    if (workspaceId) return workspaceId;
    try {
      const workspaces = await queryClient.fetchQuery(trpc.workspace.list.queryOptions());
      return workspaces[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  function reportVerdict(status: string, lastError: string | null | undefined) {
    if (status === 'FAILED') {
      toast.error(lastError ?? t('validationFailed'));
    } else {
      toast.success(t('validated'));
    }
  }

  async function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    const targetWorkspaceId = await ensureWorkspaceId();
    if (!file || !targetWorkspaceId) {
      toast.error(t('genericError'));
      return;
    }
    const format = file.name.toLowerCase().endsWith('.onnx') ? 'ONNX' : 'XGBOOST_JSON';
    const body = new FormData();
    body.set('file', file);
    body.set('workspaceId', targetWorkspaceId);
    body.set('name', uploadName);
    body.set('format', format);
    body.set('inputs', JSON.stringify(selectedInputs(features, uploadMapping)));
    setUploading(true);
    try {
      const response = await fetch('/api/admin/churn-model/upload', { method: 'POST', body });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        lastError?: string | null;
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? t('genericError'));
        return;
      }
      reportVerdict(payload.status ?? 'FAILED', payload.lastError);
      setUploadName('');
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch {
      toast.error(t('genericError'));
    } finally {
      setUploading(false);
    }
  }

  async function onRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetWorkspaceId = await ensureWorkspaceId();
    if (!targetWorkspaceId) {
      toast.error(t('genericError'));
      return;
    }
    try {
      const result = await registerHttp.mutateAsync({
        workspaceId: targetWorkspaceId,
        name: endpointName,
        url: endpointUrl,
        authHeader: endpointAuth || undefined,
        mapping: { inputs: selectedInputs(features, endpointMapping) },
      });
      reportVerdict(result.status, result.lastError);
      setEndpointName('');
      setEndpointUrl('');
      setEndpointAuth('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onExport() {
    const targetWorkspaceId = await ensureWorkspaceId();
    const response = await fetch(
      `/api/admin/churn-model/export?workspaceId=${encodeURIComponent(targetWorkspaceId ?? '')}`,
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      toast.error(payload.error ?? t('genericError'));
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'churn-training-data.csv';
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function rowAction(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <Card data-testid="churn-model-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="size-4" aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {(list.data?.models ?? []).length > 0 && (
          <ul className="grid gap-3">
            {list.data?.models.map((model) => (
              <li
                key={model.id}
                data-testid="churn-model-row"
                className="grid gap-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{model.name}</span>
                  <Badge variant="outline">{model.format}</Badge>
                  <Badge variant={STATUS_VARIANT[model.status]}>
                    {t(`status.${model.status}`)}
                  </Badge>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {model.mapping.inputs.length}/{features.length} {t('featuresShort')}
                  </span>
                </div>
                {model.lastError && (
                  <p className="text-destructive text-sm" data-testid="churn-model-error">
                    {model.lastError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {model.status !== 'ACTIVE' && model.status !== 'FAILED' && model.validatedAt && (
                    <Button
                      size="sm"
                      onClick={() => rowAction(() => activate.mutateAsync({ id: model.id }))}
                    >
                      {t('activate')}
                    </Button>
                  )}
                  {model.status === 'ACTIVE' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rowAction(() => disable.mutateAsync({ id: model.id }))}
                    >
                      {t('disable')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      rowAction(async () => {
                        const result = await revalidate.mutateAsync({ id: model.id });
                        reportVerdict(result.status, result.lastError);
                      })
                    }
                  >
                    {t('revalidate')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => rowAction(() => remove.mutateAsync({ id: model.id }))}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form className="grid gap-3" onSubmit={onUpload} data-testid="churn-upload-form">
          <p className="text-sm font-medium">{t('uploadTitle')}</p>
          <p className="text-muted-foreground text-sm">{t('uploadHint')}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="churn-upload-name">{t('nameLabel')}</Label>
            <Input
              id="churn-upload-name"
              value={uploadName}
              onChange={(event) => setUploadName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="churn-upload-file">{t('fileLabel')}</Label>
            <Input id="churn-upload-file" ref={fileRef} type="file" accept=".onnx,.json" required />
          </div>
          <details>
            <summary className="cursor-pointer text-sm">{t('mappingLabel')}</summary>
            <div className="pt-2">
              <FeaturePicker
                features={features}
                state={uploadMapping}
                idPrefix="churn-upload"
                onToggle={(name) =>
                  setUploadMapping((state) => ({ ...state, [name]: !(state[name] ?? true) }))
                }
              />
            </div>
          </details>
          <div>
            <Button type="submit" disabled={uploading}>
              {t('upload')}
            </Button>
          </div>
        </form>

        <form className="grid gap-3" onSubmit={onRegister} data-testid="churn-register-form">
          <p className="text-sm font-medium">{t('endpointTitle')}</p>
          <p className="text-muted-foreground text-sm">{t('endpointHint')}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="churn-endpoint-name">{t('nameLabel')}</Label>
            <Input
              id="churn-endpoint-name"
              value={endpointName}
              onChange={(event) => setEndpointName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="churn-endpoint-url">{t('urlLabel')}</Label>
            <Input
              id="churn-endpoint-url"
              type="url"
              placeholder="https://models.example.com/churn"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="churn-endpoint-auth">{t('authLabel')}</Label>
            <Input
              id="churn-endpoint-auth"
              type="password"
              placeholder="Bearer …"
              value={endpointAuth}
              onChange={(event) => setEndpointAuth(event.target.value)}
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">{t('authHint')}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">{t('mappingLabel')}</summary>
            <div className="pt-2">
              <FeaturePicker
                features={features}
                state={endpointMapping}
                idPrefix="churn-endpoint"
                onToggle={(name) =>
                  setEndpointMapping((state) => ({ ...state, [name]: !(state[name] ?? true) }))
                }
              />
            </div>
          </details>
          <div>
            <Button type="submit" disabled={registerHttp.isPending}>
              {t('register')}
            </Button>
          </div>
        </form>

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <p className="text-muted-foreground text-sm">{t('exportHint')}</p>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-4" aria-hidden /> {t('export')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
