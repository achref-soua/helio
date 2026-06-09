import { z } from 'zod';

/** The on-site widget kinds the embed can render. */
export const WIDGET_TYPES = ['BANNER', 'POPUP'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const widgetTypeSchema = z.enum(WIDGET_TYPES);

/** The public shape served to the embed for one active widget. */
export interface WidgetPayload {
  id: string;
  type: WidgetType;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

/** The copy-paste `<script>` snippet that loads the embed for a write key. */
export function widgetEmbedSnippet(scriptUrl: string, writeKey: string): string {
  return `<script async src="${scriptUrl}" data-write-key="${writeKey}"></script>`;
}
