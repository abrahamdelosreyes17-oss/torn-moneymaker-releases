/*
 * TornW3B (weav3r.dev) - the crowd-sourced bazaar price feed.
 *
 * Torn's API has no per-listing bazaar prices a Public key can trust (the
 * `user -> bazaar` selection can be served days old on a Public key, and the
 * `market -> bazaar` selection is a directory with no prices). TornW3B polls
 * bazaars with keys their SELLERS donated, for their own bazaar only, and
 * publishes the result. TornTools, TornPDA and Weav3r's own script read it.
 *
 * Non-negotiables, enforced here rather than by convention:
 *
 *   1. This client NEVER sees a Torn API key. It has no key parameter, no
 *      getKey, and the only query it ever sends is `comment` and, since
 *      3.23.0, the whole numbers of W3B_QUERY (one: a count of hours) - a
 *      name not in that list, or a value that is not a whole number within
 *      its range, is dropped. The Torn client and this one share nothing.
 *   2. weav3r.dev is the only destination - asserted on the resolved URL, not
 *      just implied by a constant, exactly as client.js does for api.torn.com.
 *   3. Its own sliding window, well under TornW3B's 100/min Cloudflare limit,
 *      and a hard cooldown on 429 or a non-JSON (Cloudflare challenge) body.
 *
 * Responses are cached server-side for 60s, so asking faster is pointless.
 *
 * 3.26.0 - each kind of request has its own limit, as TornW3B has (its spec,
 * read 2026-10-10; per address, without a key):
 *
 *   GET /marketplace/{itemId}            the sellers of an item: 10 a minute, 1,000 a day
 *   GET /marketplace/{itemId}?filler=1   its 10 cheapest prices and counts, no seller:
 *                                        200 a minute, 10,000 a day, a counter of its own
 *   every route together                 300 a minute; Cloudflare in front: 100 a minute
 *   a 429 carries Retry-After
 *
 * Seven report zips (2026-09-30 to 2026-10-08) say the same: every one of 54
 * refusals was a sellers list, the eleventh of its minute, from 2026-10-06 on -
 * before that day 60 to 75 a minute passed for hours. 3.25.0 read it as "a
 * burst is refused" and spaced every request; that was wrong. So the sellers
 * list has a minute and a day of its own here (W3B_LISTING_*), every tab
 * together; a refusal there stops the sellers lists only, for as long as
 * TornW3B says, and neither the price lists nor the buyers wait for it.
 */

import { gmFetch } from '../platform/gm.js';

export const W3B_API_BASE = 'https://weav3r.dev/api/';
export const W3B_HOST = 'weav3r.dev';
export const W3B_TERMS_URL = 'https://weav3r.dev/terms-of-service';
export const W3B_SITE_URL = 'https://weav3r.dev';

/** TornW3B enforces 100/min per IP; leave 40 for TornTools and friends. */
export const W3B_MAX_PER_MINUTE = 60;

/**
 * Every tab together (the feed's Torn tab, Torn Bids, Fill in other tabs):
 * each client's own ceiling only limits itself, so two of them made 84/min
 * against TornW3B's 100 per IP before TornTools asked for anything.
 */
export const W3B_SHARED_PER_MINUTE = 80;

/** After a 429 with no Retry-After, or a challenge page, stop asking for this long. */
export const W3B_COOLDOWN_MS = 60000;

/** The sellers of an item (GET /marketplace/{itemId}): TornW3B allows 10 a minute and 1,000 a day; two and a hundred are left spare. */
export const W3B_LISTING_PER_MINUTE = 8;
export const W3B_LISTING_PER_DAY = 900;
/**
 * With the key you registered on TornW3B (3.26.0): 25 a minute allowed, three left spare; the day is the same
 * thousand. The key is a Torn key of yours that TornW3B already has; it goes in the header X-API-Key of a
 * sellers list and nowhere else - never in a web address, never to another host (buildUrl), never with
 * another kind of request. TornW3B answering 401 means it does not know the key: it is not sent again.
 */
export const W3B_LISTING_KEYED_PER_MINUTE = 22;
export const W3B_KEY_HEADER = 'X-API-Key';
/** Its light list (filler=1): 10,000 a day allowed. Its minute is the one every request shares. */
export const W3B_LIGHT_PER_DAY = 9000;
/** A Retry-After is believed between these: never a wait of nothing, never one past a day. */
export const W3B_RETRY_AFTER_MIN_MS = 1000;
export const W3B_RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000;
const W3B_HOUR_MS = 60 * 60 * 1000;
const W3B_DAY_HOURS = 24;

/*
 * The pace (3.25.0; the friend's zip of 2026-10-06, 3.24.1). TornW3B refused us
 * minute after minute at a dozen requests a minute - the same hours it took 40
 * and 43 in a minute when they came spread out. It refuses a BURST: a dozen left
 * back to back, the last was a 429, we paused a minute, and the same dozen left
 * again. The minute's ceilings above never saw it.
 *
 * So: a gap between any two requests, whichever tab makes them (the time of the
 * last one is already shared). The gap finds its own length - a little shorter
 * after each answer, never under its floor; after a refusal twice as long, and
 * the pace that was refused is not tried again for two hours. After a pause the
 * first request so goes alone and the next ones slowly.
 */
