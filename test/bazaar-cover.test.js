/*
 * 3.16.3, after the friend's third report (3.16.2, 2026-10-02) and two real
 * bazaars read with the owner the same day: Torn keeps only the rows near
 * the screen in the page (18 of 84 rows at the top of a 250-listing bazaar),
 * and 13 of the friend's 16 "listing not seen" notes were bazaars read whole
 * that did not hold the item - two of them planned again minutes later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { coverAfter, coverWhole, coverHasItem, coverRowsRead, coverListings, coverListingsRead, coverVerdict, listingBoughtOut } from '../src/core/bazaar-cover.js';
import { liveGone, markGone, withoutGone, goneKey, bazaarSellers, flipPlan, OWN_KEEP_MS, GONE_MAX } from '../src/core/flips.js';
import { buyingWhereText, stepState } from '../src/core/accepted.js';
import { readBazaarList, bazaarRowOf, bazaarSearchInUse } from '../src/sources/dom/bazaar-list.js';

const KEY = 'https://www.torn.com/bazaar.php?userId=1&ttItem=277#/';

// One read of the page: rows by index, each its item ids.
const read = (rowsTotal, rows, searching = false) => ({ rowsTotal, perRow: Math.max(0, ...Object.values(rows).map((r) => r.length)), rows: Object.entries(rows).map(([index, ids]) => ({ index: Number(index), ids: ids.map(String) })), searching });

test('a small bazaar is read whole at once: an item in none of its rows is not in the bazaar', () => {
    // The friend's Cherry Blossom stop: 7 cards, none of them item 277.
    const c = coverAfter(null, KEY, read(3, { 0: [197, 1363, 541], 1: [552, 551, 542], 2: [531] }));
    assert.equal(coverWhole(c), true);
    assert.equal(coverRowsRead(c), 3);
    assert.deepEqual(coverListings(c), { n: 7, exact: true });
    assert.equal(coverListingsRead(c), 7);
    assert.equal(coverVerdict(c, '277'), 'absent');
    assert.equal(coverVerdict(c, '197'), 'unknown', 'there, but not readable as a listing (locked, no price): nothing is concluded');
});

test('a long bazaar: only the rows near the screen are in the page - not there yet is not "not there"', () => {
    // The 250-listing bazaar: 84 rows, 18 in the page at the top.
    const top = {};
    for (let i = 0; i < 18; i += 1) top[i] = [1000 + i * 3, 1001 + i * 3, 1002 + i * 3];
    let c = coverAfter(null, KEY, read(84, top));
    assert.equal(coverWhole(c), false);
    assert.equal(coverVerdict(c, '277'), 'below');
    assert.deepEqual(coverListings(c), { n: 252, exact: false }, 'as if the last row were full, until it is read');
    assert.equal(coverListingsRead(c), 54);

    // Scrolled to the bottom: the top rows are out of the page, but they were read.
    const rest = {};
    for (let i = 18; i < 83; i += 1) rest[i] = [1000 + i * 3, 1001 + i * 3, 1002 + i * 3];
    rest[83] = [9999];
    c = coverAfter(c, KEY, read(84, rest));
    assert.equal(coverWhole(c), true, 'every row has been in the page since it was opened');
    assert.deepEqual(coverListings(c), { n: 250, exact: true });
    assert.equal(coverVerdict(c, '277'), 'absent');
    assert.equal(coverHasItem(c, '1000'), true, 'a row scrolled away from still counts as read');
    assert.equal(coverVerdict(c, '9999'), 'unknown');
});

test('the account starts again when what was read is no longer what is there', () => {
    const a = read(3, { 0: [1, 2, 3], 1: [4, 5, 6] });
    let c = coverAfter(null, KEY, a);
    assert.equal(coverRowsRead(c), 2);

    // Sorted another way (or a listing sold and the rest moved up): a row read before holds other items.
    c = coverAfter(c, KEY, read(3, { 0: [9, 8, 7] }));
    assert.equal(coverRowsRead(c), 1, 'only this read counts');
    assert.equal(coverHasItem(c, '4'), false);

    // The list got shorter (a listing sold out of the last row).
    c = coverAfter(coverAfter(null, KEY, a), KEY, read(2, { 0: [1, 2, 3] }));
    assert.equal(c.total, 2);
    assert.equal(coverRowsRead(c), 1);

    // Another bazaar page.
    c = coverAfter(coverAfter(null, KEY, a), KEY + 'x', read(3, { 2: [7] }));
    assert.equal(coverRowsRead(c), 1);

    // No such list on the page: no account at all.
    assert.equal(coverAfter(coverAfter(null, KEY, a), KEY, null), null);
    assert.equal(coverVerdict(null, '1'), 'unknown');
});

test('the bazaar\'s search box in use: only what it shows was read - never "not in this bazaar"', () => {
    let c = coverAfter(null, KEY, read(1, { 0: [5] }, true));
    assert.equal(coverWhole(c), false);
    assert.equal(coverVerdict(c, '277'), 'searching');
    // The search cleared: the rows read under it do not count for the whole list.
    c = coverAfter(c, KEY, read(1, { 0: [5] }, false));
    assert.equal(coverVerdict(c, '277'), 'absent');
});

test('a row still being drawn is not read: fewer cards than the fullest row, unless it is the last', () => {
    // Row 1 has one card of three so far; row 2 is the last and holds one.
    let c = coverAfter(null, KEY, read(3, { 0: [1, 2, 3], 1: [4], 2: [7] }));
    assert.equal(coverRowsRead(c), 2);
    assert.equal(coverVerdict(c, '277'), 'below', 'row 1 was not read: nothing is concluded');
    c = coverAfter(c, KEY, read(3, { 0: [1, 2, 3], 1: [4, 5, 6], 2: [7] }));
    assert.equal(coverVerdict(c, '277'), 'absent');
    // A row with no card at all, and a row beyond the list, are never read.
    c = coverAfter(null, KEY, read(2, { 0: [], 5: [1, 2, 3] }));
    assert.equal(coverRowsRead(c), 0);
});

test('the buying box says where the listing stands, with how much of the bazaar was read', () => {
    assert.equal(buyingWhereText({ where: 'absent', listings: { n: 7, exact: true }, listingsRead: 7 }), 'Not in this bazaar: 7 listings read, none of them this item.');
    assert.equal(buyingWhereText({ where: 'absent', listings: { n: 1, exact: true }, listingsRead: 1 }), 'Not in this bazaar: 1 listing read, none of them this item.');
    assert.equal(buyingWhereText({ where: 'below', listings: { n: 252, exact: false }, listingsRead: 54 }), 'Not in the page yet: this bazaar has about 252 listings, and 54 were read so far. Scroll down, or type its name in the bazaar\'s search box - it is marked when it shows.');
    assert.equal(buyingWhereText({ where: 'searching' }), 'Not among the listings the bazaar\'s search box shows.');
    assert.equal(buyingWhereText({ where: 'away', listings: { n: 252, exact: false }, listingsRead: 96 }), 'Out of the page now: scroll back to it, or type its name in the bazaar\'s search box - it is marked when it shows.');
    // Nothing to go by (no list of rows, or seen and since gone): as before.
    assert.equal(buyingWhereText({ where: null }), 'Not on this page any more.');
    assert.equal(buyingWhereText({ where: 'unknown' }), 'Not on this page any more.');
    assert.equal(buyingWhereText({}), 'Not on this page any more.');
});

/* ---------------------------------------- bought out, or only out of the page */

