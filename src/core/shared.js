/**
 * Shared: this PC's side of the shared server (server/).
 *
 * The server reads other players' bazaars from Torn with a key of each of us and
 * hands every PC what changed. Each PC tells it, every 30 s, how much of its own
 * Torn limit it is using and which bazaars matter to it. This module is the PC's
 * half of that exchange, without the network: what may be sent (and nothing
 * else), how the answers are kept, and how they correct the rows TornW3B gave.
 *
 * Pure: no clock, no storage, no network. Times are milliseconds, passed in.
 */

import { USAGE_CALLS_TAG, USAGE_CALLS_TAGS_MAX, USAGE_CALLS_COUNT_MAX } from './usage.js';

export const SHARED_SYNC_MS = 30000;
// The same split as server/src/budget.js (test/shared.test.js holds the two together):
// of Torn's 100 calls a minute per person, 20 are never used by the server or this PC.
const SHARED_USABLE = 80;
// No answer from the server for this long: this PC is on its own again, as with Shared off.
export const SHARED_GRANT_STALE_MS = 5 * 60000;
// A bazaar the server has not confirmed for this long is forgotten here.
export const SHARED_KEEP_MS = 3 * 60 * 60000;
export const SHARED_BUCKETS = 16;
const SHARED_MAX_SELLERS = 3000;
const SHARED_MAX_NEAR = 200;
const SHARED_MAX_WORTH = 5000;
const SHARED_BODY_KEYS = ['app', 'ver', 'used', 'waiting', 'sellers', 'trades', 'looking', 'worth', 'since', 'seen', 'going', 'bought', 'dir', 'want', 'w3b', 'lists', 'listsSince', 'calls', 'moves', 'ownSince', 'opens', 'drops'];
/*
 * 3.26.0, the server handing out TornW3B's work (its /sync, deployed 2026-10-11):
 *   want        the items whose sellers list this PC would ask TornW3B for next, most wanted first (60 at most)
 *   w3b         [sellers lists left this minute, left today] of this PC's own limit
 *   -> ask      the ones of `want` that are this PC's to read (another PC read the rest, or is better placed)
 *   lists       trader price lists this PC read from TornW3B: [trader, read at (ms), {item: price}] (5 a sync)
 *   listsSince  the answer's last `listsAt` (0 the first time)
 *   -> lists    lists another person's PC read; -> listsAt
 * TornW3B is still asked by each PC from its own address, under its own limit and name: the server only says
 * which PC reads what, so two PCs do not ask for the same list.
 */
export const SHARED_MAX_WANT = 60;
export const SHARED_MAX_LISTS = 5;
export const SHARED_MAX_LIST_ITEMS = 2500;
/** What the server handed out is gone by for this long after it was said (an exchange is every 30 s). */
export const SHARED_ASK_FRESH_MS = 45000;

/*
 * 3.28.0 - how fast items leave the bazaars, as the server counted it from its own reads of Torn:
 *   moves       the time of the table this PC holds (the server's clock; 0 for none)
 *   -> moves    {at, rows: [[item, units an hour]]} when the server has a newer one
 * Nothing new leaves this PC for it: one number.
 */
export const SHARED_MAX_MOVES = 3000;
/** The answer's table, checked: {at, rows: {item: units an hour}}, or null when the server sent none. */
export function sharedMovesIn(answer) {
    const m = answer && answer.moves;
    if (!m || typeof m !== 'object' || !Number.isInteger(m.at) || m.at <= 0 || m.at >= 1e13 || !Array.isArray(m.rows)) return null;
    const rows = {};
    let n = 0;
    for (const r of m.rows) {
        if (!Array.isArray(r) || r.length !== 2) continue;
        const item = sharedId(r[0]);
        if (item === null || typeof r[1] !== 'number' || !Number.isFinite(r[1]) || r[1] < 0 || r[1] > 1e7) continue;
        if (!(item in rows)) {
            if (n >= SHARED_MAX_MOVES) continue;
            n += 1;
        }
        rows[item] = r[1];
    }
    return { at: m.at, rows };
}

/*
 * 3.33.0 - prices falling (engines plan 4a): each watched item's lowest bazaar price, the server's sample every
 * ten minutes over the last day:
 *   drops       the time of the samples this PC holds (the server's clock; 0 for none)
 *   -> drops    {at, rows: [[item, [minutes ago, price, ...]]]} when the server has a newer sample
 */
export const SHARED_MAX_DROPS = 600;
const SHARED_MAX_DROP_SAMPLES = 24 * 6 + 1;
/** The answer's samples, checked: {at, rows: {item: [minutes ago, price, ...]}}, or null when the server sent none. */
export function sharedDropsIn(answer) {
    const m = answer && answer.drops;
    if (!m || typeof m !== 'object' || !Number.isInteger(m.at) || m.at <= 0 || m.at >= 1e13 || !Array.isArray(m.rows)) return null;
    const rows = {};
    let n = 0;
    for (const r of m.rows) {
        if (n >= SHARED_MAX_DROPS) break;
        if (!Array.isArray(r) || r.length !== 2 || !Array.isArray(r[1]) || r[1].length % 2 || r[1].length > 2 * SHARED_MAX_DROP_SAMPLES) continue;
        const item = sharedId(r[0]);
        if (item === null || item in rows || !r[1].every((v) => Number.isInteger(v) && v >= 0 && v < 1e13)) continue;
        rows[item] = r[1];
        n += 1;
    }
    return { at: m.at, rows };
}

/** One trader list as it may be sent or kept: [trader, readAt, {item: price}], or null. Numbers only. */
export function sharedList(entry) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    const trader = sharedId(entry[0]);
    const at = entry[1];
    const prices = entry[2];
    if (trader === null || !Number.isInteger(at) || at <= 0 || at >= 1e13 || !prices || typeof prices !== 'object' || Array.isArray(prices)) return null;
    const out = {};
    let n = 0;
    for (const [key, value] of Object.entries(prices)) {
        const item = sharedId(key);
        if (item === null || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        if (n >= SHARED_MAX_LIST_ITEMS) break;
        if (!(item in out)) n += 1;
        out[item] = Math.round(value);
    }
    return n ? [trader, at, out] : null;
}

/*
 * 3.33.0 - is a trader's TornW3B list open (core/open-check.js)? One PC's page read serves the others for three
 * minutes, through the server (its opens.js): sent as [trader, 1 open | 0 closed, age, changedAge, mark], ages in ms by this
 * PC's clock (changedAge: how long before now their list last changed, 0 not known); the server stamps them with its
 * own clock and hands them on as ages too, so no other PC's clock is taken. Unclear and failed reads are not sent.
 * mark: sharedListMark of the prices the open read gave, so the receiver uses that check only with that very list.
 */
export const SHARED_MAX_OPENS = 30;
export const SHARED_OPEN_KEEP_MS = 3 * 60 * 1000;

/** One of this PC's checks, kept as [trader, state, at, changedAt, mark] (this PC's clock), as it goes out - or null. */
export function sharedOpenOut(entry, now) {
    if (!Array.isArray(entry) || entry.length !== 5) return null;
    const trader = sharedId(entry[0]);
    const [, state, at, changedAt, mark] = entry;
    if (trader === null || (state !== 0 && state !== 1) || !Number.isFinite(at) || at <= 0) return null;
    const age = Math.max(0, Math.floor(now - at));
    if (age >= SHARED_OPEN_KEEP_MS) return null;
    const changed = Number.isFinite(changedAt) && changedAt > 0 ? Math.max(1, Math.floor(now - changedAt)) : 0;
    return [trader, state, age, Math.min(changed, 1e13 - 1), Number.isInteger(mark) && mark > 0 && mark < 2 ** 32 ? mark : 0];
}

