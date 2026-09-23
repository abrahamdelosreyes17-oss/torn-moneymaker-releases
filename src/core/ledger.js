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

export const LEDGER_VERSION = 'ledger-v1';

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

function entryFrom(row, now) {
    return {
        itemId: String(row.itemId),
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
        seenAt: now,
    };
}

/**
 * Fold this page's opportunities into the ledger.
 *
 * A cheaper sighting of the same item always replaces the old one - that is
 * the thing worth knowing. An equal-or-worse price still refreshes `seenAt`,
 * because it confirms the item is still listed around that level.
 *
 * @param {Map<string, object>} ledger
 * @param {Array<object>} rows - ranked rows carrying `profit`
 * @returns {Map<string, object>} the same map, mutated
 */
export function recordSightings(ledger, rows, now = Date.now()) {
    for (const row of rows || []) {
        if (!row || !row.profit || !row.itemId) continue;

        const id = String(row.itemId);
        const existing = ledger.get(id);

        if (!existing || row.profit.listingPrice < existing.listingPrice) {
            ledger.set(id, entryFrom(row, now));
        } else {
            existing.seenAt = now;
        }
    }

    return ledger;
}

/** Drop expired entries, and trim to the most profitable if oversized. */
export function pruneLedger(ledger, now = Date.now(), ttl = LEDGER_TTL_MS) {
    for (const [id, entry] of ledger) {
        if (now - entry.seenAt > ttl) ledger.delete(id);
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
        if (now - entry.seenAt > LEDGER_TTL_MS) continue;

        ledger.set(String(entry.itemId), entry);
    }

    return ledger;
}
