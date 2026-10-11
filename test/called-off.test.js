/*
 * 3.27.1: an accepted trade the trader called off on Torn closes itself.
 * The friend (3.26.2, 2026-10-12): "Trader declined the trade and the trades
 * in torn bids doesn't disappear I have to manually remove them myself" - his
 * log: accepted 00:37:49, on Torn's trade page until 00:59:50, still "under
 * way" at 02:35, Cancel trade pressed at 02:36.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { tradesCalledOff, TRADE_GONE_CHECKS } from '../src/core/accepted.js';
import { LedgerClient, fetchOngoingTrades } from '../src/api/ledger.js';

const AT = 1_790_000_000_000;
const trade = (o = {}) => ({ key: 'id:500', trader: { id: '500', name: 'Buyer' }, itemId: '384', at: AT, items: [], ...o });
const onTorn = (id, partnerId = '500') => ({ id, partnerId });

test('a trade never seen open on Torn is left alone, however long', () => {
    let going = null;
    for (let i = 0; i < 5; i += 1) {
        const r = tradesCalledOff(going, [trade()], []);
        assert.deepEqual(r.gone, []);
        going = r.going;
    }
    // Another trader's open trade is not this one's.
    assert.deepEqual(tradesCalledOff(null, [trade()], [onTorn(9, '777')]), { going: {}, gone: [] });
});

test('open on Torn, then gone and not finished: called off on the second read in a row', () => {
    assert.equal(TRADE_GONE_CHECKS, 2);
    let r = tradesCalledOff(null, [trade()], [onTorn(9)]);
    assert.deepEqual(r.going, { 'id:500': { yesAt: AT, ids: ['9'], misses: 0 } });
    r = tradesCalledOff(r.going, [trade()], []);
    assert.deepEqual(r.gone, []);
    assert.equal(r.going['id:500'].misses, 1);
    r = tradesCalledOff(r.going, [trade()], []);
    assert.deepEqual(r.gone, ['id:500']);
    assert.deepEqual(r.going, {});
});

test('back among the open trades between two reads: the count starts again', () => {
    let r = tradesCalledOff(null, [trade()], [onTorn(9)]);
    r = tradesCalledOff(r.going, [trade()], []);
    r = tradesCalledOff(r.going, [trade()], [onTorn(9)]);
    assert.equal(r.going['id:500'].misses, 0);
    r = tradesCalledOff(r.going, [trade()], []);
    assert.deepEqual(r.gone, []);
});

test('they opened another trade after declining: not called off while one with them is open', () => {
    let r = tradesCalledOff(null, [trade()], [onTorn(9)]);
    r = tradesCalledOff(r.going, [trade()], [onTorn(10)]);
    assert.deepEqual(r.going['id:500'].ids, ['9', '10']);
    r = tradesCalledOff(r.going, [trade()], [onTorn(10)]);
    assert.deepEqual(r.gone, []);
});

test('a trade that finished is never called off: listed, read, or read with something in it', () => {
    for (const state of ['listed', 'read']) {
        let r = tradesCalledOff(null, [trade()], [onTorn(9)]);
        for (let i = 0; i < 4; i += 1) {
            r = tradesCalledOff(r.going, [trade()], [], { finished: (id) => (id === '9' ? state : null) });
            assert.deepEqual(r.gone, [], state);
        }
    }
});

test('listed as finished with nothing in it (no item, no money): called off', () => {
    let r = tradesCalledOff(null, [trade()], [onTorn(9)]);
    const finished = () => 'empty';
    r = tradesCalledOff(r.going, [trade()], [], { finished });
    r = tradesCalledOff(r.going, [trade()], [], { finished });
    assert.deepEqual(r.gone, ['id:500']);
});

test('a new yes from the same trader does not inherit the old trade\'s open trades', () => {
    let r = tradesCalledOff(null, [trade()], [onTorn(9)]);
    r = tradesCalledOff(r.going, [trade()], []);
    // The same key, accepted again later: nothing was seen open for THIS yes.
    const again = trade({ at: AT + 3_600_000 });
    r = tradesCalledOff(r.going, [again], []);
    assert.deepEqual(r, { going: {}, gone: [] });
    r = tradesCalledOff(r.going, [again], []);
    assert.deepEqual(r.gone, []);
});

test('two accepted trades: only the one whose Torn trade went is called off', () => {
    const a = trade();
    const b = trade({ key: 'id:600', trader: { id: '600', name: 'Other' } });
    let r = tradesCalledOff(null, [a, b], [onTorn(9), onTorn(11, '600')]);
    r = tradesCalledOff(r.going, [a, b], [onTorn(11, '600')]);
    r = tradesCalledOff(r.going, [a, b], [onTorn(11, '600')]);
    assert.deepEqual(r.gone, ['id:500']);
    assert.deepEqual(Object.keys(r.going), ['id:600']);
});

test('the open trades are asked with cat=ongoing and nothing else, through the walled client', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ trades: [{ id: 9, user: { id: 1, name: 'me' }, trader: { id: 500, name: 'Buyer' } }] }) };
    };
    const c = new LedgerClient({ getKey: () => 'FULLKEY123456789', fetchImpl, maxRetries: 0 });
    const list = await fetchOngoingTrades(c);
    assert.equal(list.length, 1);
    assert.equal(calls.length, 1);
    const u = new URL(calls[0]);
    assert.equal(u.pathname, '/v2/user/trades');
    assert.equal(u.searchParams.get('cat'), 'ongoing');
    for (const p of ['limit', 'sort', 'from']) assert.equal(u.searchParams.has(p), false, p);
    // Not a list: null, so nothing is judged from it.
    const odd = new LedgerClient({ getKey: () => 'FULLKEY123456789', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }), maxRetries: 0 });
    assert.equal(await fetchOngoingTrades(odd), null);
});