/** The answer's open checks, made by other PCs: [trader, state, at, changedAt, mark] on this PC's clock (`got`), newest first. */
export function sharedOpensIn(answer, got) {
    const out = [];
    for (const m of answer && Array.isArray(answer.opens) ? answer.opens.slice(0, SHARED_MAX_OPENS * 4) : []) {
        if (!Array.isArray(m) || m.length !== 5) continue;
        const trader = sharedId(m[0]);
        const ok = (n) => Number.isInteger(n) && n >= 0 && n < 1e13;
        if (trader === null || (m[1] !== 0 && m[1] !== 1) || !ok(m[2]) || !ok(m[3]) || !ok(m[4]) || m[2] >= SHARED_OPEN_KEEP_MS) continue;
        out.push([trader, m[1], got - m[2], m[3] > 0 ? got - m[3] : 0, m[4]]);
    }
    return out;
}

/** The answer's trader lists, checked: read by another person's PC, oldest first. */
export function sharedListsIn(answer) {
    const out = [];
    for (const entry of answer && Array.isArray(answer.lists) ? answer.lists : []) {
        const list = sharedList(entry);
        if (list) out.push(list);
        if (out.length >= SHARED_MAX_LISTS * 4) break;
    }
    return out;
}

/*
 * A trader's own price list (3.31.0). The owner, 2026-10-12: his friend buys plushies for him while he sleeps, and
 * his shop is then closed - which takes his prices off TornW3B, so Torn Bids saw nobody to sell them to. "server
 * should always keep my live pricelist ... then tornbids should look at it, this is only FOR ME". His Torn Archive
 * tells the server what he pays for each piece now (closed: what he would pay if he opened) and which pieces he
 * does not want now; the server keeps the last one said under his Torn id and hands it on. It is the trader's own
 * word, not a copy another PC read: it stands over TornW3B's copy of his list and counts as checked
 * (core/checked.js) while the server heard it within a day.
 */
export const SHARED_MAX_OWN = 50;
export const SHARED_MAX_OWN_ITEMS = 200;
const SHARED_MAX_OWN_SETS = 8;
const SHARED_MAX_OWN_COUNT = 1000000;
const SHARED_OWN_SET = /^[a-z]{1,16}$/;

/** A table of whole numbers from the server, checked: {key: n} with `key` passed by `keyOf`, n from `least` up. */
function sharedOwnTable(given, keyOf, least, most, max) {
    if (!given || typeof given !== 'object' || Array.isArray(given)) return null;
    const out = {};
    let n = 0;
    for (const [name, value] of Object.entries(given)) {
        const key = keyOf(name);
        if (key === null || !Number.isInteger(value) || value < least || value > most || n >= max) continue;
        out[key] = value;
        n += 1;
    }
    return n ? out : null;
}

/**
 * What the server says beside a trader's own list (3.32.0, Flips > For <the owner>): the trader's Torn name, what a
 * whole set is paid a piece (`all`: every piece, also one held enough of), and how many are still taken - whole
 * sets (`sets`: {set: n}) and single pieces (`take`: {item: n}). Never what the trader holds.
 */
function sharedOwnMore(given) {
    if (!given || typeof given !== 'object' || Array.isArray(given)) return {};
    const more = {};
    if (typeof given.name === 'string' && given.name.length > 0 && given.name.length <= 40) more.name = given.name;
    const all = sharedOwnTable(given.all, sharedId, 1, 1e12, SHARED_MAX_OWN_ITEMS);
    const sets = sharedOwnTable(given.sets, (k) => (SHARED_OWN_SET.test(k) ? k : null), 0, SHARED_MAX_OWN_COUNT, SHARED_MAX_OWN_SETS);
    const take = sharedOwnTable(given.take, sharedId, 0, SHARED_MAX_OWN_COUNT, SHARED_MAX_OWN_ITEMS);
    if (all) more.all = all;
    if (sets) more.sets = sets;
    if (take) more.take = take;
    return more;
}

/**
 * The answer's own lists, checked: [{trader, at, since, open, prices: {item: price}, off: [item]}] by this PC's
 * clock - `at`: when the server last heard it from the trader's Torn Archive, `since`: since when it says the same.
 * With `name`, `all`, `sets`, `take` when the server says them (`ownMore`, 3.32.0).
 */
export function sharedOwnIn(answer, got) {
    const out = [];
    const age = (n) => Number.isFinite(n) && n >= 0 && n < 1e11;
    const moreOf = answer && answer.ownMore && typeof answer.ownMore === 'object' && !Array.isArray(answer.ownMore) ? answer.ownMore : {};
    for (const row of answer && Array.isArray(answer.own) ? answer.own : []) {
        if (!Array.isArray(row) || row.length !== 6) continue;
        const trader = sharedId(row[0]);
        if (trader === null || !age(row[1]) || !age(row[2]) || (row[3] !== 0 && row[3] !== 1)) continue;
        if (!row[4] || typeof row[4] !== 'object' || Array.isArray(row[4]) || !Array.isArray(row[5])) continue;
        const prices = {};
        let n = 0;
        for (const [key, value] of Object.entries(row[4])) {
            const item = sharedId(key);
            if (item === null || !Number.isInteger(value) || value <= 0 || n >= SHARED_MAX_OWN_ITEMS) continue;
            prices[item] = value;
            n += 1;
        }
        const off = [...new Set(row[5].map(sharedId).filter((id) => id !== null && !(id in prices)))].slice(0, SHARED_MAX_OWN_ITEMS);
        if (!n && !off.length) continue;
        out.push({ trader, at: Math.floor(got - row[1]), since: Math.floor(got - Math.max(row[1], row[2])), open: row[3] === 1, prices, off, ...sharedOwnMore(moreOf[trader]) });
        if (out.length >= SHARED_MAX_OWN) break;
    }
    return out;
}

/** The own lists kept ({mark, lists: {trader: {...}}}) with one answer's put in: the newer one of a trader stands. */
export function sharedOwnKeep(kept, got, mark) {
    const lists = { ...(kept && kept.lists && typeof kept.lists === 'object' ? kept.lists : {}) };
    for (const l of got) {
        const had = lists[l.trader];
        if (had && had.at > l.at) continue;
        const more = {};
        for (const key of ['name', 'all', 'sets', 'take']) if (l[key]) more[key] = l[key];
        lists[l.trader] = { at: l.at, since: l.since, open: l.open, prices: l.prices, off: l.off, ...more };
    }
    return { mark: Number.isInteger(mark) && mark >= 0 ? mark : 0, lists: Object.fromEntries(Object.entries(lists).slice(-SHARED_MAX_OWN)) };
}

/**
 * What the server handed out, to keep: {at, want, ask} - `ask` only of what was wanted, in its order.
 * Null when the server said nothing about it (an older server, or nothing was wanted).
 */
export function sharedAskIn(answer, want, now, room = null) {
    if (!answer || !Array.isArray(answer.ask) || !Array.isArray(want) || !want.length) return null;
    const wanted = [...new Set(want)];
    const ask = [];
    for (const value of answer.ask) {
        const id = sharedId(value);
        if (id !== null && wanted.includes(id) && !ask.includes(id)) ask.push(id);
    }
    // 3.26.1 - the server goes down `want` and stops once it has handed out as many as this PC said it has left
    // this minute (`room`). What comes after the last one handed was never looked at: it is nobody else's.
    // 3.26.0 took all of it for another PC's, and a PC on its own read a few sellers lists per exchange.
    // Two PCs behind one address share one minute, and the server then stops at a part of `room` this PC
    // cannot know. A server that says how far down `want` it looked (`judged`) is believed over the reckoning.
    const told = Number.isInteger(answer.judged) && answer.judged >= 0 && answer.judged <= wanted.length ? answer.judged : null;
    const stopped = Number.isInteger(room) && room >= 0 && ask.length >= room;
    const judged = told !== null ? told : stopped ? (ask.length ? wanted.indexOf(ask[ask.length - 1]) + 1 : 0) : wanted.length;
    return { at: now, want: wanted, ask, judged };
}

