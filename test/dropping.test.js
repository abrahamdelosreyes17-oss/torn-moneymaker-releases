import test from 'node:test';
import assert from 'node:assert/strict';
import { bazaarDrop, tradersCut, droppingNow } from '../src/core/dropping.js';

// [minutes ago, price, ...] oldest first, every ten minutes over `hours`.
const series = (hours, priceAt) => {
    const flat = [];
    for (let ago = hours * 60; ago >= 0; ago -= 10) flat.push(ago, priceAt(ago));
    return flat;
};

test('a falling series flags; a flat one does not', () => {
    const falling = series(6, (ago) => Math.round(1000 * (0.7 + 0.3 * (ago / 360))));
    const got = bazaarDrop(falling, { pct: 15, hours: 6 });
    assert.ok(got && got.fell > 0.15, JSON.stringify(got));
    assert.equal(bazaarDrop(series(6, () => 1000)), null);
    // Within the setting: 10% is not over 15%.
    assert.equal(bazaarDrop(series(6, (ago) => (ago > 180 ? 1000 : 900)), { pct: 15 }), null);
    assert.ok(bazaarDrop(series(6, (ago) => (ago > 180 ? 1000 : 900)), { pct: 5 }));
});

test('one cheap listing now is a flip, not a drop', () => {
    assert.equal(bazaarDrop(series(6, (ago) => (ago === 0 ? 500 : 1000))), null);
    assert.equal(bazaarDrop(series(6, (ago) => (ago === 10 ? 500 : 1000))), null);
});

test('a table that arrived a while ago: its samples count as older', () => {
    // Fell 3 h to 4 h ago, flat since: within a 6 h window when fresh, out of a 2 h window once 90 minutes late.
    const flat = series(6, (ago) => (ago > 210 ? 1000 : 700));
    assert.equal(bazaarDrop(flat, { pct: 15, hours: 6 }) !== null, true);
    assert.equal(bazaarDrop(series(2, (ago) => (ago > 30 ? 1000 : 700)), { pct: 15, hours: 2 }) !== null, true);
    assert.equal(bazaarDrop(series(2, (ago) => (ago > 30 ? 1000 : 700)), { pct: 15, hours: 2, late: 20 }) !== null, true);
    // Over half an hour late: no verdict at all.
    assert.equal(bazaarDrop(series(6, (ago) => (ago > 210 ? 1000 : 700)), { pct: 15, hours: 6, late: 31 }), null);
});

test('the fall shown is the one judged', () => {
    const got = bazaarDrop(series(6, (ago) => (ago > 180 ? 1000 : ago === 0 ? 600 : 800)), { pct: 15 });
    assert.equal(got.to, 800);
    assert.equal(Math.round(got.fell * 100), 20);
});

test('too few samples, or no settings: nothing said', () => {
    assert.equal(bazaarDrop([0, 500, 10, 1000]), null);
    assert.equal(bazaarDrop(series(6, (ago) => (ago > 180 ? 1000 : 100)), { pct: '' }), null);
});

test('traders lowering their price within the window', () => {
    const nowMs = 10 * 3600000;
    const cuts = [{ now: 90, was: 100, at: nowMs - 3600000 }, { now: 95, was: 100, at: nowMs - 2 * 3600000 }, { now: 100, was: 90, at: nowMs }, { now: 80, was: 100, at: 0 }];
    assert.equal(tradersCut(cuts, { hours: 6, nowMs }), 2);
    assert.deepEqual(droppingNow({ flat: [], cuts, nowMs }), { why: 'traders', cut: 2 });
    assert.equal(droppingNow({ flat: [], cuts: cuts.slice(0, 1), nowMs }), null);
});

test('a trader\'s price change is remembered with the one before', async () => {
    const { notePrices, cutsOf, cutsKept } = await import('../src/core/dropping.js');
    const kept = {};
    assert.equal(notePrices(kept, 206, [{ id: 5, price: 100 }], 1), true);
    assert.equal(notePrices(kept, 206, [{ id: 5, price: 100 }], 2), false);
    notePrices(kept, 206, [{ id: 5, price: 90 }], 3);
    assert.deepEqual(cutsOf(kept, 206, [{ id: 5 }, { id: 6 }]), [{ now: 90, was: 100, at: 3 }]);
    // Old: the price before is forgotten, the price stays (no "new" price at every redraw).
    assert.deepEqual(cutsKept(kept, 3 + 3 * 24 * 3600000), { '206|id:5': [90, 0, 3] });
});

test('a change is dated when the trader\'s list changed, not when this PC saw it', async () => {
    const { notePrices, cutsOf } = await import('../src/core/dropping.js');
    const H = 3600000;
    const nowMs = 100 * H;
    const kept = {};
    notePrices(kept, 206, [{ id: 5, price: 100, at: nowMs - 50 * H }], nowMs - 40 * H);
    // Seen now, made 20 h ago: outside a 6 h window.
    notePrices(kept, 206, [{ id: 5, price: 90, at: nowMs - 20 * H }], nowMs);
    assert.equal(tradersCut(cutsOf(kept, 206, [{ id: 5 }]), { hours: 6, nowMs }), 0);
    notePrices(kept, 206, [{ id: 5, price: 80, at: nowMs - H }], nowMs);
    assert.equal(tradersCut(cutsOf(kept, 206, [{ id: 5 }]), { hours: 6, nowMs }), 1);
});

test('the join: the server\'s table, through the sync answer, judged on the PC by item id as a string', async () => {
    const { serverFile } = await import('./server-path.js');
    const { newDrops, dropsSample, dropsTable, DROPS_EVERY_MS } = await import(serverFile('src/drops.js'));
    const { sharedDropsIn } = await import('../src/core/shared.js');
    const d = newDrops();
    const watched = new Map([[206, 900000]]);
    let now = 0;
    // Six hours at 1000, then two hours at 700.
    for (let i = 0; i <= 8 * 6; i++) {
        now = i * DROPS_EVERY_MS;
        dropsSample(d, [{ readAt: now, items: [{ id: 206, price: i < 36 ? 1000 : 700, qty: 1 }] }], watched, now);
    }
    const answer = JSON.parse(JSON.stringify({ drops: { at: now, rows: dropsTable(d, watched, now) } }));
    const got = sharedDropsIn(answer);
    assert.ok(got && got.rows['206'], JSON.stringify(got));
    const verdict = droppingNow({ flat: got.rows[String(206)], cuts: [], nowMs: now }, { pct: 15, hours: 6 });
    assert.equal(verdict && verdict.why, 'bazaars');
    assert.equal(verdict.to, 700);
});
