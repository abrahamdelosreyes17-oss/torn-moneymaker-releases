/*
 * 3.25.0: each item's bazaars and its flip plan kept between Torn Bids' redraws
 * (core/kept.js; PLAN-next-session.md part 2, step 3). The proof: a long
 * session replayed - bazaars read again, listings seen gone, stock seen on a
 * page, buys, a friend's buys, the clock moving listings into stale and marks
 * out of date, limits changed, traders bidding more and less, trades declined -
 * and at every step every item's kept rows and kept plan compared with ones
 * worked out fresh, the way main.js works them out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeKeeper, keptMarkWords, keptFreshUntil, keptPlanSig } from '../src/core/kept.js';
import { bazaarSellers, withOwnBuys, withoutGone, liveGone, liveStock, liveBought, flipPlan, flipBuyers, payableUnits, goneKey, FLIP_FRESH_MS, OWN_KEEP_MS } from '../src/core/flips.js';

// A small generator with a seed, so a failure can be run again.
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

test('a result is kept while what it was worked out from is the same, value by value', () => {
    const k = makeKeeper();
    let made = 0;
    const list = [1, 2];
    const work = () => {
        made += 1;
        return { n: made };
    };
    k.begin();
    const first = k.get('a', [list, 5, 'x'], work);
    k.begin();
    // The one hit of a redraw is the one checked against a fresh result; so two keys, to see one handed back unworked.
    k.get('b', [1], () => ({ b: 1 }));
    k.begin();
    assert.equal(k.get('b', [1], () => ({ b: 1 })).b, 1);
    const again = k.get('a', [list, 5, 'x'], work);
    assert.equal(again, first, 'the very same result');
    assert.equal(made, 1, 'not worked out again');
    // Another list that says the same is not the same list.
    k.begin();
    assert.notEqual(k.get('a', [[1, 2], 5, 'x'], work), first);
    assert.equal(made, 2);
    // One value moved; a longer row.
    k.begin();
    k.get('a', [list, 6, 'x'], work);
    k.get('a', [list, 6, 'x', 0], work);
    assert.equal(made, 4);
    assert.equal(k.stats.differed, 0);
});

test('a result that ages by the clock alone is worked out again once its moment has passed', () => {
    const k = makeKeeper();
    let made = 0;
    const work = () => ({ n: (made += 1) });
    k.begin();
    k.get('pad', [0], () => 0, { now: 100 });
    k.get('a', [1], work, { now: 100, until: () => 500 });
    k.begin();
    k.get('pad', [0], () => 0, { now: 500 });
    k.get('a', [1], work, { now: 500, until: () => 500 });
    assert.equal(made, 1, 'still holds at its last moment');
    k.begin();
    k.get('pad', [0], () => 0, { now: 501 });
    k.get('a', [1], work, { now: 501, until: () => 900 });
    assert.equal(made, 2, 'worked out again a moment later');
});

test('a kept result that differs from a fresh one stops the keeping, and it is said', () => {
    const said = [];
    const k = makeKeeper({ onDiffer: (key) => said.push(key), checkAll: true });
    let n = 0;
    const lies = () => ({ n: (n += 1) });
    k.begin();
    k.get('a', [1], lies);
    k.begin();
    const out = k.get('a', [1], lies);
    assert.deepEqual(said, ['a']);
    assert.equal(out.n, 2, 'the fresh one is handed out');
    assert.equal(k.on(), false);
    // From here on everything is worked out each time.
    k.get('a', [1], lies);
    k.get('a', [1], lies);
    assert.equal(n, 4);
});

test('with one check a redraw, a kept result that went wrong is still found within a few redraws', () => {
    const said = [];
    const k = makeKeeper({ onDiffer: (key) => said.push(key) });
    const truth = new Map();
    for (let i = 0; i < 9; i += 1) truth.set('i' + i, 1);
    const redraw = () => {
        k.begin();
        for (const [key, v] of truth) k.get(key, ['same'], () => ({ v: truth.get(key) + 0 * v }));
    };
    redraw();
    // The world moved under one item, and nothing in its row of values says so.
    truth.set('i4', 2);
    for (let i = 0; i < 12 && k.on(); i += 1) redraw();
    assert.deepEqual(said, ['i4']);
});

test('frozen for the harness: writing into a kept result fails loudly', () => {
    const k = makeKeeper({ freeze: true });
    k.begin();
    const out = k.get('a', [1], () => ({ steps: [{ qty: 1 }] }));
    assert.throws(() => {
        'use strict';
        out.steps[0].qty = 2;
    });
    assert.throws(() => {
        'use strict';
        out.steps.push({});
    });
});

/* --------------------------------------------------------- the long session */