// The listing (item 206) was last seen in row 60 of 84, between two others.
const last = (over = {}) => ({ row: 60, rowIds: ['500', '206', '501'], rowTotal: 84, rowSearch: false, ...over });
const HAD = { hadList: true };

test('scrolling away from a listing is not buying it (it used to count all of it as bought)', () => {
    // At the top again: rows 0-19 in the page, row 60 is not.
    const top = {};
    for (let i = 0; i < 20; i += 1) top[i] = [i * 3, i * 3 + 1, i * 3 + 2].map((x) => 7000 + x);
    assert.equal(listingBoughtOut('206', last(), read(84, top), HAD), false);
    // The count kept from before a reload, the listing not seen since (no row known): not known either.
    assert.equal(listingBoughtOut('206', { row: null, rowIds: null, rowTotal: null, rowSearch: null }, read(84, top), HAD), false);
});

test('bought out: its row is in the page as it was, less the listing, the next ones moved up', () => {
    assert.equal(listingBoughtOut('206', last(), read(84, { 59: [1, 2, 3], 60: [500, 501, 502], 61: [503, 504, 505] }), HAD), true);
    // The last listing of the bazaar's last row: the row is shorter.
    assert.equal(listingBoughtOut('206', last({ row: 83, rowIds: ['500', '206'] }), read(84, { 82: [1, 2, 3], 83: [500] }), HAD), true);
    // 3.16.4: a listing sold further UP moves every one after it up a place - the first of a row
    // goes to the end of the row before, and its row then looks the same as if it had left. With
    // the row before not in the page (the top of what Torn keeps there), that is not known.
    const first = last({ row: 60, rowIds: ['206', '500', '501'] });
    assert.equal(listingBoughtOut('206', first, read(84, { 60: [500, 501, 502], 61: [503, 504, 505] }), HAD), false);
    assert.equal(listingBoughtOut('206', first, read(84, { 59: [1, 2, 3], 60: [500, 501, 502] }), HAD), true, 'the row before is there, without it');
    assert.equal(listingBoughtOut('206', first, read(84, { 59: [1, 2, 206], 60: [500, 501, 502] }), HAD), false, 'it moved up a row');
    // Alone in the last row, the row before not in the page: it may have moved up into it.
    assert.equal(listingBoughtOut('206', last({ row: 83, rowIds: ['206'] }), read(83, { 70: [1, 2, 3] }), HAD), false);
    // The first row has none before it.
    assert.equal(listingBoughtOut('206', last({ row: 0, rowIds: ['206', '500', '501'] }), read(84, { 0: [500, 501, 502] }), HAD), true);
    // Alone in the last row: the list is one row shorter and no longer reaches it.
    assert.equal(listingBoughtOut('206', last({ row: 83, rowIds: ['206'] }), read(83, { 82: [1, 2, 3] }), HAD), true);
    // ...but a list that still has that row, with other cards in it, is another list.
    assert.equal(listingBoughtOut('206', last({ row: 83, rowIds: ['206'] }), read(84, { 83: [9] }), HAD), false);
});

