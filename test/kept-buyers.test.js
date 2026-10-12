/*
 * 3.18.0: each item's buyers kept between redraws (core/kept-buyers.js;
 * PLAN-speed.md Part 3 B, step 11). The proof the plan asks for: a long
 * session replayed - lists read, traders learned and dropped, names, ratings
 * and votes moving, lists ageing out, things changed in place - and at every
 * step the kept rows of every item compared with a fresh buyersForItem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBuyersKeeper } from '../src/core/kept-buyers.js';
import { buyersForItem, indexW3bByItem, traderIdsByName } from '../src/core/traders.js';
import { rng, ITEMS, world, sources } from './kept-world.js';

test('kept buyers: a long session replayed - every item, every step, the same as worked out fresh', () => {
    let keptInAll = 0;
    let redoneInAll = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
        const r = rng(seed);
        const { s, moves, pick } = world(r);
        const keeper = makeBuyersKeeper({ freeze: true, onDiffer: (id) => assert.fail('the keeper\'s own check found a difference (seed ' + seed + ', item ' + id + ')') });
        for (let step = 0; step < 400; step += 1) {
            if (s.pending) {
                s.pending();
                s.pending = null;
            }
            const [what, move] = pick(moves);
            move();
            // One redraw.
            const { votesById, of } = sources(s);
            keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db });
            for (const id of ITEMS) {
                const src = of(id);
                const got = keeper.buyers(id, src);
                const fresh = buyersForItem(id, src);
                assert.deepEqual(got, fresh, 'seed ' + seed + ', step ' + step + ' (' + what + '), item ' + id);
            }
        }
        assert.equal(keeper.stats.differed, 0);
        assert.ok(keeper.on());
        keptInAll += keeper.stats.kept;
        redoneInAll += keeper.stats.redone;
    }
    // And it is worth it: most of what was asked was handed back, not worked out.
    assert.ok(keptInAll > redoneInAll, 'kept ' + keptInAll + ', worked out again ' + redoneInAll);
});

test('kept buyers: nothing changed, nothing worked out - the very same rows; one item\'s list changed, that item only', () => {
    const { s } = world(rng(7));
    let computed = [];
    const keeper = makeBuyersKeeper({ compute: (id, src) => (computed.push(id), buyersForItem(id, src)) });
    const redraw = () => {
        const { votesById, of } = sources(s);
        keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db });
        return new Map(ITEMS.map((id) => [id, keeper.buyers(id, of(id))]));
    };
    const first = redraw();
    assert.equal(computed.length, ITEMS.length, 'the first redraw works every item out');
    computed = [];
    const second = redraw();
    // (One kept item a redraw is worked out again and compared - the keeper's own check.)
    assert.ok(computed.length <= 1, 'the second works out none (but its one check): ' + computed.length);
    for (const id of ITEMS) assert.equal(second.get(id), first.get(id), 'item ' + id + ': the same rows, not a copy');
    // The index made again (as each minute): still nothing to work out.
    s.index = indexW3bByItem(s.db, s.now);
    s.dbIds = traderIdsByName(s.db);
    computed = [];
    redraw();
    assert.ok(computed.length <= 1, 'a new index that says the same changes nothing: ' + computed.length);
    // One trader's price for one item moves: that item, and no other.
    const [traderId, t] = Object.entries(s.db.traders).find(([, x]) => x.w3b && Object.keys(x.w3b.prices).length);
    const itemId = Object.keys(t.w3b.prices)[0];
    t.w3b = { ...t.w3b, prices: { ...t.w3b.prices, [itemId]: t.w3b.prices[itemId] + 5 } };
    s.index = indexW3bByItem(s.db, s.now);
    computed = [];
    const after = redraw();
    assert.deepEqual(computed.filter((id) => id !== itemId).length <= 1, true);
    assert.ok(computed.includes(itemId), 'the item whose list moved is worked out again');
    assert.ok(after.get(itemId).some((b) => b.id === traderId && b.w3b === t.w3b.prices[itemId]));
});

test('kept buyers: should a kept item ever differ from a fresh one, keeping stops and it is told', () => {
    const { s } = world(rng(3));
    // A compute that answers differently the second time it is asked of the same item (as a missed input would).
    const asked = new Map();
    const told = [];
    const keeper = makeBuyersKeeper({
        compute: (id, src) => {
            asked.set(id, (asked.get(id) || 0) + 1);
            const out = buyersForItem(id, src);
            return asked.get(id) > 1 ? [...out, { id: 'x', name: 'late', price: 1 }] : out;
        },
        onDiffer: (id) => told.push(id),
    });
    for (let i = 0; i < 3; i += 1) {
        const { votesById, of } = sources(s);
        keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db });
        for (const id of ITEMS) keeper.buyers(id, of(id));
    }
    assert.equal(told.length, 1, 'told once');
    assert.equal(keeper.on(), false, 'and keeping is off from then on');
});

test('kept buyers: a redraw worked out in pieces - a rating that moves between two pieces does not trip the check, and the next redraw has it', () => {
    // 3.19.0 (core/start-up.js): the page is free between two pieces, so an answer can land after begin() and before an item is asked for.
    for (let seed = 1; seed <= 20; seed += 1) {
        const { s } = world(rng(seed));
        const keeper = makeBuyersKeeper({ onDiffer: (id) => assert.fail('the check tripped on a change made between two pieces (seed ' + seed + ', item ' + id + ')') });
        const begin = () => {
            const { votesById, of } = sources(s);
            keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db });
            return of;
        };
        // Two whole redraws: every item kept, and the check has an item to look at.
        for (let i = 0; i < 2; i += 1) {
            const of = begin();
            for (const id of ITEMS) keeper.buyers(id, of(id));
        }
        // Redraw after redraw in two pieces, every rated trader's rating moving in between: whichever item the check is on.
        for (let i = 0; i < ITEMS.length + 2; i += 1) {
            const of = begin();
            for (const id of ITEMS.slice(0, 2)) keeper.buyers(id, of(id));
            keeper.unsettled();
            for (const t of Object.values(s.db.traders)) if (t.rating) t.rating.up += 1;
            for (const id of ITEMS.slice(2)) keeper.buyers(id, of(id));
            // The next redraw, in one go: what moved is in it.
            const next = begin();
            for (const id of ITEMS) assert.deepEqual(keeper.buyers(id, next(id)), buyersForItem(id, next(id)), 'seed ' + seed + ', round ' + i + ', item ' + id);
        }
        assert.ok(keeper.on());
    }
});

test('kept buyers: a rating that moves between two pieces and back before the next redraw leaves no wrong rows behind', () => {
    // The independent review's case: worked out mid-redraw with the moved rating, then the rating went back - begin() saw no change.
    for (let seed = 1; seed <= 20; seed += 1) {
        const { s } = world(rng(seed));
        const keeper = makeBuyersKeeper({ onDiffer: (id) => assert.fail('the check tripped (seed ' + seed + ', item ' + id + ')') });
        const begin = () => {
            const { votesById, of } = sources(s);
            keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db });
            return of;
        };
        const flip = () => {
            for (const t of Object.values(s.db.traders)) {
                if (t.rating) t.rating.down += 7;
                t.name = t.name + ' ';
            }
        };
        const back = () => {
            for (const t of Object.values(s.db.traders)) {
                if (t.rating) t.rating.down -= 7;
                t.name = t.name.slice(0, -1);
            }
        };
        // One redraw in two pieces: the second half worked out while the ratings and names had moved.
        let of = begin();
        for (const id of ITEMS.slice(0, 12)) keeper.buyers(id, of(id));
        keeper.unsettled();
        flip();
        for (const id of ITEMS.slice(12)) keeper.buyers(id, of(id));
        back();
        // The next redraws: every item as a fresh working-out says.
        for (let i = 0; i < 3; i += 1) {
            of = begin();
            for (const id of ITEMS) assert.deepEqual(keeper.buyers(id, of(id)), buyersForItem(id, of(id)), 'seed ' + seed + ', redraw ' + i + ', item ' + id);
        }
        assert.ok(keeper.on());
    }
});

test('kept buyers: the long session replayed in pieces - anything can happen between two pieces, and the next redraw is right', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
        const r = rng(1000 + seed);
        const { s, moves, pick, int } = world(r);
        const keeper = makeBuyersKeeper({ freeze: true, onDiffer: (id) => assert.fail('the keeper\'s own check found a difference (seed ' + seed + ', item ' + id + ')') });
        for (let step = 0; step < 300; step += 1) {
            if (s.pending) {
                s.pending();
                s.pending = null;
            }
            // One redraw as main.js makes it: what it reads is taken once (the objects, not copies), then pieces.
            const snap = { ...s };
            const { votesById, of } = sources(snap);
            keeper.begin({ idsByName: snap.idsByName, dbIdsByName: snap.dbIds, votesById, db: snap.db });
            const cut = int(ITEMS.length + 1);
            for (const id of ITEMS.slice(0, cut)) keeper.buyers(id, of(id));
            keeper.unsettled();
            const [what, move] = pick(moves);
            move();
            for (const id of ITEMS.slice(cut)) keeper.buyers(id, of(id));
            // The next redraw, in one go: every item as a fresh working-out says.
            const next = { ...s };
            const fresh = sources(next);
            keeper.begin({ idsByName: next.idsByName, dbIdsByName: next.dbIds, votesById: fresh.votesById, db: next.db });
            for (const id of ITEMS) assert.deepEqual(keeper.buyers(id, fresh.of(id)), buyersForItem(id, fresh.of(id)), 'seed ' + seed + ', step ' + step + ' (' + what + ' between two pieces), item ' + id);
        }
        assert.ok(keeper.on());
    }
});

test('kept buyers: after the page was free, the check still runs on the next item', () => {
    const { s } = world(rng(5));
    const keeper = makeBuyersKeeper();
    const begin = () => {
        const { votesById, of } = sources(s);
        keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIds, votesById, db: s.db });
        return of;
    };
    for (let i = 0; i < 2; i += 1) {
        const of = begin();
        for (const id of ITEMS) keeper.buyers(id, of(id));
    }
    const checked = keeper.stats.checked;
    // A redraw whose first piece did one item: the check (on a later item) is not skipped.
    const of = begin();
    keeper.buyers(ITEMS[0], of(ITEMS[0]));
    keeper.unsettled();
    for (const id of ITEMS.slice(1)) keeper.buyers(id, of(id));
    assert.equal(keeper.stats.checked, checked + 1);
});

test('kept buyers: a list entry whose row is dropped still ties its trader to the item (the name can join it to a TornExchange row)', () => {
    // TornExchange knows "Bob" by name only; trader 77 lists the item at 0 (no row of their own) and is called Robert.
    const db = { traders: { 77: { name: 'Robert', w3b: { found: true, prices: { 206: 0 }, at: 1000 } } } };
    const src = () => ({ teBest: [{ name: 'Bob', price: 500 }], db, w3bByItem: indexW3bByItem(db, 1000), idsByName: new Map(), dbIdsByName: new Map(), votesById: new Map() });
    // (Its own check would put it right - and say so: here it must not need to.)
    const keeper = makeBuyersKeeper({ onDiffer: () => assert.fail('the kept rows were stale') });
    const redraw = () => {
        const s = src();
        keeper.begin({ idsByName: s.idsByName, dbIdsByName: s.dbIdsByName, votesById: s.votesById, db });
        return [keeper.buyers('206', s), buyersForItem('206', s)];
    };
    let [got, fresh] = redraw();
    assert.deepEqual(got, fresh);
    assert.equal(got[0].id, null, 'Bob has no id yet');
    // Trader 77 turns out to be Bob: the TornExchange row is theirs now.
    db.traders[77].name = 'Bob';
    [got, fresh] = redraw();
    assert.deepEqual(got, fresh);
    assert.equal(got[0].id, '77');
});
