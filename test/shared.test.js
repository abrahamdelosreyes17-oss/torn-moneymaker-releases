// Shared, the PC's side: what may be sent, how the server's reads are kept, how they correct TornW3B's rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sharedAddress, sharedPassOk, sharedHome, sharedWord, sharedKnown, sharedMayCall, sharedBody, sharedOutgoingOk, sharedBucketOf, sharedTake, sharedPrune,
    sharedReadBucket, sharedIndex, withShared, sharedInterest, SHARED_BUCKETS, SHARED_KEEP_MS, SHARED_GRANT_STALE_MS, sharedNowLine, sharedKeyLine, sharedSplit, sharedPerson,
    sharedMarks, sharedMarksIn, sharedMarksNow, SHARED_BOUGHT_MS, SHARED_GOING_QUIET_MS,
    sharedGoingOwn, sharedGoingByItem, sharedOnThis, sharedGoingFor, sharedBoughtLine,
    sharedDir, sharedDirIn, sharedDirDue, SHARED_TURN_WAIT_MS, SHARED_DIR_KEEP_MS,
} from '../src/core/shared.js';
import { serverFile } from './server-path.js';

const { newPerson, pcReport, pcMayCall, serverCalled, serverMayCall } = await import(serverFile('src/budget.js'));

const newBuckets = () => Array.from({ length: SHARED_BUCKETS }, () => ({}));
const row = (sellerId, price, qty, dataAt, more = {}) => ({ sellerId: String(sellerId), sellerName: `S${sellerId}`, price, qty, dataAt, changedAt: dataAt, sponsored: false, ...more });

test('the address is https on workers.dev or it is nothing', () => {
    assert.equal(sharedAddress('torn-bids-shared.abe.workers.dev'), 'https://torn-bids-shared.abe.workers.dev');
    assert.equal(sharedAddress(' https://torn-bids-shared.abe.workers.dev/sync?x=1 '), 'https://torn-bids-shared.abe.workers.dev');
    for (const bad of ['', null, 'http://x.workers.dev', 'https://evil.com', 'https://workers.dev.evil.com', 'https://x.workers.dev.evil.com', 'https://user:pw@evil.com#.workers.dev', 'javascript:alert(1)', 'https://api.torn.com']) {
        assert.equal(sharedAddress(bad), null, String(bad));
    }
    assert.equal(sharedPassOk('a'.repeat(48)), true);
    assert.equal(sharedPassOk('a'.repeat(23)), false);
    assert.equal(sharedPassOk(`${'a'.repeat(30)} `), false);
    assert.equal(sharedPassOk(undefined), false);
});

test('the rule of the PC is the rule of the server: both sides agree on every case tried', () => {
    let seed = 7;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let round = 0; round < 400; round += 1) {
        const now = 10000000 + rand(100000);
        const grant = { at: now - rand(60000), need: 30 + rand(50), serverShare: rand(60), serverTimes: Array.from({ length: rand(70) }, () => now - rand(90000)).sort((a, b) => a - b) };
        const pcTimes = Array.from({ length: rand(85) }, () => now - rand(90000)).sort((a, b) => a - b);
        assert.equal(sharedMayCall(grant, pcTimes, now), pcMayCall(grant, pcTimes, now), `round ${round}`);
    }
    assert.equal(sharedMayCall(null, new Array(500).fill(1), 2), true);
});

test('with the server on a key, this PC and the server together never pass 80 in a minute', () => {
    const person = newPerson();
    const pcTimes = [];
    let grant = null;
    let worst = 0;
    for (let now = 1000000; now < 1000000 + 15 * 60000; now += 250) {
        const second = Math.floor((now - 1000000) / 1000);
        const busy = second % 240 < 120;
        if ((now - 1000000) % 30000 === 0) grant = pcReport(person, { used: pcTimes.filter((t) => now - t < 60000).length, waiting: busy ? 40 : 0 }, now);
        // The PC wants a lot for two minutes, then little for two.
        const wants = busy ? 2 : (now % 4000 === 0 ? 1 : 0);
        for (let i = 0; i < wants; i += 1) if (sharedMayCall(grant, pcTimes, now)) pcTimes.push(now);
        while (serverMayCall(person, now)) serverCalled(person, now);
        const total = pcTimes.filter((t) => now - t < 60000).length + person.serverTimes.filter((t) => now - t < 60000).length;
        worst = Math.max(worst, total);
    }
    assert.ok(worst <= 80, `${worst} calls in one minute`);
    assert.ok(worst >= 70, 'the limit was hardly used: the test proves little');
});

test('a grant too old to trust: the PC is on its own again', () => {
    const now = 5000000;
    const full = new Array(79).fill(now - 1000);
    const grant = { at: now - 1000, need: 30, serverShare: 50, serverTimes: [] };
    assert.equal(sharedMayCall(grant, full, now), false);
    assert.equal(sharedMayCall({ ...grant, at: now - SHARED_GRANT_STALE_MS - 1 }, full, now), true);
});

