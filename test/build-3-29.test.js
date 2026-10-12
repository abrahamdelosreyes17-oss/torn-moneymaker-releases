/*
 * 3.29.0 (PLAN-lag-and-prices.md): the lag and the prices.
 *
 * The lag: keeping that went off begins again at the next redraw, and no
 * kept result stands for longer than about a minute (core/kept.js,
 * core/kept-buyers.js); the buyers an item SHOWS are kept too
 * (core/shown-buyers.js) - proved here the way 3.18.0 proved the buyers: a
 * long session replayed, every item at every step against the pipeline as
 * 3.28.1 ran it, with the writers that test left out.
 *
 * The prices: To sell, the trade and the overlay stand only on a price
 * TornW3B confirmed in the last minutes (core/to-sell.js, core/checked.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeKeeper, keptAgeLimit, keptCheckTurn, KEPT_MAX_AGE_MS, KEPT_CHECK_ONE_IN } from '../src/core/kept.js';
import { makeBuyersKeeper } from '../src/core/kept-buyers.js';
import { buyersForItem, indexW3bByItem, traderIdsByName, mergeTraderDbs, addTraders, onlineOnly, trustedOnly, freshOnly, parseW3bBulk, bulkPriceOf, recordW3bList, TRADER_DB_VERSION } from '../src/core/traders.js';
import { favouritesFirstOnTie, favouritesSorted, withoutBlacklisted, isFavourite, editFavourite, partnerKey, blacklistKeys } from '../src/core/partners.js';
import { shownFavourites, shownVersions, shownKept, shownBuyers } from '../src/core/shown-buyers.js';
import { toSellRows, toSellBoard, toSellHeld } from '../src/core/to-sell.js';
import { checkedTable, checkedInTable, FLIP_CHECK_MS, CHECKED_TABLE_MAX } from '../src/core/checked.js';
import { traderTagLabel } from '../src/core/flips.js';
import { sellElsewhere } from '../src/core/accepted.js';
import { rng, ITEMS, world, sources } from './kept-world.js';

const NOW = 1_790_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------ the keeper */

test('a kept result\'s age limit: a minute and up to half as long again, by its key', () => {
    const limits = ITEMS.map((id) => keptAgeLimit(id));
    for (const l of limits) assert.ok(l >= KEPT_MAX_AGE_MS && l < KEPT_MAX_AGE_MS * 1.5, String(l));
    assert.equal(keptAgeLimit('206'), keptAgeLimit(206));
    assert.ok(new Set(limits).size > 8, 'they do not all fall due in one redraw');
    assert.ok(keptAgeLimit('206', 1000) >= 1000 && keptAgeLimit('206', 1000) < 1500);
});

test('which kept results a redraw checks: at least one, about one in 64, and every one of them in its turn', () => {
    for (const n of [1, 2, 3, 7, 14, 21, 49, 63, 64, 65, 100, 1361]) {
        const turn = keptCheckTurn();
        const seen = new Set();
        let last = 0;
        for (let redraw = 0; redraw <= KEPT_CHECK_ONE_IN; redraw += 1) {
            turn.begin(last);
            let checked = 0;
            for (let hit = 0; hit < n; hit += 1) {
                if (!turn.due(hit)) continue;
                seen.add(hit);
                checked += 1;
            }
            assert.ok(checked >= 1, n + ' kept, redraw ' + redraw + ': none checked');
            assert.ok(checked <= 1 + Math.ceil(n / KEPT_CHECK_ONE_IN), n + ' kept, redraw ' + redraw + ': ' + checked + ' checked');
            last = n;
        }
        // (A step of 7 through a stride of 7, 14, 21... came back to the same places: the others were never checked.)
        assert.equal(seen.size, n, n + ' kept: ' + seen.size + ' of them ever checked');
    }
    // A redraw far bigger than the one before it (a search cleared): still about one in 64.
    const turn = keptCheckTurn();
    turn.begin(3);
    let checked = 0;
    for (let hit = 0; hit < 1361; hit += 1) if (turn.due(hit)) checked += 1;
    assert.ok(checked >= 20 && checked <= 23, String(checked));
});

test('the keeper: a kept result that differed drops all that is kept, the rest of that redraw is fresh, the next redraw keeps again', () => {
    const differed = [];
    const keeper = makeKeeper({ checkAll: true, onDiffer: (key, where) => differed.push([key, where]) });
    let state = { a: 1, b: 1 };
    let calls = 0;
    // (The row of values says nothing of `state`: what the keeping fails to look at.)
    const get = (key) => keeper.get(key, [], () => {
        calls += 1;
        return { v: state[key] };
    });
    keeper.begin(1000);
    get('a');
    get('b');
    state = { a: 2, b: 1 };
    keeper.begin(2000);
    assert.deepEqual(get('a'), { v: 2 }, 'the fresh one is handed out');
    assert.equal(keeper.on(), false);
    assert.deepEqual(differed, [['a', 'v: 1 -> 2']]);
    calls = 0;
    assert.deepEqual(get('b'), { v: 1 });
    assert.equal(calls, 1, 'the rest of that redraw is worked out');
    keeper.begin(3000);
    assert.equal(keeper.on(), true, 'keeping begins again with the next redraw');
    const a = get('a');
    const b = get('b');
    keeper.begin(4000);
    assert.equal(get('a'), a, 'and what is kept is handed back as it was');
    assert.equal(get('b'), b);
    assert.equal(keeper.stats.differed, 1);
    assert.deepEqual(differed.length, 1);

    // Handed no clock (a caller from before 3.29.0, a test): off stays off, as it did.
    const old = makeKeeper({ checkAll: true });
    let n = 1;
    old.begin();
    old.get('k', [], () => ({ n }));
    n = 2;
    old.begin();
    old.get('k', [], () => ({ n }));
    assert.equal(old.on(), false);
    old.begin();
    assert.equal(old.on(), false);
    old.begin(5);
    assert.equal(old.on(), true);
});

