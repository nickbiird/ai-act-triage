import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve } from '../lib/retrieval';

test('BM25 finds Article 5 for statute vocabulary', async () => {
  const r = await retrieve('social scoring of natural persons by public authorities', {
    mode: 'bm25-only',
    k: 8,
  });
  assert.ok(
    r.parents.some((p) => p.id === 'art-5'),
    `expected art-5 in parents, got: ${r.parents.map((p) => p.id).join(', ')}`,
  );
});

test('BM25 finds the high-risk provisions for creditworthiness', async () => {
  const r = await retrieve('evaluate creditworthiness of natural persons credit score', {
    mode: 'bm25-only',
    k: 8,
  });
  assert.ok(
    r.parents.some((p) => p.id === 'annex-3' || p.id === 'art-6'),
    `expected annex-3 or art-6, got: ${r.parents.map((p) => p.id).join(', ')}`,
  );
});

test('parent expansion dedupes and returns whole units', async () => {
  const r = await retrieve('transparency obligations chatbot disclose artificial', {
    mode: 'bm25-only',
    k: 10,
  });
  const ids = r.parents.map((p) => p.id);
  assert.equal(ids.length, new Set(ids).size, 'parents must be deduped');
  assert.ok(r.parents.every((p) => p.text.length > 200), 'parents are full units, not fragments');
});

test('falls back to bm25-only when embeddings are absent', async () => {
  const r = await retrieve('anything at all', { mode: 'hybrid', k: 4 });
  assert.equal(r.mode, 'bm25-only');
});