test('what is sent: numbers and lists of numbers, whatever was put in', () => {
    const body = sharedBody({
        used: 12.7, waiting: -3, since: 44, seen: 1700000000123.9,
        wants: [
            { sellers: [5, '6', 'abc', -1, 5, 1.5, null, { id: 9 }], trades: ['77'], looking: [88, 'x'], worth: { 206: 812345.6, name: 'Xanax', 9: -4, 10: Infinity, 11: '500' } },
            { sellers: [7], worth: { 206: 700000, 367: 1200 }, inventory: [{ id: 1, qty: 500 }], key: 'AAAABBBBCCCCDDDD' },
            null, 'junk',
        ],
    });
    assert.deepEqual(body, { app: 'torn-bids', used: 12, waiting: 0, sellers: [77, 88, 5, 6, 7], trades: [77], looking: [88], since: 44, seen: 1700000000123, going: [], bought: [], worth: { 206: 812346, 367: 1200 } });
    assert.equal(sharedOutgoingOk(body), true);
    // Which app this is, and its version as build.mjs writes it - a release or a test build; anything else is left out.
    assert.equal(sharedBody({ ver: '3.25.0' }).ver, '3.25.0');
    assert.equal(sharedBody({ ver: '3.25.0-test.20261010.2231' }).ver, '3.25.0-test.20261010.2231');
    for (const odd of ['Lumei', '3.25', 3.25, '3.25.0 AAAABBBBCCCCDDDD', null]) assert.equal('ver' in sharedBody({ ver: odd }), false);
    assert.equal(sharedOutgoingOk(sharedBody({ ver: '3.25.0' })), true);
    assert.equal(JSON.stringify(body).includes('AAAABBBBCCCCDDDD'), false);
    assert.equal('worth' in sharedBody({ sendWorth: false, wants: [{ worth: { 1: 2 } }] }), false);
    assert.equal(sharedBody({ wants: [{ sellers: Array.from({ length: 9000 }, (_, i) => i + 1) }] }).sellers.length, 3000);
});

test('the check on the way out refuses anything that is not that shape', () => {
    const good = sharedBody({ used: 1, wants: [{ sellers: [5], worth: { 206: 5 } }] });
    assert.equal(sharedOutgoingOk(good), true);
    for (const bad of [
        null, [], 'x',
        { ...good, key: 'AAAABBBBCCCCDDDD' },
        { ...good, app: 'AAAABBBBCCCCDDDD' },
        { ...good, app: 7 },
        { ...good, ver: 'Lumei' },
        { ...good, ver: 3 },
        { ...good, inventory: [] },
        { ...good, sellers: ['5'] },
        { ...good, sellers: [{ id: 5, name: 'Abe' }] },
        { ...good, trades: 'all' },
        { ...good, worth: { Xanax: 5 } },
        { ...good, worth: { 206: '800000' } },
        { ...good, worth: [1] },
        { ...good, used: 'many' },
        { ...good, since: -1 },
        { ...good, cash: 5000000 },
        { ...good, looking: [5, null] },
        { ...good, going: [[206]] },
        { ...good, going: [[206, 1000, 'Lumei']] },
        { ...good, going: [{ item: 206, who: 'Me' }] },
        { ...good, going: [[206, 1000, ...Array.from({ length: 31 }, (_, i) => i + 1)]] },
        { ...good, bought: [[11, 206, 2, 790000]] },
        { ...good, bought: [[11, 206, 0, 790000, 5]] },
        { ...good, bought: [[11, 206, 2, 790000, 5, 'Xanax']] },
        { ...good, bought: 'all' },
    ]) assert.equal(sharedOutgoingOk(bad), false, JSON.stringify(bad));
});

test('the reads of the server are kept by seller, only the items of interest, and "seen again" moves the time on', () => {
    const buckets = newBuckets();
    const { interest, gen } = sharedInterest(new Map(), 0, [206, 367]);
    assert.equal(gen, 1);
    const touched = sharedTake(buckets, { reads: [
        { id: 21, at: 1000, items: [{ id: 206, price: 800000, qty: 3 }, { id: 999, price: 5, qty: 1 }, { id: 367, price: 1100, qty: 20 }] },
        { id: 'x', at: 1000, items: [] }, { id: 22, at: 1000 }, null,
        { id: 38, at: 1500, items: [{ id: 206, price: 'cheap', qty: 1 }, { id: 206, price: 790000, qty: 1.5 }] },
    ] }, interest, gen, 2000);
    assert.deepEqual([...touched].sort((a, b) => a - b), [sharedBucketOf(21), sharedBucketOf(38)].sort((a, b) => a - b));
    assert.deepEqual(buckets[sharedBucketOf(21)][21], [1000, 1000, 1, [[206, 800000, 3], [367, 1100, 20]]]);
    assert.deepEqual(buckets[sharedBucketOf(38)][38], [1500, 1500, 1, []]);

    assert.deepEqual([...sharedTake(buckets, { reads: [], seen: [[21, 4000], [21, 3000], [555, 4000], ['x', 1], [38]] }, interest, gen, 5000)], [sharedBucketOf(21)]);
    assert.deepEqual(buckets[sharedBucketOf(21)][21].slice(0, 2), [1000, 4000]);
    // A changed bazaar never loses a later "seen".
    sharedTake(buckets, { reads: [{ id: 21, at: 3500, items: [] }] }, interest, gen, 5000);
    assert.deepEqual(buckets[sharedBucketOf(21)][21], [3500, 4000, 1, []]);

    assert.deepEqual([...sharedPrune(buckets, 4000 + SHARED_KEEP_MS)], [sharedBucketOf(38)]);
    assert.equal(buckets[sharedBucketOf(38)][38], undefined);
    assert.ok(buckets[sharedBucketOf(21)][21]);
});

