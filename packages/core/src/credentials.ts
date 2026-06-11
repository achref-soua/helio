import { z } from 'zod';

/**
 * The per-kind contract for the organization credential vault (ADR-0019).
 * Each kind declares its non-secret connection config (zod-validated) and
 * which fields are secrets. Secret values are sealed into envelopes by the
 * server (see crypto-envelope.ts) and NEVER travel back to clients — reads
 * render a mask from the `{ last4, setAt }` metadata captured at write
 * time.
 */

export const CREDENTIAL_KINDS = [
  'EMAIL_SMTP',
  'EMAIL_POSTMARK',
  'EMAIL_RESEND',
  'EMAIL_MAILGUN',
  'SMS_TWILIO',
  'WHATSAPP_CLOUD',
  'LLM',
  'CHURN_ENDPOINT',
  'IMPORT_HUBSPOT',
  'IMPORT_MAILCHIMP',
  'IMPORT_KLAVIYO',
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const credentialKindSchema = z.enum(CREDENTIAL_KINDS);

/** Which product surface a kind powers — drives grouping in settings. */
export type CredentialChannel = 'email' | 'sms' | 'whatsapp' | 'ai' | 'model' | 'import';

export interface SecretFieldSpec {
  name: string;
  label: string;
  /** Optional secrets may be omitted (e.g. unauthenticated SMTP, local LLMs). */
  optional?: boolean;
}

/** UI metadata for one config key — the settings form renders from this. */
export interface ConfigFieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
}

export interface CredentialKindSpec {
  kind: CredentialKind;
  label: string;
  channel: CredentialChannel;
  configSchema: z.ZodTypeAny;
  configFields: ConfigFieldSpec[];
  secretFields: SecretFieldSpec[];
}

const fromFields = {
  fromEmail: z.string().trim().email().max(254),
  fromName: z.string().trim().min(1).max(80).optional(),
};

