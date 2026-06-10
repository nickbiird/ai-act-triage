import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPII } from '../lib/pii';

test('masks emails with stable placeholders', () => {
  const { masked, found } = maskPII('Contact maria.gomez@empresa.es or jefe@empresa.es about the rollout.');
  assert.ok(!masked.includes('@empresa.es'));
  assert.ok(masked.includes('[EMAIL_1]'));
  assert.ok(masked.includes('[EMAIL_2]'));
  assert.equal(found.filter((f) => f.kind === 'EMAIL').length, 2);
});

test('masks Spanish DNI and phone numbers', () => {
  const { masked } = maskPII('The applicant 12345678Z called from +34 612 345 678 yesterday.');
  assert.ok(!masked.includes('12345678Z'));
  assert.ok(!masked.includes('612 345 678'));
});

test('leaves ordinary business text alone', () => {
  const text = 'We process 40,000 invoices per year across 12 warehouses since 2019.';
  const { masked, found } = maskPII(text);
  assert.equal(masked, text);
  assert.equal(found.length, 0);
});
