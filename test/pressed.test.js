import test from 'node:test';
import assert from 'node:assert/strict';
import { pressNew, pressLive, pressItems, nextPressRead, pressDone, pressOpenWanted, pressWait, pressLogAdd, PRESS_FULL_MAX, PRESS_LIVE_MS } from '../src/core/pressed.js';

const enough = (each, price) => each >= price * 0.02;

test('a press names the trader by id; a trader known by name only has no list to read', () => {
    assert.deepEqual(pressNew({ key: 'id:77', itemId: 5, why: 'Plan trade', now: 1000 }), { key: 'id:77', traderId: '77', itemId: '5', why: 'Plan trade', at: 1000, firstAt: 0 });
    assert.equal(pressNew({ key: 'name:bob', now: 1 }).traderId, null);
    assert.equal(pressLive(pressNew({ key: 'name:bob', now: 1 }), 2), false);
    const p = pressNew({ key: 'id:1', now: 0 });
    assert.equal(pressLive(p, PRESS_LIVE_MS - 1), true);
    assert.equal(pressLive(p, PRESS_LIVE_MS), false);
    assert.equal(pressLive(null, 0), false);
});

test('every item on their list that a bazaar can undercut is asked, the biggest gap first - not the first 30', () => {
    const prices = {};
    const low = {};
    for (let i = 1; i <= 120; i += 1) {
        prices[i] = 1000 + i;
        low[i] = 900;
    }
    prices[500] = 5000; low[500] = 4990; // under the least profit: no flip however cheap
    prices[501] = 3000; // the cheapest bazaar is not known yet
    prices[-7] = 99999; // a set
    prices[502] = 0;
    const r = pressItems(prices, { lowestOf: (id) => low[id] ?? null, enough });
    assert.equal(r.all.length, 121);
    assert.equal(r.all[0], '120');
    assert.equal(r.all[119], '1');
    assert.equal(r.all[120], '501'); // unknown ranks last
    assert.equal(r.all.includes('500'), false);
    assert.equal(r.all.includes('-7'), false);
    assert.equal(r.full.length, PRESS_FULL_MAX);
    assert.deepEqual(r.full.slice(0, 2), ['120', '119']);
    assert.equal(r.full.includes('501'), false);
});

const world = (states) => ({ stateOf: (id) => states[id] || {}, fullOk: true, lightOk: true });

test('the best items get a full sellers list first, then every item its light list; done when each was asked since the press', () => {
    const press = { at: 100 };
    const items = { all: ['a', 'b', 'c', 'd'], full: ['a', 'b'] };
    const st = {};
    const w = () => world(st);
    assert.deepEqual(nextPressRead(press, items, w()), { id: 'a', how: 'full' });
    st.a = { fullAt: 150 };
    assert.deepEqual(nextPressRead(press, items, w()), { id: 'b', how: 'full' });
    st.b = { loading: true };
    // b is being read: the next is the light list of the first not asked (a is done by its full read).
    assert.deepEqual(nextPressRead(press, items, w()), { id: 'c', how: 'light' });
    st.b = { fullAt: 160 };
    st.c = { lightAt: 170 };
    assert.deepEqual(nextPressRead(press, items, w()), { id: 'd', how: 'light' });
    st.d = { lightAt: 180 };
    assert.equal(nextPressRead(press, items, w()), null);
    assert.equal(pressDone(press, items, w()), true);
});

test('a read from before the press does not count; a failed read is not asked again in a loop', () => {
    const press = { at: 100 };
    const items = { all: ['a', 'b'], full: ['a'] };
    assert.deepEqual(nextPressRead(press, items, world({ a: { fullAt: 99, lightAt: 99 } })), { id: 'a', how: 'full' });
    assert.deepEqual(nextPressRead(press, items, world({ a: { triedAt: 120, error: true }, b: { lightAt: 130 } })), null);
});

test('no room for a sellers list: the light lists go on; no room for either: the queue is not held', () => {
    const press = { at: 100 };
    const items = { all: ['a', 'b'], full: ['a'] };
    assert.deepEqual(nextPressRead(press, items, { stateOf: () => ({}), fullOk: false, lightOk: true }), { id: 'a', how: 'light' });
    assert.equal(nextPressRead(press, items, { stateOf: () => ({}), fullOk: false, lightOk: false }), null);
});

test('their list page is read at the press unless it was read in the last minute', () => {
    const press = pressNew({ key: 'id:9', now: 100000 });
    assert.equal(pressOpenWanted(press, null, { now: 100000 }), '9');
    assert.equal(pressOpenWanted(press, { at: 50000, state: 'open' }, { now: 100000 }), null);
    assert.equal(pressOpenWanted(press, { at: 30000, state: 'open' }, { now: 100000 }), '9');
    assert.equal(pressOpenWanted(press, { at: 30000, state: 'open' }, { now: 100000, reading: true }), null);
    assert.equal(pressOpenWanted(pressNew({ key: 'name:x', now: 1 }), null, { now: 1 }), null);
});

test('the wait from press to first check: the read after it, 0 for a check that already stood, null before any', () => {
    const press = { at: 1000 };
    assert.equal(pressWait(press, { at: 1800, state: 'open' }, 180000), 800);
    assert.equal(pressWait(press, { at: 900, state: 'open' }, 180000), 0);
    assert.equal(pressWait(press, { at: 900, state: 'closed' }, 180000), null);
    assert.equal(pressWait(press, { at: 1000 - 200000, state: 'open' }, 180000), null);
    assert.equal(pressWait(press, null, 180000), null);
    assert.equal(pressWait(press, { at: 1500, state: 'closed' }, 180000), 500);
});

test('the zip keeps the last few waits', () => {
    let log = [];
    for (let i = 0; i < 12; i += 1) log = pressLogAdd(log, { ms: i });
    assert.equal(log.length, 8);
    assert.equal(log[0].ms, 4);
    assert.equal(log[7].ms, 11);
});
