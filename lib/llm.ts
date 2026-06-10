/**
 * Gemini model layer with a per-run cost meter.
 *
 * Tiering rule: the fast tier (Flash class) routes, screens, and extracts;
 * the deep tier (Pro class) does the two calls where judgment lives —
 * proposing the classification and trying to refute it. Model strings are
 * env vars on purpose: when a new family ships, migration is one variable.
 *
 * Temperature is 0 on every eval-asserted path. Tested paths must be
 * reproducible; creativity is a liability here, not a feature.
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { z } from 'zod';
import type { UsageEntry, CostSummary } from './types';

export const FAST_MODEL = process.env.GEMINI_MODEL_FAST ?? 'gemini-2.5-flash';
export const DEEP_MODEL = process.env.GEMINI_MODEL_DEEP ?? 'gemini-2.5-pro';

/**
 * USD per 1M tokens (Gemini API list prices, June 2026 — verify against
 * ai.google.dev/pricing when models change; prices are part of the eval
 * artifact, so a stale price is a reportable bug, not a rounding detail).
 */
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
};
const USD_TO_EUR = 0.92; // fixed conversion documented in the trust report

export function priceCall(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_PER_M[model] ?? PRICE_PER_M['gemini-2.5-pro']; // unknown model -> price conservatively
  return ((inputTokens * p.in + outputTokens * p.out) / 1_000_000) * USD_TO_EUR;
}

export function summarizeUsage(entries: UsageEntry[]): CostSummary {
  const inputTokens = entries.reduce((s, e) => s + e.inputTokens, 0);
  const outputTokens = entries.reduce((s, e) => s + e.outputTokens, 0);
  const eur = entries.reduce((s, e) => s + priceCall(e.model, e.inputTokens, e.outputTokens), 0);
  return { calls: entries.length, inputTokens, outputTokens, eur: Number(eur.toFixed(6)) };
}

function makeModel(model: string, apiKey?: string) {
  return new ChatGoogleGenerativeAI({
    model,
    temperature: 0,
    apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
  });
}

/**
 * One structured call: returns the Zod-validated object plus a usage entry.
 * includeRaw keeps the AIMessage so token counts survive structured parsing.
 */
export async function structuredCall<T extends z.ZodTypeAny>(opts: {
  model: 'fast' | 'deep';
  node: string;
  schema: T;
  system: string;
  user: string;
  apiKey?: string;
}): Promise<{ value: z.infer<T>; usage: UsageEntry }> {
  const modelName = opts.model === 'fast' ? FAST_MODEL : DEEP_MODEL;
  const llm = makeModel(modelName, opts.apiKey).withStructuredOutput(opts.schema, {
    includeRaw: true,
  });
  const res = (await llm.invoke([
    ['system', opts.system],
    ['human', opts.user],
  ])) as { parsed: z.infer<T>; raw: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } };

  const meta = res.raw?.usage_metadata ?? {};
  return {
    value: res.parsed,
    usage: {
      model: modelName,
      node: opts.node,
      inputTokens: meta.input_tokens ?? 0,
      outputTokens: meta.output_tokens ?? 0,
    },
  };
}