test('the keeper: no kept result stands past its age limit - worked out again, and the very same result handed back', () => {
    const differed = [];
    const keeper = makeKeeper({ onDiffer: (key) => differed.push(key) });
    const keys = Array.from({ length: 200 }, (_, i) => 'k' + i);
    let value = 5;
    let calls = 0;
    const redraw = (clock) => {
        calls = 0;
        keeper.begin(clock);
        return new Map(keys.map((key) => [key, keeper.get(key, [key], () => {
            calls += 1;
            return { n: value };
        })]));
    };
    const first = redraw(NOW);
    assert.equal(calls, 200);
    redraw(NOW + 1000);
    assert.ok(calls <= 4, 'a second later: only the checks (' + calls + ')');
    // Past the longest limit: every one is worked out again - and each is the object that was kept.
    const aged = redraw(NOW + KEPT_MAX_AGE_MS * 1.5);
    assert.equal(calls, 200);
    for (const key of keys) assert.equal(aged.get(key), first.get(key), key);
    assert.deepEqual(differed, []);
    // They do not all fall due together again: each by its own limit.
    const half = [...keys].map((key) => keptAgeLimit(key)).sort((x, y) => x - y)[100];
    redraw(NOW + KEPT_MAX_AGE_MS * 1.5 + half);
    const due = keys.filter((key) => keptAgeLimit(key) <= half).length;
    assert.ok(due > 20 && due < 180, String(due));
    assert.ok(calls >= due && calls <= due + 4, calls + ' worked out, ' + due + ' due');

    // What nothing looks at changed: by the time the limit is over, nothing kept says the old value.
    value = 6;
    const t0 = NOW + KEPT_MAX_AGE_MS * 4;
    let last = null;
    for (let t = t0; t <= t0 + KEPT_MAX_AGE_MS * 1.5 + 2000; t += 2000) last = redraw(t);
    for (const key of keys) assert.equal(last.get(key).n, 6, key);
    assert.ok(differed.length >= 1, 'and it was found and said');
    keeper.begin(t0 + KEPT_MAX_AGE_MS * 2);
    assert.equal(keeper.on(), true);
});

test('kept buyers: with the redraw\'s clock, rows past their age limit are worked out again and are the same rows; a difference is said and keeping goes on', () => {
    const { s } = world(rng(7));
    let computed = [];
    let bump = 0;
    const differed = [];
    const work = (id, src) => buyersForItem(id, src).map((row) => (bump ? { ...row, price: row.price + bump } : row));
    const keeper = makeBuyersKeeper({ compute: (id, src) => (computed.push(id), work(id, src)), onDiffer: (id, where) => differed.push([id, where]) });
    const redraw = (clock) => {
        computed = [];
        const { votesById, of } = sources(s);
        keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db }, clock);
        return new Map(ITEMS.map((id) => [id, keeper.buyers(id, of(id))]));
    };
    const first = redraw(NOW);
    assert.equal(computed.length, ITEMS.length);
    const second = redraw(NOW + 1000);
    assert.ok(computed.length <= 1, 'a second later: only the check');
    for (const id of ITEMS) assert.equal(second.get(id), first.get(id));
    const aged = redraw(NOW + KEPT_MAX_AGE_MS * 1.5);
    assert.equal(computed.length, ITEMS.length, 'past the longest limit: every item worked out again');
    for (const id of ITEMS) assert.equal(aged.get(id), first.get(id), 'item ' + id + ': the very rows that were kept');
    assert.deepEqual(differed, []);
    assert.equal(keeper.stats.differed, 0);

    // Something the keeping does not look at moved every price: found, said, and keeping goes on.
    bump = 10;
    const t0 = NOW + KEPT_MAX_AGE_MS * 4;
    let last = null;
    for (let t = t0; t <= t0 + KEPT_MAX_AGE_MS * 1.5 + 2000; t += 2000) last = redraw(t);
    const { of } = sources(s);
    for (const id of ITEMS) assert.deepEqual(last.get(id), work(id, of(id)), 'item ' + id);
    assert.ok(differed.length >= 1);
    assert.match(differed[0][1], /price: \d+ -> \d+/);
    const after = redraw(t0 + KEPT_MAX_AGE_MS * 1.5 + 4000);
    assert.equal(keeper.on(), true);
    assert.ok(computed.length < ITEMS.length, 'kept again');
    for (const id of ITEMS) assert.deepEqual(after.get(id), work(id, of(id)));
});

/* ------------------------------------------- the session, with its writers */

