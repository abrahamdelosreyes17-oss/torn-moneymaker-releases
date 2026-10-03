/*
 * 3.20.5: who is online (core/status.js) - the friend, "pag start up
 * nirerecommend niya mga offline naman": the Best flips cards' buyers read
 * every 90 s, the traders in front of you read first after a press, flips
 * that wait for a status, and TornW3B's last-active kept across a reload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    statusWatch,
    statusAsks,
    flipCards,
    traderCards,
    STATUS_TRADER_CARDS,
    packActivity,
    unpackActivity,
    STATUS_OPEN_EVERY_MS,
    STATUS_EVERY_MS,
    STATUS_PRESSED_MS,
    STATUS_KEPT_FOR_FIRST,
    STATUS_WAITING_MAX,
    ACTIVITY_KEEP_MS,
    ACTIVITY_KEEP_MAX,
} from '../src/core/status.js';

const NOW = 1_760_000_000_000;
const b = (id) => ({ id: String(id), name: 'T' + id });
const flip = (itemId, id) => ({ itemId: String(itemId), buyer: id === null ? { name: 'ByName' } : b(id) });
const entry = (age, extra = {}) => ({ presence: null, fetchedAt: age === null ? 0 : NOW - age, pending: false, retryAt: 0, ...extra });

test('the watch: the desk, the flip cards, the waiting flips, what you hold, the list - in that order, each once', () => {
    const w = statusWatch({
        deskBuyers: [b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8)],
        planned: 'id:8',
        strip: [flip(10, 2), flip(11, 20)],
        waiting: [flip(12, 30), flip(13, null)],
        traders: [{ id: '35' }, { id: '3' }],
        heldBest: [b(40), undefined, b(1)],
        listedBest: [b(50), null, b(20)],
    });
    assert.deepEqual(w.ids, ['1', '2', '3', '4', '5', '6', '8', '20', '30', '35', '40', '50']);
    // Your traders' cards in view: every 90 s too.
    assert.ok(w.open.has('35') && w.first.has('35'));
    // 3.20.5: a Best flips card's buyer is read every 90 s, as the desk's rows are (it was every 10 minutes).
    assert.ok(w.open.has('20'), 'the flip card\'s buyer is open');
    assert.deepEqual([...w.open].sort((x, y) => x - y), ['1', '2', '3', '4', '5', '6', '8', '20', '35']);
    // A waiting flip's buyer is asked once, not kept at 90 s: it is not on the page yet.
    assert.equal(w.open.has('30'), false);
    assert.deepEqual([...w.first].sort((x, y) => x - y), ['1', '2', '3', '4', '5', '6', '8', '20', '30', '35']);
    assert.equal(w.first.has('40'), false);
    // Nothing at all: nothing asked.
    assert.deepEqual(statusWatch().ids, []);
});

test('the asks: an open trader every 90 s, the rest every 10 minutes, three under way at most', () => {
    const entries = new Map([
        ['1', entry(STATUS_OPEN_EVERY_MS - 1)],
        ['2', entry(STATUS_OPEN_EVERY_MS)],
        ['3', entry(STATUS_EVERY_MS - 1)],
        ['4', entry(STATUS_EVERY_MS)],
        ['5', entry(null)],
        ['6', entry(null, { pending: true })],
        ['7', entry(null, { retryAt: NOW + 1000 })],
        ['8', entry(null)],
    ]);
    const ids = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const open = new Set(['1', '2']);
    const first = new Set(ids);
    assert.deepEqual(statusAsks({ ids, open, first, entries, now: NOW }), [
        { id: '2', priority: 'low' },
        { id: '4', priority: 'low' },
        { id: '5', priority: 'low' },
    ]);
    // One already under way: two more.
    assert.deepEqual(statusAsks({ ids, open, first, entries, now: NOW, pending: 1 }).map((a) => a.id), ['2', '4']);
    // The minute's asks are used up: none.
    assert.deepEqual(statusAsks({ ids, open, first, entries, now: NOW, asked: 30 }), []);
    assert.deepEqual(statusAsks({ ids, open, first, entries, now: NOW, asked: 29 }).map((a) => a.id), ['2']);
});

test('the asks: after a press, the traders in front of you are read first in line - whatever is under way', () => {
    const entries = new Map([
        ['1', entry(STATUS_PRESSED_MS - 1)],
        ['2', entry(STATUS_PRESSED_MS)],
        ['3', entry(60000)],
        ['4', entry(null)],
        ['5', entry(60000, { pending: true })],
        ['6', entry(60000, { retryAt: NOW + 5 })],
        ['9', entry(60000)],
    ]);
    const ids = ['1', '2', '3', '4', '5', '6', '9'];
    const open = new Set(['1', '2', '3', '4', '5', '6']);
    // No press: none of them is 90 s old, only the one never read is asked.
    assert.deepEqual(statusAsks({ ids, open, first: open, entries, now: NOW }), [{ id: '4', priority: 'low' }]);
    // A press, with three asks already under way: read just now is left; 20 s old or never read goes, 'high'.
    assert.deepEqual(statusAsks({ ids, open, first: open, entries, now: NOW, pressed: true, pending: 3 }), [
        { id: '2', priority: 'high' },
        { id: '3', priority: 'high' },
        { id: '4', priority: 'high' },
    ]);
    // Never past the minute's limit, press or not.
    assert.deepEqual(statusAsks({ ids, open, first: open, entries, now: NOW, pressed: true, asked: 28 }).map((a) => a.id), ['2', '3']);
});

test('the asks: what you hold and the list never use the asks kept for the desk and the flips', () => {
    const ids = [];
    const entries = new Map();
    for (let i = 1; i <= 6; i++) {
        ids.push(String(i));
        entries.set(String(i), entry(null));
    }
    const first = new Set(['5', '6']);
    const at = 30 - STATUS_KEPT_FOR_FIRST;
    // The other asks of the minute are spent: 1-4 (held items, the list) wait, the flips' buyers go.
    assert.deepEqual(statusAsks({ ids, open: new Set(), first, entries, now: NOW, asked: at }).map((a) => a.id), ['5', '6']);
    // One short of that: one of them still goes, in its turn.
    assert.deepEqual(statusAsks({ ids, open: new Set(), first, entries, now: NOW, asked: at - 1 }).map((a) => a.id), ['1', '5', '6']);
});

test('Best flips, Buyers online only: a flip whose buyer is not read yet waits, the next known ones show', () => {
    const flips = [flip(1, 11), flip(2, 12), flip(3, 13), flip(4, 14), flip(5, 15), flip(6, null), flip(7, 17)];
    const unread = (id) => id === '11' || id === '13';
    // The switch off (or no key, or a hidden tab): the first four, as before.
    assert.deepEqual(flipCards(flips).strip.map((f) => f.itemId), ['1', '2', '3', '4']);
    assert.deepEqual(flipCards(flips, { hold: false, unread }).waiting, []);
    // On: 1 and 3 wait; a buyer known by name only is never waited for.
    const held = flipCards(flips, { hold: true, unread });
    assert.deepEqual(held.strip.map((f) => f.itemId), ['2', '4', '5', '6']);
    assert.deepEqual(held.waiting.map((f) => f.itemId), ['1', '3']);
    // Their statuses read: back in their places.
    assert.deepEqual(flipCards(flips, { hold: true, unread: () => false }).strip.map((f) => f.itemId), ['1', '2', '3', '4']);
    // Nobody read yet: no card, and only so many asked about at a time.
    const many = Array.from({ length: 30 }, (_, i) => flip(i + 1, 100 + i));
    const none = flipCards(many, { hold: true, unread: () => true });
    assert.deepEqual(none.strip, []);
    assert.equal(none.waiting.length, STATUS_WAITING_MAX);
    assert.deepEqual(none.waiting.map((f) => f.itemId), many.slice(0, STATUS_WAITING_MAX).map((f) => f.itemId));
    // A flip past the ones waiting still shows when its buyer is known.
    const last = flipCards(many, { hold: true, unread: (id) => id !== '129' });
    assert.deepEqual(last.strip.map((f) => f.itemId), ['30']);
});

test('TornW3B\'s last-active, kept across a reload: only what was read in the last 20 minutes', () => {
    const activity = new Map([
        ['1', { at: NOW - 60000, name: 'Ann', readAt: NOW - 30000 }],
        ['2', { at: NOW - 3 * 3600000, name: null, readAt: NOW - ACTIVITY_KEEP_MS + 1 }],
        ['3', { at: NOW - 60000, name: 'Old', readAt: NOW - ACTIVITY_KEEP_MS }],
        ['4', { at: NOW - 60000, name: 'NoRead' }],
        ['5', { at: 0, name: 'Never', readAt: NOW }],
    ]);
    const packed = packActivity(activity, NOW);
    assert.deepEqual(packed, { v: 1, rows: [['1', NOW - 60000, 'Ann', NOW - 30000], ['2', NOW - 3 * 3600000, null, NOW - ACTIVITY_KEEP_MS + 1]] });
    const back = unpackActivity(JSON.parse(JSON.stringify(packed)), NOW);
    assert.deepEqual([...back], [['1', { at: NOW - 60000, name: 'Ann', readAt: NOW - 30000 }], ['2', { at: NOW - 3 * 3600000, name: null, readAt: NOW - ACTIVITY_KEEP_MS + 1 }]]);
    // Opened 20 minutes later: "last active a minute ago" is not believed any more.
    assert.equal(unpackActivity(packed, NOW + ACTIVITY_KEEP_MS).size, 0);
    assert.deepEqual([...unpackActivity(packed, NOW + ACTIVITY_KEEP_MS - 30001).keys()], ['1']);
});

test('the kept activity: rubbish, another version and times from the future are not believed; the newest reads are kept', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { v: 2, rows: [['1', NOW - 5, 'A', NOW - 1]] }, { v: 1, rows: 'no' }]) assert.equal(unpackActivity(bad, NOW).size, 0);
    const rows = [
        ['1', NOW - 5, 'A', NOW - 1],
        ['x1', NOW - 5, 'A', NOW - 1],
        [2, NOW - 5, 'A', NOW - 1],
        ['3', '5', 'A', NOW - 1],
        ['4', NOW - 5, 7, NOW - 1],
        ['5', NOW - 5, 'A', NOW + 120000],
        ['6', NOW + 120000, 'A', NOW - 1],
        ['7', NOW - 5, 'A'],
        ['8', -1, 'A', NOW - 1],
        'row',
    ];
    assert.deepEqual([...unpackActivity({ v: 1, rows }, NOW).keys()], ['1']);
    const big = new Map();
    for (let i = 1; i <= ACTIVITY_KEEP_MAX + 50; i++) big.set(String(i), { at: NOW - 1000, name: null, readAt: NOW - i });
    const packed = packActivity(big, NOW);
    assert.equal(packed.rows.length, ACTIVITY_KEEP_MAX);
    assert.equal(packed.rows[0][0], '1');
    assert.equal(packed.rows[ACTIVITY_KEEP_MAX - 1][0], String(ACTIVITY_KEEP_MAX));
});

test('Your traders, Buyers online only: the cards in view are watched, and one not read yet offers no trade', () => {
    const card = (id, favourite, profit, extra = {}) => ({ id: String(id), name: 'T' + id, favourite, items: profit > 0 ? 2 : 0, profit, hiddenBy: null, ...extra });
    const list = [card(1, true, 500), card(2, false, 400), card(3, false, 300), card(4, true, 0), card(5, true, 200, { hiddenBy: 'offline' }), card(6, false, 100)];
    // The switch off (or no key, or a hidden tab): the list as it is, nobody asked about.
    const off = traderCards(list, { hold: false, unread: () => true });
    assert.equal(off.list, list);
    assert.deepEqual(off.watch, []);
    // On: each card with a trade is watched; "no trade now" and a favourite the switch already hides are not.
    const on = traderCards(list, { hold: true, unread: (id) => id === '2' });
    assert.deepEqual(on.watch.map((w) => w.id), ['1', '2', '3', '6']);
    assert.deepEqual(on.list.map((x) => Boolean(x.waiting)), [false, true, false, false, false, false]);
    assert.equal(on.list[1].profit, 400, 'the card keeps its place and its sums: only the offer waits');
    assert.equal(on.list[0], list[0], 'a card that does not wait is untouched');
    // Only the first cards of each row: the rest are under Show all, and nobody is asked about them.
    const many = [];
    for (let i = 1; i <= STATUS_TRADER_CARDS + 3; i++) many.push(card(i, false, 1000 - i));
    for (let i = 101; i <= 100 + STATUS_TRADER_CARDS + 2; i++) many.push(card(i, true, 1000 - i));
    const cut = traderCards(many, { hold: true, unread: () => true });
    assert.equal(cut.watch.length, STATUS_TRADER_CARDS * 2);
    assert.equal(cut.list.filter((x) => x.waiting).length, STATUS_TRADER_CARDS * 2);
    assert.equal(Boolean(cut.list[STATUS_TRADER_CARDS].waiting), false, 'the seventh trusted card');
    assert.equal(Boolean(cut.list[STATUS_TRADER_CARDS + 3].waiting), true, 'the first favourite');
});