test('sorted another way, or its card still in the page: not bought out', () => {
    // Sorted: row 60 holds other listings altogether.
    assert.equal(listingBoughtOut('206', last(), read(84, { 60: [900, 901, 902] }), HAD), false);
    // Only the first of the row is as it was.
    assert.equal(listingBoughtOut('206', last(), read(84, { 60: [500, 777, 501] }), HAD), false);
    // Its card is in the page (moved up a row, or not readable as a listing just now).
    assert.equal(listingBoughtOut('206', last(), read(84, { 59: [1, 2, 206], 60: [500, 501, 502] }), HAD), false);
    // The list lost more than one row: not one listing bought.
    assert.equal(listingBoughtOut('206', last(), read(70, { 60: [500, 501, 502] }), HAD), false);
});

test('the search box: typing in it is not buying; buying out what a search shows is', () => {
    // Seen with the box empty, then something typed: the list is another list.
    assert.equal(listingBoughtOut('206', last(), read(2, { 0: [1, 2, 3], 1: [4] }, true), HAD), false);
    assert.equal(listingBoughtOut('206', last(), read(84, { 60: [500, 501, 502] }, true), HAD), false);
    // Found through the search ("plushie": five results), then bought out: counted.
    const found = { row: 0, rowIds: ['300', '206', '301'], rowTotal: 2, rowSearch: true };
    assert.equal(listingBoughtOut('206', found, read(2, { 0: [300, 301, 302], 1: [303] }, true), HAD), true);
    // The search changed after it was seen (other results): not known.
    assert.equal(listingBoughtOut('206', found, read(2, { 0: [800, 801, 802], 1: [803] }, true), HAD), false);
    // The search cleared after it was seen: not known from the rows (the whole list decides).
    assert.equal(listingBoughtOut('206', found, read(84, { 0: [1, 2, 3] }, false), HAD), false);
    // The only result of a search, bought out: the list itself goes.
    assert.equal(listingBoughtOut('206', { row: 0, rowIds: ['206'], rowTotal: 1, rowSearch: true }, null, HAD), true);
});

test('the list itself gone: bought out only when this listing was all it held', () => {
    assert.equal(listingBoughtOut('206', { row: 0, rowIds: ['206'], rowTotal: 1, rowSearch: false }, null, HAD), true);
    assert.equal(listingBoughtOut('206', last(), null, HAD), false, 'a list of 84 rows does not go by one buy: a redraw, or a search with no results');
    assert.equal(listingBoughtOut('206', { row: 0, rowIds: ['206', '9'], rowTotal: 1, rowSearch: false }, null, HAD), false);
    // A page that never had a list of rows (an older layout): not on the page is gone, as before.
    assert.equal(listingBoughtOut('206', { row: null, rowIds: null, rowTotal: null, rowSearch: null }, null, { hadList: false }), true);
    assert.equal(listingBoughtOut('206', { row: null, rowIds: null, rowTotal: null, rowSearch: null }, null, HAD), false);
});