test('a kept bucket is read back strictly', () => {
    const good = { 21: [1000, 1000, 1, [[206, 800000, 3]]] };
    assert.deepEqual(sharedReadBucket(good), good);
    assert.deepEqual(sharedReadBucket({ ...good, abc: [1, 1, 1, []], 22: [1, 1, 1], 23: [1, 1, 1, [[206, '5', 1]]], 24: 'x', 25: [1, 1, 1.5, []], 26: [1, 1, 1, [], 9] }), good);
    assert.deepEqual(sharedReadBucket(null), {});
    assert.deepEqual(sharedReadBucket([good]), {});
});

test('the answer of Torn itself corrects the row of TornW3B when it is the newer of the two', () => {
    const buckets = newBuckets();
    const { interest, gen } = sharedInterest(new Map(), 0, [206]);
    sharedTake(buckets, { reads: [
        { id: 21, at: 5000, items: [{ id: 206, price: 790000, qty: 2 }] }, // repriced
        { id: 22, at: 5000, items: [] }, // sold out
        { id: 23, at: 1000, items: [{ id: 206, price: 700000, qty: 1 }] }, // older than the check of TornW3B
        { id: 24, at: 5000, items: [{ id: 206, price: 760000, qty: 5 }] }, // TornW3B does not list them
        { id: 25, at: 5000, items: [{ id: 206, price: 1, qty: 1 }] }, // locked at $1
        { id: 26, at: 5000, items: [{ id: 206, price: 800000, qty: 4 }] }, // the same as TornW3B says
    ] }, interest, gen, 6000);
    const index = sharedIndex(buckets);
    const rows = [row(21, 800000, 3, 3000), row(22, 805000, 1, 3000), row(23, 810000, 1, 3000), row(25, 815000, 1, 3000), row(26, 800000, 4, 3000, { changedAt: 2000 }), row(27, 820000, 9, 3000)];
    const out = withShared(rows, 206, index, interest);
    assert.deepEqual(out.map((r) => [r.sellerId, r.price, r.qty, r.dataAt]), [
        ['24', 760000, 5, 5000],
        ['21', 790000, 2, 5000],
        ['26', 800000, 4, 5000],
        ['23', 810000, 1, 3000],
        ['27', 820000, 9, 3000],
    ]);
    assert.equal(out.find((r) => r.sellerId === '21').sellerName, 'S21');
    assert.equal(out.find((r) => r.sellerId === '21').changedAt, 5000);
    assert.equal(out.find((r) => r.sellerId === '26').changedAt, 2000, 'nothing changed, yet the change time moved');
    assert.equal(out.find((r) => r.sellerId === '24').sellerName, null);
    assert.equal(rows.length, 6, 'the rows handed in were changed');
    assert.equal(rows[0].price, 800000);
});

test('with nothing from the server the rows come back as they were, the same list', () => {
    const rows = [row(21, 800000, 3, 3000)];
    assert.equal(withShared(rows, 206, sharedIndex(newBuckets()), new Map()), rows);
    assert.equal(withShared(rows, 206, null, new Map()), rows);
    const buckets = newBuckets();
    const { interest, gen } = sharedInterest(new Map(), 0, [206, 367]);
    sharedTake(buckets, { reads: [{ id: 99, at: 5000, items: [{ id: 367, price: 5, qty: 1 }] }] }, interest, gen, 6000);
    assert.equal(withShared(rows, 206, sharedIndex(buckets), interest), rows);
});

test('an entry kept before an item was of interest says nothing about that item', () => {
    const buckets = newBuckets();
    let { interest, gen } = sharedInterest(new Map(), 0, [206]);
    sharedTake(buckets, { reads: [{ id: 21, at: 5000, items: [{ id: 206, price: 790000, qty: 2 }, { id: 367, price: 1100, qty: 9 }] }] }, interest, gen, 6000);
    const grown = sharedInterest(interest, gen, [367, 206]);
    assert.equal(grown.grew, true);
    assert.equal(grown.gen, 2);
    assert.equal(sharedInterest(interest, grown.gen, [206, 367]).grew, false);
    ({ interest, gen } = grown);
    // 367 was not kept for seller 21 (not of interest then): the row of TornW3B for it must stay.
    const rows = [row(21, 1150, 9, 3000)];
    assert.equal(withShared(rows, 367, sharedIndex(buckets), interest), rows);
    // Read again after it joined, and gone from that bazaar: now the row goes.
    sharedTake(buckets, { reads: [{ id: 21, at: 7000, items: [{ id: 206, price: 790000, qty: 2 }] }] }, interest, gen, 8000);
    assert.deepEqual(withShared(rows, 367, sharedIndex(buckets), interest), []);
});

test('two listings of one item in one bazaar, and two TornW3B rows of one seller', () => {
    const buckets = newBuckets();
    const { interest, gen } = sharedInterest(new Map(), 0, [50]);
    sharedTake(buckets, { reads: [{ id: 21, at: 5000, items: [{ id: 50, price: 900, qty: 1 }, { id: 50, price: 950, qty: 1 }] }, { id: 22, at: 5000, items: [] }] }, interest, gen, 6000);
    const out = withShared([row(21, 880, 1, 3000), row(21, 990, 1, 3000), row(22, 870, 1, 3000), row(22, 871, 1, 3000)], 50, sharedIndex(buckets), interest);
    assert.deepEqual(out.map((r) => [r.sellerId, r.price]), [['21', 900], ['21', 950]]);
});