/**
 * May this PC ask TornW3B for an item's sellers list now, by what the server handed out? Not when it was
 * wanted and the server left it to another PC; everything else as before - an item the server was not told
 * of or did not get to, a server that has been silent, a PC on its own.
 */
export function sharedMayRead(kept, itemId, now) {
    if (!kept || !(now - kept.at < SHARED_ASK_FRESH_MS) || now < kept.at) return true;
    const id = Number(itemId);
    const at = kept.want.indexOf(id);
    if (at < 0 || kept.ask.includes(id)) return true;
    return Number.isInteger(kept.judged) && at >= kept.judged;
}

/** How many of the wanted sellers lists the server left to another PC (it looked at them, and did not hand them here). */
export function sharedAskLeft(kept) {
    if (!kept) return 0;
    const judged = Number.isInteger(kept.judged) ? kept.judged : kept.want.length;
    return kept.want.slice(0, judged).filter((id) => !kept.ask.includes(id)).length;
}

// The server is shared with our other apps: each says which it is, so one person's apps are added up
// against the one Torn limit, and whoever runs the server can ask for a newer version.
export const SHARED_APP = 'torn-bids';
const SHARED_VER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-test\.\d{8}\.\d{4})?$/;

/** A version as build.mjs writes them (a release, or a test build of one), or null. */
export function sharedVersion(value) {
    return typeof value === 'string' && SHARED_VER.test(value) ? value : null;
}
/* TornW3B lists this PC read: how many are told in one exchange, and how long another PC's read is kept. */
const SHARED_MAX_DIR = 300;
export const SHARED_DIR_KEEP_MS = 30 * 60000;
/* An item that is another PC's to read first: this PC waits this long past due, then reads it itself. Longer than one exchange. */
export const SHARED_TURN_WAIT_MS = 45000;
// The two marks (the same limits as server/src/core.js): what you are going for, and what you just bought.
const SHARED_MAX_GOING = 50;
const SHARED_MAX_GOING_SELLERS = 30;
const SHARED_MAX_BOUGHT = 200;
// A buy is passed on this long (the server keeps it as long); after that the bazaars' own reads have shown it.
export const SHARED_BOUGHT_MS = 30 * 60000;
// A trade nobody has taken a step in for this long is no longer "going for this" to the others.
export const SHARED_GOING_QUIET_MS = 10 * 60000;
// The server silent this long: nobody is known to be going for anything.
const SHARED_MARKS_STALE_MS = 2 * 60000;
const SHARED_DAY_MS = 24 * 60 * 60000;

/** The server's address as typed, or null: https and a workers.dev name only (the one host the script may reach). */
export function sharedAddress(typed) {
    const text = String(typed ?? '').trim();
    if (!text) return null;
    let url;
    try {
        url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/.test(url.hostname)) return null;
    return url.origin;
}

/**
 * Where the shared server is: the address this copy was built with, unless this PC keeps another
 * (`kept`: an address, or 'off'). Nobody types it; null = no server, and Torn Bids works alone.
 */
export function sharedHome(built, kept) {
    if (kept === 'off') return null;
    return sharedAddress(kept) || sharedAddress(built);
}

// What a PC's word to the server is made from, with its Public key: changed only together with the server.
const SHARED_WORD_LABEL = 'torn-shared-server:1:';

/**
 * This PC's word to the server (3.25.0): made from the Public key it already holds, so nobody types a
 * password - and the key itself never leaves the PC. The server makes the same word from each key its
 * owner typed in there; a PC whose word it does not know gets nothing. null without a key.
 * @param {string} key - the Public key
 * @param {(data: Uint8Array) => Promise<ArrayBuffer>} [digest] - SHA-256
 */
export async function sharedWord(key, digest = (data) => globalThis.crypto.subtle.digest('SHA-256', data)) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9]{16}$/.test(key)) return null;
    const out = new Uint8Array(await digest(new TextEncoder().encode(SHARED_WORD_LABEL + key)));
    return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** This PC's word to the server, as sharedWord() makes it (and a password of the first set-up): letters and digits, 24 or more. */
export function sharedPassOk(pass) {
    return typeof pass === 'string' && /^[A-Za-z0-9]{24,}$/.test(pass);
}

/**
 * May this PC make one Torn call now? The PC's half of budget.js: its own calls of
 * the last minute, one more, and the server's part must fit in what is usable.
 * `grant` is the server's last answer ({at, need, serverShare, serverTimes}); none,
 * or one too old to trust, and the PC is on its own.
 */
export function sharedMayCall(grant, pcTimes, now) {
    if (!grant || !Number.isFinite(grant.at) || now - grant.at > SHARED_GRANT_STALE_MS) return true;
    let mine = 0;
    for (const t of pcTimes || []) if (now - t < 60000) mine += 1;
    let lingering = 0;
    for (const t of Array.isArray(grant.serverTimes) ? grant.serverTimes : []) if (now - t < 60000) lingering += 1;
    const share = Number.isFinite(grant.serverShare) ? Math.max(0, grant.serverShare) : 0;
    return mine + 1 + Math.max(lingering, share) <= SHARED_USABLE;
}

const sharedId = (value) => {
    const n = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value;
    return Number.isInteger(n) && n > 0 && n < 1e10 ? n : null;
};

function sharedIds(lists, max) {
    const out = new Set();
    for (const list of lists) {
        for (const value of Array.isArray(list) ? list : []) {
            const id = sharedId(value);
            if (id !== null) out.add(id);
            if (out.size >= max) return [...out];
        }
    }
    return [...out];
}

const sharedWhole = (n, max) => (Number.isInteger(n) && n >= 0 && n <= max ? n : null);

/**
 * The two marks of every part of the script, merged, each once. Times are this PC's
 * (milliseconds); `now` only says which are too old or not yet.
 *  going:  [item, opened at, ...the bazaars of the plan] - one per item, the earliest opening
 *  bought: [bazaar, item, how many, the price of each, when]
 */
export function sharedMarks(wants, now) {
    const going = new Map();
    const bought = new Map();
    for (const w of Array.isArray(wants) ? wants : []) {
        for (const entry of w && Array.isArray(w.going) ? w.going : []) {
            if (!Array.isArray(entry)) continue;
            const item = sharedId(entry[0]);
            const at = entry[1];
            if (item === null || !Number.isFinite(at) || at > now + 5000 || now - at > SHARED_DAY_MS) continue;
            if (!going.has(item) && going.size >= SHARED_MAX_GOING) continue;
            const had = going.get(item) || { at, sellers: new Set() };
            had.at = Math.min(had.at, at);
            for (const seller of sharedIds([entry.slice(2)], SHARED_MAX_GOING_SELLERS)) {
                if (had.sellers.size < SHARED_MAX_GOING_SELLERS) had.sellers.add(seller);
            }
            going.set(item, had);
        }
        for (const entry of w && Array.isArray(w.bought) ? w.bought : []) {
            if (!Array.isArray(entry)) continue;
            const seller = sharedId(entry[0]);
            const item = sharedId(entry[1]);
            const qty = sharedWhole(entry[2], 1e9);
            const price = sharedWhole(Math.round(entry[3]), 1e13);
            const at = entry[4];
            if (seller === null || item === null || !qty || price === null || !Number.isFinite(at) || at > now + 5000 || now - at >= SHARED_BOUGHT_MS) continue;
            const key = [seller, item, qty, price, Math.floor(at)].join('|');
            if (!bought.has(key) && bought.size >= SHARED_MAX_BOUGHT) continue;
            bought.set(key, [seller, item, qty, price, Math.floor(at)]);
        }
    }
    return {
        going: [...going].map(([item, g]) => [item, Math.floor(g.at), ...g.sellers]),
        bought: [...bought.values()],
    };
}

