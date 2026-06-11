'use client';

import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helio/ui/components/dialog';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspaceId } from '@/components/workspace-switcher';
import { useTRPC } from '@/trpc/client';

/**
 * Companies (H4): the B2B account list — name, domain, industry, and how
 * many contacts and deals are attached. Create/edit/delete here; attach
 * from the contact and deal detail pages.
 */

interface CompanyForm {
  id?: string;
  name: string;
  domain: string;
  industry: string;
  website: string;
}

const EMPTY: CompanyForm = { name: '', domain: '', industry: '', website: '' };

export function CompaniesView() {
  const t = useTranslations('companies');
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<CompanyForm | null>(null);

  const companies = useQuery({
    ...trpc.crm.companies.queryOptions({ workspaceId: workspaceId ?? '', search: undefined }),
    enabled: Boolean(workspaceId),
  });
  const create = useMutation(trpc.crm.createCompany.mutationOptions());
  const update = useMutation(trpc.crm.updateCompany.mutationOptions());
  const remove = useMutation(trpc.crm.deleteCompany.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.crm.companies.pathFilter());
  }

  // The active-workspace hook is null until the workspace list loads; a
  // submit landing in that window waits for it instead of no-oping.
  async function ensureWorkspaceId(): Promise<string | null> {
    if (workspaceId) return workspaceId;
    try {
      const workspaces = await queryClient.fetchQuery(trpc.workspace.list.queryOptions());
      return workspaces[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetWorkspaceId = await ensureWorkspaceId();
    if (!form || !targetWorkspaceId) {
      toast.error(t('genericError'));
      return;
    }
    try {
      if (form.id) {
        await update.mutateAsync({
          id: form.id,
          name: form.name,
          domain: form.domain || null,
          industry: form.industry || null,
          website: form.website || null,
        });
      } else {
        await create.mutateAsync({
          workspaceId: targetWorkspaceId,
          name: form.name,
          domain: form.domain || undefined,
          industry: form.industry || undefined,
          website: form.website || undefined,
        });
      }
      setForm(null);
      await refresh();
      toast.success(t('saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('genericError'));
    }
  }

  const rows = (companies.data ?? []).filter((company) =>
    search ? company.name.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-4" data-testid="companies-view">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Input
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-48"
          />
          <Button onClick={() => setForm(EMPTY)}>
            <Plus className="size-4" aria-hidden /> {t('add')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-4 py-2 font-medium">{t('name')}</th>
                <th className="px-4 py-2 font-medium">{t('domain')}</th>
                <th className="px-4 py-2 font-medium">{t('industry')}</th>
                <th className="px-4 py-2 font-medium">{t('contacts')}</th>
                <th className="px-4 py-2 font-medium">{t('deals')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((company) => (
                <tr key={company.id} className="border-b last:border-0" data-testid="company-row">
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <Building2 className="text-muted-foreground size-4" aria-hidden />
                      {company.name}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-2">{company.domain ?? '—'}</td>
                  <td className="text-muted-foreground px-4 py-2">{company.industry ?? '—'}</td>
                  <td className="px-4 py-2 tabular-nums">{company._count.contacts}</td>
                  <td className="px-4 py-2 tabular-nums">{company._count.deals}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('edit', { name: company.name })}
                      onClick={() =>
                        setForm({
                          id: company.id,
                          name: company.name,
                          domain: company.domain ?? '',
                          industry: company.industry ?? '',
                          website: company.website ?? '',
                        })
                      }
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('delete', { name: company.name })}
                      onClick={async () => {
                        try {
                          await remove.mutateAsync({ id: company.id });
                          await refresh();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t('genericError'));
                        }
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !companies.isLoading && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-10 text-center">
                    {t('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? t('editTitle') : t('addTitle')}</DialogTitle>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={onSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="company-name">{t('name')}</Label>
              <Input
                id="company-name"
                required
                maxLength={160}
                value={form?.name ?? ''}
                onChange={(event) =>
                  setForm((current) => current && { ...current, name: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-domain">{t('domain')}</Label>
              <Input
                id="company-domain"
                maxLength={160}
                placeholder="acme.com"
                value={form?.domain ?? ''}
                onChange={(event) =>
                  setForm((current) => current && { ...current, domain: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-industry">{t('industry')}</Label>
              <Input
                id="company-industry"
                maxLength={120}
                value={form?.industry ?? ''}
                onChange={(event) =>
                  setForm((current) => current && { ...current, industry: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-website">{t('website')}</Label>
              <Input
                id="company-website"
                type="url"
                maxLength={300}
                placeholder="https://acme.com"
                value={form?.website ?? ''}
                onChange={(event) =>
                  setForm((current) => current && { ...current, website: event.target.value })
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending || update.isPending}>
                {form?.id ? t('save') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
