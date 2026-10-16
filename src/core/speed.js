/*
 * The speed log (3.17.0).
 *
 * The friend: it lags on his laptop. He will not take screenshots of Chrome's
 * task manager or change anything on his PC, so the script keeps its own
 * evidence (the owner: "we should just have something ... that exports his
 * logs (that also doesnt lag ...) we can include it in the zip file he
 * already gives us"). No speed was measured anywhere before this.
 *
 * What is kept: the name of a kind of work, how often it ran, how long it
 * took in all and at its longest - by the hour for a day, then by the day
 * for a week. The browser's own reports of freezes (a stretch of 50 ms or
 * more with the tab stuck) and of slow clicks and key presses (over 100 ms
 * to show). Each stored value's reads and writes. How many changes inside
 * the rows we watch did not come from us. The 50 slowest single events.
 *
 * 3.28.1 - and sizes and counts, by the hour (group `g`, speedGauge): how many
 * items, sellers lists, flips and traders a Torn Bids redraw had to work
 * through, how much of it was kept from the redraw before, how old the page
 * was, how much memory the tab held. The friend's zip of 2026-10-11 showed a
 * redraw going from 256 ms to 4,096 ms within five hours and nothing in it
 * said why: the times were there, what they were spent on was not.
 *
 * What is never kept: a name, a player id, an item, a price, a key, a page
 * address. Every label is one of this file's own words, or a stored value's
 * name (ours), or a kind of page ("bazaar", "trade", "Torn Bids").
 *
 * Why it does not lag: recording is two clock reads around work that is
 * already happening and a counter bumped in memory (speedAdd). The record is
 * written to storage at most once a minute and when the tab goes, added to
 * what the other tabs stored (speedMerge) the way the API use record is.
 *
 * And why it stays small - the browser hands every stored value to the script
 * on every page, this one too: the stored record writes each label once
 * (`n`) and its buckets hold only the label's number; the stored values'
 * reads and writes are kept by the day, not the hour. About 20 KB for a week
 * of ordinary use. speedExpand gives it back with the labels.
 *
 * Pure: no DOM, no clock of its own, no storage.
 */

/** Hours kept one by one; older ones are folded into their day. */
export const SPEED_HOURS_KEPT = 24;
/** Days kept. */
export const SPEED_DAYS_KEPT = 7;
/** The slowest single events kept. */
export const SPEED_TOP = 50;
/** An event this long is one of the slow ones (and what the browser calls a long task). */
export const SPEED_SLOW_MS = 50;
/** Start-ups kept (the newest). */
export const SPEED_STARTS = 40;
/** Labels the stored record can hold; any more are counted together as "other". */
export const SPEED_NAMES = 300;

const SP_HOUR_MS = 3600000;
const SP_DAY_MS = 86400000;

const spRound = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** A stored value's name without what would tell one tab or one trade from another. */
export function speedKey(key) {
    const k = String(key || '?');
    // The per-tab request windows: 'apiWindow.<tab>' (the list of tabs is 'apiWindow.tabs').
    const dot = k.indexOf('.');
    if (dot > 0 && k.slice(dot + 1) !== 'tabs') return k.slice(0, dot) + '.tab';
    return k.replace(/\d{3,}/g, 'N').slice(0, 40);
}

/** A tab's counts not yet written. */
export function speedNew() {
    return { h: {}, top: [], start: [], machine: null };
}

function spBucket(p, at) {
    const hour = String(Math.floor(at / SP_HOUR_MS));
    return p.h[hour] || (p.h[hour] = { w: {}, f: {}, i: {}, g: {}, s: {}, x: [0, 0, 0] });
}

function spBump(group, name, ms) {
    const row = group[name] || (group[name] = [0, 0, 0]);
    row[0] += 1;
    row[1] += ms;
    if (ms > row[2]) row[2] = ms;
}

function spNoteTop(p, ms, kind, where, at) {
    if (!(ms >= SPEED_SLOW_MS)) return;
    const top = p.top;
    if (top.length >= SPEED_TOP && ms <= top[top.length - 1][0]) return;
    top.push([spRound(ms), kind, where, Math.floor(at / SP_HOUR_MS)]);
    top.sort((a, b) => b[0] - a[0]);
    if (top.length > SPEED_TOP) top.length = SPEED_TOP;
}

