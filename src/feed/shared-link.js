/**
 * Shared: the exchange with the shared server, every 30 s, by one tab.
 *
 * Every open part of the script (the overlay's tabs, Torn Bids' tabs) says what
 * it wants under its own name; one tab - whichever holds the lead - sends them
 * together with this PC's Torn use, and stores what comes back for all of them:
 * the server's reads of bazaars (in sixteen pieces, so a change rewrites little)
 * and this PC's part of its Torn limit.
 *
 * Nobody sets it up: the address is built in and this PC's word is made from its
 * Public key (main.js, sharedSetUp). Without either, none of this runs and nothing
 * is sent; a server that does not know this PC is asked again a few times a day.
 * With the server down, the reads kept so far age out and everything works as
 * it did before.
 *
 * Everything it touches is passed in (storage, the request, the clock), so it
 * runs whole in test/shared-link.test.js against the real server code.
 */

import { decideLeader } from '../core/leader.js';
import { usageCallsOut, usageCallsSent } from '../core/usage.js';
import {
    SHARED_SYNC_MS, SHARED_BUCKETS, sharedAddress, sharedPassOk, sharedBody, sharedOutgoingOk, sharedVersion, sharedTake, sharedPrune,
    sharedReadBucket, sharedIndex, sharedInterest, sharedPerson, sharedMarks, sharedMarksIn, sharedMarksNow,
    sharedDir, sharedDirIn,
    sharedList, sharedListsIn, sharedAskIn,
} from '../core/shared.js';

export const SHARED_CONFIG_KEY = 'sharedConfig';
export const SHARED_STATE_KEY = 'sharedState';
export const SHARED_GRANT_KEY = 'sharedGrant';
export const SHARED_MARKS_KEY = 'sharedMarks';
const SHARED_LEADER_KEY = 'sharedLeader';
const SHARED_INTEREST_KEY = 'sharedInterest';
const SHARED_ASK_KEY = 'sharedAsk';
/* 3.26.0 - TornW3B's work, handed out by the server (core/shared.js): what it said is this PC's to read ... */
export const SHARED_W3B_ASK_KEY = 'sharedW3bAsk';
/* ... the trader lists this PC read, waiting to be sent (written by Torn Bids' page) ... */
export const SHARED_LISTS_OUT_KEY = 'sharedListsOut';
/* ... and the ones another person's PC read, for Torn Bids' page to take: {at, n, lists}. */
export const SHARED_LISTS_IN_KEY = 'sharedListsIn';
const SHARED_LISTS_IN_KEEP = 20;
/* The other PCs' TornW3B reads and this PC's turn among them (core/shared.js, sharedDirIn). */
export const SHARED_DIR_KEY = 'sharedDir';
// 3.26.2 - this PC's request counts waiting to be sent, every tab's in one sum (core/usage.js usageCallsAdd).
export const SHARED_CALLS_KEY = 'sharedCalls';
const SHARED_WANT_PREFIX = 'sharedWant.';
const SHARED_READS_PREFIX = 'sharedReads.';
export const SHARED_WORLDS = ['app', 'sell'];
export const SHARED_TICK_MS = 3000;
// What a part of the script wants is written again when it changed, and at least this often.
const SHARED_WANT_EVERY_MS = 45000;
const SHARED_WANT_LIVE_MS = 2 * 60000;
// A tab whose Torn calls are waiting asks for an exchange sooner, but never closer than this.
const SHARED_SOON_MS = 6000;
// The server sends at most this many bazaars in one answer; a full answer means there are more.
const SHARED_PAGE = 400;
const SHARED_MAX_PAGES = 5;
const SHARED_PRUNE_EVERY_MS = 10 * 60000;
const SHARED_WORTH_EVERY_MS = 10 * 60000;
// A PC the server does not know (anyone may install Torn Bids): asked again this often, in case its owner let it in.
export const SHARED_UNKNOWN_MS = 6 * 60 * 60000;
// 3.26.0: the first askings after a "not known" come sooner - a key its owner adds is let in within the hour,
// not six hours later - then every SHARED_UNKNOWN_MS as before: a stranger's copy still asks four times a day.
export const SHARED_UNKNOWN_STEPS_MS = [5 * 60000, 15 * 60000, 60 * 60000];
/** The wait after the n-th "not known" in a row (1 = the first). */
export function sharedUnknownWait(tries) {
    const n = Number.isInteger(tries) && tries > 0 ? tries : 1;
    return SHARED_UNKNOWN_STEPS_MS[n - 1] ?? SHARED_UNKNOWN_MS;
}

