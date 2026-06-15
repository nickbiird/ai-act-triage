/**
 * Capture ONE real assessment and write it to public/demo-run.json. The web
 * "▶ Run recorded demo" button replays THIS run entirely client-side — no API
 * key, zero model calls — so the live Vercel deploy is free to click and a screen
 * recording can't 429 mid-take. This script is the ONLY step that costs anything:
 * one assessment, a few cents on Claude (Haiku 4.5 / Sonnet 4.6).
 *
 * It captures the GENUINE two-phase flow the live routes produce:
 *   phase 1 — stream guard -> plan_queries -> retrieve -> propose -> critic, pause
 *             on the durable interrupt (awaiting_approval)
 *   phase 2 — resume with an approve decision -> gate -> report
 * Both phases go through stream.ts::eventsForUpdate, the same mapper the live
 * /api/assess + /api/resume routes use, so the recorded events are byte-identical
 * to a live stream. The replay just feeds them back through the page's event
 * handler with small delays.
 *
 * The chosen use case is a clean-room synthetic CV-screener — Annex III employment,
 * the "expensive" high-risk case the tool exists to catch. No PII, no client data.
 *
 * Run:  npm run capture:demo   (LLM_PROVIDER=anthropic default -> needs ANTHROPIC_API_KEY;
 *                               a GOOGLE_API_KEY enables the dense retrieval leg)
 */
import '../lib/loadenv';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MemorySaver, Command } from '@langchain/langgraph';
import { buildGraph } from '../lib/graph';
import { eventsForUpdate, type SseEvent } from '../lib/stream';
import { hasModelKey, MODEL_KEY_VAR, PROVIDER, FAST_MODEL, DEEP_MODEL } from '../lib/llm';

const DESCRIPTION =
  'We are a Spanish logistics company with 800 employees. We want to deploy a tool that reads incoming CVs, scores candidates from 1 to 100 on predicted job fit, and auto-rejects the bottom 60% before a recruiter ever sees them.';

async function main() {
  if (!hasModelKey()) {
    console.error(`capture:demo needs ${MODEL_KEY_VAR} (LLM_PROVIDER=${PROVIDER}). Add it to .env, then re-run.`);
    process.exit(1);
  }
  const denseOn = Boolean(process.env.GOOGLE_API_KEY);
  console.log(
    `Capturing one real assessment (provider=${PROVIDER}, fast=${FAST_MODEL}, deep=${DEEP_MODEL}, ` +
      `retrieval=${denseOn ? 'dense (Gemini embeddings)' : 'BM25-only — set GOOGLE_API_KEY for dense'})...`,
  );

  const graph = buildGraph().compile({ checkpointer: new MemorySaver() });
  const threadId = 'capture-demo';
  const cfg = { configurable: { thread_id: threadId } } as const;

  // Phase 1: stream to the durable interrupt (the approval gate).
  const preEvents: SseEvent[] = [];
  for await (const update of await graph.stream(
    { description: DESCRIPTION, hitlMode: 'ephemeral-memory' },
    { ...cfg, streamMode: 'updates' },
  )) {
    for (const e of eventsForUpdate(update as Record<string, unknown>, threadId)) {
      if (e.type === 'guard_fail' || e.type === 'error') {
        console.error('Pipeline did not reach the gate:', JSON.stringify(e.data).slice(0, 200));
        process.exit(1);
      }
      preEvents.push(e);
      if (e.type === 'node') console.log(`  ${e.node}`);
    }
  }
  const awaiting = preEvents.find((e) => e.type === 'awaiting_approval');
  if (!awaiting) {
    console.error('No awaiting_approval interrupt captured — the gate did not fire.');
    process.exit(1);
  }

  // Phase 2: resume with an approve decision -> gate -> report.
  const postEvents: SseEvent[] = [];
  for await (const update of await graph.stream(
    new Command({ resume: { approved: true, tierOverride: null, note: null } }),
    { ...cfg, streamMode: 'updates' },
  )) {
    for (const e of eventsForUpdate(update as Record<string, unknown>, threadId)) postEvents.push(e);
  }
  const reportEvent = postEvents.find((e) => e.type === 'report');
  if (!reportEvent) {
    console.error('No report produced on resume.');
    process.exit(1);
  }
  const report = reportEvent.data as { tier: string; cost: { eur: number }; retrievalMode: string };

  const out = {
    version: 1,
    provenance:
      `Real two-phase assessment captured via 'npm run capture:demo' on ${PROVIDER} ` +
      `(${FAST_MODEL} fast / ${DEEP_MODEL} deep). The web "Run recorded demo" button replays THIS run ` +
      'client-side with zero API calls. Synthetic clean-room use case; no PII; open-sourceable by construction.',
    captured_at: new Date().toISOString(),
    description: DESCRIPTION,
    preEvents, // node trace ending in awaiting_approval — replayed one step at a time
    postEvents, // gate decision + report — replayed on "Approve"
  };

  const dir = path.join(process.cwd(), 'public');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'demo-run.json');
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');

  console.log(`\nWrote ${path.relative(process.cwd(), file)} — tier=${report.tier}, retrieval=${report.retrievalMode}, cost €${report.cost.eur.toFixed(4)}.`);
  console.log('Done. Click "Run recorded demo" in the app — it replays this with no key.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
