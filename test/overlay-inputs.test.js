/*
 * The overlay's boxes (the panel's Min and Cash chips, Settings › Fill's
 * "By how much") follow the approved input rule (mockups/R-inputs.html,
 * variant A): the box shows the saved value, Enter / Tab / leaving saves,
 * Esc or an emptied box puts the saved value back, a bad value is refused
 * with the reason under the box, and "no limit" is Cash's Any button, never
 * an empty box. Plus the overlay's layout fixes: nothing cut with "…", no
 * overlap at 240px, readable grey on the buying box.
 *
 * Namespace imports on purpose: a helper that is missing fails its own test,
 * not the whole file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as panel from '../src/ui/panel.js';
import * as fillForm from '../src/ui/fill-form.js';
import * as styles from '../src/ui/styles.js';

/** Every declaration block whose selector list is exactly `selector`, joined. */
function rule(css, selector) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
        if (sels.includes(selector)) out.push(m[2]);
    }
    return out.join('\n');
}

/** The value of `prop` in a declaration block (the last one wins), or null. */
function prop(block, name) {
    let value = null;
    for (const m of block.matchAll(/(?:^|;|\n)\s*([a-z-]+)\s*:\s*([^;]+)/g)) {
        if (m[1] === name) value = m[2].trim();
    }
    return value;
}

