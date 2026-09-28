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
    const recent = Array.from({ length: W3B_HIDDEN_PER_MIN }, (_, i) => now - i * 5000);
    assert.equal(backgroundSlot(recent, now), false, 'the minute is full');
    assert.equal(backgroundSlot(recent.slice(1), now), true);
    assert.equal(backgroundSlot(recent, now + 60000), true, 'a minute later: room again');
    assert.equal(backgroundSlot(null, now), true);
    assert.ok(W3B_HIDDEN_PER_MIN < 24, 'below the in-view 24 a minute');
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
    assert.equal(ok.text, 'Fill for A: 2 rows marked');
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
