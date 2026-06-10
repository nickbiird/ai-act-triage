import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface CorpusDoc {
  id: string;
  kind: 'article' | 'annex';
  number: number;
  title: string;
  chapter: string | null;
  text: string;
  sourceUrl: string;
}

export interface CorpusChunk {
  id: string;
  parentId: string;
  label: string;
  title: string;
  text: string;
}

export interface Corpus {
  version: string;
  source: string;
  note: string;
  docs: CorpusDoc[];
  chunks: CorpusChunk[];
}

let cached: Corpus | null = null;
let docIndex: Map<string, CorpusDoc> | null = null;

export function loadCorpus(): Corpus {
  if (!cached) {
    const p = path.join(process.cwd(), 'data', 'corpus.json');
    cached = JSON.parse(readFileSync(p, 'utf8')) as Corpus;
  }
  return cached;
}

export function getDoc(id: string): CorpusDoc | undefined {
  if (!docIndex) {
    docIndex = new Map(loadCorpus().docs.map((d) => [d.id, d]));
  }
  return docIndex.get(id);
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13 };

/** "Article 6(2)" | "Annex III point 4(a)" -> corpus doc id ("art-6" / "annex-3"), or null. */
export function citationToDocId(citation: string): string | null {
  const art = citation.match(/Article\s+(\d{1,3})/i);
  if (art) return `art-${art[1]}`;
  const annex = citation.match(/Annex\s+([IVX]+)/i);
  if (annex && ROMAN[annex[1].toUpperCase()]) return `annex-${ROMAN[annex[1].toUpperCase()]}`;
  return null;
}

/** A citation "resolves" iff its doc exists in the corpus — the programmatic half of faithfulness. */
export function citationResolves(citation: string): boolean {
  const id = citationToDocId(citation);
  return id !== null && getDoc(id) !== undefined;
}

export interface EmbeddingsFile {
  model: string;
  dims: number;
  corpusVersion: string;
  vectors: Record<string, string>;
}

let embCache: { present: boolean; dims: number; model: string; vectors: Map<string, Float32Array> } | null = null;

/** Static dense vectors, base64 -> Float32Array. Absent file => dense leg disabled. */
export function loadEmbeddings() {
  if (!embCache) {
    const p = path.join(process.cwd(), 'data', 'embeddings.json');
    if (!existsSync(p)) {
      embCache = { present: false, dims: 0, model: '', vectors: new Map() };
    } else {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as EmbeddingsFile;
      const vectors = new Map<string, Float32Array>();
      for (const [id, b64] of Object.entries(raw.vectors)) {
        const buf = Buffer.from(b64, 'base64');
        vectors.set(id, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
      }
      embCache = { present: true, dims: raw.dims, model: raw.model, vectors };
    }
  }
  return embCache;
}