/** What 3.18.0's session left out: the writers of the trader database that are not a list read. */
function moreMoves(s, r) {
    const int = (n) => Math.floor(r() * n);
    const pick = (list) => list[int(list.length)];
    const ids = () => Object.keys(s.db.traders);
    const reindex = () => {
        s.index = indexW3bByItem(s.db, s.now);
        s.dbIds = traderIdsByName(s.db);
    };
    const rated = () => ({ up: int(200), down: int(30) });
    return [
        ['another tab\'s copy folded in (saveTraderDb): a newer list, a trader not known here, a name for a placeholder', () => {
            const stored = JSON.parse(JSON.stringify({ version: TRADER_DB_VERSION, traders: s.db.traders }));
            const a = stored.traders[pick(ids())];
            a.w3b = { found: true, prices: { [pick(ITEMS)]: 50 + int(40) * 10 }, at: s.now + 1, checkedAt: s.now + 1 };
            const b = stored.traders[pick(ids())];
            if (b.name.startsWith('Trader ')) b.name = 'T' + int(60);
            // (Another tab's rating for a trader known here is never taken: the list and the name only.)
            b.rating = { ...rated(), at: s.now };
            stored.traders[String(s.nextId++)] = { name: 'T' + int(60), from: 'w3b', seenAt: s.now, rating: { ...rated(), at: s.now }, w3b: { found: true, prices: { [pick(ITEMS)]: 300 }, at: s.now, checkedAt: s.now } };
            mergeTraderDbs(s.db, stored);
            if (r() < 0.5) reindex();
        }],
        ['the seed, an item\'s TornW3B buyers, a TornW3B page: traders named and rated (addTraders)', () => {
            const found = Array.from({ length: 1 + int(4) }, () => ({ id: r() < 0.7 ? pick(ids()) : String(s.nextId++), name: 'T' + int(60), source: pick(['seed', 'w3b', 'te', 'torn']), rating: r() < 0.7 ? rated() : null }));
            addTraders(s.db, found, s.now + int(1000));
            if (r() < 0.5) reindex();
        }],
        ['a status answer names a trader', () => {
            addTraders(s.db, [{ id: pick(ids()), name: 'T' + int(60), source: 'torn' }], s.now);
        }],
        // Two sources that disagree on a trader's votes, both heard between two redraws: 523, then 524, then
        // 523 again. The numbers are what they were; the rating itself is another one, read at another moment.
        ['a rating moved and moved back between two redraws', () => {
            const id = pick(ids());
            const t = s.db.traders[id];
            const was = t.rating ? { up: t.rating.up, down: t.rating.down } : rated();
            addTraders(s.db, [{ id, source: 'w3b', rating: was }], s.now + 1);
            addTraders(s.db, [{ id, source: 'w3b', rating: { up: was.up + 1, down: was.down } }], s.now + 2);
            addTraders(s.db, [{ id, source: 'w3b', rating: was }], s.now + 3);
        }],
        ['a trader dropped and learned again from a source, rated as before', () => {
            const id = pick(ids());
            const was = s.db.traders[id];
            delete s.db.traders[id];
            addTraders(s.db, [{ id, name: was.name, source: 'te', rating: was.rating ? { up: was.rating.up, down: was.rating.down } : null }], s.now + 5);
            s.db.traders[id].w3b = was.w3b;
        }],
    ];
}

test('kept buyers, with the redraw\'s clock and every writer of the trader database: each item, each step, as worked out fresh', () => {
    let kept = 0;
    let redone = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
        const r = rng(seed * 31);
        const { s, moves, pick } = world(r);
        const all = [...moves, ...moreMoves(s, r), ...moreMoves(s, r)];
        const keeper = makeBuyersKeeper({ freeze: true, onDiffer: (id, where) => assert.fail('the keeper\'s own check found a difference (seed ' + seed + ', item ' + id + '): ' + where) });
        for (let step = 0; step < 400; step += 1) {
            if (s.pending) {
                s.pending();
                s.pending = null;
            }
            const [what, move] = pick(all);
            move();
            const { votesById, of } = sources(s);
            // (The session's clock jumps by days; the redraws come 700 ms apart: rows age out on their way.)
            keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db }, s.now + step * 700);
            for (const id of ITEMS) {
                const src = of(id);
                assert.deepEqual(keeper.buyers(id, src), buyersForItem(id, src), 'seed ' + seed + ', step ' + step + ' (' + what + '), item ' + id);
            }
        }
        assert.equal(keeper.stats.differed, 0);
        kept += keeper.stats.kept;
        redone += keeper.stats.redone;
    }
    assert.ok(kept > redone, 'kept ' + kept + ', worked out again ' + redone);
});

/* --------------------------------------------------- the buyers an item shows */

