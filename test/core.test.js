import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseMoney,
    parseQuantity,
    formatMoney,
    formatMoneyShort,
    formatPct,
} from '../src/core/parse.js';

import {
    VENUE_FEES,
    capQuantityByCash,
    computeOpportunity,
    bestVenue,
} from '../src/core/profit.js';

import { rankOpportunities, summarize } from '../src/core/ranker.js';

import {
    buildItemIndex,
    findItemByName,
    findItemById,
    normalizeItemName,
    makeItemsCacheEntry,
    isItemsCacheFresh,
    ITEMS_TTL_MS,
} from '../src/core/items.js';

import {
    buildNpcShopIndex,
    npcShopFor,
    isNpcSellable,
    npcExitPrice,
    makeNpcCacheEntry,
    readNpcCacheEntry,
} from '../src/core/npc.js';

import { detectPage, itemMarketUrl } from '../src/sources/route.js';

/* ---------------------------------------------------------------- parse */

test('parseMoney handles Torn price formats', () => {
    assert.equal(parseMoney('$2,896'), 2896);
    assert.equal(parseMoney('806000'), 806000);
    assert.equal(parseMoney('$1.2m'), 1200000);
    assert.equal(parseMoney('$1.5k'), 1500);
    assert.equal(parseMoney(''), null);
    assert.equal(parseMoney('no price here'), null);
    assert.equal(parseMoney(null), null);
});

test('parseQuantity reads the Torn quantity forms', () => {
    assert.equal(parseQuantity('x12'), 12);
    assert.equal(parseQuantity('12x'), 12);
    assert.equal(parseQuantity('400 available'), 400);
    assert.equal(parseQuantity('Qty: 3'), 3);
    assert.equal(parseQuantity('none'), null);
    assert.equal(parseQuantity(null), null);
});

test('formatters', () => {
    assert.equal(formatMoney(1234.6), '$1,235');
    assert.equal(formatMoney(-500), '-$500');
    assert.equal(formatMoneyShort(1200000), '$1.20m');
    assert.equal(formatMoneyShort(34000), '$34.0k');
    assert.equal(formatPct(0.042), '4.2%');
    assert.equal(formatPct(NaN), '-');
});

/* --------------------------------------------------------------- profit */

test('NPC route takes no fee', () => {
    const o = computeOpportunity({
        listingPrice: 2896,
        exitPrice: 3000,
        qty: 12,
        venue: 'NPC',
    });

    assert.equal(o.profitPerUnit, 104);
    assert.equal(o.totalProfit, 1248);
    assert.equal(o.qty, 12);
    assert.ok(Math.abs(o.roi - 104 / 2896) < 1e-12);
});

test('Item Market fee is applied to the exit price', () => {
    const o = computeOpportunity({
        listingPrice: 1000,
        exitPrice: 2000,
        venue: 'ITEM_MARKET',
    });

    // 2000 * 0.95 - 1000
    assert.equal(o.profitPerUnit, 900);
    assert.equal(o.fee, VENUE_FEES.ITEM_MARKET);
});

test('a listing above the fee-adjusted exit price is a loss, not a hit', () => {
    const o = computeOpportunity({
        listingPrice: 1950,
        exitPrice: 2000,
        venue: 'ITEM_MARKET',
    });

    assert.ok(o.profitPerUnit < 0);
});

test('cash on hand caps realizable profit', () => {
    const o = computeOpportunity({
        listingPrice: 1000,
        exitPrice: 1500,
        qty: 100,
        venue: 'NPC',
        cashOnHand: 5000,
    });

    assert.equal(o.qty, 100);
    assert.equal(o.affordableQty, 5);
    assert.equal(o.totalProfit, 50000);
    assert.equal(o.realizableProfit, 2500);
    assert.equal(o.cashRequired, 5000);
});

test('capQuantityByCash edge cases', () => {
    assert.equal(capQuantityByCash(10, 100, null), 10);
    assert.equal(capQuantityByCash(10, 100, 0), 10);
    assert.equal(capQuantityByCash(10, 100, 50), 0);
    assert.equal(capQuantityByCash(0, 100, 1000), 0);
});

test('computeOpportunity rejects unusable input instead of guessing', () => {
    assert.equal(computeOpportunity({ listingPrice: 0, exitPrice: 10 }), null);
    assert.equal(computeOpportunity({ listingPrice: 10, exitPrice: 0 }), null);
    assert.equal(
        computeOpportunity({ listingPrice: 10, exitPrice: 20, venue: 'NOPE' }),
        null,
    );
});

test('bestVenue picks the highest realizable profit after fees', () => {
    const best = bestVenue({
        listingPrice: 1000,
        qty: 1,
        exits: {
            NPC: 1100,
            ITEM_MARKET: 1200,
            AUCTION_HOUSE: 1150,
        },
    });

    // NPC 100 | market 1200*.95-1000 = 140 | auction 1150*.97-1000 = 115.5
    assert.equal(best.venue, 'ITEM_MARKET');
    assert.ok(Math.abs(best.profitPerUnit - 140) < 1e-9);
});

