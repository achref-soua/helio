'use client';

import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

/**
 * The Database Studio (J): a safe window onto the workspace's own tenant
 * tables. Allow-listed models only, every write validated server-side and
 * audited, deletes owner-only behind a typed confirmation. Auth tables
 * and anything secret-bearing are not browsable by construction.
 */

type RowValues = Record<string, unknown>;

export function DatabaseStudio() {
  const t = useTranslations('admin.database');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [model, setModel] = useState('contact');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [editing, setEditing] = useState<RowValues | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmWord, setConfirmWord] = useState('');

  const tables = useQuery(trpc.admin.dbTables.queryOptions());
  const rows = useQuery({
    ...trpc.admin.dbRows.queryOptions({
      model,
      workspaceId: workspaceId ?? '',
      search: applied || undefined,
    }),
    enabled: Boolean(workspaceId),
  });
  const updateRow = useMutation(trpc.admin.dbUpdateRow.mutationOptions());
  const createRow = useMutation(trpc.admin.dbCreateRow.mutationOptions());
  const deleteRow = useMutation(trpc.admin.dbDeleteRow.mutationOptions());

  const spec = tables.data?.find((table) => table.name === model);
  const editableFields = (spec?.fields ?? []).filter((field) => field.editable);

  async function refresh() {
    await queryClient.invalidateQueries(trpc.admin.dbRows.pathFilter());
  }

  function openEdit(row: RowValues) {
    setEditing(row);
    setDraft(
      Object.fromEntries(
        editableFields.map((field) => {
          const value = row[field.name];
          return [
            field.name,
            field.type === 'json'
              ? JSON.stringify(value ?? {}, null, 2)
              : value === null || value === undefined
                ? ''
                : String(value),
          ];
        }),
      ),
    );
  }

  function draftValues(): RowValues {
    const values: RowValues = {};
    for (const field of editableFields) {
      const raw = draft[field.name] ?? '';
      if (field.type === 'json') {
        try {
          values[field.name] = raw.trim() ? JSON.parse(raw) : {};
        } catch {
          throw new Error(t('badJson', { field: field.name }));
        }
      } else {
        values[field.name] = raw;
      }
    }
    return values;
  }

  async function onSave() {
    try {
      const values = draftValues();
      if (editing) {
        await updateRow.mutateAsync({ model, id: String(editing.id), values });
      } else {
        await createRow.mutateAsync({ model, workspaceId: workspaceId ?? '', values });
      }
      setEditing(null);
      setCreating(false);
      await refresh();
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  return (
    <div className="grid gap-4" data-testid="database-studio">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{t('table')}</span>
          <select
            aria-label={t('table')}
            className="border-input bg-background h-9 rounded-md border px-2"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setSearch('');
              setApplied('');
            }}
          >
            {(tables.data ?? []).map((table) => (
              <option key={table.name} value={table.name}>
                {table.label}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t('search')}</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-56"
            />
          </label>
          <Button type="submit" variant="outline">
            {t('apply')}
          </Button>
        </form>
        {spec?.creatable && (
          <Button
            className="ml-auto"
            onClick={() => {
              setCreating(true);
              setDraft(Object.fromEntries(editableFields.map((field) => [field.name, ''])));
            }}
          >
            <Plus className="size-4" aria-hidden /> {t('newRow')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                {(spec?.fields ?? []).map((field) => (
                  <th key={field.name} className="px-3 py-2 font-medium whitespace-nowrap">
                    {field.name}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(rows.data?.rows ?? []).map((row) => (
                <tr
                  key={String(row.id)}
                  className="border-b last:border-0"
                  data-testid="studio-row"
                >
                  {(spec?.fields ?? []).map((field) => (
                    <td key={field.name} className="max-w-56 truncate px-3 py-1.5">
                      {field.type === 'json'
                        ? JSON.stringify(row[field.name] ?? {})
                        : field.type === 'date' && row[field.name]
                          ? new Date(String(row[field.name])).toLocaleString()
                          : String(row[field.name] ?? '—')}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {editableFields.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('editRow', { id: String(row.id) })}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('deleteRow', { id: String(row.id) })}
                      onClick={() => {
                        setConfirmDelete(String(row.id));
                        setConfirmWord('');
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
              {(rows.data?.rows ?? []).length === 0 && !rows.isLoading && (
                <tr>
                  <td
                    colSpan={(spec?.fields.length ?? 1) + 1}
                    className="text-muted-foreground px-3 py-10 text-center"
                  >
                    {t('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null || creating}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{creating ? t('newRow') : t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editSubtitle')}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-96 gap-3 overflow-y-auto">
            {editableFields.map((field) => (
              <label key={field.name} className="grid gap-1.5 text-sm">
                <span className="font-medium">
                  {field.name}
                  {field.required && <span className="text-destructive"> *</span>}
                </span>
                {field.type === 'json' ? (
                  <textarea
                    aria-label={field.name}
                    className="border-input bg-background min-h-24 rounded-md border p-2 font-mono text-xs"
                    value={draft[field.name] ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                  />
                ) : (
                  <Input
                    aria-label={field.name}
                    type={
                      field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'
                    }
                    value={draft[field.name] ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={onSave} disabled={updateRow.isPending || createRow.isPending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteSubtitle', { id: confirmDelete ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span>{t('deletePrompt')}</span>
            <Input
              value={confirmWord}
              onChange={(event) => setConfirmWord(event.target.value)}
              placeholder="delete"
            />
          </label>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={confirmWord !== 'delete' || deleteRow.isPending}
              onClick={async () => {
                try {
                  await deleteRow.mutateAsync({ model, id: confirmDelete ?? '' });
                  setConfirmDelete(null);
                  await refresh();
                  toast.success(t('deleted'));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t('genericError'));
                }
              }}
            >
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
