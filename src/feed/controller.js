/*
 * Runs the live feed: decides whether this tab leads, and if it does, polls
 * TornW3B and the Torn API within budget and stores what it finds.
 *
 * Everything userscript-specific is injected (storage, clients, visibility),
 * so this is testable under node with fakes.
 *
 * Storage is the source of truth, not this object's memory. Every change is
 * load -> mutate -> save in one synchronous step, because a follower tab also
 * writes the feed (when the page it is viewing proves a row sold). Holding a
 * private copy and saving it later would silently undo that correction.
 *
 * What this never does, by design (see README "Rules compliance"):
 *   - request a torn.com page; only api.torn.com (Torn client) and
 *     weav3r.dev (W3B client, which never holds the key)
 *   - run while the tab is hidden, or raise any alert/notification
 *   - buy, click, or pre-fill anything
 */

import {
    expireFeed,
    exitsFor,
    selectCandidates,
    normalizeW3bListings,
    normalizeItemMarketRows,
    setBazaarSnapshot,
    setItemMarketSnapshot,
    bazaarDue,
    itemMarketDue,
    itemMarketSweepList,
    itemMarketLiveIds,
    REFRESH_MS,
    makeFeedCacheEntry,
    readFeedCacheEntry,
} from '../core/feed.js';
import { decideLeader } from '../core/leader.js';
import { fetchW3bSummary, fetchW3bListings } from '../api/w3b.js';
import { fetchItemMarket } from '../api/torn.js';
import { bestVenue } from '../core/profit.js';

/** TornW3B's one-call summary: re-read on every 30s refresh. */
export const SUMMARY_INTERVAL_MS = REFRESH_MS;

/**
 * Torn API requests the feed may spend per minute. Torn allows 100/min per
 * user across EVERY tool; this leaves most of it for TornTools, TornStats,
 * and the page scanner.
 */
export const FEED_TORN_PER_MINUTE = 30;

/** Per tick, so one cycle stays short and reacts to the tab being hidden. */
export const MAX_W3B_FETCHES_PER_CYCLE = 8;
export const MAX_TORN_FETCHES_PER_CYCLE = 2;

/** How many TornW3B candidates also get an Item Market check, and how often. */
export const CANDIDATE_MARKET_CHECKS = 5;
export const CANDIDATE_MARKET_INTERVAL_MS = 2 * 60 * 1000;

/**
 * A live Item Market row is re-checked before it can expire: once its data
 * is this old it goes ahead of discovery. Younger rows are re-checked only
 * with spare budget. Torn serves the same snapshot for 30s anyway.
 */
export const LIVE_ROW_URGENT_MS = 55 * 1000;

export const FEED_STORE_KEY = 'feed';
export const FEED_LEADER_KEY = 'feedLeader';
export const FEED_RECHECK_KEY = 'feedRecheck';

/** Set by Scan in any tab: the leader rebuilds everything at once. */
export const FEED_REFRESH_KEY = 'feedRefreshAt';

export class LiveFeed {
    /**
     * @param {object} deps
     * @param {string} deps.tabId
     * @param {object} deps.w3b          - W3bClient
     * @param {object} deps.torn         - TornApiClient
     * @param {function} deps.getIndex   - () => item index | null
     * @param {function} deps.getSettings
     * @param {function} deps.hasUsableKey
     * @param {function} deps.isVisible
     * @param {function} deps.load       - (key) => value
     * @param {function} deps.save       - (key, value) => void
     * @param {function} [deps.onChange] - feed changed
     * @param {function} [deps.isKeyDead] - (error) => boolean
     * @param {function} [deps.onKeyDead] - (error) => void
     * @param {function} [deps.now]
     * @param {function} [deps.onSummary] - (summary, now) => void, each TornW3B summary
     */
    constructor(deps) {
        this.d = deps;
        this.now = deps.now || (() => Date.now());

        this.leading = false;
        this.busy = false;
        this.lastSummaryAt = 0;
        this.candidates = [];
        this.sweep = [];
        this.sweepPos = 0;
        this.tornSpent = [];
        this.lastError = null;
        this.lastCycleAt = null;
        this.lastRefreshSeen = 0;
        this.cycleCount = 0;
        /** itemId -> when its "cheaper on the market too?" check last ran. */
        this.candidateCheckedAt = new Map();
    }

