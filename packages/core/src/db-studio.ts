import { z } from 'zod';

/**
 * The Database Studio's allow-list (J). Hand-rolled on purpose: every
 * model and every field here was chosen, not derived — auth tables,
 * credentials, and anything carrying a secret simply do not exist as far
 * as the studio is concerned. The router validates the model name against
 * this registry before touching the (RLS-scoped) client, builds its zod
 * validators from the field specs, and refuses writes to non-editable
 * fields.
 */

export type StudioFieldType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export interface StudioField {
  name: string;
  type: StudioFieldType;
  /** Editable through the studio. Ids, foreign keys, and timestamps are not. */
  editable: boolean;
  /** Required on create (when the model is creatable). */
  required?: boolean;
  maxLength?: number;
}

export interface StudioModel {
  /** Registry key and the tenant client delegate name. */
  name: string;
  label: string;
  /** Searched with `contains` when a search term is given. */
  searchField?: string;
  /** Rows can be created from the studio (not just edited). */
  creatable: boolean;
  fields: StudioField[];
}

const text = (name: string, editable = true, required = false, maxLength = 200): StudioField => ({
  name,
  type: 'string',
  editable,
  required,
  maxLength,
});
const readonly = (name: string, type: StudioFieldType = 'string'): StudioField => ({
  name,
  type,
  editable: false,
});

export const STUDIO_MODELS: StudioModel[] = [
  {
    name: 'contact',
    label: 'Contacts',
    searchField: 'email',
    creatable: false,
    fields: [
      readonly('id'),
      text('email', true, true, 320),
      text('firstName'),
      text('lastName'),
      text('phone', true, false, 32),
      text('status', true, false, 20),
      { name: 'score', type: 'number', editable: true },
      { name: 'attributes', type: 'json', editable: true },
      readonly('createdAt', 'date'),
    ],
  },
  {
    name: 'contactList',
    label: 'Lists',
    searchField: 'name',
    creatable: true,
    fields: [readonly('id'), text('name', true, true, 120), readonly('createdAt', 'date')],
  },
  {
    name: 'segment',
    label: 'Segments',
    searchField: 'name',
    creatable: false,
    fields: [
      readonly('id'),
      text('name', true, true, 120),
      { name: 'rule', type: 'json', editable: false },
      readonly('createdAt', 'date'),
    ],
  },
  {
    name: 'emailTemplate',
    label: 'Email templates',
    searchField: 'name',
    creatable: false,
    fields: [
      readonly('id'),
      text('name', true, true, 160),
      text('subject', true, false, 200),
      readonly('updatedAt', 'date'),
    ],
  },
  {
    name: 'campaign',
    label: 'Campaigns',
    searchField: 'name',
    creatable: false,
    fields: [
      readonly('id'),
      text('name', true, true, 160),
      readonly('status'),
      readonly('createdAt', 'date'),
    ],
  },
  {
    name: 'journey',
    label: 'Journeys',
    searchField: 'name',
    creatable: false,
    fields: [
      readonly('id'),
      text('name', true, true, 160),
      readonly('status'),
      readonly('updatedAt', 'date'),
    ],
  },
  {
    name: 'form',
    label: 'Forms',
    searchField: 'name',
    creatable: false,
    fields: [readonly('id'), text('name', true, true, 160), readonly('createdAt', 'date')],
  },
  {
    name: 'landingPage',
    label: 'Landing pages',
    searchField: 'title',
    creatable: false,
    fields: [
      readonly('id'),
      text('title', true, true, 160),
      readonly('published', 'boolean'),
      readonly('updatedAt', 'date'),
    ],
  },
  {
    name: 'company',
    label: 'Companies',
    searchField: 'name',
    creatable: true,
    fields: [
      readonly('id'),
      text('name', true, true, 160),
      text('domain', true, false, 160),
      text('industry', true, false, 120),
      text('website', true, false, 300),
      readonly('createdAt', 'date'),
    ],
  },
  {
    name: 'deal',
    label: 'Deals',
    searchField: 'title',
    creatable: false,
    fields: [
      readonly('id'),
      text('title', true, true, 160),
      { name: 'valueCents', type: 'number', editable: true },
      text('currency', true, false, 3),
      readonly('status'),
      readonly('createdAt', 'date'),
    ],
  },
  {
    name: 'task',
    label: 'Tasks',
    searchField: 'title',
    creatable: false,
    fields: [
      readonly('id'),
      text('title', true, true, 200),
      text('notes', true, false, 2000),
      readonly('status'),
      { name: 'dueAt', type: 'date', editable: true },
    ],
  },
  {
    name: 'note',
    label: 'Notes',
    searchField: 'body',
    creatable: false,
    fields: [readonly('id'), text('body', true, true, 4000), readonly('createdAt', 'date')],
  },
  {
    name: 'scoringRule',
    label: 'Scoring rules',
    searchField: 'event',
    creatable: false,
    fields: [
      readonly('id'),
      text('event', true, true, 200),
      { name: 'points', type: 'number', editable: true },
    ],
  },
  {
    name: 'widget',
    label: 'Widgets',
    searchField: 'name',
    creatable: false,
    fields: [
      readonly('id'),
      text('name', true, true, 160),
      text('title', true, false, 200),
      readonly('type'),
      readonly('updatedAt', 'date'),
    ],
  },
  {
    name: 'inAppMessage',
    label: 'In-app messages',
    searchField: 'name',
    creatable: false,
    fields: [readonly('id'), text('name', true, true, 160), readonly('updatedAt', 'date')],
  },
  {
    name: 'bookingPage',
    label: 'Booking pages',
    searchField: 'title',
    creatable: false,
    fields: [readonly('id'), text('title', true, true, 160), readonly('createdAt', 'date')],
  },
  {
    name: 'meeting',
    label: 'Meetings',
    searchField: 'inviteeEmail',
    creatable: false,
    fields: [
      readonly('id'),
      readonly('inviteeEmail'),
      readonly('startAt', 'date'),
      readonly('status'),
    ],
  },
];

export function studioModel(name: string): StudioModel | null {
  return STUDIO_MODELS.find((model) => model.name === name) ?? null;
}

function fieldSchema(field: StudioField): z.ZodTypeAny {
  switch (field.type) {
    case 'number':
      return z.coerce.number().finite();
    case 'boolean':
      return z.coerce.boolean();
    case 'date':
      return z.coerce.date();
    case 'json':
      return z.record(z.string(), z.unknown());
    default:
      return z
        .string()
        .trim()
        .min(field.required ? 1 : 0)
        .max(field.maxLength ?? 1000);
  }
}

/**
 * Validate a studio write: unknown and non-editable fields are rejected
 * (not silently dropped — the studio should never lie about what it
 * saved), values are coerced per the field type.
 */
export function validateStudioWrite(
  model: StudioModel,
  values: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = model.fields.find((candidate) => candidate.name === key);
    if (!field) return { ok: false, error: `unknown field: ${key}` };
    if (!field.editable) return { ok: false, error: `field is not editable: ${key}` };
    if (value === null || value === '') {
      if (field.required) return { ok: false, error: `${key} is required` };
      data[key] = null;
      continue;
    }
    const parsed = fieldSchema(field).safeParse(value);
    if (!parsed.success) {
      return { ok: false, error: `${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
    }
    data[key] = parsed.data;
  }
  return { ok: true, data };
}