/** Never closer than this: 60 a minute, the ceiling of before. */
export const W3B_GAP_MIN_MS = 1000;
/** Where it starts, and never faster than this right after a refusal. */
export const W3B_GAP_START_MS = 1500;
/** Never slower than this, whatever is refused. */
export const W3B_GAP_MAX_MS = 8000;
/** Shorter by this after each answer. */
const W3B_GAP_STEP_MS = 25;
/** A pace that was refused is not tried again for this long. */
const W3B_GAP_HOLD_MS = 2 * 60 * 60 * 1000;
/** The gap is stored for the other tabs when it has moved this much (not at every answer). */
const W3B_GAP_SAVE_MS = 100;
/** A request with no other in this long before it went alone: refused, it says nothing about the pace. */
const W3B_ALONE_MS = 20000;

/*
 * Torn Bids first (3.20.5, the owner: "when we're in Torn Bids, we prioritize
 * Torn Bids, not the NPC arbitrage"). The overlay on Torn's pages took up to
 * 59 of every tab's 80 reads a minute (the friend's zip); back on Torn Bids,
 * its flips had what was left of that minute. While Torn Bids is in use - in view now, or within the last
 * 5 minutes: a buying run goes back and forth - the overlay takes what
 * Torn Bids' 60 leave of the 80.
 */
export const W3B_BESIDE_BIDS_PER_MINUTE = W3B_SHARED_PER_MINUTE - W3B_MAX_PER_MINUTE;
export const W3B_BIDS_IN_USE_MS = 5 * 60 * 1000;

/**
 * The overlay's reads a minute, given when Torn Bids was last in view.
 * A time "from the future" (the clock was changed) is not believed.
 */
export function overlayPerMinute(bidsSeenAt, now = Date.now()) {
    const at = Number(bidsSeenAt) || 0;
    return at > 0 && at <= now + 60000 && now - at < W3B_BIDS_IN_USE_MS ? W3B_BESIDE_BIDS_PER_MINUTE : W3B_MAX_PER_MINUTE;
}

/*
 * What may ride in a query besides `comment` (3.23.0): an option of TornW3B's
 * own API, a whole number within the range the service takes. Checked on the
 * way out (buildUrl): nothing else can be put in, whoever calls.
 *
 *   tradedWithinHours  /marketplace/{id}/traders: only buyers who traded in
 *                      the last N hours (1-168)
 *
 * `maxPrice` on /marketplace/{id} (only the listings at or under a price) was
 * tried for 3.23.0 and is NOT sent. Measured on the bench (the scene "400
 * items read in turn", with their dearer rows and without): about 12 ms of a
 * 100-140 ms redraw with the processor slowed four times, less than two runs
 * of the same thing differ by - a read "in turn" already keeps only its 10
 * cheapest rows, and the redraw's time is the page, not the rows. And an item
 * with nothing under the trader's price would lose its lowest bazaar price.
 *
 *   filler             /marketplace/{id}: 1 = the light list (3.26.0) - the 10
 *                      cheapest listings, price and count only
 */
const W3B_QUERY = { tradedWithinHours: [1, 168], filler: [1, 1] };

/** Is this the sellers-of-an-item route (marketplace/{itemId})? Not the summary (marketplace), not marketplace/{id}/traders. */
export function isW3bListingPath(path) {
    return /^marketplace\/[^/?#]+\/?$/.test(String(path).replace(/^\/+/, ''));
}

/** Which limit a request draws on: 'listing' (an item's sellers), 'light' (its light list), or 'rest'. */
export function w3bRoute(path, query = null) {
    if (!isW3bListingPath(path)) return 'rest';
    return query && query.filler === 1 ? 'light' : 'listing';
}

/**
 * How long a Retry-After asks us to wait, in ms: a number of seconds, or an
 * HTTP date. Null when there is none or it cannot be read (the caller then
 * waits W3B_COOLDOWN_MS).
 */
export function w3bRetryAfterMs(value, now = Date.now()) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    let ms = null;
    if (/^\d+(\.\d+)?$/.test(text)) {
        ms = Number(text) * 1000;
    } else if (/[A-Za-z]{3}/.test(text) && /\d{4}/.test(text)) {
        // An HTTP date ("Wed, 21 Oct 2026 07:28:00 GMT"): nothing looser is taken for one.
        const at = Date.parse(text);
        if (Number.isFinite(at)) ms = at - now;
    }
    if (ms === null || !Number.isFinite(ms)) return null;
    return Math.min(W3B_RETRY_AFTER_MAX_MS, Math.max(W3B_RETRY_AFTER_MIN_MS, Math.ceil(ms)));
}

/** One answer header: gmFetch's `header(name)`, or a fetch Response's `headers.get(name)`. */
function w3bHeader(response, name) {
    try {
        if (response && typeof response.header === 'function') return response.header(name);
        if (response && response.headers && typeof response.headers.get === 'function') return response.headers.get(name);
    } catch {
        // No header to read: the caller falls back.
    }
    return null;
}

function w3bSum(counts) {
    let n = 0;
    for (const v of Object.values(counts || {})) n += Number(v) || 0;
    return n;
}

/** A whole number within [min, max], or null. */
function w3bWhole(value, min, max) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export class W3bError extends Error {
    constructor(message, { http = null, blocked = false, paused = false, route = null, reason = null, retryAt = null, badKey = false } = {}) {
        super(message);
        this.name = 'W3bError';
        this.http = http;
        // TornW3B answered 401 to the key registered there (3.26.0).
        this.badKey = badKey;
        // Everything is stopped (a refusal of a request with no limit of its own, or a challenge page).
        this.blocked = blocked;
        // Not sent at all: we are inside the wait a refusal started, or a limit of our own is used up. Nothing for the problem log.
        this.paused = paused;
        // 'listing' | 'light': only this kind of request is stopped (3.26.0); the rest go on.
        this.route = route;
        // Of a request not sent: 'cooldown' | 'listing-wait' | 'listing-minute' | 'listing-day' | 'light-wait' | 'light-day'.
        this.reason = reason;
        // When asking again can work (ms), where that is known.
        this.retryAt = retryAt;
    }
}

