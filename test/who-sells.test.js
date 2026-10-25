// The who-sells-what index, this PC's side (core/who-sells.js): what is told, what is asked, how the answer orders the reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WHO_KEEP_MS, WHO_MAX_SEES, WHO_MAX_SEES_SELLERS, WHO_MAX_MISSED, WHO_EVERY_MS, WHO_PRESS_GAP_MS, WHO_USE_MS, WHO_CHEAP_MS,
    whoId, seesOf, lookedOf, missedOf, whoOutNew, whoOutAdd, whoOutTake, whoOutDrop, whoOutValid, sellersOfRows, coverItemIds,
    whoAskPlan, whoAskBody, whoBackoffMs, whoMayAsk, whoAnswerIn, whoFresh, itemChance, rankReads, rankItems, cheapItems, whoSellerWants, cheapConfirmedBy,
} from '../src/core/who-sells.js';
import { sharedBody, sharedOutgoingOk } from '../src/core/shared.js';

const NOW = 10_000_000;

test('ids: the Item Market, names and zero are not sellers', () => {
    assert.equal(whoId('123'), 123);
    for (const x of ['market', 'Item Market', '0', '-4', '', null, undefined, '12a', '99999999999']) assert.equal(whoId(x), null);
    assert.deepEqual(sellersOfRows([{ sellerId: '5' }, { sellerId: 'market' }, { sellerId: null }, { sellerId: 7 }]), ['5', 7]);
});

test('entries: no sellers, no item or no time is not told; repeats and the market go', () => {
    assert.deepEqual(seesOf('10', ['5', '5', 'market', '6'], NOW), [10, NOW, [5, 6]]);
    assert.equal(seesOf('10', ['market'], NOW), null);
    assert.equal(seesOf('x', ['5'], NOW), null);
    assert.equal(seesOf('10', ['5'], 0), null);
    assert.equal(seesOf('10', Array.from({ length: 400 }, (_, i) => i + 1), NOW)[2].length, WHO_MAX_SEES_SELLERS);
    assert.deepEqual(lookedOf('9', ['1', '2', 'x'], NOW), [9, NOW, [1, 2]]);
    assert.equal(lookedOf('market', ['1'], NOW), null);
    assert.deepEqual(missedOf('9', '3', NOW), [9, 3, NOW]);
    assert.equal(missedOf('market', '3', NOW), null);
});

test('the box: a repeat replaces, an hour old goes, the caps hold', () => {
    let box = whoOutNew();
    box = whoOutAdd(box, 'sees', seesOf(1, [5], NOW - 1000), NOW);
    box = whoOutAdd(box, 'sees', seesOf(1, [5, 6], NOW), NOW);
    assert.deepEqual(box.sees, [[1, NOW, [5, 6]]]);
    box = whoOutAdd(box, 'missed', missedOf(5, 1, NOW - WHO_KEEP_MS - 1), NOW);
    box = whoOutAdd(box, 'looked', lookedOf(5, [1], NOW - WHO_KEEP_MS - 5), NOW);
    // old ones are dropped by the next add
    box = whoOutAdd(box, 'sees', seesOf(2, [7], NOW), NOW);
    assert.equal(box.missed.length, 0);
    assert.equal(box.looked.length, 0);
    for (let i = 1; i <= 80; i += 1) box = whoOutAdd(box, 'sees', seesOf(100 + i, [i], NOW), NOW);
    assert.equal(box.sees.length, WHO_MAX_SEES);
    assert.ok(box.sees.some((e) => e[0] === 180));
    for (let i = 1; i <= 150; i += 1) box = whoOutAdd(box, 'missed', missedOf(i, 1, NOW), NOW);
    assert.equal(box.missed.length, WHO_MAX_MISSED);
    assert.deepEqual(whoOutAdd(null, 'sees', null, NOW), whoOutNew());
});

