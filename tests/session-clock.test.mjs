import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, TODAY } from '../client/datetime.js';
import { S } from '../client/state.js';
import { buildSessions } from '../client/views/sessions.js';
import { buildAlerts } from '../client/views/alerts.js';

test('late-started matches keep the full timer duration across Sessions and Reminders', () => {
  const original = S.bookings;
  const oldLocation = globalThis.location, oldStorage = globalThis.localStorage;
  globalThis.location = { hostname:'localhost' };
  globalThis.localStorage = { getItem:()=>'19:10' };
  try {
    S.bookings = [{ id:'late-start', date:isoDate(TODAY), pitch:0, start:1080, end:1140,
      startedAt:1110, status:'running', team:'Late team', contact:'9000000001',
      amount:2100, collected:0, pay:'Payment at venue', source:'counter' }];
    const card = buildSessions()[0];
    assert.equal(card.over, false);
    assert.equal(card.clock, '0h 20m left');
    assert.equal(card.elapsedLabel, '0h 40m played · ');
    assert.ok(Math.abs(card.pct - 100 * 40 / 60) < 0.001);
    assert.equal(buildAlerts().game.some(alert=>alert.tag==='Overtime'), false);
    globalThis.localStorage = { getItem:()=>'19:35' };
    assert.equal(buildSessions()[0].over, true);
    assert.equal(buildAlerts().game.find(alert=>alert.tag==='Overtime').at, 1170);
  } finally {
    S.bookings = original;
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
  }
});