function w3bSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class W3bClient {
    /**
     * @param {object} [options]
     * @param {function} [options.fetchImpl] - injectable for tests
     * @param {number} [options.maxPerMinute]
     * @param {function} [options.perMinute] - () => number: the ceiling right
     *   now, when it is lower than maxPerMinute (the overlay beside Torn Bids)
     * @param {function} [options.now]
     * @param {function} [options.loadShared] - () => {recent: number[], cooldownUntil}
     *   stored for every tab: one window across all of them, and a 429 seen
     *   by one tab stops them all.
     * @param {function} [options.saveShared] - (state) => void
     * @param {function} [options.addShared] - (at) => void: record one slot of
     *   THIS tab only (platform/tab-window.js), so tabs never overwrite each
     *   other's; without it the whole window is written back through saveShared
     * @param {function} [options.sharedCeiling] - () => number: every tab together, right now, when
     *   it is lower than sharedPerMinute (Torn Bids beside Torn Archive)
     * @param {number} [options.sharedPerMinute]
     * @param {function} [options.sleep] - (ms) => Promise; injectable for tests
     * @param {function} [options.isVisible] - () => boolean; nothing is sent
     *   from a hidden tab, even a request queued while it was visible
     * @param {boolean} [options.pace] - keep a gap between any two requests,
     *   across tabs (the script always does; off only for the tests of other parts)
     * @param {function} [options.onAnswered] - ({path, tag, refused}) => void, each
     *   answer: taken, or refused (a 429 or a challenge page)
     */
    constructor({
        fetchImpl = gmFetch,
        maxPerMinute = W3B_MAX_PER_MINUTE,
        now = () => Date.now(),
        loadShared = null,
        saveShared = null,
        sharedPerMinute = W3B_SHARED_PER_MINUTE,
        sleep = w3bSleep,
        isVisible = () => true,
        addShared = null,
        onSent = null,
        onFailed = null,
        perMinute = null,
        sharedCeiling = null,
        onOver = null,
        pace = false,
        onAnswered = null,
        onPace = null,
        listingPerMinute = W3B_LISTING_PER_MINUTE,
        listingPerDay = W3B_LISTING_PER_DAY,
        lightPerDay = W3B_LIGHT_PER_DAY,
        listingKeyedPerMinute = W3B_LISTING_KEYED_PER_MINUTE,
        listingKey = null,
        onKeyRefused = null,
        loadListing = null,
        addListing = null,
        loadRoutes = null,
        saveRoutes = null,
        otherListing = null,
        onRoute = null,
    } = {}) {
        /*
         * The sellers list's own minute and day, and the light list's day (3.26.0).
         *   loadListing / addListing: every tab's sellers lists of the last minute (platform/tab-window.js)
         *   loadRoutes / saveRoutes:  () => {listingDay: {[hour]: n}, lightDay: {[hour]: n}, listingUntil, lightUntil}
         *                             stored for every tab; hour = floor(ms / 3,600,000)
         *   otherListing:             () => {minute, day}: sellers lists another app of ours asked from this
         *                             PC (Torn Archive) - TornW3B counts by address, so they are the same ten
         *   onRoute:                  ({route, until, said}) => void: TornW3B refused this kind; for the log
         *   listingKey:               () => the key registered on TornW3B, or '' (none, or one it refused)
         *   onKeyRefused:             () => void: TornW3B answered 401 to that key - whoever stores it marks it
         */
        this.listingPerMinuteOwn = listingPerMinute;
        this.listingKeyedPerMinute = listingKeyedPerMinute;
        this.listingKey = listingKey;
        this.onKeyRefused = onKeyRefused;
        this.listingPerDay = listingPerDay;
        this.lightPerDay = lightPerDay;
        this.loadListing = loadListing;
        this.addListing = addListing;
        this.loadRoutes = loadRoutes;
        this.saveRoutes = saveRoutes;
        this.otherListing = otherListing;
        this.onRoute = onRoute;
        this.listingRecent = [];
        this.routesOwn = { listingDay: {}, lightDay: {}, listingUntil: 0, lightUntil: 0 };
        this.pace = Boolean(pace);
        // This tab's own copy of the pace, for when nothing is shared; and what it has shortened the gap by since it last stored it.
        this.paceOwn = null;
        this.gapDebt = 0;
        this.onAnswered = onAnswered;
        /** A refusal changed the pace: ({was, gap, floor}, in ms) - for the log. */
        this.onPace = onPace;
        this.perMinute = perMinute;
        this.sharedCeiling = sharedCeiling;
        /**
         * ({count, limit, own}) => void (3.23.0): the minute every tab shares was found OVER
         * sharedPerMinute - tabs learn of each other's requests late, so two can take the same
         * last slot. This tab waits, as always; the report is for the problem log.
         */
        this.onOver = onOver;
        /** ({path, tag}) => void, each request that leaves: the usage record (3.15). */
        this.onSent = onSent;
        /** ({path, tag, error}) => void, a request that failed: the problem log (3.15). */
        this.onFailed = onFailed;
        this.addShared = addShared;
        this.sleep = sleep;
        this.isVisible = isVisible;
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.now = now;
        this.loadShared = loadShared;
        this.saveShared = saveShared;
        this.sharedPerMinute = sharedPerMinute;
        this.recent = [];
        this.chain = Promise.resolve();
        this.cooldownUntil = 0;
    }

    /** The key for a sellers list, or '': only something shaped like a Torn key is ever put in a header. */
    listingKeyNow() {
        if (!this.listingKey) return '';
        try {
            const key = String(this.listingKey() || '').trim();
            return /^[A-Za-z0-9]{16}$/.test(key) ? key : '';
        } catch {
            return '';
        }
    }

    /** The sellers lists allowed in a minute: more with a key TornW3B knows. */
    get listingPerMinute() {
        return this.listingKeyNow() ? this.listingKeyedPerMinute : this.listingPerMinuteOwn;
    }

    /** What every tab has used, and any wait one of them was told to make. */
    readShared(t) {
        const out = { recent: [], cooldownUntil: 0 };
        if (!this.loadShared) return out;
        let s;
        try {
            s = this.loadShared();
        } catch {
            return out;
        }
        if (!s || typeof s !== 'object') return out;
        if (Array.isArray(s.recent)) out.recent = s.recent.filter((x) => Number.isFinite(x) && t - x < 60000).sort((a, b) => a - b);
        if (Number.isFinite(Number(s.cooldownUntil))) out.cooldownUntil = Number(s.cooldownUntil);
        if (s.pace && typeof s.pace === 'object') out.pace = s.pace;
        return out;
    }

    /** The pace every tab goes by: {gap, floor, floorUntil}, each within its bounds. */
    paceNow(shared, t) {
        const p = (this.loadShared ? shared && shared.pace : this.paceOwn) || {};
        const within = (n, fallback) => (Number.isFinite(Number(n)) ? Math.max(W3B_GAP_MIN_MS, Math.min(W3B_GAP_MAX_MS, Math.round(Number(n)))) : fallback);
        const floorUntil = Number.isFinite(Number(p.floorUntil)) && Number(p.floorUntil) <= t + W3B_GAP_HOLD_MS ? Number(p.floorUntil) : 0;
        const floor = floorUntil > t ? within(p.floor, W3B_GAP_MIN_MS) : W3B_GAP_MIN_MS;
        return { gap: Math.max(floor, within(p.gap, W3B_GAP_START_MS)), floor, floorUntil: floorUntil > t ? floorUntil : 0 };
    }

    savePace(pace, t) {
        this.gapDebt = 0;
        if (this.loadShared) this.writeShared({ ...this.readShared(t), pace });
        else this.paceOwn = pace;
    }

    /** An answer came: the gap a little shorter, never under its floor. */
    paceAnswered() {
        if (!this.pace) return;
        const t = this.now();
        const pace = this.paceNow(this.readShared(t), t);
        const gap = Math.max(pace.floor, pace.gap - this.gapDebt - W3B_GAP_STEP_MS);
        this.gapDebt = pace.gap - gap;
        // Stored for the other tabs once it has moved enough, or has reached its floor.
        if (this.gapDebt >= W3B_GAP_SAVE_MS || (gap === pace.floor && this.gapDebt > 0)) this.savePace({ ...pace, gap }, t);
    }

    /** Refused: twice the gap, and the pace that was refused is not tried again for two hours. */
    paceRefused() {
        if (!this.pace) return;
        const t = this.now();
        const shared = this.readShared(t);
        // It went alone (the first after a pause; TornW3B down, or refusing this address for
        // someone else's requests): slower would not have helped, so the pace stays.
        const lately = (this.loadShared ? shared.recent : this.recent).filter((at) => t - at < W3B_ALONE_MS).length;
        if (lately <= 1) return;
        const pace = this.paceNow(shared, t);
        const was = Math.max(pace.floor, pace.gap - this.gapDebt);
        const next = {
            gap: Math.min(W3B_GAP_MAX_MS, Math.max(W3B_GAP_START_MS, was * 2)),
            floor: Math.min(W3B_GAP_MAX_MS, Math.max(pace.floor, Math.round(was * 1.25))),
            floorUntil: t + W3B_GAP_HOLD_MS,
        };
        this.savePace(next, t);
        if (this.onPace) {
            try {
                this.onPace({ was: Math.round(was), gap: Math.round(next.gap), floor: Math.round(next.floor) });
            } catch {
                // The log is best-effort.
            }
        }
    }

    answered(path, tag, refused) {
        if (!this.onAnswered) return;
        try {
            this.onAnswered({ path, tag, refused });
        } catch {
            // The usage record is best-effort.
        }
    }

    writeShared(state) {
        if (!this.saveShared) return;
        try {
            this.saveShared(state);
        } catch {
            // Sharing is best-effort; this tab still limits itself.
        }
    }

    /** The later of this tab's wait and any other tab's. */
    blockedUntil(t = this.now()) {
        return Math.max(this.cooldownUntil, this.readShared(t).cooldownUntil);
    }

    /** Every tab's ceiling together now: sharedPerMinute, or less while sharedCeiling() says so. Never under 1. */
    sharedNow() {
        if (!this.sharedCeiling) return this.sharedPerMinute;
        let n;
        try {
            n = Number(this.sharedCeiling());
        } catch {
            return this.sharedPerMinute;
        }
        return Number.isFinite(n) ? Math.max(1, Math.min(this.sharedPerMinute, Math.floor(n))) : this.sharedPerMinute;
    }

    /** This tab's ceiling now: maxPerMinute, or less while perMinute() says so. Never under 1. */
    limit() {
        if (!this.perMinute) return this.maxPerMinute;
        let n;
        try {
            n = Number(this.perMinute());
        } catch {
            return this.maxPerMinute;
        }
        return Number.isFinite(n) ? Math.max(1, Math.min(this.maxPerMinute, Math.floor(n))) : this.maxPerMinute;
    }

    /** The hour counts worth keeping (the last 24 whole hours and this one), as {[hour]: count}. */
    dayCounts(source, t) {
        const out = {};
        if (!source || typeof source !== 'object') return out;
        const hour = Math.floor(t / W3B_HOUR_MS);
        for (const [h, n] of Object.entries(source)) {
            const at = Number(h);
            const count = Math.floor(Number(n));
            if (Number.isInteger(at) && at <= hour && at >= hour - W3B_DAY_HOURS && count > 0) out[at] = count;
        }
        return out;
    }

    /** What is kept of the two kinds with a limit of their own: the larger of this tab's and what every tab stored. */
    routes(t = this.now()) {
        const own = this.routesOwn;
        own.listingDay = this.dayCounts(own.listingDay, t);
        own.lightDay = this.dayCounts(own.lightDay, t);
        let stored = null;
        if (this.loadRoutes) {
            try {
                stored = this.loadRoutes();
            } catch {
                stored = null;
            }
        }
        const s = stored && typeof stored === 'object' ? stored : {};
        const pickDay = (mine, theirs) => {
            const kept = this.dayCounts(theirs, t);
            return w3bSum(kept) > w3bSum(mine) ? kept : mine;
        };
        // A wait "from the future" past a day (the clock was changed) is not believed.
        const until = (mine, theirs) => {
            const n = Number(theirs);
            return Math.max(mine || 0, Number.isFinite(n) && n <= t + W3B_RETRY_AFTER_MAX_MS ? n : 0);
        };
        return {
            listingDay: pickDay(own.listingDay, s.listingDay),
            lightDay: pickDay(own.lightDay, s.lightDay),
            listingUntil: until(own.listingUntil, s.listingUntil),
            lightUntil: until(own.lightUntil, s.lightUntil),
        };
    }

    writeRoutes(next) {
        this.routesOwn = { ...next };
        if (!this.saveRoutes) return;
        try {
            this.saveRoutes(next);
        } catch {
            // Sharing is best-effort; this tab still counts its own.
        }
    }

    /**
     * The sellers list's two counts (every tab's, and another app's on this PC) and when each has room again.
     * @returns {{minute: number, day: number, minuteFreeAt: number, dayFreeAt: number, until: number}} *FreeAt: 0 while there is room
     */
    listingUse(t = this.now()) {
        this.listingRecent = this.listingRecent.filter((x) => t - x < 60000);
        let recent = this.listingRecent;
        if (this.loadListing) {
            try {
                const s = this.loadListing();
                const all = Array.isArray(s) ? s.filter((x) => Number.isFinite(x) && t - x < 60000 && x <= t).sort((a, b) => a - b) : [];
                if (all.length > recent.length) recent = all;
            } catch {
                // Sharing is best-effort; this tab still counts its own.
            }
        }
        let other = { minute: 0, day: 0 };
        if (this.otherListing) {
            try {
                const o = this.otherListing() || {};
                const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
                other = { minute: n(o.minute), day: n(o.day) };
            } catch {
                // Not known: only our own are counted.
            }
        }
        const r = this.routes(t);
        const perMinute = Math.max(1, Math.floor(Number(this.listingPerMinute)) || 1);
        const perDay = Math.max(1, Math.floor(Number(this.listingPerDay)) || 1);
        const minute = recent.length + other.minute;
        const day = w3bSum(r.listingDay) + other.day;
        const hours = Object.keys(r.listingDay).map(Number).sort((a, b) => a - b);
        // Our own slot that brings the minute back under its limit, a minute after it was taken; the other app's are not ours to time.
        const mineOver = recent.length - Math.max(0, perMinute - other.minute);
        return {
            minute,
            day,
            // This clock hour's (the day is paced by it: core/desk.js dayPaceRoom).
            hour: r.listingDay[Math.floor(t / W3B_HOUR_MS)] || 0,
            minuteFreeAt: minute >= perMinute ? (mineOver >= 0 && recent.length ? recent[Math.min(recent.length - 1, mineOver)] + 60000 : t + 15000) : 0,
            // The oldest counted hour leaves the day when the hour after its 24 have passed begins.
            dayFreeAt: day >= perDay ? (hours.length ? (hours[0] + W3B_DAY_HOURS + 1) * W3B_HOUR_MS : t + W3B_HOUR_MS) : 0,
            until: r.listingUntil > t ? r.listingUntil : 0,
        };
    }

    /** The light list's day, and a wait TornW3B asked for. */
    lightUse(t = this.now()) {
        const r = this.routes(t);
        const perDay = Math.max(1, Math.floor(Number(this.lightPerDay)) || 1);
        const day = w3bSum(r.lightDay);
        const hours = Object.keys(r.lightDay).map(Number).sort((a, b) => a - b);
        return {
            day,
            hour: r.lightDay[Math.floor(t / W3B_HOUR_MS)] || 0,
            dayFreeAt: day >= perDay ? (hours.length ? (hours[0] + W3B_DAY_HOURS + 1) * W3B_HOUR_MS : t + W3B_HOUR_MS) : 0,
            until: r.lightUntil > t ? r.lightUntil : 0,
        };
    }

    /** Count one request of a kind with its own limit, as it is about to leave. */
    noteRoute(route, t = this.now()) {
        if (route === 'listing') {
            this.listingRecent.push(t);
            if (this.addListing) {
                try {
                    this.addListing(t);
                } catch {
                    // Best-effort; this tab still limits itself.
                }
            }
        }
        const r = this.routes(t);
        const key = route === 'listing' ? 'listingDay' : 'lightDay';
        const hour = Math.floor(t / W3B_HOUR_MS);
        this.writeRoutes({ ...r, [key]: { ...r[key], [hour]: (r[key][hour] || 0) + 1 } });
    }

    /** TornW3B refused this kind: none of it is asked until `until` - this tab and, through storage, every other. */
    coolRoute(route, ms, t = this.now()) {
        const until = t + (Number(ms) > 0 ? Number(ms) : W3B_COOLDOWN_MS);
        const r = this.routes(t);
        this.writeRoutes({ ...r, [route === 'listing' ? 'listingUntil' : 'lightUntil']: until });
        return until;
    }

    /** Why a request may not leave now (an error to throw; nothing was sent), or null. */
    refusal(route, t = this.now()) {
        const until = this.blockedUntil(t);
        if (t < until) return new W3bError('TornW3B is rate limiting us; paused briefly.', { blocked: true, paused: true, reason: 'cooldown', retryAt: until });
        if (route === 'listing') {
            const use = this.listingUse(t);
            if (use.until) return new W3bError('TornW3B asked us to wait before another sellers list.', { paused: true, route, reason: 'listing-wait', retryAt: use.until });
            if (use.dayFreeAt) return new W3bError("TornW3B sellers lists: today's " + this.listingPerDay + ' are used.', { paused: true, route, reason: 'listing-day', retryAt: use.dayFreeAt });
            if (use.minuteFreeAt) return new W3bError("TornW3B sellers lists: this minute's " + this.listingPerMinute + ' are used.', { paused: true, route, reason: 'listing-minute', retryAt: use.minuteFreeAt });
        } else if (route === 'light') {
            const use = this.lightUse(t);
            if (use.until) return new W3bError('TornW3B asked us to wait before another light list.', { paused: true, route, reason: 'light-wait', retryAt: use.until });
            if (use.dayFreeAt) return new W3bError("TornW3B light lists: today's " + this.lightPerDay + ' are used.', { paused: true, route, reason: 'light-day', retryAt: use.dayFreeAt });
        }
        return null;
    }

    stats() {
        const t = this.now();
        const used = this.recent.filter((x) => t - x < 60000).length;
        const listing = this.listingUse(t);
        const light = this.lightUse(t);
        return {
            // The sellers list's own minute and day (every tab's; and Torn Archive's on this PC), and the light list's day.
            listingLastMinute: listing.minute,
            listingToday: listing.day,
            listingMinuteLeft: Math.max(0, this.listingPerMinute - listing.minute),
            listingDayLeft: Math.max(0, this.listingPerDay - listing.day),
            // When a sellers list can next be asked for: 0 = now.
            listingFreeAt: Math.max(listing.until, listing.minuteFreeAt, listing.dayFreeAt),
            lightToday: light.day,
            lightDayLeft: Math.max(0, Math.max(1, Math.floor(Number(this.lightPerDay)) || 1) - light.day),
            lightFreeAt: Math.max(light.until, light.dayFreeAt),
            // Used in this clock hour, of each kind with a day of its own.
            listingHourUsed: listing.hour,
            lightHourUsed: light.hour,
            usedLastMinute: used,
            remaining: Math.max(0, this.limit() - used),
            coolingDown: t < this.blockedUntil(t),
            sharedLastMinute: this.loadShared ? this.readShared(t).recent.length : used,
            // The gap every tab keeps between two requests now (null: no pace).
            gapMs: this.pace ? this.paceNow(this.readShared(t), t).gap : null,
        };
    }

    async waitForSlot() {
        for (;;) {
            // Hidden: take no slot and send nothing until the tab is back.
            if (!this.isVisible()) {
                await this.sleep(1000);
                continue;
            }
            const t = this.now();
            this.recent = this.recent.filter((x) => t - x < 60000);
            const shared = this.readShared(t);
            const sharedMax = this.sharedNow();
            const sharedFull = this.loadShared && shared.recent.length >= sharedMax;
            const limit = this.limit();
            // The pace: not sooner than the gap after the last request of any tab.
            if (this.pace) {
                const last = Math.max(this.recent.length ? this.recent[this.recent.length - 1] : 0, shared.recent.length ? shared.recent[shared.recent.length - 1] : 0);
                const gap = Math.max(W3B_GAP_MIN_MS, this.paceNow(shared, t).gap - this.gapDebt);
                if (last > 0 && t >= last && t - last < gap) {
                    await this.sleep(gap - (t - last));
                    continue;
                }
            }
            if (this.onOver && this.loadShared && shared.recent.length > this.sharedPerMinute) {
                try {
                    this.onOver({ count: shared.recent.length, limit: this.sharedPerMinute, own: this.recent.length });
                } catch {
                    // The report is best-effort.
                }
            }

            if (this.recent.length < limit && !sharedFull) {
                this.recent.push(t);
                if (this.addShared) {
                    try {
                        this.addShared(t);
                    } catch {
                        // Best-effort; this tab still limits itself.
                    }
                } else if (this.loadShared) {
                    this.writeShared({ ...shared, recent: [...shared.recent, t] });
                }
                return t;
            }

            // Wait until every full window has a slot again.
            const frees = [];
            if (this.recent.length >= limit) frees.push(this.recent[this.recent.length - limit]);
            if (sharedFull) frees.push(shared.recent[shared.recent.length - sharedMax]);
            await this.sleep(Math.max(50, 60000 - (t - Math.max(...frees)) + 25));
        }
    }

    /** Stop asking - this tab and, through storage, every other. `ms`: what a Retry-After asked for; else the usual minute. */
    coolDown(ms = W3B_COOLDOWN_MS) {
        const t = this.now();
        this.cooldownUntil = t + (Number(ms) > 0 ? Number(ms) : W3B_COOLDOWN_MS);
        if (this.loadShared) this.writeShared({ ...this.readShared(t), cooldownUntil: this.cooldownUntil });
        return this.cooldownUntil;
    }

    /** Build and check a URL. Exposed for tests. `query`: W3B_QUERY's options only. */
    buildUrl(path, query = null) {
        const url = new URL(String(path).replace(/^\/+/, ''), W3B_API_BASE);

        if (url.hostname !== W3B_HOST) {
            throw new W3bError('Refusing to contact ' + url.hostname + '.');
        }

        // Nothing but an attribution comment ever goes in the query - and the whole number of W3B_QUERY.
        url.search = '';
        url.searchParams.set('comment', 'TornTradingV2');
        for (const [name, [min, max]] of Object.entries(W3B_QUERY)) {
            const n = query && Object.prototype.hasOwnProperty.call(query, name) ? w3bWhole(query[name], min, max) : null;
            if (n !== null) url.searchParams.set(name, String(n));
        }

        return url;
    }

    /** GET one TornW3B path. Serialised, rate-limited, never keyed. `tag`: what it is for (the usage record). */
    get(path, { tag = null, query = null } = {}) {
        const run = () => this.execute(path, tag, query).catch((error) => {
            // Paused means silent: the one real refusal is logged, not every request that was not sent.
            if (this.onFailed && !(error && error.paused)) {
                try {
                    this.onFailed({ path, tag, error });
                } catch {
                    // The log is best-effort.
                }
            }
            throw error;
        });
        const promise = this.chain.catch(() => {}).then(run);
        this.chain = promise.catch(() => {});
        return promise;
    }

    async execute(path, tag = null, query = null) {
        const url = this.buildUrl(path, query);
        // What really leaves decides the kind: a `filler` that was dropped on the way out is a sellers list.
        const route = w3bRoute(path, { filler: url.searchParams.get('filler') === '1' ? 1 : null });
        // Paused, or a limit of this kind used up: not sent, not kept for later - whoever asked asks again when it is due.
        let refused = this.refusal(route);
        if (refused) throw refused;

        const at = await this.waitForSlot();
        // Another tab may have been blocked, or have taken the last room, while this one waited for a slot.
        refused = this.refusal(route);
        if (refused) throw refused;
        if (route !== 'rest') this.noteRoute(route);

        if (this.onSent) {
            try {
                this.onSent({ path, tag, at });
            } catch {
                // The usage record is best-effort.
            }
        }

        // The registered key: with a sellers list only, in a header only (the URL above never holds one).
        const key = route === 'listing' ? this.listingKeyNow() : '';
        let response;
        try {
            response = key ? await this.fetchImpl(url.toString(), { headers: { [W3B_KEY_HEADER]: key } }) : await this.fetchImpl(url.toString());
        } catch (error) {
            throw new W3bError(
                'TornW3B network error: ' + ((error && error.message) || error),
            );
        }

        if (response.status === 429) {
            // TornW3B says how long to stay away (Retry-After); without it, the usual minute.
            const said = w3bRetryAfterMs(w3bHeader(response, 'retry-after'), this.now());
            this.answered(path, tag, true);
            if (route !== 'rest') {
                // Only this kind is stopped: the summary, the price lists and the buyers go on, at the pace they had.
                const until = this.coolRoute(route, said ?? W3B_COOLDOWN_MS);
                if (this.onRoute) {
                    try {
                        const use = route === 'listing' ? this.listingUse() : this.lightUse();
                        this.onRoute({ route, until, said, minute: use.minute ?? null, day: use.day });
                    } catch {
                        // The log is best-effort.
                    }
                }
                throw new W3bError('TornW3B rate limit (429).', { http: 429, route, retryAt: until });
            }
            const until = this.coolDown(said ?? W3B_COOLDOWN_MS);
            this.paceRefused();
            throw new W3bError('TornW3B rate limit (429).', {
                http: 429,
                blocked: true,
                retryAt: until,
            });
        }

        if (key && response.status === 401) {
            // TornW3B does not know this key: it is not sent again (the next sellers list goes without, at the slower limit).
            if (this.onKeyRefused) {
                try {
                    this.onKeyRefused();
                } catch {
                    // Best-effort.
                }
            }
            throw new W3bError('TornW3B does not know this key (401).', { http: 401, badKey: true });
        }

        if (!response.ok) {
            throw new W3bError('TornW3B HTTP ' + response.status, {
                http: response.status,
            });
        }

        try {
            const body = await response.json();
            this.paceAnswered();
            this.answered(path, tag, false);
            return body;
        } catch {
            // Cloudflare answers a challenge page with HTML, not JSON.
            this.coolDown();
            this.paceRefused();
            this.answered(path, tag, true);
            throw new W3bError('TornW3B returned a non-JSON page (blocked?).', {
                blocked: true,
            });
        }
    }
}

