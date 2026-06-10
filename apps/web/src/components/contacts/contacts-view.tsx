'use client';

import { Badge } from '@helio/ui/components/badge';
import { Button } from '@helio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { Skeleton } from '@helio/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@helio/ui/components/table';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Download, Gauge, ListPlus, MoreHorizontal, Plus, Sparkles, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDeferredValue, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

import { ContactDialog } from './contact-dialog';
import { ImportDialog } from './import-dialog';
import { ScoringDialog } from './scoring-dialog';

interface ContactRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  score: number;
  conversionProbability: number | null;
  churnRisk: number | null;
  status: 'ACTIVE' | 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED';
  createdAt: Date | string;
}

const columnHelper = createColumnHelper<ContactRow>();

export function ContactsView() {
  const t = useTranslations('contacts');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [listId, setListId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [newListOpen, setNewListOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);

  const listInput = {
    workspaceId: workspaceId ?? '',
    search: deferredSearch || undefined,
    listId: listId ?? undefined,
    limit: 50,
  };
  const contactsQuery = useInfiniteQuery({
    ...trpc.contact.list.infiniteQueryOptions(listInput, {
      getNextPageParam: (last) => last.nextCursor,
    }),
    enabled: !!workspaceId,
  });
  const listsQuery = useQuery({
    ...trpc.contactList.list.queryOptions({ workspaceId: workspaceId ?? '' }),
    enabled: !!workspaceId,
  });

  // pathFilter matches both the plain and infinite list queries —
  // queryKey() would stamp `type: 'query'` and miss the infinite table.
  const invalidateContacts = () => queryClient.invalidateQueries(trpc.contact.list.pathFilter());
  const invalidateLists = () => queryClient.invalidateQueries(trpc.contactList.list.pathFilter());

  function downloadBlob(content: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function onExportCsv() {
    try {
      const result = await queryClient.fetchQuery(
        trpc.contact.exportCsv.queryOptions({
          workspaceId: workspaceId ?? '',
          search: deferredSearch || undefined,
          listId: listId ?? undefined,
        }),
      );
      downloadBlob(result.csv, 'text/csv;charset=utf-8', 'helio-contacts.csv');
      toast.success(t('export.done', { count: result.count }));
      if (result.truncated) toast.info(t('export.truncated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('export.failed'));
    }
  }

  async function onExportData(contactId: string) {
    try {
      const bundle = await queryClient.fetchQuery(
        trpc.contact.dataExport.queryOptions({ id: contactId }),
      );
      downloadBlob(
        JSON.stringify(bundle, null, 2),
        'application/json',
        `helio-contact-${contactId}.json`,
      );
      toast.success(t('export.dataDone'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('export.failed'));
    }
  }

  const deleteContact = useMutation(trpc.contact.delete.mutationOptions());
  const addMembers = useMutation(trpc.contactList.addMembers.mutationOptions());
  const removeMember = useMutation(trpc.contactList.removeMember.mutationOptions());
  const createList = useMutation(trpc.contactList.create.mutationOptions());
  const recompute = useMutation(trpc.scoring.recompute.mutationOptions());

  async function onRecompute() {
    if (!workspaceId) return;
    try {
      const result = await recompute.mutateAsync({ workspaceId });
      await invalidateContacts();
      toast.success(t('predictionsDone', { count: result.scored }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const rows = useMemo(
    () => contactsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [contactsQuery.data],
  );
  const total = contactsQuery.data?.pages[0]?.total ?? 0;

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label={t('selectAll')}
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={t('selectRow')}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      }),
      columnHelper.accessor('email', { header: t('columns.email') }),
      columnHelper.accessor(
        (row) => [row.firstName, row.lastName].filter(Boolean).join(' ') || '—',
        { id: 'name', header: t('columns.name') },
      ),
      columnHelper.accessor('score', {
        header: t('columns.score'),
        cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
      }),
      columnHelper.accessor('churnRisk', {
        header: t('columns.churnRisk'),
        cell: ({ getValue }) => {
          const value = getValue();
          if (value === null || value === undefined) {
            return <span className="text-muted-foreground">—</span>;
          }
          const pct = Math.round(value * 100);
          const tone = value >= 0.66 ? 'destructive' : value >= 0.33 ? 'outline' : 'secondary';
          return <Badge variant={tone}>{pct}%</Badge>;
        },
      }),
      columnHelper.accessor('status', {
        header: t('columns.status'),
        cell: ({ getValue }) => (
          <Badge variant={getValue() === 'ACTIVE' ? 'secondary' : 'outline'}>
            {t(`status.${getValue()}`)}
          </Badge>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: t('columns.added'),
        cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
      }),
      columnHelper.display({
        id: 'actions',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('rowActions')}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(row.original)}>
                {t('editAction')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onExportData(row.original.id)}
                data-testid="export-contact-data"
              >
                {t('export.dataAction')}
              </DropdownMenuItem>
              {listId && (
                <DropdownMenuItem
                  onClick={async () => {
                    await removeMember.mutateAsync({ listId, contactId: row.original.id });
                    await Promise.all([invalidateContacts(), invalidateLists()]);
                  }}
                >
                  {t('removeFromList')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  await deleteContact.mutateAsync({ id: row.original.id });
                  await invalidateContacts();
                  toast.success(t('deleted'));
                }}
              >
                {t('deleteAction')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable helpers
    [t, listId],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const selectedIds = Object.keys(rowSelection);

  async function onCreateList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    try {
      await createList.mutateAsync({ workspaceId, name });
      await invalidateLists();
      setNewListOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  async function onAddSelectionToList(targetListId: string) {
    const result = await addMembers.mutateAsync({ listId: targetListId, contactIds: selectedIds });
    await Promise.all([invalidateContacts(), invalidateLists()]);
    setRowSelection({});
    toast.success(t('addedToList', { count: result.added }));
  }

  if (!workspaceId) {
    return <Skeleton className="h-64" data-testid="contacts-loading" />;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Badge variant="outline" data-testid="contacts-total">
          {t('total', { count: total })}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRecompute}
            disabled={recompute.isPending}
            data-testid="recompute-predictions"
          >
            <Sparkles aria-hidden /> {t('predictAction')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setScoringOpen(true)}>
            <Gauge aria-hidden /> {t('scoring.manageAction')}
          </Button>
          <Button variant="outline" size="sm" onClick={onExportCsv} data-testid="export-contacts">
            <Download aria-hidden /> {t('export.action')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden /> {t('importAction')}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden /> {t('addAction')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="max-w-xs"
          aria-label={t('searchPlaceholder')}
        />
        <Button
          variant={listId === null ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setListId(null)}
        >
          {t('allContacts')}
        </Button>
        {listsQuery.data?.map((list) => (
          <Button
            key={list.id}
            variant={listId === list.id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setListId(list.id)}
          >
            {list.name} · {list._count.members}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setNewListOpen(true)}>
          <ListPlus aria-hidden /> {t('newList')}
        </Button>
        {selectedIds.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                {t('addToList', { count: selectedIds.length })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {listsQuery.data?.map((list) => (
                <DropdownMenuItem key={list.id} onClick={() => onAddSelectionToList(list.id)}>
                  {list.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-24 text-center"
                >
                  {contactsQuery.isLoading ? t('loading') : t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {contactsQuery.hasNextPage && (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={contactsQuery.isFetchingNextPage}
            onClick={() => contactsQuery.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}

      <ContactDialog
        workspaceId={workspaceId}
        open={addOpen || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false);
            setEditing(null);
          }
        }}
        editing={editing}
      />
      <ImportDialog workspaceId={workspaceId} open={importOpen} onOpenChange={setImportOpen} />
      <ScoringDialog workspaceId={workspaceId} open={scoringOpen} onOpenChange={setScoringOpen} />

      <Dialog open={newListOpen} onOpenChange={setNewListOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('newListTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreateList} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="list-name">{t('listName')}</Label>
              <Input id="list-name" name="name" required maxLength={80} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createList.isPending}>
                {t('createListAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
