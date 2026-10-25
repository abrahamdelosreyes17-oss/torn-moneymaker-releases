import test from 'node:test';
import assert from 'node:assert/strict';
import { oldListScan, oldListsWanted, OLD_OPEN_MAX } from '../src/core/old-lists.js';
import { hiddenBuyers } from '../src/core/traders.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const enough = (each, price) => each >= price * 0.02;

// The page's own rule: hiddenBuyers with Fresh prices on, a trader whose list was last edited 3 days ago is stale.
const listAt = { 11: NOW - 3 * DAY, 12: NOW - 2 * DAY, 13: NOW - 1000, 14: NOW - 5 * DAY };
const levels = { 14: 'offline' };
const hiddenBy = (b) => {
    const h = hiddenBuyers([b], { prefs: { freshOnly: true, onlineOnly: true }, levelOf: (id) => levels[id] || 'online', listAtOf: (id) => listAt[id] || 0, now: NOW })[0];
    return h ? h.hiddenBy : null;
};

test('the traders whose flips only an old edit date hides, the most expected profit first', () => {
    const buyers = {
        beer: [{ id: 11, price: 1000, w3b: 1000, maxUnits: 10 }, { id: 13, price: 950, w3b: 950, maxUnits: 10 }, { id: 12, price: 930, w3b: 930, maxUnits: 100 }],
        wine: [{ id: 12, price: 5000, w3b: 5000, maxUnits: 2 }, { id: 14, price: 4900, w3b: 4900, maxUnits: 5 }],
        rock: [{ id: 11, price: 101, w3b: 101, maxUnits: 5 }],
    };
    const low = { beer: 800, wine: 4000, rock: 100 };
    const r = oldListScan(['beer', 'wine', 'rock'], { lowestOf: (id) => low[id], buyersOf: (id) => buyers[id], hiddenBy, enough });
    // 11: beer 200 x 10 = 2000 (rock 1 over 100 is under the least profit); 12: beer 130 x 100 = 13000 + wine 1000 x 2 = 2000
    assert.deepEqual(r.old, ['12', '11']);
    assert.deepEqual(r.hidden, { offline: 1, trust: 0, stale: 2 });
});

test('a buyer who is offline is not asked for (an open page would not show them), a price only on TornExchange has no page', () => {
    const buyers = { beer: [{ id: 14, price: 1000, w3b: 1000, maxUnits: 1 }, { id: 11, price: 990, w3b: 0, maxUnits: 1 }] };
    const r = oldListScan(['beer'], { lowestOf: () => 800, buyersOf: (id) => buyers[id], hiddenBy, enough });
    assert.deepEqual(r.old, []);
    assert.equal(r.hidden.offline, 1);
});

test('items with no cheapest price are skipped; nothing hidden gives nothing', () => {
    const r = oldListScan(['x', 'y'], { lowestOf: (id) => (id === 'x' ? null : 100), buyersOf: () => [{ id: 13, price: 200, w3b: 200, maxUnits: 3 }], hiddenBy, enough });
    assert.deepEqual(r, { old: [], hidden: { offline: 0, trust: 0, stale: 0 } });
});

test('a list read closed lately is not asked again at once; the list is cut to the most the queue takes', () => {
    const old = Array.from({ length: 20 }, (_, i) => String(100 + i));
    const checkOf = (id) => (id === '100' ? { at: NOW - 60_000, state: 'closed' } : id === '101' ? { at: NOW - 3_600_000, state: 'closed' } : id === '102' ? { at: NOW - 60_000, state: 'open' } : null);
    const got = oldListsWanted(old, checkOf, { now: NOW });
    assert.equal(got.length, OLD_OPEN_MAX);
    assert.equal(got.includes('100'), false);
    assert.deepEqual(got.slice(0, 2), ['101', '102']);
    assert.deepEqual(oldListsWanted(['5'], () => null, { now: NOW, max: 3 }), ['5']);
});