/**
 * What this PC sends: its Torn use, and the bazaars and items that matter to it.
 * `wants` are what each open part of the script asked for ({sellers, trades,
 * looking, worth, going, bought}); they are merged. Player ids, item ids, prices,
 * counts and how long ago - and which app this is and its version; nothing else can
 * come out of here, whatever is put in.
 * `now`: this PC's clock; the marks leave as ages, since every PC has its own clock.
 */
export function sharedBody({ used = 0, waiting = 0, wants = [], since = 0, seen = 0, sendWorth = true, now = 0, ver = null, lists = null, listsSince = null, calls = null, moves = null, ownSince = null, opens = null, drops = null } = {}) {
    const count = (n) => (Number.isFinite(n) && n > 0 ? Math.min(1000, Math.floor(n)) : 0);
    const list = Array.isArray(wants) ? wants.filter((w) => w && typeof w === 'object') : [];
    const trades = sharedIds(list.map((w) => w.trades), SHARED_MAX_NEAR);
    const looking = sharedIds(list.map((w) => w.looking), SHARED_MAX_NEAR);
    // The near ones first, so a full list never pushes them out.
    const sellers = sharedIds([trades, looking, ...list.map((w) => w.sellers)], SHARED_MAX_SELLERS);
    const body = {
        app: SHARED_APP,
        used: count(used), waiting: count(waiting), sellers, trades, looking,
        since: Number.isInteger(since) && since > 0 ? since : 0,
        seen: Number.isFinite(seen) && seen > 0 ? Math.floor(seen) : 0,
    };
    if (sharedVersion(ver)) body.ver = ver;
    // The PC's whole current lists every time: left out would mean "none" to the server.
    const marks = sharedMarks(list, now);
    const age = (at) => Math.max(0, Math.floor(now - at));
    body.going = marks.going.map(([item, at, ...sellers]) => [item, age(at), ...sellers]);
    body.bought = marks.bought.map(([seller, item, qty, price, at]) => [seller, item, qty, price, age(at)]);
    const dir = sharedDir(list);
    if (dir.length) body.dir = dir.map(([item, at]) => [item, age(at)]);
    // TornW3B's work (3.26.0): what this PC would read next, and what is left of its own limit.
    const want = sharedIds(list.map((w) => w.want), SHARED_MAX_WANT);
    const room = list.map((w) => w.w3b).find((r) => Array.isArray(r) && r.length === 2 && r.every((n) => Number.isFinite(n) && n >= 0));
    if (want.length && room) {
        body.want = want;
        body.w3b = room.map((n) => Math.min(100000, Math.floor(n)));
    }
    const out = (Array.isArray(lists) ? lists : []).map(sharedList).filter(Boolean).slice(0, SHARED_MAX_LISTS);
    if (out.length) body.lists = out;
    if (Number.isInteger(listsSince) && listsSince >= 0) body.listsSince = listsSince;
    // 3.28.0 - the table of item speeds this PC holds (its time on the server's clock): a newer one is sent back.
    if (Number.isInteger(moves) && moves >= 0 && moves < 1e13) body.moves = moves;
    // 3.33.0 - the price samples this PC holds (their time on the server's clock): newer ones are sent back.
    if (Number.isInteger(drops) && drops >= 0 && drops < 1e13) body.drops = drops;
    // 3.31.0 - traders' own price lists, as their Torn Archive told the server (sharedOwnIn): the running number held.
    if (Number.isInteger(ownSince) && ownSince >= 0 && ownSince < 1e13) body.ownSince = ownSince;
    // 3.33.0 - whose TornW3B lists this PC saw open or closed in the last three minutes, as ages (sharedOpen).
    const opensOut = (Array.isArray(opens) ? opens : []).map((o) => sharedOpenOut(o, now)).filter(Boolean).slice(0, SHARED_MAX_OPENS);
    if (opensOut.length) body.opens = opensOut;
    // 3.26.2 - this PC's own request counts since the last answered exchange (core/usage.js): {} = none were made.
    if (calls && typeof calls === 'object' && !Array.isArray(calls)) {
        body.calls = {};
        for (const [tag, n] of Object.entries(calls).slice(0, USAGE_CALLS_TAGS_MAX)) {
            if (USAGE_CALLS_TAG.test(tag) && Number.isFinite(n) && n >= 1) body.calls[tag] = Math.min(USAGE_CALLS_COUNT_MAX, Math.floor(n));
        }
    }
    if (sendWorth) {
        const worth = {};
        let n = 0;
        for (const w of list) {
            for (const [key, value] of Object.entries(w.worth && typeof w.worth === 'object' ? w.worth : {})) {
                const item = sharedId(key);
                if (item === null || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
                if (!(item in worth)) {
                    if (n >= SHARED_MAX_WORTH) continue;
                    n += 1;
                }
                worth[item] = Math.max(worth[item] || 0, Math.round(value));
            }
        }
        body.worth = worth;
    }
    return body;
}

/**
 * The check on the way out: is this exactly a body sharedBody() makes? Numbers and
 * lists of numbers only, beside this app's own name and version - no person's name,
 * no other text, no key, nothing about an inventory.
 */
export function sharedOutgoingOk(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const whole = (n) => Number.isInteger(n) && n >= 0 && n < 1e13;
    for (const [key, value] of Object.entries(body)) {
        if (!SHARED_BODY_KEYS.includes(key)) return false;
        if (key === 'app') {
            if (value !== SHARED_APP) return false;
        } else if (key === 'ver') {
            if (sharedVersion(value) === null) return false;
        } else if (key === 'sellers' || key === 'trades' || key === 'looking') {
            if (!Array.isArray(value) || !value.every((id) => Number.isInteger(id) && id > 0 && id < 1e10)) return false;
        } else if (key === 'going') {
            // [item, age, ...bazaars]
            if (!Array.isArray(value) || !value.every((m) => Array.isArray(m) && m.length >= 2 && m.length <= SHARED_MAX_GOING_SELLERS + 2 && m.every(whole) && m[0] > 0)) return false;
        } else if (key === 'dir') {
            // [item, age]
            if (!Array.isArray(value) || !value.every((m) => Array.isArray(m) && m.length === 2 && m.every(whole) && m[0] > 0)) return false;
        } else if (key === 'bought') {
            // [bazaar, item, how many, price, age]
            if (!Array.isArray(value) || !value.every((m) => Array.isArray(m) && m.length === 5 && m.every(whole) && m[0] > 0 && m[1] > 0 && m[2] > 0)) return false;
        } else if (key === 'want') {
            if (!Array.isArray(value) || value.length > SHARED_MAX_WANT || !value.every((id) => Number.isInteger(id) && id > 0 && id < 1e10)) return false;
        } else if (key === 'w3b') {
            if (!Array.isArray(value) || value.length !== 2 || !value.every(whole)) return false;
        } else if (key === 'lists') {
            // [trader, read at, {item: price}]
            if (!Array.isArray(value) || value.length > SHARED_MAX_LISTS) return false;
            for (const l of value) {
                if (!Array.isArray(l) || l.length !== 3 || !Number.isInteger(l[0]) || l[0] <= 0 || l[0] >= 1e10 || !whole(l[1]) || l[1] <= 0) return false;
                if (!l[2] || typeof l[2] !== 'object' || Array.isArray(l[2]) || Object.keys(l[2]).length > SHARED_MAX_LIST_ITEMS) return false;
                for (const [item, price] of Object.entries(l[2])) if (!/^\d{1,10}$/.test(item) || !Number.isInteger(price) || price <= 0) return false;
            }
        } else if (key === 'opens') {
            // [trader, 1 open | 0 closed, age, age of the list's last change (0: not known), mark of its prices (0: none)]
            if (!Array.isArray(value) || value.length > SHARED_MAX_OPENS || !value.every((m) => Array.isArray(m) && m.length === 5 && m.every(whole) && m[0] > 0 && m[0] < 1e10 && (m[1] === 0 || m[1] === 1) && m[2] < SHARED_OPEN_KEEP_MS && m[4] < 2 ** 32)) return false;
        } else if (key === 'calls') {
            // {tag: how many}: a service's tag or how one answered, a whole number from 1 to 5,000.
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > USAGE_CALLS_TAGS_MAX) return false;
            for (const [tag, n] of Object.entries(value)) {
                if (!USAGE_CALLS_TAG.test(tag) || !Number.isInteger(n) || n < 1 || n > USAGE_CALLS_COUNT_MAX) return false;
            }
        } else if (key === 'worth') {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            for (const [item, price] of Object.entries(value)) {
                if (!/^\d{1,10}$/.test(item) || !Number.isInteger(price) || price <= 0) return false;
            }
        } else if (!whole(value)) {
            return false;
        }
    }
    return true;
}

