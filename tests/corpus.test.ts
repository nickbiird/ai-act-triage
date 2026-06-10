import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, getDoc, citationToDocId, citationResolves } from '../lib/corpus';

test('corpus loads with all 113 articles and 13 annexes', () => {
  const c = loadCorpus();
  assert.equal(c.docs.filter((d) => d.kind === 'article').length, 113);
  assert.equal(c.docs.filter((d) => d.kind === 'annex').length, 13);
  assert.ok(c.chunks.length > 200);
  assert.match(c.version, /^aia-oj-2024-06-13/);
});

test('tier-defining provisions are present and substantial', () => {
  for (const [id, minChars] of [
    ['art-5', 5000],
    ['art-6', 2000],
    ['art-50', 2000],
    ['annex-3', 4000],
  ] as const) {
    const doc = getDoc(id);
    assert.ok(doc, `${id} missing`);
    assert.ok(doc.text.length >= minChars, `${id} suspiciously short: ${doc.text.length}`);
  }
});

test('citations resolve in canonical forms', () => {
  assert.equal(citationToDocId('Article 6(2)'), 'art-6');
  assert.equal(citationToDocId('Article 5(1)(a)'), 'art-5');
  assert.equal(citationToDocId('Annex III point 4(a)'), 'annex-3');
  assert.equal(citationToDocId('Annex I'), 'annex-1');
  assert.ok(citationResolves('Article 50(1)'));
  assert.ok(citationResolves('Annex III'));
});

test('invented citations do not resolve', () => {
  assert.equal(citationResolves('Article 999'), false);
  assert.equal(citationResolves('Annex XV'), false);
  assert.equal(citationResolves('Section 230'), false);
});

test('every golden-case basis citation resolves against the corpus', async () => {
  const { readFile } = await import('node:fs/promises');
  const cases = JSON.parse(await readFile('evals/golden/cases.json', 'utf8')) as { id: string; basis: string[] }[];
  for (const c of cases) {
    for (const b of c.basis) {
      assert.ok(citationResolves(b), `${c.id}: basis "${b}" does not resolve`);
    }
  }
});
