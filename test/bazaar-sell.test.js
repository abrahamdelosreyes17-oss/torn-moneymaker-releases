/*
 * 3.22.0: your bazaar's sell list (core/bazaar-sell.js; the owner, 2026-10-03:
 * "everything bought in last 24 hours, prioritise sell list ... only unsold
 * units that ive bought ... skip rows that would sell under what i paid"),
 * the Ledger's Sold tab (core/ledger.js; mockup W) and its To sell tags
 * (core/to-sell.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { unsoldBought, boughtRecord, liveBoughtItems, sameBoughtItems, bazaarSellList, underPaid, BOUGHT_WINDOW_MS } from '../src/core/bazaar-sell.js';
import { matchFifo, soldRows, soldByVenue, soldOutcome, boughtFromText } from '../src/core/ledger.js';
import { noteToSell, liveWasToSell, toSellTags, WAS_TO_SELL_KEEP_MS } from '../src/core/to-sell.js';
import { tidyWasToSell, tidyHeld } from '../src/core/tidy.js';
import { sellElsewhere } from '../src/core/accepted.js';

const NOW = 1_790_000_000_000;
const H = 60 * 60 * 1000;
let n = 0;
const row = (side, itemId, qty, each, hoursAgo, venue = 'bazaar', extra = {}) => ({ id: 'r' + (n += 1), t: NOW - hoursAgo * H, itemId: String(itemId), qty, each, fee: 0, side, venue, who: '5', whoName: null, ...extra });

test('unsold bought: only what was bought in the window and is still held, at what it cost', () => {
    const rows = [
        row('buy', 206, 5, 800000, 72),   // three days ago: not in the window
        row('buy', 206, 3, 850000, 5),
        row('buy', 206, 2, 860000, 2),
        row('buy', 180, 10, 40, 3),
        row('sell', 180, 10, 55, 1),      // all sold again
        row('buy', 258, 4, 13000, 30),    // over a day ago
    ];
    const got = unsoldBought(rows, { since: NOW - BOUGHT_WINDOW_MS });
    assert.deepEqual(got, [{ itemId: '206', qty: 5, each: 854000, at: NOW - 2 * H }]);
});

test('unsold bought: a sale uses up the oldest units first, a gift too', () => {
    const rows = [
        row('buy', 206, 5, 800000, 72),
        row('buy', 206, 3, 850000, 5),
        row('sell', 206, 6, 870000, 4, 'trade'),   // the 5 old ones and 1 of today's
        row('buy', 206, 2, 860000, 2),
        row('give', 206, 1, 0, 1, 'trade'),         // 1 more of today's
    ];
    const got = unsoldBought(rows, { since: NOW - BOUGHT_WINDOW_MS });
    assert.equal(got.length, 1);
    assert.equal(got[0].qty, 3);
    assert.equal(got[0].each, Math.round((1 * 850000 + 2 * 860000) / 3));
});

test('unsold bought: rows out of order are put in order, and nothing bought gives nothing', () => {
    const a = row('buy', 206, 3, 850000, 5);
    const b = row('sell', 206, 3, 870000, 4);
    assert.deepEqual(unsoldBought([b, a], { since: NOW - BOUGHT_WINDOW_MS }), []);
    assert.deepEqual(unsoldBought([], { since: 0 }), []);
    assert.deepEqual(unsoldBought(null, { since: 0 }), []);
});

test('the record Torn Bids leaves: read back only while inside the day', () => {
    const rec = boughtRecord([row('buy', 206, 3, 850000, 5), row('buy', 180, 2, 40, 23)], { now: NOW, readAt: NOW - 1000 });
    assert.equal(rec.at, NOW - 1000);
    assert.deepEqual(liveBoughtItems(rec, NOW).map((i) => i.itemId), ['206', '180']);
    // Two hours on, the Beer bought 23 hours ago is past the day.
    assert.deepEqual(liveBoughtItems(rec, NOW + 2 * H).map((i) => i.itemId), ['206']);
    assert.deepEqual(liveBoughtItems(null, NOW), []);
    assert.equal(sameBoughtItems(rec, { at: 1, items: rec.items.map((i) => ({ ...i })) }), true);
    assert.equal(sameBoughtItems(rec, { at: 1, items: [rec.items[0]] }), false);
});

test('the sell list: To sell first, then the day\'s other buys, newest first', () => {
    const list = bazaarSellList({
        leftovers: [
            { itemId: '258', name: 'Jaguar Plushie', qty: 4, each: 13000, why: 'cancel', from: 'Bob', at: NOW - 30 * H },
            { itemId: '206', name: 'Xanax', qty: 2, each: 851000, why: 'extra', from: null, at: NOW - H },
        ],
        bought: [
            { itemId: '180', qty: 10, each: 40, at: NOW - 3 * H },
            { itemId: '206', qty: 5, each: 849000, at: NOW - H },
            { itemId: '269', qty: 7, each: 32000, at: NOW - 2 * H },
        ],
        nameOf: (id) => ({ 180: 'Bottle of Beer', 269: 'Monkey Plushie' }[id] || null),
    });
    assert.deepEqual(list.map((r) => [r.itemId, r.source, r.qty, r.paid]), [
        ['258', 'tosell', 4, 13000],
        // On both: one row, the larger count, the higher cost.
        ['206', 'tosell', 5, 851000],
        ['269', 'bought', 7, 32000],
        ['180', 'bought', 10, 40],
    ]);
    assert.equal(list[2].name, 'Monkey Plushie');
});

test('the sell list: what was bought for a trade still going is not in it', () => {
    const list = bazaarSellList({
        leftovers: [{ itemId: '258', name: 'Jaguar Plushie', qty: 4, each: 13000, why: 'left', from: 'Bob', at: NOW }],
        bought: [{ itemId: '206', qty: 5, each: 850000, at: NOW - H }, { itemId: '180', qty: 4, each: 40, at: NOW - H }, { itemId: '258', qty: 9, each: 12000, at: NOW - H }],
        // 3 Xanax, all the Beer and 6 of the plushies are for a trade that is still going.
        reserved: new Map([['206', 3], ['180', 4], ['258', 6]]),
    });
    // The To sell row keeps its own count when the log's free units are fewer.
    assert.deepEqual(list.map((r) => [r.itemId, r.qty, r.paid]), [['258', 4, 13000], ['206', 2, 850000]]);
});

test('under what you paid: only a known cost, only a lower price', () => {
    assert.equal(underPaid(849999, 850000), true);
    assert.equal(underPaid(850000, 850000), false);
    assert.equal(underPaid(900000, 850000), false);
    assert.equal(underPaid(10, 0), false);
    assert.equal(underPaid(0, 850000), false);
});

test('the Sold tab: sales only, each a profit, a loss or cost not known; totals per place', () => {
    const rows = [
        row('buy', 206, 3, 850000, 10),
        row('buy', 180, 10, 40, 9),
        row('sell', 206, 1, 870000, 8, 'bazaar'),
        row('sell', 206, 1, 880000, 7, 'market', { fee: 44000 }),
        row('sell', 180, 10, 55, 6, 'npc', { who: null }),
        row('sell', 258, 2, 14000, 5, 'trade'),
        row('give', 206, 1, 0, 4, 'trade'),
    ].sort((a, b) => a.t - b.t);
    const fifo = matchFifo(rows);
    const all = soldRows(rows, fifo);
    assert.equal(all.length, 4);
    assert.deepEqual(all.map((r) => soldOutcome(fifo.get(r.id))), ['profit', 'loss', 'profit', 'unknown']);
    assert.equal(soldRows(rows, fifo, 'loss').length, 1);
    assert.equal(soldRows(rows, fifo, 'unknown')[0].itemId, '258');
    const by = soldByVenue(all, fifo);
    assert.equal(by.bazaar.profit, 20000);
    assert.equal(by.market.profit, 880000 - 44000 - 850000);
    assert.equal(by.market.fees, 44000);
    assert.equal(by.market.losses, 1);
    assert.equal(by.npc.profit, 150);
    assert.equal(by.trade.unknown, 1);
    assert.equal(by.trade.profit, 0);
    assert.equal(by.all.sales, 4);
    assert.equal(by.all.profit, 20000 - 14000 + 150);
    assert.equal(by.all.losses, 1);
});

test('the Sold tab: where a sale\'s units were bought, in a few words', () => {
    assert.equal(boughtFromText(null), 'no buy on record');
    assert.equal(boughtFromText({ from: [] }), 'no buy on record');
    assert.equal(boughtFromText({ from: [{ who: '5', whoName: null, venue: 'bazaar', qty: 2, each: 1 }] }), 'Player 5 (Bazaar)');
    assert.equal(boughtFromText({ from: [{ who: '5', whoName: 'Bob', venue: 'trade', qty: 2, each: 1 }] }), 'Bob (Trade)');
    assert.equal(boughtFromText({ from: [{ who: null, whoName: null, venue: 'market', qty: 2, each: 1 }] }), 'Item Market');
    assert.equal(boughtFromText({ from: [{ who: '5', venue: 'bazaar', qty: 1, each: 1 }, { who: '6', venue: 'bazaar', qty: 1, each: 1 }, { who: '5', venue: 'bazaar', qty: 1, each: 2 }] }), '2 bazaars');
    assert.equal(boughtFromText({ from: [{ who: '5', venue: 'bazaar', qty: 1, each: 1 }, { who: null, venue: 'market', qty: 1, each: 1 }] }), '2 buys (Bazaar, Item Market)');
});

test('To sell notes: one for what joins the list, none for what leaves or stays', () => {
    const a = [{ itemId: '206', name: 'Xanax', qty: 2, each: 850000, why: 'extra', from: null, at: NOW }];
    const first = noteToSell([], [], a, NOW);
    assert.deepEqual(first, [{ itemId: '206', qty: 2, why: 'extra', who: null, at: NOW, since: NOW }]);
    // The same list again, and a smaller one: nothing new (the same array back).
    assert.equal(noteToSell(first, a, a, NOW + 1), first);
    assert.equal(noteToSell(first, a, [{ ...a[0], qty: 1 }], NOW + 1), first);
    // Three more join, from a cancelled trade.
    const more = noteToSell(first, a, [{ ...a[0], qty: 5, why: 'cancel', from: 'Bob', since: NOW - H }], NOW + 5);
    assert.equal(more.length, 2);
    assert.deepEqual(more[1], { itemId: '206', qty: 3, why: 'cancel', who: 'Bob', at: NOW + 5, since: NOW - H });
    // A month on, they are gone.
    assert.deepEqual(liveWasToSell(more, NOW + WAS_TO_SELL_KEEP_MS + 10), []);
});

test('To sell tags: the sales made after an item joined the list, up to how many joined', () => {
    const notes = [{ itemId: '206', qty: 3, why: 'cancel', who: 'Bob', at: NOW - 10 * H, since: NOW - 10 * H }];
    const rows = [
        row('sell', 206, 1, 870000, 12, 'bazaar'),  // before it joined
        row('sell', 206, 2, 870000, 8, 'bazaar'),
        row('sell', 206, 2, 870000, 6, 'market'),   // the third unit
        row('sell', 206, 1, 870000, 4, 'bazaar'),   // none left of the note
        row('sell', 180, 1, 55, 4, 'bazaar'),
        row('buy', 206, 1, 850000, 3, 'bazaar'),
    ];
    const tags = toSellTags(notes, rows);
    assert.deepEqual([...tags.keys()], [rows[1].id, rows[2].id]);
    assert.deepEqual(tags.get(rows[1].id), { why: 'cancel', who: 'Bob' });
    assert.equal(toSellTags([], rows).size, 0);
    assert.equal(toSellTags(null, null).size, 0);
});

test('the hourly tidy-up: old To sell notes and buys past the day go; a reader gets the same either way', () => {
    const notes = [
        { itemId: '206', qty: 2, why: 'extra', who: null, at: NOW - WAS_TO_SELL_KEEP_MS - 5, since: NOW },
        { itemId: '180', qty: 1, why: 'left', who: 'Bob', at: NOW - H, since: NOW - H },
    ];
    const tidy = tidyWasToSell(notes, NOW);
    assert.deepEqual(liveWasToSell(tidy, NOW), liveWasToSell(notes, NOW));
    assert.equal(tidy.length, 1);
    assert.equal(tidyWasToSell(tidy, NOW), tidy);
    const held = { at: NOW - H, items: [{ itemId: '206', qty: 2, each: 850000, at: NOW - 2 * H }, { itemId: '180', qty: 5, each: 40, at: NOW - 25 * H }] };
    const kept = tidyHeld(held, NOW);
    assert.deepEqual(liveBoughtItems(kept, NOW), liveBoughtItems(held, NOW));
    assert.equal(kept.items.length, 1);
    assert.equal(kept.at, held.at);
    assert.equal(tidyHeld(kept, NOW), kept);
    for (const junk of [null, undefined, 5, 'x', { a: 1 }]) {
        assert.equal(tidyWasToSell(junk, NOW), junk);
        assert.equal(tidyHeld(junk, NOW), junk);
    }
});

test('what you are holding for a trade reads the same whenever it is asked (the Checkout window is not rebuilt each tick)', async () => {
    const trade = { key: 'id:11', trader: { id: '11', name: 'Bob' }, itemId: '206', at: NOW - H, items: [{ line: 'flip:206', itemId: '206', name: 'Xanax', units: 2, bid: 850000, kind: 'flip', sent: false, steps: [{ sellerId: '888', sellerName: 'XanSeller', qty: 2, price: 840000, bought: true, boughtQty: 2, boughtAt: NOW - H / 2 }] }] };
    const buyers = () => [{ id: '12', name: 'Alice', price: 845000 }];
    const a = JSON.stringify(sellElsewhere(trade, buyers));
    await new Promise((r) => setTimeout(r, 5));
    const b = JSON.stringify(sellElsewhere(trade, buyers));
    assert.equal(a, b);
    assert.equal(JSON.parse(a)[0].qty, 2);
    assert.equal(JSON.parse(a)[0].best.name, 'Alice');
    assert.equal('at' in JSON.parse(a)[0], false);
});
