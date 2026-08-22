import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hourRng12, rng12, slotRng12, t12 } from '../client/datetime.js';

test('ranges omit whole-hour minutes and keep one period when possible', () => {
  assert.equal(rng12(7 * 60, 8 * 60), '7 to 8 AM');
  assert.equal(rng12(7 * 60, 7 * 60 + 30), '7 to 7:30 AM');
  assert.equal(rng12(7 * 60 + 30, 8 * 60), '7:30 to 8 AM');
});

test('ranges keep both periods when crossing noon or midnight', () => {
  assert.equal(rng12(11 * 60 + 30, 12 * 60), '11:30 AM to 12 PM');
  assert.equal(rng12(23 * 60 + 30, 24 * 60), '11:30 PM to 12 AM');
});

test('point times stay exact for live clocks', () => {
  assert.equal(t12(7 * 60), '7:00 AM');
  assert.equal(t12(7 * 60 + 30), '7:30 AM');
});

test('availability slot ranges use the compact design-system notation', () => {
  assert.equal(hourRng12(6), '6–7AM');
  assert.equal(slotRng12(11 * 60 + 30, 12 * 60), '11:30AM–12PM');
});
