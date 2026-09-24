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
    selectCandidates,
    normalizeW3bListings,
    normalizeItemMarketRows,
    setBazaarSnapshot,
    setItemMarketSnapshot,
    bazaarDue,
    itemMarketDue,
    itemMarketSweepList,
    makeFeedCacheEntry,
    readFeedCacheEntry,
} from '../core/feed.js';
import { decideLeader } from '../core/leader.js';
import { fetchW3bSummary, fetchW3bListings } from '../api/w3b.js';
import { fetchItemMarket } from '../api/torn.js';

/** TornW3B's summary is cached 60s at source. */
export const SUMMARY_INTERVAL_MS = 60 * 1000;

/**
 * Torn API requests the feed may spend per minute. Torn allows 100/min per
 * user across EVERY tool; this leaves most of it for TornTools, TornStats,
 * and the page scanner.
 */
export const FEED_TORN_PER_MINUTE = 20;

/** Per tick, so one cycle stays short and reacts to the tab being hidden. */
export const MAX_W3B_FETCHES_PER_CYCLE = 8;
export const MAX_TORN_FETCHES_PER_CYCLE = 2;

/** How many TornW3B candidates also get an Item Market check each cycle. */
export const CANDIDATE_MARKET_CHECKS = 5;

export const FEED_STORE_KEY = 'feed';
export const FEED_LEADER_KEY = 'feedLeader';
export const FEED_RECHECK_KEY = 'feedRecheck';

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
            if (!this.sweep.length) this.sweep = itemMarketSweepList(index, settings);
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

    async refreshItemMarket(rechecks) {
        const feedNow = this.readFeed();
        const now = this.now();

        /*
         * Rechecks first, then the top few TornW3B candidates (is it cheaper
         * on the market too?), then the rotating sweep. Candidates are capped
         * so they cannot starve the sweep of the whole budget.
         */
        const priority = [];
        const add = (id) => {
            if (!priority.includes(id) && itemMarketDue(feedNow, id, now)) priority.push(id);
        };

        for (const id of rechecks) add(id);
        for (const c of this.candidates.slice(0, CANDIDATE_MARKET_CHECKS)) add(c.itemId);

        // One slot per cycle always belongs to the sweep.
        const order = priority.slice(0, MAX_TORN_FETCHES_PER_CYCLE - 1);
        const sweepSlots = MAX_TORN_FETCHES_PER_CYCLE - order.length;

        /*
         * The sweep cursor advances past everything it LOOKED at, due or not,
         * and stops at the last item it took. Advancing only on a fetch of the
         * exact item under the cursor stalled it whenever that item was still
         * inside its 30s cache window, and the sweep circled the same handful
         * of items forever.
         */
        const len = this.sweep.length;
        let examined = 0;
        let taken = 0;
        while (len && examined < len && taken < sweepSlots) {
            const id = this.sweep[(this.sweepPos + examined) % len];
            examined += 1;
            if (!order.includes(id) && itemMarketDue(feedNow, id, now)) {
                order.push(id);
                taken += 1;
            }
        }
        if (len) this.sweepPos = (this.sweepPos + examined) % len;

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
