/*
 * 3.23.0, item 10 (the owner, 2026-10-05): the amber mark of an old price
 * list on the Your traders cards and on the overlay's trader tag ("yes add it
 * to both"), and "yes the overlay tag should hide old traders too".
 *
 * - core/traders.js tradeOldList: a trade's old list, from its lines.
 * - ui/overlay.js markTraderTags: the tag's second data attribute.
 * - core/traders.js tagBuyer: the trader a bazaar card names, with Fresh
 *   prices only on and off.
 * - core/traders.js packListAt / readListAtRows: the list dates as every
 *   page can read them. Torn Bids kept them in its own page's storage, which
 *   a page on torn.com never sees: the tag had no date to go by on real Torn.
 *
 * Namespace imports on purpose: a helper that is missing fails its own test,
 * not the whole file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as traders from '../src/core/traders.js';
import * as overlay from '../src/ui/overlay.js';

const NOW = 1_790_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TRUSTED = { level: 'Trusted', score: 214 };
const KNOWN = { level: 'Known', score: 40 };

/** A card as markTraderTags needs it: a class list and a dataset. */
function card() {
    const classes = new Set();
    return { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }, dataset: {} };
}
const rootOf = (cards) => ({ querySelectorAll: () => cards.filter((c) => c.dataset.ttv2Trader !== undefined) });

test('the overlay tag (item 10c): old is written beside the label, changed when the list ages on, taken off when it is fresh or the tag goes', () => {
    const a = card();
    const b = card();
    const root = rootOf([a, b]);
    overlay.markTraderTags([{ el: a, label: 'Bob pays $110 · +$10 each', old: 'aging' }, { el: b, label: 'Kay pays $90 · +$5 each', old: null }], root);
    assert.equal(a.dataset.ttv2Trader, 'Bob pays $110 · +$10 each');
    assert.equal(a.dataset.ttv2TraderOld, 'aging');
    assert.equal('ttv2TraderOld' in b.dataset, false);
    assert.equal(overlay.TRADER_OLD_KEY, 'ttv2TraderOld');
    // Past two days (Fresh prices only off): the still dot.
    overlay.markTraderTags([{ el: a, label: 'Bob pays $110 · +$10 each', old: 'stale' }, { el: b, label: 'Kay pays $90 · +$5 each' }], root);
    assert.equal(a.dataset.ttv2TraderOld, 'stale');
    // Their list was changed: the dot goes, the tag stays.
    overlay.markTraderTags([{ el: a, label: 'Bob pays $110 · +$10 each', old: null }], root);
    assert.equal('ttv2TraderOld' in a.dataset, false);
    assert.equal(a.classList.contains('ttv2-trader'), true);
    // The card no longer tagged loses everything of ours.
    assert.equal('ttv2Trader' in b.dataset, false);
    assert.equal(b.classList.contains('ttv2-trader'), false);
    overlay.markTraderTags([{ el: a, label: 'Bob pays $110 · +$10 each', old: 'aging' }], root);
    overlay.markTraderTags([], root);
    assert.deepEqual(Object.keys(a.dataset), []);
    // Only the two words the stylesheet draws are ever written.
    overlay.markTraderTags([{ el: a, label: 'x', old: 'yes' }], root);
    assert.equal('ttv2TraderOld' in a.dataset, false);
});

test('the overlay tag (item 10d): with Fresh prices only on, a trader whose list is over two days old is passed over for the next Trusted one', () => {
    assert.equal(typeof traders.tagBuyer, 'function');
    const listAt = new Map([['1', NOW - 20 * DAY], ['2', NOW - 30 * HOUR], ['3', NOW - 20 * DAY]]);
    const listAtOf = (id) => listAt.get(String(id)) || 0;
    const buyers = [
        { id: '9', name: 'Known, not Trusted', price: 950, w3b: 950, te: null, trust: KNOWN },
        { id: '1', name: 'Weeks old', price: 900, w3b: 900, te: null, trust: TRUSTED },
        { id: '2', name: 'A day and six hours', price: 890, w3b: 890, te: null, trust: TRUSTED },
        { id: '3', name: 'Weeks old too', price: 880, w3b: 880, te: null, trust: TRUSTED },
    ];
    // The stale trader passed over, the next one named.
    assert.equal(traders.tagBuyer(buyers, { fresh: true, listAtOf, now: NOW }).id, '2');
    // The switch off: named as before (with the still amber dot of 10c).
    assert.equal(traders.tagBuyer(buyers, { fresh: false, listAtOf, now: NOW }).id, '1');
    assert.equal(traders.tagBuyer(buyers, { listAtOf, now: NOW }).id, '1');
    // None left: no tag.
    assert.equal(traders.tagBuyer([buyers[1], buyers[3]], { fresh: true, listAtOf, now: NOW }), null);
    // A date not known is not old: not hidden.
    assert.equal(traders.tagBuyer([{ ...buyers[1], id: '4' }], { fresh: true, listAtOf, now: NOW }).id, '4');
    // A price TornExchange lists too has no date to go by: left alone, as in Torn Bids.
    assert.equal(traders.tagBuyer([{ ...buyers[1], te: 900 }], { fresh: true, listAtOf, now: NOW }).id, '1');
    // Never a trader without the Trusted badge, whatever the switch.
    assert.equal(traders.tagBuyer([buyers[0]], { fresh: true, listAtOf, now: NOW }), null);
    assert.equal(traders.tagBuyer([], { fresh: true, listAtOf, now: NOW }), null);
    // Never at odds with Torn Bids: what it names is never one freshOnly hides.
    const named = traders.tagBuyer(buyers, { fresh: true, listAtOf, now: NOW });
    assert.equal(traders.stalePrice(named, listAtOf, NOW), false);
});

