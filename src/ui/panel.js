/*
 * The panel: a floating window with three pages.
 *
 *   header      Torn-style title bar: Sell, Scan, refresh, settings, collapse
 *   status bar  ONE line: "5 deals · +$5.18m"  ...  "● live · 12s"
 *   list        sell-to chips, Bazaars / Item Market tabs, ranked deals
 *   my bazaar   on your own bazaar's add / manage pages: what each item is
 *               going for now, and what the script has recorded
 *   settings    replaces the list (Back or Esc returns)
 *
 * Every button has one job and shows its state. Nothing goes on Torn's item
 * cards beyond one class; every number lives here. All text goes in through
 * textContent - names from Torn or TornW3B never touch innerHTML. The panel
 * is in a shadow root (see mount()).
 */

import {
    formatMoney,
    formatMoneyShort,
    formatMoneyCompact,
    formatPct,
    formatAge,
    parseMoneyInput,
} from '../core/parse.js';
import { VENUE_LABELS } from '../core/profit.js';
import { buyingStatus, buyingWhereText } from '../core/accepted.js';
import { W3B_TERMS_URL, W3B_SITE_URL } from '../api/w3b.js';
import { panelStyleElement } from './styles.js';
import { renderPriceGraph } from './graph.js';
import { buildFillForm } from './fill-form.js';
import { keyInputAttrs, keyMask } from './mask.js';

/** "last update 2m ago" turns the status amber after this. */
export const PANEL_STALE_MS = 60000;

export const TORN_API_KEY_URL = 'https://www.torn.com/preferences.php#tab=api';

/** "Did you buy?" takes no press this long after it appears (3.16: a quick second press on Next answered it). */
export const BUY_ASK_GUARD_MS = 1000;

/** Info messages ("Ready.") clear themselves; warnings and errors stay. */
const INFO_STATUS_MS = 6000;

/** The green "Saved ✓" under the Min / Cash chips goes after this. */
export const CHIP_SAVED_MS = 2000;
/** "Empty - put back $1m." stays a little longer, to be read. */
const CHIP_NOTE_MS = 4000;

/** The saved Min / Cash value in words: "$1m", or "Any" for no cash limit. */
function chipValueWords(key, value) {
    if (key === 'cashOnHand' && !value) return 'Any';
    return formatMoneyCompact(Number(value) || 0);
}

/**
 * What a Min or Cash chip's box holds when it opens: the saved value exactly,
 * short where that is exact ("1m", "2.5k"), else in full ("1,234,567"); "any"
 * for no cash limit. Never an empty box.
 */
export function chipEditText(key, value) {
    if (key === 'cashOnHand' && !value) return 'any';
    const n = Math.round(Number(value) || 0);
    for (const [unit, mult] of [['b', 1e9], ['m', 1e6], ['k', 1e3]]) {
        if (Math.abs(n) < mult) continue;
        const short = String(Number((n / mult).toFixed(2)));
        if (Math.round(Number(short) * mult) === n) return short + unit;
    }
    return n.toLocaleString('en-US');
}

/**
 * Read what was typed in a Min or Cash chip's box (key 'minTotalProfit' or
 * 'cashOnHand'), against the saved value.
 *
 *   {value}    save it
 *   {any}      Cash only: no cash limit (stored as null, as an empty box was)
 *   {restore}  the box was emptied: the saved value comes back, with a note
 *   {error}    not taken, and why; the saved value still counts
 */
export function readChipValue(key, raw, current) {
    const text = String(raw == null ? '' : raw).trim();
    const cash = key === 'cashOnHand';
    const words = chipValueWords(key, current);
    if (!text) return { restore: true, note: 'Empty - put back ' + words + '.' };
    if (cash && /^(any|no ?limit|none)$/i.test(text)) return { any: true };
    const value = parseMoneyInput(text);
    const still = ' Still ' + words + '.';
    if (value === null) return { error: 'Could not read "' + text + '" - try 2m or 800k.' + still };
    if (value < 0) return { error: (cash ? 'Cash' : 'Min') + ' can not be below $0.' + still };
    // No limit is its own button, never 0 or an empty box.
    if (cash && value === 0) return { error: 'Cash must be more than $0 - or press Any.' + still };
    return { value };
}

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (!key.startsWith('on') && value !== null && value !== undefined) {
            // A string "on..." is never set: no inline handler, ever.
            node.setAttribute(key, String(value));
        }
    }

    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }

    return node;
}

/**
 * Wrap a click handler so a thrown error lands in the panel.
 *
 * Without this an exception inside a handler is swallowed by the event loop
 * and the button simply appears dead - which is exactly how the first report
 * of "clicking Scan does nothing" arrived. A visible error is worth far more
 * than a tidy console.
 */
function guarded(panel, label, fn) {
    return (...args) => {
        try {
            const result = fn(...args);
            if (result && typeof result.catch === 'function') {
                result.catch((error) => {
                    panel.setStatus(label + ' failed: ' + describeError(error), 'error');
                });
            }
            return result;
        } catch (error) {
            panel.setStatus(label + ' failed: ' + describeError(error), 'error');
            return undefined;
        }
    };
}

function describeError(error) {
    if (!error) return 'unknown error';
    return String(error.message || error);
}

/** Keys typed into these belong to the page (or our fields), not the hotkey. */
const TEXT_INPUT_TYPES = new Set([
    '', 'text', 'search', 'email', 'number', 'password', 'tel', 'url',
]);

export function isTypingTarget(event) {
    // composedPath() sees into shadow roots, so our own inputs count too.
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const node = path[0] || event.target;
    if (!node || node.nodeType !== 1) return false;

    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        return TEXT_INPUT_TYPES.has(String(node.getAttribute('type') || '').toLowerCase());
    }
    return false;
}

/** The panel's usual width. */
const PANEL_WIDTH = 430;
/** It fits beside Torn's content when at least this much room is there (3.20: 240 before - 230px of room floated it, 430 wide, over Torn). */
const FIT_MIN_WIDTH = 200;
/** With less room than that, its smallest size: it covers as little of Torn as it can. */
const FIT_SMALLEST = 240;
/** Space kept between it and Torn's content, and the window edge. */
const FIT_GAP = 8;
/** Narrower than this, the header takes two rows instead of cutting anything. */
const TWO_ROW_BELOW = 420;

/** Long enough to see, short enough not to get in the way. */
const SCAN_ANIMATION_MS = 800;

export class Panel {
    /**
     * @param {object} handlers
     * @param {function} handlers.onScan           - refresh everything now
     * @param {function} handlers.onScanPage       - Scan: re-read this page and refresh prices
     * @param {function} handlers.onNavigate       - (row) => void
     * @param {function} handlers.onSettingsChange - (partialSettings) => void
     * @param {function} handlers.onViewChange     - ('bazaar'|'itemmarket')
     * @param {function} handlers.onSaveKey        - (key) => Promise<void>
     * @param {function} handlers.onForgetKey
     * @param {function} handlers.onClearCache
     * @param {function} handlers.onRevealKey      - () => stored key
     * @param {function} handlers.onOpenSelling    - open the selling page
     * @param {function} handlers.onSelectBazaarItem - (itemId) => void
     * @param {function} handlers.onBazaarWindow   - ('24h'|'7d'|'30d') => void
     */
    constructor(handlers = {}) {
        this.handlers = handlers;
        this.state = {
            rows: [],
            summary: { count: 0, totalProfit: 0, cashRequired: 0 },
            status: { text: '', level: 'info', at: 0 },
            settings: {},
            diagnostics: null,
            lastScanAt: null,
            busy: false,
            tab: 'bazaar',
            counts: {},
            live: null,
            bazaar: null,
        };

        this.page = 'list';
        this.hasKey = false;
        this.root = null;
        this.ticker = null;
    }

    /* ------------------------------------------------------------ mount */

