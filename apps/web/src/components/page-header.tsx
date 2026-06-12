import { cn } from '@helio/ui/lib/utils';

/**
 * The editorial page header: a display-serif title over a quiet subtitle,
 * with an actions slot on the right. Every dashboard page opens with one
 * so the product reads as a single, considered publication.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="grid gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">{title}</h1>
        {subtitle ? <p className="text-muted-foreground max-w-2xl text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
