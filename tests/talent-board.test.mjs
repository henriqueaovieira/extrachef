import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyDemandTalents,
  matchesDemandFunction,
  rankSuggestions,
  relativeTime,
  stableSuggestions,
} from '../lib/talent-board.ts';

test('classifies invited and candidate professionals for one demand', () => {
  const { invited, candidates } = classifyDemandTalents([
    { worker_id: 'a', status: 'pending' },
    { worker_id: 'b', status: 'pending' },
    { worker_id: 'c', status: 'approved' },
    { worker_id: 'f', status: 'cancelled' },
  ], [
    { worker_id: 'b', status: 'accepted' },
    { worker_id: 'd', status: 'pending' },
    { worker_id: 'e', status: 'declined' },
    { worker_id: 'f', status: 'accepted' },
  ]);
  assert.deepEqual([...candidates.keys()], ['a']);
  assert.deepEqual(Object.fromEntries(invited), {
    b: 'accepted', d: 'awaiting', e: 'unavailable', f: 'unavailable', c: 'approved',
  });
});

test('ranks suggestions by favorite, history, rating, operations and demand function', () => {
  const person = (id, extra) => ({ id, categories: [], specialties: [], completed_operations: 0, score: null, reputation: null, ...extra });
  const ranked = rankSuggestions([
    person('function', { specialties: ['Garçom'] }),
    person('ops', { reputation: { average_rating: null, completed: 9 } }),
    person('rating', { score: 4.9 }),
    person('worked', { completed_operations: 2 }),
    person('favorite', { categories: ['favorite'] }),
  ], 'Garcom para casamento');
  assert.deepEqual(ranked.map((item) => item.id), ['favorite', 'worked', 'rating', 'ops', 'function']);
  assert.equal(matchesDemandFunction(['Garçom'], 'GARÇOM'), true);
  assert.equal(matchesDemandFunction(['Cozinha'], 'Garçom'), false);
});

test('keeps suggestions stable and only replaces ineligible ones', () => {
  assert.deepEqual(stableSuggestions([], ['a', 'b', 'c', 'd']), ['a', 'b', 'c']);
  assert.deepEqual(stableSuggestions(['c', 'a', 'b'], ['d', 'a', 'b', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(stableSuggestions(['c', 'a', 'b'], ['d', 'a', 'c']), ['c', 'a', 'd']);
});

test('formats last hire as relative time', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  assert.equal(relativeTime('2026-10-17T12:00:00Z', now), 'há 1 dia');
  assert.equal(relativeTime('2026-10-03T12:00:00Z', now), 'há 15 dias');
  assert.equal(relativeTime('2026-08-15T12:00:00Z', now), 'há 2 meses');
  assert.equal(relativeTime(null, now), null);
});
