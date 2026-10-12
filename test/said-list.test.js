// 3.31.0 - a trader's own price list, told by their Torn Archive through the shared server. The owner, 2026-10-12:
// his friend buys plushies for him while he sleeps; his shop is then closed, his prices are off TornW3B, and Torn
// Bids saw nobody to sell them to. "server should always keep my live pricelist ... then tornbids should look at
// it, this is only FOR ME". Here: the pure parts, and the whole way - his Torn Archive's sync into the real server
// code, another person's Torn Bids asking it, a buyer row and a checked price out of that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedLink, SHARED_CONFIG_KEY, SHARED_OWN_KEY, SHARED_TICK_MS } from '../src/feed/shared-link.js';
import { sharedBody, sharedOutgoingOk, sharedOwnIn, sharedOwnKeep } from '../src/core/shared.js';
import { emptyTraderDb, recordW3bList, indexW3bByItem, buyersForItem, saidLists, SAID_MAX_AGE_MS, oldList, stalePrice } from '../src/core/traders.js';
import { priceChecked, FLIP_CHECK_MS } from '../src/core/checked.js';
import { ownerList } from '../src/core/owner-tab.js';
import { serverFile } from './server-path.js';

const { peopleFrom, whoIs } = await import(serverFile('src/host.js'));
const { KEY_ABE, PASS_VINCENT, ENV, WHO, newWorld } = await import(serverFile('test/server-world.js'));

const NOW = Date.UTC(2026, 9, 12, 14, 0);
const MIN = 60000;
const HOUR = 60 * MIN;
const HIM = String(WHO[KEY_ABE].id);
const KITTEN = 215;
const SHEEP = 186;
const PANDA = 274;

test('the answer\'s own lists: ages into this PC\'s time, whole prices only, and what is not one is left out', () => {
    const got = sharedOwnIn({ own: [
        [2000001, 3 * HOUR, 5 * HOUR, 0, { [KITTEN]: 510, [SHEEP]: 612, x: 4, 300: 1.5, 301: 0 }, [PANDA, KITTEN, 'y']],
        [2000002, 0, 0, 1, { [SHEEP]: 600 }, []],
        [0, 0, 0, 1, { [SHEEP]: 600 }, []],
        [2000003, -5, 0, 1, { [SHEEP]: 600 }, []],
        [2000004, 0, 0, true, { [SHEEP]: 600 }, []],
        [2000005, 0, 0, 1, [600], []],
        [2000006, 0, 0, 1, {}, []],
        'junk',
    ] }, NOW);
    assert.deepEqual(got, [
        { trader: 2000001, at: NOW - 3 * HOUR, since: NOW - 5 * HOUR, open: false, prices: { [KITTEN]: 510, [SHEEP]: 612 }, off: [PANDA] },
        { trader: 2000002, at: NOW, since: NOW, open: true, prices: { [SHEEP]: 600 }, off: [] },
    ]);
    assert.deepEqual(sharedOwnIn({}, NOW), []);
    // 3.32.0 - what the server says beside a list: the trader's name, a whole set's prices, how many are taken.
    const more = sharedOwnIn({
        own: [[2000001, 0, 0, 0, { [SHEEP]: 612 }, [KITTEN]], [2000002, 0, 0, 1, { [SHEEP]: 600 }, []]],
        ownMore: {
            2000001: { name: 'Buyer', all: { [SHEEP]: 612, [KITTEN]: 510, x: 5, 300: 0 }, sets: { plushie: 3, flower: 0, 'Not A Set': 2, deep: -1 }, take: { [SHEEP]: 4, [KITTEN]: 0, 301: 1.5 }, holds: { [SHEEP]: 99 } },
            2000002: { name: '', all: [], sets: 'x' },
            2000009: { name: 'Nobody' },
        },
    }, NOW);
    assert.deepEqual(more[0], { trader: 2000001, at: NOW, since: NOW, open: false, prices: { [SHEEP]: 612 }, off: [KITTEN], name: 'Buyer', all: { [SHEEP]: 612, [KITTEN]: 510 }, sets: { plushie: 3, flower: 0 }, take: { [SHEEP]: 4, [KITTEN]: 0 } });
    assert.deepEqual(more[1], { trader: 2000002, at: NOW, since: NOW, open: true, prices: { [SHEEP]: 600 }, off: [] });
    const keptMore = sharedOwnKeep(null, more, 3);
    assert.deepEqual(keptMore.lists['2000001'].sets, { plushie: 3, flower: 0 });
    assert.equal(keptMore.lists['2000001'].name, 'Buyer');
    assert.equal('all' in keptMore.lists['2000002'], false);
    // Kept by trader; the newer one stands; the running number is the server's.
    const kept = sharedOwnKeep(null, got, 7);
    assert.equal(kept.mark, 7);
    assert.deepEqual(Object.keys(kept.lists), ['2000001', '2000002']);
    const next = sharedOwnKeep(kept, [{ trader: 2000001, at: NOW - 4 * HOUR, since: NOW - 4 * HOUR, open: true, prices: { [KITTEN]: 1 }, off: [] }, { trader: 2000002, at: NOW + MIN, since: NOW, open: false, prices: { [SHEEP]: 590 }, off: [] }], 9);
    assert.equal(next.lists['2000001'].prices[KITTEN], 510, 'an older one does not take the place of a newer');
    assert.deepEqual(next.lists['2000002'].prices, { [SHEEP]: 590 });
    // What is asked of the server: the number held, and nothing else new.
    const body = sharedBody({ ownSince: 7, now: NOW });
    assert.equal(body.ownSince, 7);
    assert.equal(sharedOutgoingOk(body), true);
    assert.equal('ownSince' in sharedBody({ now: NOW }), false);
    assert.equal(sharedOutgoingOk({ ...body, ownSince: 'x' }), false);
});