    /**
     * Scan: throw away everything and rebuild from fresh data now. Works from
     * any tab - the flag is shared, and whichever tab leads acts on it.
     */
    requestRefresh() {
        this.d.save(FEED_STORE_KEY, null);
        this.d.save(FEED_REFRESH_KEY, this.now());
        if (this.d.onChange) this.d.onChange();
    }

    /* ------------------------------------------------------ storage */

    readFeed() {
        return readFeedCacheEntry(this.d.load(FEED_STORE_KEY), this.now());
    }

    /** Load, mutate, save - in one synchronous step. */
    mutate(fn) {
        const feed = this.readFeed();
        fn(feed);
        this.d.save(FEED_STORE_KEY, makeFeedCacheEntry(feed, this.now()));
        if (this.d.onChange) this.d.onChange();
        return feed;
    }

    /** Ask the leader (whichever tab it is) to re-verify these items first. */
    requestRecheck(itemIds) {
        const queue = new Set(this.d.load(FEED_RECHECK_KEY) || []);
        for (const id of itemIds || []) queue.add(String(id));
        this.d.save(FEED_RECHECK_KEY, [...queue].slice(-50));
    }

    takeRechecks() {
        const queue = this.d.load(FEED_RECHECK_KEY) || [];
        if (queue.length) this.d.save(FEED_RECHECK_KEY, []);
        return queue.map(String);
    }

    /* ------------------------------------------------------- status */

    status() {
        const s = this.d.getSettings();
        return {
            enabled: Boolean(s.liveFeed),
            w3b: Boolean(s.liveFeed && s.useW3b),
            itemMarket: Boolean(s.liveFeed && this.d.hasUsableKey()),
            leading: this.leading,
            candidates: this.candidates.length,
            nextRefreshAt: this.lastSummaryAt ? this.lastSummaryAt + SUMMARY_INTERVAL_MS : null,
            lastCycleAt: this.lastCycleAt,
            lastError: this.lastError,
        };
    }

    /* --------------------------------------------------------- tick */

    /**
     * Called on a timer by every tab. Cheap when not leading.
     * @returns {Promise<void>}
     */
    async tick() {
        const settings = this.d.getSettings();
        const now = this.now();
        const visible = this.d.isVisible();

        const record = this.d.load(FEED_LEADER_KEY);

        if (!settings.liveFeed) {
            if (record && record.id === this.d.tabId) {
                this.d.save(FEED_LEADER_KEY, { id: null, ts: 0 });
            }
            this.leading = false;
            return;
        }

        const decision = decideLeader(record, this.d.tabId, { now, visible });
        if (decision.write) this.d.save(FEED_LEADER_KEY, decision.write);
        this.leading = decision.lead;

        if (!decision.confirmed || this.busy) return;
        if (!this.d.getIndex()) return;

        this.busy = true;
        try {
            await this.cycle();
            this.lastCycleAt = this.now();
        } finally {
            this.busy = false;
        }
    }

    /** Stop as soon as the tab is hidden or the user switches the feed off. */
    stillAllowed() {
        return this.d.isVisible() && Boolean(this.d.getSettings().liveFeed);
    }