export class SharedLink {
    /**
     * @param {object} d
     * @param {string} d.tabId
     * @param {string} d.world - 'app' (the overlay) or 'sell' (Torn Bids)
     * @param {(key: string) => *} d.load
     * @param {(key: string, value: *) => void} d.save
     * @param {(key: string) => void} d.del
     * @param {(url: string, options: object) => Promise<{ok, status, json}>} d.post
     * @param {() => {used: number, waiting: number}} d.getUse - this PC's Torn calls of the last minute, and waiting
     * @param {() => (object|null)} d.getWant - {sellers, trades, looking, worth} of this part of the script
     * @param {() => void} d.onReads - the kept reads changed
     * @param {() => number} [d.now]
     */
    constructor(d) {
        this.d = d;
        this.now = d.now || (() => Date.now());
        this.busy = false;
        this.leading = false;
        this.buckets = null;
        this.kept = null; // sharedIndex(), built when asked for
        this.rev = null;
        this.interest = null;
        this.gen = 0;
        this.grantKept = undefined;
        this.marksKept = undefined;
        this.dirKept = undefined;
        this.wantJson = '';
        this.wantAt = 0;
        this.worthJson = '';
        this.worthAt = 0;
        this.prunedAt = 0;
    }

    /** {address, pass}, or null when Shared is off. */
    config() {
        const c = this.d.load(SHARED_CONFIG_KEY);
        const address = c ? sharedAddress(c.address) : null;
        return address && sharedPassOk(c.pass) ? { address, pass: c.pass } : null;
    }

    /** This PC's part of its Torn limit, as the server last gave it (null = on its own). */
    grant() {
        if (!this.config()) return null;
        if (this.grantKept === undefined) this.grantKept = this.d.load(SHARED_GRANT_KEY) || null;
        return this.grantKept;
    }

    /**
     * The others' marks to go by now: {going: [{who, whoId, item, at, sellers}], bought: [{who, whoId, seller, item, qty, price, at}]}.
     * Empty with Shared off; nobody is "going for" anything once the server has been silent two minutes.
     */
    marks(now = this.now()) {
        if (!this.config()) return { going: [], bought: [] };
        if (this.marksKept === undefined) this.marksKept = this.d.load(SHARED_MARKS_KEY) || null;
        return sharedMarksNow(this.marksKept, (this.d.load(SHARED_STATE_KEY) || {}).okAt, now);
    }

    /** What the server last handed out of TornW3B's sellers lists: {at, want, ask}, or null (core/shared.js sharedMayRead). */
    w3bAsk() {
        if (!this.config()) return null;
        if (this.w3bAskKept === undefined) this.w3bAskKept = this.d.load(SHARED_W3B_ASK_KEY) || null;
        return this.w3bAskKept;
    }

    /** The other PCs' TornW3B reads and this PC's turn; alone (and with Shared off) every item is this PC's. */
    dir() {
        if (!this.config()) return { reads: {}, turn: { of: 1, me: 0 } };
        if (this.dirKept === undefined) this.dirKept = this.d.load(SHARED_DIR_KEY) || null;
        return this.dirKept || { reads: {}, turn: { of: 1, me: 0 } };
    }

    loadInterest() {
        if (this.interest) return;
        const stored = this.d.load(SHARED_INTEREST_KEY);
        this.interest = new Map();
        this.gen = 0;
        if (stored && Number.isInteger(stored.gen) && stored.items && typeof stored.items === 'object') {
            for (const [id, gen] of Object.entries(stored.items)) {
                if (/^\d{1,10}$/.test(id) && Number.isInteger(gen) && gen <= stored.gen) this.interest.set(id, gen);
            }
            this.gen = stored.gen;
        }
    }

