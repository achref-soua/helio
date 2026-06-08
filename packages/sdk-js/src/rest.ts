/**
 * Helio REST API client — a thin, type-safe wrapper over the public gateway
 * (apps/api). The types are generated from the gateway's OpenAPI 3.1 document
 * (`pnpm --filter @helio/sdk-js generate`, kept in sync by a test); this
 * client is a small hand-written, dependency-free surface on top of them.
 *
 * Runs anywhere a global `fetch` exists (Node 18+, Bun, Deno, browsers). The
 * API key grants full org access, so use it server-side — never ship it to a
 * browser. For browser event tracking use the default `@helio/sdk-js` export.
 */
import type { components } from './openapi';

type Schemas = components['schemas'];

export type Workspace = Schemas['Workspace'];
export type Contact = Schemas['Contact'];
export type ContactList = Schemas['List'];
export type Problem = Schemas['Problem'];
export type CreateWorkspaceInput = Schemas['CreateWorkspaceRequest'];
export type CreateContactInput = Schemas['CreateContactRequest'];
export type UpdateContactInput = Schemas['UpdateContactRequest'];
export type CreateListInput = Schemas['CreateListRequest'];

export interface HelioApiClientOptions {
  /** Per-organization API key from Settings → API keys (`hk_<org>.<secret>`). */
  apiKey: string;
  /** Gateway base URL, e.g. `https://api.helio.example`. */
  baseUrl: string;
  /** Override the fetch implementation (tests, custom agents). Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Per-call options for mutating requests. */
export interface RequestOptions {
  /** Replay-safe retries: repeating a key returns the original response. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export type ListContactsParams = {
  workspaceId?: string;
  listId?: string;
  search?: string;
  limit?: number;
  cursor?: string;
};

export type ListListsParams = {
  workspaceId?: string;
  limit?: number;
  cursor?: string;
};

/** One page of a cursor-paginated collection. */
export interface Page<T> {
  data: T[];
  /** Pass as `cursor` to fetch the next page; null on the last page. */
  nextCursor: string | null;
}

/** Thrown on any non-2xx response; carries the RFC 9457 problem document. */
export class HelioApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail?: string;

  constructor(problem: Problem) {
    super(problem.detail ? `${problem.title}: ${problem.detail}` : problem.title);
    this.name = 'HelioApiError';
    this.status = problem.status;
    this.type = problem.type;
    this.detail = problem.detail;
  }
}

interface RequestInitLike {
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class HelioApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HelioApiClientOptions) {
    if (!options.apiKey) throw new Error('HelioApiClient: apiKey is required');
    if (!options.baseUrl) throw new Error('HelioApiClient: baseUrl is required');
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error('HelioApiClient: no fetch implementation available');
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  readonly workspaces = {
    list: (): Promise<Workspace[]> => this.request<Workspace[]>('GET', '/v1/workspaces'),
    create: (input: CreateWorkspaceInput, options?: RequestOptions): Promise<Workspace> =>
      this.request<Workspace>('POST', '/v1/workspaces', { body: input, ...options }),
  };

  readonly contacts = {
    list: (params: ListContactsParams = {}): Promise<Page<Contact>> =>
      this.request<Page<Contact>>('GET', '/v1/contacts', { query: params }),
    create: (input: CreateContactInput, options?: RequestOptions): Promise<Contact> =>
      this.request<Contact>('POST', '/v1/contacts', { body: input, ...options }),
    get: (id: string): Promise<Contact> =>
      this.request<Contact>('GET', `/v1/contacts/${encodeURIComponent(id)}`),
    update: (id: string, input: UpdateContactInput, options?: RequestOptions): Promise<Contact> =>
      this.request<Contact>('PATCH', `/v1/contacts/${encodeURIComponent(id)}`, {
        body: input,
        ...options,
      }),
    delete: (id: string): Promise<void> =>
      this.request<void>('DELETE', `/v1/contacts/${encodeURIComponent(id)}`),
  };

  readonly lists = {
    list: (params: ListListsParams = {}): Promise<Page<ContactList>> =>
      this.request<Page<ContactList>>('GET', '/v1/lists', { query: params }),
    create: (input: CreateListInput, options?: RequestOptions): Promise<ContactList> =>
      this.request<ContactList>('POST', '/v1/lists', { body: input, ...options }),
    get: (id: string): Promise<ContactList> =>
      this.request<ContactList>('GET', `/v1/lists/${encodeURIComponent(id)}`),
    delete: (id: string): Promise<void> =>
      this.request<void>('DELETE', `/v1/lists/${encodeURIComponent(id)}`),
    addMembers: (
      id: string,
      contactIds: string[],
      options?: RequestOptions,
    ): Promise<{ added: number }> =>
      this.request<{ added: number }>('POST', `/v1/lists/${encodeURIComponent(id)}/members`, {
        body: { contactIds },
        ...options,
      }),
    removeMember: (id: string, contactId: string): Promise<void> =>
      this.request<void>(
        'DELETE',
        `/v1/lists/${encodeURIComponent(id)}/members/${encodeURIComponent(contactId)}`,
      ),
  };

  private async request<T>(method: string, path: string, init: RequestInitLike = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });

    if (!response.ok) throw await toError(response);
    // 204 No Content (deletes) carries no body.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** Build a HelioApiError from a response, tolerating non-problem bodies. */
async function toError(response: Response): Promise<HelioApiError> {
  let problem: Problem = {
    type: `urn:helio:problem:http_${response.status}`,
    title: response.statusText || 'request failed',
    status: response.status,
  };
  try {
    const body = (await response.json()) as Partial<Problem> | null;
    if (body && typeof body.status === 'number') problem = { ...problem, ...body };
  } catch {
    /* non-JSON error body; keep the synthesized problem */
  }
  return new HelioApiError(problem);
}
