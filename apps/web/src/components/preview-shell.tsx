import { Label } from '@helio/ui/components/label';
import { cn } from '@helio/ui/lib/utils';

/**
 * The shared frame around every live artifact preview (widgets, in-app
 * messages, landing pages, campaign emails): a labelled, quietly dotted
 * surface that reads as "this is the rendered thing, not the form".
 */
export function PreviewShell({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & { label: string }) {
  return (
    <div className="grid content-start gap-2">
      <Label>{label}</Label>
      <div
        className={cn(
          'bg-muted/30 rounded-lg border border-dashed p-4',
          'bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[size:14px_14px]',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}
