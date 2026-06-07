import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Input } from '../src/components/ui/input';
import { Label } from '../src/components/ui/label';

describe('Input', () => {
  it('is reachable by its label and accepts typing', async () => {
    render(
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </div>,
    );
    const input = screen.getByLabelText('Email');
    await userEvent.type(input, 'ada@example.com');
    expect(input).toHaveProperty('value', 'ada@example.com');
  });

  it('respects the disabled state', async () => {
    render(<Input aria-label="Slug" disabled />);
    const input = screen.getByLabelText('Slug');
    await userEvent.type(input, 'nope');
    expect(input).toHaveProperty('value', '');
  });
});
