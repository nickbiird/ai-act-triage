/**
 * Retrieval scorecard: each golden case's description is the query; the
 * articles/annexes in its labelled legal basis are the relevant documents.
 * Compares configurations head-to-head — the defended-trade-off artifact for
 * the chunking + hybrid claims in the README.
 *
 *   bm25-only   deterministic, runs anywhere (this is the CI regression gate)
 *   dense-only  needs data/embeddings.json + GOOGLE_API_KEY (query embedding)
 *   hybrid      both legs + RRF
 *
 * Metrics: recall@5 over expanded parents, MRR over the first relevant parent.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { retrieve, type RetrievalMode } from '../lib/retrieval';
import { loadCorpus, loadEmbeddings, citationToDocId, getDoc } from '../lib/corpus';
import { structuredCall } from '../lib/llm';
import { QueryPlanSchema } from '../lib/types';

interface GoldenCase {
  id: string;
  description: string;
  basis: string[];
  split: string;
}

/**
 * Measured baseline (corpus aia-oj-2024-06-13, residue-cleaned): bm25-only
 * recall@5 = 26.7% on RAW descriptions. Low by design — product-lead
 * paraphrase ("imperceptible flicker patterns") misses statute vocabulary
 * ("subliminal techniques"). That gap is the measured argument for the dense
 * leg and for query transformation; the gate sits just under the baseline and
 * only ratchets UP, never silently down.
 */
const BM25_RECALL_GATE = 0.2;

function scoreRanks(parentIds: string[], relevant: Set<string>) {
  const rank = parentIds.findIndex((id) => relevant.has(id));
  return { hit5: rank >= 0 && rank < 5, rr: rank >= 0 ? 1 / (rank + 1) : 0 };
}

async function evalConfig(cases: GoldenCase[], mode: RetrievalMode) {
  let hits = 0;
  let rrSum = 0;
  for (const c of cases) {
    const relevant = new Set(c.basis.map(citationToDocId).filter(Boolean) as string[]);
    if (!relevant.size) continue;
    const r = await retrieve(c.description, { k: 10, mode });
    const { hit5, rr } = scoreRanks(r.parents.map((p) => p.id), relevant);
    if (hit5) hits += 1;
    rrSum += rr;
  }
  return {
    name: mode,
    queries: cases.length,
    recallAt5: hits / cases.length,
    mrr: rrSum / cases.length,
  };
}

/**
 * What the live pipeline actually does: Flash transforms the description into
 * Act-vocabulary queries first, then retrieval runs per query and merges.
 * Measured separately so the lift from each stage is attributable.
 */
async function evalQueryTransform(cases: GoldenCase[], mode: RetrievalMode) {
  let hits = 0;
  let rrSum = 0;
  for (const c of cases) {
    const relevant = new Set(c.basis.map(citationToDocId).filter(Boolean) as string[]);
    if (!relevant.size) continue;
    const { value } = await structuredCall({
      model: 'fast',
      node: 'eval_query_transform',
      schema: QueryPlanSchema,
      system:
        'Generate retrieval queries against the text of the EU AI Act for the use case below. Different angles: the practice itself, the sector/context of deployment, the affected persons. Use the Act\'s own vocabulary where you can.',
      user: c.description,
    });
    const results = await Promise.all(value.queries.map((q) => retrieve(q, { k: 6, mode })));
    const byId = new Map<string, number>();
    for (const r of results) {
      for (const ch of r.chunks) {
        byId.set(ch.id, Math.max(byId.get(ch.id) ?? 0, ch.score));
      }
    }
    const chunkRank = [...byId.entries()].sort((a, b) => b[1] - a[1]);
    const seen = new Set<string>();
    const parentIds: string[] = [];
    for (const [id] of chunkRank) {
      const parentId = id.split('#')[0];
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      if (getDoc(parentId)) parentIds.push(parentId);
      if (parentIds.length >= 10) break;
    }
    const { hit5, rr } = scoreRanks(parentIds, relevant);
    if (hit5) hits += 1;
    rrSum += rr;
  }
  return {
    name: `${mode}+query-transform`,
    queries: cases.length,
    recallAt5: hits / cases.length,
    mrr: rrSum / cases.length,
  };
}

async function main() {
  const root = process.cwd();
  const cases: GoldenCase[] = JSON.parse(
    await readFile(path.join(root, 'evals', 'golden', 'cases.json'), 'utf8'),
  );

  const configs = [];
  console.log(`Retrieval evals over ${cases.length} queries...`);
  configs.push(await evalConfig(cases, 'bm25-only'));

  const emb = loadEmbeddings();
  if (emb.present && process.env.GOOGLE_API_KEY) {
    configs.push(await evalConfig(cases, 'dense-only'));
    configs.push(await evalConfig(cases, 'hybrid'));
    // dense-only+query-transform is the LIVE pipeline config (the default leg
    // is dense; planQueries supplies the multi-query transform). hybrid+QT is
    // kept alongside it so the scorecard still shows the fused leg's number and
    // the decision to default to dense stays auditable, not asserted.
    configs.push(await evalQueryTransform(cases, 'dense-only'));
    configs.push(await evalQueryTransform(cases, 'hybrid'));
  } else {
    console.log('dense/hybrid skipped: ' + (emb.present ? 'GOOGLE_API_KEY missing' : 'data/embeddings.json missing (run npm run ingest:embed)'));
  }

  const card = {
    generatedAt: new Date().toISOString(),
    corpusVersion: loadCorpus().version,
    configs,
  };
  const resultsDir = path.join(root, 'evals', 'results');
  await mkdir(resultsDir, { recursive: true });
  await writeFile(path.join(resultsDir, 'retrieval-scorecard.json'), JSON.stringify(card, null, 1));

  console.log('\n=== Retrieval scorecard ===');
  for (const c of configs) {
    console.log(`${c.name.padEnd(11)} recall@5 ${(c.recallAt5 * 100).toFixed(1)}%  MRR ${c.mrr.toFixed(3)}`);
  }

  const bm25 = configs.find((c) => c.name === 'bm25-only')!;
  if (bm25.recallAt5 < BM25_RECALL_GATE) {
    console.error(`\nGATE FAILED: bm25 recall@5 ${(bm25.recallAt5 * 100).toFixed(1)}% < ${BM25_RECALL_GATE * 100}%`);
    process.exit(1);
  }
  console.log('\nGate passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
