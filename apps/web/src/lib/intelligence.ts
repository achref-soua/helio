import { TRPCError } from '@trpc/server';

import { env } from './env';

/**
 * Typed client for the Python intelligence service. The dashboard is the
 * only caller: it authenticates the user and forwards the *verified*
 * organization and workspace ids, which the service then enforces via
 * RLS. Failures surface as actionable tRPC errors — the AI plane is an
 * optional service, so the rest of the product never breaks when it is
 * down or unconfigured.
 */
async function call<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.INTELLIGENCE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The AI service is unreachable — start apps/intelligence (uv run uvicorn …).',
    });
  }
  if (response.status === 503) {
    // The service says exactly what is missing (key, database, analytics
    // store); show that instead of a one-size-fits-all guess.
    const detail = await response
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => undefined);
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: detail
        ? `The AI service is not ready: ${detail}.`
        : 'The AI copilot is not configured — set INTEL_LLM_API_KEY and INTEL_DATABASE_URL.',
    });
  }
  if (response.status === 422) {
    const detail = await response
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => undefined);
    throw new TRPCError({ code: 'BAD_REQUEST', message: detail ?? 'The AI could not do that.' });
  }
  if (!response.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The AI service errored.' });
  }
  return (await response.json()) as T;
}

export interface ChatReply {
  text: string;
  tool_calls_made: number;
  iterations: number;
}

export interface DraftSegment {
  name: string;
  rule: unknown;
}

export interface DraftJourney {
  name: string;
  definition: unknown;
}

export interface DraftEmail {
  name: string;
  subject: string;
  document: unknown;
}

export interface ScoringResult {
  scored: number;
  conversion_method: string;
  churn_method: string;
  converted: number;
  churned: number;
}

export interface LlmInfo {
  provider: string;
  model: string;
  configured: boolean;
  source: 'organization' | 'deployment';
}

/** A model-validation verdict: `ok: false` is an answer, not an error. */
export interface ModelVerdict {
  ok: boolean;
  error: string | null;
  sha256?: string | null;
  size_bytes?: number | null;
}

export const intelligence = {
  chat: (input: {
    organization_id: string;
    workspace_id: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => call<ChatReply>('/v1/copilot/chat', input),

  llmInfo: (input: { organization_id: string }) => call<LlmInfo>('/v1/llm/config', input),

  draftSegment: (input: { organization_id: string; workspace_id: string; prompt: string }) =>
    call<DraftSegment>('/v1/copilot/segment', input),

  draftJourney: (input: { organization_id: string; workspace_id: string; prompt: string }) =>
    call<DraftJourney>('/v1/copilot/journey', input),

  draftEmail: (input: { organization_id: string; workspace_id: string; prompt: string }) =>
    call<DraftEmail>('/v1/copilot/email', input),

  recompute: (input: { organization_id: string; workspace_id: string }) =>
    call<ScoringResult>('/v1/scoring/recompute', input),

  validateModelEndpoint: (input: {
    organization_id: string;
    url: string;
    auth_header?: string;
    inputs: string[];
  }) => call<ModelVerdict>('/v1/models/churn/validate-endpoint', input),

  validateModelArtifact: (input: {
    organization_id: string;
    model_id: string;
    format: string;
    n_inputs: number;
  }) => call<ModelVerdict>('/v1/models/churn/validate-artifact', input),

  deleteModelArtifact: (input: { organization_id: string; model_id: string }) =>
    call<ModelVerdict>('/v1/models/churn/delete-artifact', input),
};
