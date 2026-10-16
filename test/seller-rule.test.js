/*
 * 3.33.0 - the seller rule (engines plan 3c, the owner's rule): a bazaar's seller with more enemies than friends,
 * or more than "most enemies" (default 100), is never bought from. Their counts come from the server, which reads
 * them from Torn with the bazaar; the rule is the shared folder's (#engines/rules/seller-rule.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sharedTake, sharedIndex, sharedInterest, sharedReadBucket, sharedBucketOf } from '../src/core/shared.js';
import { sellerRowsKept } from '#engines/rules/seller-rule.js';
import { SELLING_PAGE_DEFAULTS } from '../src/ui/selling-page.js';

const newBuckets = () => Array.from({ length: 16 }, () => ({}));

test('the counts arrive with the bazaar, are kept with it, and judge its rows', () => {
    const buckets = newBuckets();
    const { interest, gen } = sharedInterest(new Map(), 0, [206]);
    sharedTake(buckets, { reads: [
        { id: 21, at: 1000, items: [{ id: 206, price: 800, qty: 3 }], fe: [500, 499] },
        { id: 22, at: 1000, items: [{ id: 206, price: 810, qty: 1 }], fe: [40, 2] },
        { id: 23, at: 1000, items: [{ id: 206, price: 820, qty: 1 }] },
    ] }, interest, gen, 2000);
    // A later read without counts (an older server) keeps the ones known.
    sharedTake(buckets, { reads: [{ id: 22, at: 3000, items: [{ id: 206, price: 805, qty: 1 }] }] }, interest, gen, 4000);
    const index = sharedIndex(buckets);
    assert.deepEqual(index.bySeller.get('21').counts, { friends: 500, enemies: 499 });
    assert.deepEqual(index.bySeller.get('22').counts, { friends: 40, enemies: 2 });
    assert.equal(index.bySeller.get('23').counts, null);
    // Stored and read back, the old four-part entries too.
    assert.deepEqual(sharedReadBucket(buckets[sharedBucketOf(21)])['21'], buckets[sharedBucketOf(21)][21]);
    assert.ok(sharedReadBucket({ 21: [1, 1, 1, []] })['21']);
    assert.equal(sharedReadBucket({ 21: [1, 1, 1, [], ['x', 2]] })['21'], undefined);

    const rows = [{ sellerId: '21', price: 800 }, { sellerId: '22', price: 805 }, { sellerId: '23', price: 820 }];
    const countsOf = (id) => (index.bySeller.get(String(id)) || {}).counts || null;
    const o = { mostEnemies: SELLING_PAGE_DEFAULTS.sellerMostEnemies, perFriend: SELLING_PAGE_DEFAULTS.sellerEnemiesPerFriend };
    assert.deepEqual(sellerRowsKept(rows, countsOf, o).rows.map((r) => r.sellerId), ['22', '23'], '499 enemies against 500 friends is out; not known yet is in');
    assert.deepEqual(sellerRowsKept(rows, countsOf, { ...o, mostEnemies: 1000 }).rows.map((r) => r.sellerId), ['21', '22', '23']);
});

test('wiring: one place - every bazaar row Torn Bids buys from (flips, trades, the owner\'s tab) passes the rule', () => {
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.ok(main.includes('() => sellerRowsKept(bazaarSellers(withOwnBuys('));
    assert.ok(main.includes('sellerRule.mostEnemies, sellerRule.perFriend, '));
    assert.equal(SELLING_PAGE_DEFAULTS.sellerMostEnemies, 100);
    assert.equal(SELLING_PAGE_DEFAULTS.sellerEnemiesPerFriend, 1);
    // The owner's tab buys from the same rows.
    assert.ok(main.includes('ownerLots({ bazaar: sellersOf('));
});