test('Settings > Shared says only what is known', () => {
    const now = 50 * 60000;
    // Torn names, as the server got them from Torn: shown as they are, never changed, never a label.
    const VIN = { id: 2000002, name: 'xX-Vin-Xx' };
    const ALF = { id: 2000003, name: 'Alf-0nso' };
    const on = { on: true, okAt: now - 12000, error: null, reading: 'reading', key: 'working', need: 23, serverShare: 57, people: 3, peopleOn: [VIN], you: { id: 2000001, name: 'PlayerOne' } };
    assert.deepEqual(sharedNowLine(null, now), { level: 'off', text: 'Off. Torn Bids works alone.' });
    assert.deepEqual(sharedNowLine(on, now), { level: 'ok', text: 'Connected · 3 people · xX-Vin-Xx is on now · last exchange 12 s ago' });
    assert.equal(sharedNowLine({ ...on, peopleOn: [] }, now).text, 'Connected · 3 people · nobody else is on now · last exchange 12 s ago');
    assert.equal(sharedNowLine({ ...on, peopleOn: [ALF, VIN] }, now).text, 'Connected · 3 people · Alf-0nso and xX-Vin-Xx are on now · last exchange 12 s ago');
    // Someone Torn has not named yet: counted, not named.
    assert.equal(sharedNowLine({ ...on, peopleOn: [{ id: null, name: null }] }, now).text, 'Connected · 3 people · 1 other is on now · last exchange 12 s ago');
    assert.equal(sharedNowLine({ ...on, peopleOn: [VIN, { id: null, name: null }] }, now).text, 'Connected · 3 people · 2 others are on now · last exchange 12 s ago');
    // What the server sends is checked: only a Torn id and a Torn name get through.
    assert.deepEqual(sharedPerson({ id: 2000002, name: 'xX-Vin-Xx', key: 'x' }), VIN);
    assert.deepEqual(sharedPerson({ id: '7', name: '<b>x</b>' }), { id: null, name: null });
    assert.deepEqual(sharedPerson(null), { id: null, name: null });
    // Alone on a server: no word about others.
    assert.equal(sharedNowLine({ ...on, people: 1, peopleOn: [] }, now).text, 'Connected · 1 person · last exchange 12 s ago');
    assert.equal(sharedNowLine({ ...on, reading: 'paused' }, now).level, 'warn');
    // A PC the server does not know: off, in so many words, and nothing is asked of the person.
    assert.deepEqual(sharedNowLine({ ...on, okAt: null, unknown: true, error: 'The server does not know this PC.' }, now), { level: 'off', text: 'Not on the shared server. Torn Bids works alone.' });
    assert.equal(sharedKnown({ ...on, okAt: null, unknown: true }), false);
    assert.equal(sharedKnown(on), true);
    // Before the server's first answer nothing is shown either: it may not know this PC.
    assert.equal(sharedKnown({ on: true, okAt: null, error: null }), false);
    assert.equal(sharedKnown(null), false);
    assert.match(sharedNowLine({ ...on, error: 'Network request failed.' }, now).text, /^No answer since \d\d:\d\d · working alone$/);
    assert.match(sharedNowLine({ ...on, okAt: now - 3 * 60000 }, now).text, /^No answer since /);
    assert.equal(sharedNowLine({ on: true, okAt: null, error: 'Network request failed.' }, now).text, 'No answer yet · working alone');
    assert.equal(sharedNowLine({ on: true, okAt: null, error: null }, now).level, 'idle');

    assert.deepEqual(sharedKeyLine(on), { level: 'ok', text: 'Working · the key of PlayerOne [2000001]' });
    assert.deepEqual(sharedKeyLine({ ...on, you: { id: null, name: null } }), { level: 'ok', text: 'Working' });
    assert.deepEqual(sharedKeyLine({ ...on, key: 'refused by Torn (2)' }), { level: 'bad', text: 'Torn refused your key on the server (code 2). Whoever runs your server needs a new Public Only key from you.' });
    assert.equal(sharedKeyLine({ on: true, okAt: null }).text, 'Not known yet.');

    assert.deepEqual(sharedSplit(on, now), { pc: 23, server: 57, free: 20 });
    assert.equal(sharedSplit({ ...on, okAt: now - 6 * 60000 }, now), null, 'a split six minutes old was shown as agreed');
    assert.equal(sharedSplit({ on: false }, now), null);
});