    mount(parent = document.body) {
        if (this.root) return this.root;

        /* ---- header ---- */

        this.backBtn = el('button', {
            type: 'button',
            class: 'ttv2-icon ttv2-back',
            title: 'Back (Esc)',
            'aria-label': 'Back',
            text: '←',
            onclick: () => this.showPage(this.homePage()),
        });

        this.titleEl = el('div', { class: 'ttv2-title' });
        this.titleTextEl = el('span', { text: 'NPC Arbitrage' });
        // Shown only while collapsed: the headline, so a collapsed panel
        // still answers "is there anything to buy?".
        this.miniEl = el('span', { class: 'ttv2-mini' });
        this.titleEl.appendChild(this.titleTextEl);
        this.titleEl.appendChild(this.miniEl);

        // Torn Bids: its own tab, for traders' bids and flips.
        this.sellBtn = el('button', {
            type: 'button',
            class: 'ttv2-sell',
            title: 'Open Torn Bids in a new tab',
            text: 'Bids',
            onclick: guarded(this, 'Bids', () => this.handlers.onOpenSelling && this.handlers.onOpenSelling()),
        });

        // One button for "look again": re-reads this page and refreshes every
        // price (it used to be two, Scan and ↻, doing halves of the same job).
        this.scanBtn = el('button', {
            type: 'button',
            class: 'ttv2-scan',
            title: 'Scan this page and refresh prices',
            'aria-label': 'Scan this page and refresh prices',
            text: 'Scan',
            onclick: guarded(this, 'Scan', () => {
                if (!this.hasKey) {
                    this.showPage('settings', { focusKey: true });
                    return undefined;
                }
                return this.handlers.onScanPage ? this.handlers.onScanPage() : undefined;
            }),
        });

        this.settingsBtn = el('button', {
            type: 'button',
            class: 'ttv2-icon',
            title: 'Settings',
            'aria-label': 'Settings',
            'aria-pressed': 'false',
            text: '⚙',
            onclick: () => this.showPage(this.page === 'settings' ? this.homePage() : 'settings'),
        });

        this.collapseBtn = el('button', {
            type: 'button',
            class: 'ttv2-icon',
            title: 'Collapse (`)',
            'aria-label': 'Collapse',
            text: '–',
            onclick: () => this.setCollapsed(!this.collapsed, { save: true }),
        });

        // A thin line that sweeps under the header on every visible scan, so
        // you can see a scan happened even when nothing on the list changed.
        this.sweepEl = el('div', { class: 'ttv2-sweep', 'aria-hidden': 'true' });

        this.headEl = el('div', { class: 'ttv2-head' }, [
            this.backBtn,
            this.titleEl,
            this.sellBtn,
            this.scanBtn,
            this.settingsBtn,
            this.collapseBtn,
            this.sweepEl,
        ]);

        /* ---- status bar ---- */

        this.barLeft = el('span', { class: 'ttv2-bar-left' });
        this.barRight = el('span', { class: 'ttv2-bar-right' });
        this.barEl = el('div', { class: 'ttv2-bar' }, [this.barLeft, this.barRight]);

        /* ---- list page ---- */

        this.chipsEl = el('div', { class: 'ttv2-chips' });
        // Right under the chips: Saved ✓, or why Min / Cash did not take a value.
        this.chipNoteEl = el('div', { class: 'ttv2-chip-note', role: 'status', 'aria-live': 'polite' });
        this.buildChips();

        this.tabBtns = {};
        // Real tabs for a screen reader (aria-selected means nothing on a
        // plain button), and the arrow keys move between them.
        this.tabsEl = el('div', { class: 'ttv2-tabs', role: 'tablist', 'aria-label': 'Deals' });
        const tabKeys = ['bazaar', 'itemmarket'];
        for (const [key, label] of [
            ['bazaar', 'Bazaars'],
            ['itemmarket', 'Item Market'],
        ]) {
            const btn = el('button', {
                type: 'button',
                class: 'ttv2-tab',
                role: 'tab',
                text: label,
                onclick: () => this.handlers.onViewChange && this.handlers.onViewChange(key),
            });
            btn.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const next = tabKeys[(tabKeys.indexOf(key) + (event.key === 'ArrowRight' ? 1 : tabKeys.length - 1)) % tabKeys.length];
                if (this.handlers.onViewChange) this.handlers.onViewChange(next);
                this.tabBtns[next].focus();
            });
            btn.dataset.label = label;
            this.tabBtns[key] = btn;
            this.tabsEl.appendChild(btn);
        }

        // Where bazaar data comes from, on the tab it feeds.
        this.creditEl = el('span', { class: 'ttv2-credit' }, [
            el('a', {
                href: W3B_SITE_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: 'Bazaar prices come from TornW3B',
                text: 'via TornW3B',
            }),
            ' · ',
            el('a', {
                href: W3B_TERMS_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'terms',
            }),
        ]);
        this.tabsEl.appendChild(this.creditEl);

        this.colsEl = el('div', { class: 'ttv2-cols' }, [
            el('span', { class: 'ttv2-label', text: 'Deal' }),
            el('span', { class: 'ttv2-label ttv2-money', text: 'Profit' }),
        ]);

        this.listEl = el('div', { class: 'ttv2-list' });

        // Whose bazaar this is, and whether they are around. Bazaar pages only.
        this.sellerEl = el('div', { class: 'ttv2-seller' });

        // On Torn's trade page: the trade you accepted in Torn Bids, as a list
        // of what to send (the friend: "how do I remember the items I will
        // send him?"). Hidden everywhere else.
        this.tradeBoxEl = el('div', { class: 'ttv2-tradebox' });
        this.tradeBoxEl.style.display = 'none';
        // The buying run after a trader said yes: Next bazaar (3.12.8).
        this.buyBoxEl = el('div', { class: 'ttv2-tradebox ttv2-buybox' });
        this.buyBoxEl.style.display = 'none';

        this.listPage = el('div', { class: 'ttv2-page ttv2-page-list' }, [
            this.tradeBoxEl,
            this.sellerEl,
            this.chipsEl,
            this.chipNoteEl,
            this.tabsEl,
            this.listEl,
        ]);

        /* ---- my bazaar page ---- */

        this.bzListEl = el('div', { class: 'ttv2-bzlist' });
        this.bzDetailEl = el('div', { class: 'ttv2-bzdetail' });
        // What you bought and have not sold (3.22.0): above the items, shown only when there is something.
        this.bzSellEl = el('div', { class: 'ttv2-bzsellp' });
        this.bzSellEl.style.display = 'none';
        this.bazaarPage = el('div', { class: 'ttv2-page ttv2-page-bazaar' }, [this.bzSellEl, this.bzListEl, this.bzDetailEl]);
        this.bazaarPage.style.display = 'none';

        /* ---- settings page ---- */

        this.settingsPage = el('div', { class: 'ttv2-page ttv2-page-settings' });
        this.buildSettings();

        this.bodyEl = el('div', { class: 'ttv2-body' }, [
            this.barEl,
            this.listPage,
            this.bazaarPage,
            this.settingsPage,
        ]);

        // The buying run's box sits under the header, outside the pages: Next
        // is there on every page, in Settings, and with the panel collapsed.
        this.root = el('div', { class: 'ttv2-panel' }, [this.headEl, this.buyBoxEl, this.bodyEl]);

        // Esc closes an open chip editor, then Settings.
        this.root.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (this.closeChipEditor()) return;
            if (this.page === 'settings') this.showPage(this.homePage());
        });

        this.enableDrag(this.headEl);

        /*
         * The panel lives in a shadow root. Torn's stylesheet cannot reach
         * into it - it had been turning our section headings into giant
         * type - and nothing of ours leaks onto Torn's page.
         */
        this.host = document.createElement('div');
        this.host.id = 'ttv2-host';
        this.shadow = this.host.attachShadow({ mode: 'open' });
        this.shadow.appendChild(panelStyleElement(document));
        this.shadow.appendChild(this.root);
        parent.appendChild(this.host);

        window.addEventListener('resize', () => this.clampIntoView());
        // Torn lays its page out after load, and changes it without reloading:
        // fit again once it has, and whenever the window or its content resizes.
        this.fit();
        setTimeout(() => this.clampIntoView(), 1500);
        if (typeof ResizeObserver === 'function') {
            this.fitObserver = new ResizeObserver(() => this.clampIntoView());
            this.fitObserver.observe(document.documentElement);
        }

        this.showPage('list');

        // Every second: row ages and the refresh countdown are the "is this
        // still live?" signal.
        this.ticker = setInterval(() => {
            this.refreshAges();
            if (this.page === 'settings') this.renderApiUse();
        }, 1000);

        return this.root;
    }

    /* ------------------------------------------------------------ pages */

    /** The page Back returns to: My bazaar on your own bazaar, else the list. */
    homePage() {
        return this.state.bazaar ? 'mybazaar' : 'list';
    }

    /**
     * Switch pages. Settings REPLACES the list, at the same panel size - it
     * never stacks on top of it.
     */
    showPage(page, { focusKey = false } = {}) {
        this.page = page === 'settings' ? 'settings' : page === 'mybazaar' ? 'mybazaar' : 'list';
        if (!this.root) return;

        const settings = this.page === 'settings';

        // The panel has one fixed height (styles.js), so switching pages
        // or tabs never resizes it.

        this.root.classList.toggle('ttv2-on-settings', settings);
        this.listPage.style.display = this.page === 'list' ? '' : 'none';
        this.bazaarPage.style.display = this.page === 'mybazaar' ? '' : 'none';
        this.settingsBtn.setAttribute('aria-pressed', String(settings));
        this.titleTextEl.textContent = settings ? 'Settings' : this.page === 'mybazaar' ? (this.state.bazaar && this.state.bazaar.title) || 'My bazaar' : 'NPC Arbitrage';

        // Opening a page from a collapsed panel should show it.
        if (this.collapsed) this.setCollapsed(false, { save: true });

        if (settings && focusKey && this.keyInput) {
            setTimeout(() => this.keyInput.focus(), 0);
        }
        // A new title, and the chips and tabs shown or not: fit to them.
        this.fit();
    }

    openSettings({ focusKey = false } = {}) {
        this.showPage('settings', { focusKey });
    }

    /* ------------------------------------------------------------ chips */

    /**
     * Always-visible filters. "Sell to" answers the one question that
     * matters, with one click and no menu; the money filters open a tiny
     * editor in place.
     */
    buildChips() {
        const toggle = (key, label, title) => {
            const chip = el('button', {
                type: 'button',
                class: 'ttv2-chip',
                title,
                'aria-pressed': 'false',
                text: label,
                onclick: () => {
                    const on = chip.getAttribute('aria-pressed') !== 'true';
                    chip.setAttribute('aria-pressed', String(on));
                    this.emitSettings({ [key]: on });
                },
            });
            chip.dataset.key = key;
            return chip;
        };

        this.chipNpc = toggle('sellToNpc', 'NPC', 'Listings under the NPC sell price. Guaranteed, no tax.');
        this.chipBazaar = toggle('resaleBazaar', 'My bazaar', 'Listings under value, to relist in your bazaar.');
        this.chipMarket = toggle('resaleMarket', 'Market', 'Listings under value, to resell on the Item Market.');

        this.chipMin = this.valueChip(
            'minTotalProfit',
            (v) => 'Min ' + formatMoneyCompact(v || 0),
            'Hide deals below this total profit',
        );
        this.chipCash = this.valueChip(
            'cashOnHand',
            (v) => (v ? 'Cash ' + formatMoneyCompact(v) : 'Cash: any'),
            'Show only what this cash can buy',
        );

        this.chipsEl.appendChild(this.chipNpc);
        this.chipsEl.appendChild(this.chipBazaar);
        this.chipsEl.appendChild(this.chipMarket);
        // Min and Cash sit at the right end (a margin, not a spacer: no extra gap).
        this.chipMin.classList.add('ttv2-chips-end');
        this.chipsEl.appendChild(this.chipMin);
        this.chipsEl.appendChild(this.chipCash);
    }

    /**
     * A chip showing a number; click it to edit in place. The box opens with
     * the saved value, all selected: typing replaces it. Enter, Tab or
     * clicking away saves ("Saved ✓" under the chips for 2 seconds); Esc or
     * an emptied box puts the saved value back. Anything the box cannot read
     * stays in it, red, with the reason under the chips, and the old value
     * still counts: a cash figure that silently became "no cap" showed every
     * deal as affordable. No cash limit is Cash's own Any button.
     */
    valueChip(key, label, title) {
        const chip = el('button', {
            type: 'button',
            class: 'ttv2-chip ttv2-chip-value',
            title,
        });
        chip.dataset.key = key;
        chip.labelFor = label;
        chip.textContent = label(null);

        chip.addEventListener('click', () => this.openChipEditor(chip, key, title));

        return chip;
    }

    openChipEditor(chip, key, title) {
        this.closeChipEditor();
        this.setChipNote('');

        const cash = key === 'cashOnHand';
        const saved = () => this.state.settings[key];
        const input = el('input', {
            type: 'text',
            class: 'ttv2-chip-input',
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-label': title,
        });
        input.value = chipEditText(key, saved());
        input.classList.toggle('ttv2-chip-input-dim', cash && !saved());

        const anyBtn = cash
            ? el('button', {
                type: 'button',
                class: 'ttv2-chip ttv2-chip-any',
                title: 'No cash limit: show every deal',
                'aria-pressed': String(!saved()),
                text: 'Any',
            })
            : null;
        const box = el('span', { class: 'ttv2-chip-edit' + (anyBtn ? ' ttv2-chip-edit-any' : '') }, [input, anyBtn]);
        const editor = { chip, input, box };
        let dirty = false;

        // Leaving the box saves what was typed. false: not taken (it stays, red).
        const leave = () => {
            if (this.chipEditor !== editor) return true;
            if (!dirty) {
                this.closeChipEditor();
                return true;
            }
            const r = readChipValue(key, input.value, saved());
            if (r.error) {
                input.classList.add('ttv2-bad');
                input.setAttribute('aria-invalid', 'true');
                this.setChipNote(r.error, 'bad');
                return false;
            }
            this.closeChipEditor();
            if (r.restore) {
                this.setChipNote(r.note, 'grey');
                return true;
            }
            this.emitSettings({ [key]: r.any ? null : r.value });
            this.setChipNote('Saved ✓', 'ok');
            return true;
        };

        input.addEventListener('input', () => {
            dirty = true;
            input.classList.remove('ttv2-chip-input-dim');
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                leave();
            } else if (event.key === 'Escape') {
                // The saved value back, as if nothing was typed.
                event.preventDefault();
                event.stopPropagation();
                this.closeChipEditor();
            }
        });
        // Click or Tab in: all of it selected, so typing replaces it. The
        // second click of a double-click on the chip lands in the box: it
        // must not drop the selection.
        const openedAt = Date.now();
        let clickFocus = false;
        input.addEventListener('mousedown', (event) => {
            if (!dirty && Date.now() - openedAt < 600) {
                event.preventDefault();
                return;
            }
            clickFocus = input.getRootNode().activeElement !== input;
        });
        input.addEventListener('mouseup', (event) => {
            if (!clickFocus) return;
            clickFocus = false;
            event.preventDefault();
        });
        input.addEventListener('focus', () => input.select());

        if (anyBtn) {
            // Pressing Any keeps the focus in the box: leaving would save first.
            anyBtn.addEventListener('mousedown', (event) => event.preventDefault());
            anyBtn.addEventListener('click', () => {
                this.closeChipEditor();
                this.emitSettings({ cashOnHand: null });
                this.setChipNote('Saved ✓', 'ok');
            });
        }
        // Tab from the box to Any stays in the editor; anywhere else leaves it.
        box.addEventListener('focusout', (event) => {
            if (event.relatedTarget && box.contains(event.relatedTarget)) return;
            leave();
        });

        chip.style.display = 'none';
        // In the chip's place, right end included.
        if (chip.classList.contains('ttv2-chips-end')) box.style.marginLeft = 'auto';
        chip.parentNode.insertBefore(box, chip.nextSibling);
        this.chipEditor = editor;
        // The editor is wider than "Min $0": the row must still fit.
        this.clampIntoView();
        input.focus();
        input.select();
    }

    /** @returns {boolean} true if an editor was open */
    closeChipEditor() {
        const editor = this.chipEditor;
        if (!editor) return false;

        const root = editor.box.getRootNode();
        const hadFocus = Boolean(root && root.activeElement && editor.box.contains(root.activeElement));
        this.chipEditor = null;
        editor.chip.style.display = '';
        if (editor.box.parentNode) editor.box.parentNode.removeChild(editor.box);
        // The saved value is shown again: a complaint about a bad one goes.
        if (this.chipNoteEl && this.chipNoteEl.dataset.level === 'bad') this.setChipNote('');
        // Enter, Esc or Any: the keyboard carries on from the chip.
        if (hadFocus) editor.chip.focus();
        this.clampIntoView();
        return true;
    }

    /**
     * The line under the chips: "Saved ✓" (green, 2 seconds), why a value
     * was not taken (red, until fixed or Esc), or a grey note. '' hides it.
     */
    setChipNote(text, level = '') {
        const note = this.chipNoteEl;
        if (!note) return;
        clearTimeout(this.chipNoteTimer);
        note.textContent = text || '';
        note.dataset.level = text ? level : '';
        note.classList.toggle('ttv2-shown', Boolean(text));
        this.chipsEl.classList.toggle('ttv2-chips-noted', Boolean(text));
        if (text && level !== 'bad') {
            this.chipNoteTimer = setTimeout(() => this.setChipNote(''), level === 'ok' ? CHIP_SAVED_MS : CHIP_NOTE_MS);
        }
    }

    /* --------------------------------------------------------- settings */

    /**
     * Settings, top to bottom: the key (with Torn's required disclosure
     * right under it), watching, and links. Maintenance (re-download item
     * data, reset panel position, scan diagnostics) is in the Tampermonkey
     * menu, out of the way. The selling page keeps its own settings.
     */
    buildSettings() {
        const section = (title, children) =>
            el('section', { class: 'ttv2-section' }, [
                el('h3', { class: 'ttv2-h', text: title }),
                ...children,
            ]);

        const note = (text) => el('div', { class: 'ttv2-note', text });

        /* ---- API key ---- */

        /*
         * NOT type="password" where CSS can mask (see ui/mask.js): Chrome
         * would offer to save it and autofill over it. And the saved key is
         * not kept in the field - a value in an <input> is readable by any
         * script with the panel's shadow root - Show fetches it, Hide (or a
         * minute) removes it.
         */
        this.keyInput = el('input', {
            ...keyInputAttrs(),
            class: 'ttv2-key',
            placeholder: 'Public API key',
        });

        const showBtn = el('button', { type: 'button', text: 'Show' });
        this.keyMask = keyMask(this.keyInput, 'ttv2-masked', {
            onReveal: () => (this.handlers.onRevealKey ? this.handlers.onRevealKey() : ''),
            onChange: (hidden) => {
                showBtn.textContent = hidden ? 'Show' : 'Hide';
            },
        });
        showBtn.addEventListener('click', () => this.keyMask.toggle());

        const save = guarded(this, 'Save', () => {
            const key = this.keyInput.value.trim();
            return this.handlers.onSaveKey ? this.handlers.onSaveKey(key) : undefined;
        });

        this.keyInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            save();
        });

        const saveBtn = el('button', { type: 'button', class: 'ttv2-primary', text: 'Save', onclick: save });

        this.keyStateEl = el('div', { class: 'ttv2-keystate', text: 'No key saved.' });

        const keyHelp = el('div', { class: 'ttv2-note' }, [
            'A Public key is enough. Make one at ',
            el('a', {
                href: TORN_API_KEY_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'Torn › Settings › API Key',
            }),
            '.',
        ]);

        // Torn requires this where the key is entered; it stays right here.
        this.tosEl = el('details', { class: 'ttv2-tos-box', open: '' }, [
            el('summary', { text: 'Key use (Torn API terms)' }),
            this.buildTosTable(),
        ]);

        const forgetBtn = el('button', {
            type: 'button',
            class: 'ttv2-link',
            text: 'Forget key',
            onclick: () => this.handlers.onForgetKey && this.handlers.onForgetKey(),
        });

        this.settingsPage.appendChild(
            section('API key', [
                el('div', { class: 'ttv2-inline' }, [this.keyInput, showBtn, saveBtn]),
                this.keyStateEl,
                keyHelp,
                this.tosEl,
                forgetBtn,
            ]),
        );

        /* ---- watching ---- */

        const check = (key, label, sub) => {
            const input = el('input', { type: 'checkbox' });
            input.addEventListener('change', () => this.emitSettings({ [key]: input.checked }));

            const row = el('label', { class: 'ttv2-check' }, [
                input,
                el('span', {}, [
                    el('span', { class: 'ttv2-check-label', text: label }),
                    sub,
                ]),
            ]);
            return { input, row };
        };

        const im = check(
            'liveFeed',
            'Watch the Item Market anywhere',
            el('span', { class: 'ttv2-sub', text: 'One visible Torn tab, at most 30 API calls a minute.' }),
        );
        this.liveFeedInput = im.input;

        const w3bSub = el('span', { class: 'ttv2-sub' }, [
            'Bazaar prices from ',
            el('a', { href: W3B_SITE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'weav3r.dev' }),
            ' (',
            el('a', { href: W3B_TERMS_URL, target: '_blank', rel: 'noopener noreferrer', text: 'terms' }),
            '). It gets item ids only, never your key.',
        ]);

        const bz = check('useW3b', 'Watch bazaars via TornW3B', w3bSub);
        this.useW3bInput = bz.input;

        // The friend's switch: every automatic NPC-deal call off at once.
        const saveSw = check(
            'saveCalls',
            'NPC deals: save API calls',
            el('span', { class: 'ttv2-sub', text: 'Turns off Item Market watching and sellers\' online status: 0 API calls. Bazaars are still watched through TornW3B, which uses none. Fill and Torn Bids are not affected.' }),
        );
        this.saveCallsInput = saveSw.input;

        // Resale deals (the My bazaar / Market chips): a person may pay less
        // or never buy, so $1 is not a deal there. NPC deals keep $1.
        this.resaleMinInput = el('input', { type: 'text', inputmode: 'decimal', class: 'ttv2-pct-input', 'aria-label': 'Least profit per item, percent' });
        const pctSub = el('span', { class: 'ttv2-sub', text: 'For My bazaar and Market deals. NPC deals count from $1.' });
        const applyPct = () => {
            const raw = String(this.resaleMinInput.value).replace(/[%\s]/g, '');
            const n = Number(raw);
            if (raw && Number.isFinite(n) && n >= 0 && n <= 100) {
                this.emitSettings({ resaleMinPct: n });
                pctSub.textContent = 'For My bazaar and Market deals. NPC deals count from $1.';
                pctSub.classList.remove('ttv2-bad');
                this.resaleMinInput.removeAttribute('aria-invalid');
                return;
            }
            // Said, not silently put back.
            pctSub.textContent = 'Not saved: type a percent from 0 to 100. Still ' + (this.state.settings.resaleMinPct ?? 1) + '%.';
            pctSub.classList.add('ttv2-bad');
            this.resaleMinInput.setAttribute('aria-invalid', 'true');
            this.resaleMinInput.value = String(this.state.settings.resaleMinPct ?? 1);
        };
        this.resaleMinInput.addEventListener('change', applyPct);
        this.resaleMinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') applyPct();
        });
        const pctRow = el('label', { class: 'ttv2-check ttv2-pct' }, [
            this.resaleMinInput,
            el('span', {}, [
                el('span', { class: 'ttv2-check-label', text: 'Least profit per item, %' }),
                pctSub,
            ]),
        ]);
        this.apiUseEl = el('div', { class: 'ttv2-note ttv2-apiuse' });

        this.settingsPage.appendChild(
            section('Watching', [saveSw.row, im.row, bz.row, pctRow, this.apiUseEl, note('Nothing is bought, clicked or announced for you.')]),
        );
        this.renderApiUse();

        /* ---- links ---- */

        const nt = check(
            'openInNewTab',
            'Open deals in a new tab',
            el('span', { class: 'ttv2-sub', text: 'Off: Go opens the listing in this tab.' }),
        );
        this.newTabInput = nt.input;

        this.settingsPage.appendChild(section('Links', [nt.row]));

        /* ---- the Fill button (your bazaar's and the Item Market's own pages) ---- */
        this.fillForm = buildFillForm({
            get: () => (this.handlers.getFill ? this.handlers.getFill() : null),
            set: (value) => this.handlers.onFillSettings && this.handlers.onFillSettings(value),
        });
        this.fillSectionEl = section('Fill', [
            note('On your bazaar\'s add and manage pages and the Item Market\'s add-listing and your-listings pages: tick Fill in a row to type its price; untick to put it back.'),
            this.fillForm.el,
        ]);
        this.settingsPage.appendChild(this.fillSectionEl);

        this.settingsPage.appendChild(
            section('Torn Bids', [
                note('Torn Bids has its own keys and settings.'),
                el('button', {
                    type: 'button',
                    class: 'ttv2-link',
                    text: 'Open Torn Bids',
                    onclick: guarded(this, 'Bids', () => this.handlers.onOpenSelling && this.handlers.onOpenSelling()),
                }),
            ]),
        );
    }

    /**
     * Torn's trade page: the trade you accepted in Torn Bids - is this the
     * right person, did they put in the money, what to send and what is in
     * already. Read only: Fill on the add step is the only thing that types,
     * one row per press.
     *
     * @param {Array|null} trades - accepted trades (core/accepted.js); null hides the box
     * @param {object} [ctx] - {partner, match: 'ok'|'other'|null, wanted: string[],
     *   need: [{name, qty, inside}], waiting: string[], expected: number, money: {offer, expected}|null}
     */
    setTrades(trades, ctx = {}) {
        const box = this.tradeBoxEl;
        if (!box) return;
        const list = trades || [];
        const show = list.length > 0 || ctx.match === 'other';
        const sig = JSON.stringify([list.map((t) => [t.key, t.at, t.items.map((i) => [i.line, i.units, i.sent, i.left || 0, (i.steps || []).map((s) => s.boughtQty)])]), ctx]);
        if (sig === this.tradeSig) return;
        this.tradeSig = sig;
        box.textContent = '';
        box.style.display = show ? '' : 'none';
        this.tradeShown = show;
        if (!show) return this.renderFillNote();
        if (ctx.match === 'other') {
            box.appendChild(el('div', { class: 'ttv2-tb-warn', text: 'This trade is with ' + ctx.partner + '. The trade you accepted is with ' + (ctx.wanted || []).join(', ') + '.' }));
            return this.renderFillNote();
        }
        for (const t of list) {
            const need = ctx.need && list.length === 1 ? ctx.need : t.items.map((i) => ({ name: i.name, qty: i.units, inside: 0 }));
            // What goes in now (3.17.2: a trade made mid flip is not the whole plan's money).
            const expected = ctx.money ? ctx.money.expected : list.length === 1 && ctx.expected > 0 ? ctx.expected : t.pays;
            const block = el('div', { class: 'ttv2-tb' }, [
                el('div', { class: 'ttv2-tb-head' }, [
                    el('b', { text: 'Trade with ' + t.trader.name }),
                    el('span', { class: 'ttv2-money', text: formatMoney(expected) }),
                ]),
            ]);
            // Is this them? (Read off the trade view; the add step remembers it.)
            if (ctx.match === 'ok') block.appendChild(el('div', { class: 'ttv2-tb-ok', text: 'Trading with ' + (ctx.partner || t.trader.name) + ' ✓' }));
            else block.appendChild(el('div', { class: 'ttv2-sub', text: 'Open the trade with ' + t.trader.name + ' to check it is them.' }));
            // Their money against what the trade says.
            if (ctx.money) {
                const m = ctx.money;
                const text = m.offer >= m.expected
                    ? t.trader.name + ' put in ' + formatMoney(m.offer) + ' ✓'
                    : m.offer > 0
                        ? t.trader.name + ' put in ' + formatMoney(m.offer) + ' of ' + formatMoney(m.expected) + ': ' + formatMoney(m.expected - m.offer) + ' short'
                        : t.trader.name + ' has not put money in yet (' + formatMoney(m.expected) + ' expected)';
                block.appendChild(el('div', { class: m.offer >= m.expected ? 'ttv2-tb-ok' : 'ttv2-tb-warn', text }));
            }
            for (const n of need) {
                const inTrade = n.inside >= n.qty;
                block.appendChild(el('div', { class: 'ttv2-tb-row' + (inTrade ? ' ttv2-tb-done' : '') }, [
                    el('span', { class: 'ttv2-tb-mark', text: inTrade ? '✓' : '·' }),
                    el('span', { class: 'ttv2-tb-name' }, [el('b', { text: n.name }), document.createTextNode(' ×' + n.qty.toLocaleString('en-US'))]),
                    el('span', { class: 'ttv2-tb-in', text: n.inside ? n.inside.toLocaleString('en-US') + ' in' : '' }),
                ]));
            }
            // A trade made mid flip (3.17.2): the plan's items not bought yet - not to send, not in the money above.
            if (ctx.waiting && ctx.waiting.length && list.length === 1) block.appendChild(el('div', { class: 'ttv2-sub', text: 'Not bought yet: ' + ctx.waiting.join(', ') }));
            box.appendChild(block);
        }
        this.renderFillNote();
    }

    /**
     * Fill's line on Torn's trade page - what it marked, or why nothing
     * (3.20): at the foot of the trade box. It was a line added after Torn's
     * ADD TO TRADE, and Torn's pages get nothing that takes room.
     *
     * @param {{text: string, ok?: boolean}|null} n
     */
    setFillNote(n) {
        const key = n ? JSON.stringify([n.text, Boolean(n.ok)]) : '';
        if (key === this.fillNoteKey) return;
        this.fillNoteKey = key;
        this.fillNote = n || null;
        this.renderFillNote();
    }

    renderFillNote() {
        const box = this.tradeBoxEl;
        if (!box) return;
        let line = box.querySelector(':scope > .ttv2-tb-fillnote');
        const n = this.fillNote;
        if (!n) {
            if (line) line.remove();
            if (!this.tradeShown) box.style.display = 'none';
            return;
        }
        if (!line) line = el('div', { class: 'ttv2-tb-fillnote' });
        if (line !== box.lastElementChild) box.appendChild(line);
        const cls = 'ttv2-tb-fillnote' + (n.ok ? ' ttv2-tb-fillnote-ok' : '');
        if (line.className !== cls) line.className = cls;
        if (line.textContent !== n.text) line.textContent = n.text;
        box.style.display = '';
    }

    /**
     * The buying run, on any Torn page while a trade you accepted still has
     * something to buy: where you are, what you took here, and Next bazaar
     * (one press opens one bazaar).
     *
     * @param {object|null} v - {trader, done, total, here: {name, qty, price, seller, listed, bought}|null, next: {name, seller}|null, last}
     */
    setBuying(v) {
        const box = this.buyBoxEl;
        if (!box) return;
        // Cancel trade asks first (a buying run is not thrown away by a slip).
        if (!v || this.cancelAsk !== v.key) this.cancelAsk = null;
        // "Did you buy?" takes no press for a moment after it appears (3.16):
        // its answers come up where Next was, and in the friend's run a quick
        // second press on Next answered "Did not buy" every time.
        const askId = v && v.ask && v.here ? v.key + '|' + v.here.name + '|' + v.here.seller : null;
        if (askId !== this.askId) {
            this.askId = askId;
            this.askSince = Date.now();
        }
        const askWait = askId ? Math.max(0, BUY_ASK_GUARD_MS - (Date.now() - this.askSince)) : 0;
        if (askWait > 0 && !this.askTimer) {
            this.askTimer = setTimeout(() => {
                this.askTimer = null;
                if (this.lastBuying) this.setBuying(this.lastBuying);
            }, askWait + 20);
        }
        this.lastBuying = v;
        const sig = JSON.stringify([v, this.cancelAsk, askWait > 0]);
        if (sig === this.buySig) return;
        this.buySig = sig;
        box.textContent = '';
        box.style.display = v ? '' : 'none';
        this.buyHereActive = Boolean(v && v.here && !v.ask);
        if (!v) return;
        // How long since they said yes: the longer, the likelier prices moved.
        box.appendChild(el('div', { class: 'ttv2-tb-head' }, [
            el('b', { text: 'Buying for ' + v.trader }),
            // Its parts never break inside ("yes 100 / min ago"): a part that does not fit goes to the next line whole.
            el('span', { class: 'ttv2-sub ttv2-tb-status' + (v.age >= 10 * 60000 ? ' ttv2-tb-late' : ''), title: 'Since ' + v.trader + ' said yes: the longer, the likelier prices moved' },
                buyingStatus(v.done, v.total, v.age).flatMap((part, i) => [i ? ' · ' : null, el('span', { class: 'ttv2-nobr', text: part })]).filter(Boolean)),
        ]));
        if (v.here) {
            const h = v.here;
            box.appendChild(el('div', { class: 'ttv2-sub', text: 'Here: buy ' + h.qty.toLocaleString('en-US') + ' ' + h.name + ' at ' + formatMoney(h.price) + ' from ' + h.seller + (h.listed ? ' (marked on the page).' : '.') }));
            // Re-priced since the plan: still counted; said so, and whether it still pays.
            if (h.nowPrice) {
                box.appendChild(el('div', {
                    class: 'ttv2-tb-warn',
                    text: 'Now ' + formatMoney(h.nowPrice) + ' each (planned ' + formatMoney(h.price) + ')' + (h.bid && h.nowPrice >= h.bid ? ' - not under what ' + v.trader + ' pays (' + formatMoney(h.bid) + '): skip it.' : '.'),
                }));
            }
            if (!v.ask) box.appendChild(el('div', { class: h.bought >= h.qty ? 'ttv2-tb-ok' : h.listed ? 'ttv2-sub' : 'ttv2-tb-warn', text: h.bought ? 'You took ' + h.bought.toLocaleString('en-US') + ' of ' + h.qty.toLocaleString('en-US') + (h.bought >= h.qty ? ' ✓' : '') : h.listed ? 'Not bought yet - or skip it: Next counts only what you took.' : buyingWhereText(h) }));
        }
        // The listing was never seen here, so nothing could be counted: ask.
        if (v.ask && v.here) {
            box.appendChild(el('div', { class: 'ttv2-tb-warn', text: 'The listing was not seen on this page, so nothing was counted. Did you buy ' + v.here.qty.toLocaleString('en-US') + ' ' + v.here.name + '?' }));
            // null, not false: el() sets any value it gets, and disabled="false" is still disabled.
            const waiting = askWait > 0 ? true : null;
            // Pressed while still waiting: nothing happens (a disabled button takes no click).
            const answer = (yes) => () => {
                if (Date.now() - this.askSince < BUY_ASK_GUARD_MS) return;
                if (this.handlers.onBuyNext) this.handlers.onBuyNext(yes);
            };
            box.appendChild(el('div', { class: 'ttv2-tb-ask' }, [
                el('button', { type: 'button', class: 'ttv2-primary', disabled: waiting, text: 'Bought ' + v.here.qty.toLocaleString('en-US'), onclick: answer(true) }),
                el('button', { type: 'button', disabled: waiting, text: 'Did not buy', onclick: answer(false) }),
            ]));
            const first = box.querySelector('.ttv2-tb-ask button');
            if (!waiting && first && this.root && this.root.getRootNode().activeElement === null) first.focus({ preventScroll: true });
            return;
        }
        // "Not here" only when it is not: a listing further down a long bazaar is still here.
        const notHere = v.here && !v.here.listed && !['below', 'searching', 'away'].includes(v.here.where);
        const label = v.here && (!v.next || v.last) ? 'Done - go to the trade' : notHere ? 'Not here - next' : v.here && v.same ? 'Next item here' : v.here ? 'Next bazaar' : 'Open the next bazaar' + (v.next && v.next.seller ? ': ' + v.next.seller : '');
        this.buyNextBtn = el('button', { type: 'button', class: 'ttv2-primary ttv2-buynext', title: this.buyHereActive ? 'Key: N' : null, onclick: () => this.handlers.onBuyNext && this.handlers.onBuyNext() }, [label, this.buyHereActive ? el('span', { class: 'ttv2-kbd', text: 'N' }) : null]);
        box.appendChild(this.buyNextBtn);
        box.appendChild(this.cancelTradePart(v, () => this.setBuying(v)));
    }

    /**
     * Cancel trade (the owner, 2026-09-29): they accepted, then it was called
     * off. A link, then "Cancel the trade with X?" - Yes / Keep it.
     */
    cancelTradePart(v, redraw) {
        const again = () => {
            this.buySig = null;
            redraw();
        };
        if (this.cancelAsk !== v.key) {
            return el('div', { class: 'ttv2-tb-cancel' }, [
                el('button', { type: 'button', class: 'ttv2-linkbtn', title: 'They accepted, then the trade was called off: this flip plan goes (not marked declined)', text: 'Cancel trade', onclick: () => {
                    this.cancelAsk = v.key;
                    again();
                } }),
            ]);
        }
        return el('div', { class: 'ttv2-tb-cancel ttv2-tb-ask' }, [
            el('div', { class: 'ttv2-tb-warn', text: 'Cancel the trade with ' + v.trader + '? What you bought goes to Torn Bids as leftovers, to sell elsewhere.' }),
            el('button', { type: 'button', text: 'Yes, cancel it', onclick: () => {
                this.cancelAsk = null;
                if (this.handlers.onTradeCancel) this.handlers.onTradeCancel(v.key);
            } }),
            el('button', { type: 'button', text: 'Keep it', onclick: () => {
                this.cancelAsk = null;
                again();
            } }),
        ]);
    }

    /** "Torn API calls in the last minute: 12 of 70", every tab together. */
    renderApiUse() {
        if (!this.apiUseEl) return;
        const s = this.handlers.getApiUse ? this.handlers.getApiUse() : null;
        const text = s ? 'Torn API calls in the last minute: ' + s.usedLastMinute + ' of 70 (all tabs; Torn allows 100).' : '';
        if (this.apiUseEl.textContent !== text) this.apiUseEl.textContent = text;
    }

    /** My bazaar, scrolled to one part: 'graph' (IMA was pressed) or 'lows' (BP). */
    showBazaarPart(part) {
        const target = part === 'sell' ? this.bzSellEl : part === 'lows' ? this.bzDetailEl.querySelector('.ttv2-lows') : this.bzDetailEl.querySelector('.ttv2-windows');
        if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
    }

    /** Settings, scrolled to the Fill part (Torn's links bar asks for it). */
    openFillSettings() {
        this.showPage('settings');
        if (this.fillSectionEl && this.fillSectionEl.scrollIntoView) this.fillSectionEl.scrollIntoView({ block: 'start' });
    }

    /** Fill settings changed elsewhere: redraw the form from what is stored. */
    syncFill() {
        if (this.fillForm) this.fillForm.sync();
    }

    /**
     * Torn's API Terms of Service require any tool that takes a key to state,
     * in this table form and where the key is entered, how it uses the key.
     */
    buildTosTable() {
        const rows = [
            ['Data storage', 'Only locally, in this browser'],
            ['Data sharing', 'Nobody'],
            ['Purpose of use', 'Competitive advantage: finding Bazaar and Item Market listings below NPC or market value, and filling your own listing prices'],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            [
                'Key access level',
                'Public (torn: items, cityshops; market: itemmarket; key: info; user: profile, for bazaar owners\' public status; user: basic, your own id, so Fill never undercuts you)',
            ],
            [
                'Other services',
                'TornW3B (weav3r.dev) for bazaar prices. It receives item ids only, never your key.',
            ],
        ];

        const table = el('table', { class: 'ttv2-tos' });
        for (const [k, v] of rows) {
            table.appendChild(el('tr', {}, [el('th', { text: k }), el('td', { text: v })]));
        }

        return el('div', {}, [table]);
    }

    /**
     * Reflect key status without ever showing the key itself.
     * @param {object} info - { hasKey, accessName, overScoped }
     */
    setKeyState({ hasKey, accessName, overScoped }) {
        const had = this.hasKey;
        this.hasKey = Boolean(hasKey);
        if (!this.keyStateEl) return;

        // Terms expanded while there is no key; folded (still one click
        // away, right under the field) once one is saved.
        if (this.tosEl && had !== this.hasKey) this.tosEl.open = !this.hasKey;

        this.keyStateEl.classList.remove('ttv2-ok', 'ttv2-bad');

        if (!hasKey) {
            this.keyStateEl.textContent = 'No key saved.';
            return;
        }

        if (overScoped) {
            this.keyStateEl.textContent =
                'Saved. This key has ' + (accessName || 'more than Public') + ' access; Public is enough.';
            this.keyStateEl.classList.add('ttv2-bad');
            return;
        }

        this.keyStateEl.textContent = accessName ? 'Saved · ' + accessName + ' access.' : 'Saved.';
        this.keyStateEl.classList.add('ttv2-ok');
    }

    emitSettings(partial) {
        this.state.settings = { ...this.state.settings, ...partial };
        if (this.liveFeedInput) this.liveFeedInput.disabled = Boolean(this.state.settings.saveCalls);
        if (this.saveCallsInput && partial.saveCalls !== undefined) this.saveCallsInput.checked = Boolean(partial.saveCalls);
        this.syncChips();
        if (this.handlers.onSettingsChange) this.handlers.onSettingsChange(partial);
    }

    /* ------------------------------------------------------------- chrome */

    /**
     * Drag by the header; the position is remembered. A press that does not
     * move is a click: on a collapsed panel it expands it.
     */
    enableDrag(handle) {
        let start = null;

        handle.style.touchAction = 'none';

        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest && event.target.closest('button, a, input')) return;

            const rect = this.root.getBoundingClientRect();
            start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
            handle.setPointerCapture(event.pointerId);
        });

        handle.addEventListener('pointermove', (event) => {
            if (!start) return;

            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (!start.moved && Math.abs(dx) + Math.abs(dy) < 4) return;

            start.moved = true;
            this.placeAt(start.left + dx, start.top + dy);
        });

        const end = (event) => {
            if (!start) return;
            const { moved } = start;
            start = null;

            if (handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) {
                handle.releasePointerCapture(event.pointerId);
            }

            if (moved) {
                const rect = this.root.getBoundingClientRect();
                this.emitSettings({ panelPos: { left: Math.round(rect.left), top: Math.round(rect.top) } });
            } else if (this.collapsed) {
                this.setCollapsed(false, { save: true });
            }
        };

        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }

    /** Put the panel's top-left corner here: on screen, and never over Torn's content. */
    placeAt(left, top) {
        this.fit();
        const rect = this.root.getBoundingClientRect();
        const minLeft = this.minLeft || 0;
        const maxLeft = Math.max(minLeft, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, 60));

        this.root.style.left = Math.min(Math.max(minLeft, left), maxLeft) + 'px';
        this.root.style.top = Math.min(Math.max(0, top), maxTop) + 'px';
        this.root.style.right = 'auto';
        this.root.style.bottom = 'auto';
    }

    /** Restore a saved position, or the default bottom-right corner. */
    applyPosition(pos) {
        if (!this.root) return;

        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            this.placeAt(pos.left, pos.top);
            return;
        }

        this.root.style.left = '';
        this.root.style.top = '';
        this.root.style.right = '';
        this.root.style.bottom = '';
        this.fit();
    }

    clampIntoView() {
        this.fit();
        if (!this.root || !this.root.style.left) return;
        const rect = this.root.getBoundingClientRect();
        this.placeAt(rect.left, rect.top);
    }

    /**
     * The panel floats in front of the page, but only in the empty space to
     * the right of Torn's content: it is sized to that space (up to its usual
     * 430px) and can never be placed or dragged across Torn's content. Torn's
     * page itself is never touched. Where that space is narrower than usual,
     * the header, the filter chips and the tabs stay one row each, in smaller
     * steps of type and spacing - nothing is cut short. With less than
     * FIT_MIN_WIDTH of room (a very narrow window) there is nowhere it would
     * not cover Torn: it takes its smallest size at the window's edge, so it
     * covers as little as it can (3.20; it floated at its full 430px).
     */
    fit() {
        if (!this.root) return;
        const doc = this.root.ownerDocument || document;
        // Torn's page: its content column and its sidebar.
        const parts = [doc.querySelector('.content-wrapper'), doc.getElementById('sidebarroot'), doc.getElementById('sidebar')].filter(Boolean);
        const rects = parts.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        const contentRight = rects.length ? Math.max(...rects.map((r) => r.right)) : 0;
        // Its resting place is 16px from the window's right edge (styles.js),
        // and it keeps FIT_GAP clear of Torn's content on the left.
        const free = Math.floor(window.innerWidth - contentRight - FIT_GAP - 16);

        let width = PANEL_WIDTH;
        this.minLeft = 0;
        if (rects.length && free >= FIT_MIN_WIDTH) {
            width = Math.min(PANEL_WIDTH, free);
            this.minLeft = Math.ceil(contentRight + FIT_GAP);
        } else if (rects.length) {
            width = FIT_SMALLEST;
        }
        this.root.style.setProperty('--fit-width', width + 'px');

        // One row, always: in less room, smaller type and tighter spacing,
        // one step at a time, measured - never cut, never wrapped.
        this.root.classList.toggle('ttv2-narrow', width < TWO_ROW_BELOW);
        this.root.classList.remove('ttv2-tight');
        this.root.style.removeProperty('--fit-right');
        // The header, the filter chips and the tabs: each is one row.
        const rows = [this.headEl, this.chipsEl, this.tabsEl].filter(Boolean);
        const overBy = () => Math.max(0, ...rows.map((row) => (row.clientWidth ? row.scrollWidth - row.clientWidth : 0)));
        const overflows = () => overBy() > 1;
        this.root.classList.remove('ttv2-tighter');
        if (this.root.classList.contains('ttv2-narrow') && overflows()) this.root.classList.add('ttv2-tight');
        if (this.root.classList.contains('ttv2-tight') && overflows()) this.root.classList.add('ttv2-tighter');

        // Still a few pixels short: borrow them from the window-edge margin
        // first, then from the gap - never more than the gap, so the panel
        // still never crosses Torn's content. Still one row, nothing cut.
        // A panel you dragged keeps its left edge and grows to the right,
        // and clampIntoView keeps it on screen and clear of Torn's content.
        if (overflows()) {
            const extra = overBy();
            const fromEdge = Math.min(extra, 12);
            const fromGap = this.minLeft ? Math.min(extra - fromEdge, FIT_GAP - 2) : extra - fromEdge;
            this.root.style.setProperty('--fit-width', width + fromEdge + fromGap + 'px');
            this.root.style.setProperty('--fit-right', 16 - fromEdge + 'px');
            this.minLeft = Math.max(0, this.minLeft - fromGap);
        }
    }

    setCollapsed(collapsed, { save = false } = {}) {
        this.collapsed = Boolean(collapsed);
        if (!this.root) return;

        this.root.classList.toggle('ttv2-collapsed', this.collapsed);
        this.collapseBtn.textContent = this.collapsed ? '+' : '–';
        this.collapseBtn.setAttribute('aria-label', this.collapsed ? 'Expand' : 'Collapse');
        this.collapseBtn.title = (this.collapsed ? 'Expand' : 'Collapse') + ' (`)';

        this.renderBar();
        this.clampIntoView();

        if (save && this.handlers.onSettingsChange) {
            this.handlers.onSettingsChange({ collapsed: this.collapsed });
        }
    }

    toggleCollapsed() {
        this.setCollapsed(!this.collapsed, { save: true });
    }

    /**
     * The bazaar owner line. null hides it.
     * @param {{name: string|null, level: string, text: string, closed: boolean}|null} info
     */
    setSeller(info) {
        if (!this.sellerEl) return;
        this.sellerEl.textContent = '';
        this.sellerEl.classList.toggle('ttv2-shown', Boolean(info));
        if (!info) return;

        this.sellerEl.appendChild(document.createTextNode('Seller: '));
        this.sellerEl.appendChild(el('b', { text: info.name || 'this bazaar' }));
        this.sellerEl.appendChild(this.statusWord(info.level, info.text));
        if (info.closed) {
            this.sellerEl.appendChild(el('span', { class: 'ttv2-closed', text: 'Bazaar closed' }));
        }
        this.sellerEl.title = this.sellerEl.textContent;
    }

    /**
     * ` shows and hides the panel, from anywhere on the page - except while
     * typing (chat, search, quantity boxes, our own fields), and never with
     * Ctrl / Alt / Cmd held.
     */
    enableHotkey(target = document) {
        if (this.hotkeyHandler) return;
        this.hotkeyHandler = (event) => {
            if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
            if (isTypingTarget(event)) return;
            if (!this.root) return;
            // N: the buying run's Next (one key, one page) - only on a bazaar
            // you are buying from for the trade, never a stray key elsewhere.
            if ((event.key === 'n' || event.key === 'N') && this.buyHereActive && this.buyNextBtn && this.buyNextBtn.isConnected && this.buyBoxEl.style.display !== 'none') {
                event.preventDefault();
                this.buyNextBtn.click();
                return;
            }
            if (event.key !== '`') return;
            event.preventDefault();
            this.setCollapsed(!this.collapsed, { save: true });
        };
        this.hotkeyTarget = target;
        target.addEventListener('keydown', this.hotkeyHandler);
    }

    /**
     * Play the scan animation: the Scan button pulses and a line sweeps
     * under the header. Restarts if a scan lands mid-animation.
     *
     * @param {string} [message] - result line for the status bar
     */
    showScan(message) {
        if (!this.root) return;

        this.root.classList.remove('ttv2-scanning');
        // Force a reflow so the CSS animation starts over.
        void this.root.offsetWidth;
        this.root.classList.add('ttv2-scanning');

        clearTimeout(this.scanTimer);
        this.scanTimer = setTimeout(() => {
            if (this.root) this.root.classList.remove('ttv2-scanning');
        }, SCAN_ANIMATION_MS);

        if (message) this.setStatus(message);
    }

    setBusy(busy) {
        this.state.busy = Boolean(busy);
        if (!this.scanBtn) return;

        // Scan is the one refresh button: disabled while it works (its label
        // stays, so the header never changes width).
        this.scanBtn.disabled = this.state.busy;
        this.renderBar();
    }

    /**
     * A message for the status line. Info clears itself after a few seconds
     * and gives the line back to the summary; warnings and errors stay until
     * replaced.
     */
    setStatus(text, level = 'info') {
        this.state.status = { text: text || '', level, at: Date.now() };
        this.renderBar();
    }

    applySettings(settings) {
        this.state.settings = { ...this.state.settings, ...settings };
        if (!this.root) return;

        this.syncChips();

        if (this.saveCallsInput && settings.saveCalls !== undefined) {
            this.saveCallsInput.checked = Boolean(settings.saveCalls);
        }
        // Saving calls overrides watching: its tick box shows it cannot be on.
        if (this.liveFeedInput) this.liveFeedInput.disabled = Boolean(this.state.settings.saveCalls);
        if (this.liveFeedInput && settings.liveFeed !== undefined) {
            this.liveFeedInput.checked = Boolean(settings.liveFeed);
        }
        if (this.resaleMinInput && settings.resaleMinPct !== undefined && !(this.shadow && this.shadow.activeElement === this.resaleMinInput)) {
            this.resaleMinInput.value = String(settings.resaleMinPct);
        }
        if (this.useW3bInput && settings.useW3b !== undefined) {
            this.useW3bInput.checked = Boolean(settings.useW3b);
        }
        if (this.newTabInput && settings.openInNewTab !== undefined) {
            this.newTabInput.checked = settings.openInNewTab !== false;
        }
        if (settings.collapsed !== undefined) this.setCollapsed(settings.collapsed);
        if (settings.panelPos !== undefined) this.applyPosition(settings.panelPos);
    }

    syncChips() {
        const s = this.state.settings;
        if (!this.chipNpc) return;

        this.chipNpc.setAttribute('aria-pressed', String(s.sellToNpc !== false));
        this.chipBazaar.setAttribute('aria-pressed', String(Boolean(s.resaleBazaar)));
        this.chipMarket.setAttribute('aria-pressed', String(Boolean(s.resaleMarket)));
        this.chipMin.textContent = this.chipMin.labelFor(s.minTotalProfit);
        this.chipCash.textContent = this.chipCash.labelFor(s.cashOnHand);
        this.chipCash.classList.toggle('ttv2-chip-set', Boolean(s.cashOnHand));
        this.chipMin.classList.toggle('ttv2-chip-set', Number(s.minTotalProfit) > 1);
        // "Min 0" can become "Min 1.5m": the row must still fit on one line.
        this.clampIntoView();
    }

    /* ------------------------------------------------------------ render */

    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        /*
         * Updated in place, not rebuilt: this runs every 2.5 s and on every
         * feed change, and emptying the list each time threw away keyboard
         * focus (on a Go button, say) and relaid out every row. A row is
         * drawn fresh (cheap, off the page) and kept only if it differs from
         * the one showing - its HTML as drawn, before refreshAges() fills in
         * the age, is its identity - so a price that moves is replaced at
         * once and everything else stays exactly where it is.
         */
        const rows = this.state.rows || [];
        const want = [];
        const kept = new Map();

        if (rows.length === 0) {
            const empty = this.renderEmpty();
            const html = empty.outerHTML;
            const old = this.shownEls && this.shownEls.get(html);
            want.push(old || empty);
            kept.set(html, old || empty);
        } else {
            want.push(this.colsEl);
            for (const row of rows) {
                const fresh = this.renderRow(row);
                const html = fresh.outerHTML;
                const old = this.shownEls && this.shownEls.get(html);
                const use = old && !kept.has(html) ? old : fresh;
                use.ttv2Row = row;
                if (!kept.has(html)) kept.set(html, use);
                want.push(use);
            }
        }

        want.forEach((node, i) => {
            const at = this.listEl.childNodes[i];
            if (at !== node) this.listEl.insertBefore(node, at || null);
        });
        while (this.listEl.childNodes.length > want.length) this.listEl.lastChild.remove();
        this.shownEls = kept;

        this.renderTabs();
        this.refreshAges();
    }

    renderTabs() {
        const tab = this.state.tab || 'bazaar';
        const counts = this.state.counts || {};

        for (const [key, btn] of Object.entries(this.tabBtns || {})) {
            const on = key === tab;
            btn.classList.toggle('ttv2-tab-on', on);
            btn.setAttribute('aria-selected', String(on));
            btn.textContent = btn.dataset.label + (counts[key] ? ' (' + counts[key] + ')' : '');
        }

        if (this.creditEl) {
            const live = this.state.live;
            this.creditEl.style.display = tab === 'bazaar' && live && live.w3b ? '' : 'none';
        }
    }

    /**
     * The one status line. Left: this list's deals and total - or a message.
     * Right: whether watching is live, and when it next refreshes.
     */
    renderBar() {
        if (!this.barEl) return;

        const now = Date.now();
        const st = this.state.status || {};
        const summary = this.state.summary || { count: 0, totalProfit: 0 };
        const headline =
            (summary.count === 1 ? '1 deal' : summary.count + ' deals') +
            ' · +' + formatMoneyShort(summary.totalProfit);

        const showMessage =
            st.text &&
            (st.level !== 'info' || this.state.busy || now - st.at < INFO_STATUS_MS);

        this.barLeft.textContent = showMessage ? st.text : headline;
        this.barLeft.title = showMessage
            ? st.text
            : summary.capped
              ? 'Total for what your cash buys, best deals first'
              : '';
        this.barEl.classList.toggle('ttv2-warn', showMessage && st.level === 'warn');
        this.barEl.classList.toggle('ttv2-error', showMessage && st.level === 'error');

        // Collapsed: the headline rides in the header - and a longer one may
        // need the tighter type to stay on one row.
        const mini = this.collapsed ? '· ' + headline : '';
        if (this.miniEl.textContent !== mini) {
            this.miniEl.textContent = mini;
            this.fit();
        }

        /* ---- liveness ---- */
        const live = this.state.live;
        let dot = 'off';
        let text = 'watching off';
        let title = 'Watching is off. Turn it on under Settings.';

        if (live && live.enabled) {
            if (!live.keyed) {
                dot = 'warn';
                text = 'needs key';
                title = 'Add a Public API key under Settings.';
            } else if (live.leading) {
                dot = live.lastError ? 'warn' : 'live';
                const secs = live.nextRefreshAt
                    ? Math.max(0, Math.ceil((live.nextRefreshAt - now) / 1000))
                    : null;
                text = 'live' + (secs !== null ? ' · ' + secs + 's' : '');
                title = live.lastError || 'Refreshes every 30 seconds.';
            } else {
                dot = 'other';
                text = 'live in another tab';
                title = 'Another visible Torn tab is watching. Results show here too.';
            }
        }

        this.barRight.textContent = '';
        this.barRight.appendChild(el('span', { class: 'ttv2-dot ttv2-dot-' + dot }));
        this.barRight.appendChild(document.createTextNode(text));
        this.barRight.title = title;
    }

    /**
     * An empty list says why, and offers the one thing that would help -
     * never a dead end.
     */
    renderEmpty() {
        const d = this.state.diagnostics;
        const live = this.state.live;
        const tab = this.state.tab;

        const box = (text, label, fn) => {
            const children = [el('div', { class: 'ttv2-empty-text', text })];
            if (label) {
                children.push(
                    el('button', { type: 'button', class: 'ttv2-primary', text: label, onclick: fn }),
                );
            }
            return el('div', { class: 'ttv2-empty' }, children);
        };

        if (!this.hasKey) {
            return box('Add a Public API key to start.', 'Add key', () =>
                this.showPage('settings', { focusKey: true }),
            );
        }

        if (!d && tab === 'bazaar' && live && !live.w3b) {
            return box('Bazaar watching is off.', 'Turn it on', () =>
                this.emitSettings({ useW3b: true }),
            );
        }

        // Saving API calls stops the Item Market only; bazaars stay watched.
        if (!d && tab !== 'bazaar' && this.state.settings.saveCalls) {
            return box('Saving API calls: the Item Market is not watched.', 'Stop saving', () =>
                this.emitSettings({ saveCalls: false }),
            );
        }

        if (!d && tab !== 'bazaar' && live && live.keyed && !live.itemMarket) {
            return box('Item Market watching is off.', 'Turn it on', () =>
                this.emitSettings({ liveFeed: true }),
            );
        }

        if (!d && live && !live.enabled) {
            return box('Watching is off. Only this page is scanned.', 'Turn it on', () =>
                this.emitSettings({ liveFeed: true, useW3b: true }),
            );
        }

        const s = this.state.settings;

        if (s.sellToNpc === false && !s.resaleBazaar && !s.resaleMarket) {
            return box('Pick where to sell first.', 'Sell to NPC', () =>
                this.emitSettings({ sellToNpc: true }),
            );
        }

        const why = this.filterReason();
        if (why) return box(why.text, why.label, why.fn);

        return box(this.emptyReason(), 'Refresh now', () =>
            this.handlers.onScan && this.handlers.onScan(),
        );
    }

    /**
     * An empty list because of Cash / Min, said plainly - with the return
     * the two together demand. $1m cash and a $1m Min means doubling your
     * money, which almost never happens, and the list must say so rather
     * than look broken.
     */
    filterReason() {
        const s = this.state.settings || {};
        const h = this.state.hidden || {};
        const cash = Number(s.cashOnHand) || 0;
        const min = Number(s.minTotalProfit) || 0;
        const lines = [];

        if (h.cash) {
            lines.push(
                h.cash + (h.cash === 1 ? ' deal' : ' deals') + ' hidden: ' +
                    formatMoneyShort(cash) + ' cash cannot buy enough.',
            );
        }
        if (h.min) {
            lines.push(
                h.min + (h.min === 1 ? ' deal makes' : ' deals make') + ' less than your Min of ' +
                    formatMoneyShort(min) + '.',
            );
        }
        if (cash > 0 && min > 1 && min / cash >= 0.2) {
            lines.push(
                'A ' + formatMoneyShort(min) + ' Min on ' + formatMoneyShort(cash) + ' cash needs a ' +
                    Math.round((min / cash) * 100) + '% return.',
            );
        }
        if (!lines.length) return null;

        if (min > 1) {
            return { text: lines.join(' '), label: 'Set Min to $1', fn: () => this.emitSettings({ minTotalProfit: 1 }) };
        }
        return { text: lines.join(' '), label: 'Clear cash', fn: () => this.emitSettings({ cashOnHand: null }) };
    }

    emptyReason() {
        const d = this.state.diagnostics;
        const live = this.state.live;
        const tab = this.state.tab;

        if (!d) {
            if (live && live.enabled && live.leading) {
                return tab === 'bazaar'
                    ? 'Watching bazaars. Nothing profitable right now.'
                    : 'Watching the Item Market. Nothing profitable right now.';
            }
            if (live && live.enabled) {
                return 'Watching runs in another Torn tab. Results show here.';
            }
            return 'Nothing yet.';
        }

        if (d.images === 0) {
            return 'No item images found on this page.';
        }

        if (d.listings === 0 && d.cards > 0) {
            if (d.noItem === d.cards) {
                return d.cards + ' listings found, none in the item database.';
            }
            return d.cards + ' listings found, no price readable.';
        }

        if (d.priceAssumed > 0) {
            return 'Nothing above Min. ' + d.priceAssumed + ' rows hidden: price guessed.';
        }

        return tab === 'bazaar'
            ? 'No bazaar deals right now.'
            : 'No Item Market deals right now.';
    }

    /**
     * One deal, two lines:
     *
     *     Xanax ×390                                       +$11,255
     *     $838,745 → NPC $850,000 · Garrett89 ● Offline 3h      40s
     *                                                          [Go]
     *
     * Everything goes in through textContent; names from Torn or TornW3B
     * never touch innerHTML.
     */
    renderRow(row) {
        const p = row.profit;
        const venue = VENUE_LABELS[p.venue] || p.venue;
        const known = row.qtyAtPrice !== false;

        /* ---- line 1: name ×qty, profit ---- */
        const name = el('div', { class: 'ttv2-row-name' }, [
            document.createTextNode(row.name),
            known && (p.affordableQty > 1 || p.affordableQty < p.qty)
                ? el('span', {
                      class: 'ttv2-qty',
                      text: '×' + p.affordableQty.toLocaleString('en-US') +
                          (p.affordableQty < p.qty ? ' of ' + p.qty.toLocaleString('en-US') : ''),
                  })
                : null,
        ]);

        // The age sits under the profit, so the details line keeps its room.
        const profit = el('div', {
            class: 'ttv2-row-profit ttv2-money',
            title: formatMoney(p.profitPerUnit) + ' each · ROI ' + formatPct(p.roi),
        }, [
            document.createTextNode('+' + formatMoney(known ? p.realizableProfit : p.profitPerUnit) + (known ? '' : ' each')),
            el('span', { class: 'ttv2-per' }, [row.el ? 'on this page' : el('span', { class: 'ttv2-age' })]),
        ]);

        /* ---- line 2: prices, seller, age ---- */
        const details = el('div', { class: 'ttv2-row-details' });
        const sep = () => document.createTextNode(' · ');

        details.appendChild(el('b', { text: formatMoney(p.listingPrice) }));
        if (row.priceAssumed) {
            details.appendChild(el('span', {
                class: 'ttv2-guess',
                title: 'More than one price on the card. The lowest was taken.',
                text: '?',
            }));
        }
        details.appendChild(document.createTextNode(' → ' + venue + ' '));
        details.appendChild(el('b', { text: formatMoney(p.exitPrice) }));

        if (row.source === 'bazaar') {
            const statuses = this.state.statuses;
            const status = statuses && row.sellerId ? statuses.get(String(row.sellerId)) : null;
            const sellerName = row.sellerName || (status && status.name) || null;
            if (sellerName) {
                details.appendChild(sep());
                details.appendChild(el('b', { text: sellerName }));
                if (status) {
                    const word = this.statusWord(status.level, status.text);
                    word.title = (sellerName ? sellerName + ': ' : '') + status.title;
                    details.appendChild(word);
                }
            }
        }

        if (!known) {
            details.appendChild(sep());
            details.appendChild(el('span', {
                class: 'ttv2-guess',
                title: 'Torn shows only the cheapest price. Open the item for stock.',
                text: 'qty unknown',
            }));
        }

        /* ---- the one action ---- */
        const go = el('button', {
            type: 'button',
            class: 'ttv2-go',
            title: row.el
                ? 'Scroll to this listing'
                : row.source === 'bazaar'
                  ? 'Open this bazaar'
                  : 'Open on the Item Market',
            text: row.el ? 'Show' : 'Go',
            // The row as last drawn: a kept element is handed each new row
            // (Torn may have replaced the card it points at since).
            onclick: () => this.handlers.onNavigate && this.handlers.onNavigate(rowEl.ttv2Row || row),
        });

        const rowEl = el('div', { class: 'ttv2-row' }, [name, profit, details, go]);
        rowEl.ttv2Row = row;
        rowEl.dataset.ttv2At = String(this.rowTime(row) || '');
        if (row.el) rowEl.classList.add('ttv2-onpage');

        return rowEl;
    }

    /** "● Online" for a player: an 8px dot and a word. */
    statusWord(level, text) {
        const word = el('span', { class: 'ttv2-status', text: text || '' });
        word.dataset.level = level || 'unknown';
        return word;
    }

    /** When the data behind a row was true - not when we last looked. */
    rowTime(row) {
        if (row.fromFeed) return row.dataAt;
        return row.seenAt || null;
    }

    refreshAges() {
        if (!this.root) return;

        const now = Date.now();

        // Just the age. Nothing is greyed out: a listing the latest refresh
        // did not confirm is removed, not faded.
        for (const rowEl of this.listEl.querySelectorAll('.ttv2-row')) {
            const at = Number(rowEl.dataset.ttv2At);
            const ageEl = rowEl.querySelector('.ttv2-age');
            const known = Number.isFinite(at) && at > 0;
            if (ageEl) ageEl.textContent = known ? formatAge(now - at).replace(' ago', '') : 'age unknown';
        }

        this.renderBar();
    }

    /* --------------------------------------------------------- my bazaar */

    /**
     * Your own bazaar's add / manage page: each item's Item Market Average,
     * and for the one picked, that number large with its graph.
     *
     * @param {object|null} view - null leaves the view
     *   items: [{ itemId, name, avg }] - avg: Torn's market value
     *   selected: itemId
     *   avgAt: when the averages were fetched
     *   series: from core/history.js series()
     *   windowKey: '24h' | '7d' | '30d'
     */
    renderMyBazaar(view) {
        this.state.bazaar = view;
        if (!this.root) return;

        if (!view) {
            this.bzSig = null;
            this.bzIds = null;
            this.renderBazaarSell(null);
            if (this.page === 'mybazaar') this.showPage('list');
            return;
        }
        this.renderBazaarSell(view.sell || null);
        if (this.page === 'list') this.showPage('mybazaar');
        if (this.page === 'mybazaar' && this.titleTextEl.textContent !== (view.title || 'My bazaar')) this.titleTextEl.textContent = view.title || 'My bazaar';

        const updated = view.avgAt ? 'What it sold for, on average · updated ' + formatAge(Date.now() - view.avgAt) + '.' : 'What it sold for, on average.';

        /*
         * The list of items: built once for the items on the page, then kept -
         * a price that changes is written into its own row, and picking an
         * item moves the highlight (3.22.0). It was built again, every row of
         * it, whenever anything on this page changed - each Fill, each price
         * read: on a page of 1,500 items that is 1,500 buttons a time, a
         * stall of a tenth of a second and more.
         */
        const list = this.bzListEl;
        const ids = (view.lowLabel || '') + '|' + view.items.map((i) => i.itemId).join(',');
        if (ids !== this.bzIds || !this.bzRowEls) {
            this.bzIds = ids;
            this.bzRowEls = new Map();
            this.bzPicked = null;
            list.textContent = '';
            if (!view.items.length) {
                list.appendChild(el('div', { class: 'ttv2-note', text: 'No items found on this page yet.' }));
            } else {
                list.appendChild(el('div', { class: 'ttv2-bzrow ttv2-bzhead' }, [
                    el('span', { class: 'ttv2-label', text: 'Item' }),
                    el('span', { class: 'ttv2-label ttv2-money', text: 'IM average' }),
                    el('span', { class: 'ttv2-label ttv2-money', text: view.lowLabel || 'Lowest' }),
                ]));
                for (const it of view.items) {
                    const avgEl = el('span', { class: 'ttv2-money' });
                    const lowEl = el('span', { class: 'ttv2-money ttv2-bzlow' });
                    const btn = el('button', {
                        type: 'button',
                        class: 'ttv2-bzrow',
                        'aria-pressed': 'false',
                        title: 'Show its prices and graph',
                        onclick: () => this.handlers.onSelectBazaarItem && this.handlers.onSelectBazaarItem(it.itemId),
                    }, [el('span', { class: 'ttv2-name', text: it.name }), avgEl, lowEl]);
                    this.bzRowEls.set(it.itemId, { btn, avgEl, lowEl, avg: undefined, low: undefined });
                    list.appendChild(btn);
                }
            }
        }
        for (const it of view.items) {
            const rec = this.bzRowEls.get(it.itemId);
            if (!rec) continue;
            if (rec.avg !== it.avg) {
                rec.avg = it.avg;
                rec.avgEl.textContent = it.avg ? formatMoney(it.avg) : '…';
            }
            if (rec.low !== it.low) {
                rec.low = it.low;
                rec.lowEl.textContent = it.low ? formatMoney(it.low) : '…';
            }
        }
        if (this.bzPicked !== view.selected) {
            const was = this.bzRowEls.get(this.bzPicked);
            const now = this.bzRowEls.get(view.selected);
            if (was) was.btn.setAttribute('aria-pressed', 'false');
            if (now) now.btn.setAttribute('aria-pressed', 'true');
            this.bzPicked = view.selected;
        }

        // The item picked: redrawn only when what it shows changes - the helper repaints
        // every few seconds, and a redraw would drop the graph's hover readout.
        const s = view.series;
        const f = view.fill;
        const sel = view.items.find((i) => i.itemId === view.selected);
        const sig = JSON.stringify([
            sel || null,
            view.items.length,
            view.windowKey,
            view.mark,
            f ? [f.lists, f.preview, f.filled, f.canFill] : null,
            s ? [s.points.length, s.points[s.points.length - 1], s.mv.length, s.mv[s.mv.length - 1], Math.floor(s.to / 300000)] : null,
        ]);
        if (sig === this.bzSig && this.bzUpdatedEl) {
            this.bzUpdatedEl.textContent = updated;
            return;
        }
        this.bzSig = sig;

        const detail = this.bzDetailEl;
        detail.textContent = '';
        if (!sel) return;

        /* the answer first: one big number, what it is, how fresh */
        detail.appendChild(el('div', { class: 'ttv2-bzhero' }, [
            el('h3', { text: sel.name }),
            el('div', { class: 'ttv2-label', text: 'Item Market Average' }),
            el('div', { class: 'ttv2-bzavg', text: sel.avg ? formatMoney(sel.avg) : 'Loading…' }),
            (this.bzUpdatedEl = el('div', { class: 'ttv2-note', text: updated })),
        ]));

        /* Fill: what it typed, or what it would type */
        if (f) {
            const shown = f.filled ? f.filled.price : f.preview ? f.preview.price : null;
            const verdict = f.preview && f.preview.verdict && !f.filled ? f.preview.verdict : null;
            const own = f.lists[f.market];
            const box = el('div', { class: 'ttv2-fillnow' + (f.filled ? ' ttv2-fillnow-done' : '') }, [
                el('div', { class: 'ttv2-label', text: f.filled ? 'Filled in its row' : 'Fill would type' }),
                el('div', { class: 'ttv2-fillprice', text: shown ? formatMoney(shown) : own && own.state === 'ok' ? 'Nothing to undercut' : 'Reading prices…' }),
                verdict && verdict.text
                    ? el('div', { class: 'ttv2-note ttv2-verdict', 'data-level': verdict.level || '', text: verdict.text + (f.preview.floor === 'npc' ? ' · held at the NPC price' : f.preview.floor === 'avg' ? ' · held at the average' : '') })
                    : null,
                // Filled: what Fill said about it, in full. On #/add the row
                // has room for the tick only, so this is where it is read.
                f.filled && f.filled.words
                    ? el('div', { class: 'ttv2-note ttv2-verdict', 'data-level': f.filled.level === 'warn' ? 'warn' : f.filled.level || '', text: f.filled.words.replace(/^Filled \$[\d,]+( · )?/, '') || 'Filled.' })
                    : null,
                f.canFill && !f.filled && shown
                    ? el('button', { type: 'button', class: 'ttv2-primary ttv2-fillgo', text: 'Fill its row', onclick: () => this.handlers.onFillSelected && this.handlers.onFillSelected() })
                    : null,
            ]);
            detail.appendChild(box);

            /* the lowest listings on both markets; a price you press is undercut */
            const lists = el('div', { class: 'ttv2-lows' });
            for (const [m, title] of [['bazaar', 'Bazaars · cheapest 5'], ['market', 'Item Market · cheapest 5']]) {
                const L = f.lists[m] || { state: 'loading', rows: [] };
                const col = el('div', { class: 'ttv2-lowcol' }, [el('div', { class: 'ttv2-label', text: title })]);
                if (L.state === 'loading') col.appendChild(el('div', { class: 'ttv2-note', text: 'Loading…' }));
                else if (L.state === 'nokey') col.appendChild(el('div', { class: 'ttv2-note', text: 'Needs your key.' }));
                else if (L.state === 'error') col.appendChild(el('div', { class: 'ttv2-note ttv2-bad', text: L.error || 'Could not load.' }));
                else if (!L.rows.length) col.appendChild(el('div', { class: 'ttv2-note', text: 'None listed.' }));
                (L.rows || []).forEach((r, i) => {
                    const sub = [];
                    if (r.mine) sub.push('you');
                    else if (r.name) sub.push(r.name);
                    sub.push('×' + Number(r.qty || 0).toLocaleString('en-US'));
                    if (r.net) sub.push(formatMoney(r.net) + ' after fee');
                    if (r.stale) sub.push('not seen 30m');
                    if (r.troll) sub.push('far under the average');
                    const skip = r.mine || r.troll || r.stale;
                    col.appendChild(el('button', {
                        type: 'button',
                        class: 'ttv2-lowrow' + (r.mine ? ' ttv2-lowmine' : '') + (r.stale || r.troll ? ' ttv2-lowstale' : ''),
                        disabled: skip || !f.canFill ? '' : null,
                        title: r.mine ? 'Your own listing: never undercut' : r.troll ? 'Far under the average: never undercut' : r.stale ? 'Not seen for 30 minutes: never undercut' : f.canFill ? 'Undercut this one in the item\'s row' : '',
                        onclick: () => this.handlers.onFillListing && this.handlers.onFillListing(m, i),
                    }, [el('b', { class: 'ttv2-money', text: formatMoney(r.price) }), el('span', { class: 'ttv2-lowsub', text: sub.join(' · ') })]));
                });
                if (L.note) col.appendChild(el('div', { class: 'ttv2-note', text: L.note }));
                lists.appendChild(col);
            }
            detail.appendChild(lists);
        }

        /* the graph, with its window */
        const windows = el('div', { class: 'ttv2-windows', role: 'group', 'aria-label': 'Graph window' });
        for (const key of ['24h', '7d', '30d']) {
            windows.appendChild(el('button', {
                type: 'button',
                class: 'ttv2-window',
                'aria-pressed': String(key === view.windowKey),
                text: key,
                onclick: () => this.handlers.onBazaarWindow && this.handlers.onBazaarWindow(key),
            }));
        }
        detail.appendChild(windows);

        if (view.series) detail.appendChild(renderPriceGraph(view.series, { width: 404, height: 160, mark: view.mark }));
        detail.appendChild(el('div', { class: 'ttv2-graph-keys' }, [
            el('span', { class: 'ttv2-key-mv' }, [el('i'), 'Item Market Average']),
            el('span', { class: 'ttv2-key-im' }, [el('i'), 'Lowest listing we saw']),
            view.mark ? el('span', { class: 'ttv2-key-mark' }, [el('i'), 'Price to list']) : null,
        ]));
    }

    /**
     * My bazaar › what you bought and have not sold (3.22.0; the add page):
     * each item with how many and what you paid, where it stands - filled,
     * passed over (the price would be under what you paid), ready, or not in
     * the list Torn has drawn - and one Fill all, the same as the bar on the
     * page. Redrawn only when it changes.
     *
     * @param {object|null} s - {rows: [{itemId, name, qty, paid, source, why, state, price, low}], words: {button, title, pressed, disabled, note}, logAt}
     */
    renderBazaarSell(s) {
        const box = this.bzSellEl;
        if (!box) return;
        const sig = s ? JSON.stringify([s.rows, s.words, s.logAt ? Math.floor((Date.now() - s.logAt) / 60000) : null]) : '';
        if (sig === this.bzSellSig) return;
        this.bzSellSig = sig;
        box.textContent = '';
        box.style.display = s ? '' : 'none';
        if (!s) return;
        box.appendChild(el('div', { class: 'ttv2-bzsellh' }, [
            el('span', { class: 'ttv2-label', text: 'Bought, not sold' }),
            el('button', {
                type: 'button',
                class: 'ttv2-primary ttv2-bzsellgo',
                'aria-pressed': String(Boolean(s.words.pressed)),
                disabled: s.words.disabled ? '' : null,
                title: s.words.title,
                text: s.words.button,
                onclick: () => this.handlers.onFillAllBought && this.handlers.onFillAllBought(),
            }),
        ]));
        for (const r of s.rows) {
            const gain = r.price && r.paid ? r.price - r.paid : null;
            const wouldLose = r.state === 'ready' && r.low && r.paid && r.low - 1 < r.paid;
            const status = r.state === 'filled'
                ? '✓ ' + formatMoney(r.price) + (gain !== null ? ' (' + (gain >= 0 ? '+' : '−') + formatMoney(Math.abs(gain)) + ')' : '')
                : r.state === 'skipped'
                    ? 'passed over: ' + formatMoney(r.price) + ' is under'
                    : r.state === 'norow'
                        ? 'not in this list'
                        : r.low
                            ? 'lowest ' + formatMoney(r.low) + (wouldLose ? ' · under' : '')
                            : 'ready';
            box.appendChild(el('button', {
                type: 'button',
                class: 'ttv2-bzsellrow',
                title: 'Show its prices and graph',
                onclick: () => this.handlers.onSelectBazaarItem && this.handlers.onSelectBazaarItem(r.itemId),
            }, [
                el('span', { class: 'ttv2-name', text: r.name + ' ×' + Number(r.qty).toLocaleString('en-US') }),
                el('span', { class: 'ttv2-bzsellst', 'data-state': wouldLose || (r.state === 'filled' && gain !== null && gain < 0) ? 'loss' : r.state, text: status }),
                el('small', { text: (r.paid ? 'paid ' + formatMoney(r.paid) + ' each' : 'cost not known') + ' · ' + (r.source === 'tosell' ? 'To sell' + (r.why ? ' (' + r.why + ')' : '') : 'bought in the last 24 h') }),
            ]));
        }
        const from = s.logAt
            ? 'Your To sell list, and your log as Torn Bids read it ' + formatAge(Date.now() - s.logAt) + '.'
            : 'Your To sell list only. With the Ledger\'s Full key in Torn Bids, every buy of the last 24 hours is here.';
        box.appendChild(el('div', { class: 'ttv2-note', text: s.words.note + '. ' + from }));
    }

    destroy() {
        if (this.ticker) clearInterval(this.ticker);
        if (this.fitObserver) this.fitObserver.disconnect();
        clearTimeout(this.scanTimer);
        if (this.hotkeyHandler && this.hotkeyTarget) {
            this.hotkeyTarget.removeEventListener('keydown', this.hotkeyHandler);
            this.hotkeyHandler = null;
        }
        if (this.host && this.host.parentNode) {
            this.host.parentNode.removeChild(this.host);
        }
        this.root = null;
    }
}