    loadBuckets(only = null) {
        if (!this.buckets) {
            this.buckets = Array.from({ length: SHARED_BUCKETS }, () => ({}));
            only = null;
        }
        for (let i = 0; i < SHARED_BUCKETS; i += 1) {
            if (only && !only.includes(i)) continue;
            this.buckets[i] = sharedReadBucket(this.d.load(SHARED_READS_PREFIX + i));
        }
        this.kept = null;
    }

    /** The server's reads, laid out for reading: {index, joined} for withShared(); null when Shared is off. */
    reads() {
        if (!this.config()) return null;
        if (!this.buckets) this.loadBuckets();
        this.loadInterest();
        if (!this.kept) this.kept = sharedIndex(this.buckets);
        return { index: this.kept, joined: this.interest };
    }

    /** Another tab stored something of Shared: take it. */
    onStored(key) {
        if (key === SHARED_GRANT_KEY) {
            this.grantKept = undefined;
        } else if (key === SHARED_DIR_KEY) {
            this.dirKept = undefined;
        } else if (key === SHARED_W3B_ASK_KEY) {
            this.w3bAskKept = undefined;
        } else if (key === SHARED_MARKS_KEY) {
            this.marksKept = undefined;
            this.d.onReads();
        } else if (key === SHARED_CONFIG_KEY) {
            this.grantKept = undefined;
            this.marksKept = undefined;
            this.dirKept = undefined;
            this.w3bAskKept = undefined;
            this.buckets = null;
            this.kept = null;
            this.d.onReads();
        } else if (key === SHARED_STATE_KEY) {
            const state = this.d.load(SHARED_STATE_KEY) || {};
            if (state.rev === this.rev) return;
            // One step on: only the pieces it names. Anything else: all of them.
            const step = Number.isInteger(this.rev) && state.rev === this.rev + 1 && Array.isArray(state.touched);
            this.rev = state.rev;
            this.interest = null;
            if (this.buckets) this.loadBuckets(step ? state.touched : null);
            this.d.onReads();
        }
    }

    /**
     * Asks whichever tab leads for an exchange soon: this tab's Torn calls are waiting on its part.
     * `waiting`: how many, so the leading tab can ask for room for them too.
     */
    askSoon(waiting = 0) {
        if (this.config()) this.d.save(SHARED_ASK_KEY, { at: this.now(), n: Number.isFinite(waiting) && waiting > 0 ? Math.floor(waiting) : 0, tab: this.d.tabId });
    }

    /** The last ask: {at, n, tab}; at 0 when there is none. */
    asked() {
        const a = this.d.load(SHARED_ASK_KEY);
        return a && typeof a === 'object' && Number.isFinite(a.at) ? a : { at: 0, n: 0, tab: null };
    }

    /** What this part of the script wants, written for the leading tab when it changed. */
    writeWant(now) {
        const want = this.d.getWant();
        if (!want) return;
        // Stored as it may be sent: ids and prices only, each once, no more than the limits.
        // The two marks keep their times (this PC's clock); they become ages when they are sent.
        const clean = sharedBody({ wants: [want] });
        const marks = sharedMarks([want], now);
        const dir = sharedDir([want]);
        // TornW3B's work (3.26.0): what this part would read next, what is left of the limit, and whether it takes trader lists.
        const w3b = clean.want ? { want: clean.want, w3b: clean.w3b } : {};
        const takes = want.lists ? { lists: true } : {};
        const json = JSON.stringify([clean.sellers, clean.trades, clean.looking, clean.worth, marks.going, marks.bought, dir, w3b, takes]);
        if (json === this.wantJson && now - this.wantAt < SHARED_WANT_EVERY_MS) return;
        this.wantJson = json;
        this.wantAt = now;
        this.d.save(SHARED_WANT_PREFIX + this.d.world, { at: now, sellers: clean.sellers, trades: clean.trades, looking: clean.looking, worth: clean.worth, going: marks.going, bought: marks.bought, dir, ...w3b, ...takes });
    }

