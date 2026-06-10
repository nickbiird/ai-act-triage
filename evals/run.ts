/**
 * Assessment evals: runs the 60-case golden set through the full pipeline
 * (HITL auto-approved — evals measure the model pipeline; the gate is process)
 * and scores tier accuracy per split, citation faithfulness, cost, latency.
 *
 * Modes:
 *   npm run evals             live run (needs GOOGLE_API_KEY), writes scorecard
 *   npm run evals -- --record live run + writes evals/fixtures/assessments.json
 *   npm run evals -- --replay scores the committed fixtures, zero model calls
 *                             (this is what CI runs — regression gate without a key)
 *
 * Thresholds (CI fails below): core accuracy >= 0.80, citation resolution >= 0.95.
 * Contested accuracy is REPORTED but not gated: those labels are one documented
 * reading of genuinely arguable cases (see evals/golden/RUBRIC.md).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MemorySaver } from '@langchain/langgraph';
import { buildGraph } from '../lib/graph';
import { citationResolves } from '../lib/corpus';
import { loadCorpus } from '../lib/corpus';
import { FAST_MODEL, DEEP_MODEL } from '../lib/llm';
import { TIERS, type Tier } from '../lib/types';

interface GoldenCase {
  id: string;
  description: string;
  expected_tier: Tier;
  basis: string[];
  split: 'core' | 'contested';
}

interface CaseResult {
  id: string;
  expected: Tier;
  predicted: Tier | 'guard_fail' | 'error';
  split: 'core' | 'contested';
  citations: string[];
  critiqueVerdict: string | null;
  revised: boolean;
  costEur: number;
  latencyMs: number;
}

const THRESHOLDS = { coreAccuracy: 0.8, citationRate: 0.95 };
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 2);

const root = process.cwd();
const fixturePath = path.join(root, 'evals', 'fixtures', 'assessments.json');
const resultsDir = path.join(root, 'evals', 'results');

async function runLive(cases: GoldenCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= cases.length) return;
      const c = cases[idx];
      const t0 = Date.now();
      try {
        const graph = buildGraph().compile({ checkpointer: new MemorySaver() });
        const out = await graph.invoke(
          { description: c.description, hitlMode: 'ephemeral-memory' },
          {
            configurable: { thread_id: `eval-${c.id}`, auto_approve: true },
            recursionLimit: 25,
          },
        );
        const r = out.report;
        results.push({
          id: c.id,
          expected: c.expected_tier,
          predicted: out.guardFail ? 'guard_fail' : (r?.tier ?? 'error'),
          split: c.split,
          citations: r?.proposal.citations ?? [],
          critiqueVerdict: r?.critique?.verdict ?? null,
          revised: r?.revised ?? false,
          costEur: r?.cost.eur ?? 0,
          latencyMs: Date.now() - t0,
        });
        console.log(`  ${c.id}: expected ${c.expected_tier}, got ${results[results.length - 1].predicted} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (err) {
        console.error(`  ${c.id}: ERROR ${err instanceof Error ? err.message.slice(0, 120) : err}`);
        results.push({
          id: c.id, expected: c.expected_tier, predicted: 'error', split: c.split,
          citations: [], critiqueVerdict: null, revised: false, costEur: 0,
          latencyMs: Date.now() - t0,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function score(results: CaseResult[]) {
  const splits: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const split of ['core', 'contested'] as const) {
    const rs = results.filter((r) => r.split === split);
    const correct = rs.filter((r) => r.predicted === r.expected).length;
    splits[split] = { total: rs.length, correct, accuracy: rs.length ? correct / rs.length : 0 };
  }
  const confusion: Record<string, Record<string, number>> = {};
  for (const t of TIERS) confusion[t] = Object.fromEntries([...TIERS, 'guard_fail', 'error'].map((p) => [p, 0]));
  for (const r of results) confusion[r.expected][r.predicted] += 1;

  const allCitations = results.flatMap((r) => r.citations);
  const resolved = allCitations.filter((c) => citationResolves(c)).length;

  const costs = results.map((r) => r.costEur).filter((c) => c > 0);
  const latencies = results.map((r) => r.latencyMs).filter((l) => l > 0);

  return {
    generatedAt: new Date().toISOString(),
    corpusVersion: loadCorpus().version,
    models: { fast: FAST_MODEL, deep: DEEP_MODEL },
    splits,
    confusion,
    citationFaithfulness: {
      totalCitations: allCitations.length,
      resolved,
      rate: allCitations.length ? resolved / allCitations.length : 0,
    },
    cost: {
      meanEurPerAssessment: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      totalEur: costs.reduce((a, b) => a + b, 0),
    },
    latency: { p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95) },
    failures: results
      .filter((r) => r.predicted !== r.expected)
      .map((r) => ({ id: r.id, expected: r.expected, predicted: r.predicted })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const replay = args.includes('--replay');
  const record = args.includes('--record');

  const cases: GoldenCase[] = JSON.parse(
    await readFile(path.join(root, 'evals', 'golden', 'cases.json'), 'utf8'),
  );

  let results: CaseResult[];
  if (replay) {
    if (!existsSync(fixturePath)) {
      console.log('REPLAY: no fixtures committed yet (evals/fixtures/assessments.json).');
      console.log('Run `npm run evals -- --record` with GOOGLE_API_KEY to record a run, then commit it.');
      console.log('Skipping assessment gate — retrieval and unit-test gates still apply.');
      return;
    }
    results = JSON.parse(await readFile(fixturePath, 'utf8'));
    console.log(`REPLAY: scoring ${results.length} recorded assessments (zero model calls).`);
  } else {
    if (!process.env.GOOGLE_API_KEY) {
      console.error('GOOGLE_API_KEY required for live evals. Use --replay to score committed fixtures.');
      process.exit(1);
    }
    console.log(`LIVE: running ${cases.length} cases (concurrency ${CONCURRENCY}, models ${FAST_MODEL}/${DEEP_MODEL})...`);
    results = await runLive(cases);
    if (record) {
      await mkdir(path.dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, JSON.stringify(results, null, 1));
      console.log(`Recorded fixtures -> ${path.relative(root, fixturePath)}`);
    }
  }

  const card = score(results);
  await mkdir(resultsDir, { recursive: true });
  await writeFile(path.join(resultsDir, 'assessment-scorecard.json'), JSON.stringify(card, null, 1));

  console.log('\n=== Assessment scorecard ===');
  console.log(`core:      ${card.splits.core.correct}/${card.splits.core.total} (${(card.splits.core.accuracy * 100).toFixed(1)}%)`);
  console.log(`contested: ${card.splits.contested.correct}/${card.splits.contested.total} (${(card.splits.contested.accuracy * 100).toFixed(1)}%)`);
  console.log(`citations: ${card.citationFaithfulness.resolved}/${card.citationFaithfulness.totalCitations} resolve (${(card.citationFaithfulness.rate * 100).toFixed(1)}%)`);
  console.log(`cost:      €${card.cost.meanEurPerAssessment.toFixed(4)} mean / €${card.cost.totalEur.toFixed(2)} total`);
  console.log(`latency:   p50 ${(card.latency.p50Ms / 1000).toFixed(1)}s, p95 ${(card.latency.p95Ms / 1000).toFixed(1)}s`);
  if (card.failures.length) {
    console.log(`failures:  ${card.failures.map((f) => f.id).join(', ')}`);
  }

  const gateFailures: string[] = [];
  if (card.splits.core.accuracy < THRESHOLDS.coreAccuracy)
    gateFailures.push(`core accuracy ${(card.splits.core.accuracy * 100).toFixed(1)}% < ${THRESHOLDS.coreAccuracy * 100}%`);
  if (card.citationFaithfulness.rate < THRESHOLDS.citationRate)
    gateFailures.push(`citation resolution ${(card.citationFaithfulness.rate * 100).toFixed(1)}% < ${THRESHOLDS.citationRate * 100}%`);
  if (gateFailures.length) {
    console.error(`\nGATE FAILED: ${gateFailures.join('; ')}`);
    process.exit(1);
  }
  console.log('\nGate passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
