/*
 * The panel: a floating window with two pages - the list, and Settings.
 *
 *   header      title, and three icon buttons: refresh, settings, collapse
 *   status bar  ONE line: "5 deals · +$5.18m"  ...  "● live · refresh 12s"
 *   list page   sell-to chips, Bazaars / Item Market tabs, ranked cards
 *   settings    replaces the list (with Back) - never stacks on top of it
 *
 * The redesign answers specific complaints: Settings opened inline and
 * drowned the list; three status strips said the same thing; Clear and
 * Filter were buttons that did nothing lasting; collapse felt random and
 * the panel forgot where it was put. Every button now has one clear job,
 * shows its state, and every click does something visible.
 *
 * Nothing goes on Torn's item cards beyond one class; every number lives
 * here. All text goes in through textContent - names from Torn or TornW3B
 * never touch innerHTML. The panel is in a shadow root (see mount()).
 */

import {
    formatMoney,
    formatMoneyShort,
    formatPct,
    formatAge,
} from '../core/parse.js';
import { VENUE_LABELS } from '../core/profit.js';
import { W3B_TERMS_URL, W3B_SITE_URL } from '../api/w3b.js';
import { panelStyleElement } from './styles.js';

/** "last update 2m ago" turns the status amber after this. */
export const PANEL_STALE_MS = 60000;

export const TORN_API_KEY_URL = 'https://www.torn.com/preferences.php#tab=api';