export const LLM_PROVIDERS = ['openai', 'anthropic', 'groq', 'ollama', 'local'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const REGISTRY: Record<CredentialKind, CredentialKindSpec> = {
  EMAIL_SMTP: {
    kind: 'EMAIL_SMTP',
    label: 'SMTP',
    channel: 'email',
    configSchema: z
      .object({
        host: z.string().trim().min(1).max(253),
        port: z.coerce.number().int().min(1).max(65535),
        secure: z.boolean().default(false),
        user: z.string().trim().min(1).max(254).optional(),
        ...fromFields,
      })
      .strict(),
    configFields: [
      {
        name: 'host',
        label: 'Host',
        type: 'text',
        placeholder: 'smtp.example.com',
        required: true,
      },
      { name: 'port', label: 'Port', type: 'number', placeholder: '587', required: true },
      { name: 'secure', label: 'Use TLS (port 465)', type: 'checkbox' },
      { name: 'user', label: 'Username', type: 'text' },
      {
        name: 'fromEmail',
        label: 'From email',
        type: 'text',
        placeholder: 'hello@yourdomain.com',
        required: true,
      },
      { name: 'fromName', label: 'From name', type: 'text', placeholder: 'Acme Inc.' },
    ],
    secretFields: [{ name: 'password', label: 'SMTP password', optional: true }],
  },
  EMAIL_POSTMARK: {
    kind: 'EMAIL_POSTMARK',
    label: 'Postmark',
    channel: 'email',
    configSchema: z
      .object({ messageStream: z.string().trim().min(1).max(80).optional(), ...fromFields })
      .strict(),
    configFields: [
      { name: 'fromEmail', label: 'From email', type: 'text', required: true },
      { name: 'fromName', label: 'From name', type: 'text' },
      { name: 'messageStream', label: 'Message stream', type: 'text', placeholder: 'outbound' },
    ],
    secretFields: [{ name: 'serverToken', label: 'Server API token' }],
  },
  EMAIL_RESEND: {
    kind: 'EMAIL_RESEND',
    label: 'Resend',
    channel: 'email',
    configSchema: z.object({ ...fromFields }).strict(),
    configFields: [
      { name: 'fromEmail', label: 'From email', type: 'text', required: true },
      { name: 'fromName', label: 'From name', type: 'text' },
    ],
    secretFields: [{ name: 'apiKey', label: 'API key' }],
  },
  EMAIL_MAILGUN: {
    kind: 'EMAIL_MAILGUN',
    label: 'Mailgun',
    channel: 'email',
    configSchema: z
      .object({
        domain: z.string().trim().min(3).max(253),
        region: z.enum(['us', 'eu']).default('us'),
        ...fromFields,
      })
      .strict(),
    configFields: [
      {
        name: 'domain',
        label: 'Sending domain',
        type: 'text',
        placeholder: 'mg.yourdomain.com',
        required: true,
      },
      { name: 'region', label: 'Region', type: 'select', options: ['us', 'eu'], required: true },
      { name: 'fromEmail', label: 'From email', type: 'text', required: true },
      { name: 'fromName', label: 'From name', type: 'text' },
    ],
    secretFields: [{ name: 'apiKey', label: 'API key' }],
  },
  SMS_TWILIO: {
    kind: 'SMS_TWILIO',
    label: 'Twilio SMS',
    channel: 'sms',
    configSchema: z
      .object({
        accountSid: z
          .string()
          .trim()
          .regex(/^AC[0-9a-fA-F]{32}$/, 'must be an AC… account SID'),
        fromNumber: z
          .string()
          .trim()
          .regex(/^\+[1-9]\d{6,14}$/, 'must be E.164, e.g. +15555550100'),
      })
      .strict(),
    configFields: [
      {
        name: 'accountSid',
        label: 'Account SID',
        type: 'text',
        placeholder: 'AC…',
        required: true,
      },
      {
        name: 'fromNumber',
        label: 'From number',
        type: 'text',
        placeholder: '+15555550100',
        required: true,
      },
    ],
    secretFields: [{ name: 'authToken', label: 'Auth token' }],
  },
  WHATSAPP_CLOUD: {
    kind: 'WHATSAPP_CLOUD',
    label: 'WhatsApp Cloud API',
    channel: 'whatsapp',
    configSchema: z.object({ phoneNumberId: z.string().trim().min(1).max(64) }).strict(),
    configFields: [
      { name: 'phoneNumberId', label: 'Phone number ID', type: 'text', required: true },
    ],
    secretFields: [{ name: 'accessToken', label: 'Access token' }],
  },
  LLM: {
    kind: 'LLM',
    label: 'AI provider',
    channel: 'ai',
    configSchema: z
      .object({
        provider: z.enum(LLM_PROVIDERS),
        model: z.string().trim().min(1).max(120),
        baseUrl: z.string().trim().url().max(500).optional(),
        temperature: z.coerce.number().min(0).max(2).optional(),
        maxTokens: z.coerce.number().int().min(1).max(128000).optional(),
      })
      .strict(),
    configFields: [
      {
        name: 'provider',
        label: 'Provider',
        type: 'select',
        options: [...LLM_PROVIDERS],
        required: true,
      },
      {
        name: 'model',
        label: 'Model',
        type: 'text',
        placeholder: 'llama-3.3-70b-versatile',
        required: true,
      },
      {
        name: 'baseUrl',
        label: 'Base URL (self-hosted)',
        type: 'text',
        placeholder: 'http://localhost:11434/v1',
      },
      { name: 'temperature', label: 'Temperature', type: 'number' },
      { name: 'maxTokens', label: 'Max tokens', type: 'number' },
    ],
    secretFields: [{ name: 'apiKey', label: 'API key', optional: true }],
  },
  CHURN_ENDPOINT: {
    kind: 'CHURN_ENDPOINT',
    label: 'Churn model endpoint',
    channel: 'model',
    configSchema: z
      .object({
        url: z
          .string()
          .trim()
          .url()
          .max(500)
          .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
            message: 'must be an http(s) URL',
          }),
      })
      .strict(),
    configFields: [
      {
        name: 'url',
        label: 'Predict URL',
        type: 'text',
        placeholder: 'https://models.internal/churn',
        required: true,
      },
    ],
    secretFields: [{ name: 'authHeader', label: 'Authorization header value', optional: true }],
  },
  IMPORT_HUBSPOT: {
    kind: 'IMPORT_HUBSPOT',
    label: 'HubSpot',
    channel: 'import',
    configSchema: z.object({}).strict(),
    configFields: [],
    secretFields: [{ name: 'accessToken', label: 'Private app access token' }],
  },
  IMPORT_MAILCHIMP: {
    kind: 'IMPORT_MAILCHIMP',
    label: 'Mailchimp',
    channel: 'import',
    configSchema: z.object({}).strict(),
    configFields: [],
    secretFields: [{ name: 'apiKey', label: 'API key' }],
  },
  IMPORT_KLAVIYO: {
    kind: 'IMPORT_KLAVIYO',
    label: 'Klaviyo',
    channel: 'import',
    configSchema: z.object({}).strict(),
    configFields: [],
    secretFields: [{ name: 'apiKey', label: 'Private API key' }],
  },
};