/** Your side of a session: who you trade with, who you shut out, what you choose to see, who is online. */
function shownState(s, r) {
    const int = (n) => Math.floor(r() * n);
    const pick = (list) => list[int(list.length)];
    const ids = () => Object.keys(s.db.traders);
    const st = {
        partners: [],
        favEdits: {},
        blacklist: [],
        prefs: { onlineOnly: false, trustedOnly: false, freshOnly: false },
        levels: new Map(),
        listAt: new Map(),
        votesMissing: false,
    };
    const moves = [
        ['a trade with someone', () => {
            const id = pick(ids());
            const was = st.partners.find((p) => p.who === id);
            if (was) Object.assign(was, { trades: was.trades + 1 + int(5), last: s.now });
            else st.partners.push({ who: id, whoName: r() < 0.7 ? s.db.traders[id].name : null, trades: 1 + int(8), last: s.now - int(40) * DAY });
        }],
        ['a favourite added or removed by hand', () => {
            st.favEdits = editFavourite(st.favEdits, pick(ids()), r() < 0.6);
        }],
        ['a trader blacklisted, by id or by name only', () => {
            const id = pick(ids());
            const name = s.db.traders[id].name;
            st.blacklist = [...st.blacklist, r() < 0.7 ? { key: 'id:' + id, id, name } : { key: 'name:' + name.toLowerCase(), name }];
        }],
        ['a trader taken off the blacklist', () => {
            st.blacklist = st.blacklist.slice(1);
        }],
        ['a Show choice pressed', () => {
            const k = pick(['onlineOnly', 'trustedOnly', 'freshOnly']);
            st.prefs = { ...st.prefs, [k]: !st.prefs[k] };
        }],
        ['a status answer', () => {
            st.levels.set(pick(ids()), pick(['online', 'idle', 'offline', 'unknown']));
        }],
        ['when a list last changed, learned', () => {
            st.listAt.set(pick(ids()), s.now - int(5) * DAY);
        }],
        ['TornExchange\'s votes come or go', () => {
            st.votesMissing = !st.votesMissing;
        }],
        ['three weeks pass (a favourite by trades lapses)', () => {
            s.now += 21 * DAY;
            s.index = indexW3bByItem(s.db, s.now);
            s.dbIds = traderIdsByName(s.db);
        }],
    ];
    return { st, moves };
}

/** The buyers an item shows, as 3.28.1 worked them out: for every item, every redraw (main.js, buyersOf). */
function shownAsBefore(all, st, now, trustById, trustedSeen) {
    const partnerOf = new Map();
    for (const p of st.partners) {
        partnerOf.set('id:' + p.who, p);
        if (p.whoName) partnerOf.set('name:' + String(p.whoName).toLowerCase(), p);
    }
    const favAdded = new Set((st.favEdits.added || []).map(String));
    const statOf = (b) => partnerOf.get(partnerKey(b)) || (b && b.name ? partnerOf.get('name:' + String(b.name).toLowerCase()) : null) || null;
    const favOf = (b) => {
        const stat = statOf(b);
        return stat ? isFavourite(stat, st.favEdits, now) : Boolean(b && b.id && favAdded.has(String(b.id)));
    };
    for (const x of all) {
        if (!x || !x.id || !x.trust) continue;
        trustById.set(String(x.id), x.trust);
        if (x.trust.level === 'Trusted' && !trustedSeen.has(String(x.id))) trustedSeen.set(String(x.id), x);
    }
    // (favouritesSorted: favouritesFirstOnTie as it was until 3.29.0.)
    let b = favouritesSorted(withoutBlacklisted(all, blacklistKeys(st.blacklist)), favOf);
    if (st.prefs.onlineOnly) b = onlineOnly(b, (id) => st.levels.get(String(id)) || 'unknown');
    if (st.prefs.trustedOnly) b = trustedOnly(b, { min: 'Known', keepUnrated: st.votesMissing });
    if (st.prefs.freshOnly) b = freshOnly(b, (id) => st.listAt.get(String(id)) || 0, now);
    return b;
}

/** One redraw the 3.29.0 way (main.js, buyersOf): the kept list, then the Show choices. */
function shownRedraw({ s, st, items, of, all, shown, versions, clock }) {
    const fav = shownFavourites(st.partners, st.favEdits, s.now);
    const blacklist = blacklistKeys(st.blacklist);
    const ver = versions(fav.word, blacklist);
    shown.begin(clock);
    const trustById = new Map();
    const trustedSeen = new Map();
    const opts = { prefs: st.prefs, levelOf: (id) => st.levels.get(String(id)) || 'unknown', votesMissing: st.votesMissing, listAtOf: (id) => st.listAt.get(String(id)) || 0, now: s.now, trustById, trustedSeen };
    const out = new Map();
    for (const id of items) {
        const rows = all(id, of(id));
        out.set(id, shownBuyers(shown.get(id, [rows, ver], () => shownKept(rows, blacklist, fav.isFav)), opts));
    }
    return { out, trustById, trustedSeen };
}

for (const buyersKept of [true, false]) {
    test('the buyers an item shows, kept: a long session, every item, every step, as 3.28.1 worked them out - ' + (buyersKept ? 'the buyers kept too' : 'the buyers worked out each redraw (their keeping off)'), () => {
        let kept = 0;
        let redone = 0;
        for (let seed = 1; seed <= 10; seed += 1) {
            const r = rng(seed * 17 + (buyersKept ? 0 : 5));
            const { s, moves, pick } = world(r);
            const mine = shownState(s, r);
            const every = [...moves, ...moreMoves(s, r), ...mine.moves, ...mine.moves];
            const fail = (which) => (id, where) => assert.fail(which + ': its own check found a difference (seed ' + seed + ', item ' + id + '): ' + where);
            const buyers = makeBuyersKeeper({ freeze: true, onDiffer: fail('the buyers') });
            // (Not `freeze`: it freezes through and through, down to the ratings the session changes in place.)
            const shown = makeKeeper({ onDiffer: fail('the shown buyers') });
            const versions = shownVersions();
            for (let step = 0; step < 300; step += 1) {
                if (s.pending) {
                    s.pending();
                    s.pending = null;
                }
                const [what, move] = pick(every);
                move();
                const { votesById, of } = sources(s);
                const clock = s.now + step * 700;
                buyers.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db }, clock);
                const got = shownRedraw({ s, st: mine.st, items: ITEMS, of, all: buyersKept ? (id, src) => buyers.buyers(id, src) : (id, src) => buyersForItem(id, src), shown, versions, clock });
                const trustById = new Map();
                const trustedSeen = new Map();
                const where = 'seed ' + seed + ', step ' + step + ' (' + what + ')';
                for (const id of ITEMS) assert.deepEqual(got.out.get(id), shownAsBefore(buyersForItem(id, of(id)), mine.st, s.now, trustById, trustedSeen), where + ', item ' + id);
                assert.deepEqual([...got.trustById], [...trustById], where + ': the badges');
                assert.deepEqual([...got.trustedSeen], [...trustedSeen], where + ': the Trusted traders seen, and which item named each first');
            }
            assert.equal(shown.stats.differed, 0);
            kept += shown.stats.kept;
            redone += shown.stats.redone;
        }
        // With the buyers kept, most of the shown lists are handed back; without, none can be (other rows each redraw).
        if (buyersKept) assert.ok(kept > redone, 'kept ' + kept + ', worked out again ' + redone);
        else assert.equal(kept, 0);
    });
}