/**
 * One piece of work, timed.
 * @param {object} p - speedNew
 * @param {'w'|'f'|'i'} group - work of ours, a freeze, a slow click or key
 * @param {string} kind - what it was (this file's callers' own words)
 * @param {number} ms
 * @param {string} where - the kind of page
 */
export function speedAdd(p, group, kind, ms, where = '', at = Date.now()) {
    const d = Number(ms);
    if (!(d >= 0) || !Number.isFinite(d)) return p;
    const name = group === 'w' ? kind : where + ' · ' + kind;
    spBump(spBucket(p, at)[group], name, d);
    spNoteTop(p, d, group === 'w' ? kind : (group === 'f' ? 'freeze' : 'slow ' + kind), where, at);
    return p;
}

/**
 * A size or a count, not a time (3.28.1): how many times it was noted this hour, their sum, the most.
 * @param {object} p - speedNew
 * @param {string} name - what is counted (the caller's own words; never a name, an id, an item or a price)
 * @param {number} value
 */
export function speedGauge(p, name, value, at = Date.now()) {
    // Not known is not nothing: only a number is noted.
    if (typeof value !== 'number') return p;
    const v = value;
    if (!(v >= 0) || !Number.isFinite(v)) return p;
    spBump(spBucket(p, at).g, String(name), v);
    return p;
}

/** One read or write of a stored value: how long, and how big its text was. */
export function speedStore(p, key, write, ms, size, at = Date.now()) {
    const d = Number(ms);
    if (!(d >= 0) || !Number.isFinite(d)) return p;
    const s = spBucket(p, at).s;
    const name = speedKey(key);
    const row = s[name] || (s[name] = [0, 0, 0, 0, 0, 0, 0]);
    const o = write ? 3 : 0;
    row[o] += 1;
    row[o + 1] += d;
    if (d > row[o + 2]) row[o + 2] = d;
    if (size > 0) row[6] = size;
    return p;
}

/**
 * A change inside the rows we watch that we did not make (Torn redrawing, or
 * another extension writing into them): how many times we were told, and how
 * many changes those held; the busiest minute is kept too.
 */
export function speedForeign(p, records, at = Date.now()) {
    const x = spBucket(p, at).x;
    x[0] += 1;
    x[1] += Math.max(0, Number(records) || 0);
    const minute = Math.floor(at / 60000);
    if (!p.min || p.min[0] !== minute) p.min = [minute, 0];
    p.min[1] += 1;
    if (p.min[1] > x[2]) x[2] = p.min[1];
    return p;
}

/** One page load's start-up: when the script started, its panel showed and its item data was ready (ms after the page began). */
export function speedStartup(p, where, { script = null, panel = null, items = null } = {}, at = Date.now()) {
    const n = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
    p.start.push([Math.floor(at / SP_HOUR_MS), String(where || ''), n(script), n(panel), n(items)]);
    if (p.start.length > SPEED_STARTS) p.start.splice(0, p.start.length - SPEED_STARTS);
    return p;
}

/** What the browser says of the machine (nothing a page cannot already read). */
export function speedMachine(p, facts) {
    p.machine = facts && typeof facts === 'object' ? { ...facts } : null;
    return p;
}

/** Is there anything to write? */
export function speedHasData(p) {
    return Boolean(p && (Object.keys(p.h).length || p.top.length || p.start.length || p.machine));
}

function spClean(stored) {
    const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    // Buckets by hour or day number; anything else in there is junk.
    const obj = (v) => Object.fromEntries(Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).filter(([k, b]) => Number.isFinite(Number(k)) && Number(k) > 0 && b && typeof b === 'object'));
    return {
        v: 1,
        n: Array.isArray(s.n) ? s.n.map(String) : [],
        h: { ...obj(s.h) },
        d: { ...obj(s.d) },
        top: Array.isArray(s.top) ? s.top.filter((t) => Array.isArray(t) && Number(t[0]) > 0 && Number.isFinite(Number(t[3]))) : [],
        start: Array.isArray(s.start) ? s.start.filter((t) => Array.isArray(t) && Number.isFinite(Number(t[0]))) : [],
        machine: s.machine && typeof s.machine === 'object' ? s.machine : null,
    };
}