test('the two marks leave as numbers and ages: what you are going for, and what you bought', () => {
    const now = 1700000000000;
    const wants = [
        // Torn Bids: a planned trade for item 206 at bazaars 11 and 12, opened 3 minutes ago; two buys.
        { going: [[206, now - 180000, 11, 12, 'Lumei', 11]], bought: [[11, 206, 2, 790000, now - 60000], [12, 206, 1, 795000.4, now - 5000]] },
        // The overlay: the same trade seen later with one more bazaar; the same first buy again; rubbish.
        { going: [[206, now - 120000, 13], ['Xanax', now, 5], [367, 'soon', 5], [368, now + 60000, 5]], bought: [[11, 206, 2, 790000, now - 60000], [11, 206, 0, 790000, now], [11, 'Xanax', 1, 5, now], [14, 206, 1, 5, now - SHARED_BOUGHT_MS], null], name: 'Me' },
        null,
    ];
    // Each once: one mark per item with the earliest opening and every bazaar; one line per buy.
    assert.deepEqual(sharedMarks(wants, now), {
        going: [[206, now - 180000, 11, 12, 13]],
        bought: [[11, 206, 2, 790000, now - 60000], [12, 206, 1, 795000, now - 5000]],
    });
    const body = sharedBody({ wants, now });
    assert.deepEqual(body.going, [[206, 180000, 11, 12, 13]]);
    assert.deepEqual(body.bought, [[11, 206, 2, 790000, 60000], [12, 206, 1, 795000, 5000]]);
    assert.equal(sharedOutgoingOk(body), true);
    assert.equal(/Lumei|Xanax|Me/.test(JSON.stringify(body)), false);
    // No more than the server takes.
    const many = sharedBody({ now, wants: [{
        going: Array.from({ length: 80 }, (_, i) => [i + 1, now, ...Array.from({ length: 50 }, (_x, j) => j + 1)]),
        bought: Array.from({ length: 400 }, (_, i) => [i + 1, 206, 1, 5, now]),
    }] });
    assert.equal(many.going.length, 50);
    assert.equal(many.going[0].length, 32);
    assert.equal(many.bought.length, 200);
    assert.equal(sharedOutgoingOk(many), true);
});

test('the others\' marks: checked on the way in, timed by this PC\'s clock, and not rewritten for a second\'s difference', () => {
    const now = 1700000000000;
    const VIN = { who: 'xX-Vin-Xx', whoId: 2000002 };
    const answer = { marks: {
        going: [
            { ...VIN, item: 206, age: 180000, sellers: [11, 12, 'x'] },
            { who: '<b>Vincent</b>', whoId: 'x', item: 367, age: 1000, sellers: [] },
            { ...VIN, item: 'Xanax', age: 5, sellers: [11] },
            { ...VIN, item: 368, age: -5, sellers: [11] },
            null,
        ],
        bought: [
            { ...VIN, seller: 11, item: 206, qty: 2, price: 790000, age: 60000 },
            { ...VIN, seller: 11, item: 206, qty: 0, price: 790000, age: 60000 },
            { ...VIN, seller: 11, item: 206, qty: 1, price: 790000, age: SHARED_BOUGHT_MS + 1 },
            'junk',
        ],
    } };
    const first = sharedMarksIn(answer, null, now);
    assert.deepEqual(first, {
        going: [
            { who: 'xX-Vin-Xx', whoId: 2000002, item: 206, at: now - 180000, sellers: [11, 12] },
            // A name that is not a Torn name is not shown: the mark stays, nameless.
            { who: null, whoId: null, item: 367, at: now - 1000, sellers: [] },
        ],
        bought: [{ who: 'xX-Vin-Xx', whoId: 2000002, seller: 11, item: 206, qty: 2, price: 790000, at: now - 60000 }],
    });
    // 30 s later the same marks arrive 30.4 s older: nothing changed, so nothing is rewritten.
    const older = structuredClone(answer);
    older.marks.going[0].age += 30400;
    older.marks.going[1].age += 30400;
    older.marks.bought[0].age += 30400;
    assert.deepEqual(sharedMarksIn(older, first, now + 30000), first);
    // Two buys alike are two buys.
    const twice = { marks: { bought: [answer.marks.bought[0], answer.marks.bought[0]] } };
    assert.equal(sharedMarksIn(twice, first, now).bought.length, 2);
    // Left out by the server = gone.
    assert.deepEqual(sharedMarksIn({}, first, now), { going: [], bought: [] });
    assert.deepEqual(sharedMarksIn(null, first, now), { going: [], bought: [] });

    // Going by them: nobody is "going for" anything once the server has been silent two minutes; a buy stays its half hour.
    assert.deepEqual(sharedMarksNow(first, now - 10000, now), first);
    assert.deepEqual(sharedMarksNow(first, now - 121000, now), { going: [], bought: first.bought });
    assert.deepEqual(sharedMarksNow(first, null, now), { going: [], bought: first.bought });
    assert.deepEqual(sharedMarksNow(first, now, now - 60000 + SHARED_BOUGHT_MS), { going: [], bought: [] });
    assert.deepEqual(sharedMarksNow(null, now, now), { going: [], bought: [] });
});

