/*
 * 3.33.0 - never ask on a list that may be closed (the owner, 2026-10-14 and 2026-10-16: money was lost on a trade
 * whose list was closed; TornW3B's list read returns every price of a closed list). Ask, Yes and Open the trade go
 * only on a page read of their list in the last minute that says open (core/open-check.js pressReady); after their
 * yes, a line their list now pays less for is said. A check another PC made counts for three minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { bidSinceYes, priceChecked } from '../src/core/checked.js';
import { pressReady, sharedListMark, OPEN_PRESS_MS, OPEN_CHECK_MS } from '../src/core/open-check.js';
import { sharedOpenOut, sharedOpensIn, sharedBody, sharedOutgoingOk } from '../src/core/shared.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

test('Ask, Yes and Open the trade go only on a page read in the last minute that says open', () => {
    const open = { at: NOW - 10_000, state: 'open' };
    assert.deepEqual(pressReady(open, { now: NOW }), { ready: true, why: 'open', at: NOW - 10_000, until: NOW - 10_000 + OPEN_PRESS_MS });
    assert.equal(pressReady({ ...open, at: NOW - OPEN_PRESS_MS - 1 }, { now: NOW }).why, 'stale');
    assert.equal(pressReady(null, { now: NOW }).why, 'unread');
    // Closed, unclear or a failed read: never, however new.
    for (const state of ['closed', 'unclear', 'failed']) assert.equal(pressReady({ at: NOW - 1000, state }, { now: NOW }).ready, false, state);
    assert.deepEqual([pressReady(open, { reading: true, now: NOW }).ready, pressReady(open, { reading: true, now: NOW }).why], [false, 'reading']);
    // A trader with no TornW3B list (by name, or on TornExchange only): nothing to check - their TornExchange page is the Ask.
    assert.equal(pressReady(null, { needsOpen: false, now: NOW }).ready, true);
    // A read "from the future" (another clock) is not believed.
    assert.equal(pressReady({ at: NOW + 5 * MIN, state: 'open' }, { now: NOW }).ready, false);
});

test('after their yes: a line their list now pays less for, or not at all, is said - but only on a read since the yes', () => {
    const yesAt = NOW - 20 * MIN;
    assert.deepEqual(bidSinceYes(15186, { shown: 14900, readAt: NOW, yesAt }), { state: 'lower', price: 14900 });
    assert.deepEqual(bidSinceYes(15186, { shown: null, readAt: NOW, yesAt }), { state: 'gone', price: null });
    assert.equal(bidSinceYes(15186, { shown: 15186, readAt: NOW, yesAt }).state, 'same');
    assert.equal(bidSinceYes(15186, { shown: 15300, readAt: NOW, yesAt }).state, 'higher');
    // The read at the press of yes itself is not a read since it.
    assert.equal(bidSinceYes(15186, { shown: 1, readAt: yesAt - 1000, yesAt }).state, 'unread');
});

test('another PC\'s open check counts at two minutes old and not at four, on this PC\'s clock, whatever theirs says', () => {
    // That PC read the page 2 minutes ago: it sends the age, never its clock.
    const theirNow = NOW + 7 * MIN; // its clock runs 7 minutes ahead
    const mark = sharedListMark({ 206: 900, 180: 5 });
    const out = sharedOpenOut([501, 1, theirNow - 2 * MIN, theirNow - 3 * 60 * MIN, mark], theirNow);
    assert.deepEqual(out, [501, 1, 2 * MIN, 3 * 60 * MIN, mark]);
    const body = sharedBody({ now: theirNow, opens: [[501, 1, theirNow - 2 * MIN, 0, mark], [502, 0, theirNow - 4 * MIN, 0, 0], [503, 2, theirNow, 0, 0]] });
    assert.deepEqual(body.opens, [[501, 1, 2 * MIN, 0, mark]], 'only a check under three minutes old, open or closed, is sent');
    assert.equal(sharedOutgoingOk(body), true);
    assert.equal(sharedOutgoingOk({ ...body, opens: [[501, 1, 4 * MIN, 0, 0]] }), false);

    // The server hands it on as an age; this PC dates it by its own clock.
    const [row] = sharedOpensIn({ opens: [[501, 1, 2 * MIN, 3 * 60 * MIN, mark]] }, NOW);
    assert.deepEqual(row, [501, 1, NOW - 2 * MIN, NOW - 3 * 60 * MIN, mark]);
    assert.deepEqual(sharedOpensIn({ opens: [[502, 1, 4 * MIN, 0, 0], [503, 2, 1000, 0, 0], ['x', 1, 1, 0, 0], [504, 1, 1000, 0]] }, NOW), []);
    // The mark is of the prices alone, in any order: the same list matches, a list one price apart does not.
    assert.equal(sharedListMark({ 180: 5, 206: 900 }), mark);
    assert.notEqual(sharedListMark({ 206: 901, 180: 5 }), mark);
    assert.equal(sharedListMark({}), 0);

    // Taken as an open check (main.js takeSharedOpens), it makes a flip as one made here would - for three minutes.
    const buyer = { id: '501', name: 'Five', price: 900, w3b: 900, te: null };
    const check = (at) => ({ at, state: 'open', prices: { 206: 900 }, updatedAt: NOW - 3 * 60 * MIN, shared: true });
    assert.equal(priceChecked(buyer, { itemId: '206', open: check(NOW - 2 * MIN), now: NOW }).ok, true);
    assert.equal(priceChecked(buyer, { itemId: '206', open: check(NOW - 4 * MIN), now: NOW }).ok, false);
    assert.ok(4 * MIN > OPEN_CHECK_MS && 2 * MIN < OPEN_CHECK_MS);
});

/* ---------------------------------------------------------------- the buttons on the page */

