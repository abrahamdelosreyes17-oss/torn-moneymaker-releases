/*
 * What we have seen across the whole Item Market, not just this page.
 *
 * Pure - no DOM, no network, no storage. main.js persists it.
 *
 * The scanner can only read the page you are looking at; that is the rule and
 * it is not negotiable. But nothing stops us REMEMBERING what we read. Click
 * through the categories once and the ledger holds the whole market, built
 * entirely from pages you loaded yourself.
 *
 * One entry per item, keeping the best opportunity seen for it. Entries
 * expire, because a price from an hour ago is a rumour rather than a listing.
 */

export const LEDGER_VERSION = 'ledger-v2';

/**
 * After this an entry is dropped: the listing has probably gone.
 *
 * Ten minutes, not thirty. Torn's market turns over fast - a cheap listing is
 * usually taken within minutes - and a remembered row that no longer exists
 * is worse than no row at all.
 */
export const LEDGER_TTL_MS = 10 * 60 * 1000;

/** Keep the ledger bounded regardless of how long someone browses. */
export const LEDGER_MAX_ENTRIES = 400;

/*
 * `row.seenAt` is when the PAGE showed this listing - the first time this
 * exact price was read since the page loaded - not when the DOM was last
 * re-read. The 2.5s poll re-reads a page that is not changing; stamping each
 * re-read "now" made a twenty-minute-old price look brand new, so nothing
 * ever expired and sold listings stayed linked.
 */
function entryFrom(row, now) {
    const seenAt = Number.isFinite(row.seenAt) ? row.seenAt : now;

    return {
        itemId: String(row.itemId),
        source: row.source || null,
        // Bazaar sightings remember whose bazaar, so the link goes back there
        // rather than to an Item Market page where that price never existed.
        sellerId: row.sellerId ? String(row.sellerId) : null,
        npcVerified: row.npcVerified !== false,
        name: row.name,
        listingPrice: row.profit.listingPrice,
        exitPrice: row.profit.exitPrice,
        venue: row.profit.venue,
        profitPerUnit: row.profit.profitPerUnit,
        roi: row.profit.roi,
        qty: row.profit.qty,
        qtyAtPrice: Boolean(row.qtyAtPrice),
        marketTotal: row.marketTotal || null,
        totalProfit: row.profit.totalProfit,
        realizableProfit: row.profit.realizableProfit,
        cashRequired: row.profit.cashRequired,
        npcShop: row.npcShop || null,
        seenAt,
    };
}

/**
 * Fold this page's opportunities into the ledger.
 *
 * The NEWEST sighting always wins, even when it is worse.
 *
 * Keeping the cheapest price seen was wrong, and badly so: when an item rose
 * from $2,900 to $3,100 the ledger kept the $2,900 entry AND refreshed its
 * timestamp, so a listing that had already sold looked permanently fresh and
 * kept offering a link to a trade that no longer existed. In a live market
 * the current price is the only true one.
 *
 * `seenOnPage` is every item id the page showed, profitable or not. Anything
 * in that set without a current opportunity is removed, so revisiting a page
 * actively corrects the ledger instead of only adding to it.
 *
 * @param {Map<string, object>} ledger
 * @param {Array<object>} rows - ranked rows carrying `profit`
 * @param {Set<string>} [seenOnPage] - all item ids present on the page
 * @returns {Map<string, object>} the same map, mutated
 */
export function recordSightings(ledger, rows, now = Date.now(), seenOnPage) {
    const stillGood = new Set();

    for (const row of rows || []) {
        if (!row || !row.profit || !row.itemId) continue;

        const id = String(row.itemId);
        stillGood.add(id);
        ledger.set(id, entryFrom(row, now));
    }

    // Seen on this page, but no longer an opportunity: forget it.
    if (seenOnPage) {
        for (const id of seenOnPage) {
            const key = String(id);
            if (!stillGood.has(key)) ledger.delete(key);
        }
    }

    return ledger;
}

/** Drop expired entries, and trim to the most profitable if oversized. */
export function pruneLedger(ledger, now = Date.now(), ttl = LEDGER_TTL_MS) {
    for (const [id, entry] of ledger) {
        // A missing time is not "forever fresh"; NaN > ttl is false.
        if (!Number.isFinite(entry.seenAt) || now - entry.seenAt > ttl) {
            ledger.delete(id);
        }
    }

    if (ledger.size > LEDGER_MAX_ENTRIES) {
        const kept = [...ledger.values()]
            .sort((a, b) => b.realizableProfit - a.realizableProfit)
            .slice(0, LEDGER_MAX_ENTRIES);

        ledger.clear();
        for (const entry of kept) ledger.set(entry.itemId, entry);
    }

    return ledger;
}

/**
 * The ledger as rows the panel and ranker understand.
 *
 * These carry no `el`, because the listing is not on the page you are looking
 * at - the panel's action navigates to the item instead of scrolling to it.
 */
export function ledgerRows(ledger) {
    return [...ledger.values()].map((entry) => ({
        itemId: entry.itemId,
        name: entry.name,
        el: null,
        fromLedger: true,
        source: entry.source || null,
        sellerId: entry.sellerId || null,
        npcVerified: entry.npcVerified !== false,
        seenAt: entry.seenAt,
        qtyAtPrice: entry.qtyAtPrice,
        marketTotal: entry.marketTotal,
        npcShop: entry.npcShop,
        profit: {
            venue: entry.venue,
            listingPrice: entry.listingPrice,
            exitPrice: entry.exitPrice,
            profitPerUnit: entry.profitPerUnit,
            roi: entry.roi,
            qty: entry.qty,
            affordableQty: entry.qty,
            totalProfit: entry.totalProfit,
            realizableProfit: entry.realizableProfit,
            cashRequired: entry.cashRequired,
        },
    }));
}

export function makeLedgerCacheEntry(ledger, now = Date.now()) {
    return {
        version: LEDGER_VERSION,
        savedAt: now,
        entries: [...ledger.values()],
    };
}

export function readLedgerCacheEntry(cached, now = Date.now()) {
    const ledger = new Map();

    if (!cached || cached.version !== LEDGER_VERSION) return ledger;

    for (const entry of cached.entries || []) {
        if (!entry || !entry.itemId) continue;
        if (!Number.isFinite(entry.seenAt)) continue;
        if (now - entry.seenAt > LEDGER_TTL_MS) continue;

        ledger.set(String(entry.itemId), entry);
    }

    return ledger;
}