test('the buyers an item shows, at the size of the owner\'s page: 2,900 price lists, 1,361 items, items with 250 buyers', () => {
    const r = rng(2026);
    const int = (n) => Math.floor(r() * n);
    const items = Array.from({ length: 1361 }, (_, i) => String(100 + i));
    const busy = items.slice(0, 5);
    const s = { now: NOW, db: { traders: {} }, index: null, dbIds: null };
    const priceList = (i) => {
        const prices = {};
        for (let k = 0; k < 20; k += 1) prices[items[5 + int(items.length - 5)]] = 100 + int(60) * 10;
        if (i < 250) for (const id of busy) prices[id] = 5000 + int(20) * 50;
        return prices;
    };
    for (let i = 0; i < 2900; i += 1) {
        s.db.traders[String(10000 + i)] = { name: 'Trader' + i, rating: i % 3 ? { up: int(300), down: int(20), at: NOW } : undefined, w3b: { found: true, prices: priceList(i), at: NOW, checkedAt: NOW } };
    }
    const reindex = () => {
        s.index = indexW3bByItem(s.db, s.now);
        s.dbIds = traderIdsByName(s.db);
    };
    reindex();
    const empty = new Map();
    const of = () => ({ teBest: [], teFull: null, idsByName: empty, db: s.db, w3bByItem: s.index, dbIdsByName: s.dbIds, votesById: empty, teOwn: null, w3bItem: null });
    const st = {
        partners: Array.from({ length: 40 }, (_, i) => ({ who: String(10000 + i * 7), whoName: 'Trader' + i * 7, trades: 3 + (i % 6), last: NOW - (i % 40) * DAY })),
        favEdits: { added: ['10003'], removed: ['10007'] },
        blacklist: [{ key: 'id:10001', id: '10001', name: 'Trader1' }, { key: 'name:trader2', name: 'Trader2' }],
        prefs: { onlineOnly: true, trustedOnly: false, freshOnly: true },
        levels: new Map(Array.from({ length: 300 }, (_, i) => [String(10000 + i * 3), i % 4 ? 'online' : 'offline'])),
        listAt: new Map(Array.from({ length: 2900 }, (_, i) => [String(10000 + i), NOW - (i % 5) * DAY])),
        votesMissing: true,
    };
    const buyers = makeBuyersKeeper({ onDiffer: (id, where) => assert.fail('the buyers differed, item ' + id + ': ' + where) });
    const shown = makeKeeper({ onDiffer: (id, where) => assert.fail('the shown buyers differed, item ' + id + ': ' + where) });
    const versions = shownVersions();
    let rows = 0;
    const steps = [
        ['the page opened', () => {}],
        ['nothing', () => {}],
        ['one trader\'s list read', () => {
            s.db.traders['10010'].w3b = { found: true, prices: priceList(10), at: s.now, checkedAt: s.now };
            reindex();
        }],
        ['a status answer and a trader blacklisted', () => {
            st.levels.set('10020', 'offline');
            st.blacklist = [...st.blacklist, { key: 'id:10030', id: '10030', name: 'Trader30' }];
        }],
    ];
    steps.forEach(([what, move], step) => {
        move();
        s.now += 1000;
        buyers.begin({ idsByName: empty, dbIdsByName: s.dbIds, votesById: empty, db: s.db }, s.now);
        const before = { kept: shown.stats.kept, redone: shown.stats.redone };
        const got = shownRedraw({ s, st, items, of, all: (id, src) => buyers.buyers(id, src), shown, versions, clock: s.now });
        const trustById = new Map();
        const trustedSeen = new Map();
        for (const id of items) {
            const fresh = buyersForItem(id, of(id));
            if (step === 0) rows += fresh.length;
            assert.deepEqual(got.out.get(id), shownAsBefore(fresh, st, s.now, trustById, trustedSeen), what + ', item ' + id);
        }
        assert.deepEqual([...got.trustedSeen.keys()], [...trustedSeen.keys()], what);
        // What a redraw works out: all of it once, then nearly nothing; a list read, only the items on the two lists.
        const redone = shown.stats.redone - before.redone;
        if (what === 'the page opened') assert.equal(redone, items.length);
        if (what === 'nothing') assert.equal(redone, 0);
        if (what === 'one trader\'s list read') assert.ok(redone > 0 && redone <= 60, String(redone));
        // (The blacklist is part of what is kept: it moved, so every item is put together again - from kept buyers.)
        if (what === 'a status answer and a trader blacklisted') assert.equal(redone, items.length);
    });
    assert.ok(rows > 55000 && rows < 70000, rows + ' buyer rows');
    for (const id of busy) assert.equal(buyersForItem(id, of(id)).length, 250);
});