export function credentialSpec(kind: CredentialKind): CredentialKindSpec {
  return REGISTRY[kind];
}

export function credentialKindsForChannel(channel: CredentialChannel): CredentialKindSpec[] {
  return CREDENTIAL_KINDS.map((kind) => REGISTRY[kind]).filter((spec) => spec.channel === channel);
}

/** The trailing fragment kept for masked display, captured at write time. */
export function secretLast4(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}

/** Render a stored last4 as the UI mask. */
export function maskSecret(last4: string | null | undefined): string {
  return last4 ? `••••${last4}` : '••••••••';
}

export interface SecretMetaEntry {
  last4: string;
  setAt: string;
}

export type SecretsMeta = Record<string, SecretMetaEntry>;

export interface MaskedCredential {
  id: string;
  kind: CredentialKind;
  name: string;
  config: Record<string, unknown>;
  /** field name → mask; derived from secretsMeta only, never from secrets. */
  secretPreviews: Record<string, string>;
  status: 'UNVERIFIED' | 'VERIFIED' | 'FAILED';
  lastVerifiedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

/**
 * The only credential shape that may leave the server. Reads must select
 * everything EXCEPT `secrets`; this maps what's left into the wire shape.
 */
export function toMaskedCredential(row: {
  id: string;
  kind: CredentialKind;
  name: string;
  config: unknown;
  secretsMeta: unknown;
  status: 'UNVERIFIED' | 'VERIFIED' | 'FAILED';
  lastVerifiedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}): MaskedCredential {
  const meta = (row.secretsMeta ?? {}) as SecretsMeta;
  const secretPreviews: Record<string, string> = {};
  for (const field of credentialSpec(row.kind).secretFields) {
    const entry = meta[field.name];
    if (entry) secretPreviews[field.name] = maskSecret(entry.last4);
  }
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: (row.config ?? {}) as Record<string, unknown>,
    secretPreviews,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ValidatedCredentialInput {
  kind: CredentialKind;
  name: string;
  config: Record<string, unknown>;
  /** Plaintext secrets to (re)seal; omitted fields keep their stored value. */
  secrets: Record<string, string>;
}

const credentialInputSchema = z.object({
  kind: credentialKindSchema,
  name: z.string().trim().min(1).max(80),
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string().min(1).max(8192)).default({}),
});

/**
 * Validate an upsert payload against the kind's contract: config must parse
 * the kind's schema and every provided secret must be a declared field.
 * Required secrets are only enforced on create (`requireSecrets`) — updates
 * may omit them to keep the stored value.
 */
export function validateCredentialInput(
  input: unknown,
  options: { requireSecrets: boolean },
): ValidatedCredentialInput {
  const base = credentialInputSchema.parse(input);
  const spec = credentialSpec(base.kind);
  const config = spec.configSchema.parse(base.config) as Record<string, unknown>;

  const declared = new Set(spec.secretFields.map((field) => field.name));
  for (const provided of Object.keys(base.secrets)) {
    if (!declared.has(provided)) {
      throw new z.ZodError([
        {
          code: 'custom',
          message: `unknown secret field "${provided}" for ${base.kind}`,
          path: ['secrets', provided],
          input: undefined,
        },
      ]);
    }
  }
  if (options.requireSecrets) {
    for (const field of spec.secretFields) {
      if (!field.optional && !base.secrets[field.name]) {
        throw new z.ZodError([
          {
            code: 'custom',
            message: `secret "${field.name}" is required for ${base.kind}`,
            path: ['secrets', field.name],
            input: undefined,
          },
        ]);
      }
    }
  }
  return { kind: base.kind, name: base.name, config, secrets: base.secrets };
}
