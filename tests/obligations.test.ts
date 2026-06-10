import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBLIGATIONS } from '../lib/obligations';
import { TIERS } from '../lib/types';
import { citationResolves } from '../lib/corpus';

test('every tier has a non-empty, citable obligations checklist', () => {
  for (const tier of TIERS) {
    const items = OBLIGATIONS[tier];
    assert.ok(items.length >= 3, `${tier} has fewer than 3 obligations`);
    for (const item of items) {
      assert.ok(item.text.length > 20);
      assert.ok(item.basis.length > 0);
    }
  }
});

test('obligation bases resolve against the corpus where they cite single provisions', () => {
  for (const tier of TIERS) {
    for (const item of OBLIGATIONS[tier]) {
      // multi-citation bases like "Articles 43, 48, 49" and recitals are
      // outside citationToDocId's single-provision grammar — check the rest
      if (/^(Article|Annex) [\dIVX]+$/.test(item.basis) || /^(Article|Annex) [\dIVX]+\(/.test(item.basis)) {
        assert.ok(citationResolves(item.basis), `${tier}: "${item.basis}" does not resolve`);
      }
    }
  }
});