test('favourites first on a tie: a list in price order is put in the order the sort gave, and any other list is sorted', () => {
    const r = rng(11);
    const int = (n) => Math.floor(r() * n);
    for (let round = 0; round < 400; round += 1) {
        const list = Array.from({ length: int(40) }, (_, i) => ({ id: String(i), price: r() < 0.05 ? undefined : 100 + int(6) * 10, fav: r() < 0.3 }));
        const inOrder = round % 4 ? list.slice().sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0)) : list;
        const isFav = (b) => b.fav;
        const got = favouritesFirstOnTie(inOrder, isFav);
        const want = favouritesSorted(inOrder, isFav);
        assert.equal(got.length, want.length);
        for (let i = 0; i < got.length; i += 1) assert.equal(got[i], want[i], 'round ' + round + ', place ' + i);
        assert.notEqual(got, inOrder, 'a list of its own: the one handed in is never changed');
    }
    assert.deepEqual(favouritesFirstOnTie(null, () => true), []);
    // Asked only where it matters: never for a buyer alone at their price.
    let asked = 0;
    favouritesFirstOnTie([{ price: 3 }, { price: 2 }, { price: 1 }], () => (asked += 1, true));
    assert.equal(asked, 0);
});

/* --------------------------------------------------------------- the prices */

const trusted = { level: 'Trusted', score: 500 };
const BUYERS = {
    258: [{ id: '7', name: 'Lumei', price: 13900, trust: trusted, w3b: 13900 }, { id: '8', name: 'Bob', price: 13500, trust: trusted, w3b: 13500 }],
    206: [{ id: '8', name: 'Bob', price: 850000, trust: trusted, w3b: 850000 }],
    269: [{ id: '9', name: 'Kay', price: 32600, trust: trusted, te: 32600, teName: 'kay' }],
    268: [],
};
const buyersOf = (id) => BUYERS[id] || [];
const LEFT = [
    { itemId: '258', name: 'Jaguar Plushie', qty: 89, each: 13000, from: 'office_kitty', at: NOW, why: 'cancel' },
    { itemId: '206', name: 'Xanax', qty: 4, each: 840000, from: null, at: NOW, why: 'extra' },
    { itemId: '269', name: 'Monkey Plushie', qty: 12, each: 31990, from: 'office_kitty', at: NOW, why: 'left' },
    { itemId: '268', name: 'Red Fox Plushie', qty: 13, each: 30300, from: 'office_kitty', at: NOW },
];
/** A check that passes only the prices named ('item|trader'); a TornExchange-only price says so. */
const checking = (...ok) => (itemId, b) => (ok.includes(itemId + '|' + b.id) ? { ok: true, why: 'checked', at: NOW } : { ok: false, why: b.w3b > 0 ? 'not-checked' : 'te-only', at: 0 });