/* --------------------------------------------------------------- ranker */

function row(name, realizable, roi, opts = {}) {
    return {
        name,
        npcVerified: opts.npcVerified !== false,
        profit: {
            realizableProfit: realizable,
            cashRequired: opts.cashRequired || 0,
            roi,
        },
    };
}

test('ranking is by realizable profit, not per-unit or percent', () => {
    const ranked = rankOpportunities(
        [
            row('small but juicy', 1248, 0.9),
            row('big', 102000, 0.042),
        ],
        { minTotalProfit: 0 },
    );

    assert.deepEqual(
        ranked.map((r) => r.name),
        ['big', 'small but juicy'],
    );
});

test('threshold filters, and unverified NPC rows are hidden by default', () => {
    const rows = [
        row('kept', 5000, 0.1),
        row('too small', 10, 0.5),
        row('unverified', 999999, 0.5, { npcVerified: false }),
    ];

    const ranked = rankOpportunities(rows, { minTotalProfit: 1000 });
    assert.deepEqual(
        ranked.map((r) => r.name),
        ['kept'],
    );

    const withUnverified = rankOpportunities(rows, {
        minTotalProfit: 1000,
        includeUnverifiedNpc: true,
    });
    assert.deepEqual(
        withUnverified.map((r) => r.name),
        ['unverified', 'kept'],
    );
});

test('ties break on ROI', () => {
    const ranked = rankOpportunities(
        [row('low roi', 1000, 0.01), row('high roi', 1000, 0.5)],
        { minTotalProfit: 0 },
    );

    assert.equal(ranked[0].name, 'high roi');
});

test('summarize totals the ranked rows', () => {
    const s = summarize([
        row('a', 1000, 0.1, { cashRequired: 100 }),
        row('b', 2000, 0.1, { cashRequired: 200 }),
    ]);

    assert.deepEqual(s, { count: 2, totalProfit: 3000, cashRequired: 300 });
});

/* ---------------------------------------------------------------- items */

const RAW_ITEMS = {
    206: { name: 'Xanax', sell_price: 540, market_value: 800000, type: 'Drug' },
    218: { name: 'Small First Aid Kit', sell_price: 150, type: 'Medical' },
    1: { name: 'Hammer', sell_price: 10, type: 'Melee' },
    999: { sell_price: 5 },
};

test('the item index is built once and looked up by Map', () => {
    const index = buildItemIndex(RAW_ITEMS);

    assert.equal(index.size, 3); // the nameless entry is dropped
    assert.equal(findItemByName(index, 'xanax').id, '206');
    assert.equal(findItemByName(index, '  XANAX  ').id, '206');
    assert.equal(findItemById(index, 218).name, 'Small First Aid Kit');
    assert.equal(findItemByName(index, 'Xanax Pills'), null);
});

test('normalizeItemName collapses whitespace and case', () => {
    assert.equal(normalizeItemName('  Small   First Aid Kit '), 'small first aid kit');
    assert.equal(normalizeItemName(null), '');
});

test('item cache respects version and TTL', () => {
    const now = 1_000_000_000_000;
    const entry = makeItemsCacheEntry(RAW_ITEMS, now);

    assert.equal(isItemsCacheFresh(entry, now), true);
    assert.equal(isItemsCacheFresh(entry, now + ITEMS_TTL_MS + 1), false);
    assert.equal(isItemsCacheFresh({ ...entry, version: 'old' }, now), false);
    assert.equal(isItemsCacheFresh(null, now), false);
});

/* ------------------------------------------------------------------ npc */

const RAW_SHOPS = {
    1: {
        name: "Bits 'n' Bobs",
        inventory: { 1: { name: 'Hammer', price: 15 } },
    },
    2: { name: 'Pharmacy', inventory: { 218: { name: 'SFAK', price: 200 } } },
    3: { name: 'Broken', inventory: null },
};

test('the NPC index keeps which shop stocks each item and what it charges', () => {
    const index = buildNpcShopIndex(RAW_SHOPS);

    assert.equal(index.get('1').shopName, "Bits 'n' Bobs");
    assert.equal(index.get('1').shopPrice, 15);
    assert.equal(index.get('218').shopName, 'Pharmacy');
    assert.equal(index.has('206'), false);
});

test('an unrecognised shops payload yields an empty index, not a crash', () => {
    assert.equal(buildNpcShopIndex(null).size, 0);
    assert.equal(buildNpcShopIndex({ 1: 'nonsense' }).size, 0);
    assert.equal(buildNpcShopIndex({ 1: { inventory: [] } }).size, 0);
});

test('an array-shaped inventory is handled too', () => {
    const index = buildNpcShopIndex({
        7: { name: 'Docks', inventory: [{ ID: 42, price: 9 }] },
    });

    assert.equal(index.get('42').shopName, 'Docks');
});