export function sharedBucketOf(sellerId) {
    return Number(sellerId) % SHARED_BUCKETS;
}

/**
 * The server's answer, taken into what is kept: `buckets` is an array of
 * SHARED_BUCKETS objects, sellerId -> [changedAt, seenAt, gen, [[item, price, qty], ...], [friends, enemies]|null].
 * The last (3.33.0, the seller rule): the seller's Torn profile counts, when the server sent them (`fe`).
 * Only items of `interest` (a Map itemId -> the gen it joined at) are kept; `gen`
 * is the interest's count now, so a later reader knows which items this entry
 * could have held (see withShared).
 * @returns {Set<number>} the buckets that changed
 */
export function sharedTake(buckets, answer, interest, gen, now) {
    const touched = new Set();
    const reads = answer && Array.isArray(answer.reads) ? answer.reads : [];
    for (const read of reads) {
        const id = sharedId(read && read.id);
        if (id === null || !Array.isArray(read.items)) continue;
        const at = Number.isFinite(read.at) && read.at > 0 ? read.at : now;
        const items = [];
        for (const entry of read.items) {
            const item = sharedId(entry && entry.id);
            const price = entry && entry.price;
            const qty = entry && entry.qty;
            if (item === null || !interest.has(String(item))) continue;
            if (!Number.isFinite(price) || price < 0 || !Number.isInteger(qty) || qty <= 0) continue;
            items.push([item, price, qty]);
        }
        const bucket = sharedBucketOf(id);
        const prev = buckets[bucket][id];
        const fe = sharedCounts(read.fe) || (prev ? sharedCounts(prev[4]) : null);
        buckets[bucket][id] = [at, Math.max(at, prev ? prev[1] : 0), gen, items, fe];
        touched.add(bucket);
    }
    // Read again by the server and found the same: still true as of then.
    for (const pair of answer && Array.isArray(answer.seen) ? answer.seen : []) {
        const id = sharedId(Array.isArray(pair) ? pair[0] : null);
        const at = Array.isArray(pair) ? pair[1] : null;
        if (id === null || !Number.isFinite(at)) continue;
        const bucket = sharedBucketOf(id);
        const entry = buckets[bucket][id];
        if (entry && at > entry[1]) {
            entry[1] = at;
            touched.add(bucket);
        }
    }
    return touched;
}

/** A seller's [friends, enemies] as the server sends them, or null. */
export function sharedCounts(fe) {
    return Array.isArray(fe) && fe.length === 2 && fe.every((n) => Number.isInteger(n) && n >= 0) ? [fe[0], fe[1]] : null;
}

/** Drops what the server has not confirmed for SHARED_KEEP_MS. @returns {Set<number>} the buckets that changed */
export function sharedPrune(buckets, now) {
    const touched = new Set();
    buckets.forEach((bucket, i) => {
        for (const id of Object.keys(bucket)) {
            if (now - bucket[id][1] > SHARED_KEEP_MS) {
                delete bucket[id];
                touched.add(i);
            }
        }
    });
    return touched;
}

/** One stored bucket, read back strictly: anything not in shape is left out. */
export function sharedReadBucket(stored) {
    const out = {};
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
    for (const [id, entry] of Object.entries(stored)) {
        // Four long before 3.33.0; the fifth, the seller's counts, may be null.
        if (!/^\d{1,10}$/.test(id) || !Array.isArray(entry) || (entry.length !== 4 && entry.length !== 5)) continue;
        const [at, seen, gen, items] = entry;
        if (entry.length === 5 && entry[4] !== null && !sharedCounts(entry[4])) continue;
        if (!Number.isFinite(at) || !Number.isFinite(seen) || !Number.isInteger(gen) || !Array.isArray(items)) continue;
        if (!items.every((i) => Array.isArray(i) && i.length === 3 && Number.isInteger(i[0]) && Number.isFinite(i[1]) && Number.isInteger(i[2]))) continue;
        out[id] = entry;
    }
    return out;
}

/**
 * What is kept, laid out for reading:
 *  bySeller: sellerId -> {at, seen, gen, items: Map itemId -> [{price, qty}], counts: {friends, enemies}|null}
 *  byItem:   itemId -> [{sellerId, price, qty, at, seen}]
 * Ids are strings, as in the TornW3B rows.
 */
export function sharedIndex(buckets) {
    const bySeller = new Map();
    const byItem = new Map();
    for (const bucket of buckets) {
        for (const [sellerId, entry] of Object.entries(bucket)) {
            const [at, seen, gen, list, fe] = entry;
            const items = new Map();
            for (const [item, price, qty] of list) {
                const key = String(item);
                if (!items.has(key)) items.set(key, []);
                items.get(key).push({ price, qty });
                if (!byItem.has(key)) byItem.set(key, []);
                byItem.get(key).push({ sellerId, price, qty, at, seen });
            }
            const c = sharedCounts(fe);
            bySeller.set(sellerId, { at, seen, gen, items, counts: c ? { friends: c[0], enemies: c[1] } : null });
        }
    }
    return { bySeller, byItem };
}

/**
 * NPC Arbitrage from the server (3.26.0; the owner, 2026-10-11: bazaar prices from Torn's own API through
 * our server, TornW3B asked only what we cannot know). A read this old or newer makes a deal by itself,
 * and stands in for TornW3B's sellers list of the item.
 */
export const SHARED_DEAL_MAX_AGE_MS = 5 * 60000;

/**
 * The listings of one item the server read from Torn lately, under a price, cheapest first - rows as
 * TornW3B's are, with no seller name (the server gives none). A price of $1 or less is a locked listing.
 * @param {{byItem: Map}} index - sharedIndex()
 * @param {number} under - only listings cheaper than this (what the item sells for)
 */
export function sharedDealRows(index, itemId, under, now, maxAge = SHARED_DEAL_MAX_AGE_MS) {
    const out = [];
    for (const l of (index && index.byItem && index.byItem.get(String(itemId))) || []) {
        if (!(l.price > 1) || !(l.qty > 0) || !(l.price < under) || !(now - l.seen <= maxAge)) continue;
        out.push({ sellerId: l.sellerId, sellerName: null, price: l.price, qty: l.qty, dataAt: l.seen, changedAt: l.at, sponsored: false, shared: true });
    }
    return out.sort((a, b) => a.price - b.price);
}

/**
 * The items the server holds listings of, read from Torn within `maxAge`: itemId -> when the newest of them
 * was seen (3.26.2: an item this PC has no sellers list of has the server's listings as its sellers).
 * @returns {Map<string, number>}
 */