/** Info messages ("Ready.") clear themselves; warnings and errors stay. */
const INFO_STATUS_MS = 6000;

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== null && value !== undefined) {
            node.setAttribute(key, String(value));
        }
    }

    for (const child of [].concat(children)) {
        if (child) node.appendChild(child);
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
                    panel.setStatus(
                        label + ' failed: ' + describeError(error),
                        'error',
                    );
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

function numberFromInput(value, fallback) {
    const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

/** Long enough to see, short enough not to get in the way. */
const SCAN_ANIMATION_MS = 800;

export class Panel {
    /**
     * @param {object} handlers
     * @param {function} handlers.onScan           - refresh everything now
     * @param {function} handlers.onScanPage       - re-read this page now
     * @param {function} handlers.onNavigate       - (row) => void
     * @param {function} handlers.onSettingsChange - (partialSettings) => void
     * @param {function} handlers.onViewChange     - ('bazaar'|'itemmarket')
     * @param {function} handlers.onSaveKey        - (key) => Promise<void>
     * @param {function} handlers.onForgetKey
     * @param {function} handlers.onClearCache
     * @param {function} handlers.onRevealKey      - () => stored key
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
            title: 'Back to the list (Esc)',
            'aria-label': 'Back',
            text: '←',
            onclick: () => this.showPage('list'),
        });

        this.titleEl = el('div', { class: 'ttv2-title' });
        this.titleTextEl = el('span', { class: 'ttv2-title-text', text: 'NPC Arbitrage' });
        this.versionEl = el('span', {
            class: 'ttv2-ver',
            title: 'Installed version',
            text:
                'v' +
                (typeof TTV2_BUILD_VERSION === 'string' ? TTV2_BUILD_VERSION : 'dev'),
        });
        // Shown only while collapsed: the headline, so a collapsed panel
        // still answers "is there anything to buy?".
        this.miniEl = el('span', { class: 'ttv2-mini' });
        this.titleEl.appendChild(this.titleTextEl);
        this.titleEl.appendChild(this.versionEl);
        this.titleEl.appendChild(this.miniEl);

        // Re-reads the listings on this page right away - no requests, so
        // it can be pressed as often as you like. The feed refresh is ↻.
        this.scanBtn = el('button', {
            type: 'button',
            class: 'ttv2-scan',
            title: 'Scan this page now',
            'aria-label': 'Scan this page now',
            text: 'Scan',
            onclick: guarded(this, 'Scan', () => {
                if (!this.hasKey) {
                    this.showPage('settings', { focusKey: true });
                    return undefined;
                }
                return this.handlers.onScanPage ? this.handlers.onScanPage() : undefined;
            }),
        });

        this.refreshBtn = el('button', {
            type: 'button',
            class: 'ttv2-icon',
            title: 'Refresh now',
            'aria-label': 'Refresh now',
            text: '↻',
            onclick: guarded(this, 'Refresh', () => {
                if (!this.hasKey) {
                    this.showPage('settings', { focusKey: true });
                    return undefined;
                }
                return this.handlers.onScan ? this.handlers.onScan() : undefined;
            }),
        });

        this.settingsBtn = el('button', {
            type: 'button',
            class: 'ttv2-icon',
            title: 'Settings',
            'aria-label': 'Settings',
            'aria-pressed': 'false',
            text: '⚙',
            onclick: () =>
                this.showPage(this.page === 'settings' ? 'list' : 'settings'),
        });

        this.collapseBtn = el('button', {
            type: 'button',
            class: 'ttv2-icon',
            title: 'Collapse',
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
            this.scanBtn,
            this.refreshBtn,
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
        this.buildChips();

        this.tabBtns = {};
        this.tabsEl = el('div', { class: 'ttv2-tabs' });
        for (const [key, label] of [['bazaar', 'Bazaars'], ['itemmarket', 'Item Market']]) {
            const btn = el('button', {
                type: 'button',
                class: 'ttv2-tab',
                text: label,
                onclick: () =>
                    this.handlers.onViewChange && this.handlers.onViewChange(key),
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
            document.createTextNode(' · '),
            el('a', {
                href: W3B_TERMS_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'terms',
            }),
        ]);
        this.tabsEl.appendChild(this.creditEl);

        this.listEl = el('div', { class: 'ttv2-list' });

        this.listPage = el('div', { class: 'ttv2-page ttv2-page-list' }, [
            this.chipsEl,
            this.tabsEl,
            this.listEl,
        ]);

        /* ---- settings page ---- */

        this.settingsPage = el('div', { class: 'ttv2-page ttv2-page-settings' });
        this.buildSettings();

        this.bodyEl = el('div', { class: 'ttv2-body' }, [
            this.barEl,
            this.listPage,
            this.settingsPage,
        ]);

        this.root = el('div', { class: 'ttv2-panel' }, [this.headEl, this.bodyEl]);

        // Esc closes an open chip editor, then Settings.
        this.root.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (this.closeChipEditor()) return;
            if (this.page === 'settings') this.showPage('list');
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

        this.showPage('list');

        // Every second: row ages and the refresh countdown are the "is this
        // still live?" signal.
        this.ticker = setInterval(() => this.refreshAges(), 1000);

        return this.root;
    }

    /* ------------------------------------------------------------ pages */

    /**
     * Switch between the list and Settings. Settings REPLACES the list, at
     * the same panel size - it never stacks on top of it.
     */
    showPage(page, { focusKey = false } = {}) {
        this.page = page === 'settings' ? 'settings' : 'list';
        if (!this.root) return;

        const settings = this.page === 'settings';

        /*
         * Keep the panel's height steady across the switch: Settings is
         * shorter than a full list, and a panel that jumps in size on every
         * click is the kind of jumpiness this redesign is meant to remove.
         */
        if (settings && !this.root.classList.contains('ttv2-on-settings')) {
            this.root.style.minHeight = this.root.getBoundingClientRect().height + 'px';
        } else if (!settings) {
            this.root.style.minHeight = '';
        }

        this.root.classList.toggle('ttv2-on-settings', settings);
        this.settingsBtn.setAttribute('aria-pressed', String(settings));
        this.titleTextEl.textContent = settings ? 'Settings' : 'NPC Arbitrage';

        // Opening a page from a collapsed panel should show it.
        if (this.collapsed) this.setCollapsed(false, { save: true });

        if (settings && focusKey && this.keyInput) {
            setTimeout(() => this.keyInput.focus(), 0);
        }
    }

    /** Old name, kept for callers: open Settings. */
    toggleView(which) {
        this.showPage(which === 'settings' ? 'settings' : 'list', {
            focusKey: which === 'settings' && !this.hasKey,
        });
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

        this.chipNpc = toggle(
            'sellToNpc',
            'NPC',
            "Sell to an NPC shop: listings cheaper than what an NPC shop pays (the item's Sell " +
                'price). Guaranteed, no tax. Items whose Sell is N/A never appear.',
        );
        this.chipBazaar = toggle(
            'resaleBazaar',
            'My bazaar',
            "Trading: listings under the item's average value, relisted in " +
                'your own bazaar (no tax). Someone still has to buy.',
        );
        this.chipMarket = toggle(
            'resaleMarket',
            'Market',
            "Trading: listings under the item's average value, sold on the " +
                'Item Market after its 5% tax.',
        );

        this.chipMin = this.valueChip('minTotalProfit', (v) =>
            'Min ' + formatMoneyShort(v || 0),
            'Hide listings whose total profit is below this',
        );
        this.chipCash = this.valueChip('cashOnHand', (v) =>
            v ? 'Cash ' + formatMoneyShort(v) : 'Cash: any',
            'Only count what you can afford (blank = no limit)',
        );

        this.chipsEl.appendChild(el('span', { class: 'ttv2-chips-label', text: 'Sell to' }));
        this.chipsEl.appendChild(this.chipNpc);
        this.chipsEl.appendChild(this.chipBazaar);
        this.chipsEl.appendChild(this.chipMarket);
        this.chipsEl.appendChild(el('span', { class: 'ttv2-chips-gap' }));
        this.chipsEl.appendChild(this.chipMin);
        this.chipsEl.appendChild(this.chipCash);
    }

    /** A chip showing a number; click it to edit in place (Enter / Esc). */
    valueChip(key, label, title) {
        const chip = el('button', {
            type: 'button',
            class: 'ttv2-chip ttv2-chip-value',
            title: title + ' - click to change',
        });
        chip.dataset.key = key;
        chip.labelFor = label;
        chip.textContent = label(null);

        chip.addEventListener('click', () => {
            this.closeChipEditor();

            const input = el('input', {
                type: 'text',
                inputmode: 'numeric',
                class: 'ttv2-chip-input',
                placeholder: key === 'cashOnHand' ? 'no cap' : '0',
                'aria-label': title,
            });
            const current = this.state.settings[key];
            input.value = current === null || current === undefined ? '' : String(current);

            const commit = () => {
                const raw = input.value.trim();
                const value =
                    key === 'cashOnHand'
                        ? raw
                            ? numberFromInput(raw, null)
                            : null
                        : numberFromInput(raw || '0', 0);
                this.closeChipEditor();
                this.emitSettings({ [key]: value });
            };

            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    this.closeChipEditor();
                }
            });
            input.addEventListener('blur', () => {
                if (this.chipEditor && this.chipEditor.input === input) commit();
            });

            chip.style.display = 'none';
            chip.parentNode.insertBefore(input, chip.nextSibling);
            this.chipEditor = { chip, input };
            input.focus();
            input.select();
        });

        return chip;
    }

    /** @returns {boolean} true if an editor was open */
    closeChipEditor() {
        const editor = this.chipEditor;
        if (!editor) return false;

        this.chipEditor = null;
        editor.chip.style.display = '';
        if (editor.input.parentNode) editor.input.parentNode.removeChild(editor.input);
        return true;
    }

    /* --------------------------------------------------------- settings */

    /**
     * Settings, top to bottom: the key (with Torn's required disclosure
     * right under it), and the live feed. Nothing else - maintenance
     * (re-download item data, reset panel position, scan diagnostics) is in
     * the Tampermonkey menu, out of the way.
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
         * NOT type="password": Chrome would treat it as a login form, offer
         * to save it, and autofill over it. Masking is CSS. And the saved key
         * is not kept in the field - a value in an <input> is readable by any
         * script with the panel's shadow root - Show fetches it, Hide removes it.
         */
        this.keyInput = el('input', {
            type: 'text',
            class: 'ttv2-masked ttv2-key',
            placeholder: 'Paste your Public API key',
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'data-lpignore': 'true',
            'data-1p-ignore': 'true',
        });

        this.keyRevealed = false;
        const showBtn = el('button', {
            type: 'button',
            text: 'Show',
            onclick: () => {
                const hidden = this.keyInput.classList.toggle('ttv2-masked');
                showBtn.textContent = hidden ? 'Show' : 'Hide';

                if (!hidden && !this.keyInput.value && this.handlers.onRevealKey) {
                    this.keyInput.value = this.handlers.onRevealKey() || '';
                    this.keyRevealed = true;
                } else if (hidden && this.keyRevealed) {
                    this.keyInput.value = '';
                    this.keyRevealed = false;
                }
            },
        });

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

        const keyHelp = el('div', { class: 'ttv2-note' });
        keyHelp.appendChild(document.createTextNode('Needs a '));
        keyHelp.appendChild(el('strong', { text: 'Public' }));
        keyHelp.appendChild(document.createTextNode(' key - make one at '));
        keyHelp.appendChild(
            el('a', {
                href: TORN_API_KEY_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'Torn › Settings › API Key',
            }),
        );
        keyHelp.appendChild(
            document.createTextNode(
                ". A Public key can't read your money, mail or inventory.",
            ),
        );

        // Torn requires this where the key is entered; it stays right here.
        this.tosEl = el('details', { class: 'ttv2-tos-box', open: '' }, [
            el('summary', { text: 'How this script uses your key (Torn API terms)' }),
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

        /* ---- live feed ---- */

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
            'Watch the Item Market from any Torn page',
            el('span', { class: 'ttv2-sub', text: 'Runs in one visible Torn tab, at most 30 API calls a minute.' }),
        );
        this.liveFeedInput = im.input;

        const w3bSub = el('span', { class: 'ttv2-sub' });
        w3bSub.appendChild(document.createTextNode('Bazaar prices from '));
        w3bSub.appendChild(el('a', { href: W3B_SITE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'weav3r.dev' }));
        w3bSub.appendChild(document.createTextNode(' ('));
        w3bSub.appendChild(el('a', { href: W3B_TERMS_URL, target: '_blank', rel: 'noopener noreferrer', text: 'terms' }));
        w3bSub.appendChild(document.createTextNode('). It gets item ids only - never your key.'));

        const bz = check('useW3b', 'Watch bazaars via TornW3B', w3bSub);
        this.useW3bInput = bz.input;

        this.settingsPage.appendChild(
            section('Live feed', [
                im.row,
                bz.row,
                note(
                    'Never buys, clicks, notifies or plays sounds. Every row is ' +
                        'a link you follow yourself.',
                ),
            ]),
        );
    }

    /**
     * Torn's API Terms of Service require any tool that takes a key to state,
     * in this table form and where the key is entered, how it uses the key.
     */
    buildTosTable() {
        const rows = [
            ['Data storage', 'Only locally (in this browser)'],
            ['Data sharing', 'Nobody'],
            [
                'Purpose of use',
                'Competitive advantage: finding Bazaar and Item Market ' +
                    'listings priced below NPC / market value',
            ],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            [
                'Key access level',
                'Public (torn: items, cityshops; market: itemmarket; key: info)',
            ],
            [
                'Other services',
                'TornW3B (weav3r.dev), for bazaar prices. It receives item ids ' +
                    'only - never your key or anything about you.',
            ],
        ];

        const table = el('table', { class: 'ttv2-tos' });
        for (const [k, v] of rows) {
            table.appendChild(
                el('tr', {}, [el('th', { text: k }), el('td', { text: v })]),
            );
        }

        return el('div', {}, [
            el('h4', { text: 'API key terms of use' }),
            table,
        ]);
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
                'Saved - but this key has ' +
                (accessName || 'more than Public') +
                ' access. Public is enough. Revoke it and make a Public one.';
            this.keyStateEl.classList.add('ttv2-bad');
            return;
        }

        this.keyStateEl.textContent =
            (accessName ? 'Saved - ' + accessName + ' access.' : 'Saved.') +
            ' Hidden from the page; press Show to see it.';
        this.keyStateEl.classList.add('ttv2-ok');
    }

    emitSettings(partial) {
        this.state.settings = { ...this.state.settings, ...partial };
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

    /** Put the panel's top-left corner here, kept fully on screen. */
    placeAt(left, top) {
        const rect = this.root.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, 60));

        this.root.style.left = Math.min(Math.max(0, left), maxLeft) + 'px';
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
    }

    clampIntoView() {
        if (!this.root || !this.root.style.left) return;
        const rect = this.root.getBoundingClientRect();
        this.placeAt(rect.left, rect.top);
    }

    setCollapsed(collapsed, { save = false } = {}) {
        this.collapsed = Boolean(collapsed);
        if (!this.root) return;

        this.root.classList.toggle('ttv2-collapsed', this.collapsed);
        this.collapseBtn.textContent = this.collapsed ? '+' : '–';
        this.collapseBtn.title = this.collapsed ? 'Expand' : 'Collapse';
        this.collapseBtn.setAttribute('aria-label', this.collapseBtn.title);

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
        if (!this.refreshBtn) return;

        this.refreshBtn.disabled = this.state.busy;
        this.refreshBtn.classList.toggle('ttv2-spin', this.state.busy);
        this.refreshBtn.title = this.state.busy ? 'Refreshing...' : 'Refresh now';
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

        if (this.liveFeedInput && settings.liveFeed !== undefined) {
            this.liveFeedInput.checked = Boolean(settings.liveFeed);
        }
        if (this.useW3bInput && settings.useW3b !== undefined) {
            this.useW3bInput.checked = Boolean(settings.useW3b);
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
    }

    /* ------------------------------------------------------------ render */

    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        this.listEl.textContent = '';

        const rows = this.state.rows || [];

        if (rows.length === 0) {
            this.listEl.appendChild(this.renderEmpty());
        } else {
            rows.forEach((row, i) => {
                this.listEl.appendChild(this.renderRow(row, i));
            });
        }

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
     * Right: whether the feed is live, and when it next refreshes.
     */
    renderBar() {
        if (!this.barEl) return;

        const now = Date.now();
        const st = this.state.status || {};
        const summary = this.state.summary || { count: 0, totalProfit: 0 };
        const headline =
            summary.count === 1
                ? '1 deal · +' + formatMoneyShort(summary.totalProfit)
                : summary.count + ' deals · +' + formatMoneyShort(summary.totalProfit);

        const showMessage =
            st.text &&
            (st.level !== 'info' || this.state.busy || now - st.at < INFO_STATUS_MS);

        this.barLeft.textContent = showMessage ? st.text : headline;
        this.barLeft.title = showMessage ? st.text : '';
        this.barEl.classList.toggle('ttv2-warn', showMessage && st.level === 'warn');
        this.barEl.classList.toggle('ttv2-error', showMessage && st.level === 'error');

        // Collapsed: the headline rides in the header.
        this.miniEl.textContent = this.collapsed ? '· ' + headline : '';

        /* ---- liveness ---- */
        const live = this.state.live;
        let dot = 'off';
        let text = 'feed off';
        let title = 'Live feed is off (Settings)';

        if (live && live.enabled) {
            if (!live.itemMarket) {
                dot = 'warn';
                text = 'needs key';
                title = 'Add a Public API key in Settings';
            } else if (live.leading) {
                dot = live.lastError ? 'warn' : 'live';
                const secs = live.nextRefreshAt
                    ? Math.max(0, Math.ceil((live.nextRefreshAt - now) / 1000))
                    : null;
                text = 'live' + (secs !== null ? ' · refresh ' + secs + 's' : '');
                title = live.lastError || 'Refreshes every 30 seconds';
            } else {
                dot = 'other';
                text = 'live in another tab';
                title = 'Another visible Torn tab is running the feed; results show here too.';
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
            return box('Needs a Public API key to start.', 'Add key', () =>
                this.showPage('settings', { focusKey: true }),
            );
        }

        if (!d && tab === 'bazaar' && live && !live.w3b) {
            return box('Bazaar watching is off.', 'Turn it on', () =>
                this.emitSettings({ useW3b: true, liveFeed: true }),
            );
        }

        if (!d && live && !live.enabled) {
            return box('The live feed is off, so only the page you are on is scanned.', 'Turn it on', () =>
                this.emitSettings({ liveFeed: true }),
            );
        }

        const s = this.state.settings;
        if (s.sellToNpc === false && !s.resaleBazaar && !s.resaleMarket) {
            return box('Nothing to sell to is selected.', 'Sell to NPC shops', () =>
                this.emitSettings({ sellToNpc: true }),
            );
        }

        return box(this.emptyReason(), 'Refresh now', () =>
            this.handlers.onScan && this.handlers.onScan(),
        );
    }

    emptyReason() {
        const d = this.state.diagnostics;
        const live = this.state.live;
        const tab = this.state.tab;

        if (!d) {
            if (live && live.enabled && live.leading) {
                return tab === 'bazaar'
                    ? 'Watching bazaars - nothing profitable right now.'
                    : 'Watching the Item Market - nothing profitable right now.';
            }
            if (live && live.enabled) {
                return 'Live feed runs in another Torn tab; results appear here.';
            }
            return 'Nothing yet.';
        }

        if (d.images === 0) {
            return (
                'No item images found on this page. Are there listings ' +
                'showing? If so, Torn may have changed its markup.'
            );
        }

        if (d.listings === 0 && d.cards > 0) {
            if (d.noItem === d.cards) {
                return (
                    'Found ' +
                    d.cards +
                    ' listings but none matched the item database. Try ' +
                    'Tampermonkey menu › Re-download item data.'
                );
            }
            return (
                'Found ' +
                d.cards +
                ' listings but could not read a price from them.'
            );
        }

        if (d.priceAssumed > 0) {
            return (
                'Nothing above your threshold. ' +
                d.priceAssumed +
                ' row(s) were hidden because their price had to be guessed.'
            );
        }

        return tab === 'bazaar'
            ? 'No bazaar deals right now.'
            : 'No Item Market deals right now.';
    }

    /**
     * One opportunity, as a card - the layout the original ChatGPT script
     * used and people liked:
     *
     *     #1  Xanax                                  +$11,255
     *         Bazaar - SellerName | via TornW3B | 40s   $11,255 / item
     *         Buy $838,745 -> Market value $850,000
     *         Qty: 390 | resell in your bazaar
     *         [            GO TO BAZAAR             ]
     *
     * Everything goes in through textContent; names from Torn or TornW3B
     * never touch innerHTML.
     */
    renderRow(row, rank = 0) {
        const p = row.profit;
        const venue = VENUE_LABELS[p.venue] || p.venue;
        const known = row.qtyAtPrice !== false;

        /* ---- rank ---- */
        const rankEl = el('div', { class: 'ttv2-rank', text: '#' + (rank + 1) });

        /* ---- name ---- */
        const name = el('div', { class: 'ttv2-row-name', text: row.name });

        /* ---- Buy $x -> Exit $y ---- */
        const prices = el('div', { class: 'ttv2-row-prices' });
        prices.appendChild(document.createTextNode('Buy '));
        prices.appendChild(el('b', { text: formatMoney(p.listingPrice) }));
        if (row.priceAssumed) {
            prices.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'This row showed more than one price and none was ' +
                        'labelled. The lowest was taken as the unit price - ' +
                        'check it on the card before buying.',
                    text: ' ?',
                }),
            );
        }
        prices.appendChild(document.createTextNode('  ->  ' + venue + ' '));
        prices.appendChild(el('b', { text: formatMoney(p.exitPrice) }));

        /* ---- Qty | exit note | shop ---- */
        const qty = el('div', { class: 'ttv2-row-qty' });
        const bits = [];

        if (known) {
            bits.push(
                'Qty: ' +
                    p.affordableQty.toLocaleString('en-US') +
                    (p.affordableQty < p.qty
                        ? ' of ' + p.qty.toLocaleString('en-US') + ' (cash)'
                        : ''),
            );
        }
        if (p.venue === 'BAZAAR_RESALE') bits.push('resell in your bazaar, no tax');
        if (p.venue === 'ITEM_MARKET') bits.push('resell on the Item Market, after 5% tax');
        const shopName =
            (row.item && row.item.npcShopName) ||
            (row.npcShop && row.npcShop.shopName) ||
            null;

        if (p.venue === 'NPC' && shopName) {
            bits.push('sell to ' + shopName);
        } else if (p.venue === 'NPC') {
            bits.push('sell to NPC');
        }

        qty.appendChild(document.createTextNode(bits.join('  |  ')));

        if (!known) {
            qty.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'This is the cheapest listing, but Torn does not say ' +
                        'how many are available AT this price - only the ' +
                        'market-wide total' +
                        (row.marketTotal
                            ? ' (' + row.marketTotal.toLocaleString('en-US') + ')'
                            : '') +
                        '. Open the item to see each seller.',
                    text: (bits.length ? '  |  ' : '') + 'qty unknown',
                }),
            );
        }

        const main = el('div', { class: 'ttv2-row-main' }, [
            name,
            this.sourceLine(row),
            prices,
            qty,
        ]);

        /* ---- profit column ---- */
        const profit = el('div', { class: 'ttv2-row-profit' }, [
            el('strong', {
                text: known
                    ? '+' + formatMoney(p.realizableProfit)
                    : '+' + formatMoney(p.profitPerUnit),
            }),
            el('span', {
                text: known
                    ? formatMoney(p.profitPerUnit) + ' / item'
                    : 'per item',
            }),
            el('span', { text: 'ROI ' + formatPct(p.roi) }),
        ]);

        /* ---- the one action ---- */
        const label = row.el
            ? 'SCROLL TO LISTING'
            : row.source === 'bazaar' && (row.url || row.sellerId)
              ? 'GO TO BAZAAR'
              : 'GO TO MARKET';

        const go = el('button', {
            type: 'button',
            class: 'ttv2-go',
            title: row.el
                ? 'Scroll to this listing'
                : row.source === 'bazaar'
                  ? row.sellerName
                      ? "Open " + row.sellerName + "'s bazaar"
                      : 'Open this bazaar'
                  : 'Open this item on the Item Market',
            text: label,
            onclick: () =>
                this.handlers.onNavigate && this.handlers.onNavigate(row),
        });

        const rowEl = el('div', { class: 'ttv2-row' }, [rankEl, main, profit, go]);
        rowEl.dataset.ttv2At = String(this.rowTime(row) || '');
        if (row.el) rowEl.classList.add('ttv2-onpage');

        return rowEl;
    }

    /** When the data behind a row was true - not when we last looked. */
    rowTime(row) {
        if (row.fromFeed) return row.dataAt;
        return row.seenAt || null;
    }

    /**
     * Where a row came from, and how old it is. Every row says this, because
     * "is this still there?" is the question that matters most.
     */
    sourceLine(row) {
        const parts = [];

        if (row.source === 'bazaar') {
            parts.push('Bazaar' + (row.sellerName ? ' - ' + row.sellerName : ''));
        } else if (row.source === 'itemmarket') {
            parts.push('Item Market');
        }

        if (row.el) parts.push('on this page');
        else if (row.fromFeed) parts.push(row.source === 'bazaar' ? 'via TornW3B' : 'via Torn API');
        else if (row.fromLedger) parts.push('seen earlier');

        const line = el('div', {
            class: 'ttv2-row-src',
            text: parts.join('  |  '),
        });

        const age = el('span', { class: 'ttv2-age' });
        line.appendChild(document.createTextNode(parts.length ? '  |  ' : ''));
        line.appendChild(age);

        if (row.fromFeed && row.dataAgeKnown === false) {
            age.title = 'TornW3B did not say when it last checked this.';
        }
        return line;
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
            if (ageEl) ageEl.textContent = known ? formatAge(now - at) : 'age unknown';
        }

        this.renderBar();
    }

    destroy() {
        if (this.ticker) clearInterval(this.ticker);
        clearTimeout(this.scanTimer);
        if (this.host && this.host.parentNode) {
            this.host.parentNode.removeChild(this.host);
        }
        this.root = null;
    }
}
