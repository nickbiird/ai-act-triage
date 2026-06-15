/**
 * Provider-agnostic model layer with a per-run cost meter.
 *
 * LLM_PROVIDER selects the reasoning backend — `anthropic` (default) or `google`.
 * The two tiers map across providers:
 *   fast  (input gate / query planning)                 -> Haiku 4.5  | Gemini Flash
 *   deep  (proposing the tier / adversarially refuting it) -> Sonnet 4.6 | Gemini Pro
 * Model strings are env vars, so a swap is one variable. temperature 0 on every
 * eval-asserted path keeps results reproducible; creativity is a liability here.
 *
 * Embeddings are a SEPARATE concern (lib/retrieval.ts): only Google offers an
 * embeddings API, so the dense retrieval leg needs a GOOGLE_API_KEY. With the
 * Anthropic provider and no Google key, retrieval degrades to BM25-only — a
 * measured, supported path. The reasoning provider and the embeddings provider
 * are independent: you can run reasoning on Claude and dense retrieval on Gemini
 * embeddings at the same time (the recommended setup), or Claude + BM25-only.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { z } from 'zod';
import type { UsageEntry, CostSummary } from './types';

export type Provider = 'anthropic' | 'google';
export const PROVIDER: Provider =
  (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase() === 'google' ? 'google' : 'anthropic';

const ANTHROPIC_FAST = process.env.ANTHROPIC_MODEL_FAST ?? 'claude-haiku-4-5';
const ANTHROPIC_DEEP = process.env.ANTHROPIC_MODEL_DEEP ?? 'claude-sonnet-4-6';
const GEMINI_FAST = process.env.GEMINI_MODEL_FAST ?? 'gemini-2.5-flash';
const GEMINI_DEEP = process.env.GEMINI_MODEL_DEEP ?? 'gemini-2.5-pro';

export const FAST_MODEL = PROVIDER === 'google' ? GEMINI_FAST : ANTHROPIC_FAST;
export const DEEP_MODEL = PROVIDER === 'google' ? GEMINI_DEEP : ANTHROPIC_DEEP;

/**
 * USD per 1M tokens (provider list prices, mid-2026 — verify against the
 * provider's pricing page when models change; prices are part of the eval
 * artifact, so a stale price is a reportable bug, not a rounding detail).
 * Anthropic: platform.claude.com/docs pricing. Google: ai.google.dev/pricing.
 */
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'claude-opus-4-8': { in: 5.0, out: 25.0 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
};
const USD_TO_EUR = 0.92; // fixed conversion documented in the trust report

export function priceCall(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_PER_M[model] ?? PRICE_PER_M['claude-sonnet-4-6']; // unknown model -> price conservatively (deep tier)
  return ((inputTokens * p.in + outputTokens * p.out) / 1_000_000) * USD_TO_EUR;
}

export function summarizeUsage(entries: UsageEntry[]): CostSummary {
  const inputTokens = entries.reduce((s, e) => s + e.inputTokens, 0);
  const outputTokens = entries.reduce((s, e) => s + e.outputTokens, 0);
  const eur = entries.reduce((s, e) => s + priceCall(e.model, e.inputTokens, e.outputTokens), 0);
  return { calls: entries.length, inputTokens, outputTokens, eur: Number(eur.toFixed(6)) };
}

/** The env var the active reasoning provider needs. Dense retrieval's GOOGLE_API_KEY is separate. */
export const MODEL_KEY_VAR = PROVIDER === 'google' ? 'GOOGLE_API_KEY' : 'ANTHROPIC_API_KEY';
export const hasModelKey = (): boolean => Boolean(process.env[MODEL_KEY_VAR]);

function makeModel(model: string) {
  // Both SDKs read their key from the environment (ANTHROPIC_API_KEY / GOOGLE_API_KEY),
  // so we don't pass it explicitly — we only assert presence with a clear error.
  if (!hasModelKey()) {
    throw new Error(
      `${MODEL_KEY_VAR} is not set. The reasoning calls require it (LLM_PROVIDER=${PROVIDER}). ` +
        'Retrieval, the input gate, and the deterministic gates (npm test / evals:retrieval) run with no key.',
    );
  }
  if (PROVIDER === 'google') {
    return new ChatGoogleGenerativeAI({ model, temperature: 0, maxRetries: 6 });
  }
  // Anthropic. temperature 0 is accepted on Haiku 4.5 / Sonnet 4.6 (the defaults);
  // if you set ANTHROPIC_MODEL_DEEP to Opus 4.7+/Fable, drop temperature (those reject it).
  return new ChatAnthropic({ model, temperature: 0, maxRetries: 6 });
}

/**
 * One structured call: returns the Zod-validated object plus a usage entry.
 * includeRaw keeps the chat message so token counts survive structured parsing.
 * The shape (`{parsed, raw}` + `raw.usage_metadata`) is identical across both
 * providers, so callers are provider-agnostic.
 */
type RawRes = {
  parsed: unknown;
  raw: { usage_metadata?: { input_tokens?: number; output_tokens?: number }; tool_calls?: unknown; content?: unknown };
};

export async function structuredCall<T extends z.ZodTypeAny>(opts: {
  model: 'fast' | 'deep';
  node: string;
  schema: T;
  system: string;
  user: string;
}): Promise<{ value: z.infer<T>; usage: UsageEntry }> {
  const modelName = opts.model === 'fast' ? FAST_MODEL : DEEP_MODEL;
  const llm = makeModel(modelName).withStructuredOutput(opts.schema, { includeRaw: true });

  // includeRaw makes a structured-output failure (no tool call, or args that fail
  // Zod validation) come back as `parsed: null` instead of throwing — which would
  // otherwise propagate as a cryptic null-read downstream. So we treat null as a
  // transient failure: retry once with an explicit nudge, metering both attempts;
  // if it is still null, throw an EXPLAINABLE error naming the node.
  let inTok = 0;
  let outTok = 0;
  const attempt = async (system: string): Promise<RawRes> => {
    const r = (await llm.invoke([
      ['system', system],
      ['human', opts.user],
    ])) as RawRes;
    const m = r.raw?.usage_metadata ?? {};
    inTok += m.input_tokens ?? 0;
    outTok += m.output_tokens ?? 0;
    return r;
  };

  let res = await attempt(opts.system);
  if (res.parsed == null) {
    res = await attempt(
      opts.system +
        '\n\nIMPORTANT: respond ONLY by calling the provided structured tool, with every required field populated. Do not reply with prose.',
    );
  }
  if (res.parsed == null) {
    const dump = JSON.stringify(res.raw?.tool_calls ?? res.raw?.content ?? '')?.slice(0, 200);
    throw new Error(`structured output was null for node "${opts.node}" (model ${modelName}) after one retry — the model did not emit a valid tool call. raw=${dump}`);
  }

  return {
    value: res.parsed as z.infer<T>,
    usage: { model: modelName, node: opts.node, inputTokens: inTok, outputTokens: outTok },
  };
}
