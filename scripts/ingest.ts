/**
 * Corpus ingestion: fetches the EU AI Act (Regulation (EU) 2024/1689, OJ version
 * of 13 June 2024) from artificialintelligenceact.eu — the Future of Life
 * Institute's mirror of the official public-domain text — and produces
 * data/corpus.json: structure-aware chunks with canonical IDs.
 *
 * Chunking strategy (defended in ARCHITECTURE.md):
 *  - parent unit = one Article or Annex (what the model should read)
 *  - chunk unit  = numbered paragraph / annex point, packed to <= MAX_CHUNK_CHARS
 *    (what the retriever should match) — statutes have structure; cutting on it
 *    beats fixed-size windows, and the retrieval scorecard tests that claim.
 *
 * Run: npm run ingest          (re-fetches all 113 articles + 13 annexes, ~2 min, polite 400ms delay)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://artificialintelligenceact.eu';
const UA = 'ai-act-triage-ingest/0.1 (open-source portfolio project; polite, 400ms delay)';
const DELAY_MS = 400;
const MAX_CHUNK_CHARS = 1600;
const ARTICLES = 113;
const ANNEXES = 13;

export interface CorpusDoc {
  /** canonical id: "art-6" | "annex-3" */
  id: string;
  kind: 'article' | 'annex';
  number: number;
  /** "Article 6: Classification Rules for High-Risk AI Systems" */
  title: string;
  /** "Chapter III: High-Risk AI System — Section 1: ..." when present */
  chapter: string | null;
  /** full legal text of the unit */
  text: string;
  sourceUrl: string;
}