test('npcShopFor names the shop, and manual overrides win both ways', () => {
    const index = buildNpcShopIndex(RAW_SHOPS);

    assert.equal(npcShopFor(1, index).shopName, "Bits 'n' Bobs");
    assert.equal(npcShopFor(206, index), null);

    // User says yes to something the shop data does not cover.
    assert.equal(npcShopFor(206, index, { 206: true }).manual, true);

    // User says no to something the shop data does cover.
    assert.equal(npcShopFor(1, index, { 1: false }), null);

    // User supplies the shop themselves.
    assert.equal(
        npcShopFor(206, index, { 206: { shopName: 'Pharmacy' } }).shopName,
        'Pharmacy',
    );
});

test('isNpcSellable still answers the yes/no question', () => {
    const index = buildNpcShopIndex(RAW_SHOPS);

    assert.equal(isNpcSellable(1, index), true);
    assert.equal(isNpcSellable(206, index), false);
});

test('the NPC index survives a cache round trip', () => {
    const index = buildNpcShopIndex(RAW_SHOPS);
    const restored = readNpcCacheEntry(makeNpcCacheEntry(index));

    assert.equal(restored.size, index.size);
    assert.equal(restored.get('218').shopName, 'Pharmacy');
});

test('npcExitPrice never falls back to market value', () => {
    const index = buildItemIndex(RAW_ITEMS);

    assert.equal(npcExitPrice(findItemById(index, 206)), 540);
    assert.equal(npcExitPrice({ sellPrice: 0, marketValue: 999 }), null);
    assert.equal(npcExitPrice(null), null);
});

/* ---------------------------------------------------------------- route */

test('exactly one page type is detected, and unrelated pages get none', () => {
    assert.equal(detectPage('https://www.torn.com/bazaar.php'), 'bazaar');
    assert.equal(
        detectPage('https://www.torn.com/bazaar.php?userId=1234'),
        'bazaar',
    );
    assert.equal(
        detectPage('https://www.torn.com/index.php?page=bazaar&userId=1'),
        'bazaar',
    );
    assert.equal(
        detectPage('https://www.torn.com/page.php?sid=ItemMarket'),
        'itemmarket',
    );
    assert.equal(detectPage('https://www.torn.com/imarket.php#/'), 'itemmarket');

    // V1 lit up on all of these.
    assert.equal(detectPage('https://www.torn.com/item.php'), null);
    assert.equal(detectPage('https://www.torn.com/shops.php?step=bitsnbobs'), null);
    assert.equal(detectPage('https://www.torn.com/'), null);
    assert.equal(detectPage(''), null);
});

test('itemMarketUrl encodes the item safely', () => {
    const url = itemMarketUrl(206, 'Xanax');
    assert.ok(url.startsWith('https://www.torn.com/page.php?sid=ItemMarket#/'));
    assert.ok(url.includes('itemID=206'));
    assert.ok(url.includes('itemName=Xanax'));
});

/* ------------------------------------------- regressions (Fable review) */

test('a trailing letter is not a magnitude suffix', () => {
    // "$2,896 Buy" collapsed to "2896Buy"; the B was read as billions.
    assert.equal(parseMoney('$2,896 Buy'), null);
    assert.equal(parseMoney('$3,000 min'), null);
    assert.equal(parseMoney('$500 market'), null);

    // Real suffixes still work.
    assert.equal(parseMoney('$1.2m'), 1200000);
    assert.equal(parseMoney('$2,896'), 2896);
});

test('a price is never mistaken for a quantity', () => {
    // A price cell whose class contained "amount" became the quantity:
    // parseQuantity('$2,896') returned 2896, inflating total profit ~3000x.
    assert.equal(parseQuantity('$2,896'), null);
    assert.equal(parseQuantity('$540'), null);

    // Genuine quantity cells still read correctly.
    assert.equal(parseQuantity('12 available'), 12);
    assert.equal(parseQuantity('Available: 12'), 12);
    assert.equal(parseQuantity('x12'), 12);

    /*
     * React concatenates sibling text with no separator, so a whole row reads
     * "$2,89612 available". That string is genuinely ambiguous and this
     * function does not pretend otherwise - scan.js reads leaf elements
     * individually so it never has to ask.
     */
    assert.equal(parseQuantity('$2,89612 available'), null);
});

test('rows with a guessed price are excluded from the ranking', () => {
    const rows = [
        { ...row('solid', 5000, 0.1), priceAssumed: false },
        { ...row('guessed', 999999, 9.9), priceAssumed: true },
    ];

    assert.deepEqual(
        rankOpportunities(rows, { minTotalProfit: 0 }).map((r) => r.name),
        ['solid'],
    );

    assert.equal(
        rankOpportunities(rows, {
            minTotalProfit: 0,
            includeAssumedPrice: true,
        }).length,
        2,
    );
});