test('his own word stands over TornW3B\'s copy of his list: closed there, he still buys; a piece he does not want is gone; a day unheard, it lapses', () => {
    const db = emptyTraderDb();
    // TornW3B's copy, read a minute ago: the shop is closed, so no set piece is on it - one other item is, and a
    // piece he took off his own word a moment ago still is (TornW3B is a couple of minutes behind).
    recordW3bList(db, HIM, { prices: { 206: 830000, [PANDA]: 36000 } }, NOW - MIN);
    recordW3bList(db, '777', { prices: { [KITTEN]: 505 } }, NOW - MIN);
    const stored = { mark: 3, lists: { [HIM]: { at: NOW - 3 * HOUR, since: NOW - 6 * HOUR, open: false, prices: { [KITTEN]: 510, [SHEEP]: 612 }, off: [PANDA] } } };
    const said = saidLists(stored, NOW);
    assert.deepEqual([...said.keys()], [HIM]);
    const index = indexW3bByItem(db, NOW, said);
    assert.deepEqual(index.get(String(KITTEN)).sort((a, b) => b.price - a.price), [{ id: HIM, price: 510 }, { id: '777', price: 505 }]);
    assert.deepEqual(index.get(String(SHEEP)), [{ id: HIM, price: 612 }]);
    assert.equal(index.get(String(PANDA)), undefined, 'a piece he holds too many of is not bought, whatever TornW3B still says');
    assert.deepEqual(index.get('206'), [{ id: HIM, price: 830000 }], 'what his own word does not name stays as TornW3B has it');
    // Without it: as before.
    assert.equal(indexW3bByItem(db, NOW).get(String(SHEEP)), undefined);
    // He is a buyer of the Kitten, at his price, first.
    const rows = buyersForItem(String(KITTEN), { db, w3bByItem: index });
    assert.deepEqual(rows.map((r) => [r.id, r.price, r.w3b]), [[HIM, 510, 510], ['777', 505, 505]]);
    // A trader the database does not know yet is a buyer all the same.
    const bare = indexW3bByItem(emptyTraderDb(), NOW, said);
    assert.deepEqual(bare.get(String(SHEEP)), [{ id: HIM, price: 612 }]);
    // Not heard for a day: it says nothing any more.
    assert.equal(saidLists(stored, NOW - 3 * HOUR + SAID_MAX_AGE_MS).size, 1);
    assert.equal(saidLists(stored, NOW - 3 * HOUR + SAID_MAX_AGE_MS + 1).size, 0);
    for (const junk of [null, {}, { lists: [] }, { lists: { x: { at: NOW, prices: {} } } }, { lists: { [HIM]: { at: 0, prices: {} } } }]) assert.equal(saidLists(junk, NOW).size, 0);
});

