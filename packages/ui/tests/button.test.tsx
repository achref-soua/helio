import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../src/components/ui/button';

describe('Button', () => {
  it('renders an accessible button and fires clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Launch journey</Button>);
    const button = screen.getByRole('button', { name: 'Launch journey' });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Disabled' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies variant classes', () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('destructive');
  });

  it('renders as the child element with asChild (polymorphism)', () => {
    render(
      <Button asChild>
        <a href="/journeys">Go to journeys</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go to journeys' });
    expect(link).toHaveProperty('tagName', 'A');
  });
});
