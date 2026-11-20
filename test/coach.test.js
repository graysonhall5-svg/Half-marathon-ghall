import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN, plannedMiles } from '../plan.js';
import { planPosition, dateFor, daysToRace, toKey, adjust, paces, parseTime, fmtPace } from '../coach.js';

test('plan is 13 weeks of 7 days', () => {
  assert.equal(PLAN.length, 13);
  for (const w of PLAN) assert.equal(w.length, 7);
});

test('dates line up with the calendar', () => {
  assert.equal(toKey(dateFor(0, 0)), '2026-11-16');
  assert.equal(toKey(dateFor(12, 5)), '2027-02-13');
  assert.equal(toKey(dateFor(12, 6)), '2027-02-14');
  assert.equal(PLAN[12][6].type, 'race');
  assert.deepEqual(planPosition(new Date(2026, 10, 20, 9)), { week: 0, day: 4 });
  assert.equal(daysToRace(new Date(2026, 10, 20, 9)), 86);
  assert.ok(planPosition(new Date(2026, 10, 10)).before);
  assert.ok(planPosition(new Date(2027, 1, 15)).after);
});

test('recovery adjustments', () => {
  const tempo = PLAN[6][4]; // 35 min tempo
  assert.equal(adjust(tempo, 80).changed, false);
  assert.match(adjust(tempo, 50).title, /25 min tempo/);
  assert.match(adjust(tempo, 20).title, /easy/);
  assert.match(adjust(PLAN[0][1], 50).title, /^7 x 400m/);
  assert.match(adjust(PLAN[0][5], 80).title, /4 mi/);
  assert.match(adjust(PLAN[0][5], 50).title, /Rest/);
  assert.match(adjust(PLAN[10][6], 20).title, /8 mi/);
  assert.equal(adjust(PLAN[12][6], 10).changed, false);
  assert.equal(adjust(PLAN[2][2], null).changed, false);
});

test('paces from a 25:00 5K are sensible', () => {
  const p = paces(parseTime('25:00'));
  assert.equal(fmtPace(p.fiveK), '8:03/mi');
  assert.ok(p.mile < p.fiveK && p.fiveK < p.tempo && p.tempo < p.half && p.half < p.easyLow);
  assert.ok(plannedMiles(0) > 10);
});

test('targets and comparisons', async () => {
  const { targetFor, comparePace } = await import('../coach.js');
  const p = paces(null, parseTime('1:44:30'));
  const t = targetFor(PLAN[0][1], p); // 10 x 400m at 5K
  assert.match(t.lines[0].value, /^1:49 each/);
  const t5 = targetFor(PLAN[4][1], p);
  assert.equal(t5.lines.length, 2);
  assert.match(targetFor(PLAN[12][6], p).lines[0].value, /1:44:30/);
  assert.equal(comparePace(9 * 60 + 10, targetFor(PLAN[0][2], p).pace).status, 'on');
  assert.equal(comparePace(8 * 60, targetFor(PLAN[0][2], p).pace).status, 'fast');
});

test('keypad time entry', () => {
  assert.equal(parseTime('3612'), 36 * 60 + 12);
  assert.equal(parseTime('14430'), 3600 + 44 * 60 + 30);
  assert.equal(parseTime('149'), 109);
  assert.equal(parseTime('36:12'), 36 * 60 + 12);
});