function spAddRows(into, from, width, as) {
    for (const [key, row] of Object.entries(from || {})) {
        if (!Array.isArray(row)) continue;
        const name = as(key);
        const t = Array.isArray(into[name]) ? [...into[name]] : new Array(width).fill(0);
        if (width === 3) {
            t[0] += Number(row[0]) || 0;
            t[1] = spRound(t[1] + (Number(row[1]) || 0));
            t[2] = spRound(Math.max(t[2], Number(row[2]) || 0));
        } else {
            for (const o of [0, 3]) {
                t[o] += Number(row[o]) || 0;
                t[o + 1] = spRound(t[o + 1] + (Number(row[o + 1]) || 0));
                t[o + 2] = spRound(Math.max(t[o + 2], Number(row[o + 2]) || 0));
            }
            if (Number(row[6]) > 0) t[6] = Number(row[6]);
        }
        into[name] = t;
    }
}

/** `b` added into target[key]; `as` turns a label of `b` into the label target uses (its number, or itself). */
function spAddBucket(target, key, b, as = (k) => k) {
    const src = b && typeof b === 'object' ? b : {};
    const cur = target[key] && typeof target[key] === 'object' ? target[key] : {};
    const out = { w: { ...(cur.w || {}) }, f: { ...(cur.f || {}) }, i: { ...(cur.i || {}) }, g: { ...(cur.g || {}) }, s: { ...(cur.s || {}) }, x: Array.isArray(cur.x) ? [...cur.x] : [0, 0, 0] };
    spAddRows(out.w, src.w, 3, as);
    spAddRows(out.f, src.f, 3, as);
    spAddRows(out.i, src.i, 3, as);
    spAddRows(out.g, src.g, 3, as);
    spAddRows(out.s, src.s, 7, as);
    const x = Array.isArray(src.x) ? src.x : [0, 0, 0];
    out.x = [out.x[0] + (Number(x[0]) || 0), out.x[1] + (Number(x[1]) || 0), Math.max(out.x[2], Number(x[2]) || 0)];
    // Empty parts are not stored.
    for (const g of ['w', 'f', 'i', 'g', 's']) if (!Object.keys(out[g]).length) delete out[g];
    if (!out.x.some((v) => v > 0)) delete out.x;
    target[key] = out;
}

/**
 * The stored record with a tab's pending counts added: hours over a day
 * old folded into their day, days over a week old dropped, the 50 slowest
 * kept. Two tabs writing in the same instant can lose a few counts - this is
 * a record to read where the time goes from, not a meter.
 */
export function speedMerge(stored, pending, now = Date.now()) {
    const out = spClean(stored);
    const p = pending || {};
    // Each label is written once; the buckets hold its number.
    const at = new Map(out.n.map((name, i) => [name, i]));
    const numberOf = (name) => {
        let label = String(name);
        if (!at.has(label) && out.n.length >= SPEED_NAMES) label = 'other';
        if (!at.has(label)) {
            at.set(label, out.n.length);
            out.n.push(label);
        }
        return String(at.get(label));
    };
    for (const [hour, b] of Object.entries(p.h || {})) {
        if (!b || typeof b !== 'object') continue;
        spAddBucket(out.h, hour, { w: b.w, f: b.f, i: b.i, g: b.g, x: b.x }, numberOf);
        // The stored values' reads and writes: by the day.
        if (b.s && Object.keys(b.s).length) spAddBucket(out.d, String(Math.floor((Number(hour) * SP_HOUR_MS) / SP_DAY_MS)), { s: b.s }, numberOf);
    }
    const nowHour = Math.floor(now / SP_HOUR_MS);
    for (const hour of Object.keys(out.h)) {
        if (nowHour - Number(hour) >= SPEED_HOURS_KEPT) {
            spAddBucket(out.d, String(Math.floor((Number(hour) * SP_HOUR_MS) / SP_DAY_MS)), out.h[hour]);
            delete out.h[hour];
        }
    }
    const nowDay = Math.floor(now / SP_DAY_MS);
    for (const day of Object.keys(out.d)) if (nowDay - Number(day) >= SPEED_DAYS_KEPT) delete out.d[day];
    const oldest = nowHour - SPEED_DAYS_KEPT * 24;
    out.top = [...out.top, ...(p.top || [])].filter((t) => Number(t[3]) >= oldest).sort((a, b) => b[0] - a[0]).slice(0, SPEED_TOP);
    out.start = [...out.start, ...(p.start || [])].filter((t) => Number(t[0]) >= oldest).slice(-SPEED_STARTS);
    if (p.machine) out.machine = p.machine;
    return spCompact(out);
}