test('To sell: a profit only on a price that is checked - the best checked payer is named, an unchecked one waits and is in no total', () => {
    // No check handed (the overlay's callers, the tests before 3.29.0): as it was.
    assert.deepEqual(toSellRows(LEFT, { buyersOf }).map((x) => [x.name, x.ready, x.unchecked, x.check]), [
        ['Jaguar Plushie', true, false, null],
        ['Xanax', true, false, null],
        ['Monkey Plushie', true, false, null],
        ['Red Fox Plushie', false, false, null],
    ]);

    // Every TornW3B price checked: the same rows - but TornExchange's price for the Monkey Plushies is no check.
    const all = toSellRows(LEFT, { buyersOf, checkOf: checking('258|7', '258|8', '206|8') });
    assert.deepEqual(all.map((x) => [x.name, x.best && x.best.name, x.ready, x.unchecked, x.check]), [
        ['Jaguar Plushie', 'Lumei', true, false, null],
        ['Xanax', 'Bob', true, false, null],
        ['Monkey Plushie', 'Kay', false, true, 'te-only'],
        ['Red Fox Plushie', null, false, false, null],
    ]);
    assert.deepEqual(all[2].best, { key: 'id:9', id: '9', name: 'Kay', price: 32600, trust: trusted, te: 32600, w3b: 0, teName: 'kay' }, 'with what the links to their lists need');

    // Lumei pays most for the plushies, but only Bob's price is checked: Bob is the one named, at his price.
    const bob = toSellRows(LEFT, { buyersOf, checkOf: checking('258|8', '206|8') });
    assert.deepEqual([bob[0].name, bob[0].best.name, bob[0].gain, bob[0].ready, bob[0].unchecked], ['Jaguar Plushie', 'Bob', 89 * 500, true, false]);
    assert.deepEqual([bob[1].name, bob[1].best.name, bob[1].gain, bob[1].ready, bob[1].unchecked], ['Xanax', 'Bob', 40000, true, false]);

    // Nothing checked: every payer still named, none ready - the best gain first, then what has nobody.
    const none = toSellRows(LEFT, { buyersOf, checkOf: checking() });
    assert.deepEqual(none.map((x) => [x.name, x.best && x.best.name, x.gain, x.ready, x.unchecked, x.check]), [
        ['Jaguar Plushie', 'Lumei', 89 * 900, false, true, 'not-checked'],
        ['Xanax', 'Bob', 40000, false, true, 'not-checked'],
        ['Monkey Plushie', 'Kay', 12 * 610, false, true, 'te-only'],
        ['Red Fox Plushie', null, null, false, false, null],
    ]);
    const board = toSellBoard(none);
    assert.deepEqual(board.groups, [], 'no trader\'s group, no total');
    assert.deepEqual(board.unchecked.map((x) => x.name), ['Jaguar Plushie', 'Xanax', 'Monkey Plushie']);
    assert.deepEqual(board.waiting.map((x) => x.name), ['Red Fox Plushie']);
    // A check that answers nothing counts as not checked.
    assert.equal(toSellRows(LEFT, { buyersOf, checkOf: () => null })[0].check, 'not-checked');

    // The mixed board: a checked profit in its trader's group, the unchecked ones under it.
    const mixed = toSellBoard(toSellRows(LEFT, { buyersOf, checkOf: checking('206|8') }));
    assert.deepEqual(mixed.groups.map((g) => [g.trader.name, g.rows.map((x) => x.name), g.gain]), [['Bob', ['Xanax'], 40000]]);
    assert.deepEqual(mixed.unchecked.map((x) => x.name), ['Jaguar Plushie', 'Monkey Plushie']);

    // An extra buy whose trader waits for the check is shown; it is not one of the "newest few without a price".
    const extras = [
        { itemId: '206', name: 'Xanax', qty: 4, each: 840000, at: NOW, why: 'extra' },
        { itemId: '268', name: 'Red Fox Plushie', qty: 1, each: 30300, at: NOW - 5, why: 'extra' },
    ];
    assert.deepEqual(toSellRows(extras, { buyersOf, checkOf: checking(), extraWaiting: 0 }).map((x) => x.name), ['Xanax']);

    // What a full trade left for a second one with that trader: it waits for THEIR price, checked - never offered to another meanwhile.
    const over = [{ itemId: '258', name: 'Jaguar Plushie', qty: 30, each: 13000, at: NOW, why: 'over', for: 'Lumei' }];
    const waits = toSellRows(over, { buyersOf, checkOf: checking('258|8') })[0];
    assert.deepEqual([waits.best.name, waits.ready, waits.unchecked], ['Lumei', false, true]);
    const goes = toSellRows(over, { buyersOf, checkOf: checking('258|7', '258|8') })[0];
    assert.deepEqual([goes.best.name, goes.ready, goes.unchecked], ['Lumei', true, false]);
});

test('To sell in a trade: a line whose price is not checked is marked, so the trade lists it as waiting and counts nothing of it', () => {
    const lines = toSellHeld(LEFT, { buyersOf, checkOf: checking('258|7', '206|8') });
    assert.deepEqual(lines.get('id:7'), [{ itemId: '258', bid: 13900, held: 89, each: 13000, all: true }]);
    assert.deepEqual(lines.get('id:8'), [
        { itemId: '258', bid: 13500, held: 89, each: 13000, all: true, unchecked: true, check: 'not-checked' },
        { itemId: '206', bid: 850000, held: 4, each: 840000, all: true },
    ]);
    assert.deepEqual(lines.get('id:9'), [{ itemId: '269', bid: 32600, held: 12, each: 31990, all: true, unchecked: true, check: 'te-only' }]);
    // No check handed: no line is marked (as before 3.29.0).
    for (const list of toSellHeld(LEFT, { buyersOf }).values()) for (const l of list) assert.equal('unchecked' in l, false);
});

test('the table of checked prices, for the pages on torn.com: only checks still standing, and a price is sure only at that price, within five minutes', () => {
    const at = (ms) => Math.floor(ms / 1000);
    const last = new Map([
        ['206|11', { price: 850000, at: NOW - 60_000 }],
        ['206|12', { price: 845000, at: NOW - FLIP_CHECK_MS - 1 }],
        ['258|7', { price: 13900, at: NOW - 1000 }],
        ['258|8', { price: 13500, at: NOW - 2000 }],
        // A trader known by name only has no TornW3B price; rubbish is left out.
        ['258|lumei', { price: 13900, at: NOW }],
        ['x|5', { price: 5, at: NOW }],
        ['300|5', { price: 0, at: NOW }],
        ['301|5', null],
    ]);
    const table = checkedTable(last, NOW);
    assert.deepEqual(table, { at: NOW, p: { 206: [['11', 850000, at(NOW - 60_000)]], 258: [['7', 13900, at(NOW - 1000)], ['8', 13500, at(NOW - 2000)]] } });
    // As the overlay reads it: out of storage.
    const read = JSON.parse(JSON.stringify(table));
    assert.equal(checkedInTable(read, '206', '11', 850000, NOW), true);
    assert.equal(checkedInTable(read, 206, 11, 850000, NOW), true);
    assert.equal(checkedInTable(read, '206', '11', 851000, NOW), false, 'their list says another price now');
    assert.equal(checkedInTable(read, '206', '12', 845000, NOW), false, 'a check that had lapsed was not written');
    assert.equal(checkedInTable(read, '206', '7', 850000, NOW), false);
    assert.equal(checkedInTable(read, '999', '11', 850000, NOW), false);
    assert.equal(checkedInTable(read, '206', null, 850000, NOW), false, 'a buyer known by name only');
    // Torn Bids closed: the table is no longer written, and every price in it lapses within five minutes.
    assert.equal(checkedInTable(read, '206', '11', 850000, NOW + FLIP_CHECK_MS - 61_000), true);
    assert.equal(checkedInTable(read, '206', '11', 850000, NOW + FLIP_CHECK_MS), false);
    assert.equal(checkedInTable(read, '258', '7', 13900, NOW + FLIP_CHECK_MS + 1000), false);
    for (const junk of [null, undefined, {}, { p: null }, { p: { 206: 'x' } }, { p: { 206: [null, 'x', []] } }]) assert.equal(checkedInTable(junk, '206', '11', 850000, NOW), false);
    assert.deepEqual(checkedTable(null, NOW), { at: NOW, p: {} });
    // Never more than it may hold: the newest checks.
    const many = new Map(Array.from({ length: CHECKED_TABLE_MAX + 500 }, (_, i) => [(1000 + i) + '|7', { price: 10, at: NOW - i * 100 }]));
    const kept = checkedTable(many, NOW);
    assert.equal(Object.keys(kept.p).length, CHECKED_TABLE_MAX);
    assert.ok(kept.p['1000'] && !kept.p[String(1000 + CHECKED_TABLE_MAX)]);
});

