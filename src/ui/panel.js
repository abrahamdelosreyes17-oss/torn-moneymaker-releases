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
    parseMoneyInput,
} from '../core/parse.js';
import { VENUE_LABELS } from '../core/profit.js';
import { W3B_TERMS_URL, W3B_SITE_URL } from '../api/w3b.js';
import { TE_SITE_URL } from '../api/te.js';
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
    const n = parseMoneyInput(value);
    return n === null ? fallback : n;
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
            title: 'Collapse (`)',
            'aria-label': 'Collapse',
            text: '–',
            onclick: () => this.setCollapsed(!this.collapsed, { save: true }),
        });

        // A thin line that sweeps under the header on every visible scan, so
        // you can see a scan happened even when nothing on the list changed.
        this.sweepEl = el('div', { class: 'ttv2-sweep', 'aria-hidden': 'true' });

        // The Traders page: its own full page, fed by this overlay.
        this.tradersBtn = el('button', {
            type: 'button',
            class: 'ttv2-traders-btn',
            title: 'Open the Traders page: every deal with the traders who buy it',
            text: 'Traders',
            onclick: guarded(this, 'Traders', () => this.handlers.onOpenTraders && this.handlers.onOpenTraders()),
        });

        this.headEl = el('div', { class: 'ttv2-head' }, [
            this.backBtn,
            this.titleEl,
            this.tradersBtn,
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
            ['traders', 'By trader'],
        ]) {
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

        // Where trader prices come from, on the tab they feed.
        this.teCreditEl = el('span', { class: 'ttv2-credit' }, [
            el('a', {
                href: TE_SITE_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: 'Trader prices come from TornExchange',
                text: 'via TornExchange',
            }),
        ]);
        this.tabsEl.appendChild(this.teCreditEl);

        this.listEl = el('div', { class: 'ttv2-list' });

        // Whose bazaar this is, and whether they are around. Bazaar pages only.
        this.sellerEl = el('div', { class: 'ttv2-seller' });

        this.listPage = el('div', { class: 'ttv2-page ttv2-page-list' }, [
            this.sellerEl,
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
            if (this.closeTradersPrompt()) return;
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
         * Keep the panel's height steady across the switch: Settings may be
         * shorter or taller than the list (it scrolls), and a panel that
         * jumps in size on every click is the kind of jumpiness this
         * redesign is meant to remove.
         */
        if (settings && !this.root.classList.contains('ttv2-on-settings')) {
            const h = this.root.getBoundingClientRect().height + 'px';
            this.root.style.minHeight = h;
            this.root.style.height = h;
        } else if (!settings) {
            this.root.style.minHeight = '';
            this.root.style.height = '';
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

        this.chipTrader = toggle(
            'sellToTrader',
            'Trader',
            'Sell to a player trader: listings cheaper than what a TornExchange ' +
                'trader pays, online traders first. Instant cash, no tax - but an ' +
                'offer, not a guarantee. Needs a TornExchange key (Settings).',
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
        this.chipsEl.appendChild(this.chipTrader);
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

        /* ---- links ---- */

        const nt = check(
            'openInNewTab',
            'Open deals in a new tab',
            el('span', {
                class: 'ttv2-sub',
                text: 'Untick to open GO TO BAZAAR / GO TO MARKET in this tab instead.',
            }),
        );
        this.newTabInput = nt.input;

        // The Traders page keeps its own preferences; this only shows and
        // resets how its button opens it.
        this.tradersModeEl = el('span', { class: 'ttv2-sub' });
        const tradersLine = el('div', { class: 'ttv2-note ttv2-traders-mode' }, [
            this.tradersModeEl,
            document.createTextNode(' '),
            el('button', {
                type: 'button',
                class: 'ttv2-link',
                text: 'Ask again',
                onclick: () => this.handlers.onTradersOpenMode && this.handlers.onTradersOpenMode('ask'),
            }),
        ]);

        this.settingsPage.appendChild(section('Links', [nt.row, tradersLine]));

        /* ---- TornExchange ---- */

        this.teKeyInput = el('input', {
            type: 'text',
            class: 'ttv2-masked ttv2-te-key',
            placeholder: 'Paste your TornExchange key',
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'data-lpignore': 'true',
            'data-1p-ignore': 'true',
        });

        this.teKeyRevealed = false;
        const teShowBtn = el('button', {
            type: 'button',
            text: 'Show',
            onclick: () => {
                const hidden = this.teKeyInput.classList.toggle('ttv2-masked');
                teShowBtn.textContent = hidden ? 'Show' : 'Hide';
                if (!hidden && !this.teKeyInput.value && this.handlers.onRevealTeKey) {
                    this.teKeyInput.value = this.handlers.onRevealTeKey() || '';
                    this.teKeyRevealed = true;
                } else if (hidden && this.teKeyRevealed) {
                    this.teKeyInput.value = '';
                    this.teKeyRevealed = false;
                }
            },
        });

        const teSave = guarded(this, 'Save', () => {
            const key = this.teKeyInput.value.trim();
            this.teKeyInput.value = '';
            this.teKeyRevealed = false;
            return this.handlers.onSaveTeKey ? this.handlers.onSaveTeKey(key) : undefined;
        });
        this.teKeyInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            teSave();
        });

        this.teStateEl = el('div', { class: 'ttv2-keystate', text: 'No TornExchange key.' });

        const teHelp = el('div', { class: 'ttv2-note' });
        teHelp.appendChild(document.createTextNode(
            "TornExchange only answers to the Torn key you log in there with. Make a " +
                'second Public key, log in at ',
        ));
        teHelp.appendChild(el('a', { href: TE_SITE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'tornexchange.com' }));
        teHelp.appendChild(document.createTextNode(
            ' with it, and paste that same key here. Your main key is never sent there. ' +
                'Trader prices are fetched once every 30 minutes.',
        ));

        this.settingsPage.appendChild(
            section('Traders (TornExchange)', [
                el('div', { class: 'ttv2-inline' }, [
                    this.teKeyInput,
                    teShowBtn,
                    el('button', { type: 'button', class: 'ttv2-primary', text: 'Save', onclick: teSave }),
                ]),
                this.teStateEl,
                teHelp,
                el('div', { class: 'ttv2-inline' }, [
                    el('button', {
                        type: 'button',
                        class: 'ttv2-link',
                        text: 'Refresh trader prices',
                        onclick: guarded(this, 'Refresh', () =>
                            this.handlers.onRefreshTraders && this.handlers.onRefreshTraders(),
                        ),
                    }),
                    el('button', {
                        type: 'button',
                        class: 'ttv2-link',
                        text: 'Forget TornExchange key',
                        onclick: () => this.handlers.onForgetTeKey && this.handlers.onForgetTeKey(),
                    }),
                ]),
            ]),
        );
    }

    renderTradersMode() {
        if (!this.tradersModeEl) return;
        const mode = this.state.tradersOpenMode || 'ask';
        this.tradersModeEl.textContent =
            'Traders page opens: ' +
            (mode === 'tab' ? 'in a new tab' : mode === 'overlay' ? 'over the page' : 'ask each time') + '.';
        this.tradersModeEl.parentNode.lastChild.hidden = mode === 'ask';
    }

    /**
     * "Open the Traders page in a new tab?" - Yes / No, here / Remember.
     * @param {function} onChoice - (newTab: boolean, remember: boolean)
     */
    showTradersPrompt(onChoice) {
        this.closeTradersPrompt();
        if (this.collapsed) this.setCollapsed(false, { save: true });

        const remember = el('input', { type: 'checkbox' });
        const choose = (newTab) => {
            const keep = remember.checked;
            this.closeTradersPrompt();
            onChoice(newTab, keep);
        };

        const yes = el('button', { type: 'button', class: 'ttv2-primary', text: 'Yes', onclick: () => choose(true) });
        this.tradersPrompt = el('div', { class: 'ttv2-prompt', role: 'dialog', 'aria-label': 'Open the Traders page' }, [
            el('div', { class: 'ttv2-prompt-q', text: 'Open the Traders page in a new tab?' }),
            el('div', {
                class: 'ttv2-note',
                text: 'Yes: its own tab, stays open while you browse Torn. No: full screen over this page, ✕ to close.',
            }),
            el('label', { class: 'ttv2-check ttv2-prompt-remember' }, [remember, el('span', { text: 'Remember my choice' })]),
            el('div', { class: 'ttv2-prompt-btns' }, [
                el('button', { type: 'button', text: 'No, here', onclick: () => choose(false) }),
                yes,
            ]),
        ]);
        this.root.appendChild(this.tradersPrompt);
        yes.focus();
    }

    /** @returns {boolean} true if a prompt was open */
    closeTradersPrompt() {
        if (!this.tradersPrompt) return false;
        this.tradersPrompt.remove();
        this.tradersPrompt = null;
        return true;
    }

    /** The TornExchange line in Settings: never the key, only its state. */
    renderTraderInfo() {
        const info = this.state.traderInfo;
        if (!this.teStateEl || !info) return;

        this.teStateEl.classList.remove('ttv2-ok', 'ttv2-bad');
        let text;
        if (!info.hasKey) {
            text = 'No TornExchange key.';
        } else if (info.badKey) {
            text = info.error || 'TornExchange did not accept the key.';
            this.teStateEl.classList.add('ttv2-bad');
        } else if (info.loading) {
            text = 'Loading trader prices...';
        } else if (info.fetchedAt) {
            text =
                'Trader prices for ' + info.items.toLocaleString('en-US') + ' items, updated ' +
                formatAge(Date.now() - info.fetchedAt) + '.';
            this.teStateEl.classList.add('ttv2-ok');
            if (info.error) text += ' Last refresh failed: ' + info.error;
        } else {
            text = info.error || 'Key saved. Turn on the Trader chip to load prices.';
            if (info.error) this.teStateEl.classList.add('ttv2-bad');
        }
        if (info.waitUntil) {
            text += ' Waiting ' + formatAge(info.waitUntil - Date.now()) + ' (TornExchange rate limit).';
        }
        this.teStateEl.textContent = text;
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
                'Public (torn: items, cityshops; market: itemmarket; key: info; ' +
                    "user: profile - bazaar owners' public online status, for " +
                    'the bazaar you view and the sellers on the Bazaars list)',
            ],
            [
                'Other services',
                'TornW3B (weav3r.dev), for bazaar prices. It receives item ids ' +
                    'only - never your key or anything about you. TornExchange ' +
                    '(tornexchange.com), for traders\' buy prices, only if you add a ' +
                    'TornExchange key: it receives that separate key - never your main key.',
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

        const dot = el('span', { class: 'ttv2-dot' });
        dot.dataset.level = info.level;
        this.sellerEl.appendChild(document.createTextNode('Seller: '));
        this.sellerEl.appendChild(el('b', { text: info.name || 'this bazaar' }));
        this.sellerEl.appendChild(dot);
        this.sellerEl.appendChild(document.createTextNode(info.text));
        if (info.closed) {
            this.sellerEl.appendChild(
                el('span', { class: 'ttv2-closed', text: 'Bazaar closed - nothing here can be bought' }),
            );
        }
        this.sellerEl.title = this.sellerEl.textContent;
    }

    /**
     * ` shows and hides the overlay, from anywhere on the page - except while
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
        this.chipTrader.setAttribute('aria-pressed', String(Boolean(s.sellToTrader)));
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
        } else if (this.state.tab === 'traders') {
            (this.state.groups || []).forEach((g) => {
                this.listEl.appendChild(this.renderGroup(g));
            });
        } else {
            rows.forEach((row, i) => {
                this.listEl.appendChild(this.renderRow(row, i));
            });
        }

        this.renderTabs();
        this.renderTraderInfo();
        this.renderTradersMode();
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
        if (this.teCreditEl) {
            this.teCreditEl.style.display = tab === 'traders' ? '' : 'none';
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
        const ti = this.state.traderInfo || {};

        if (tab === 'traders' && !s.sellToTrader) {
            return box(
                'Groups deals by the trader who buys them - one trade each, online traders first.',
                'Turn on Trader',
                () => this.emitSettings({ sellToTrader: true }),
            );
        }
        if (s.sellToTrader && !ti.hasKey && (tab === 'traders' || s.sellToNpc === false)) {
            return box('Trader prices need a TornExchange key.', 'Add it', () =>
                this.showPage('settings'),
            );
        }
        if (tab === 'traders') {
            return box(
                ti.loading
                    ? 'Loading trader prices...'
                    : ti.error && !ti.fetchedAt
                      ? 'No trader prices: ' + ti.error
                      : 'No listing is cheaper than what a trader pays right now.',
                ti.error && !ti.loading ? 'Open Settings' : null,
                () => this.showPage('settings'),
            );
        }

        if (s.sellToNpc === false && !s.resaleBazaar && !s.resaleMarket && !s.sellToTrader) {
            return box('Nothing to sell to is selected.', 'Sell to NPC shops', () =>
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
                h.cash + (h.cash === 1 ? ' deal is' : ' deals are') + ' hidden by your ' +
                    formatMoneyShort(cash) + ' cash: you cannot buy enough of ' +
                    (h.cash === 1 ? 'it' : 'them') + ' to make ' + formatMoneyShort(min) + '.',
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
                'With ' + formatMoneyShort(cash) + ' cash, a ' + formatMoneyShort(min) +
                    ' profit needs a ' + Math.round((min / cash) * 100) +
                    '% return - that is rare. Try a lower Min.',
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
        if (p.venue === 'TRADER') bits.push('one trade, no tax');

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
            p.venue === 'TRADER' && row.traderPick ? this.traderLine(row.traderPick) : null,
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
        // An offer, not a guarantee: trader deals never look like NPC ones.
        if (p.venue === 'TRADER') rowEl.classList.add('ttv2-row-trader');

        return rowEl;
    }

    /**
     * Who the deal would be sold to, and whether they are around:
     *   Bob ● Online · net +214 · 98% of value   [Profile] [Price list]
     *   best offline: Alice $24,500
     */
    traderLine(pick) {
        const t = pick.trader;
        const line = el('div', { class: 'ttv2-trader' });

        const who = el('span', { class: 'ttv2-src-part' });
        who.appendChild(el('b', { text: t.name }));
        who.appendChild(this.statusBadge(t.id, t.name, pick.level));
        line.appendChild(who);

        const facts = ['net ' + (t.score >= 0 ? '+' : '') + t.score];
        if (pick.pctOfValue) facts.push(Math.round(pick.pctOfValue * 100) + '% of value');
        line.appendChild(el('span', { class: 'ttv2-src-part', text: ' · ' + facts.join(' · ') + ' ' }));

        line.appendChild(this.traderLinks(t));

        if (pick.suspect) {
            line.appendChild(
                el('div', {
                    class: 'ttv2-trader-warn',
                    title: 'Traders usually pay 94-100% of value. A higher price is often one they forgot to update.',
                    text: 'Above value - check their list first',
                }),
            );
        }
        if (pick.better) {
            const b = pick.better;
            line.appendChild(
                el('div', {
                    class: 'ttv2-trader-alt',
                    text:
                        'best ' + (b.level === 'unknown' ? 'other' : b.level) + ': ' +
                        b.trader.name + ' ' + formatMoney(b.trader.price),
                }),
            );
        }
        return line;
    }

    /** [Profile] opens their Torn profile (trade from there); [Price list] their TornExchange list. */
    traderLinks(trader) {
        return el('span', { class: 'ttv2-trader-links' }, [
            el('button', {
                type: 'button',
                class: 'ttv2-mini-btn',
                title: "Open " + trader.name + "'s Torn profile - start the trade from there",
                text: 'Profile',
                onclick: () => this.handlers.onOpenProfile && this.handlers.onOpenProfile(trader.id),
            }),
            el('button', {
                type: 'button',
                class: 'ttv2-mini-btn',
                title: 'Open ' + trader.name + "'s price list on TornExchange (new tab)",
                text: 'Price list',
                onclick: () => this.handlers.onOpenPriceList && this.handlers.onOpenPriceList(trader.id),
            }),
        ]);
    }

    /** "● Online" for a player, from the known statuses; "● checking" until known. */
    statusBadge(id, name, fallbackLevel) {
        const statuses = this.state.statuses;
        const status = statuses ? statuses.get(String(id)) : null;
        const badge = el('span', {
            class: 'ttv2-src-status',
            title: status ? (name ? name + ': ' : '') + status.title + ' (Torn API)' : 'Checking status...',
            text: status ? status.text : 'checking',
        });
        badge.dataset.level = status ? status.level : fallbackLevel || 'unknown';
        return badge;
    }

    /**
     * One trader, and every deal you could sell them in one trade:
     *
     *   Bob ● Online · net +214 · 4 deals · +$41,000   [Profile] [Price list]
     *     Mountie Hat ×3   $20,000 -> $24,000   +$12,000   [GO]
     *       Bazaar - Garrett89 ● Online | 1m ago
     */
    renderGroup(group) {
        const t = group.trader;

        const head = el('div', { class: 'ttv2-group-head' }, [
            el('div', { class: 'ttv2-group-who' }, [
                el('b', { text: t.name }),
                this.statusBadge(t.id, t.name, group.level),
                el('span', {
                    class: 'ttv2-group-facts',
                    text:
                        ' · net ' + (t.score >= 0 ? '+' : '') + t.score + ' · ' +
                        group.rows.length + (group.rows.length === 1 ? ' deal' : ' deals'),
                }),
            ]),
            el('strong', { class: 'ttv2-group-total', text: '+' + formatMoney(group.totalProfit) }),
            this.traderLinks(t),
        ]);

        const items = group.rows.map((row) => {
            const p = row.profit;
            const known = row.qtyAtPrice !== false;
            const line = el('div', { class: 'ttv2-group-item' }, [
                el('div', { class: 'ttv2-group-item-main' }, [
                    el('div', {
                        class: 'ttv2-row-name',
                        text: row.name + (known && p.affordableQty > 1 ? ' ×' + p.affordableQty : ''),
                    }),
                    el('div', {
                        class: 'ttv2-row-prices',
                        text: 'Buy ' + formatMoney(p.listingPrice) + '  ->  ' + formatMoney(p.exitPrice),
                    }),
                    this.sourceLine(row),
                ]),
                el('strong', {
                    class: 'ttv2-group-profit',
                    text: '+' + formatMoney(known ? p.realizableProfit : p.profitPerUnit),
                }),
                el('button', {
                    type: 'button',
                    class: 'ttv2-mini-btn ttv2-group-go',
                    title: row.el ? 'Scroll to this listing' : 'Go to this listing',
                    text: 'GO',
                    onclick: () => this.handlers.onNavigate && this.handlers.onNavigate(row),
                }),
            ]);
            line.dataset.ttv2At = String(this.rowTime(row) || '');
            line.classList.add('ttv2-row-lite');
            return line;
        });

        return el('div', { class: 'ttv2-group' }, [head, ...items]);
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
        /*
         * Two unbreakable pieces - who ("Bazaar - Name ● Offline 3h ago")
         * and where-from/age ("via TornW3B | 42s ago") - that wrap onto a
         * second line when the row is narrow, rather than cutting the age off.
         */
        const line = el('div', { class: 'ttv2-row-src' });
        const who = el('span', { class: 'ttv2-src-part' });

        if (row.source === 'bazaar') {
            // The owner's status right after their name, so you know whether
            // they are around before you click.
            const statuses = this.state.statuses;
            const status =
                statuses && row.sellerId ? statuses.get(String(row.sellerId)) : null;
            const name = row.sellerName || (status && status.name) || null;

            who.appendChild(document.createTextNode('Bazaar' + (name ? ' - ' + name : '')));
            if (status) {
                const badge = el('span', {
                    class: 'ttv2-src-status',
                    title: (name ? name + ': ' : '') + status.title + ' (Torn API)',
                    text: status.text,
                });
                badge.dataset.level = status.level;
                who.appendChild(badge);
            }
        } else if (row.source === 'itemmarket') {
            who.textContent = 'Item Market';
        }

        const from = row.el
            ? 'on this page'
            : row.fromFeed
              ? row.source === 'bazaar' ? 'via TornW3B' : 'via Torn API'
              : row.fromLedger
                ? 'seen earlier'
                : '';

        const age = el('span', { class: 'ttv2-age' });
        const where = el('span', { class: 'ttv2-src-part' }, [
            document.createTextNode(from ? from + '  |  ' : ''),
            age,
        ]);

        if (who.childNodes.length) {
            line.appendChild(who);
            line.appendChild(document.createTextNode('  |  '));
        }
        line.appendChild(where);

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
        for (const rowEl of this.listEl.querySelectorAll('.ttv2-row, .ttv2-row-lite')) {
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
