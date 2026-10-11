/*
 * 3.27.1: a listing whose buy form is open is still in the bazaar.
 * The owner, 2026-10-11: "why does tornbids think i have a naval cutlass in
 * the to sell?" - a row "Naval Cutlass x 1 · Extra buy · $41,000,000" for an
 * item he never bought. Torn's Buy on a card swaps the card for a form with
 * no picture (read on his own bazaar page the same day); the cards and the
 * rows are found by their pictures, so the listing looked gone just after he
 * pressed on it - "bought out by you".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { openBuyForms, buyFormBought, BUY_FORM_SELECTOR } from '../src/sources/dom/buy-form.js';
import { readBazaarList } from '../src/sources/dom/bazaar-list.js';
import { coverAfter, coverVerdict, coverWhole, listingBoughtOut } from '../src/core/bazaar-cover.js';
import { ITEM_IMAGE_SELECTOR } from '../src/sources/dom/detect.js';

const KEY = 'https://www.torn.com/bazaar.php?userId=1#/';

/* The least of the page the readers use. A node is a picture ({img}) or a buy form ({form}). */
const picture = (id) => ({ kind: 'img', getAttribute: (n) => (n === 'src' ? '/images/items/' + id + '/large.png' : null), parentElement: null });
const formEl = (name, price, stock) => {
    const el = {
        kind: 'form',
        textContent: name + ' $' + price.toLocaleString('en-US') + ' (' + stock + ' in stock) x Buy',
        parentElement: { closest: () => null },
        querySelector: (sel) => (sel === '[class*="name"]' ? { textContent: name } : null),
        contains: (x) => x === el || (x && x.form === el),
    };
    return el;
};
const rowEl = (y, nodes) => ({
    getAttribute: (n) => (n === 'style' ? 'position: absolute; inset: 0px; height: 80px; transform: translateY(' + y + 'px);' : null),
    querySelectorAll: (sel) => (sel === BUY_FORM_SELECTOR ? nodes.filter((x) => x.kind === 'form') : sel === ITEM_IMAGE_SELECTOR + ', ' + BUY_FORM_SELECTOR ? nodes : nodes.filter((x) => x.kind === 'img')),
    contains: () => false,
});
const pageOf = (height, rows) => {
    const list = { getAttribute: (n) => (n === 'style' ? 'position: relative; width: 100%; height: ' + height + 'px;' : null), querySelectorAll: () => rows, contains: () => false, parentElement: { parentElement: null, querySelectorAll: () => [] } };
    return { querySelector: () => list };
};
// The names this bazaar's forms can show, as the items list knows them.
const idOf = (form) => ({ 'Naval Cutlass': '615', Xanax: '206' })[form.name] || null;

test('an open buy form says which listing it is: the name, the price, the stock', () => {
    const f = formEl('Naval Cutlass', 41000000, 1);
    assert.deepEqual(openBuyForms({ querySelectorAll: () => [f] }).map((x) => [x.name, x.price, x.qty]), [['Naval Cutlass', 41000000, 1]]);
    // Its parts carry the word too: only the form itself is one.
    const part = { ...formEl('Naval Cutlass', 41000000, 1), parentElement: { closest: () => f } };
    assert.equal(openBuyForms({ querySelectorAll: () => [f, part] }).length, 1);
    assert.deepEqual(openBuyForms(null), []);
    assert.deepEqual(openBuyForms({ querySelectorAll: () => [] }), []);
});

test('only the form\'s own Buy is "you bought": not Close, not the number box, not a card\'s Buy', () => {
    const form = { contains: () => true };
    const button = (label) => ({ getAttribute: (n) => (n === 'aria-label' ? label : null), textContent: '' });
    const press = (b, inForm = true) => ({ closest: (sel) => (sel === BUY_FORM_SELECTOR ? (inForm ? form : null) : b) });
    assert.equal(buyFormBought(press(button('Buy: Naval Cutlass'))), form);
    assert.equal(buyFormBought(press(button('Close'))), null);
    assert.equal(buyFormBought(press(null)), null, 'the number box');
    assert.equal(buyFormBought(press(button('Buy: Naval Cutlass'), false)), null, 'the card\'s Buy opens the form, it buys nothing');
    assert.equal(buyFormBought(null), null);
});

