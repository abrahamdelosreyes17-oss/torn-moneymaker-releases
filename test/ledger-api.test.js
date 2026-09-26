import test from 'node:test';
import assert from 'node:assert/strict';

import { LedgerClient, ledgerPathAllowed, fetchLedgerKeyInfo, isFullKey, fetchLogPage, fetchTrade } from '../src/api/ledger.js';
import { parseNetworth } from '../src/api/torn.js';

const FULL = 'FULLKEY123456789';

function recordingFetch(handler) {
    const calls = [];
    const impl = async (url) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => handler(url) };
    };
    impl.calls = calls;
    return impl;
}

const client = (fetchImpl) => new LedgerClient({ getKey: () => FULL, fetchImpl, maxRetries: 0 });

test('the Ledger key goes only to its four paths on api.torn.com', () => {
    for (const ok of ['v2/key/info', 'v2/user/log', '/v2/user/trades', 'v2/user/123456/trade']) assert.equal(ledgerPathAllowed(ok), true, ok);
    for (const bad of ['user', 'v2/user', 'v2/user/123/profile', 'v2/user/inventory', 'v2/torn/items', 'key', 'v2/user/log/../inventory', 'https://evil.example/v2/user/log', '//evil.example/v2/user/log', 'v2/user/12/trade/x']) {
        assert.equal(ledgerPathAllowed(bad), false, bad);
    }
});

test('any other path is refused before a request is made - the key never leaves', async () => {
    const f = recordingFetch(() => ({}));
    const c = client(f);
    await assert.rejects(() => c.get('v2/user/inventory'), /only for your log and trades/);
    await assert.rejects(() => c.get('user', { selections: 'profile' }), /only for your log and trades/);
    await assert.rejects(() => c.get('https://evil.example/v2/user/log'), /only for your log and trades/);
    assert.equal(f.calls.length, 0);
});

test('no query rides along: a path with ? is refused, and each path takes only its own parameters', async () => {
    assert.equal(ledgerPathAllowed('v2/user/log?selections=money'), false);
    const f = recordingFetch(() => ({ log: [] }));
    const c = client(f);
    await assert.rejects(() => c.get('v2/user/log', { selections: 'money,personalstats' }), /only for your log and trades/);
    await assert.rejects(() => c.get('v2/key/info', { selections: 'info' }), /only for your log and trades/);
    await assert.rejects(() => c.get('v2/user/5/trade', { cat: 'x' }), /only for your log and trades/);
    assert.equal(f.calls.length, 0);
});

test('the log is asked for its trade and mugging types, 100 at a time, with the key only in the query', async () => {
    const f = recordingFetch(() => ({ log: [{ id: 'a', timestamp: 1, details: { id: 1225 }, data: {} }] }));
    const rows = await fetchLogPage(client(f), { from: 100, to: 200 });
    assert.equal(rows.length, 1);
    const url = new URL(f.calls[0]);
    assert.equal(url.hostname, 'api.torn.com');
    assert.equal(url.pathname, '/v2/user/log');
    assert.equal(url.searchParams.get('log'), '1225,1226,1112,1113,4210,4200,4201,8156');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.get('from'), '100');
    assert.equal(url.searchParams.get('to'), '200');
    assert.equal(url.searchParams.get('key'), FULL);
});

test('key/info says whose key it is and whether it is Full', async () => {
    const f = recordingFetch(() => ({ info: { user: { id: 999 }, access: { level: 4, type: 'Full Access' } } }));
    const info = await fetchLedgerKeyInfo(client(f));
    assert.deepEqual(info, { level: 4, type: 'Full Access', userId: '999' });
    assert.equal(isFullKey(info), true);
    assert.equal(isFullKey({ level: 3, type: 'Limited Access' }), false);
    assert.equal(isFullKey({ level: null, type: 'Full Access' }), true);
    assert.equal(isFullKey(null), false);
});

test('a trade is read by its id only', async () => {
    const f = recordingFetch(() => ({ trade: { id: 7, items: [] } }));
    assert.deepEqual(await fetchTrade(client(f), '7'), { id: 7, items: [] });
    assert.equal(new URL(f.calls[0]).pathname, '/v2/user/7/trade');
});

test('networth: the v2 category shape and the stat array shape are both read', () => {
    assert.equal(parseNetworth({ personalstats: { networth: { total: 123 } } }), 123);
    assert.equal(parseNetworth({ personalstats: [{ name: 'networth', value: 456, timestamp: 1 }] }), 456);
    assert.equal(parseNetworth({ personalstats: { networth: 789 } }), 789);
    assert.equal(parseNetworth({}), null);
    assert.equal(parseNetworth({ personalstats: { networth: { total: 'x' } } }), null);
});