/**
 * Cheapest bazaar price for every item, in one request.
 *
 * @returns {Promise<Array<{itemId: string, name: string, lowestPrice: number|null,
 *   marketPrice: number|null, bazaarAverage: number|null, totalBazaars: number}>>}
 */
export async function fetchW3bSummary(client, { tag = 'w.summary' } = {}) {
    const data = await client.get('marketplace', { tag });
    const items = data && Array.isArray(data.items) ? data.items : null;

    if (!items) throw new W3bError('TornW3B returned no item summary.');

    return items
        .filter((i) => i && Number.isFinite(Number(i.item_id)))
        .map((i) => ({
            itemId: String(i.item_id),
            name: i.item_name || '',
            lowestPrice: positiveOrNull(i.lowest_price),
            marketPrice: positiveOrNull(i.market_price),
            bazaarAverage: positiveOrNull(i.bazaar_average),
            totalBazaars: Number(i.total_bazaars) || 0,
        }));
}

/**
 * Every bazaar listing TornW3B knows for one item.
 *
 * Retries once when the payload says there are listings but sends none - a
 * known mid-scan glitch. `maxPrice` is deliberately NOT sent (see W3B_QUERY:
 * measured for 3.23.0, it did not help) - every listing is asked for.
 *
 * @returns {Promise<{listings: Array, total: number}>} raw listing objects
 */