test('what this PC is going for: a trade started on or said yes to, while there was a step in the last 10 minutes', () => {
    const now = 1700000000000;
    const done = (st) => Boolean(st.bought || st.skipped);
    const hold = (touched, at = touched) => ({ touched, trade: { at, lines: [
        { itemId: '206', units: 4, steps: [{ sellerId: '11', qty: 3 }, { sellerId: '12', qty: 1 }, { sellerId: '11', qty: 1 }] },
        // Its bazaars not read yet (an estimate): nothing to say where.
        { itemId: '367', units: 10, steps: [] },
        { itemId: '368', units: 0, steps: [{ sellerId: '13', qty: 1 }] },
    ] } });
    // Started on 3 minutes ago, last pressed a minute ago.
    assert.deepEqual(sharedGoingOwn({ holds: [hold(now - 60000, now - 180000)], now, done }), [[206, now - 180000, 11, 12]]);
    // Nothing pressed for 10 minutes: you walked away.
    assert.deepEqual(sharedGoingOwn({ holds: [hold(now - SHARED_GOING_QUIET_MS)], now, done }), []);

    const yes = (at, steps206) => ({ at, items: [
        { itemId: '206', kind: 'flip', steps: steps206 },
        { itemId: '99', kind: 'yours', steps: [] },
    ] });
    // Said yes 4 minutes ago: the bazaars still to buy from.
    assert.deepEqual(
        sharedGoingOwn({ accepted: [yes(now - 240000, [{ sellerId: '11', qty: 3, bought: true, boughtAt: now - 200000 }, { sellerId: '12', qty: 1 }])], now, done }),
        [[206, now - 240000, 12]],
    );
    // Everything bought: no mark - what you bought says the rest.
    assert.deepEqual(sharedGoingOwn({ accepted: [yes(now - 240000, [{ sellerId: '11', qty: 3, bought: true, boughtAt: now - 1000 }])], now, done }), []);
    // Said yes 25 minutes ago, last buy 2 minutes ago: still on it. Last buy 11 minutes ago: not.
    assert.equal(sharedGoingOwn({ accepted: [yes(now - 1500000, [{ sellerId: '11', qty: 3, bought: true, boughtAt: now - 120000 }, { sellerId: '12', qty: 1 }])], now, done }).length, 1);
    assert.equal(sharedGoingOwn({ accepted: [yes(now - 1500000, [{ sellerId: '11', qty: 3, bought: true, boughtAt: now - 660000 }, { sellerId: '12', qty: 1 }])], now, done }).length, 0);
    assert.deepEqual(sharedGoingOwn({ now }), []);
    // And it is what may be sent.
    const body = sharedBody({ now, wants: [{ going: sharedGoingOwn({ holds: [hold(now - 60000, now - 180000)], now, done }) }] });
    assert.deepEqual(body.going, [[206, 180000, 11, 12]]);
    assert.equal(sharedOutgoingOk(body), true);
});

test('the marks in words: Torn names as Torn gives them, "A friend" where none is known, never a lock', () => {
    const now = 1700000000000;
    const VIN = { who: 'xX-Vin-Xx', whoId: 2000002 };
    const ALF = { who: 'Alf-0nso', whoId: 2000003 };
    const by = sharedGoingByItem([
        { ...VIN, item: 206, at: now - 185000, sellers: [11, 12] },
        { ...ALF, item: 367, at: now - 20000, sellers: [13] },
        { ...ALF, item: 206, at: now - 400000, sellers: [12, 14] },
        { who: null, whoId: null, item: 368, at: now - 3700000, sellers: [] },
    ]);
    assert.deepEqual([...by.keys()], ['206', '367', '368']);
    assert.deepEqual([...by.get('206').sellers], ['11', '12', '14']);
    assert.equal(sharedOnThis(by.get('367'), now), 'Alf-0nso is on this · now');
    assert.equal(sharedOnThis(by.get('206'), now), 'xX-Vin-Xx and Alf-0nso are on this · 6m');
    assert.equal(sharedOnThis(by.get('368'), now), 'A friend is on this · 1h');
    // One person is one person, however many lines say so.
    assert.equal(sharedOnThis(sharedGoingByItem([{ ...VIN, item: 206, at: now, sellers: [11] }, { ...VIN, item: 206, at: now, sellers: [12] }]).get('206'), now), 'xX-Vin-Xx is on this · now');
    assert.deepEqual(sharedGoingFor(by.get('367'), now), { lead: 'Alf-0nso is going for this', rest: 'opened just now' });
    assert.deepEqual(sharedGoingFor({ who: ['xX-Vin-Xx'], at: now - 185000 }, now), { lead: 'xX-Vin-Xx is going for this', rest: 'opened 3m ago' });
    assert.deepEqual(sharedGoingFor({ who: ['xX-Vin-Xx'], at: now - 185000 }, now, 'Xanax'), { lead: 'xX-Vin-Xx is going for the Xanax here', rest: 'opened 3m ago' });
    assert.deepEqual(sharedGoingFor({ who: [null, 'xX-Vin-Xx'], at: now }, now), { lead: '2 friends are going for this', rest: 'opened just now' });
    assert.deepEqual(
        sharedBoughtLine({ who: 'xX-Vin-Xx', qty: 2, bazaar: 'swagbazaar', at: now - 61000, units: 3 }, now),
        { lead: 'xX-Vin-Xx bought 2', rest: 'at swagbazaar · 1m ago · your plan is now 3' },
    );
    assert.deepEqual(sharedBoughtLine({ qty: 1, at: now, units: 0 }, now), { lead: 'A friend bought 1', rest: 'at a bazaar · just now · your plan is now 0' });
});