/** Just enough of a document for the page's element helper. */
function fakeDocument() {
    const make = (tag) => {
        const node = { tagName: tag.toUpperCase(), attrs: {}, children: [], listeners: {}, className: '', textContent: '' };
        node.setAttribute = (k, v) => { node.attrs[k] = v; };
        node.appendChild = (c) => { node.children.push(c); return c; };
        node.addEventListener = (type, fn) => { (node.listeners[type] = node.listeners[type] || []).push(fn); };
        node.click = () => (node.listeners.click || []).forEach((fn) => fn({ button: 0, stopPropagation() {}, preventDefault() {} }));
        return node;
    };
    return { createElement: make, createTextNode: (text) => ({ text }) };
}

test('the page: Ask and Open the trade only on an open check; else "Check X\'s list" checks it; closed and "Checking…" cannot be pressed', async () => {
    globalThis.document = fakeDocument();
    try {
        const { SellingPage } = await import('../src/ui/selling-page.js');
        let ask = { ready: false, why: 'stale', at: 0, until: 0 };
        const checks = [];
        let redraws = 0;
        const page = Object.create(SellingPage.prototype);
        page.h = { askOf: () => ask, onTraderCheck: (itemId, key) => checks.push([itemId, key]) };
        page.redrawDesk = () => { redraws += 1; };
        const zega = { id: 123, name: 'Zega', w3b: 15186 };

        for (const make of [(at) => page.chatLink(zega, 'btn', at), (at) => page.tradeLink(zega, 'btn', at, 'step-trade')]) {
            checks.length = 0;
            ask = { ready: false, why: 'stale', at: 0, until: 0 };
            const stale = make({ itemId: '55', key: 'id:123' });
            assert.equal(stale.tagName, 'BUTTON');
            assert.equal(stale.textContent, 'Check Zega\'s list');
            stale.click();
            assert.deepEqual(checks, [['55', 'id:123']]);

            ask = { ready: false, why: 'unclear', at: Date.now() - 3000, until: 0 };
            assert.equal(make({ itemId: '55', key: 'id:123' }).textContent, 'Couldn\'t confirm Zega\'s list is open · check again');

            ask = { ready: false, why: 'closed', at: Date.now() - 3000, until: 0 };
            const closed = make({ itemId: '55', key: 'id:123' });
            assert.equal(closed.textContent, 'Zega\'s list is closed');
            assert.equal(closed.attrs.disabled, '');

            ask = { ready: false, why: 'reading', at: 0, until: 0 };
            assert.equal(make({ itemId: '55', key: 'id:123' }).attrs.disabled, '');

            ask = { ready: true, why: 'open', at: Date.now() - 2000, until: Date.now() + 58_000 };
            const fresh = make({ itemId: '55', key: 'id:123' });
            for (const t of (page.pressTimers || new Map()).values()) clearTimeout(t);
            assert.equal(fresh.tagName, 'A');
        }
        assert.ok(redraws >= 2);
    } finally {
        delete globalThis.document;
    }
});