export function sharedItemsSeen(index, now, maxAge) {
    const out = new Map();
    for (const [item, listings] of (index && index.byItem) || []) {
        let seen = 0;
        for (const l of listings) if (l.price > 1 && l.qty > 0 && l.seen <= now && now - l.seen <= maxAge && l.seen > seen) seen = l.seen;
        if (seen) out.set(item, seen);
    }
    return out;
}

/**
 * Does the server already know the cheapest bazaar price TornW3B's summary names for an item - a listing
 * at that price or under it, read from Torn lately? Then TornW3B's sellers list of the item would say
 * nothing new, and is not asked for.
 */
export function sharedKnowsLowest(index, itemId, lowest, now, maxAge = SHARED_DEAL_MAX_AGE_MS) {
    if (!(lowest > 1)) return false;
    for (const l of (index && index.byItem && index.byItem.get(String(itemId))) || []) {
        if (l.price > 1 && l.qty > 0 && l.price <= lowest && now - l.seen <= maxAge) return true;
    }
    return false;
}

/**
 * TornW3B's rows of one item, corrected by what the server read from Torn itself.
 *  - a seller the server read AFTER TornW3B checked them: the server's price and
 *    count stand (Torn's own answer); if that bazaar no longer holds the item,
 *    the row goes - but only if the item was already of interest when the entry
 *    was kept (`joined`), else the entry says nothing about it;
 *  - a seller TornW3B checked after the server's read: TornW3B's row stands;
 *  - a seller TornW3B does not list at all: added, with no name.
 * A price of $1 or less is a locked listing, as in TornW3B's rows: left out.
 * @param {object[]} rows - {sellerId, sellerName, price, qty, dataAt, changedAt, sponsored}
 * @param {{bySeller: Map, byItem: Map}} index - sharedIndex()
 * @param {Map<string, number>} joined - itemId -> the gen it joined the interest at
 */
export function withShared(rows, itemId, index, joined) {
    const item = String(itemId);
    if (!index || (!index.bySeller.size && !index.byItem.size)) return rows;
    const out = [];
    const dealt = new Set();
    let changed = false;
    for (const row of rows || []) {
        const entry = index.bySeller.get(String(row.sellerId));
        if (!entry || entry.seen <= (row.dataAt || 0)) {
            out.push(row);
            dealt.add(String(row.sellerId));
            continue;
        }
        const listings = entry.items.get(item);
        if (!listings) {
            const covered = joined && joined.has(item) && joined.get(item) <= entry.gen;
            if (covered) {
                changed = true;
                // A second row of the same seller must not bring them back from byItem.
                dealt.add(String(row.sellerId));
            } else if (!dealt.has(String(row.sellerId))) {
                out.push(row);
                dealt.add(String(row.sellerId));
            }
            continue;
        }
        if (dealt.has(String(row.sellerId))) {
            changed = true;
            continue;
        }
        dealt.add(String(row.sellerId));
        changed = true;
        for (const l of listings) {
            if (!(l.price > 1) || !(l.qty > 0)) continue;
            const same = l.price === row.price && l.qty === row.qty;
            out.push({ ...row, price: l.price, qty: l.qty, dataAt: entry.seen, changedAt: same ? row.changedAt : entry.at, shared: true });
        }
    }
    for (const l of index.byItem.get(item) || []) {
        if (dealt.has(l.sellerId) || !(l.price > 1) || !(l.qty > 0)) continue;
        changed = true;
        out.push({ sellerId: l.sellerId, sellerName: null, price: l.price, qty: l.qty, dataAt: l.seen, changedAt: l.at, sponsored: false, shared: true });
    }
    if (!changed) return rows;
    return out.sort((a, b) => a.price - b.price);
}

/**
 * The interest (itemId -> gen) with the items of `worth` added. A new item gets a
 * new gen, so entries kept before it joined are known to say nothing about it.
 * @returns {{interest: Map<string, number>, gen: number, grew: boolean}}
 */
export function sharedInterest(interest, gen, itemIds) {
    let next = gen;
    let grew = false;
    for (const value of itemIds || []) {
        const id = sharedId(value);
        if (id === null || interest.has(String(id)) || interest.size >= SHARED_MAX_WORTH) continue;
        if (!grew) next = gen + 1;
        grew = true;
        interest.set(String(id), next);
    }
    return { interest, gen: next, grew };
}

/* ------------------------------------------------------- the others' marks */

/**
 * The others' marks from the server's answer, checked, with times as this PC counts them.
 * `had`: the marks kept so far - one already known keeps its time, so nothing is
 * rewritten for the second an answer took longer.
 * @returns {{going: {who, whoId, item, at, sellers}[], bought: {who, whoId, seller, item, qty, price, at}[]}}
 */
export function sharedMarksIn(answer, had, now) {
    const sent = answer && answer.marks && typeof answer.marks === 'object' ? answer.marks : {};
    const near = (list, same, at) => {
        const old = (list || []).find((m) => !m.used && same(m) && Math.abs(m.at - at) < 10000);
        if (!old) return at;
        old.used = true;
        return old.at;
    };
    const hadGoing = ((had && had.going) || []).map((m) => ({ ...m }));
    const hadBought = ((had && had.bought) || []).map((m) => ({ ...m }));
    const going = [];
    for (const m of Array.isArray(sent.going) ? sent.going.slice(0, 500) : []) {
        const by = sharedPerson({ id: m && m.whoId, name: m && m.who });
        const item = sharedId(m && m.item);
        const age = sharedWhole(m && m.age, SHARED_DAY_MS);
        if (item === null || age === null) continue;
        const sellers = sharedIds([m.sellers], SHARED_MAX_GOING_SELLERS);
        const at = near(hadGoing, (o) => o.whoId === by.id && o.who === by.name && o.item === item, now - age);
        going.push({ who: by.name, whoId: by.id, item, at, sellers });
    }
    const bought = [];
    for (const m of Array.isArray(sent.bought) ? sent.bought.slice(0, 1000) : []) {
        const by = sharedPerson({ id: m && m.whoId, name: m && m.who });
        const seller = sharedId(m && m.seller);
        const item = sharedId(m && m.item);
        const qty = sharedWhole(m && m.qty, 1e9);
        const price = sharedWhole(m && m.price, 1e13);
        const age = sharedWhole(m && m.age, SHARED_BOUGHT_MS);
        if (seller === null || item === null || !qty || price === null || age === null) continue;
        const at = near(hadBought, (o) => o.whoId === by.id && o.seller === seller && o.item === item && o.qty === qty && o.price === price, now - age);
        bought.push({ who: by.name, whoId: by.id, seller, item, qty, price, at });
    }
    return { going, bought };
}

/**
 * The marks to go by now: nobody is "going for" anything once the server has been
 * silent two minutes (it may have ended long ago); a buy stays true for its half hour.
 * @param {{going, bought}|null} kept - sharedMarksIn()
 * @param {number|null} okAt - the last answer of the server
 */
export function sharedMarksNow(kept, okAt, now) {
    const live = Number.isFinite(okAt) && now - okAt <= SHARED_MARKS_STALE_MS;
    return {
        going: live && kept ? kept.going || [] : [],
        bought: kept ? (kept.bought || []).filter((m) => now - m.at < SHARED_BOUGHT_MS) : [],
    };
}

/* ------------------------------------------------- the marks, on the screens */

/**
 * What this PC is going for, to tell the others: [[item, opened at, ...the bazaars of its plan]].
 *  - a trade you started on (Plan trade, or any press in its card) with a press in the last 10 minutes;
 *  - a trade a trader said yes to, with a buy in the last 10 minutes - its items still to buy.
 * A pinned trade is not one: a pin is kept for days. Walk away, and the mark goes by itself.
 * @param {Iterable<{trade: {at, lines}, touched: number}>} holds
 * @param {Array<{at, items}>} accepted
 * @param {(step) => boolean} done - a step that is bought or skipped
 */