test('a TornW3B list\'s bulk prices are kept with the list, and go when a later list has none', () => {
    const body = [
        { itemId: 206, name: 'Xanax', buyPrice: 850000, bulkThreshold: 100, bulkBuyPrice: 840000 },
        { itemId: 258, name: 'Jaguar Plushie', buyPrice: 13900, bulkThreshold: 0, bulkBuyPrice: 0 },
        // The same price in bulk, a count of 1, no price, a set of TornW3B's own: not a bulk price.
        { itemId: 269, buyPrice: 32000, bulkThreshold: 50, bulkBuyPrice: 32000 },
        { itemId: 270, buyPrice: 500, bulkThreshold: 1, bulkBuyPrice: 400 },
        { itemId: 271, buyPrice: 0, bulkThreshold: 50, bulkBuyPrice: 400 },
        { itemId: -3, buyPrice: 500, bulkThreshold: 50, bulkBuyPrice: 400 },
        { itemId: 272, buyPrice: 700, bulkThreshold: 25.9, bulkBuyPrice: 750 },
        null,
    ];
    assert.deepEqual(parseW3bBulk(body), { 206: [100, 840000], 272: [25, 750] });
    assert.deepEqual(parseW3bBulk(null), {});
    const db = { traders: {} };
    recordW3bList(db, '11', { prices: { 206: 850000, 258: 13900 }, bulk: parseW3bBulk(body) }, NOW);
    assert.deepEqual(bulkPriceOf(db, '11', '206'), { from: 100, price: 840000 });
    assert.deepEqual(bulkPriceOf(db, 11, 206), { from: 100, price: 840000 });
    assert.equal(bulkPriceOf(db, '11', '258'), null);
    assert.equal(bulkPriceOf(db, '12', '206'), null);
    assert.equal(bulkPriceOf(null, '11', '206'), null);
    // The next read of their list has no bulk prices: none is carried over from the one before.
    recordW3bList(db, '11', { prices: { 206: 850000 }, bulk: {} }, NOW + 1000);
    assert.equal(bulkPriceOf(db, '11', '206'), null);
    assert.equal('bulk' in db.traders['11'].w3b, false);
});

test('the overlay\'s trader tag and Checkout\'s "sell to": a price nobody checked says so, and shows no profit', () => {
    const faffo = { name: 'FAFFO', price: 73500, trust: { level: 'Trusted' } };
    assert.equal(traderTagLabel(faffo, 70000, true), 'FAFFO pays $73,500 · +$3,500 each');
    assert.equal(traderTagLabel(faffo, 70000, false), 'FAFFO pays $73,500 · not checked');
    assert.equal(traderTagLabel(faffo, 73500, false), null, 'still only a buyer who pays more than the listing');

    const trade = { key: 'id:11', trader: { id: '11', name: 'Bob' }, itemId: '206', at: NOW - 3600000, items: [{ line: 'flip:206', itemId: '206', name: 'Xanax', units: 2, bid: 850000, kind: 'flip', sent: false, steps: [{ sellerId: '888', sellerName: 'XanSeller', qty: 2, price: 840000, bought: true, boughtQty: 2, boughtAt: NOW - 1800000 }] }] };
    const alice = { id: '12', name: 'Alice', price: 845000 };
    const asked = [];
    const unsure = sellElsewhere(trade, () => [alice], (itemId, b) => (asked.push([itemId, b.name]), false));
    assert.deepEqual(unsure[0].best, { name: 'Alice', price: 845000, unchecked: true });
    assert.deepEqual(asked, [['206', 'Alice']]);
    assert.deepEqual(sellElsewhere(trade, () => [alice], () => true)[0].best, { name: 'Alice', price: 845000 });
    assert.deepEqual(sellElsewhere(trade, () => [alice])[0].best, { name: 'Alice', price: 845000 });
    assert.equal(sellElsewhere(trade, () => [], () => false)[0].best, null);
});
