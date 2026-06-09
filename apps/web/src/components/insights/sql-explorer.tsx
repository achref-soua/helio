'use client';

import { Button } from '@helio/ui/components/button';
import { Card, CardContent } from '@helio/ui/components/card';
import { useMutation } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useTRPC } from '@/trpc/client';

const DEFAULT_SQL =
  'SELECT event, count() AS events\nFROM events\nGROUP BY event\nORDER BY events DESC';

export function SqlExplorer({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('insights.sql');
  const trpc = useTRPC();
  const [sql, setSql] = useState(DEFAULT_SQL);
  const run = useMutation(trpc.analytics.runSql.mutationOptions());

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = sql.trim();
    if (trimmed) run.mutate({ workspaceId, sql: trimmed });
  }

  const result = run.data;

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex items-center gap-2">
          <Terminal className="text-primary size-5" aria-hidden />
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <p className="text-muted-foreground -mt-2 text-sm">{t('subtitle')}</p>

        <form onSubmit={onSubmit} className="grid gap-2">
          <textarea
            aria-label={t('label')}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            rows={5}
            spellCheck={false}
            className="border-input bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            data-testid="sql-input"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={run.isPending} data-testid="sql-run">
              {run.isPending ? t('running') : t('run')}
            </Button>
            <span className="text-muted-foreground text-xs">{t('guardrails')}</span>
          </div>
        </form>

        {result && !result.ok ? (
          <p
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 font-mono text-xs"
            data-testid="sql-error"
          >
            {result.error}
          </p>
        ) : result && result.ok ? (
          result.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="sql-empty">
              {t('noRows')}
            </p>
          ) : (
            <div className="overflow-x-auto" data-testid="sql-results">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    {result.columns.map((column) => (
                      <th key={column} className="px-2 py-1 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index} className="border-b last:border-0">
                      {result.columns.map((column) => (
                        <td key={column} className="px-2 py-1 font-mono tabular-nums">
                          {formatCell(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-muted-foreground mt-2 text-xs">
                {t('rowCount', { count: result.rows.length })}
              </p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
