'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@helio/ui/components/select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

/**
 * The app's one dropdown: a thin options-array facade over the design
 * system's Radix Select, so every list popup matches the theme instead
 * of falling back to the OS-rendered native menu. Options can be flat
 * or grouped (the grouped form renders labeled sections).
 */
export function ThemedSelect({
  value,
  defaultValue,
  onValueChange,
  options,
  groups,
  placeholder,
  id,
  name,
  required,
  disabled,
  className,
  size = 'default',
  'aria-label': ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  placeholder?: string;
  id?: string;
  /** Form integration: Radix mirrors the value into a hidden native select. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
  'aria-label'?: string;
}) {
  return (
    <Select
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={className} size={size}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options?.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
        {groups?.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
