/*
 * 3.17.0: stored data nobody uses is deleted. The rule for every tidy-up:
 * what a reader gets from the tidied value is exactly what it gets from the
 * stored one - so no feature can show anything different.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { tidyAccepted, tidyPins, tidyGone, tidyStock, tidyBought, tidyDeclined, tidyCancelUndo, tidyLeftovers, tidyTeLists } from '../src/core/tidy.js';
import * as tidyRules from '../src/core/tidy.js';
import { liveAccepted, ACCEPTED_MAX_AGE_MS } from '../src/core/accepted.js';
import { livePins } from '../src/core/held.js';
import { liveGone, liveStock, liveBought, markGone, noteStock, FLIP_FRESH_MS } from '../src/core/flips.js';
import { readTeItemLists, TE_ITEM_TTL_MS } from '../src/core/selling.js';

const NOW = 1_790_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const copy = (v) => JSON.parse(JSON.stringify(v));

/** The tidied value reads the same, is smaller when something expired, and is the same object when nothing did. */
function proves(tidy, read, stored, { drops }) {
    const before = copy(stored);
    const next = tidy(stored, NOW);
    assert.deepEqual(stored, before, 'the stored value is not edited');
    assert.deepEqual(read(next, NOW), read(stored, NOW), 'a reader gets the same from both');
    if (drops) {
        assert.notEqual(next, stored);
        assert.ok(JSON.stringify(next).length < JSON.stringify(stored).length, 'smaller');
        assert.equal(tidy(next, NOW), next, 'tidied once is tidy: nothing to write again');
    } else {
        assert.equal(next, stored, 'nothing expired: the same object, nothing is written');
    }
}

const trade = (key, at) => ({ key, trader: { id: key.slice(3), name: 'T' + key }, itemId: '206', at, items: [{ line: 'flip:206', itemId: '206', name: 'Xanax', units: 2, bid: 850000, kind: 'flip', steps: [{ sellerId: '1', qty: 2, price: 840000, bought: false }] }] });

test('accepted trades: past a day they go; a live one is untouched', () => {
    const live = trade('id:11', NOW - HOUR);
    const old = trade('id:12', NOW - ACCEPTED_MAX_AGE_MS - 1);
    proves(tidyAccepted, liveAccepted, { 'id:11': live, 'id:12': old }, { drops: true });
    proves(tidyAccepted, liveAccepted, { 'id:11': live }, { drops: false });
    assert.deepEqual(Object.keys(tidyAccepted({ 'id:11': live, 'id:12': old, junk: 5 }, NOW)), ['id:11'], 'what no reader returns goes too');
});

test('pins, gone marks, page stocks, own buys: each as its reader keeps it', () => {
    const pin = (at) => ({ key: 'id:11', at, lines: [{ itemId: '206' }] });
    proves(tidyPins, livePins, { '206|id:11': pin(NOW - HOUR), '1|id:11': pin(NOW - 400 * DAY) }, { drops: true });
    proves(tidyPins, livePins, { '206|id:11': pin(NOW - HOUR) }, { drops: false });

    const gone = { ...markGone(null, '1', '206', NOW - MIN), '2|206': { at: NOW - FLIP_FRESH_MS - 1 } };
    proves(tidyGone, liveGone, gone, { drops: true });
    proves(tidyGone, liveGone, markGone(null, '1', '206', NOW - MIN), { drops: false });

    const stock = { ...noteStock(null, '1', '206', 60, 840000, NOW - MIN), '2|206': { qty: 5, price: 1, at: NOW - FLIP_FRESH_MS - 1 } };
    proves(tidyStock, liveStock, stock, { drops: true });
    proves(tidyStock, liveStock, noteStock(null, '1', '206', 60, 840000, NOW - MIN), { drops: false });

    const buy = (id, t) => ({ id, sellerId: '1', itemId: '206', qty: 2, each: 840000, t });
    proves(tidyBought, liveBought, [buy('a:0', NOW - FLIP_FRESH_MS - 1), buy('b:0', NOW - MIN)], { drops: true });
    proves(tidyBought, liveBought, [buy('b:0', NOW - MIN)], { drops: false });
});

test('declined trades, cancelled trades kept to be put right, leftovers', () => {
    const declined = (s, now) => Object.fromEntries(Object.entries(s || {}).filter(([, until]) => Number(until) > now));
    proves(tidyDeclined, declined, { a: NOW + HOUR, b: NOW - 1 }, { drops: true });
    proves(tidyDeclined, declined, { a: NOW + HOUR }, { drops: false });

    const KEEP = 3 * HOUR;
    const undo = (s, now) => Object.fromEntries(Object.entries(s || {}).filter(([, u]) => u && u.trade && now - Number(u.at) < KEEP));
    const u = (at) => ({ trade: trade('id:11', at - HOUR), left: [], recs: [], at });
    proves((s, t) => tidyCancelUndo(s, t, KEEP), undo, { 'id:11': u(NOW - HOUR), 'id:12': u(NOW - KEEP - 1) }, { drops: true });
    proves((s, t) => tidyCancelUndo(s, t, KEEP), undo, { 'id:11': u(NOW - HOUR) }, { drops: false });

    const WEEK = 7 * DAY;
    const leftovers = (s, now) => (Array.isArray(s) ? s : []).filter((l) => l && l.itemId && l.qty > 0 && now - Number(l.at) < WEEK);
    const l = (at, qty = 3) => ({ itemId: '206', name: 'Xanax', qty, each: 840000, from: 'Bob', at });
    proves((s, t) => tidyLeftovers(s, t, WEEK), leftovers, [l(NOW - HOUR), l(NOW - WEEK - 1), l(NOW - HOUR, 0)], { drops: true });
    proves((s, t) => tidyLeftovers(s, t, WEEK), leftovers, [l(NOW - HOUR)], { drops: false });
});

test('TornExchange: a full list past half an hour goes; the top buyers are left alone', () => {
    const lists = { 206: { at: NOW - MIN, traders: [['Bob', 850000]] }, 1: { at: NOW - TE_ITEM_TTL_MS - 1, traders: [['Al', 110]] } };
    const read = (s, now) => [...readTeItemLists(s, now)];
    proves(tidyTeLists, read, lists, { drops: true });
    proves(tidyTeLists, read, { 206: lists[206] }, { drops: false });

    // teCache has no rule: a Torn Bids tab left open goes on showing the copy it holds past a day,
    // and deleting the stored one would take those buyers off that tab.
    assert.equal(Object.keys(tidyRules).some((k) => /cache/i.test(k)), false);
});

test('junk in a store is left as it is: the tidy-up never guesses', () => {
    for (const junk of [null, undefined, 5, 'x']) {
        for (const tidy of [tidyAccepted, tidyPins, tidyGone, tidyStock, tidyBought, tidyDeclined, tidyCancelUndo, tidyLeftovers, tidyTeLists]) assert.equal(tidy(junk, NOW), junk);
    }
    const list = [1, 2];
    assert.equal(tidyAccepted(list, NOW), list);
    const obj = { a: 1 };
    assert.equal(tidyBought(obj, NOW), obj);
    assert.equal(tidyLeftovers(obj, NOW), obj);
});
