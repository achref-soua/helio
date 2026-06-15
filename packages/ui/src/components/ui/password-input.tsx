'use client';

import { Eye, EyeOff } from 'lucide-react';
import { type ComponentProps, useState } from 'react';

import { cn } from '../../lib/utils';
import { Input } from './input';

/**
 * A password field with a show/hide toggle. It forwards every prop to {@link
 * Input} (including `name`/`required`, so it works in plain forms) and renders
 * an eye button that flips the field between masked and plain text. The toggle
 * is keyboard-focusable with an `aria-pressed`/`aria-label` for assistive tech;
 * the labels default to English and can be overridden for localized surfaces.
 */
function PasswordInput({
  className,
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  ...props
}: Omit<ComponentProps<typeof Input>, 'type'> & {
  showLabel?: string;
  hideLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center rounded-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