test('the small panel on Torn\'s pages: one line - Shared is on, how many people - and nothing where the server is not known', async () => {
    const { sharedPanelLine } = await import('../src/core/shared.js');
    const now = 1_800_000_000_000;
    assert.equal(sharedPanelLine(null, now), null);
    assert.equal(sharedPanelLine({ on: false }, now), null);
    assert.deepEqual(sharedPanelLine({ on: true, okAt: now - 20000, people: 3 }, now), { lead: 'Shared is on', rest: '3 people' });
    assert.deepEqual(sharedPanelLine({ on: true, okAt: now - 20000, people: 1 }, now), { lead: 'Shared is on', rest: '1 person' });
    // How many is not known yet: not made up.
    assert.deepEqual(sharedPanelLine({ on: true, okAt: now - 20000, people: null }, now), { lead: 'Shared is on', rest: 'connected' });
    // The server is silent or answered with an error: said, with no count that may be old.
    for (const st of [{ on: true, okAt: now - 3600000, people: 3 }, { on: true, okAt: now - 1000, people: 3, error: 'Network request failed.' }]) {
        assert.deepEqual(sharedPanelLine(st, now), { lead: 'Shared is on', rest: 'no answer from the server, working alone' });
    }
    // It never answered this PC, or does not know it: to this PC there is no server, and no line.
    assert.equal(sharedPanelLine({ on: true, okAt: null, people: 3 }, now), null);
    assert.equal(sharedPanelLine({ on: true, okAt: null, unknown: true, error: 'The server does not know this PC.' }, now), null);
});

test('3.25.0: which TornW3B lists this PC just read leaves as item numbers and ages - nothing else', () => {
    const now = 9_000_000;
    const wants = [{ dir: [[206, now - 4000], ['367', now - 90000], [206, now - 1000], ['name', now], [5, now + 99], [6, 'x']] }, { dir: [[367, now - 20000], [206, now - 50000]] }, { dir: 'no' }];
    assert.deepEqual(sharedDir(wants), [[5, now + 99], [206, now - 1000], [367, now - 20000]], 'the newest read of each item, newest first');
    const body = sharedBody({ wants, now });
    assert.deepEqual(body.dir, [[5, 0], [206, 1000], [367, 20000]]);
    assert.equal(sharedOutgoingOk(body), true);
    assert.equal('dir' in sharedBody({ wants: [{}], now }), false, 'nothing read: nothing said');
    for (const bad of [[[206]], [[206, 1, 2]], [['206', 1]], [[0, 1]], [[206, -1]], 'x', [206]]) assert.equal(sharedOutgoingOk({ ...body, dir: bad }), false, JSON.stringify(bad));
});

test('3.25.0: what the others read arrives in this PC\'s own time, is kept half an hour, and a broken answer changes nothing', () => {
    const now = 9_000_000;
    const first = sharedDirIn({ dir: [[206, 14000], [367, 70000], ['x', 1], [9, -5]], turn: { of: 2, me: 1 } }, null, now);
    assert.deepEqual(first, { reads: { 206: now - 14000, 367: now - 70000 }, turn: { of: 2, me: 1 } });
    // A later answer: the newer time stands, an older one does not undo it; what is half an hour old goes.
    const later = sharedDirIn({ dir: [[206, 60000], [400, 0]], turn: { of: 3, me: 0 } }, first, now + 30000);
    assert.deepEqual(later.reads, { 206: now - 14000, 367: now - 70000, 400: now + 30000 });
    assert.deepEqual(later.turn, { of: 3, me: 0 });
    assert.deepEqual(sharedDirIn({ turn: { of: 2, me: 1 } }, later, now + SHARED_DIR_KEEP_MS).reads, { 400: now + 30000 });
    for (const turn of [undefined, null, { of: 0, me: 0 }, { of: 2, me: 2 }, { of: 2.5, me: 0 }, { of: 2, me: -1 }, 'x']) {
        assert.deepEqual(sharedDirIn({ turn }, null, now), { reads: {}, turn: { of: 1, me: 0 } }, JSON.stringify(turn));
    }
});

test('3.25.0: a list a friend\'s PC just read is not read again here; each item has one PC that goes first, and nobody waits on a PC that does not read', () => {
    const every = 120000;
    const now = 9_000_000;
    // Alone, or Shared off: exactly as before.
    assert.equal(sharedDirDue(now - every, every, now, 206, null), true);
    assert.equal(sharedDirDue(now - every + 1, every, now, 206, null), false);
    assert.equal(sharedDirDue(now - every, every, now, 206, { reads: {}, turn: { of: 1, me: 0 } }), true);
    // A friend read it a minute ago: not due here, whoever's turn it is.
    const kept = { reads: { 206: now - 60000 }, turn: { of: 2, me: 0 } };
    assert.equal(sharedDirDue(now - every, every, now, 206, kept), false);
    assert.equal(sharedDirDue(now - every, every, now + 60000, 206, kept), true, 'two minutes after the friend\'s read it is due again (206 is this PC\'s)');
    // Two PCs: 206 is PC 0's, 367 is PC 1's. The other one waits a little past due - then reads it itself.
    const two = (me) => ({ reads: {}, turn: { of: 2, me } });
    assert.equal(sharedDirDue(now - every, every, now, 206, two(0)), true);
    assert.equal(sharedDirDue(now - every, every, now, 206, two(1)), false);
    assert.equal(sharedDirDue(now - every - SHARED_TURN_WAIT_MS, every, now, 206, two(1)), true);
    assert.equal(sharedDirDue(now - every, every, now, 367, two(1)), true);
    assert.equal(sharedDirDue(now - every, every, now, 367, two(0)), false);
    assert.ok(SHARED_TURN_WAIT_MS > 30000 && SHARED_TURN_WAIT_MS <= 60000, 'longer than one exchange, so the PC whose turn it is has said so');
});