    async cycle() {
        const settings = this.d.getSettings();
        const index = this.d.getIndex();

        this.mutate((feed) => expireFeed(feed, this.now()));

        const refreshAt = Number(this.d.load(FEED_REFRESH_KEY)) || 0;
        if (refreshAt > this.lastRefreshSeen) {
            this.lastRefreshSeen = refreshAt;
            this.lastSummaryAt = 0;
        }

        const rechecks = this.takeRechecks();

        if (settings.useW3b) {
            await this.refreshSummary(index, settings);
            await this.refreshBazaars(rechecks);
        } else {
            this.candidates = [];
            // Opted out: forget what TornW3B told us.
            this.mutate((feed) => feed.bazaar.clear());
        }

        if (this.d.hasUsableKey()) {
            // Rebuilt when what counts as an exit changes (a chip), not just once.
            const sig = [
                settings.sellToNpc !== false,
                Boolean(settings.resaleMarket),
                Boolean(settings.resaleBazaar),
                Number(settings.cashOnHand) || 0,
            ].join('|');
            if (this.sweepSig === undefined) this.sweepSig = sig;
            if (!this.sweep.length || sig !== this.sweepSig) {
                this.sweep = itemMarketSweepList(index, settings);
                this.sweepSig = sig;
                this.sweepPos = 0;
            }
            await this.refreshItemMarket(rechecks);
        }
    }

    async refreshSummary(index, settings) {
        if (this.now() - this.lastSummaryAt < SUMMARY_INTERVAL_MS) return;

        try {
            const summary = await fetchW3bSummary(this.d.w3b);
            this.lastSummaryAt = this.now();
            this.candidates = selectCandidates(summary, index, settings);
            this.lastError = null;
            if (this.d.onSummary) {
                try {
                    this.d.onSummary(summary, this.lastSummaryAt);
                } catch {
                    // A listener's failure is not the feed's.
                }
            }

            /*
             * The summary is authoritative about what is NOT a deal: if an
             * item's cheapest bazaar price no longer beats its exit, none of
             * its bazaar rows can. Drop them now rather than waiting out a TTL.
             */
            const keep = new Set(this.candidates.map((c) => c.itemId));
            this.mutate((feed) => {
                for (const id of [...feed.bazaar.keys()]) {
                    if (!keep.has(id)) feed.bazaar.delete(id);
                }
            });
        } catch (error) {
            this.lastError = 'TornW3B: ' + ((error && error.message) || error);
        }
    }

    async refreshBazaars(rechecks) {
        const feedNow = this.readFeed();
        const byId = new Map(this.candidates.map((c) => [c.itemId, c]));

        const queue = [];
        for (const id of rechecks) if (byId.has(id)) queue.push(byId.get(id));
        for (const c of this.candidates) {
            if (!queue.includes(c) && bazaarDue(feedNow, c, this.now())) queue.push(c);
        }

        let fetched = 0;

        for (const candidate of queue) {
            if (fetched >= MAX_W3B_FETCHES_PER_CYCLE || !this.stillAllowed()) break;

            try {
                const { listings } = await fetchW3bListings(
                    this.d.w3b,
                    candidate.itemId,
                );
                fetched += 1;

                const rows = normalizeW3bListings(listings);
                const at = this.now();
                this.mutate((feed) =>
                    setBazaarSnapshot(feed, candidate.itemId, rows, at),
                );
            } catch (error) {
                this.lastError = 'TornW3B: ' + ((error && error.message) || error);
                if (error && error.blocked) break;
            }
        }
    }

    tornBudgetLeft() {
        const t = this.now();
        this.tornSpent = this.tornSpent.filter((x) => t - x < 60000);
        return FEED_TORN_PER_MINUTE - this.tornSpent.length;
    }

