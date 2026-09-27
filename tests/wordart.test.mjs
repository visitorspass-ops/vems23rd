import test from 'node:test';
import assert from 'node:assert/strict';
import { assign, currentIndex, groupsFor, totalCap, wordCount, cleanSettings, encodeMask, decodeMask } from '../public/wordart.js';

const pics = [{ id: 'a', cap: 2 }, { id: 'b', cap: 3 }];
const msg = (id, text, name = 'x') => ({ id, name, text });

test('word count', () => {
  assert.equal(wordCount(' walking   sunshine '), 2);
  assert.equal(wordCount('the kindest soul'), 3);
  assert.equal(wordCount('the friend who always remembers my birthday'), 7);
});

test('descriptions fill pictures in order, then overflow', () => {
  const m = ['1', '2', '3', '4', '5', '6'].map((i) => msg(i, 'kind heart'));
  assert.deepEqual(assign(pics, m), [0, 0, 1, 1, 1, -1]);
  assert.equal(totalCap(pics), 5);
  assert.equal(currentIndex(pics, m.slice(0, 3)), 1);
  assert.equal(currentIndex(pics, []), 0);
});

test('identical descriptions merge and gain weight', () => {
  const m = [msg('1', 'Walking Sunshine', 'Pao'), msg('2', 'walking  sunshine', 'Bea')];
  const g = groupsFor(0, m, assign(pics, m));
  assert.equal(g.length, 1);
  assert.equal(g[0].weight, 2);
  assert.deepEqual(g[0].names, ['Pao', 'Bea']);
});

test('settings are clamped to safe ranges', () => {
  const s = cleanSettings({ mode: 'weird', grid: 9999, underlay: -1, ink: 'red' });
  assert.equal(s.mode, 'color'); assert.equal(s.grid, 320); assert.equal(s.underlay, 0); assert.equal(s.ink, '#4a2c1d');
});

test('brush masks round-trip', () => {
  const f = Uint8Array.from({ length: 77 }, (_, i) => (i % 3 === 0 ? 1 : 0));
  assert.deepEqual(decodeMask(encodeMask(f), 77), f);
});

test('stars carry into groups (highest wins)', () => {
  const m = [{ id: '1', name: 'A', text: 'kind heart', star: 1 }, { id: '2', name: 'B', text: 'Kind Heart', star: 2 }, { id: '3', name: 'C', text: 'sunny soul' }];
  const g = groupsFor(0, m, assign([{ id: 'a', cap: 10 }], m));
  assert.equal(g.find((x) => x.text.toLowerCase() === 'kind heart').star, 2);
  assert.equal(g.find((x) => x.text === 'sunny soul').star, 0);
});

import { shapeOf, groupKey, cleanConfig, isOpen, isRevealed } from '../public/wordart.js';

test('stand-in shapes hide the letters but keep the length', () => {
  const s = shapeOf('walking sunshine');
  assert.equal(s.length, 'walking sunshine'.length);
  assert.ok(!/[aeiou]/.test(s.replace(/n/g, '')), 'no readable letters');
  assert.equal(groupKey('Walking  Sunshine'), groupKey('walking sunshine'));
});

test('open window and reveal timing', () => {
  const now = 1_000_000;
  assert.equal(isOpen(cleanConfig({ open: true, opensAt: now + 1 }), now), false);
  assert.equal(isOpen(cleanConfig({ open: true, closesAt: now }), now), false);
  assert.equal(isOpen(cleanConfig({ open: false }), now), false);
  assert.equal(isOpen(cleanConfig({}), now), true);
  assert.equal(isRevealed(cleanConfig({ revealed: false, revealAt: now + 5 }), now), false);
  assert.equal(isRevealed(cleanConfig({ revealed: false, revealAt: now - 5 }), now), true);
});

import { cleanNote, personSummary } from '../public/wordart.js';

test('long messages keep line breaks and are grouped by person', () => {
  assert.equal(cleanNote('Hi  Vem!\r\n\r\n\r\nLove you'), 'Hi Vem!\n\nLove you');
  const m = [
    { name: 'Pao', text: 'kind heart', note: 'first note' },
    { name: 'pao ', text: 'brave soul' },
    { name: 'Bea', text: 'sunny soul', note: 'not Pao' },
  ];
  const p = personSummary(m, 'PAO');
  assert.deepEqual(p.descriptions, ['kind heart', 'brave soul']);
  assert.deepEqual(p.notes, ['first note']);
});