export async function fetchW3bListings(client, itemId, { tag = null } = {}) {
    const path = 'marketplace/' + encodeURIComponent(String(itemId));

    let data = await client.get(path, { tag });

    const empty = (d) =>
        d &&
        Number(d.total_listings) > 0 &&
        Array.isArray(d.listings) &&
        d.listings.length === 0;

    if (empty(data)) data = await client.get(path, { tag });

    return {
        listings: data && Array.isArray(data.listings) ? data.listings : [],
        total: Number(data && data.total_listings) || 0,
    };
}

/**
 * An item's light list (3.26.0): GET /marketplace/{id}?filler=1 - by TornW3B's
 * spec the 10 cheapest listings with price and count, no seller, on a limit of
 * its own (200 a minute, 10,000 a day). The answer as it came: what it holds
 * is for core/cheap.js to say (parseW3bCheapest), since we know its shape from
 * the spec only.
 */
export function fetchW3bCheapest(client, itemId, { tag = 'w.cheap' } = {}) {
    return client.get('marketplace/' + encodeURIComponent(String(itemId)), { tag, query: { filler: 1 } });
}

/**
 * Every TornW3B buyer of one item (3.15): GET /api/marketplace/{id}/traders,
 * highest price first, at most 100 (`total_count` says how many there are:
 * 412 for Xanax on 2026-09-29, against ~290 lists we had read). Each comes
 * with their rating and when they were last active - free, where a Torn
 * profile call per trader cost the shared 70/min.
 *
 * `withinHours` (3.23.0): only those who traded in the last N hours are
 * asked for (`tradedWithinHours`) - the 100 of the answer are then not spent
 * on lists nobody trades on. `withinHours` in the answer says what was asked.
 *
 * @returns {Promise<{total: number, withinHours: number|null, traders: Array<{id, name, price, up, down, lastAction, lastTrade, listAt}>}>}
 */
