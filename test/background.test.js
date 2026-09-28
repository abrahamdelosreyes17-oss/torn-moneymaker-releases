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
