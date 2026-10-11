// Shared, the marks on the screens: the card on Torn's bazaar page (ui/overlay.js markFriendRows).
// One class and one data attribute, nothing appended - and taken off again when the mark goes.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as overlay from '../src/ui/overlay.js';

function card() {
    const classes = new Set();
    return { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, dataset: {}, appended: 0, appendChild() { this.appended += 1; }, style: {} };
}
const rootOf = (cards) => ({ querySelectorAll: () => cards.filter((c) => c.dataset.ttv2Friend !== undefined) });

test('a friend is going for a listing: its card gets one class and their Torn name, and loses both when the mark goes', () => {
    const a = card();
    const b = card();
    const root = rootOf([a, b]);
    overlay.markFriendRows([{ el: a, label: 'xX-Vin-Xx is on this' }], root);
    assert.equal(a.classList.contains('ttv2-friend'), true);
    assert.deepEqual(a.dataset, { ttv2Friend: 'xX-Vin-Xx is on this' });
    assert.equal(b.classList.contains('ttv2-friend'), false);
    assert.deepEqual(b.dataset, {});
    // Nothing is put into Torn's card, and nothing of its style is written: the mark is paint only.
    assert.equal(a.appended, 0);
    assert.deepEqual(a.style, {});
    // Another friend takes it over; the other card gets a mark of its own.
    overlay.markFriendRows([{ el: a, label: 'Alf-0nso is on this' }, { el: b, label: 'A friend is on this' }], root);
    assert.equal(a.dataset.ttv2Friend, 'Alf-0nso is on this');
    assert.equal(b.dataset.ttv2Friend, 'A friend is on this');
    // A row with no words is not marked.
    overlay.markFriendRows([{ el: a, label: '' }, { el: null, label: 'x' }, null], root);
    assert.deepEqual(a.dataset, {});
    assert.equal(a.classList.contains('ttv2-friend'), false);
    assert.equal(b.classList.contains('ttv2-friend'), false);
    // Their trade is over, or Shared is off: nothing of ours is left on the page.
    overlay.markFriendRows([{ el: a, label: 'xX-Vin-Xx is on this' }], root);
    overlay.markFriendRows([], root);
    assert.deepEqual(a.dataset, {});
    assert.equal(a.classList.contains('ttv2-friend'), false);
    // A green deal mark on the same card is left alone.
    overlay.markRow(a, { top: true, label: '+$3.4k' });
    overlay.markFriendRows([{ el: a, label: 'xX-Vin-Xx is on this' }], root);
    overlay.markFriendRows([], root);
    assert.equal(a.classList.contains('ttv2-hit'), true);
    assert.equal(a.dataset.ttv2Profit, '+$3.4k');
});
