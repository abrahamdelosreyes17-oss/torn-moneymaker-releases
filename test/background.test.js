/*
 * 3.14: Torn Bids keeps TornExchange and TornW3B going in the background (a
 * few TornW3B reads a minute), and Chat marks the trader's chat button on
 * their Torn profile (core/desk.js, sources/route.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { backgroundSlot, W3B_HIDDEN_PER_MIN } from '../src/core/desk.js';
import { profileIdOf } from '../src/sources/route.js';

test('in the background, a few TornW3B reads a minute - never the in-view pace', () => {
    const now = 1_000_000;
    const recent = Array.from({ length: W3B_HIDDEN_PER_MIN }, (_, i) => now - i * 1000);
    assert.equal(backgroundSlot(recent, now), false, 'the minute is full');
    assert.equal(backgroundSlot(recent.slice(1), now), true);
    assert.equal(backgroundSlot(recent, now + 60000), true, 'a minute later: room again');
    assert.equal(backgroundSlot(null, now), true);
    assert.ok(W3B_HIDDEN_PER_MIN < 60, 'below the in-view 60 a minute (3.15: 24 before)');
});

import { nextW3bRead } from '../src/core/desk.js';

test('hidden, all 30 possible flips are checked within two minutes, even with once-a-minute timers', () => {
    // The owner's page (3.14.1): hidden five minutes, 3 of 30 flips checked,
    // while 2,482 traders' price lists took every other read.
    const candidates = Array.from({ length: 30 }, (_, i) => 'c' + i);
    const read = new Set();
    let lists = 0;
    let turn = 0;
    const recent = [];
    let t = 0;
    // Chrome runs a hidden tab's timers about once a minute; each tick starts
    // reads one after another (each ~1 s) while the minute has room.
    for (let tick = 0; tick < 2; tick++) {
        t = tick * 60000;
        for (;;) {
            if (!backgroundSlot(recent.filter((x) => t - x < 60000), t)) break;
            turn ^= 1;
            const r = nextW3bRead({ candidates, list: 'L' + lists, turn, hidden: true, due: (id) => !read.has(id) });
            if (!r) break;
            if (r.kind === 'list') lists++;
            else read.add(r.id);
            recent.push(t);
            t += 1000;
        }
    }
    assert.equal(read.size, 30, 'every possible flip checked');
    // The lists wait while flips are due, then go on.
    assert.ok(lists > 0, 'price lists still read once the flips are done');
    // In view nothing changes: flips and lists take turns.
    assert.deepEqual(nextW3bRead({ candidates: ['c1'], list: 'L1', turn: 0, due: () => true }), { kind: 'list', id: 'L1' });
});

import { backgroundListSlot } from '../src/core/desk.js';

test('a page that loads hidden: price lists never take the minute the flips need', () => {
    // The harness (3.14.2 and the first fix): the flips are not known for a
    // few seconds, the lists took all of the minute's reads, and the flips
    // found 5 s later waited for the next minute.
    const candidates = Array.from({ length: 30 }, (_, i) => 'c' + i);
    const read = new Map();
    const recent = [];
    const lists = [];
    let listNo = 0;
    let turn = 0;
    // Timers of a freshly hidden page: every 2.5 s; each read ~0.2 s.
    for (let tick = 0; tick * 2500 <= 120000; tick++) {
        let t = tick * 2500;
        for (;;) {
            if (!backgroundSlot(recent.filter((x) => t - x < 60000), t)) break;
            const known = t >= 5000 ? candidates : [];
            const listRoom = backgroundListSlot(lists.filter((x) => t - x < 60000), t);
            turn ^= 1;
            const r = nextW3bRead({ candidates: known, list: listRoom ? 'L' + listNo : null, turn, hidden: true, due: (id) => !read.has(id) });
            if (!r) break;
            if (r.kind === 'list') {
                listNo++;
                lists.push(t);
            } else read.set(r.id, t);
            recent.push(t);
            t += 200;
        }
    }
    assert.equal(read.size, 30);
    const last = Math.max(...read.values());
    assert.ok(last <= 75000, 'all 30 checked by 75 s, not two minutes later: ' + last);
    assert.ok(listNo > 0, 'the lists still move');
});

import { flipsStale } from '../src/core/desk.js';

test('hidden, a new bazaar summary gets the possible flips worked out at once', () => {
    assert.equal(flipsStale(5000, 0), true, 'loaded hidden: no flips worked out yet');
    assert.equal(flipsStale(5000, 4000), true, 'a newer summary');
    assert.equal(flipsStale(5000, 6000), false, 'already worked out from it');
    assert.equal(flipsStale(0, 0), false, 'no summary yet: nothing to work out');
});

test('the profile Chat leads to: its player id, from Torn or the harness', () => {
    assert.equal(profileIdOf('https://www.torn.com/profiles.php?XID=2640214'), '2640214');
    assert.equal(profileIdOf('https://www.torn.com/profiles.php?XID=2640214#/'), '2640214');
    assert.equal(profileIdOf('http://127.0.0.1:8765/test/harness-live.html?page=profile&XID=5001'), '5001');
    assert.equal(profileIdOf('https://www.torn.com/trade.php#step=start&userID=5'), null);
    assert.equal(profileIdOf('https://www.torn.com/profiles.php'), null);
});

import { fillNote } from '../src/core/accepted.js';

test('Fill on the trade page never fails silently: one line says what it did, or why not', () => {
    assert.match(fillNote({ accepted: [] }).text, /no trade accepted/);
    assert.match(fillNote({ accepted: ['KayMalta'], partner: 'NoChance17' }).text, /with NoChance17; you accepted KayMalta/);
    assert.match(fillNote({ accepted: ['A', 'B'] }).text, /which trade/);
    assert.match(fillNote({ accepted: ['A'], trader: 'A', toSend: 0 }).text, /nothing recorded as bought/);
    assert.match(fillNote({ accepted: ['A'], trader: 'A', toSend: 2, marked: 0 }).text, /none of A's items/);
    const ok = fillNote({ accepted: ['A'], trader: 'A', toSend: 2, marked: 2 });
    assert.equal(ok.ok, true);
    assert.equal(ok.text, 'Fill for A: 2 items marked');
    // An item to send with no row here is named, never silently missed.
    const miss = fillNote({ accepted: ['A'], trader: 'A', toSend: 2, marked: 1, missing: ['Stick of Dynamite'] });
    assert.equal(miss.ok, false);
    assert.equal(miss.text, 'Fill for A: 1 item marked · not in this list: Stick of Dynamite');
});

import { declineKey, declinedOn } from '../src/core/desk.js';

test('declining one trade is that trade only: the same trader stays on other items', () => {
    const declined = new Map([[declineKey('870', 'id:5001'), 5000], ['id:11', 9000]]);
    assert.deepEqual([...declinedOn(declined, '870')], [['id:5001', 5000]], 'Stealth Virus with KayMalta: passed over');
    assert.equal(declinedOn(declined, '1006').size, 0, 'Dahlia with KayMalta: still a trade');
    assert.equal(declinedOn(declined, '206').size, 0, 'an old per-trader entry counts for nothing');
});

import { neverFlipOtherOnce } from '../src/core/items.js';

test('"Other" joins Never flip once: saved choices kept, and a later removal sticks', () => {
    const saved = { neverFlip: ['Clothing', 'Jewelry'], trustedOnly: true };
    const once = neverFlipOtherOnce(saved);
    assert.deepEqual(once.neverFlip, ['Clothing', 'Jewelry', 'Other']);
    assert.equal(once.trustedOnly, true);
    assert.deepEqual(neverFlipOtherOnce({}).neverFlip, ['Clothing', 'Other'], 'nothing saved: the default');
    // You took Other off again: not added back.
    assert.equal(neverFlipOtherOnce({ ...once, neverFlip: ['Clothing'] }), null);
});

import { freshMinutes, freshnessMs, keepsUp, FRESH_DEFAULTS } from '../src/core/desk.js';

test('bazaar prices: whole minutes from 1 to 10, else the default', () => {
    assert.equal(freshMinutes(3, 2), 3);
    assert.equal(freshMinutes('7', 2), 7);
    assert.equal(freshMinutes(0, 2), 2);
    assert.equal(freshMinutes(11, 2), 2);
    assert.equal(freshMinutes(null, 10), 10);
    assert.equal(freshMinutes('x', 1), 1);
    assert.deepEqual(freshnessMs({}), { desk: 60000, top: 120000, other: 600000 });
    assert.deepEqual(freshnessMs({ freshDeskMin: 2, freshTopMin: 5, freshOtherMin: 1 }), { desk: 120000, top: 300000, other: 60000 });
    assert.deepEqual(FRESH_DEFAULTS, { desk: 1, top: 2, other: 10 });
});

test('bazaar prices: the defaults keep up; too fast says how often the other flips are read', () => {
    const counts = { desk: 10, top: 20, other: 130 };
    const ok = keepsUp({ desk: 1, top: 2, other: 10 }, counts, 60);
    assert.equal(ok.ok, true);
    assert.equal(Math.round(ok.want), 33);
    const behind = keepsUp({ desk: 1, top: 1, other: 1 }, counts, 60);
    assert.equal(behind.ok, false);
    assert.equal(behind.otherEvery, Math.ceil(130 / 15));
    const none = keepsUp({ desk: 1, top: 1, other: 1 }, { desk: 30, top: 20, other: 130 }, 60);
    assert.equal(none.otherEvery, null);
});