test('every row read and the item in none: gone, whatever row it was in', () => {
    assert.equal(listingBoughtOut('206', { row: null, rowIds: null, rowTotal: null, rowSearch: null }, read(1, { 0: [1, 2] }), { hadList: true, absent: true }), true);
    assert.equal(listingBoughtOut('206', last(), read(84, { 0: [1, 2, 3] }), { hadList: true, absent: true }), true);
});

/* ------------------------------------------ listings you saw are not there */

const NOW = 1_790_000_000_000;
const MIN = 60 * 1000;
// TornW3B's listings of Cherry Blossom: seller 1 at $35,000 (checked 10 minutes ago), seller 2 at $36,000.
const rows = () => [
    { sellerId: '1', sellerName: 'Ann', price: 35000, qty: 20, dataAt: NOW - 10 * MIN },
    { sellerId: '2', sellerName: 'Bo', price: 36000, qty: 20, dataAt: NOW - 5 * MIN },
];

test('a bazaar seen without the listing is left out of the next plan - the friend was sent back within minutes', () => {
    const gone = markGone(null, '1', '277', NOW);
    assert.deepEqual(Object.keys(gone), [goneKey('1', '277')]);
    const left = withoutGone(rows(), '277', gone);
    assert.deepEqual(left.map((r) => r.sellerId), ['2'], 'seller 1 was checked by TornW3B before you looked: out');
    // The plan buys from the bazaar that is left, never from the one seen empty.
    const plan = flipPlan(bazaarSellers(left, { now: NOW }), 40000, { cash: 0, maxUnits: 10, minPct: 0 });
    assert.deepEqual(plan.steps.map((s) => s.sellerId), ['2']);
    // Another item at the same seller, and the same item at another seller, are untouched.
    assert.equal(withoutGone(rows(), '260', gone).length, 2);
    // An accepted trade's step at that seller reads as gone, so Torn Bids offers the next cheapest.
    assert.equal(stepState({ sellerId: '1', qty: 5, price: 35000, bought: false }, bazaarSellers(left, { now: NOW })).state, 'gone');
});

test('TornW3B checking the bazaar again after you looked wins: they listed it again', () => {
    const gone = markGone(null, '1', '277', NOW);
    const later = [{ sellerId: '1', price: 35000, qty: 20, dataAt: NOW + MIN + 1 }];
    assert.equal(withoutGone(later, '277', gone).length, 1);
    // Within a minute of your look (3.16.4): the check may still carry the number from before it.
    assert.equal(withoutGone([{ sellerId: '1', price: 35000, qty: 20, dataAt: NOW + MIN }], '277', gone).length, 0);
    // Checked at the very moment you looked, or with no time at all: still out.
    assert.equal(withoutGone([{ sellerId: '1', price: 35000, qty: 20, dataAt: NOW }], '277', gone).length, 0);
    assert.equal(withoutGone([{ sellerId: '1', price: 35000, qty: 20, dataAt: null }], '277', gone).length, 0);
});

test('a mark is let go once it has nothing left to hide, and the store stays small', () => {
    const gone = markGone(null, '1', '277', NOW);
    assert.equal(Object.keys(liveGone(gone, NOW + OWN_KEEP_MS - 1)).length, 1);
    assert.equal(Object.keys(liveGone(gone, NOW + OWN_KEEP_MS)).length, 0, 'kept three hours, or until TornW3B has seen the bazaar change');
    // Marked again later: the newer time is kept.
    assert.equal(markGone(gone, '1', '277', NOW + MIN)[goneKey('1', '277')].at, NOW + MIN);
    // Junk in storage is dropped, never thrown on.
    assert.deepEqual(liveGone({ a: null, b: { at: 'x' }, c: 5 }, NOW), {});
    assert.deepEqual(liveGone([1, 2], NOW), {});
    assert.deepEqual(liveGone(null, NOW), {});
    assert.deepEqual(markGone(null, '', '277', NOW), {}, 'no seller: nothing to mark');
    // The newest GONE_MAX only.
    let many = null;
    for (let i = 0; i < GONE_MAX + 20; i += 1) many = markGone(many, String(i), '1', NOW + i);
    assert.equal(Object.keys(many).length, GONE_MAX);
    assert.equal(many[goneKey('0', '1')], undefined);
    assert.ok(many[goneKey(String(GONE_MAX + 19), '1')]);
    // No marks at all: the rows come back as they are.
    const r = rows();
    assert.equal(withoutGone(r, '277', {}), r);
    assert.equal(withoutGone(null, '277', gone), null);
});

/* ------------------------------------------------ the list, from the page */

