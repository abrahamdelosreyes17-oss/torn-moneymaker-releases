/*
 * Torn Bids' shell (3.25.0): which item list a page shows, and which page shows a list.
 * The two must agree: a filter set from elsewhere ("see To sell", a trade opened from Today)
 * lands on the page that then asks for that same filter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BD_PAGES, BD_FLIPS_BEST, BD_FLIPS_TRADER, BD_FLIPS_ITEMS, bdFilterOf, bdPageOf } from '../src/ui/bids-shell.js';

test('the shell: each page asks for its own list, and By trader, Today, Ledger and Settings for none', () => {
    assert.equal(bdFilterOf('flips', BD_FLIPS_BEST), 'flips');
    assert.equal(bdFilterOf('flips', BD_FLIPS_ITEMS), 'all');
    assert.equal(bdFilterOf('flips', BD_FLIPS_TRADER), null);
    assert.equal(bdFilterOf('mine', 0), 'mine');
    assert.equal(bdFilterOf('sell', 0), 'sell');
    assert.equal(bdFilterOf('trades', 0), 'trades');
    for (const id of ['today', 'ledger', 'settings', 'nowhere']) assert.equal(bdFilterOf(id, 0), null);
});

test('the shell: a filter set from elsewhere lands on the page that shows it', () => {
    for (const filter of ['all', 'mine', 'flips', 'sell', 'trades']) {
        const at = bdPageOf(filter);
        assert.equal(bdFilterOf(at.page, at.tab), filter, filter);
    }
    // A filter nobody knows is Best flips, never a page that does not exist.
    assert.deepEqual(bdPageOf('something else'), { page: 'flips', tab: BD_FLIPS_BEST });
});

test('the shell: every page a filter lands on is in the sidebar, with the tab it names', () => {
    const pages = new Map(BD_PAGES.filter((p) => p.id).map((p) => [p.id, p]));
    for (const filter of ['all', 'mine', 'flips', 'sell', 'trades']) {
        const at = bdPageOf(filter);
        assert.ok(pages.has(at.page), at.page);
        assert.ok(at.tab === 0 || at.tab < (pages.get(at.page).tabs || []).length, at.page + ' tab ' + at.tab);
    }
    // Sidebar ids are each used once.
    assert.equal(pages.size, BD_PAGES.filter((p) => p.id).length);
});

test('the shell: Flips > For <the server owner> (3.32.0) is the tab after All items, and asks for no item list', async () => {
    const { BD_FLIPS_OWNER } = await import('../src/ui/bids-shell.js');
    assert.equal(BD_FLIPS_OWNER, BD_FLIPS_ITEMS + 1);
    assert.equal(bdFilterOf('flips', BD_FLIPS_OWNER), null);
});