test('a price that is his own word is checked without a TornW3B read, says so and says his shop is closed; another price of his is not', () => {
    const said = { at: NOW - 3 * HOUR, since: NOW - 6 * HOUR, open: false, prices: { [KITTEN]: 510 }, off: [] };
    const b = { id: HIM, price: 510, w3b: 510, te: null };
    // Nothing of TornW3B's: no read of the item's buyers, no list date.
    assert.deepEqual(priceChecked(b, { itemId: String(KITTEN), now: NOW }), { ok: false, why: 'not-checked', at: 0 });
    assert.deepEqual(priceChecked(b, { itemId: String(KITTEN), said, now: NOW }), { ok: true, why: 'said', at: NOW - 3 * HOUR, closed: true });
    assert.equal(priceChecked(b, { itemId: String(KITTEN), said: { ...said, open: true }, now: NOW }).closed, false);
    // TornW3B names him at another price (its copy from before he changed it): that one needs its own check.
    assert.equal(priceChecked({ ...b, price: 520, w3b: 520 }, { itemId: String(KITTEN), said, now: NOW }).why, 'not-checked');
    // An item his word does not name; a word a day old; a price only on TornExchange.
    assert.equal(priceChecked(b, { itemId: String(SHEEP), said, now: NOW }).ok, false);
    assert.equal(priceChecked(b, { itemId: String(KITTEN), said: { ...said, at: NOW - SAID_MAX_AGE_MS - 1 }, now: NOW }).ok, false);
    assert.equal(priceChecked({ id: HIM, price: 510, w3b: null, te: 510 }, { itemId: String(KITTEN), said, now: NOW }).why, 'te-only');
    assert.ok(FLIP_CHECK_MS < 3 * HOUR, 'three hours is far past what a TornW3B check stands for');
    // His list's date is when the server last heard it: under twelve hours it is not "getting old".
    const listAtOf = (id) => (String(id) === HIM ? said.at : 0);
    assert.equal(oldList(b, listAtOf, NOW), null);
    assert.equal(stalePrice(b, listAtOf, NOW), false);
});

