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
    formatPct,
    formatAge,
    parseMoneyInput,
} from '../core/parse.js';
import { VENUE_LABELS } from '../core/profit.js';
import { W3B_TERMS_URL, W3B_SITE_URL } from '../api/w3b.js';
import { panelStyleElement } from './styles.js';
import { renderPriceGraph } from './graph.js';

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
/** It fits beside Torn's content when at least this much room is there. */
const FIT_MIN_WIDTH = 240;
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
     * @param {function} handlers.onScanPage       - re-read this page now
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

        // The selling page: its own tab, for the items you hold.
        this.sellBtn = el('button', {
            type: 'button',
            class: 'ttv2-sell',
            title: 'Open the selling page in a new tab',
            text: 'Sell',
            onclick: guarded(this, 'Sell', () => this.handlers.onOpenSelling && this.handlers.onOpenSelling()),
        });

        // Re-reads the listings on this page right away - no requests, so
        // it can be pressed as often as you like. The refresh is ↻.
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
        for (const [key, label] of [
            ['bazaar', 'Bazaars'],
            ['itemmarket', 'Item Market'],
        ]) {
            const btn = el('button', {
                type: 'button',
                class: 'ttv2-tab',
                text: label,
                onclick: () => this.handlers.onViewChange && this.handlers.onViewChange(key),
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

        this.listPage = el('div', { class: 'ttv2-page ttv2-page-list' }, [
            this.sellerEl,
            this.chipsEl,
            this.tabsEl,
            this.listEl,
        ]);

        /* ---- my bazaar page ---- */

        this.bzListEl = el('div', { class: 'ttv2-bzlist' });
        this.bzDetailEl = el('div', { class: 'ttv2-bzdetail' });
        this.bazaarPage = el('div', { class: 'ttv2-page ttv2-page-bazaar' }, [this.bzListEl, this.bzDetailEl]);
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

        this.root = el('div', { class: 'ttv2-panel' }, [this.headEl, this.bodyEl]);

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
        this.ticker = setInterval(() => this.refreshAges(), 1000);

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
        this.titleTextEl.textContent = settings ? 'Settings' : this.page === 'mybazaar' ? 'My bazaar' : 'NPC Arbitrage';

        // Opening a page from a collapsed panel should show it.
        if (this.collapsed) this.setCollapsed(false, { save: true });

        if (settings && focusKey && this.keyInput) {
            setTimeout(() => this.keyInput.focus(), 0);
        }
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
            (v) => 'Min ' + formatMoneyShort(v || 0),
            'Hide deals below this total profit',
        );
        this.chipCash = this.valueChip(
            'cashOnHand',
            (v) => (v ? 'Cash ' + formatMoneyShort(v) : 'Cash: any'),
            'Show only what this cash can buy',
        );

        this.chipsEl.appendChild(this.chipNpc);
        this.chipsEl.appendChild(this.chipBazaar);
        this.chipsEl.appendChild(this.chipMarket);
        this.chipsEl.appendChild(el('span', { class: 'ttv2-chips-gap' }));
        this.chipsEl.appendChild(this.chipMin);
        this.chipsEl.appendChild(this.chipCash);
    }

    /**
     * A chip showing a number; click it to edit in place (Enter / Esc).
     * Anything the editor cannot read keeps the old value and says so:
     * a cash figure that silently became "no cap" showed every deal as
     * affordable.
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

        chip.addEventListener('click', () => {
            this.closeChipEditor();

            const input = el('input', {
                type: 'text',
                inputmode: 'numeric',
                class: 'ttv2-chip-input',
                placeholder: key === 'cashOnHand' ? 'any' : '0',
                'aria-label': title,
            });
            const current = this.state.settings[key];
            input.value = current === null || current === undefined ? '' : String(current);

            const commit = () => {
                const raw = input.value.trim();
                this.closeChipEditor();

                if (!raw) {
                    if (/must be a number/.test(this.state.status.text)) this.setStatus('');
                    this.emitSettings({ [key]: key === 'cashOnHand' ? null : 0 });
                    return;
                }
                const value = parseMoneyInput(raw);
                if (value === null || value < 0) {
                    this.setStatus(
                        (key === 'cashOnHand' ? 'Cash' : 'Min') + ' must be a number like 1234567 or 1.5m.',
                        'error',
                    );
                    return;
                }
                // A good value clears the complaint about a bad one.
                if (/must be a number/.test(this.state.status.text)) this.setStatus('');
                this.emitSettings({ [key]: key === 'cashOnHand' && value === 0 ? null : value });
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
         * NOT type="password": Chrome would treat it as a login form, offer
         * to save it, and autofill over it. Masking is CSS. And the saved key
         * is not kept in the field - a value in an <input> is readable by any
         * script with the panel's shadow root - Show fetches it, Hide removes it.
         */
        this.keyInput = el('input', {
            type: 'text',
            class: 'ttv2-masked ttv2-key',
            placeholder: 'Public API key',
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

        this.settingsPage.appendChild(
            section('Watching', [im.row, bz.row, note('Nothing is bought, clicked or announced for you.')]),
        );

        /* ---- links ---- */

        const nt = check(
            'openInNewTab',
            'Open deals in a new tab',
            el('span', { class: 'ttv2-sub', text: 'Off: Go opens the listing in this tab.' }),
        );
        this.newTabInput = nt.input;

        this.settingsPage.appendChild(section('Links', [nt.row]));

        this.settingsPage.appendChild(
            section('Selling', [
                note('The selling page has its own keys and settings.'),
                el('button', {
                    type: 'button',
                    class: 'ttv2-link',
                    text: 'Open the selling page',
                    onclick: guarded(this, 'Sell', () => this.handlers.onOpenSelling && this.handlers.onOpenSelling()),
                }),
            ]),
        );
    }

    /**
     * Torn's API Terms of Service require any tool that takes a key to state,
     * in this table form and where the key is entered, how it uses the key.
     */
    buildTosTable() {
        const rows = [
            ['Data storage', 'Only locally, in this browser'],
            ['Data sharing', 'Nobody'],
            ['Purpose of use', 'Competitive advantage: finding Bazaar and Item Market listings below NPC or market value'],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            [
                'Key access level',
                'Public (torn: items, cityshops; market: itemmarket; key: info; user: profile, for bazaar owners\' public status)',
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
     * page itself is never touched. Where that space is narrower than the
     * one-line header, the header takes two rows - name and deals on top,
     * the buttons below - so nothing is cut short. With no usable space at
     * all (a very narrow window), it floats as it always did.
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
        }
        this.root.style.setProperty('--fit-width', width + 'px');
        this.root.classList.toggle('ttv2-narrow', width < TWO_ROW_BELOW);
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
            if (event.key !== '`' || event.repeat) return;
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (isTypingTarget(event)) return;
            if (!this.root) return;
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
        if (!this.refreshBtn) return;

        this.refreshBtn.disabled = this.state.busy;
        this.refreshBtn.classList.toggle('ttv2-spin', this.state.busy);
        this.refreshBtn.title = this.state.busy ? 'Refreshing' : 'Refresh now';
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
            this.listEl.appendChild(this.colsEl);
            rows.forEach((row) => {
                this.listEl.appendChild(this.renderRow(row));
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

        // Collapsed: the headline rides in the header.
        this.miniEl.textContent = this.collapsed ? '· ' + headline : '';

        /* ---- liveness ---- */
        const live = this.state.live;
        let dot = 'off';
        let text = 'watching off';
        let title = 'Watching is off. Turn it on under Settings.';

        if (live && live.enabled) {
            if (!live.itemMarket) {
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
                this.emitSettings({ useW3b: true, liveFeed: true }),
            );
        }

        if (!d && live && !live.enabled) {
            return box('Watching is off. Only this page is scanned.', 'Turn it on', () =>
                this.emitSettings({ liveFeed: true }),
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
            onclick: () => this.handlers.onNavigate && this.handlers.onNavigate(row),
        });

        const rowEl = el('div', { class: 'ttv2-row' }, [name, profit, details, go]);
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
            if (this.page === 'mybazaar') this.showPage('list');
            return;
        }
        if (this.page === 'list') this.showPage('mybazaar');

        const updated = view.avgAt ? 'What it sold for, on average · updated ' + formatAge(Date.now() - view.avgAt) + '.' : 'What it sold for, on average.';

        // Redrawn only when what it shows changes: the helper repaints every
        // few seconds, and a redraw would drop the graph's hover readout.
        const s = view.series;
        const sig = JSON.stringify([
            view.items,
            view.selected,
            view.windowKey,
            s ? [s.points.length, s.points[s.points.length - 1], s.mv.length, s.mv[s.mv.length - 1], Math.floor(s.to / 300000)] : null,
        ]);
        if (sig === this.bzSig && this.bzUpdatedEl) {
            this.bzUpdatedEl.textContent = updated;
            return;
        }
        this.bzSig = sig;

        const list = this.bzListEl;
        list.textContent = '';

        if (!view.items.length) {
            list.appendChild(el('div', { class: 'ttv2-note', text: 'No items found on this page yet.' }));
        } else {
            list.appendChild(el('div', { class: 'ttv2-bzrow ttv2-bzhead' }, [
                el('span', { class: 'ttv2-label', text: 'Item' }),
                el('span', { class: 'ttv2-label ttv2-money', text: 'IM average' }),
            ]));
            for (const it of view.items) {
                list.appendChild(el('button', {
                    type: 'button',
                    class: 'ttv2-bzrow',
                    'aria-pressed': String(it.itemId === view.selected),
                    title: 'Show its graph',
                    onclick: () => this.handlers.onSelectBazaarItem && this.handlers.onSelectBazaarItem(it.itemId),
                }, [
                    el('span', { class: 'ttv2-name', text: it.name }),
                    el('span', { class: 'ttv2-money', text: it.avg ? formatMoney(it.avg) : '…' }),
                ]));
            }
        }

        const detail = this.bzDetailEl;
        detail.textContent = '';
        const sel = view.items.find((i) => i.itemId === view.selected);
        if (!sel) return;

        /* the answer first: one big number, what it is, how fresh */
        detail.appendChild(el('div', { class: 'ttv2-bzhero' }, [
            el('h3', { text: sel.name }),
            el('div', { class: 'ttv2-label', text: 'Item Market Average' }),
            el('div', { class: 'ttv2-bzavg', text: sel.avg ? formatMoney(sel.avg) : 'Loading…' }),
            (this.bzUpdatedEl = el('div', { class: 'ttv2-note', text: updated })),
        ]));

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

        if (view.series) detail.appendChild(renderPriceGraph(view.series, { width: 404, height: 160 }));
        detail.appendChild(el('div', { class: 'ttv2-graph-keys' }, [
            el('span', { class: 'ttv2-key-mv' }, [el('i'), 'Item Market Average']),
            el('span', { class: 'ttv2-key-im' }, [el('i'), 'Lowest listing we saw']),
        ]));
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