export async function fetchW3bItemTraders(client, itemId, { tag = 'w.buyers', withinHours = null } = {}) {
    const hours = w3bWhole(withinHours, ...W3B_QUERY.tradedWithinHours);
    const data = await client.get('marketplace/' + encodeURIComponent(String(itemId)) + '/traders', { tag, query: hours ? { tradedWithinHours: hours } : null });
    const rows = data && Array.isArray(data.traders) ? data.traders : [];
    const sec = (x) => (Number(x) > 0 ? Number(x) * 1000 : null);
    return {
        total: Number(data && data.total_count) || rows.length,
        withinHours: hours,
        traders: rows
            .filter((t) => t && Number(t.player_id) > 0 && Number(t.price) > 0)
            .map((t) => ({
                id: String(t.player_id),
                name: t.player_name ? String(t.player_name) : null,
                price: Number(t.price),
                up: t.rating && Number.isFinite(Number(t.rating.upvotes)) ? Number(t.rating.upvotes) : null,
                down: t.rating && Number.isFinite(Number(t.rating.downvotes)) ? Number(t.rating.downvotes) : null,
                lastAction: sec(t.last_action),
                lastTrade: sec(t.last_trade),
                listAt: sec(t.pricelist_updated),
            })),
    };
}

/** A trader's price list, as a person sees it on TornW3B. */
export function w3bPriceListUrl(traderId) {
    return W3B_SITE_URL + '/pricelist/' + encodeURIComponent(String(traderId));
}

/**
 * One trader's TornW3B price list: GET /api/pricelist/{tornId}, which returns
 * [{itemId, name, buyPrice, ...}] (buyPrice 0 = not buying). A player with no
 * list gets [] or a 404; both come back as an empty body, not an error.
 *
 * @returns {Promise<Array>} the raw rows (see parseW3bPriceList)
 */
export async function fetchW3bPriceList(client, traderId) {
    const id = String(traderId).replace(/\D/g, '');
    if (!id) throw new W3bError('No trader id.');
    try {
        const body = await client.get('pricelist/' + id);
        return Array.isArray(body) ? body : [];
    } catch (error) {
        if (error && error.http === 404) return [];
        throw error;
    }
}

function positiveOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}