test('taking: ages not times, newest first, nothing over an hour, and the box shrinks by what was told', () => {
    let box = whoOutNew();
    box = whoOutAdd(box, 'sees', seesOf(1, [5], NOW - 5000), NOW);
    box = whoOutAdd(box, 'sees', seesOf(2, [6], NOW - 1000), NOW);
    box = whoOutAdd(box, 'looked', lookedOf(5, [1, 2], NOW - 2000), NOW);
    box = whoOutAdd(box, 'missed', missedOf(5, 1, NOW), NOW);
    const { body, taken, counts } = whoOutTake(box, NOW);
    assert.deepEqual(body.sees, [[2, 1000, [6]], [1, 5000, [5]]]);
    assert.deepEqual(body.looked, [[5, 2000, [1, 2]]]);
    assert.deepEqual(body.missed, [[5, 1]]);
    assert.deepEqual(counts, { sees: 2, looked: 1, missed: 1 });
    for (const k of Object.keys(body)) assert.ok(whoOutValid(k, body[k]), k);
    // an entry seen again meanwhile (newer) stays; the told ones go
    box = whoOutAdd(box, 'sees', seesOf(2, [6, 8], NOW + 10), NOW + 10);
    const left = whoOutDrop(box, taken);
    assert.deepEqual(left.sees, [[2, NOW + 10, [6, 8]]]);
    assert.equal(left.looked.length + left.missed.length, 0);
    // a box that is all old tells nothing
    assert.deepEqual(whoOutTake(box, NOW + WHO_KEEP_MS + 100).body, {});
    assert.deepEqual(whoOutTake(null, NOW).body, {});
});

test('the exchange body carries them and its check accepts exactly that', () => {
    let box = whoOutAdd(null, 'sees', seesOf(1, [5, 6], NOW - 3000), NOW);
    box = whoOutAdd(box, 'missed', missedOf(5, 1, NOW), NOW);
    const body = sharedBody({ who: box, now: NOW });
    assert.deepEqual(body.sees, [[1, 3000, [5, 6]]]);
    assert.deepEqual(body.missed, [[5, 1]]);
    assert.ok(!('looked' in body));
    assert.ok(sharedOutgoingOk(body));
    assert.ok(!sharedOutgoingOk({ ...body, sees: [[1, 3000, ['market']]] }));
    assert.ok(!sharedOutgoingOk({ ...body, missed: [[5, 1, 2]] }));
    assert.ok(!sharedOutgoingOk({ ...body, looked: [[1, WHO_KEEP_MS + 1, [2]]] }));
    assert.ok(!('sees' in sharedBody({ now: NOW })));
});

test('a bazaar page read whole: the items of its rows', () => {
    assert.deepEqual(coverItemIds({ rows: { 0: '5,6,7', 1: '7,8' } }).sort(), ['5', '6', '7', '8']);
    assert.deepEqual(coverItemIds(null), []);
});

test('asking: the item in view, the pressed items, then the flips; a press brings the list weighted', () => {
    const plan = whoAskPlan({ view: '9', candidates: [{ itemId: '3', profit: 5 }, { itemId: '9', profit: 4 }, { itemId: 'x' }], pressed: { all: ['7', '8'], gap: { 7: 1500.4 } } });
    assert.deepEqual(plan.items, [9, 7, 8, 3]);
    assert.deepEqual(plan.list, [[7, 1500], [8, 1]]);
    const body = whoAskBody(plan);
    assert.deepEqual(Object.keys(body).sort(), ['items', 'list', 'n']);
    assert.ok(body.n >= 1 && body.n <= 50);
    assert.equal(whoAskPlan({}), null);
    assert.equal(whoAskBody(null), null);
    assert.equal(whoAskPlan({ candidates: [{ itemId: '3', profit: 1 }] }).list, null);
    const big = whoAskPlan({ candidates: Array.from({ length: 300 }, (_, i) => ({ itemId: String(i + 1), profit: 1 })), pressed: { all: Array.from({ length: 400 }, (_, i) => String(i + 1)) } });
    assert.equal(big.items.length, 100);
    assert.equal(big.list.length, 200);
});

