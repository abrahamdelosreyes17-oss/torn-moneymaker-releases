/*
 * The speed log's recorder (3.17.0): the browser side of core/speed.js.
 *
 * It times work that is already happening (perfNow / perfDone around it),
 * listens to what the browser itself reports - long tasks (the tab stuck for
 * 50 ms or more) and slow clicks and key presses (the Event Timing entries
 * over 100 ms) - and is told of every read and write of a stored value
 * (platform/gm.js). Everything goes into counters in memory; the record is
 * written at most once a minute and when the tab goes, added to what the
 * other tabs stored.
 *
 * It reads nothing of the page and sends nothing anywhere: the record leaves
 * only inside a zip the player downloads (Report a problem, Export API usage).
 */

import { gmGet, gmSet, gmSetProbe } from './gm.js';
import { speedNew, speedAdd, speedStore, speedForeign, speedStartup, speedMachine, speedHasData, speedMerge } from '../core/speed.js';

/** The stored record: every tab adds to it (core/speed.js speedMerge). */
export const SPEED_STORE_KEY = 'speedLog';
/** A tab writes its counts this often at most. */
export const SPEED_FLUSH_MS = 60 * 1000;

const perfHasClock = typeof performance !== 'undefined' && typeof performance.now === 'function';
let perfPending = speedNew();
let perfTimer = null;
let perfWhereOf = () => 'page';
let perfStarted = false;

function perfWhere() {
    let w = 'page';
    try {
        w = String(perfWhereOf() || 'page');
    } catch {
        w = 'page';
    }
    return typeof document !== 'undefined' && document.visibilityState === 'hidden' ? w + ' (hidden tab)' : w;
}

function perfArm() {
    if (!perfTimer && perfStarted) perfTimer = setTimeout(perfFlush, SPEED_FLUSH_MS);
}

/** A clock read, to hand back to perfDone. */
export function perfNow() {
    return perfHasClock ? performance.now() : 0;
}

/** The work that started at `t0` is done: counted under `kind`. */
export function perfDone(kind, t0) {
    if (!perfHasClock || !perfStarted) return;
    speedAdd(perfPending, 'w', kind, performance.now() - t0, perfWhere());
    perfArm();
}

/** Run `fn`, timed under `kind`; its result (or its error) passes through untouched. */
export function perfTimed(kind, fn) {
    if (!perfHasClock || !perfStarted) return fn();
    const t0 = performance.now();
    try {
        return fn();
    } finally {
        speedAdd(perfPending, 'w', kind, performance.now() - t0, perfWhere());
        perfArm();
    }
}

/** A change in the rows we watch that we did not make (`records`: how many changes it held). */
export function perfForeign(records) {
    if (!perfStarted) return;
    speedForeign(perfPending, records);
    perfArm();
}

/** This page load's start-up marks (ms after the page began to load). */
export function perfStartup(marks) {
    if (!perfStarted) return;
    speedStartup(perfPending, perfWhere(), marks);
    perfArm();
}

/** This tab's counts, added to the stored record. */
export function perfFlush() {
    if (perfTimer) clearTimeout(perfTimer);
    perfTimer = null;
    if (!speedHasData(perfPending)) return;
    const p = perfPending;
    perfPending = speedNew();
    try {
        gmSet(SPEED_STORE_KEY, speedMerge(gmGet(SPEED_STORE_KEY, null), p));
    } catch {
        /* a full or refused store: this minute's counts are let go, never an error on the page */
    }
}

/** The stored record with this tab's pending counts, for an export (nothing is written). */
export function perfRecord(now = Date.now()) {
    return speedMerge(gmGet(SPEED_STORE_KEY, null), perfPending, now);
}

/** What the browser says of the machine - what any page can read, nothing more. */
export function perfMachine() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const scr = typeof screen !== 'undefined' ? screen : null;
    const out = {};
    if (nav.hardwareConcurrency) out['processor threads'] = nav.hardwareConcurrency;
    // The browser rounds this down and stops at 8.
    if (nav.deviceMemory) out['memory (GB, the browser says at least)'] = nav.deviceMemory;
    if (scr) out.screen = scr.width + 'x' + scr.height;
    if (typeof devicePixelRatio === 'number') out['pixel ratio'] = Math.round(devicePixelRatio * 100) / 100;
    if (typeof innerWidth === 'number') out.window = innerWidth + 'x' + innerHeight;
    return out;
}

/**
 * Start recording in this tab.
 * @param {object} o
 * @param {function(): string} o.where - the kind of page this tab is on now ("bazaar", "trade", "Torn Bids")
 */
export function perfStart({ where }) {
    if (perfStarted || !perfHasClock || typeof window === 'undefined') return;
    perfStarted = true;
    if (typeof where === 'function') perfWhereOf = where;
    speedMachine(perfPending, perfMachine());
    gmSetProbe((key, write, ms, size) => {
        // Its own record is left out: a write that counted itself would always leave
        // something to write, and every tab would then write once a minute for ever.
        if (key === SPEED_STORE_KEY) return;
        speedStore(perfPending, key, write, ms, size);
        perfArm();
    });
    window.addEventListener('pagehide', perfFlush);
    if (typeof PerformanceObserver !== 'function') return;
    const types = PerformanceObserver.supportedEntryTypes || [];
    // The tab stuck for 50 ms or more: any script on the page, as the browser counts it.
    if (types.includes('longtask')) {
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) speedAdd(perfPending, 'f', 'freeze', e.duration, perfWhere());
                perfArm();
            }).observe({ type: 'longtask', buffered: true });
        } catch {
            /* not offered here */
        }
    }
    // A click or key press that took over 100 ms to show. One press makes several entries
    // (pointer down, up, click): each press is counted once, at its longest.
    if (types.includes('event')) {
        const seen = new Map();
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    const id = e.interactionId;
                    if (!id || !(e.duration > 100)) continue;
                    if (seen.has(id)) continue;
                    seen.set(id, true);
                    if (seen.size > 200) seen.delete(seen.keys().next().value);
                    speedAdd(perfPending, 'i', /^key/.test(e.name) ? 'key press' : 'click', e.duration, perfWhere());
                }
                perfArm();
            }).observe({ type: 'event', durationThreshold: 104, buffered: true });
        } catch {
            /* not offered here */
        }
    }
}
