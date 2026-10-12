/*
 * 3.30.1: a star and the blacklist sign on a trader's Torn profile.
 *
 * The rule is core/partners.js profileMarks; the page is read by sources/dom/profile.js (a stand-in
 * document here: the real page was not read for this build); the joins in src/main.js are read as text
 * (test/wiring.test.js says why).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { profileMarks, editFavourite, editBlacklist } from '../src/core/partners.js';
import { profileInfoHeader, profileNameOf } from '../src/sources/dom/profile.js';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = read('src/main.js');
const has = (text, what) => assert.ok(main.includes(text), what + ' - not in src/main.js: ' + text);

test('the star on a profile: a favourite by trades, added by hand, and a removal by hand over both', () => {
    const favourites = [{ id: '7', name: 'Bob' }];
    assert.deepEqual(profileMarks('7', { favourites }), { favourite: true, blacklisted: false });
    assert.deepEqual(profileMarks(7, { favourites }), { favourite: true, blacklisted: false });
    assert.deepEqual(profileMarks('8', { favourites }), { favourite: false, blacklisted: false });
    // Pressed on the profile: it shows at once, before Torn Bids has written its list again.
    assert.equal(profileMarks('8', { favourites, edits: editFavourite({}, '8', true) }).favourite, true);
    assert.equal(profileMarks('7', { favourites, edits: editFavourite({}, '7', false) }).favourite, false);
    assert.equal(profileMarks('7', {}).favourite, false);
});

test('the blacklist sign on a profile: by id, and by name for an entry made before the id was known', () => {
    const byId = editBlacklist([], { id: '7', name: 'Bob' }, true, 1);
    assert.equal(profileMarks('7', { blacklist: byId }).blacklisted, true);
    assert.equal(profileMarks('8', { blacklist: byId }).blacklisted, false);
    const byName = editBlacklist([], { name: 'Bob' }, true, 1);
    assert.equal(profileMarks('7', { blacklist: byName }).blacklisted, false);
    assert.equal(profileMarks('7', { blacklist: byName, name: 'BOB' }).blacklisted, true);
    // Taken off both ways, as the profile's press does.
    const both = editBlacklist(byName, { id: '7', name: 'Bob' }, true, 2);
    assert.deepEqual(editBlacklist(editBlacklist(both, { id: '7', name: 'Bob' }, false), { name: 'Bob' }, false), []);
});

/** A document of a few elements: querySelector by the first selector that names a class it has. */
function fakeDoc(els, title = '') {
    const hit = (el, sel) => sel.split(',').some((part) => {
        const last = part.trim().split(/[\s>]+/).pop();
        const cls = (last.match(/^\.([\w-]+)$/) || [])[1];
        const within = (last.match(/^\[class\*="([\w-]+)"\]$/) || [])[1];
        const role = (last.match(/^\[role="([\w-]+)"\]$/) || [])[1];
        const tag = /^[a-z]+$/.test(last) ? last : null;
        const box = part.includes('.user-information') ? el.inBox === 'user-information' : part.includes('.basic-information') ? el.inBox === 'basic-information' : true;
        if (!box) return false;
        if (cls) return el.cls.split(' ').includes(cls);
        if (within) return el.cls.includes(within);
        if (role) return el.role === role;
        return tag ? el.tag === tag : false;
    });
    return { title, querySelector: (sel) => els.find((el) => hit(el, sel)) || null, querySelectorAll: (sel) => els.filter((el) => hit(el, sel)) };
}

test('the profile page: the User Information header by its box, else by its words; the name from "Name [id]"', () => {
    const head = { tag: 'div', cls: 'title-black top-round', inBox: 'user-information', textContent: 'User Information' };
    const actions = { tag: 'div', cls: 'title-black top-round', inBox: 'actions', textContent: 'Actions' };
    const name = { tag: 'span', cls: 'bold', inBox: 'basic-information', textContent: 'KayMalta [5001]' };
    assert.equal(profileInfoHeader(fakeDoc([actions, head, name])), head);
    // The box renamed: found by its words, never the Actions header.
    const moved = { tag: 'div', cls: 'title-black', inBox: 'other', textContent: ' User Information ' };
    assert.equal(profileInfoHeader(fakeDoc([actions, moved])), moved);
    assert.equal(profileInfoHeader(fakeDoc([actions])), null);
    assert.equal(profileNameOf(fakeDoc([name]), '5001'), 'KayMalta');
    assert.equal(profileNameOf(fakeDoc([name]), '5002'), null);
    assert.equal(profileNameOf(fakeDoc([], 'KayMalta\'s Profile | TORN'), '5001'), 'KayMalta');
    assert.equal(profileNameOf(fakeDoc([name]), 'x'), null);
});

test('the joins: the profile is marked on every pass, the press saves where Torn Bids reads, and Torn Bids hears it', () => {
    assert.equal(main.split('            markChatButton();\n            markProfileTrader();\n').length - 1, 2,'beside both markChatButton calls of the page pass');
    has('    watchProfileFirst();\n', 'a profile just opened is looked at early');
    has('const show = Boolean(bidsOn() && id && String(own || \'\') !== id);', 'only while Torn Bids is on, never on your own profile');
    has('saveFavourite({ id, name }, !marks.favourite);', 'the star saves the favourite');
    has('saveBlacklisted({ id, name }, true);', 'the sign saves the blacklist');
    has('            saveFavourite(b, on);\n            renderSellingNow();', 'Torn Bids\' own star goes the same way');
    has('            saveBlacklisted(b, on);\n            renderSellingNow();', 'Torn Bids\' own sign goes the same way');
    has('for (const key of [STORE_SELL_FAVOURITES, STORE_SELL_BLACKLIST]) gmOnChange(key, () => renderSelling(true));', 'Torn Bids redraws when another tab pressed');
    has('if (led.loaded) noteFavouritesNow(favsNow);', 'who is a favourite now is written down for the profile');
    has('const favs = gmGet(STORE_SELL_FAV_NOW, null);', 'and the profile reads it');
    const css = read('src/ui/styles.js');
    for (const rule of ['.ttv2-pmarks {', '.ttv2-pmarks button.fav.on {', '.ttv2-pmarks button.blk.on {']) assert.ok(css.includes(rule), rule);
});