function luminance(rgb) {
    const lin = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function hex(h) {
    const s = h.replace('#', '');
    const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------ the Min and Cash chips */

test('chip box: an emptied box puts the saved value back, never "no limit" or 0', () => {
    assert.deepEqual(panel.readChipValue('minTotalProfit', '', 1e6), { restore: true, note: 'Empty - put back $1m.' });
    assert.deepEqual(panel.readChipValue('minTotalProfit', '   ', 1e6).restore, true);
    // Before: an empty Cash box saved null (no cash limit) without a word.
    assert.deepEqual(panel.readChipValue('cashOnHand', '', 5e7), { restore: true, note: 'Empty - put back $50m.' });
});

test('chip box: Any is no cash limit, stored exactly as the empty box used to be (null)', () => {
    assert.deepEqual(panel.readChipValue('cashOnHand', 'any', 5e7), { any: true });
    assert.deepEqual(panel.readChipValue('cashOnHand', 'No limit', 5e7), { any: true });
    // Min has no Any: the word is not a number there.
    assert.ok(panel.readChipValue('minTotalProfit', 'any', 1e6).error);
});

test('chip box: a bad value is refused with the reason and the value still in force', () => {
    const r = panel.readChipValue('minTotalProfit', '2 bucks', 1e6);
    assert.ok(r.error, 'refused');
    assert.match(r.error, /Could not read "2 bucks"/);
    assert.match(r.error, /Still \$1m\./);
    assert.equal(r.value, undefined);

    assert.match(panel.readChipValue('minTotalProfit', '-5', 1e6).error, /below \$0.*Still \$1m/);
    // Cash 0 is not "no limit" by accident: Any is.
    assert.match(panel.readChipValue('cashOnHand', '0', 5e7).error, /more than \$0 - or press Any\. Still \$50m\./);
    assert.match(panel.readChipValue('cashOnHand', 'lots', null).error, /Still Any\./);
});

test('chip box: good values are read as before (k / m / commas / "2 mil")', () => {
    assert.deepEqual(panel.readChipValue('minTotalProfit', '2m', 1e6), { value: 2e6 });
    assert.deepEqual(panel.readChipValue('minTotalProfit', '2 mil', 1e6), { value: 2e6 });
    assert.deepEqual(panel.readChipValue('minTotalProfit', '0', 1e6), { value: 0 });
    assert.deepEqual(panel.readChipValue('cashOnHand', '$1,500,000', null), { value: 1.5e6 });
    assert.deepEqual(panel.readChipValue('cashOnHand', '800k', 5e7), { value: 8e5 });
});

test('chip box opens with the saved value, exactly, short where exact', () => {
    assert.equal(panel.chipEditText('minTotalProfit', 1e6), '1m');
    assert.equal(panel.chipEditText('minTotalProfit', 2500), '2.5k');
    assert.equal(panel.chipEditText('minTotalProfit', 1250000), '1.25m');
    assert.equal(panel.chipEditText('minTotalProfit', 0), '0');
    assert.equal(panel.chipEditText('minTotalProfit', 1234567), '1,234,567');
    assert.equal(panel.chipEditText('cashOnHand', 5e7), '50m');
    assert.equal(panel.chipEditText('cashOnHand', null), 'any');
    // Whatever the box shows reads back as the same value.
    for (const v of [1, 999, 1000, 2500, 1234567, 1e6, 1.25e6, 5e7, 3e9]) {
        assert.deepEqual(panel.readChipValue('minTotalProfit', panel.chipEditText('minTotalProfit', v), v), { value: v });
    }
});

test('chip errors are said under the chips, not in the top bar', () => {
    const src = readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /must be a number like 1234567/, 'the old top-bar message is gone');
    assert.equal(panel.CHIP_SAVED_MS, 2000, 'Saved ✓ shows for 2 seconds');
    const note = rule(styles.PANEL_CSS, '.ttv2-chip-note');
    assert.ok(note, 'a line under the chips');
    assert.equal(prop(note, 'text-align'), 'right');
    assert.equal(prop(note, 'overflow-wrap'), 'anywhere', 'a long reason wraps, never cut');
    // Red that reads on the panel (--bad #d83500 is about 2:1 on #2e2e2e).
    const bad = prop(rule(styles.PANEL_CSS, '.ttv2-chip-note[data-level="bad"]'), 'color');
    assert.ok(contrast(hex(bad), hex('#2e2e2e')) >= 4.5, 'red reason readable: ' + bad);
    assert.ok(rule(styles.PANEL_CSS, '.ttv2-panel button.ttv2-chip-any'), 'Cash has an Any button');
});

/* ------------------------------------------- Settings › Fill, "By how much" */

test('Fill amount: an emptied box puts the saved amount back (before: it saved 0)', () => {
    assert.deepEqual(fillForm.readFillAmount('', '$', 50), { restore: true, note: 'Empty - put back $50.' });
    assert.deepEqual(fillForm.readFillAmount('  ', '%', 2.5), { restore: true, note: 'Empty - put back 2.5%.' });
});

test('Fill amount: bad values are refused with the reason; a percent is under 100', () => {
    assert.match(fillForm.readFillAmount('abc', '$', 50).error, /type a number.*Still \$50\./);
    assert.match(fillForm.readFillAmount('-3', '$', 50).error, /Still \$50\./);
    assert.match(fillForm.readFillAmount('%', '%', 1).error, /Still 1%\./);
    assert.match(fillForm.readFillAmount('100', '%', 1).error, /percent under 100.*Still 1%\./);
    assert.match(fillForm.readFillAmount('150%', '%', 1).error, /percent under 100/);
});

test('Fill amount: good values are read as before', () => {
    assert.deepEqual(fillForm.readFillAmount('2.5', '%', 1), { value: 2.5 });
    assert.deepEqual(fillForm.readFillAmount('99.9%', '%', 1), { value: 99.9 });
    assert.deepEqual(fillForm.readFillAmount('$1,000', '$', 50), { value: 1000 });
    assert.deepEqual(fillForm.readFillAmount('0', '$', 50), { value: 0 });
    assert.deepEqual(fillForm.readFillAmount('150', '$', 50), { value: 150 });
    assert.equal(fillForm.FILL_SAVED_MS, 2000);
});

test('Fill amount: the reason goes right under the box, readable red', () => {
    const css = fillForm.FILL_FORM_CSS;
    assert.ok(rule(css, '.tf-state'), 'a state line under the box');
    assert.equal(prop(rule(css, '.tf-state'), 'grid-column'), '2', 'under the box, not under the label');
    const bad = prop(rule(css, '.tf-state[data-level="bad"]'), 'color');
    assert.ok(bad && contrast(hex(bad), hex('#2e2e2e')) >= 4.5, 'readable red: ' + bad);
    assert.ok(prop(rule(css, '.tf-state[data-level="ok"]'), 'color'), 'Saved ✓ in green');
});

/* ------------------------------------------------------------- layout */

test('the seller line wraps, never cut with "…"', () => {
    const seller = rule(styles.PANEL_CSS, '.ttv2-seller');
    assert.ok(seller);
    assert.equal(prop(seller, 'text-overflow'), null, 'no ellipsis');
    assert.equal(prop(seller, 'white-space'), 'normal');
    assert.notEqual(prop(seller, 'overflow'), 'hidden');
    assert.equal(prop(seller, 'overflow-wrap'), 'anywhere');
});

test('the add page header: "Item" keeps its width, the money labels may wrap (no overlap at 240px)', () => {
    const head = rule(styles.PANEL_CSS, '.ttv2-bzhead');
    const cols = prop(head, 'grid-template-columns');
    assert.ok(cols, 'the header has its own columns');
    assert.doesNotMatch(cols.split(/\s+(?![^(]*\))/)[0], /^minmax\(0/, 'the first column cannot shrink to 0');
    assert.match(cols, /max-content/);
    assert.equal(prop(rule(styles.PANEL_CSS, '.ttv2-bzhead .ttv2-money'), 'white-space'), 'normal');
});

test('the add page: "×10 · $28 after fee" wraps inside its box', () => {
    // Panel buttons are nowrap; the listing buttons must not be.
    assert.equal(prop(rule(styles.PANEL_CSS, '.ttv2-panel button.ttv2-lowrow'), 'white-space'), 'normal');
    assert.equal(prop(rule(styles.PANEL_CSS, '.ttv2-lowrow .ttv2-lowsub'), 'white-space'), 'normal');
});

test('the buying box: grey instructions readable on the blue tint (>= 5.5:1), only there', () => {
    const color = prop(rule(styles.PANEL_CSS, '.ttv2-buybox .ttv2-sub'), 'color');
    assert.ok(color && color.startsWith('#'), 'its own grey: ' + color);
    // 3.20 Graphite: rgba(90, 167, 255, 0.12) over the panel's #1c1e23.
    const bg = [90, 167, 255].map((c, i) => Math.round(hex('#1c1e23')[i] + 0.12 * (c - hex('#1c1e23')[i])));
    assert.ok(contrast(hex(color), bg) >= 5.5, 'contrast ' + contrast(hex(color), bg).toFixed(2));
    // Everywhere else .ttv2-sub stays --muted.
    assert.equal(prop(rule(styles.PANEL_CSS, '.ttv2-sub'), 'color'), 'var(--muted)');
});