test('nobody sets Shared up: the address is built in, and the word of the PC is made from its Public key', async () => {
    // The address this copy was built with; a PC may keep another (the test page does), or 'off'.
    assert.equal(sharedHome('https://ours.someone.workers.dev', null), 'https://ours.someone.workers.dev');
    assert.equal(sharedHome('https://ours.someone.workers.dev', 'https://test.someone.workers.dev/'), 'https://test.someone.workers.dev');
    assert.equal(sharedHome('https://ours.someone.workers.dev', 'off'), null);
    assert.equal(sharedHome('', null), null);
    // Only a workers.dev address over https is ever one, built in or kept.
    assert.equal(sharedHome('http://ours.someone.workers.dev', null), null);
    assert.equal(sharedHome('https://ours.someone.workers.dev', 'https://evil.example.com'), 'https://ours.someone.workers.dev');

    // The word: the same key gives the same word, another key another; it is not the key and does not hold it.
    const KEY = 'abcdefgh12345678';
    const word = await sharedWord(KEY);
    assert.match(word, /^[0-9a-f]{64}$/);
    assert.equal(await sharedWord(KEY), word);
    assert.notEqual(await sharedWord('abcdefgh12345679'), word);
    assert.ok(!word.includes(KEY));
    // It is what the server takes as a PC's word: letters and digits, 24 or more.
    assert.ok(sharedPassOk(word));
    // No key, or something that is not a Torn key: no word, and so no server.
    assert.equal(await sharedWord(''), null);
    assert.equal(await sharedWord(null), null);
    assert.equal(await sharedWord('short'), null);
});

/* 3.26.0 (the owner, 2026-10-11): NPC Arbitrage takes bazaar prices from Torn's API through the shared server. */
test('the server\'s own reads make a deal by themselves: listings under what the item sells for, read in the last five minutes', async () => {
    const { sharedDealRows, sharedKnowsLowest, SHARED_DEAL_MAX_AGE_MS } = await import('../src/core/shared.js');
    const T = 1_900_000_000_000;
    assert.equal(SHARED_DEAL_MAX_AGE_MS, 5 * 60000);
    // seller -> [changed at, seen at, gen, [[item, price, qty]]]
    const index = sharedIndex([{
        888: [T - 600000, T - 20000, 1, [[206, 835000, 3], [1, 40, 9]]],
        4444: [T - 60000, T - 60000, 1, [[206, 836000, 1], [206, 1, 5], [206, 834000, 0]]],
        555: [T - 4 * 3600000, T - 6 * 60000, 1, [[206, 700000, 2]]],
    }]);
    // Under $836,000: only 888's - 4444's is not under it, its $1 listing is locked, its empty one is none, 555 was read six minutes ago.
    assert.deepEqual(sharedDealRows(index, 206, 836000, T), [
        { sellerId: '888', sellerName: null, price: 835000, qty: 3, dataAt: T - 20000, changedAt: T - 600000, sponsored: false, shared: true },
    ]);
    assert.deepEqual(sharedDealRows(index, '206', 900000, T).map((r) => [r.sellerId, r.price]), [['888', 835000], ['4444', 836000]]);
    assert.deepEqual(sharedDealRows(index, 206, 835000, T), []);
    assert.deepEqual(sharedDealRows(index, 999, 1e9, T), []);
    assert.deepEqual(sharedDealRows(null, 206, 1e9, T), []);

    // TornW3B's summary says the cheapest is $835,000: the server read that very price - nothing to ask TornW3B.
    assert.equal(sharedKnowsLowest(index, 206, 835000, T), true);
    assert.equal(sharedKnowsLowest(index, 206, 840000, T), true);
    // TornW3B sees a cheaper one than any the server read lately (555's read is too old): its sellers list is asked for.
    assert.equal(sharedKnowsLowest(index, 206, 700000, T), false);
    assert.equal(sharedKnowsLowest(index, 206, 834999, T), false);
    // A locked $1 listing is never "known", whoever names it.
    assert.equal(sharedKnowsLowest(index, 206, 1, T), false);
    assert.equal(sharedKnowsLowest(index, 999, 50, T), false);
    assert.equal(sharedKnowsLowest(null, 206, 835000, T), false);
});

test('under the Public key\'s box: what the server said of this key, only while the Shared part does not say it', async () => {
    const { sharedKeyBoxLine } = await import('../src/core/shared.js');
    // No key or no server address in this copy; or one of the server's own people (the Shared part says it).
    assert.equal(sharedKeyBoxLine(null), '');
    assert.equal(sharedKeyBoxLine({ on: false }), '');
    assert.equal(sharedKeyBoxLine({ on: true, okAt: 5, key: 'working' }), '');
    // The server does not know this key: said plainly, with when it is asked again.
    assert.match(sharedKeyBoxLine({ on: true, unknown: true, unknownWaitMs: 5 * 60000 }), /does not know this key.*needs this same key from you.*every 5 minutes.*save the key here again/);
    assert.match(sharedKeyBoxLine({ on: true, unknown: true, unknownWaitMs: 60 * 60000 }), /every 1 hour,/);
    assert.match(sharedKeyBoxLine({ on: true, unknown: true, unknownWaitMs: 6 * 3600000 }), /every 6 hours,/);
    // Not asked yet, or no answer.
    assert.equal(sharedKeyBoxLine({ on: true }), 'Shared server: not asked yet.');
    assert.equal(sharedKeyBoxLine({ on: true, error: 'no answer' }), 'Shared server: no answer yet.');
});