export function sharedGoingOwn({ holds = [], accepted = [], now, done = () => false } = {}) {
    const out = [];
    const sellersOf = (steps) => [...new Set((steps || []).filter((st) => st && st.sellerId).map((st) => Number(st.sellerId)))];
    for (const h of holds || []) {
        if (!h || !h.trade || !(now - h.touched < SHARED_GOING_QUIET_MS)) continue;
        for (const line of h.trade.lines || []) {
            if (!line || !(line.units > 0) || !(line.steps || []).length) continue;
            out.push([Number(line.itemId), Number(h.trade.at) || h.touched, ...sellersOf(line.steps)]);
        }
    }
    for (const t of accepted || []) {
        if (!t) continue;
        let last = Number(t.at) || 0;
        for (const i of t.items || []) for (const st of i.steps || []) if (Number(st.boughtAt) > last) last = Number(st.boughtAt);
        if (!(now - last < SHARED_GOING_QUIET_MS)) continue;
        for (const i of t.items || []) {
            const open = (i.steps || []).filter((st) => !done(st));
            if (open.length) out.push([Number(i.itemId), Number(t.at) || last, ...sellersOf(open)]);
        }
    }
    return out;
}

/** The others' "going for this", per item: Map of item (as text) -> {who: [Torn name or null, one per person], at: the earliest, sellers: Set of bazaars (as text)}. */
export function sharedGoingByItem(going) {
    const out = new Map();
    for (const m of going || []) {
        const key = String(m.item);
        const had = out.get(key) || { who: [], ids: new Set(), at: m.at, sellers: new Set() };
        const person = m.whoId || m.who || '?';
        if (!had.ids.has(person)) {
            had.ids.add(person);
            had.who.push(m.who || null);
        }
        had.at = Math.min(had.at, m.at);
        for (const seller of m.sellers || []) had.sellers.add(String(seller));
        out.set(key, had);
    }
    return out;
}

// "now", "3m", "2h": as short as a tag needs.
function sharedAgo(ms) {
    const minutes = Math.floor(Math.max(0, ms) / 60000);
    return minutes < 1 ? 'now' : minutes < 60 ? minutes + 'm' : Math.floor(minutes / 60) + 'h';
}

// Who, by Torn name: "A", "A and B"; with a name not known, "A friend", "2 friends". And whether that is one or many.
function sharedWho(names) {
    const known = (names || []).filter(Boolean);
    const n = (names || []).length || 1;
    if (known.length < n) return { text: n === 1 ? 'A friend' : n + ' friends', many: n > 1 };
    return { text: known.length === 1 ? known[0] : known.slice(0, -1).join(', ') + ' and ' + known[known.length - 1], many: n > 1 };
}

/** The tag on a row: "xX-Vin-Xx is on this · 3m". */
export function sharedOnThis(mark, now) {
    const who = sharedWho(mark.who);
    return who.text + (who.many ? ' are' : ' is') + ' on this · ' + sharedAgo(now - mark.at);
}

/** The line on a card: {lead: "xX-Vin-Xx is going for this", rest: "opened 3m ago"}; with an item's name, "...for the Xanax here". */
export function sharedGoingFor(mark, now, itemHere = null) {
    const who = sharedWho(mark.who);
    const age = sharedAgo(now - mark.at);
    return {
        lead: who.text + (who.many ? ' are' : ' is') + ' going for ' + (itemHere ? 'the ' + itemHere + ' here' : 'this'),
        rest: 'opened ' + (age === 'now' ? 'just now' : age + ' ago'),
    };
}

/** A friend's buy that took from your plan: {lead: "xX-Vin-Xx bought 2", rest: "at swagbazaar · 1m ago · your plan is now 3"}. */
export function sharedBoughtLine({ who = null, qty, bazaar = null, at, units }, now) {
    const age = sharedAgo(now - at);
    return {
        lead: (who || 'A friend') + ' bought ' + qty,
        rest: 'at ' + (bazaar || 'a bazaar') + ' · ' + (age === 'now' ? 'just now' : age + ' ago') + ' · your plan is now ' + units,
    };
}

/* --------------------------------------------- Settings > Shared, in words */

const SHARED_QUIET_MS = 2 * 60000;

// A Torn name as Torn makes them. The server sends each person's own (asked of Torn for their key);
// anything else is not shown - "a friend" stands in. No person's name is written in this script.
const SHARED_TORN_NAME = /^[A-Za-z0-9_-]{1,32}$/;

/** {id, name} as the server sent it, checked: a Torn id and a Torn name, or nulls. */
export function sharedPerson(sent) {
    const id = sent && Number.isInteger(sent.id) && sent.id > 0 && sent.id < 1e10 ? sent.id : null;
    const name = sent && typeof sent.name === 'string' && SHARED_TORN_NAME.test(sent.name) ? sent.name : null;
    return { id, name };
}

/** "A is on now", "A and B are on now", "2 others are on now": Torn names where known, a count where not. */
function sharedOnNow(on) {
    const names = on.map((p) => p && p.name).filter(Boolean);
    if (!on.length) return 'nobody else is on now';
    if (names.length < on.length) return on.length === 1 ? '1 other is on now' : on.length + ' others are on now';
    return names.length === 1 ? names[0] + ' is on now' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' are on now';
}