test('asking pace: a minute, at once on a press, backed off after a failure', () => {
    assert.ok(whoMayAsk({}, NOW));
    assert.ok(!whoMayAsk({ lastAt: NOW - 10000 }, NOW));
    assert.ok(whoMayAsk({ lastAt: NOW - WHO_EVERY_MS }, NOW));
    assert.ok(whoMayAsk({ lastAt: NOW - 10000, pressAt: NOW - 5000 }, NOW));
    assert.ok(!whoMayAsk({ lastAt: NOW - 2000, pressAt: NOW - 1000 }, NOW));
    assert.ok(whoMayAsk({ lastAt: NOW - WHO_PRESS_GAP_MS - 1, pressAt: NOW - 1 }, NOW));
    assert.ok(!whoMayAsk({ lastAt: NOW - 70000, fails: 1, failedAt: NOW - 30000 }, NOW));
    assert.ok(!whoMayAsk({ lastAt: NOW - 70000, pressAt: NOW - 1, fails: 1, failedAt: NOW - 30000 }, NOW));
    assert.ok(!whoMayAsk({ lastAt: NOW - 700000, fails: 3, failedAt: NOW - 3 * 60000 }, NOW));
    assert.ok(whoMayAsk({ lastAt: NOW - 700000, fails: 3, failedAt: NOW - 5 * 60000 }, NOW));
    assert.equal(whoBackoffMs(1), 60000);
    assert.equal(whoBackoffMs(3), 240000);
    assert.equal(whoBackoffMs(30), 30 * 60000);
});

const ANSWER = {
    now: 1,
    items: [
        { item: 1, sellers: [{ id: 5, score: 2, ago: 1000 }, { id: 6, score: 1, ago: 5000 }] },
        { item: 2, sellers: [] },
        { item: 'x', sellers: [] },
        { item: 3, sellers: [{ id: 'market', score: 1, ago: 1 }, { id: 9, score: -1, ago: 1 }] },
    ],
    together: [{ id: 5, score: 3, items: 4 }, { id: 6, score: 5, items: 2 }, { id: 'bad', score: 1, items: 1 }],
    cheap: [{ item: 1, seller: 7, price: 90, worth: 100, ago: 60000 }, { item: 4, seller: 8, price: 10, worth: 20, ago: 1000 }, { item: 4, seller: 8, price: 0, worth: 20, ago: 1 }],
    hot: [[5, 0.4], ['x', 1]],
    known: { sellers: 100, postings: 5000 },
};

test('the answer is checked: only well-formed rows stay, on this PC\'s clock', () => {
    assert.equal(whoAnswerIn(null, NOW), null);
    assert.equal(whoAnswerIn({ items: 'no' }, NOW), null);
    const w = whoAnswerIn(ANSWER, NOW);
    assert.deepEqual([...w.items.keys()], ['1', '2', '3']);
    assert.deepEqual(w.items.get('1'), [{ id: '5', score: 2, ago: 1000 }, { id: '6', score: 1, ago: 5000 }]);
    assert.deepEqual(w.items.get('3'), []);
    assert.deepEqual(w.together.map((t) => t.id), ['5', '6']);
    assert.deepEqual(w.cheap.map((c) => [c.item, c.seller, c.at]), [['1', '7', NOW - 60000], ['4', '8', NOW - 1000]]);
    assert.deepEqual([...w.hot], [['5', 0.4]]);
    assert.deepEqual(w.known, { sellers: 100, postings: 5000 });
    assert.equal(whoAnswerIn({ items: [], cheap: [{ item: 1, seller: 2, price: 1, worth: 2, ago: 0 }] }, NOW).known, null);
    assert.equal(whoFresh(w, NOW + WHO_USE_MS), null);
    assert.equal(whoFresh(w, NOW + 1000), w);
});