/** The record without the labels no bucket holds any more (their numbers closed up). */
function spCompact(r) {
    const used = new Set();
    const groups = ['w', 'f', 'i', 'g', 's'];
    for (const b of [...Object.values(r.h), ...Object.values(r.d)]) for (const g of groups) for (const k of Object.keys(b[g] || {})) used.add(Number(k));
    if (used.size === r.n.length) return r;
    const order = [...used].filter((i) => r.n[i] !== undefined).sort((a, b) => a - b);
    const to = new Map(order.map((old, i) => [String(old), String(i)]));
    const renumber = (buckets) => {
        const out = {};
        for (const [key, b] of Object.entries(buckets)) {
            const nb = { ...b };
            for (const g of groups) {
                if (!b[g]) continue;
                nb[g] = {};
                for (const [k, row] of Object.entries(b[g])) if (to.has(k)) nb[g][to.get(k)] = row;
            }
            out[key] = nb;
        }
        return out;
    };
    return { ...r, n: order.map((i) => r.n[i]), h: renumber(r.h), d: renumber(r.d) };
}

/** The stored record with its labels written out again: {h, d: {key: {w, f, i, s, x}}, top, start, machine}. */
export function speedExpand(record) {
    const r = spClean(record);
    const nameOf = (k) => (r.n[Number(k)] === undefined ? 'label ' + k : r.n[Number(k)]);
    const open = (buckets) => {
        const out = {};
        for (const [key, b] of Object.entries(buckets)) {
            spAddBucket(out, key, b, nameOf);
            out[key] = { w: {}, f: {}, i: {}, g: {}, s: {}, x: [0, 0, 0], ...out[key] };
        }
        return out;
    };
    return { h: open(r.h), d: open(r.d), top: r.top, start: r.start, machine: r.machine };
}

/** Everything in the record added into one bucket (the week's totals), labels written out. */
export function speedTotals(record) {
    const r = speedExpand(record);
    const all = {};
    for (const b of Object.values(r.d)) spAddBucket(all, 'all', b);
    for (const b of Object.values(r.h)) spAddBucket(all, 'all', b);
    return { w: {}, f: {}, i: {}, g: {}, s: {}, x: [0, 0, 0], ...(all.all || {}) };
}

/*
 * 3.28.1 - the words Torn Bids' redraw is recorded under, so the text below can lay them out hour by hour.
 * Times (group w) and sizes (group g). main.js records under these very words.
 */
