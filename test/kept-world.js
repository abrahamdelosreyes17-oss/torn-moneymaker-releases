/*
 * A made-up Torn Bids session, for the tests that replay one (test/kept-buyers.test.js since 3.18.0,
 * test/build-3-29.test.js): the state as main.js holds it (sell.*), everything that can happen to it
 * between two redraws, and what a redraw hands buyersForItem for one item.
 */
import { indexW3bByItem, traderIdsByName, votesByTrader } from '../src/core/traders.js';

// A small generator with a seed, so a failure can be run again.
export function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

export const ITEMS = Array.from({ length: 24 }, (_, i) => String(200 + i));
export const TTL = 60 * 60 * 1000;

/** A session's state, shaped as Torn Bids holds it (main.js: sell.*). */
export function world(r) {
    const pick = (list) => list[Math.floor(r() * list.length)];
    const int = (n) => Math.floor(r() * n);
    const s = {
        now: 1_000_000_000,
        db: { traders: {} },
        teMap: new Map(),
        teOne: new Map(),
        lists: new Map(),
        idsByName: new Map(),
        votes: new Map(),
        itemTraders: new Map(),
        own: new Map(),
        index: null,
        dbIds: null,
        nextId: 5000,
    };
    const names = () => 'T' + int(60) + (r() < 0.1 ? ' x' : '');
    // (Now and then a list says 0 for an item: that row is dropped, but its trader's name is still read.)
    const prices = () => Object.fromEntries(ITEMS.filter(() => r() < 0.3).map((id) => [id, r() < 0.15 ? 0 : 50 + int(40) * 10]));
    const addTrader = (rated) => {
        const id = String(s.nextId++);
        s.db.traders[id] = { name: r() < 0.1 ? 'Trader ' + id : names(), rating: rated ? { up: int(200), down: int(30) } : undefined, w3b: r() < 0.8 ? { found: true, prices: prices(), at: s.now, checkedAt: s.now } : undefined };
        return id;
    };
    for (let i = 0; i < 40; i += 1) addTrader(r() < 0.6);
    const reindex = () => {
        s.index = indexW3bByItem(s.db, s.now);
        s.dbIds = traderIdsByName(s.db);
    };
    reindex();
    const top = () => Array.from({ length: 1 + int(3) }, () => ({ name: names(), id: r() < 0.5 ? pick(Object.keys(s.db.traders)) : undefined, price: r() < 0.1 ? 0 : 60 + int(40) * 10, score: r() < 0.8 ? int(150) - 10 : undefined }));
    const ids = () => Object.keys(s.db.traders);
    // An item that already has one (so a change in place has something to change), else any item.
    const having = (map) => (map.size ? pick([...map.keys()]) : pick(ITEMS));
    // Everything that can happen between two redraws. Each returns what it did.
    const moves = [
        ['nothing', () => {}],
        ['a list read: its prices, the index made again', () => {
            const t = s.db.traders[pick(ids())];
            t.w3b = { found: true, prices: prices(), at: s.now, checkedAt: s.now };
            reindex();
        }],
        ['a list read, the index NOT made again (it is, within the minute)', () => {
            s.db.traders[pick(ids())].w3b = { found: true, prices: prices(), at: s.now, checkedAt: s.now };
        }],
        ['the index made again, nothing else', reindex],
        ['a rating moved in place', () => {
            const t = s.db.traders[pick(ids())];
            if (t.rating) t.rating.up += 1 + int(120);
            else t.rating = { up: int(200), down: 0 };
        }],
        ['a rating replaced by one that says the same', () => {
            const t = s.db.traders[pick(ids())];
            if (t.rating) t.rating = { ...t.rating };
        }],
        ['a rating gone', () => {
            delete s.db.traders[pick(ids())].rating;
        }],
        ['a trader renamed', () => {
            s.db.traders[pick(ids())].name = names();
        }],
        ['a trader learned, rated, the index made again', () => {
            addTrader(true);
            reindex();
        }],
        ['a trader learned, not rated, the index left', () => {
            addTrader(false);
        }],
        ['a trader dropped, the index left (it still names them)', () => {
            delete s.db.traders[pick(ids())];
        }],
        ['a trader dropped and learned again, the index left', () => {
            const id = pick(ids());
            const was = s.db.traders[id];
            delete s.db.traders[id];
            s.pending = () => {
                s.db.traders[id] = { ...was, name: names() };
            };
        }],
        ['the database read again from storage (a new object, the same traders)', () => {
            s.db = JSON.parse(JSON.stringify(s.db));
            reindex();
        }],
        ['TornExchange\'s top three of an item', () => {
            s.teMap.set(pick(ITEMS), top());
        }],
        ['a top-three score, or whose it is, changed in place', () => {
            const list = s.teMap.get(having(s.teMap));
            if (!list || !list[0]) return;
            if (r() < 0.5) list[0].score = (list[0].score || 0) + 40;
            else list[0].id = list[0].id ? undefined : pick(ids());
        }],
        ['a top-three price changed in place', () => {
            const list = s.teMap.get(having(s.teMap));
            if (list && list[0]) list[0].price += 10;
        }],
        ['TornExchange\'s top three gone (the key failed)', () => {
            s.teMap = new Map();
        }],
        ['the keyless best buyer of an item', () => {
            s.teOne.set(pick(ITEMS), { at: s.now, best: r() < 0.8 ? top()[0] : null });
        }],
        ['an item\'s full list', () => {
            s.lists.set(pick(ITEMS), { at: s.now, traders: Array.from({ length: int(12) }, () => ({ name: names(), price: 40 + int(50) * 10 })) });
        }],
        ['a full list added to in place', () => {
            const l = s.lists.get(having(s.lists));
            if (l) l.traders.push({ name: names(), price: 40 + int(50) * 10 });
        }],
        ['the active traders: a name learned', () => {
            s.idsByName.set(names().toLowerCase(), pick(ids()));
        }],
        ['the active traders read again', () => {
            s.idsByName = new Map(Array.from({ length: int(30) }, () => [names().toLowerCase(), pick(ids())]));
        }],
        ['a remembered vote', () => {
            s.votes.set(pick(ids()), int(150) - 10);
        }],
        ['your traders\' own lists for an item', () => {
            s.own.set(pick(ITEMS), Array.from({ length: int(4) }, () => ({ id: r() < 0.8 ? pick(ids()) : null, name: r() < 0.7 ? names() : null, price: 50 + int(40) * 10, lastPaid: r() < 0.3 })));
        }],
        ['every TornW3B buyer of an item', () => {
            s.itemTraders.set(pick(ITEMS), { at: s.now, traders: Array.from({ length: int(10) }, () => ({ id: pick(ids()), name: r() < 0.7 ? names() : null, price: 50 + int(40) * 10, up: r() < 0.6 ? int(50) : undefined, down: r() < 0.6 ? int(5) : undefined })) });
        }],
        ['a TornW3B buyer of an item: the price, or the rating, changed in place', () => {
            const it = s.itemTraders.get(having(s.itemTraders));
            const t = it && it.traders.length ? pick(it.traders) : null;
            if (!t) return;
            if (r() < 0.5) t.price += 10;
            else t.up = (t.up || 0) + 30;
            if (t.down === undefined) t.down = 0;
        }],
        ['every TornW3B buyer of an item read again: the same traders, other prices', () => {
            const id = having(s.itemTraders);
            const it = s.itemTraders.get(id);
            if (it) s.itemTraders.set(id, { at: s.now, traders: it.traders.map((t) => ({ ...t, price: t.price + 10 * int(3) })) });
        }],
        ['twenty minutes pass', () => {
            s.now += 20 * 60 * 1000;
        }],
        ['a day passes, the index made again (lists age out)', () => {
            s.now += 25 * 60 * 60 * 1000;
            reindex();
        }],
    ];
    return { s, moves, pick, int };
}

/** What Torn Bids hands buyersForItem for one item (main.js: buyerLookup), from the state. */
export function sources(s) {
    const votesById = votesByTrader([...s.teMap.values(), ...[...s.teOne.values()].filter((rec) => rec.best).map((rec) => [rec.best])]);
    for (const [id, score] of s.votes) if (!votesById.has(id)) votesById.set(id, score);
    const of = (id) => {
        const full = s.lists.get(id);
        const one = s.teOne.get(id);
        const it = s.itemTraders.get(id);
        return {
            teBest: s.teMap.get(id) || (one && one.best ? [one.best] : []),
            teFull: full ? full.traders : null,
            idsByName: s.idsByName,
            db: s.db,
            w3bByItem: s.index,
            dbIdsByName: s.dbIds,
            votesById,
            teOwn: s.own.get(id) || null,
            w3bItem: it && it.at && s.now - it.at < TTL ? it.traders : null,
        };
    };
    return { votesById, of };
}