    /**
     * 3.26.2 - a page opened for the first time talks to the server before it knows what it watches, and keeps
     * nothing of that answer about the items it learns of next. When the items it now watches and never asked
     * about outnumber the ones it has asked about, the next exchange comes soon, not half a minute on. The
     * known ones at least double each time, so this happens a handful of times in a PC's life.
     */
    muchNew(now) {
        this.loadInterest();
        let fresh = 0;
        for (const w of SHARED_WORLDS) {
            const want = this.d.load(SHARED_WANT_PREFIX + w);
            if (!want || now - want.at >= SHARED_WANT_LIVE_MS) continue;
            for (const id of Object.keys(want.worth || {})) {
                if (this.interest.has(id)) continue;
                fresh += 1;
                if (fresh > this.interest.size) return true;
            }
        }
        return false;
    }

    /** Call every SHARED_TICK_MS. */
    async tick() {
        const now = this.now();
        const cfg = this.config();
        if (!cfg) {
            this.leading = false;
            return;
        }
        this.writeWant(now);
        const decision = decideLeader(this.d.load(SHARED_LEADER_KEY), this.d.tabId, { now, visible: true, staleMs: SHARED_TICK_MS * 4 });
        if (decision.write) this.d.save(SHARED_LEADER_KEY, decision.write);
        this.leading = decision.lead;
        if (!decision.confirmed || this.busy) return;

        const state = this.d.load(SHARED_STATE_KEY) || {};
        const since = now - (state.syncAt || 0);
        if (state.unknown && since < sharedUnknownWait(state.unknownTries)) return;
        const asked = this.asked().at;
        const soon = since >= SHARED_SOON_MS && ((asked >= (state.syncAt || 0) && asked > 0) || this.muchNew(now));
        if (since < SHARED_SYNC_MS && !soon) return;

        this.busy = true;
        try {
            await this.exchange(cfg, state);
        } finally {
            this.busy = false;
        }
    }