export const SPEED_BIDS = Object.freeze({
    redraw: 'Torn Bids redraw (working out + page)',
    stage3: 'Torn Bids redraw · 3 possible flips',
    stage4: 'Torn Bids redraw · 4 the list (every item)',
    inBuyers: 'Torn Bids redraw · inside: who buys an item, all items of one redraw',
    // 3.29.0: what follows "who buys an item" for every item was outside every count - and was the larger half.
    inShown: 'Torn Bids redraw · inside: the buyers an item shows (blacklist, favourites, Show choices), all items of one redraw',
    // The buyers worked out in pieces before a redraw: not inside "Torn Bids redraw" above (only the last piece is).
    pieces: 'Torn Bids buyers worked out in pieces (before a redraw)',
    index: 'Torn Bids: the price lists index made again',
    inSellers: 'Torn Bids redraw · inside: an item\'s bazaars, all items of one redraw',
    inPlans: 'Torn Bids redraw · inside: an item\'s flip plan, all items of one redraw',
    inPossible: 'Torn Bids redraw · inside: an item\'s possible flip, all items of one redraw',
    yard: 'the same small sum, once a minute (how fast the machine runs us)',
    yardHidden: 'the same small sum, once a minute · hidden tab',
    items: 'items in the list',
    lists: 'items with a sellers list held',
    rows: 'sellers rows held, all items',
    summary: 'items in TornW3B\'s summary',
    traders: 'traders known',
    serverBazaars: 'bazaars held from the shared server',
    candidates: 'possible flips picked to read',
    shown: 'flips shown',
    waiting: 'possible flips waiting for a price check',
    fresh: 'flips newly shown since the redraw before',
    left: 'flips gone since the redraw before',
    measured: 'items the server measured the speed of',
    buyersKept: 'who buys an item: kept from the redraw before',
    buyersRedone: 'who buys an item: worked out again',
    buyersOn: 'who buys an item: keeping on (1) or switched off (0)',
    sellersKept: 'an item\'s bazaars: kept from the redraw before',
    sellersRedone: 'an item\'s bazaars: worked out again',
    sellersOn: 'an item\'s bazaars: keeping on (1) or switched off (0)',
    plansKept: 'an item\'s flip plan: kept from the redraw before',
    plansRedone: 'an item\'s flip plan: worked out again',
    plansOn: 'an item\'s flip plan: keeping on (1) or switched off (0)',
    shownKept: 'the buyers an item shows: kept from the redraw before',
    shownRedone: 'the buyers an item shows: worked out again',
    shownOn: 'the buyers an item shows: keeping on (1) or switched off (0)',
    possibleKept: 'an item\'s possible flip: kept from the redraw before',
    possibleRedone: 'an item\'s possible flip: worked out again',
    possibleOn: 'an item\'s possible flip: keeping on (1) or switched off (0)',
    // 3.29.0: what a redraw walks. The friend's redraw grew 16x in five hours with no size on record growing.
    priceLists: 'traders with a price list in use',
    buyerRows: 'buyer rows of all items (who buys an item, added up)',
    byData: 'redraws asked for by arriving data (they wait their turn)',
    // 3.30.0: of those, the ones about what is on the desk - they do not wait for the calm pace.
    byNear: 'redraws asked for by data about the item or the trade on the desk (not held to the calm pace)',
    // 3.33.0: of all redraws, the ones with no new bazaars, market, statuses, summary, TornExchange lists, item traders
    // or price lists since the last (votes, networth, the shared server's own data and favourites are not in the word).
    sameData: 'redraws drawn on the same reads as the one before (by the store versions)',
    // 3.33.0 (engines plan Stage 6): where the bazaars come from, once a minute - measured first.
    fromServer: 'items with bazaars from the shared server only',
    fromW3b: 'items with bazaars from TornW3B only (this PC read them)',
    fromBoth: 'items with bazaars from both the shared server and TornW3B',
    serverLeads: 'items the shared server leads (it agreed with TornW3B often enough)',
    leftToServer: 'TornW3B reads left to the shared server, in the last minute',
    ownReads: 'bazaars of sellers read from Torn to confirm a flip, in the last minute',
    byPress: 'redraws asked for by the answer to something pressed (after a moment, not waiting their turn)',
    byStatus: 'redraws asked for by the first status answer after a press',
    byTyping: 'redraws asked for by typing in the search box',
    byOther: 'redraws drawn at once (a press on the page itself, a setting changed in another tab)',
    age: 'minutes since this Torn Bids page was opened',
    heap: 'memory the tab holds (MB, as the browser says)',
    nodes: 'elements in Torn Bids\' page',
    gap: 'seconds between two redraws',
});

const spPad = (s, n) => String(s).padEnd(n);
const spLpad = (s, n) => String(s).padStart(n);
const spMs = (n) => (Number(n) >= 100 ? Math.round(Number(n)).toLocaleString('en-US') : (Math.round(Number(n) * 10) / 10).toFixed(1));
const spKb = (n) => (Number(n) / 1024).toFixed(Number(n) < 10240 ? 1 : 0) + ' KB';
const spNum = (n) => (Number(n) >= 100 ? Math.round(Number(n)).toLocaleString('en-US') : String(Math.round(Number(n) * 10) / 10));

function spTable(rows, head) {
    if (!rows.length) return ['  (nothing recorded)'];
    // Each column as wide as its widest cell: the first to the left, the numbers to the right.
    const all = [head, ...rows];
    const w = head.map((_, c) => Math.max(...all.map((r) => String(r[c] === undefined ? '' : r[c]).length)));
    const line = (r) => '  ' + spPad(r[0], w[0]) + r.slice(1).map((c, i) => '  ' + spLpad(c, w[i + 1])).join('');
    return all.map(line);
}

