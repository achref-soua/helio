import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_WIDGETS,
  dashboardLayoutSchema,
  dashboardWidgetSize,
  defaultDashboardLayout,
  isDashboardWidgetId,
  normalizeDashboardLayout,
} from './dashboard';

describe('defaultDashboardLayout', () => {
  it('lists every catalog widget with its default visibility', () => {
    const layout = defaultDashboardLayout();
    expect(layout).toHaveLength(DASHBOARD_WIDGETS.length);
    expect(layout.find((w) => w.id === 'contacts')).toEqual({ id: 'contacts', visible: true });
    expect(layout.find((w) => w.id === 'quickLinks')).toEqual({ id: 'quickLinks', visible: false });
  });
});

describe('isDashboardWidgetId / dashboardWidgetSize', () => {
  it('recognizes known ids and their sizes', () => {
    expect(isDashboardWidgetId('timeline')).toBe(true);
    expect(isDashboardWidgetId('nope')).toBe(false);
    expect(isDashboardWidgetId(42)).toBe(false);
    expect(dashboardWidgetSize('timeline')).toBe('large');
    expect(dashboardWidgetSize('contacts')).toBe('small');
  });
});

describe('dashboardLayoutSchema', () => {
  it('accepts a valid layout and rejects unknown ids', () => {
    expect(dashboardLayoutSchema.safeParse([{ id: 'contacts', visible: true }]).success).toBe(true);
    expect(dashboardLayoutSchema.safeParse([{ id: 'ghost', visible: true }]).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse([{ id: 'contacts' }]).success).toBe(false);
  });
});

describe('normalizeDashboardLayout', () => {
  it('returns the default layout for empty or invalid input', () => {
    expect(normalizeDashboardLayout(null)).toEqual(defaultDashboardLayout());
    expect(normalizeDashboardLayout('garbage')).toEqual(defaultDashboardLayout());
    expect(normalizeDashboardLayout([{ id: 'unknown', visible: true }])).toEqual(
      defaultDashboardLayout(),
    );
  });

  it('preserves saved order and visibility, then appends new widgets', () => {
    const layout = normalizeDashboardLayout([
      { id: 'timeline', visible: false },
      { id: 'contacts', visible: true },
    ]);
    // Saved widgets keep their order at the front…
    expect(layout[0]).toEqual({ id: 'timeline', visible: false });
    expect(layout[1]).toEqual({ id: 'contacts', visible: true });
    // …and every other catalog widget is appended at its default visibility.
    expect(layout).toHaveLength(DASHBOARD_WIDGETS.length);
    expect(layout.find((w) => w.id === 'pipeline')).toEqual({ id: 'pipeline', visible: true });
    expect(layout.find((w) => w.id === 'quickLinks')).toEqual({
      id: 'quickLinks',
      visible: false,
    });
  });

  it('drops duplicate ids, keeping the first', () => {
    const layout = normalizeDashboardLayout([
      { id: 'contacts', visible: false },
      { id: 'contacts', visible: true },
    ]);
    expect(layout.filter((w) => w.id === 'contacts')).toEqual([{ id: 'contacts', visible: false }]);
  });
});