    async exchange(cfg, before) {
        const startedAt = this.now();
        this.loadInterest();
        if (!this.buckets) this.loadBuckets();
        const wants = SHARED_WORLDS.map((w) => this.d.load(SHARED_WANT_PREFIX + w)).filter((w) => w && startedAt - w.at < SHARED_WANT_LIVE_MS);

        // A new item to watch: what is kept says nothing about it, so everything is asked for again.
        const items = new Set();
        for (const w of wants) for (const id of Object.keys(w.worth || {})) items.add(id);
        const grown = sharedInterest(this.interest, this.gen, items);
        let seq = Number.isInteger(before.seq) ? before.seq : 0;
        if (grown.grew) {
            this.gen = grown.gen;
            this.d.save(SHARED_INTEREST_KEY, { gen: this.gen, items: Object.fromEntries(this.interest) });
            seq = 0;
        }

        const state = { ...before, syncAt: startedAt, error: null, unknown: false };
        // Trader lists (3.26.0): only while Torn Bids' page is open - it reads them, and it takes the others'.
        const takesLists = wants.some((w) => w.lists);
        if (!this.listsSent) this.listsSent = new Map();
        let listsAt = Number.isInteger(before.listsAt) && before.listsAt >= 0 ? before.listsAt : 0;
        const listsGot = [];
        const touched = new Set();
        let marksChanged = false;
        let born = before.born ?? null;
        let seen = Number.isFinite(before.seenAt) ? before.seenAt : 0;
        try {
            for (let page = 0; page < SHARED_MAX_PAGES; page += 1) {
                const now = this.now();
                const use = this.d.getUse() || {};
                // Another tab's calls held back since the last exchange: room is asked for them too.
                const ask = this.asked();
                const others = ask.tab !== this.d.tabId && startedAt - ask.at < SHARED_SYNC_MS * 2 ? ask.n : 0;
                const probe = sharedBody({ wants, sendWorth: true });
                const ver = this.d.version || null;
                const worthJson = JSON.stringify(probe.worth);
                const sendWorth = page === 0 && (worthJson !== this.worthJson || now - this.worthAt >= SHARED_WORTH_EVERY_MS || born === null);
                // The lists read since the last exchange that took them, on the first page only.
                const listsOut = takesLists && page === 0
                    ? (this.d.load(SHARED_LISTS_OUT_KEY) || []).map(sharedList).filter((l) => l && this.listsSent.get(l[0]) !== l[1])
                    : [];
                // This PC's own request counts since the last answered exchange, on the first page only ({} = none made).
                const callsOut = page === 0 ? usageCallsOut(this.d.load(SHARED_CALLS_KEY), now) : null;
                const body = sharedBody({ used: use.used, waiting: (Number(use.waiting) || 0) + others, wants: page === 0 ? wants : wants.map(({ want, w3b, ...w }) => w), since: seq, seen, sendWorth, now, ver, lists: listsOut, listsSince: takesLists && page === 0 ? listsAt : null, calls: callsOut });
                if (!sharedOutgoingOk(body)) throw new Error('Not sent: the message was not in the agreed shape.');

                const response = await this.d.post(`${cfg.address}/sync`, {
                    headers: { Authorization: `Bearer ${cfg.pass}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (response.status === 404) {
                    state.unknown = true;
                    state.unknownTries = (Number.isInteger(before.unknownTries) ? before.unknownTries : 0) + 1;
                    throw new Error('The server does not know this PC.');
                }
                // Whoever runs the server asked for a newer Torn Bids. Our Torn use was still counted there, so
                // the split of the 100 is kept; nothing else is exchanged until this copy is updated.
                if (response.status === 426) {
                    let told = null;
                    try {
                        told = await response.json();
                    } catch {
                        // no body to read: the version asked for is not known
                    }
                    const got = this.now();
                    if (told && told.grant) {
                        const skew = got - (Number.isFinite(told.grant.at) ? told.grant.at : got);
                        this.grantKept = {
                            at: got,
                            need: told.grant.need,
                            serverShare: told.grant.serverShare,
                            serverTimes: (Array.isArray(told.grant.serverTimes) ? told.grant.serverTimes : []).filter(Number.isFinite).map((t) => t + skew),
                        };
                        this.d.save(SHARED_GRANT_KEY, this.grantKept);
                    }
                    state.update = sharedVersion(told && told.need) || 'a newer version';
                    state.reading = null;
                    break;
                }
                if (!response.ok) throw new Error(`The server answered with status ${response.status}.`);
                const answer = await response.json();
                if (!answer || typeof answer !== 'object' || !answer.grant) throw new Error('The server answered with something else.');
                const got = this.now();

                // The server's clock, turned into this PC's: its calls of the last minute as this PC counts time.
                const skew = got - (Number.isFinite(answer.grant.at) ? answer.grant.at : got);
                this.grantKept = {
                    at: got,
                    need: answer.grant.need,
                    serverShare: answer.grant.serverShare,
                    serverTimes: (Array.isArray(answer.grant.serverTimes) ? answer.grant.serverTimes : []).filter(Number.isFinite).map((t) => t + skew),
                };
                this.d.save(SHARED_GRANT_KEY, this.grantKept);

                if (sendWorth) {
                    this.worthJson = worthJson;
                    this.worthAt = now;
                }
                // A server that started afresh has forgotten what the items are worth: told again next time.
                if (answer.born !== undefined && answer.born !== born) {
                    if (born !== null) this.worthJson = '';
                    born = answer.born;
                }
                // Another tab stored its own exchange while this one waited for the answer (onStored lets go of what
                // is kept): taken up again first. 3.26.0 read a null here - "Cannot read properties of null".
                this.loadInterest();
                if (!this.buckets) this.loadBuckets();
                for (const b of sharedTake(this.buckets, answer, this.interest, this.gen, got)) touched.add(b);
                // The others' marks: stored only when they changed.
                if (this.marksKept === undefined) this.marksKept = this.d.load(SHARED_MARKS_KEY) || null;
                const marks = sharedMarksIn(answer, this.marksKept, got);
                if (JSON.stringify(marks) !== JSON.stringify(this.marksKept || { going: [], bought: [] })) {
                    this.marksKept = marks;
                    this.d.save(SHARED_MARKS_KEY, marks);
                    marksChanged = true;
                }
                if (this.dirKept === undefined) this.dirKept = this.d.load(SHARED_DIR_KEY) || null;
                const dirNow = sharedDirIn(answer, this.dirKept, got);
                if (JSON.stringify(dirNow) !== JSON.stringify(this.dirKept)) {
                    this.dirKept = dirNow;
                    this.d.save(SHARED_DIR_KEY, dirNow);
                }
                state.turn = dirNow.turn;
                if (page === 0 && body.calls) {
                    // Answered: what was sent comes off the sum (what the tabs counted meanwhile stays for the next one).
                    const sum = Object.values(body.calls).reduce((a, n) => a + n, 0);
                    if (sum) this.d.save(SHARED_CALLS_KEY, usageCallsSent(this.d.load(SHARED_CALLS_KEY), body.calls, got));
                    state.callsOut = (Number.isInteger(before.callsOut) ? before.callsOut : 0) + sum;
                    state.callsSyncs = (Number.isInteger(before.callsSyncs) ? before.callsSyncs : 0) + 1;
                }
                if (page === 0) {
                    // TornW3B's work: which of the wanted sellers lists are this PC's, and the others' trader lists.
                    for (const l of body.lists || []) this.listsSent.set(l[0], l[1]);
                    if (this.listsSent.size > 500) this.listsSent = new Map([...this.listsSent].slice(-250));
                    const handed = sharedAskIn(answer, body.want || [], got, Array.isArray(body.w3b) ? body.w3b[0] : null);
                    if (JSON.stringify(handed) !== JSON.stringify(this.w3bAsk())) {
                        this.w3bAskKept = handed;
                        if (handed) this.d.save(SHARED_W3B_ASK_KEY, handed);
                        else this.d.del(SHARED_W3B_ASK_KEY);
                    }
                    state.w3bAsk = handed ? [handed.ask.length, handed.want.length] : null;
                    if (takesLists) {
                        listsGot.push(...sharedListsIn(answer));
                        if (Number.isInteger(answer.listsAt) && answer.listsAt >= 0) listsAt = answer.listsAt;
                        state.listsOut = (Number.isInteger(before.listsOut) ? before.listsOut : 0) + (body.lists || []).length;
                    }
                }
                if (Number.isInteger(answer.seq)) seq = answer.seq;
                if (Number.isFinite(answer.now)) seen = answer.now;
                state.okAt = got;
                state.unknownTries = 0;
                state.update = null;
                state.reading = answer.state ?? null;
                state.key = answer.key ?? null;
                state.need = answer.grant.need;
                state.serverShare = answer.grant.serverShare;
                state.serverUsed = this.grantKept.serverTimes.length;
                // How many of us, which of the others are on, and whose key the server holds for this password:
                // Torn ids and Torn names as the server got them from Torn, checked again here.
                state.people = Number.isInteger(answer.people) && answer.people > 0 ? answer.people : null;
                state.on = (Array.isArray(answer.on) ? answer.on : []).slice(0, 20).map(sharedPerson);
                state.you = sharedPerson(answer.you);
                if (!Array.isArray(answer.reads) || answer.reads.length < SHARED_PAGE) break;
            }
        } catch (error) {
            state.error = String(error && error.message ? error.message : error).slice(0, 160);
        }

        if (startedAt - this.prunedAt >= SHARED_PRUNE_EVERY_MS) {
            this.prunedAt = startedAt;
            for (const b of sharedPrune(this.buckets, this.now())) touched.add(b);
        }
        for (const b of touched) this.d.save(SHARED_READS_PREFIX + b, this.buckets[b]);
        if (listsGot.length) {
            // For Torn Bids' page to take: the newest kept, numbered so each is taken once.
            const had = this.d.load(SHARED_LISTS_IN_KEY) || {};
            const n = (Number.isInteger(had.n) ? had.n : 0) + listsGot.length;
            this.d.save(SHARED_LISTS_IN_KEY, { at: startedAt, n, lists: [...(Array.isArray(had.lists) ? had.lists : []), ...listsGot].slice(-SHARED_LISTS_IN_KEEP) });
            state.listsIn = (Number.isInteger(before.listsIn) ? before.listsIn : 0) + listsGot.length;
        }
        state.listsAt = listsAt;
        state.seq = seq;
        state.seenAt = seen;
        state.born = born;
        state.touched = [...touched];
        state.rev = (Number.isInteger(before.rev) ? before.rev : 0) + 1;
        state.sellers = this.buckets.reduce((n, b) => n + Object.keys(b).length, 0);
        this.rev = state.rev;
        this.d.save(SHARED_STATE_KEY, state);
        if (touched.size) this.kept = null;
        if (touched.size || marksChanged) this.d.onReads();
    }

    /**
     * Ask again now (3.26.0): the same key was saved again while the server's last answer was "not known" - its
     * owner may just have let this PC in (2026-10-11: a key added on the server waited out six silent hours,
     * and saving it again changed nothing). The wait starts over; the tab that does the exchanging asks on its
     * next tick. @returns {boolean} whether there was a "not known" to ask again about
     */
    knock() {
        const state = this.d.load(SHARED_STATE_KEY) || {};
        if (!this.config() || !state.unknown) return false;
        this.d.save(SHARED_STATE_KEY, { ...state, syncAt: 0, unknownTries: 0 });
        return true;
    }

    /** The server's address or this PC's word changed, or there is none now: what was kept under the old one goes. */
    forget() {
        for (let i = 0; i < SHARED_BUCKETS; i += 1) this.d.del(SHARED_READS_PREFIX + i);
        for (const key of [SHARED_STATE_KEY, SHARED_GRANT_KEY, SHARED_MARKS_KEY, SHARED_INTEREST_KEY, SHARED_ASK_KEY, SHARED_DIR_KEY, SHARED_W3B_ASK_KEY, SHARED_LISTS_OUT_KEY, SHARED_LISTS_IN_KEY, SHARED_CALLS_KEY]) this.d.del(key);
        this.w3bAskKept = null;
        this.listsSent = new Map();
        this.buckets = null;
        this.kept = null;
        this.interest = null;
        this.gen = 0;
        this.rev = null;
        this.grantKept = null;
        this.marksKept = null;
        this.dirKept = null;
        this.worthJson = '';
    }

    /** What is known of the server, for the page. */
    status(now = this.now()) {
        const cfg = this.config();
        const state = this.d.load(SHARED_STATE_KEY) || {};
        return {
            on: Boolean(cfg),
            address: cfg ? cfg.address : null,
            leading: this.leading,
            okAt: state.okAt || null,
            syncAt: state.syncAt || null,
            error: state.error || null,
            reading: state.reading || null,
            update: state.update || null,
            key: state.key || null,
            need: Number.isFinite(state.need) ? state.need : null,
            serverShare: Number.isFinite(state.serverShare) ? state.serverShare : null,
            serverUsed: Number.isFinite(state.serverUsed) ? state.serverUsed : null,
            sellers: Number.isFinite(state.sellers) ? state.sellers : 0,
            people: Number.isInteger(state.people) ? state.people : null,
            peopleOn: Array.isArray(state.on) ? state.on : [],
            you: state.you || null,
            // TornW3B's work (3.26.0): [handed to this PC, wanted] at the last exchange; trader lists sent and taken so far.
            w3bAsk: Array.isArray(state.w3bAsk) ? state.w3bAsk : null,
            listsOut: Number.isInteger(state.listsOut) ? state.listsOut : 0,
            listsIn: Number.isInteger(state.listsIn) ? state.listsIn : 0,
            // 3.26.2: this PC's request counts told to the server so far, and in how many exchanges.
            callsOut: Number.isInteger(state.callsOut) ? state.callsOut : 0,
            callsSyncs: Number.isInteger(state.callsSyncs) ? state.callsSyncs : 0,
            unknown: Boolean(cfg && state.unknown),
            // When a PC the server does not know asks again (ms from the last asking).
            unknownWaitMs: cfg && state.unknown ? sharedUnknownWait(state.unknownTries) : null,
            now,
        };
    }
}