test('the row keeps a listing whose form is open, in its place', () => {
    // A bazaar of one row: Xanax, the Cutlass, a Hammer - then Buy pressed on the Cutlass.
    const closed = readBazaarList(pageOf(80, [rowEl(0, [picture(206), picture(615), picture(1)])]), idOf);
    const open = readBazaarList(pageOf(80, [rowEl(0, [picture(206), formEl('Naval Cutlass', 41000000, 1), picture(1)])]), idOf);
    assert.deepEqual(open.rows[0].ids, ['206', '615', '1']);
    assert.deepEqual(open.rows[0].ids, closed.rows[0].ids);
    assert.equal(open.rows[0].open, undefined);
    assert.equal(open.perRow, 3);
});

test('the whole case: Buy pressed on the Cutlass, nothing bought - it is not gone, and the bazaar is not "read without it"', () => {
    const row = (nodes) => readBazaarList(pageOf(80, [rowEl(0, nodes)]), idOf);
    const before = row([picture(206), picture(615), picture(1)]);
    const last = { row: 0, rowIds: [...before.rows[0].ids], rowTotal: before.rowsTotal, rowSearch: false };
    let cover = coverAfter(null, KEY, before);
    assert.equal(coverWhole(cover), true);
    const after = row([picture(206), formEl('Naval Cutlass', 41000000, 1), picture(1)]);
    cover = coverAfter(cover, KEY, after);
    assert.equal(coverVerdict(cover, '615'), 'unknown', 'still in a row that was read');
    assert.equal(listingBoughtOut('615', last, after, { hadList: true, absent: false }), false);
    // As it was read before 3.27.1 (the form not seen at all): "gone" - the fault.
    const blind = readBazaarList(pageOf(80, [rowEl(0, [picture(206), picture(1)])]));
    assert.equal(coverVerdict(coverAfter(coverAfter(null, KEY, before), KEY, blind), '615'), 'absent');
    // Really bought out: the form is gone too, the row is one shorter - gone, as before.
    assert.equal(listingBoughtOut('615', last, blind, { hadList: true, absent: true }), true);
});

test('a form that names no item we know: its row is marked, and nothing is judged gone from the page', () => {
    const rows = [rowEl(0, [picture(206), formEl('Something New', 500, 3), picture(1)]), rowEl(80, [picture(9)])];
    const got = readBazaarList(pageOf(160, rows), idOf);
    assert.deepEqual(got.rows[0].ids, ['206', '1']);
    assert.equal(got.rows[0].open, true);
    // Its row is not "read whole": the account of the bazaar does not take it.
    const cover = coverAfter(null, KEY, got);
    assert.deepEqual(Object.keys(cover.rows), ['1']);
    assert.equal(coverWhole(cover), false);
    // Any listing last seen in that row, or in another: not known gone.
    assert.equal(listingBoughtOut('777', { row: 0, rowIds: ['206', '777', '1'], rowTotal: 2, rowSearch: false }, got, { hadList: true, absent: false }), false);
    assert.equal(listingBoughtOut('8', { row: 1, rowIds: ['8', '9'], rowTotal: 2, rowSearch: false }, got, { hadList: true, absent: true }), false);
});

test('without a way to name forms the reader is as it was', () => {
    const got = readBazaarList(pageOf(80, [rowEl(0, [picture(206), picture(615), picture(1)])]));
    assert.deepEqual(got.rows[0].ids, ['206', '615', '1']);
    assert.equal('open' in got.rows[0], false);
});