const ITEMS = Array.from({ length: 14 }, (_, i) => String(300 + i));
const SELLERS = Array.from({ length: 30 }, (_, i) => String(9000 + i));
const TRADERS = Array.from({ length: 12 }, (_, i) => ({ id: String(700 + i), name: 'T' + i }));

function world(r) {
    const int = (n) => Math.floor(r() * n);
    const pick = (list) => list[int(list.length)];
    const s = {
        now: 2_000_000_000_000,
        selfId: SELLERS[0],
        bazaars: new Map(),
        gone: {},
        stock: {},
        bought: [],
        friendBought: [],
        prefs: { maxPerFlip: 100, cash: 0, minProfitPct: 1, networthPct: 10 },
        buyers: new Map(),
        networth: new Map(),
        declined: new Set(),
        avg: new Map(ITEMS.map((id) => [id, 1000 + int(9000)])),
        nextBuy: 1,
    };
    const read = (id) => {
        const n = int(9);
        const rows = [];
        for (let i = 0; i < n; i += 1) {
            const dataAt = s.now - int(FLIP_FRESH_MS + 10 * 60000);
            rows.push({ sellerId: pick(SELLERS), sellerName: 'S', price: Math.round(s.avg.get(id) * (0.7 + r() * 0.5)), qty: 1 + int(40), dataAt, changedAt: r() < 0.5 ? dataAt - int(20 * 60000) : 0 });
        }
        s.bazaars.set(id, { rows, at: s.now });
    };
    const bids = (id) => {
        const list = [];
        for (const t of TRADERS) if (r() < 0.35) list.push({ id: t.id, name: t.name, price: Math.round(s.avg.get(id) * (0.8 + r() * 0.45)) });
        s.buyers.set(id, list.sort((a, b) => b.price - a.price));
    };
    for (const id of ITEMS) {
        if (r() < 0.85) read(id);
        bids(id);
    }
    const rowOf = () => {
        const id = pick(ITEMS);
        const b = s.bazaars.get(id);
        return b && b.rows.length ? [id, pick(b.rows)] : null;
    };
    const steps = [
        () => read(pick(ITEMS)),
        () => bids(pick(ITEMS)),
        () => {
            s.now += int(4 * 60000);
        },
        () => {
            // A long sit: listings go stale, old marks run out.
            s.now += OWN_KEEP_MS / 4 + int(60000);
        },
        () => {
            const x = rowOf();
            if (x) s.gone[goneKey(x[1].sellerId, x[0])] = { at: s.now - int(90000) };
        },
        () => {
            const x = rowOf();
            if (x) s.stock[goneKey(x[1].sellerId, x[0])] = { qty: 1 + int(x[1].qty), price: x[1].price, at: s.now - int(90000) };
        },
        () => {
            const x = rowOf();
            if (x) s.bought.push({ id: 'log' + (s.nextBuy += 1), sellerId: x[1].sellerId, itemId: x[0], qty: 1 + int(x[1].qty), each: x[1].price, t: s.now - int(120000) });
        },
        () => {
            const x = rowOf();
            if (x) s.friendBought.push({ sellerId: x[1].sellerId, itemId: x[0], qty: 1 + int(5), each: x[1].price, t: s.now - int(120000), friend: true, who: 'F' });
        },
        () => {
            s.friendBought = s.friendBought.slice(int(3));
        },
        () => {
            s.prefs = { ...s.prefs, cash: pick([0, 0, 50000, 400000]), maxPerFlip: pick([100, 100, 10, 250]), minProfitPct: pick([1, 1, 3]) };
        },
        () => {
            s.prefs = { ...s.prefs, networthPct: pick([10, 10, 2, 0]) };
        },
        () => s.networth.set(pick(TRADERS).id, pick([null, 5000, 2_000_000, 900_000_000])),
        () => {
            const key = pick(ITEMS) + '|id:' + pick(TRADERS).id;
            if (s.declined.has(key)) s.declined.delete(key);
            else s.declined.add(key);
        },
        () => {
            s.selfId = pick(SELLERS);
        },
        // Nothing at all: a redraw after an answer that changed nothing here.
        () => {},
        () => {},
        () => {},
    ];
    return { s, step: () => pick(steps)() };
}