/**
 * The record as text, worst first - for a person to read.
 *
 * @param {object} record - speedMerge output
 * @param {object} [o]
 * @param {Array<[string, number]>} [o.sizes] - every stored value's size (bytes), for this export
 * @param {object} [o.machine] - the machine as this tab sees it now
 * @param {string} [o.version]
 */
export function speedText(record, { sizes = [], machine = null, version = null, now = Date.now() } = {}) {
    const r = speedExpand(record);
    const all = speedTotals(record);
    const hours = Object.keys(r.h).map(Number);
    const days = Object.keys(r.d).map(Number);
    // From the first hour on record - or, when an earlier day was folded away, from that day.
    const firstHour = hours.length ? Math.min(...hours) * SP_HOUR_MS : Infinity;
    const firstDay = days.length ? Math.min(...days) * SP_DAY_MS : Infinity;
    const first = Math.min(firstHour === Infinity || firstDay < firstHour - SP_DAY_MS ? firstDay : Infinity, firstHour, now);
    const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    const out = [
        'Torn Trading - speed log' + (version ? ' (script ' + version + ')' : ''),
        'Made ' + stamp(now) + ' UTC, covering from ' + stamp(first) + ' UTC.',
        'Times are milliseconds. No name, id, item, price or key is in this file.',
        '',
    ];
    const m = machine || r.machine;
    out.push('THE MACHINE (what the browser tells any page)');
    out.push(m ? '  ' + Object.entries(m).map(([k, v]) => k + ': ' + v).join(' · ') : '  (not recorded)');
    out.push('');

    const work = Object.entries(all.w).sort((a, b) => b[1][1] - a[1][1]);
    out.push('OUR OWN WORK, the most time first (one kind can be inside another: a scan ends with a panel redraw)');
    out.push(...spTable(work.map(([k, v]) => [k, v[0].toLocaleString('en-US'), spMs(v[1]), spMs(v[0] ? v[1] / v[0] : 0), spMs(v[2])]), ['what', 'times', 'in all', 'each', 'longest']));
    out.push('');

    const freezes = Object.entries(all.f).sort((a, b) => b[1][1] - a[1][1]);
    out.push('FREEZES - the tab stuck for ' + SPEED_SLOW_MS + ' ms or more (the browser\'s own count; any script on the page, not only this one)');
    out.push(...spTable(freezes.map(([k, v]) => [k, v[0].toLocaleString('en-US'), spMs(v[1]), spMs(v[0] ? v[1] / v[0] : 0), spMs(v[2])]), ['where', 'times', 'in all', 'each', 'longest']));
    out.push('');

    const inputs = Object.entries(all.i).sort((a, b) => b[1][1] - a[1][1]);
    out.push('SLOW CLICKS AND KEY PRESSES - over 100 ms until the page showed it (the browser\'s own count)');
    out.push(...spTable(inputs.map(([k, v]) => [k, v[0].toLocaleString('en-US'), spMs(v[1]), spMs(v[0] ? v[1] / v[0] : 0), spMs(v[2])]), ['where · what', 'times', 'in all', 'each', 'longest']));
    out.push('');

    out.push('CHANGES IN THE ROWS WE WATCH THAT WE DID NOT MAKE (Torn redrawing, or another extension)');
    out.push('  told ' + all.x[0].toLocaleString('en-US') + ' times, ' + all.x[1].toLocaleString('en-US') + ' changes in all; the busiest minute: ' + all.x[2].toLocaleString('en-US') + ' times');
    out.push('');

    const store = Object.entries(all.s).sort((a, b) => b[1][1] + b[1][4] - (a[1][1] + a[1][4]));
    out.push('STORED VALUES - reads and writes, the most time first');
    out.push(...spTable(store.map(([k, v]) => [k, v[0].toLocaleString('en-US'), spMs(v[1]), spMs(v[2]), v[3].toLocaleString('en-US'), spMs(v[4]), spMs(v[5]), v[6] ? spKb(v[6]) : '-']), ['value', 'reads', 'read ms', 'longest', 'writes', 'write ms', 'longest', 'size']));
    out.push('');

    out.push('START-UP - ms after the page began to load (the newest last)');
    out.push(...spTable(r.start.slice(-15).map((s) => [s[1] || '?', s[2] === null ? '-' : s[2], s[3] === null ? '-' : s[3], s[4] === null ? '-' : s[4]]), ['where', 'script', 'panel', 'item data']));
    out.push('');

    out.push('THE ' + SPEED_TOP + ' SLOWEST SINGLE EVENTS');
    out.push(...spTable(r.top.map((t) => [t[1], spMs(t[0]), t[2] || '', stamp(Number(t[3]) * SP_HOUR_MS).slice(0, 13) + 'h']), ['what', 'ms', 'where', 'hour (UTC)']));
    out.push('');

    const sized = [...sizes].sort((a, b) => b[1] - a[1]);
    out.push('EVERYTHING STORED BY THE SCRIPT - ' + spKb(sized.reduce((a, s) => a + s[1], 0)) + ' in all (the browser hands all of it to the script on every page)');
    out.push(...spTable(sized.map(([k, n]) => [k, spKb(n)]), ['value', 'size']));
    out.push('');

    const sizes3 = Object.entries(all.g).sort((a, b) => a[0].localeCompare(b[0]));
    out.push('SIZES AND COUNTS (not times) - what the work above had to go through');
    out.push(...spTable(sizes3.map(([k, v]) => [k, v[0].toLocaleString('en-US'), spNum(v[0] ? v[1] / v[0] : 0), spNum(v[2]), spNum(v[1])]), ['what', 'noted', 'usual', 'most', 'in all']));
    out.push('');

    // Torn Bids' redraw, hour by hour: what it took beside what went into it. Read across a row: a redraw that
    // got slower with nothing bigger to work through was slowed by something else (the "same small sum" says
    // whether the machine itself ran us slower; "kept" whether the results kept between redraws still were).
    const B = SPEED_BIDS;
    const each = (row) => (row && row[0] ? row[1] / row[0] : null);
    const cell = (v, f = spNum) => (v === null || v === undefined ? '-' : f(v));
    const share = (kept, redone) => {
        const k = kept ? kept[1] : 0;
        const r = redone ? redone[1] : 0;
        return k + r > 0 ? Math.round((k / (k + r)) * 100) + '%' : '-';
    };
    const onOff = (row) => (row && row[0] ? (row[1] >= row[0] ? 'on' : row[1] <= 0 ? 'OFF' : 'on ' + Math.round((row[1] / row[0]) * 100) + '%') : '-');
    const hoursSorted = Object.entries(r.h).sort((a, b) => Number(a[0]) - Number(b[0]));
    const bidsHours = hoursSorted.filter(([, b]) => b.w[B.redraw]);
    out.push('TORN BIDS, HOUR BY HOUR (UTC) - one redraw, and what went into it');
    out.push('  time of one redraw (ms)');
    out.push(...spTable(bidsHours.map(([hour, b]) => [
        stamp(Number(hour) * SP_HOUR_MS).slice(0, 13) + 'h', b.w[B.redraw][0], cell(each(b.w[B.redraw]), spMs), cell(b.w[B.redraw][2], spMs), cell(each(b.w[B.stage3]), spMs), cell(each(b.w[B.stage4]), spMs),
        cell(each(b.w[B.inBuyers]), spMs), cell(each(b.w[B.inShown]), spMs), cell(each(b.w[B.inSellers]), spMs), cell(each(b.w[B.inPlans]), spMs), cell(each(b.w[B.inPossible]), spMs), cell(each(b.w[B.yard]), spMs), cell(each(b.w[B.yardHidden]), spMs),
    ]), ['hour', 'redraws', 'each', 'longest', 'possible flips', 'the list', 'in: buyers', 'in: shown', 'in: bazaars', 'in: plans', 'in: possible', 'same sum', 'same sum hidden']));
    // 3.29.0: work that is NOT inside "each" above - the buyers worked out in pieces before a redraw, and the
    // price lists index - and who asked for the redraws. (A redraw asked for by something pressed does not wait.)
    const count = (row) => (row ? row[0] : 0);
    out.push('  beside the redraw (ms in the hour), and who asked for the redraws');
    out.push(...spTable(bidsHours.map(([hour, b]) => [
        stamp(Number(hour) * SP_HOUR_MS).slice(0, 13) + 'h', cell(b.w[B.pieces] ? b.w[B.pieces][1] : null, spMs), count(b.w[B.pieces]), cell(b.w[B.index] ? b.w[B.index][1] : null, spMs), count(b.w[B.index]),
        count(b.g[B.byData]), count(b.g[B.byNear]), count(b.g[B.byPress]), count(b.g[B.byStatus]), count(b.g[B.byTyping]), count(b.g[B.byOther]),
    ]), ['hour', 'pieces ms', 'pieces', 'index ms', 'index made', 'by data', 'the desk\'s of them', 'by a press', 'by a status', 'by typing', 'by the page']));
    out.push('  what it worked through (the usual of the hour)');
    out.push(...spTable(bidsHours.map(([hour, b]) => [
        stamp(Number(hour) * SP_HOUR_MS).slice(0, 13) + 'h', cell(each(b.g[B.items])), cell(each(b.g[B.buyerRows])), cell(each(b.g[B.priceLists])), cell(each(b.g[B.lists])), cell(each(b.g[B.rows])), cell(each(b.g[B.traders])), cell(each(b.g[B.serverBazaars])),
        cell(each(b.g[B.candidates])), cell(each(b.g[B.shown])), cell(each(b.g[B.waiting])), cell(b.g[B.fresh] ? b.g[B.fresh][1] : null), cell(each(b.g[B.measured])),
    ]), ['hour', 'items', 'buyer rows', 'price lists', 'sellers lists', 'sellers rows', 'traders', 'server bazaars', 'picked to read', 'flips shown', 'waiting', 'new flips', 'speeds']));
    out.push('  what was kept from the redraw before (share kept; keeping on or OFF), the page\'s age, memory');
    out.push(...spTable(bidsHours.map(([hour, b]) => [
        stamp(Number(hour) * SP_HOUR_MS).slice(0, 13) + 'h', share(b.g[B.buyersKept], b.g[B.buyersRedone]), onOff(b.g[B.buyersOn]), share(b.g[B.shownKept], b.g[B.shownRedone]), onOff(b.g[B.shownOn]), share(b.g[B.sellersKept], b.g[B.sellersRedone]), onOff(b.g[B.sellersOn]),
        share(b.g[B.plansKept], b.g[B.plansRedone]), onOff(b.g[B.plansOn]), share(b.g[B.possibleKept], b.g[B.possibleRedone]), onOff(b.g[B.possibleOn]), cell(b.g[B.age] ? b.g[B.age][2] : null), cell(each(b.g[B.heap])), cell(b.g[B.heap] ? b.g[B.heap][2] : null), cell(each(b.g[B.nodes])), cell(each(b.g[B.gap])),
    ]), ['hour', 'buyers kept', '', 'shown kept', '', 'bazaars kept', '', 'plans kept', '', 'possible kept', '', 'page age min', 'memory MB', 'most', 'elements', 's between redraws']));
    out.push('');

    out.push('BY HOUR (UTC) - our own work, freezes, slow clicks and keys');
    const byHour = Object.entries(r.h).sort((a, b) => Number(a[0]) - Number(b[0])).map(([hour, b]) => {
        const sum = (g) => Object.values(g || {}).reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
        const w = sum(b.w);
        const f = sum(b.f);
        const i = sum(b.i);
        return [stamp(Number(hour) * SP_HOUR_MS).slice(0, 13) + 'h', spMs(w[1]), f[0], spMs(f[1]), i[0]];
    });
    out.push(...spTable(byHour, ['hour', 'work ms', 'freezes', 'frozen ms', 'slow input']));
    return out.join('\n') + '\n';
}

/**
 * The two files for a zip (under speed/).
 * @returns {Array<{name: string, text: string}>}
 */
export function speedFiles(record, { sizes = [], machine = null, version = null, now = Date.now() } = {}) {
    const r = speedExpand(record);
    return [
        { name: 'speed.txt', text: speedText(record, { sizes, machine, version, now }) },
        { name: 'speed.json', text: JSON.stringify({ kind: 'torn-trading-speed', v: 1, exportedAt: new Date(now).toISOString(), version, machine: machine || r.machine, sizes: Object.fromEntries(sizes), record: r }) },
    ];
}
