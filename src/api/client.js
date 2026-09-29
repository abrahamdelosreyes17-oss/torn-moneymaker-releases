/*
 * The one place that talks to the network.
 *
 * Non-negotiables enforced here rather than by convention:
 *
 *   1. api.torn.com is the ONLY destination. The base URL is a constant and
 *      callers pass a path, never a URL. No third party ever receives a Torn
 *      key, because no third party can be addressed from this client.
 *   2. The key is never logged. Errors are redacted before they are thrown,
 *      so a stack trace pasted into Discord cannot leak it.
 *   3. Every call goes through one rate-limited queue (<=70/min against
 *      Torn's ~100/min ceiling) with request dedup and exponential backoff.
 *      A key that trips abuse detection is a worse outcome than a slow panel.
 */

import { gmFetch } from '../platform/gm.js';

export const TORN_API_BASE = 'https://api.torn.com/';

/** Torn error codes worth reacting to specifically. */
export const TORN_ERROR_KEY_INVALID = 2;
export const TORN_ERROR_RATE_LIMIT = 5;
export const TORN_ERROR_IP_BLOCK = 8;
export const TORN_ERROR_UNAVAILABLE = 9;
export const TORN_ERROR_KEY_DISABLED = 13;
export const TORN_ERROR_KEY_PAUSED = 18;

/**
 * Errors that mean "this key must not be used again until the user changes
 * it". Torn's docs: "Multiple requests using invalid keys may result in a
 * temporary IP ban - you must account for this by removing disabled or
 * invalid keys upon error."
 */
export const KEY_DEAD_CODES = new Set([
    TORN_ERROR_KEY_INVALID,
    TORN_ERROR_KEY_DISABLED,
    TORN_ERROR_KEY_PAUSED,
]);

/** Torn's rate block lasts "a small period"; 1-2-4s retries only burn it. */
export const RATE_LIMIT_BACKOFF_MS = 30000;

/**
 * After these answers EVERY tab stops asking Torn for a while (shared through
 * storage): asking through an IP block (8) only lengthens it, and a disabled
 * API (9) or a rate block (5) will not clear in seconds either.
 */
export const TORN_PAUSE_MS = {
    [TORN_ERROR_RATE_LIMIT]: RATE_LIMIT_BACKOFF_MS,
    [TORN_ERROR_IP_BLOCK]: 10 * 60 * 1000,
    [TORN_ERROR_UNAVAILABLE]: 2 * 60 * 1000,
};

/** A hidden tab waiting for a slot checks again this often. */
const HIDDEN_POLL_MS = 1000;

/*
 * Priority lanes (3.15, the friend: "it struggles with the API, it maxes
 * out"). Every tab shares the one window, so each lane leaves room for the
 * lanes above it: a low call (a trader's status, networth, the Ledger
 * catching up) only goes while LOW_RESERVE slots are free, a normal one
 * (the Item Market feed, inventory) while NORMAL_RESERVE are. What you are
 * doing right now (Fill, pricing your bazaar, the item on screen) is never
 * kept waiting behind them, in this tab or another.
 */
export const API_PRIORITY = { low: 0, normal: 1, high: 2 };
export const NORMAL_RESERVE = 5;
export const LOW_RESERVE = 20;
/* Returned by a wait that gave way to a more urgent call. */
const YIELDED = Symbol('yielded');

export class TornApiError extends Error {
    constructor(message, { code = null, http = null, paused = false } = {}) {
        super(message);
        this.name = 'TornApiError';
        this.code = code;
        this.http = http;
        /** Refused by this client during a shared pause: nothing was sent. */
        this.paused = paused;
    }
}

function apiSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip anything that looks like an API key out of a string before it can
 * reach a console, an alert, or the panel.
 */
export function redactKey(text, key) {
    let out = String(text === null || text === undefined ? '' : text);

    if (key) out = out.split(key).join('<redacted>');

    // Belt and braces: catch a key that arrived from somewhere else.
    return out.replace(/key=[A-Za-z0-9]{8,}/g, 'key=<redacted>');
}

