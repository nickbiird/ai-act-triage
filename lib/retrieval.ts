/**
 * Retrieval over the Act: BM25 (MiniSearch) and dense cosine (static Gemini
 * embeddings), with optional Reciprocal Rank Fusion, then parent-document
 * expansion to the full Article/Annex.
 *
 * Default leg: DENSE (with BM25-only fallback when embeddings are absent).
 * The original design fused both legs (RRF) by default on the thesis that
 * legal terms-of-art are exact-match territory where BM25 wins. The retrieval
 * scorecard refuted that on this corpus: dense-only scores recall@5 90.0% vs
 * fused-hybrid 66.7% (single query) and 96.7% vs 96.7% (live multi-query +
 * query-transform, where dense edges it on MRR). RRF lets a weak/noisy BM25
 * leg (26.7% alone) pollute dense's strong ordering — chunks both legs happen
 * to surface get the additive bonus and leapfrog the dense-relevant chunk past
 * the parent-expansion cutoff. No fusion weighting recovered dense's score
 * (best down-weighted hybrid: 80%). So the default is dense.
 *
 * BM25 is retained, not deleted: it is the deterministic CI gate (runs with no
 * API key) and the eval is paraphrase-heavy by construction (see evals/
 * retrieval.ts) — it does not exercise the exact-statute-term queries where
 * BM25's value would show. 'hybrid' stays a selectable, measured mode so the
 * trade-off stays visible in the scorecard rather than being silently dropped.
 * See TRUST_REPORT.md "Retrieval configuration" for the full decision record.
 *
 * Degradation: no embeddings file -> BM25-only, and the result says so.
 * The retrieval scorecard (npm run evals:retrieval) measures all configs.
 */

import MiniSearch from 'minisearch';
import { loadCorpus, loadEmbeddings, getDoc, type CorpusChunk } from './corpus';

export type RetrievalMode = 'hybrid' | 'bm25-only' | 'dense-only';

export interface RetrievedChunk extends CorpusChunk {
  score: number;
  /** which legs ranked it */
  via: ('bm25' | 'dense')[];
}

export interface RetrievalResult {
  mode: RetrievalMode;
  chunks: RetrievedChunk[];
  /** parent docs expanded from the top chunks, deduped, in rank order */
  parents: { id: string; title: string; label: string; text: string }[];
}

const RRF_K = 60;
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-001';

let mini: MiniSearch<CorpusChunk> | null = null;

function bm25Index(): MiniSearch<CorpusChunk> {
  if (!mini) {
    mini = new MiniSearch<CorpusChunk>({
      fields: ['text', 'title', 'label'],
      storeFields: ['id'],
      searchOptions: { boost: { title: 1.5, label: 2 }, fuzzy: 0.1 },
    });
    mini.addAll(loadCorpus().chunks);
  }
  return mini;
}

async function embedQuery(query: string, apiKey: string): Promise<Float32Array> {
  const emb = loadEmbeddings();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: query }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: emb.dims || 768,
      }),
    },
  );
  if (!res.ok) throw new Error(`query embed HTTP ${res.status}`);
  const json = (await res.json()) as { embedding: { values: number[] } };
  const v = json.embedding.values;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return new Float32Array(v.map((x) => x / norm));
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export async function retrieve(
  query: string,
  opts: { k?: number; mode?: RetrievalMode; apiKey?: string } = {},
): Promise<RetrievalResult> {
  const k = opts.k ?? 8;
  const corpus = loadCorpus();
  const chunkById = new Map(corpus.chunks.map((c) => [c.id, c]));
  const emb = loadEmbeddings();
  const apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY;

  let mode: RetrievalMode = opts.mode ?? 'dense-only';
  if (mode !== 'bm25-only' && (!emb.present || !apiKey)) mode = 'bm25-only';

  // BM25 leg
  const bm25Ranked: string[] =
    mode === 'dense-only'
      ? []
      : bm25Index()
          .search(query)
          .slice(0, 50)
          .map((r) => r.id as string);

  // dense leg
  let denseRanked: string[] = [];
  if (mode !== 'bm25-only') {
    const qv = await embedQuery(query, apiKey!);
    denseRanked = [...emb.vectors.entries()]
      .map(([id, v]) => [id, dot(qv, v)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([id]) => id);
  }

  // Reciprocal Rank Fusion
  const fused = new Map<string, { score: number; via: ('bm25' | 'dense')[] }>();
  const addLeg = (ranked: string[], leg: 'bm25' | 'dense') => {
    ranked.forEach((id, rank) => {
      const cur = fused.get(id) ?? { score: 0, via: [] };
      cur.score += 1 / (RRF_K + rank + 1);
      cur.via.push(leg);
      fused.set(id, cur);
    });
  };
  addLeg(bm25Ranked, 'bm25');
  addLeg(denseRanked, 'dense');

  const top = [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, k)
    .map(([id, { score, via }]) => ({ ...chunkById.get(id)!, score, via }))
    .filter((c) => c.id !== undefined);

  // parent-document expansion: the model reads whole articles, not fragments
  const seen = new Set<string>();
  const parents: RetrievalResult['parents'] = [];
  for (const c of top) {
    if (seen.has(c.parentId)) continue;
    seen.add(c.parentId);
    const doc = getDoc(c.parentId);
    if (doc) parents.push({ id: doc.id, title: doc.title, label: c.label, text: doc.text });
    if (parents.length >= 5) break;
  }

  return { mode, chunks: top, parents };
}