function sharedClock(at) {
    const d = new Date(at);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Is the shared server something to show on this PC? Only once it has answered it as one of its people:
 * anyone may install Torn Bids, and to everyone else there is no server and nothing is said of one.
 */
export function sharedKnown(st) {
    return Boolean(st && st.on && !st.unknown && (st.okAt || st.update));
}

/**
 * What the server last said to this PC, as one word; a change of it is one line in the log (3.25.0), so a
 * zip shows at a glance whether the server knew this PC.
 * @param {object} st - SharedLink.status()
 */
export function sharedSaid(st) {
    if (!st || !st.on) return 'off';
    if (st.unknown) return 'unknown';
    if (st.update) return 'update';
    if (st.error) return 'error';
    return st.okAt ? 'ok' : 'waiting';
}

/** The log's line for that word; null = nothing to say yet. `hours`: how long until a PC it does not know asks again. */
export function sharedSaidLine(st, hours) {
    const word = sharedSaid(st);
    if (word === 'unknown') {
        // 3.26.0: sooner at first (5, 15, 60 minutes), then every `hours`.
        const ms = Number(st && st.unknownWaitMs) || 0;
        const again = ms > 0 && ms < hours * 3600000 ? Math.round(ms / 60000) + ' minutes' : hours + ' hours';
        return 'Shared: the server answered 404 - the Public key of this PC is not on the server as "runs our app". Nothing is exchanged; it is asked again in ' + again + ', or at once when the key changes';
    }
    if (word === 'ok') return 'Shared: the server knows this PC and answers';
    if (word === 'update') return 'Shared: the server knows this PC and wants a newer Torn Bids (' + String(st.update).slice(0, 40) + '): nothing is exchanged until this copy is updated';
    if (word === 'error') return 'Shared: no exchange - ' + String(st.error).slice(0, 120);
    return null;
}

// The server answers, and reads nothing for now.
const SHARED_NOT_READING = ['blocked', 'paused', 'stopped', 'resting'];

/**
 * The "Now" line: {level: 'off' | 'ok' | 'idle' | 'warn' | 'bad', text}. Only what is known.
 * @param {object} st - SharedLink.status()
 */
export function sharedNowLine(st, now) {
    if (!st || !st.on) return { level: 'off', text: 'Off. Torn Bids works alone.' };
    // Not one of the server's people: nothing to do here, and nothing is asked of the person.
    if (st.unknown) return { level: 'off', text: 'Not on the shared server. Torn Bids works alone.' };
    // Whoever runs the server asked for a newer Torn Bids: nothing is exchanged until this one is updated.
    if (st.update) return { level: 'bad', text: 'This server wants Torn Bids ' + st.update + ' or newer. Update Torn Bids · working alone until then' };
    if (!st.okAt) return st.error ? { level: 'warn', text: 'No answer yet · working alone' } : { level: 'idle', text: 'Connecting…' };
    if (st.error || now - st.okAt > SHARED_QUIET_MS) return { level: 'warn', text: 'No answer since ' + sharedClock(st.okAt) + ' · working alone' };
    const parts = ['Connected'];
    if (st.people) parts.push(st.people + (st.people === 1 ? ' person' : ' people'));
    if (st.people > 1) parts.push(sharedOnNow(st.peopleOn || []));
    parts.push('last exchange ' + Math.max(0, Math.floor((now - st.okAt) / 1000)) + ' s ago');
    if (st.reading === 'blocked') parts.push('Torn has blocked the server for now');
    else if (st.reading === 'paused') parts.push('the server is waiting on Torn');
    else if (st.reading === 'stopped') parts.push('whoever runs the server has stopped its reading · working alone');
    else if (st.reading === 'resting') parts.push('the server rests until 00:00 UTC, its free limit for today is near · working alone');
    return { level: SHARED_NOT_READING.includes(st.reading) ? 'warn' : 'ok', text: parts.join(' · ') };
}

/**
 * The one line in the small panel on Torn's pages (3.25.0, drawing 1): {lead, rest}, or null with
 * Shared off. Shared is set up in Torn Bids only; here it is just said, with what is known.
 * @param {object} st - SharedLink.status()
 */
export function sharedPanelLine(st, now) {
    if (!sharedKnown(st)) return null;
    const silent = !st.okAt || st.error || now - st.okAt > SHARED_QUIET_MS;
    if (st.update) return { lead: 'Shared is on', rest: 'the server wants a newer Torn Bids, working alone' };
    if (silent) return { lead: 'Shared is on', rest: 'no answer from the server, working alone' };
    if (st.reading === 'stopped' || st.reading === 'resting') return { lead: 'Shared is on', rest: 'the server is not reading now, working alone' };
    return { lead: 'Shared is on', rest: st.people ? st.people + (st.people === 1 ? ' person' : ' people') : 'connected' };
}

/**
 * Under the Public key's box in Settings (3.26.0): what the server said of this key, while that is not said
 * anywhere else on the page - to the server's own people the Shared part says it, so here: nothing.
 * @param {object} st - SharedLink.status()
 * @returns {string} '' = nothing to say
 */
export function sharedKeyBoxLine(st) {
    if (!st || !st.on || sharedKnown(st)) return '';
    if (st.unknown) {
        const ms = Number(st.unknownWaitMs) || 0;
        const again = ms >= 3600000 ? Math.round(ms / 3600000) + (ms < 5400000 ? ' hour' : ' hours') : Math.max(1, Math.round(ms / 60000)) + ' minutes';
        return 'Shared server: it does not know this key, so Torn Bids works alone. Whoever runs your server needs this same key from you. Asked again every ' + again + ', and at once when you save the key here again.';
    }
    return st.error ? 'Shared server: no answer yet.' : 'Shared server: not asked yet.';
}

/** "Your Torn key on the server": {level, text}; what the server last said of it. */
export function sharedKeyLine(st) {
    if (!st || !st.on || !st.okAt || !st.key) return { level: 'off', text: 'Not known yet.' };
    // Whose key the server holds for this PC, as Torn says: so a key put under the wrong person shows.
    const whose = st.you && st.you.name ? st.you.name + (st.you.id ? ' [' + st.you.id + ']' : '') : null;
    if (st.key === 'working') return { level: 'ok', text: whose ? 'Working · the key of ' + whose : 'Working' };
    const code = /\((\d+)\)/.exec(st.key);
    return { level: 'bad', text: 'Torn refused your key on the server' + (code ? ' (code ' + code[1] + ')' : '') + '. Whoever runs your server needs a new Public Only key from you.' };
}

/** "Your 100 Torn calls this minute", as last agreed with the server: {pc, server, free}; null when not known. */
export function sharedSplit(st, now) {
    if (!st || !st.on || !st.okAt || now - st.okAt > SHARED_GRANT_STALE_MS || !Number.isFinite(st.need) || !Number.isFinite(st.serverShare)) return null;
    const pc = Math.max(0, Math.min(100, Math.round(st.need)));
    const server = Math.max(0, Math.min(100 - pc, Math.round(st.serverShare)));
    return { pc, server, free: 100 - pc - server };
}

/**
 * The TornW3B lists the open parts of the script read (3.25.0): [[item, when]], the newest read of
 * each item, newest first, in this PC's time. Item numbers and times - nothing else comes out.
 */
export function sharedDir(wants) {
    const at = new Map();
    for (const w of Array.isArray(wants) ? wants : []) {
        for (const entry of w && Array.isArray(w.dir) ? w.dir : []) {
            if (!Array.isArray(entry)) continue;
            const item = sharedId(entry[0]);
            const when = entry[1];
            if (item === null || !Number.isFinite(when) || when <= 0) continue;
            if (!(at.get(item) >= when)) at.set(item, Math.floor(when));
        }
    }
    return [...at].sort((a, b) => b[1] - a[1]).slice(0, SHARED_MAX_DIR);
}

const SHARED_ALONE = { of: 1, me: 0 };

/**
 * The other PCs' TornW3B reads, from the server's answer, added to what was kept: item -> when, in
 * THIS PC's time (the answer carries ages). And this PC's turn among the PCs that are on.
 * @returns {{reads: object, turn: {of: number, me: number}}}
 */
export function sharedDirIn(answer, had, now) {
    const reads = {};
    for (const [item, at] of Object.entries(had && had.reads && typeof had.reads === 'object' ? had.reads : {})) {
        if (/^\d{1,10}$/.test(item) && Number.isFinite(at) && now - at < SHARED_DIR_KEEP_MS) reads[item] = at;
    }
    for (const entry of answer && Array.isArray(answer.dir) ? answer.dir : []) {
        if (!Array.isArray(entry)) continue;
        const item = sharedId(entry[0]);
        const age = entry[1];
        if (item === null || !Number.isFinite(age) || age < 0 || age >= SHARED_DIR_KEEP_MS) continue;
        const at = Math.floor(now - age);
        if (!(reads[item] >= at)) reads[item] = at;
    }
    const t = answer && answer.turn;
    const turn = t && Number.isInteger(t.of) && t.of >= 1 && t.of <= 50 && Number.isInteger(t.me) && t.me >= 0 && t.me < t.of ? { of: t.of, me: t.me } : { ...SHARED_ALONE };
    return { reads, turn };
}

/**
 * Is an item's TornW3B list due on this PC (a background read - never the desk or a trade)?
 * A read another PC made counts as a read; and with several PCs on, an item has one PC that goes
 * first - the others wait SHARED_TURN_WAIT_MS past due, then read it themselves.
 * @param {number} ownAt - this PC's own last read
 * @param {{reads: object, turn: {of: number, me: number}}|null} kept - sharedDirIn(); null = Shared off
 */
export function sharedDirDue(ownAt, every, now, itemId, kept) {
    if (!kept) return now - ownAt >= every;
    const friendAt = Number(kept.reads && kept.reads[String(itemId)]) || 0;
    const turn = kept.turn || SHARED_ALONE;
    const mine = !(turn.of > 1) || Number(itemId) % turn.of === turn.me;
    return now - Math.max(ownAt, friendAt) >= every + (mine ? 0 : SHARED_TURN_WAIT_MS);
}