/** One redraw's working out, as main.js does it (renderSellingWork): kept when a keeper is given, fresh without. */
function redraw(s, keepers) {
    const now = s.now;
    const gone = liveGone(s.gone, now);
    const stock = liveStock(s.stock, now);
    const boughtByItem = new Map();
    for (const b of [...liveBought(s.bought, now), ...s.friendBought]) {
        if (!boughtByItem.has(b.itemId)) boughtByItem.set(b.itemId, []);
        boughtByItem.get(b.itemId).push(b);
    }
    const words = keepers ? keptMarkWords(gone, stock, boughtByItem) : null;
    if (keepers) {
        keepers.sellers.begin();
        keepers.plans.begin();
    }
    const out = {};
    for (const id of ITEMS) {
        const b = s.bazaars.get(id);
        const sellers = () => bazaarSellers(withOwnBuys(withoutGone(b.rows, id, gone), id, { stock, bought: boughtByItem.get(id) || null }), { selfId: s.selfId, now });
        const rows = !b ? null : keepers ? keepers.sellers.get(id, [b.rows, b.at, s.selfId, words.get(id) || '', null, undefined], sellers, { now, until: (x) => keptFreshUntil(x, FLIP_FRESH_MS) }) : sellers();
        const unitsOf = (x) => payableUnits(x.price, s.networth.has(x.id) ? s.networth.get(x.id) : null, s.prefs.networthPct);
        const fbs = flipBuyers(s.buyers.get(id) || [], { avg: s.avg.get(id), type: 'Drug', unitsOf });
        const declined = (x) => s.declined.has(id + '|id:' + x.id);
        const planFrom = () => {
            let best = null;
            for (const x of fbs) {
                if (declined(x)) continue;
                const most = Math.min(s.prefs.maxPerFlip || 100, x.maxUnits ? x.maxUnits : Infinity);
                const plan = flipPlan(rows, x.price, { cash: s.prefs.cash, maxUnits: most, minPct: s.prefs.minProfitPct });
                if (!plan) continue;
                if (!best || plan.profit > best.profit || (plan.profit === best.profit && plan.units > 0 && !best.units)) best = { ...plan, buyer: x };
            }
            return best;
        };
        let plan = null;
        if (rows && keepers) {
            const k = keepers.plans.get(id, keptPlanSig(rows, s.prefs, fbs, declined), () => {
                const best = planFrom();
                if (!best) return null;
                const { buyer, ...rest } = best;
                return { plan: rest, at: fbs.indexOf(buyer) };
            });
            plan = k ? { ...k.plan, buyer: fbs[k.at] } : null;
        } else if (rows) {
            plan = planFrom();
        }
        out[id] = { rows, plan };
    }
    return out;
}

for (const seed of [1, 7, 20261011]) {
    test('a long session, seed ' + seed + ': every item\'s kept bazaars and kept plan are the fresh ones, at every step', () => {
        const r = rng(seed);
        const { s, step } = world(r);
        const differed = [];
        // Frozen: the working out must never write into what is kept. One check a redraw, as in use.
        const keepers = { sellers: makeKeeper({ freeze: true, onDiffer: (id) => differed.push('bazaars ' + id) }), plans: makeKeeper({ freeze: true, onDiffer: (id) => differed.push('plan ' + id) }) };
        for (let i = 0; i < 1500; i += 1) {
            step();
            const kept = redraw(s, keepers);
            const fresh = redraw(s, null);
            assert.deepEqual(kept, fresh, 'step ' + i);
        }
        assert.deepEqual(differed, [], 'the keeper\'s own check never found a difference');
        // And it did keep: a redraw works out a small part of the items, not all of them.
        for (const k of [keepers.sellers, keepers.plans]) {
            assert.ok(k.stats.kept > k.stats.redone * 2, 'kept ' + k.stats.kept + ', worked out ' + k.stats.redone);
            assert.ok(k.stats.checked > 500, 'checked ' + k.stats.checked);
        }
    });
}

test('your marks as one word per item: only the marked item\'s word moves', () => {
    const gone = { '9001|300': { at: 5 } };
    const stock = { '9002|301': { qty: 3, price: 10, at: 6 } };
    const bought = new Map([['302', [{ sellerId: '9003', qty: 2, each: 11, t: 7 }]]]);
    const a = keptMarkWords(gone, stock, bought);
    assert.deepEqual([...a.keys()].sort(), ['300', '301', '302']);
    const b = keptMarkWords({ ...gone, '9004|300': { at: 9 } }, stock, bought);
    assert.notEqual(b.get('300'), a.get('300'));
    assert.equal(b.get('301'), a.get('301'));
    assert.equal(b.get('302'), a.get('302'));
    // A buy counted again with another number is another word.
    const c = keptMarkWords(gone, stock, new Map([['302', [{ sellerId: '9003', qty: 3, each: 11, t: 7 }]]]));
    assert.notEqual(c.get('302'), a.get('302'));
});
