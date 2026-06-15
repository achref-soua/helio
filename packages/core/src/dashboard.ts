import { z } from 'zod';

/**
 * The customizable dashboard: a catalog of widgets the operator can show, hide,
 * and reorder, persisted per member. All the layout logic is pure and lives
 * here — the catalog, the default layout, and `normalizeDashboardLayout`, which
 * reconciles a stored layout with the current catalog (so new widgets appear,
 * removed ones drop, and a saved order is preserved). The web layer maps each
 * widget id to a component and renders them in this order.
 */

export type DashboardWidgetSize = 'small' | 'large';

interface DashboardWidgetDef {
  id: string;
  size: DashboardWidgetSize;
  /** Whether the widget is shown on a brand-new (or never-customized) dashboard. */
  defaultEnabled: boolean;
}

export const DASHBOARD_WIDGETS = [
  { id: 'contacts', size: 'small', defaultEnabled: true },
  { id: 'activeJourneys', size: 'small', defaultEnabled: true },
  { id: 'emailsSent', size: 'small', defaultEnabled: true },
  { id: 'opens', size: 'small', defaultEnabled: true },
  { id: 'openDeals', size: 'small', defaultEnabled: false },
  { id: 'tasksDue', size: 'small', defaultEnabled: false },
  { id: 'timeline', size: 'large', defaultEnabled: true },
  { id: 'pipeline', size: 'large', defaultEnabled: true },
  { id: 'recentCampaigns', size: 'large', defaultEnabled: true },
  { id: 'audience', size: 'small', defaultEnabled: false },
  { id: 'channels', size: 'large', defaultEnabled: false },
  { id: 'quickLinks', size: 'large', defaultEnabled: false },
] as const satisfies readonly DashboardWidgetDef[];

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]['id'];

const WIDGET_IDS = DASHBOARD_WIDGETS.map((widget) => widget.id) as [
  DashboardWidgetId,
  ...DashboardWidgetId[],
];
const SIZE_BY_ID = new Map<string, DashboardWidgetSize>(
  DASHBOARD_WIDGETS.map((widget) => [widget.id, widget.size]),
);

export function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && WIDGET_IDS.includes(value as DashboardWidgetId);
}

/** The display size of a widget (small stat card vs. full-width panel). */
export function dashboardWidgetSize(id: DashboardWidgetId): DashboardWidgetSize {
  return SIZE_BY_ID.get(id) ?? 'small';
}

export interface DashboardWidgetPref {
  id: DashboardWidgetId;
  visible: boolean;
}
export type DashboardLayout = DashboardWidgetPref[];

export const dashboardLayoutSchema = z
  .array(z.object({ id: z.enum(WIDGET_IDS), visible: z.boolean() }))
  .max(WIDGET_IDS.length);

/** The layout a never-customized dashboard starts from. */
export function defaultDashboardLayout(): DashboardLayout {
  return DASHBOARD_WIDGETS.map((widget) => ({ id: widget.id, visible: widget.defaultEnabled }));
}

/**
 * Reconcile a stored layout with the catalog: keep the saved order and
 * visibility for widgets that still exist (de-duplicated), drop unknown ids,
 * and append any catalog widgets the saved layout never saw at their default
 * visibility. Invalid input falls back to the default layout.
 */
export function normalizeDashboardLayout(stored: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(stored);
  const saved = parsed.success ? parsed.data : [];
  const seen = new Set<DashboardWidgetId>();
  const layout: DashboardLayout = [];
  for (const pref of saved) {
    if (!seen.has(pref.id)) {
      seen.add(pref.id);
      layout.push({ id: pref.id, visible: pref.visible });
    }
  }
  for (const widget of DASHBOARD_WIDGETS) {
    if (!seen.has(widget.id)) layout.push({ id: widget.id, visible: widget.defaultEnabled });
  }
  return layout;
}