export class TornApiClient {
    /**
     * @param {object} options
     * @param {function(): string} options.getKey - returns the current API key
     * @param {function} [options.fetchImpl]      - injectable for tests
     * @param {number} [options.maxPerMinute]     - request ceiling
     * @param {number} [options.dedupTtlMs]       - reuse identical responses
     * @param {number} [options.maxRetries]
     * @param {function(): number[]} [options.loadWindow] - shared request
     *   timestamps, so every open Torn tab draws on ONE budget. Torn's limit
     *   is per user across all keys; a per-tab window let two tabs make
     *   140/min against a 100/min ceiling.
     * @param {function(number[])} [options.saveWindow]
     * @param {function(number)} [options.addToWindow] - record one slot of
     *   THIS tab (platform/tab-window.js); preferred over saveWindow, which
     *   writes the whole shared array back and can drop another tab's slot
     * @param {function} [options.loadPause] - () => {until, code} shared by every tab
     * @param {function} [options.savePause] - ({until, code}) => void
     * @param {function} [options.isVisible] - () => boolean; a request never
     *   leaves a hidden tab, even one that was queued while it was visible
     */
    constructor({
        getKey,
        fetchImpl = gmFetch,
        maxPerMinute = 70,
        dedupTtlMs = 5000,
        maxRetries = 3,
        loadWindow = null,
        saveWindow = null,
        rateLimitBackoffMs = RATE_LIMIT_BACKOFF_MS,
        loadPause = null,
        savePause = null,
        isVisible = () => true,
        addToWindow = null,
        onSent = null,
        onFailed = null,
    } = {}) {
        /** ({path, tag, error}) => void, a call that failed for good (not each retry): the problem log (3.15). */
        this.onFailed = onFailed;
        /** ({path, params, tag, priority}) => void, each request that leaves (retries too): the usage record. */
        this.onSent = onSent;
        this.addToWindow = addToWindow;
        this.loadPause = loadPause;
        this.savePause = savePause;
        this.isVisible = isVisible;
        this.pause = { until: 0, code: null };
        this.getKey = getKey;
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.dedupTtlMs = dedupTtlMs;
        this.maxRetries = maxRetries;
        this.loadWindow = loadWindow;
        this.saveWindow = saveWindow;
        this.rateLimitBackoffMs = rateLimitBackoffMs;

        /** Timestamps of recent requests, for the sliding window. */
        this.recent = [];
        /** Waiting calls, most urgent first; one runs at a time, so the window check cannot race. */
        this.queue = [];
        this.pumping = false;
        this.seq = 0;
        /** In-flight and recently-completed requests, keyed without the key. */
        this.inflight = new Map();
        this.cache = new Map();
    }

    /** Requests made in the last 60s, and room remaining. */
    stats(now = Date.now()) {
        this.syncWindow(now);
        const window = this.recent.filter((t) => now - t < 60000);
        return {
            usedLastMinute: window.length,
            remaining: Math.max(0, this.maxPerMinute - window.length),
        };
    }

    /**
     * Adopt the shared window: it already holds this tab's own requests,
     * because every slot taken is saved back to it. Replacing rather than
     * merging matters - two requests in the same millisecond are two
     * requests, and a Set of timestamps would count them as one.
     */
    syncWindow(now = Date.now()) {
        if (!this.loadWindow) return;

        let shared;
        try {
            shared = this.loadWindow();
        } catch {
            return;
        }
        if (!Array.isArray(shared)) return;

        this.recent = shared
            .filter((t) => Number.isFinite(t) && now - t < 60000)
            .sort((a, b) => a - b);
    }

    /** How many of the window's slots this lane may fill. */
    laneLimit(priority = API_PRIORITY.normal) {
        const reserve = priority >= API_PRIORITY.high ? 0 : priority >= API_PRIORITY.normal ? NORMAL_RESERVE : LOW_RESERVE;
        return Math.max(1, this.maxPerMinute - reserve);
    }

    /**
     * Block until the sliding window has room for one more request of this
     * lane. `shouldYield` (the first attempt only): a more urgent call has
     * arrived - give way to it (returns YIELDED, no slot taken).
     */
    async waitForSlot(priority = API_PRIORITY.high, shouldYield = null) {
        for (;;) {
            if (shouldYield && shouldYield()) return YIELDED;
            const now = Date.now();
            this.syncWindow(now);
            this.recent = this.recent.filter((t) => now - t < 60000);

            // Hidden: take no slot and send nothing until the tab is back.
            if (!this.isVisible()) {
                await apiSleep(HIDDEN_POLL_MS);
                continue;
            }

            const limit = this.laneLimit(priority);
            if (this.recent.length < limit) {
                this.recent.push(now);
                if (this.addToWindow) {
                    try {
                        this.addToWindow(now);
                    } catch {
                        // Best-effort, as below.
                    }
                } else if (this.saveWindow) {
                    try {
                        this.saveWindow(this.recent);
                    } catch {
                        // Sharing the window is best-effort; the local one
                        // still limits this tab.
                    }
                }
                return;
            }

            // The slot this lane waits for: the one that brings the window under its limit.
            const frees = this.recent[this.recent.length - limit] || this.recent[0];
            const wait = Math.max(50, 60000 - (now - frees) + 25);
            // Waiting with a lane below: look again each second for a more urgent call.
            await apiSleep(shouldYield ? Math.min(wait, 1000) : wait);
        }
    }