    /**
     * Which Item Market items to fetch this cycle, in order. Pure planning,
     * exposed for tests.
     *
     * The Torn budget is small (30/min) and everything wants it: rows already
     * on the list must be re-checked before they expire, TornW3B candidates
     * may be cheaper on the market too, and discovery has to keep moving or
     * nothing new is ever found. 3.7 let re-checks and candidates take both
     * slots every cycle and gave discovery one slot every other cycle, then
     * ran out of budget before reaching it: the sweep starved. Now:
     *
     *   1. what a tab explicitly asked to re-check (a listing someone opened)
     *   2. live rows about to expire, oldest data first
     *   3. ONE sweep item, so discovery advances every cycle
     *   4. a top TornW3B candidate, at most every 2 minutes each
     *   5. more sweep items
     *   6. with spare budget, other live rows past Torn's 30s cache
     *
     * @returns {Array<string>} item ids, at most `slots` of them
     */
    planItemMarket(feedNow, rechecks, now, slots) {
        const order = [];
        const add = (id) => {
            if (order.length >= slots) return false;
            if (!order.includes(id) && itemMarketDue(feedNow, id, now)) order.push(id);
            return true;
        };

        for (const id of rechecks) add(id);

        const live = itemMarketLiveIds(feedNow, (id, price) => this.isMarketDeal(id, price))
            .map((id) => ({ id, at: feedNow.itemmarket.get(id).dataAt || 0 }))
            .sort((a, b) => a.at - b.at);
        for (const l of live) {
            if (now - l.at >= LIVE_ROW_URGENT_MS) add(l.id);
        }

        const takeSweep = (want) => {
            const len = this.sweep.length;
            let examined = 0;
            let taken = 0;
            while (len && examined < len && taken < want && order.length < slots) {
                const id = this.sweep[(this.sweepPos + examined) % len];
                examined += 1;
                if (!order.includes(id) && itemMarketDue(feedNow, id, now)) {
                    order.push(id);
                    taken += 1;
                }
            }
            // The cursor moves past what it LOOKED at, so an item still inside
            // its cache window cannot stall the sweep.
            if (len) this.sweepPos = (this.sweepPos + examined) % len;
        };

        takeSweep(1);

        for (const c of this.candidates.slice(0, CANDIDATE_MARKET_CHECKS)) {
            if (order.length >= slots) break;
            const last = this.candidateCheckedAt.get(c.itemId);
            if (last !== undefined && now - last < CANDIDATE_MARKET_INTERVAL_MS) continue;
            const before = order.length;
            add(c.itemId);
            if (order.length > before) this.candidateCheckedAt.set(c.itemId, now);
        }

        if (order.length < slots) takeSweep(slots - order.length);

        // Spare budget only: live rows past Torn's 30s cache, oldest first.
        for (const l of live) add(l.id);

        return order.slice(0, slots);
    }

    /** Does a listing at this price beat one of the chosen exits? */
    isMarketDeal(itemId, price) {
        const index = this.d.getIndex();
        const item = index && index.byId && index.byId.get(String(itemId));
        if (!item) return false;
        const best = bestVenue({
            listingPrice: price,
            exits: exitsFor(item, this.d.getSettings()),
            qty: 1,
        });
        return Boolean(best && best.profitPerUnit > 0);
    }

    async refreshItemMarket(rechecks) {
        const feedNow = this.readFeed();
        const now = this.now();
        this.cycleCount += 1;

        const slots = Math.min(MAX_TORN_FETCHES_PER_CYCLE, this.tornBudgetLeft());
        if (slots <= 0) return;

        const order = this.planItemMarket(feedNow, rechecks, now, slots);

        let fetched = 0;

        for (const id of order) {
            if (fetched >= MAX_TORN_FETCHES_PER_CYCLE) break;
            if (this.tornBudgetLeft() <= 0 || !this.stillAllowed()) break;

            this.tornSpent.push(this.now());
            fetched += 1;

            try {
                const market = await fetchItemMarket(this.d.torn, id, {
                    now: this.now(),
                });
                const rows = normalizeItemMarketRows(market.listings);
                const at = this.now();

                this.mutate((feed) =>
                    setItemMarketSnapshot(feed, id, {
                        rows,
                        fetchedAt: at,
                        dataAt: market.cacheTimestamp,
                        nextAt: market.nextAt,
                        averagePrice: market.averagePrice,
                    }),
                );
            } catch (error) {
                this.lastError = 'Torn API: ' + ((error && error.message) || error);
                if (error && this.d.onKeyDead && this.d.isKeyDead && this.d.isKeyDead(error)) {
                    this.d.onKeyDead(error);
                }
                break;
            }
        }
    }
}