test('the list dates for every page: Torn Bids packs them, a page on torn.com reads them back', () => {
    assert.equal(typeof traders.packListAt, 'function');
    assert.equal(typeof traders.readListAtRows, 'function');
    const listAt = new Map([['1', NOW - 3 * DAY], ['2', NOW - 30 * HOUR], ['3', NOW - HOUR]]);
    const packed = traders.packListAt(listAt);
    // Seconds, newest first: short to store.
    assert.deepEqual(packed, [['3', Math.round((NOW - HOUR) / 1000)], ['2', Math.round((NOW - 30 * HOUR) / 1000)], ['1', Math.round((NOW - 3 * DAY) / 1000)]]);
    const back = traders.readListAtRows(JSON.parse(JSON.stringify(packed)));
    assert.deepEqual([...back], [['3', NOW - HOUR], ['2', NOW - 30 * HOUR], ['1', NOW - 3 * DAY]]);
    // The newest are kept when there are too many.
    assert.deepEqual(traders.packListAt(listAt, 2).map((r) => r[0]), ['3', '2']);
    // Anything else stored there is no date at all.
    for (const junk of [null, undefined, 'x', 7, {}, [['', 5], ['5', 0], ['6', 'soon'], [7], 'row', null]]) assert.equal(traders.readListAtRows(junk).size, 0);
    // The first date for an id wins (the list is newest first).
    assert.deepEqual([...traders.readListAtRows([['1', 200], ['1', 100]])], [['1', 200000]]);
});

test('a Your traders card (item 10b): its trade is old when the first of its lines priced from that trader\'s old TornW3B list is', () => {
    assert.equal(typeof traders.tradeOldList, 'function');
    const listAt = new Map([['7', NOW - 30 * HOUR]]);
    const listAtOf = (id) => listAt.get(String(id)) || 0;
    const rows = new Map([
        ['206', { id: '7', price: 850000, w3b: 850000, te: 850000 }],
        ['180', { id: '7', price: 60, w3b: 60, te: null }],
        ['1', { id: '7', price: 110, w3b: null, te: 110 }],
    ]);
    const rowOf = (itemId) => rows.get(String(itemId)) || null;
    // The first line is on TornExchange too (no date to go by); the second is the old list's.
    assert.deepEqual(traders.tradeOldList([{ itemId: '206' }, { itemId: '180' }], rowOf, listAtOf, NOW), { at: NOW - 30 * HOUR, level: 'aging' });
    // No line priced from the TornW3B list alone: nothing to say.
    assert.equal(traders.tradeOldList([{ itemId: '206' }, { itemId: '1' }], rowOf, listAtOf, NOW), null);
    // A line whose row is not known says nothing, and breaks nothing.
    assert.equal(traders.tradeOldList([{ itemId: '999' }], rowOf, listAtOf, NOW), null);
    assert.equal(traders.tradeOldList([], rowOf, listAtOf, NOW), null);
    assert.equal(traders.tradeOldList(null, rowOf, listAtOf, NOW), null);
    // Changed within the day: nothing.
    assert.equal(traders.tradeOldList([{ itemId: '180' }], rowOf, () => NOW - HOUR, NOW), null);
    // Over two days (seen only with Fresh prices only off): stale.
    assert.equal(traders.tradeOldList([{ itemId: '180' }], rowOf, () => NOW - 3 * DAY, NOW).level, 'stale');
});