// The least of an element the reader uses (the real markup is in bazaar-list.js's header).
const img = (id) => ({ getAttribute: (n) => (n === 'src' ? '/images/items/' + id + '/large.png' : null) });
const rowEl = (y, ids, height = 80) => {
    const cards = ids.map((id) => ({ id }));
    return {
        cards,
        getAttribute: (n) => (n === 'style' ? 'position: absolute; inset: 0px; height: ' + height + 'px; transform: translateY(' + y + 'px);' : null),
        querySelectorAll: () => ids.map(img),
        contains: (el) => cards.includes(el),
    };
};
const input = (attrs, value = '') => ({ type: attrs.type || 'text', value, getAttribute: (n) => (n in attrs ? attrs[n] : null) });
const listEl = (height, rowEls, { search = null, siteSearch = null } = {}) => {
    const list = {
        getAttribute: (n) => (n === 'style' ? 'position: relative; width: 100%; height: ' + height + 'px;' : null),
        querySelectorAll: () => rowEls,
        contains: () => false,
    };
    // list -> wrap -> bazaar (its search box) -> page (the site's search box)
    const page = { parentElement: null, querySelectorAll: () => [search, siteSearch].filter(Boolean) };
    const bazaar = { parentElement: page, querySelectorAll: () => [search].filter(Boolean) };
    const wrap = { parentElement: bazaar, querySelectorAll: () => [] };
    list.parentElement = wrap;
    return list;
};
const root = (list) => ({ querySelector: () => list });

test('the page\'s list is read as Torn lays it out: the height says how many rows, each row\'s offset which one', () => {
    // As read on the real 250-listing bazaar: 6720px tall, rows of 80px, 18 of them in the page.
    const rowEls = [];
    for (let i = 0; i < 18; i += 1) rowEls.push(rowEl(i * 80, [100 + i, 200 + i, 300 + i]));
    const got = readBazaarList(root(listEl(6720, rowEls)));
    assert.equal(got.rowsTotal, 84);
    assert.equal(got.perRow, 3);
    assert.equal(got.rows.length, 18);
    assert.deepEqual([got.rows[0].index, got.rows[17].index], [0, 17]);
    assert.deepEqual(got.rows[17].ids, ['117', '217', '317']);
    assert.equal(got.searching, false);
    // Scrolled down: the rows in the page say which ones they are by their offset.
    const deep = readBazaarList(root(listEl(6720, [rowEl(5120, [1, 2, 3]), rowEl(6640, [4])])));
    assert.deepEqual(deep.rows.map((r) => r.index), [64, 83]);
    // Which row a card is in.
    assert.equal(bazaarRowOf(got, rowEls[5].cards[1]), 5);
    assert.equal(bazaarRowOf(got, {}), null);
    assert.equal(bazaarRowOf(null, rowEls[5].cards[1]), null);
});

test('anything not laid out that way reads as nothing, and the old behaviour carries on', () => {
    assert.equal(readBazaarList(null), null);
    assert.equal(readBazaarList(root(null)), null, 'no such list (an older layout, the test page\'s plain cards)');
    assert.equal(readBazaarList(root(listEl(480, []))), null, 'no rows drawn yet');
    // Rows not placed by an offset, a list with no height, a row with no height.
    const flat = { cards: [], getAttribute: () => 'height: 80px;', querySelectorAll: () => [img(1)], contains: () => false };
    assert.equal(readBazaarList(root(listEl(480, [flat]))), null);
    const noHeight = listEl(480, [rowEl(0, [1])]);
    noHeight.getAttribute = () => 'position: relative; width: 100%;';
    assert.equal(readBazaarList(root(noHeight)), null);
    assert.equal(readBazaarList(root(listEl(480, [rowEl(0, [1], 0)]))), null);
});

test('the bazaar\'s own search box: in use only when it holds something; the site\'s search is not it', () => {
    const rowsIn = [rowEl(0, [1, 2, 3])];
    const used = listEl(80, rowsIn, { search: input({ placeholder: 'search...' }, 'cherry'), siteSearch: input({ placeholder: 'search...' }, '') });
    assert.equal(readBazaarList(root(used)).searching, true);
    const empty = listEl(80, rowsIn, { search: input({ placeholder: 'search...' }, '  '), siteSearch: input({ placeholder: 'search...' }, 'someone') });
    assert.equal(readBazaarList(root(empty)).searching, false, 'the site\'s search holding text is not the bazaar\'s');
    // No search box anywhere near: not in use.
    assert.equal(bazaarSearchInUse(listEl(80, rowsIn)), false);
    // A hidden or tick box is never the search.
    assert.equal(bazaarSearchInUse(listEl(80, rowsIn, { search: input({ type: 'hidden', name: 'search' }, 'x') })), false);
});