export interface CorpusChunk {
  /** "art-6#2" — parent id + ordinal */
  id: string;
  parentId: string;
  /** human citation label: "Article 6(2)" | "Annex III point 4" | "Article 6 ¶3" */
  label: string;
  title: string;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(p|li|div|h[1-6]|br|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/[\t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Extract inner HTML of the first div whose class matches `cls`, depth-aware. */
function extractDiv(html: string, cls: string): string | null {
  const open = html.match(new RegExp(`<div class="[^"]*${cls}[^"]*"[^>]*>`));
  if (!open || open.index === undefined) return null;
  let i = open.index + open[0].length;
  let depth = 1;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = i;
  let m: RegExpExecArray | null;
  while (depth > 0 && (m = tag.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    i = tag.lastIndex;
  }
  return html.slice(open.index + open[0].length, i - 6);
}

function extractTitle(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return m ? htmlToText(m[1]) : 'Untitled';
}

function extractChapter(html: string): string | null {
  // The meta block reads: "Part of Chapter III: High-Risk AI System ➔ Section 1: ..."
  const m = html.match(/Part of Chapter[\s\S]{0,400}?<\/div>/);
  if (!m) return null;
  const text = htmlToText(m[0]).replace(/\s*➔\s*/g, ' — ').replace(/^Part of\s*/i, '');
  return text.split('\n')[0]?.trim() || null;
}

async function fetchUnit(kind: 'article' | 'annex', n: number): Promise<CorpusDoc | null> {
  const url = `${BASE}/${kind}/${n}/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.warn(`  !! ${url} -> HTTP ${res.status}, skipping`);
    return null;
  }
  const html = await res.text();
  const body = extractDiv(html, 'et_pb_post_content_0_tb_body');
  if (!body) {
    console.warn(`  !! ${url} -> no legal-text container found, skipping`);
    return null;
  }
  return {
    id: `${kind === 'article' ? 'art' : 'annex'}-${n}`,
    kind,
    number: n,
    title: extractTitle(html),
    chapter: extractChapter(html),
    text: htmlToText(body),
    sourceUrl: url,
  };
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

/**
 * Split a unit's text on its own structure: numbered paragraphs ("1.", "2.")
 * for articles, numbered points for annexes. Oversized members are packed
 * greedily on sentence boundaries; tiny members merge into their neighbour.
 */
function chunkUnit(doc: CorpusDoc): CorpusChunk[] {
  const lines = doc.text.split('\n');
  type Seg = { marker: string | null; lines: string[] };
  const segs: Seg[] = [];
  let cur: Seg = { marker: null, lines: [] };
  for (const line of lines) {
    const m = line.match(/^(\d{1,2})\.\s+/);
    if (m) {
      if (cur.lines.length) segs.push(cur);
      cur = { marker: m[1], lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.length) segs.push(cur);

  // merge segments into chunks of <= MAX_CHUNK_CHARS, never splitting a segment
  // unless the segment alone exceeds the cap (then split on sentences)
  const chunks: CorpusChunk[] = [];
  const label = (markers: (string | null)[]): string => {
    const ms = markers.filter(Boolean) as string[];
    const name = doc.kind === 'article' ? `Article ${doc.number}` : `Annex ${ROMAN[doc.number]}`;
    if (!ms.length) return name;
    const unit = doc.kind === 'article' ? '' : ' point ';
    if (ms.length === 1) return doc.kind === 'article' ? `${name}(${ms[0]})` : `${name}${unit}${ms[0]}`;
    return doc.kind === 'article'
      ? `${name}(${ms[0]})–(${ms[ms.length - 1]})`
      : `${name}${unit}${ms[0]}–${ms[ms.length - 1]}`;
  };

  let bufText = '';
  let bufMarkers: (string | null)[] = [];
  const flush = () => {
    if (!bufText.trim()) return;
    chunks.push({
      id: `${doc.id}#${chunks.length}`,
      parentId: doc.id,
      label: label(bufMarkers),
      title: doc.title,
      text: bufText.trim(),
    });
    bufText = '';
    bufMarkers = [];
  };

  for (const seg of segs) {
    const segText = seg.lines.join('\n');
    if (segText.length > MAX_CHUNK_CHARS) {
      flush();
      // sentence-pack the oversized segment
      const sentences = segText.split(/(?<=[.;:])\s+(?=[A-Z(])/);
      for (const s of sentences) {
        if (bufText.length + s.length > MAX_CHUNK_CHARS) {
          bufMarkers.push(seg.marker);
          flush();
        }
        bufText += (bufText ? ' ' : '') + s;
      }
      bufMarkers.push(seg.marker);
      flush();
    } else if (bufText.length + segText.length > MAX_CHUNK_CHARS) {
      flush();
      bufText = segText;
      bufMarkers = [seg.marker];
    } else {
      bufText += (bufText ? '\n' : '') + segText;
      bufMarkers.push(seg.marker);
    }
  }
  flush();
  return chunks;
}

async function main() {
  const docs: CorpusDoc[] = [];
  console.log(`Fetching ${ARTICLES} articles + ${ANNEXES} annexes from ${BASE} (${DELAY_MS}ms delay)...`);
  for (let n = 1; n <= ARTICLES; n++) {
    const d = await fetchUnit('article', n);
    if (d) docs.push(d);
    if (n % 10 === 0) console.log(`  articles: ${n}/${ARTICLES}`);
    await sleep(DELAY_MS);
  }
  for (let n = 1; n <= ANNEXES; n++) {
    const d = await fetchUnit('annex', n);
    if (d) docs.push(d);
    await sleep(DELAY_MS);
  }

  const chunks = docs.flatMap(chunkUnit);
  const corpus = {
    version: `aia-oj-2024-06-13_ingested-${new Date().toISOString().slice(0, 10)}`,
    source: `${BASE} (Future of Life Institute mirror of Regulation (EU) 2024/1689, Official Journal version of 13 June 2024)`,
    note: 'Official EU legal texts are public domain. This corpus is the consolidated OJ text; amendments after the ingestion date (e.g. the 2026 digital-omnibus changes, once published in the OJ) require re-ingestion. Every assessment is stamped with this version string.',
    docs,
    chunks,
  };

  const outDir = path.join(process.cwd(), 'data');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'corpus.json'), JSON.stringify(corpus, null, 1));
  console.log(`\nWrote data/corpus.json: ${docs.length} units, ${chunks.length} chunks, version ${corpus.version}`);
  const sizes = chunks.map((c) => c.text.length);
  console.log(`Chunk sizes: min ${Math.min(...sizes)}, median ${sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)]}, max ${Math.max(...sizes)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