test('the whole way: his Torn Archive tells the real server, he closes and his PC goes off, and another person\'s Torn Bids still has his prices hours later', async () => {
    // The server's reader sleeps between reads, and time passes in that sleep too: the tab ticks through it.
    const rig = { tickDue: async () => {} };
    const world = newWorld({ env: ENV, onSleep: async () => { await rig.tickDue(); } });
    const people = peopleFrom(ENV);
    const values = new Map([[SHARED_CONFIG_KEY, { address: 'https://torn-bids-shared.test.workers.dev', pass: PASS_VINCENT }]]);
    const posts = [];
    const link = new SharedLink({
        tabId: 't1', world: 'sell', version: '3.31.0',
        load: (key) => (values.has(key) ? structuredClone(values.get(key)) : null),
        save: (key, value) => { values.set(key, structuredClone(value)); },
        del: (key) => { values.delete(key); },
        post: async (url, options) => {
            const body = JSON.parse(options.body);
            posts.push(body);
            const who = whoIs(people, String(options.headers.Authorization).replace('Bearer ', ''));
            const out = who ? world.host.handle(who, 'POST', new URL(url).pathname, body) : null;
            return { ok: !!out && out.status === 200, status: out ? out.status : 404, json: async () => structuredClone(out.body) };
        },
        getUse: () => ({ used: 5, waiting: 0 }),
        // `lists`: Torn Bids' own page is open - only it takes lists.
        getWant: () => ({ sellers: [11], worth: { [KITTEN]: 500 }, lists: true }),
        onReads: () => {},
        now: () => world.t + 7 * MIN,
    });
    let ticked = world.t;
    rig.tickDue = async () => { while (world.t - ticked >= SHARED_TICK_MS) { ticked += SHARED_TICK_MS; await link.tick(); } };
    const pass = async (ms) => {
        const end = world.t + ms;
        while (world.t < end) {
            if (world.store.alarmAt !== null && world.store.alarmAt <= world.t) { world.store.alarmAt = null; await world.host.alarm(); }
            else { world.t += 1000; await rig.tickDue(); }
        }
    };
    const archive = (own) => world.host.handle('abe', 'POST', '/sync', { app: 'torn-archive', ver: '1.3.6', used: 3, waiting: 0, sellers: [], trades: [], looking: [], since: 0, seen: 0, going: [], bought: [], own });
    // The server learns whose each key is, Torn Bids syncs: nobody has said an own list yet.
    world.host.handle('abe', 'POST', '/sync', { used: 0 });
    // 3.32.0 - the server keeps one price list: the one from the key marked as its owner's own.
    assert.equal((await world.admin('POST', '/admin/keys/owner', { who: 'abe', on: true })).status, 200);
    await pass(3 * MIN);
    assert.ok(posts.some((b) => b.ownSince === 0), 'Torn Bids asks for own lists');
    assert.equal(values.has(SHARED_OWN_KEY) ? Object.keys(values.get(SHARED_OWN_KEY).lists).length : 0, 0);
    // His Torn Archive: open at first, then he closes - what he would pay if he opened - and his PC goes off.
    assert.equal(archive({ open: 1, prices: { [KITTEN]: 512, [SHEEP]: 614 }, off: [] }).status, 200);
    await pass(MIN);
    assert.equal(values.get(SHARED_OWN_KEY).lists[HIM].open, true);
    archive({ open: 0, prices: { [KITTEN]: 510, [SHEEP]: 612 }, off: [PANDA] });
    const closedAt = world.t + 7 * MIN;
    await pass(4 * HOUR);
    const held = values.get(SHARED_OWN_KEY);
    assert.deepEqual(held.lists[HIM].prices, { [KITTEN]: 510, [SHEEP]: 612 });
    assert.deepEqual([held.lists[HIM].open, held.lists[HIM].off], [false, [PANDA]]);
    assert.ok(Math.abs(held.lists[HIM].at - closedAt) < 2000, 'dated when the server heard it, in this PC\'s time');
    assert.ok(posts[posts.length - 1].ownSince === held.mark && held.mark > 0, 'the same list is not handed again');
    // Four hours on, on that PC: he buys the Kitten at his price, and the price is checked.
    const now = world.t + 7 * MIN;
    const said = saidLists(held, now);
    const db = emptyTraderDb();
    const row = buyersForItem(String(KITTEN), { db, w3bByItem: indexW3bByItem(db, now, said) })[0];
    assert.deepEqual([row.id, row.price], [HIM, 510]);
    const check = priceChecked(row, { itemId: String(KITTEN), said: said.get(HIM), now });
    assert.deepEqual([check.ok, check.why, check.closed], [true, 'said', true]);
    // 3.32.0 - his Torn Archive 1.3.10 says what a whole set is paid and how many he still takes; then he is away
    // over a day. The other tabs let his list lapse after a day - Flips > For him does not: his last word stands.
    archive({ open: 0, prices: { [KITTEN]: 510, [SHEEP]: 612 }, off: [PANDA], all: { [KITTEN]: 510, [SHEEP]: 612, [PANDA]: 700 }, sets: { plushie: 3, flower: 0 }, take: { [KITTEN]: 4, [SHEEP]: 2, [PANDA]: 0 } });
    await pass(26 * HOUR);
    const later = values.get(SHARED_OWN_KEY);
    const after = world.t + 7 * MIN;
    assert.equal(saidLists(later, after).size, 0, 'over a day unheard: no buyer row on the other tabs');
    const his = ownerList(later);
    assert.equal(his.id, HIM);
    assert.equal(his.name, WHO[KEY_ABE].name, 'his Torn name, as Torn gave it to the server');
    assert.deepEqual(his.all, { [KITTEN]: 510, [SHEEP]: 612, [PANDA]: 700 });
    assert.deepEqual(his.sets, { plushie: 3, flower: 0 });
    assert.deepEqual(his.take, { [KITTEN]: 4, [SHEEP]: 2, [PANDA]: 0 });
    assert.ok(after - his.at > 25 * HOUR);
});