    /**
     * GET a Torn API path.
     *
     * @param {string} path - e.g. "torn" or "user" or "market/123"
     * @param {object} params - query params; `key` is added here and only here
     */
    async get(path, params = {}, { tag = null, priority = 'high' } = {}) {
        const cacheKey = path + '?' + new URLSearchParams(params).toString();
        const prio = API_PRIORITY[priority] ?? API_PRIORITY.high;

        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.at < this.dedupTtlMs) {
            return cached.data;
        }

        const existing = this.inflight.get(cacheKey);
        if (existing) {
            // Asked again, more urgently: the waiting call moves up.
            const job = this.queue.find((j) => j.cacheKey === cacheKey);
            if (job && prio > job.prio) job.prio = prio;
            return existing;
        }

        // Queued by lane (most urgent first, then in order), then a slot.
        const promise = new Promise((resolve, reject) => {
            this.queue.push({ seq: this.seq++, path, params, cacheKey, tag, prio, resolve, reject });
        });
        this.pump();
        this.inflight.set(cacheKey, promise);

        try {
            const data = await promise;
            this.pruneCache();
            this.cache.set(cacheKey, { at: Date.now(), data });
            return data;
        } finally {
            this.inflight.delete(cacheKey);
        }
    }

    /** The dedup cache is for bursts, not memory; a sweep adds hundreds. */
    pruneCache(now = Date.now()) {
        for (const [k, v] of this.cache) {
            if (now - v.at >= this.dedupTtlMs) this.cache.delete(k);
        }
    }

    /** Run the waiting calls one at a time, the most urgent first. */
    async pump() {
        if (this.pumping) return;
        this.pumping = true;
        try {
            while (this.queue.length) {
                this.queue.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
                const job = this.queue[0];
                const shouldYield = () => this.queue.some((j) => j !== job && j.prio > job.prio);
                let out;
                try {
                    out = { value: await this.execute(job.path, job.params, job.cacheKey, job, shouldYield) };
                } catch (error) {
                    out = { error };
                    if (this.onFailed) {
                        try {
                            this.onFailed({ path: job.path, tag: job.tag, error });
                        } catch {
                            // The log is best-effort.
                        }
                    }
                }
                if (out.value === YIELDED) continue;
                this.queue.splice(this.queue.indexOf(job), 1);
                if ('error' in out) job.reject(out.error);
                else job.resolve(out.value);
            }
        } finally {
            this.pumping = false;
        }
    }

    async execute(path, params, cacheKey, job = null, shouldYield = null) {
        const prio = job ? job.prio : API_PRIORITY.high;
        if (!this.fetchImpl) {
            throw new TornApiError('No fetch implementation available.');
        }

        const key = this.getKey ? this.getKey() : '';
        if (!key) {
            throw new TornApiError('No API key set.', {
                code: TORN_ERROR_KEY_INVALID,
            });
        }

        let attempt = 0;
        let lastError = null;
        // A pause this call started itself (a rate block it is waiting out)
        // does not stop its own retry; a longer one from elsewhere does.
        let mine = 0;

        while (attempt <= this.maxRetries) {
            this.throwIfPaused(mine);
            // Only the first wait gives way to a more urgent call (a retry keeps its turn).
            if ((await this.waitForSlot(prio, attempt === 0 ? shouldYield : null)) === YIELDED) return YIELDED;
            // Another tab may have hit a block while this one waited.
            this.throwIfPaused(mine);
            if (this.onSent) {
                try {
                    this.onSent({ path, params, tag: job ? job.tag : null, priority: prio });
                } catch {
                    // The usage record is best-effort.
                }
            }

            try {
                return await this.requestOnce(path, params, key);
            } catch (error) {
                lastError = error;
                mine = Math.max(mine, this.pauseFor(error));

                if (!this.isRetryable(error) || attempt === this.maxRetries) {
                    throw error;
                }

                // Torn's rate block outlasts a quick retry; wait it out.
                // Otherwise exponential backoff: 1s, 2s, 4s.
                const rateLimited =
                    error instanceof TornApiError &&
                    (error.code === TORN_ERROR_RATE_LIMIT || error.http === 429);

                await apiSleep(
                    rateLimited
                        ? this.rateLimitBackoffMs
                        : 1000 * Math.pow(2, attempt),
                );
                attempt += 1;
            }
        }

        throw lastError;
    }

    /** The shared pause, the later of this tab's and storage's. */
    currentPause(now = Date.now()) {
        let p = this.pause;
        if (this.loadPause) {
            try {
                const s = this.loadPause();
                if (s && Number(s.until) > p.until) p = { until: Number(s.until), code: s.code ?? null };
            } catch {
                // Sharing is best-effort.
            }
        }
        return now < p.until ? p : null;
    }

    throwIfPaused(ignoreUntil = 0) {
        const p = this.currentPause();
        if (!p || p.until <= ignoreUntil) return;
        const secs = Math.ceil((p.until - Date.now()) / 1000);
        const why = p.code === TORN_ERROR_IP_BLOCK ? 'Torn has blocked this IP for a while' : p.code === TORN_ERROR_UNAVAILABLE ? 'the Torn API is down' : 'Torn asked us to slow down';
        throw new TornApiError('Paused: ' + why + '. Trying again in ' + (secs >= 90 ? Math.ceil(secs / 60) + ' min' : secs + 's') + '.', { code: p.code, paused: true });
    }

    /** Start a shared pause after an answer that asking again cannot fix soon. */
    pauseFor(error) {
        const code = error instanceof TornApiError ? error.code : null;
        // Torn's code 5, or an HTTP 429 (no code): every tab slows down, not just this one.
        const rateLimited = code === TORN_ERROR_RATE_LIMIT || (error instanceof TornApiError && error.http === 429);
        const ms = rateLimited ? this.rateLimitBackoffMs : TORN_PAUSE_MS[code];
        if (!ms || error.paused) return 0;
        const until = Date.now() + ms;
        if (until <= this.pause.until) return until;
        this.pause = { until, code };
        if (this.savePause) {
            try {
                this.savePause(this.pause);
            } catch {
                // This tab still pauses.
            }
        }
        return until;
    }

    isRetryable(error) {
        // A shared pause is waited out by the caller, not retried here.
        if (error instanceof TornApiError && error.paused) return false;
        if (error instanceof TornApiError && error.code === TORN_ERROR_UNAVAILABLE) return false;
        if (!(error instanceof TornApiError)) return true;

        if (error.code === TORN_ERROR_RATE_LIMIT) return true;
        if (error.code === TORN_ERROR_UNAVAILABLE) return true;
        if (error.http && error.http >= 500) return true;
        if (error.http === 429) return true;

        // A bad key or an IP block will not fix itself by asking again.
        return false;
    }

    async requestOnce(path, params, key) {
        /*
         * v1 paths take a trailing slash ("torn/?selections=items" is the form
         * verified in game). v2 paths are written without one everywhere they
         * are documented, so they are left exactly as given.
         */
        const clean = String(path).replace(/^\/+/, '');
        const url = new URL(
            /^v2\//.test(clean) ? clean : clean + '/',
            TORN_API_BASE,
        );

        /*
         * A relative path resolves under the base, but an ABSOLUTE one
         * ("https://elsewhere/steal") overrides it entirely — and the key is
         * attached below. The base being a constant is therefore not enough
         * on its own; this is the assertion that actually enforces "one
         * destination".
         */
        if (url.hostname !== 'api.torn.com') {
            throw new TornApiError(
                'Refusing to send the API key to ' + url.hostname + '.',
            );
        }

        for (const [name, value] of Object.entries(params || {})) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(name, String(value));
        }
        url.searchParams.set('key', key);
        url.searchParams.set('comment', 'TornTradingV2');

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            throw new TornApiError(
                'Network error: ' + redactKey(error && error.message, key),
            );
        }

        if (!response.ok) {
            throw new TornApiError('HTTP ' + response.status, {
                http: response.status,
            });
        }

        let data;
        try {
            data = await response.json();
        } catch {
            throw new TornApiError('Torn API returned invalid JSON.');
        }

        /*
         * Errors arrive as HTTP 200 with { error: { code, error } } - and
         * some v2 endpoints are reported to put { code, error } at the top
         * level instead. Read both, or a v2 error looks like an empty result.
         */
        const err =
            data && data.error && typeof data.error === 'object'
                ? data.error
                : data &&
                    Number.isFinite(Number(data.code)) &&
                    typeof data.error === 'string'
                  ? { code: Number(data.code), error: data.error }
                  : null;

        if (err) {
            throw new TornApiError(
                'Torn API ' + err.code + ': ' + redactKey(err.error, key),
                { code: Number(err.code) },
            );
        }

        return data;
    }
}