test('likelihood: neutral without an answer, lower for an item nobody is known to sell, highest for a cheap listing', () => {
    const w = whoAnswerIn(ANSWER, NOW);
    assert.equal(itemChance(null, '1', NOW), 1);
    assert.equal(itemChance(w, '99', NOW), 1);
    assert.equal(itemChance(w, '2', NOW), 0.5);
    assert.equal(itemChance(w, '4', NOW), 2);
    const fresh = whoAnswerIn({ items: [{ item: 1, sellers: [{ id: 5, score: 1, ago: 1000 }] }], cheap: [] }, NOW);
    const c1 = itemChance(fresh, '1', NOW);
    assert.ok(c1 > 0.6 && c1 <= 1);
    const old = whoAnswerIn({ items: [{ item: 1, sellers: [{ id: 5, score: 1, ago: 3000000 }] }], cheap: [] }, NOW);
    assert.ok(c1 > itemChance(old, '1', NOW));
    assert.equal(itemChance(w, '1', NOW), 2);
    // an old answer says nothing
    assert.equal(itemChance(w, '2', NOW + WHO_USE_MS + 1), 1);
});

test('ranking: profit times chance over cost, ties keep the order given', () => {
    assert.deepEqual(rankReads([{ id: 'a', profit: 100 }, { id: 'b', profit: 100 }, { id: 'c', profit: 100 }]), ['a', 'b', 'c']);
    assert.deepEqual(rankReads([{ id: 'a', profit: 100, chance: 0.5 }, { id: 'b', profit: 60 }]), ['b', 'a']);
    assert.deepEqual(rankReads([{ id: 'a', profit: 100, cost: 2 }, { id: 'b', profit: 60, cost: 1 }]), ['b', 'a']);
    assert.equal(rankReads([{ id: 'a', profit: 100, cost: 0 }, { id: 'b', profit: 1000, cost: 1 }]).length, 2);
    assert.deepEqual(rankReads(null), []);
});

test('items to read: cheap listings first (newest first), the rest by the ranking; no answer = the order given', () => {
    const cands = [{ itemId: '1', profit: 100 }, { itemId: '2', profit: 90 }, { itemId: '3', profit: 80 }];
    assert.deepEqual(rankItems(cands, { who: null, now: NOW }), ['1', '2', '3']);
    const w = whoAnswerIn(ANSWER, NOW);
    // 4 has a cheap listing (not a candidate): first; 1 also cheap but older; item 2 and 3 nobody is known to sell: halved
    assert.deepEqual(rankItems(cands, { who: w, now: NOW }), ['4', '1', '2', '3']);
    const more = [...cands, { itemId: '9', profit: 60 }];
    assert.deepEqual(rankItems(more, { who: w, now: NOW }), ['4', '1', '9', '2', '3']);
    assert.deepEqual(cheapItems(w, NOW), ['4', '1']);
    // 1 hour on the cheap ones are old
    assert.deepEqual(cheapItems(w, NOW + WHO_CHEAP_MS), []);
    assert.deepEqual(cheapItems(w, NOW + WHO_USE_MS + 1), []);
    // a costlier read goes later
    assert.deepEqual(rankItems(cands, { who: null, now: NOW, costOf: (id) => (id === '1' ? 3 : 1) }), ['2', '3', '1']);
});

test('bazaars to read whole: cheap sellers first, together only while a trader is pressed, none already read', () => {
    const w = whoAnswerIn(ANSWER, NOW);
    assert.deepEqual(whoSellerWants({ who: w, now: NOW }), [{ id: '8', why: 'cheap' }, { id: '7', why: 'cheap' }]);
    assert.deepEqual(whoSellerWants({ who: w, now: NOW, pressed: true }).map((x) => x.id), ['8', '7', '6', '5']);
    assert.deepEqual(whoSellerWants({ who: w, now: NOW, pressed: true, skip: (id) => id === '8' || id === '6' }).map((x) => x.id), ['7', '5']);
    assert.equal(whoSellerWants({ who: w, now: NOW, pressed: true, max: 3 }).length, 3);
    assert.deepEqual(whoSellerWants({ who: null, now: NOW, pressed: true }), []);
});

test('a cheap listing is confirmed when the seller\'s bazaar read lists the item', () => {
    const w = whoAnswerIn(ANSWER, NOW);
    assert.deepEqual(cheapConfirmedBy(w, NOW, '7', new Set(['1', '2'])), ['7|1']);
    assert.deepEqual(cheapConfirmedBy(w, NOW, '7', new Set(['2'])), []);
    assert.deepEqual(cheapConfirmedBy(null, NOW, '7', ['1']), []);
});
