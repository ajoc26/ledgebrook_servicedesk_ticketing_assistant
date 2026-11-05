import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSummary } from '../src/normalize';
test('normalizes case, Unicode compatibility forms, and whitespace', () => assert.equal(normalizeSummary('  ＡWS   Read-only Access '), 'aws read-only access'));
test('keeps punctuation significant', () => assert.notEqual(normalizeSummary('service-desk'), normalizeSummary('service desk')));
