/*
 * 3.26.2, two things the owner asked for on 2026-10-11.
 *
 * 1. "i have all keys set and working, but server does not pick it up": the server's page "What the PCs ask"
 *    stayed empty because no copy of Torn Bids sent its request counts. Now every tab adds its counts to one
 *    stored sum, and the tab that talks to the server sends it (`calls` in /sync) and takes off what was sent.
 * 2. "friend opens tornbids, we already have data from server right? it takes forever to find deals": the
 *    server's listings of an item stand in as its sellers until this PC's own sellers list is read
 *    (sharedItemsSeen says which items; main.js serverBazaars makes the records).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { usageAdd, usageLabel, usageCallsAdd, usageCallsOut, usageCallsSent, USAGE_CALLS_TAGS_MAX, USAGE_CALLS_COUNT_MAX, USAGE_CALLS_KEEP_MS, USAGE_CALLS_TAG } from '../src/core/usage.js';
import { sharedBody, sharedOutgoingOk, sharedItemsSeen, sharedIndex, withShared, SHARED_BUCKETS } from '../src/core/shared.js';
import { packBazaarReads } from '../src/core/start-up.js';
import { TeClient, TE_MIN_GAP_MS } from '../src/api/te.js';
import { serverFile } from './server-path.js';

const { callsClean } = await import(serverFile('src/calls.js'));

const NOW = Date.UTC(2026, 9, 11, 15, 30, 20);
const MIN = 60000;

function pending(tags, at = NOW) {
    const out = {};
    for (const [tag, n] of Object.entries(tags)) for (let i = 0; i < n; i += 1) usageAdd(out, tag, at);
    return out;
}

test('the counts for the server: every tab adds to one sum; only a service\'s tags and how they were answered', () => {
    // Two tabs, two minutes: one sum by tag. The shared server's own tags (r.s.*) and anything else are not in it.
    let sum = usageCallsAdd(null, pending({ 'w.flips': 4, 'w.lists': 9, 'r.w.ok': 12, 'r.w.429': 1, 'r.s.ok': 3 }), NOW);
    sum = usageCallsAdd(sum, { ...pending({ 'e.top': 1, 'r.e.slow': 1, 't.status': 5 }, NOW + MIN), ...pending({ 'w.flips': 2 }, NOW + 2 * MIN) }, NOW + 5000);
    assert.deepEqual(sum.n, { 'w.flips': 6, 'w.lists': 9, 'r.w.ok': 12, 'r.w.429': 1, 'e.top': 1, 'r.e.slow': 1, 't.status': 5 });
    assert.equal(sum.since, NOW);
    // The new outcome tags are tags of their own (an unknown one would be counted as "Other").
    for (const tag of ['r.e.ok', 'r.e.slow', 'r.e.fail']) assert.equal(usageLabel(tag), tag);
    // Every tag the sum can hold is one the server takes, and nothing the server would refuse is sent.
    const out = usageCallsOut(sum, NOW + 6000);
    assert.deepEqual(out, sum.n);
    assert.deepEqual(callsClean(out), out, 'the server\'s own check drops none of it');
    for (const junk of ['r.s.ok', 'x.y', 'w.', 'w.Flips', 'w.a_b', 'r.w', 'w.' + 'a'.repeat(13), '__proto__']) assert.equal(USAGE_CALLS_TAG.test(junk), false, junk);
    // A stored sum that is not ours to believe: only whole counts of real tags are taken from it.
    assert.deepEqual(usageCallsAdd({ since: NOW, n: { 'w.flips': 2.9, 'w.bad': -1, 'r.s.ok': 5, nonsense: 4, 'e.top': 'x' } }, {}, NOW).n, { 'w.flips': 2 });
    for (const bad of [null, [], 'x', 7, { n: [] }, { since: 'x', n: { 'w.flips': 1 } }]) assert.deepEqual(usageCallsAdd(bad, {}, NOW), { since: null, n: {} }, JSON.stringify(bad));
});

test('what was sent comes off once the server answered; what did not fit, or was counted meanwhile, stays', () => {
    const sum = usageCallsAdd(null, pending({ 'w.flips': 6, 'e.top': 1 }), NOW);
    const sent = usageCallsOut(sum, NOW + 1000);
    // Another tab counted two more while the answer was awaited.
    const meanwhile = usageCallsAdd(sum, pending({ 'w.flips': 2, 't.fill': 1 }, NOW + 2000), NOW + 2000);
    const left = usageCallsSent(meanwhile, sent, NOW + 3000);
    assert.deepEqual(left, { since: NOW + 3000, n: { 'w.flips': 2, 't.fill': 1 } });
    assert.deepEqual(usageCallsSent(sum, sent, NOW + 3000), { since: null, n: {} });
    // Nothing was asked since: an empty object goes, which the server counts as "this PC is on".
    assert.deepEqual(usageCallsOut({ since: null, n: {} }, NOW), {});
    assert.deepEqual(usageCallsOut(null, NOW), {});

    // Not answered: nothing comes off, and the next one carries the sum.
    const more = usageCallsAdd(sum, pending({ 'w.flips': 1 }, NOW + 30000), NOW + 30000);
    assert.equal(usageCallsOut(more, NOW + 31000)['w.flips'], 7);

    // No count over 5,000 and no more than 60 tags in one exchange: the rest waits for the next.
    const big = { since: NOW, n: { 'w.lists': USAGE_CALLS_COUNT_MAX + 40 } };
    for (let i = 0; i < USAGE_CALLS_TAGS_MAX + 5; i += 1) big.n['t.x' + i] = 1;
    const first = usageCallsOut(big, NOW);
    assert.equal(Object.keys(first).length, USAGE_CALLS_TAGS_MAX);
    assert.equal(first['w.lists'], USAGE_CALLS_COUNT_MAX);
    const rest = usageCallsSent(big, first, NOW + 1000);
    assert.equal(rest.n['w.lists'], 40);
    assert.equal(Object.keys(rest.n).length, 1 + 6);
    assert.equal(Object.keys(usageCallsSent(rest, usageCallsOut(rest, NOW + 2000), NOW + 3000).n).length, 0);

    // A sum that could not be sent for an hour is let go: it would land on the wrong hour of the server's record.
    assert.deepEqual(usageCallsOut(sum, NOW + USAGE_CALLS_KEEP_MS), sum.n);
    assert.deepEqual(usageCallsOut(sum, NOW + USAGE_CALLS_KEEP_MS + 1), {});
    assert.deepEqual(usageCallsAdd(sum, pending({ 'e.top': 1 }, NOW + 2 * USAGE_CALLS_KEEP_MS), NOW + 2 * USAGE_CALLS_KEEP_MS), { since: NOW + 2 * USAGE_CALLS_KEEP_MS, n: { 'e.top': 1 } });
});

test('`calls` in the message to the server: counts only, and nothing else gets out under that name', () => {
    const body = sharedBody({ calls: { 'w.flips': 6, 'r.w.429': 1, 'r.s.ok': 3, 'w.lists': 99999, 'e.top': 0, nonsense: 4 } });
    assert.deepEqual(body.calls, { 'w.flips': 6, 'r.w.429': 1, 'w.lists': USAGE_CALLS_COUNT_MAX });
    assert.equal(sharedOutgoingOk(body), true);
    assert.deepEqual(sharedBody({ calls: {} }).calls, {});
    assert.equal(sharedOutgoingOk(sharedBody({ calls: {} })), true);
    // Not given (a later page of the same exchange): the key is not there at all.
    assert.equal('calls' in sharedBody({}), false);
    assert.equal('calls' in sharedBody({ calls: null }), false);
    for (const bad of [{ 'w.flips': 'Bob' }, { 'w.flips': 1.5 }, { 'w.flips': 0 }, { 'w.flips': USAGE_CALLS_COUNT_MAX + 1 }, { 'item 206': 1 }, { 'r.s.ok': 1 }, [1], 'x', 5]) {
        assert.equal(sharedOutgoingOk({ ...body, calls: bad }), false, JSON.stringify(bad));
    }
    const many = {};
    for (let i = 0; i < USAGE_CALLS_TAGS_MAX + 1; i += 1) many['t.x' + i] = 1;
    assert.equal(sharedOutgoingOk({ ...body, calls: many }), false);
    assert.equal(Object.keys(sharedBody({ calls: many }).calls).length, USAGE_CALLS_TAGS_MAX);
});

test('how TornExchange answered each request that left: ok, slow (no answer in time) or fail', async () => {
    let t = NOW;
    const said = [];
    let next = null;
    const te = new TeClient({
        getKey: () => 'abcdef1234567890',
        now: () => t,
        fetchImpl: async () => next(),
        onAnswered: (x) => said.push([x.path, x.tag, x.how]),
    });
    const ask = async (reply, tag = 'e.top') => {
        t += TE_MIN_GAP_MS + 1;
        next = reply;
        return te.get('all_best_listings', {}, { tag }).then(() => 'ok', (e) => e);
    };
    const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    await ask(async () => res(200, { status: 'success', data: {} }));
    await ask(async () => { throw new Error('Request timed out'); }, 'e.active');
    await ask(async () => { throw new Error('Network request failed.'); });
    await ask(async () => res(500, null));
    await ask(async () => res(200, { status: 'error', message: 'No listings' }));
    await ask(async () => res(429, { retry_after: 5 }));
    assert.deepEqual(said.map((x) => x[2]), ['ok', 'slow', 'fail', 'fail', 'fail', 'fail']);
    assert.deepEqual(said[1], ['all_best_listings', 'e.active', 'slow']);
    // A request that never left (TornExchange asked us to wait; asked again too soon) has no answer to count.
    const before = said.length;
    await te.get('all_best_listings').catch(() => {});
    await te.get('all_best_listings').catch(() => {});
    assert.equal(said.length, before);
});

test('the items the server holds live listings of, and when the newest was seen', () => {
    const buckets = Array.from({ length: SHARED_BUCKETS }, () => ({}));
    // sellerId -> [changedAt, seenAt, gen, [[item, price, qty], ...]]
    buckets[0]['64'] = [NOW - 50 * MIN, NOW - 40000, 1, [[206, 790000, 2], [367, 1100, 40]]];
    buckets[1]['65'] = [NOW - 9 * MIN, NOW - 5 * MIN, 1, [[206, 795000, 1], [180, 1, 3]]];
    buckets[2]['66'] = [NOW - 90 * MIN, NOW - 45 * MIN, 1, [[258, 50000, 4]]];
    const index = sharedIndex(buckets);
    const seen = sharedItemsSeen(index, NOW, 30 * MIN);
    // 206: the newer of its two sellers. 180: only a locked $1 listing. 258: not read for 45 minutes.
    assert.deepEqual([...seen].sort(), [['206', NOW - 40000], ['367', NOW - 40000]]);
    assert.equal(sharedItemsSeen(null, NOW, 30 * MIN).size, 0);
    assert.equal(sharedItemsSeen(index, NOW - 60000, 30 * MIN).has('367'), false, 'a read "from the future" is not believed');
    // With no sellers list of this PC's, the server's listings are the item's sellers: by seller id, no name.
    const rows = withShared([], '206', index, new Map([['206', 1]]));
    assert.deepEqual(rows.map((r) => [r.sellerId, r.price, r.qty, r.dataAt, r.sellerName, r.shared]), [['64', 790000, 2, NOW - 40000, null, true], ['65', 795000, 1, NOW - 5 * MIN, null, true]]);
});

test('a record that stands on the server\'s listings is not kept for the next visit as a read of this PC', () => {
    const reads = new Map([
        ['206', { at: NOW - MIN, rows: [{ sellerId: '64', sellerName: 'A', price: 790000, qty: 2, dataAt: NOW - MIN, changedAt: null, sponsored: false }], error: null }],
        ['367', { at: NOW - MIN, rows: [], error: null, kept: true, server: true }],
    ]);
    assert.deepEqual(Object.keys(packBazaarReads(reads, NOW).items), ['206']);
});
