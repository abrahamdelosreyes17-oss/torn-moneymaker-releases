/*
 * 3.26.1: TornW3B counts an item's sellers list (1,000) and its light list (10,000) by the day. Read flat
 * out both days were gone in two or three hours, and for the rest of the day no possible flip could be read
 * (Fable's review, 2026-10-11). The day is paced: an hour takes a quarter of what was left when it began.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dayPaceRoom, DAY_PACE_PART, DAY_PACE_HEAD_MIN } from '../src/core/desk.js';

const HOUR = 3600000;
const MIN = 60000;
const H0 = 472222 * HOUR;

test('an hour takes a quarter of what is left of the day, handed out through the hour with a head start', () => {
    assert.deepEqual([DAY_PACE_PART, DAY_PACE_HEAD_MIN], [4, 15]);
    // 800 left as the hour begins: 200 are this hour's, a quarter of them at once.
    assert.deepEqual(dayPaceRoom(800, 0, H0), { hour: 200, room: 50 });
    // Half an hour in, nothing used: three quarters of the hour's share.
    assert.equal(dayPaceRoom(800, 0, H0 + 30 * MIN).room, 150);
    // From 45 minutes on the whole share may be out.
    assert.equal(dayPaceRoom(800, 0, H0 + 45 * MIN).room, 200);
    assert.equal(dayPaceRoom(800, 0, H0 + 59 * MIN).room, 200);
    // What was used in the hour counts against it, and the share is of what the hour began with.
    assert.deepEqual(dayPaceRoom(750, 50, H0), { hour: 200, room: 0 });
    assert.deepEqual(dayPaceRoom(750, 50, H0 + 6 * MIN), { hour: 200, room: 20 });
    assert.deepEqual(dayPaceRoom(600, 200, H0 + 50 * MIN), { hour: 200, room: 0 });
});

test('the day never runs out, and is never overdrawn', () => {
    // Read flat out for twelve hours: each hour a quarter of what is left.
    let left = 800;
    const taken = [];
    for (let h = 0; h < 12; h++) {
        const got = dayPaceRoom(left, 0, H0 + h * HOUR + 50 * MIN).room;
        taken.push(got);
        left -= got;
    }
    assert.deepEqual(taken.slice(0, 4), [200, 150, 113, 85]);
    assert.ok(left > 0, left + ' left after twelve hours');
    assert.ok(taken.every((n, i) => !i || n <= taken[i - 1]));
    // Never more than is left; nothing left, nothing; junk is nothing.
    assert.deepEqual(dayPaceRoom(3, 0, H0 + 50 * MIN), { hour: 1, room: 1 });
    assert.deepEqual(dayPaceRoom(0, 0, H0 + 50 * MIN), { hour: 0, room: 0 });
    assert.deepEqual(dayPaceRoom(0, 40, H0 + 50 * MIN), { hour: 10, room: 0 });
    assert.deepEqual(dayPaceRoom(undefined, null, NaN), { hour: 0, room: 0 });
    assert.deepEqual(dayPaceRoom(-5, -5, H0), { hour: 0, room: 0 });
});
