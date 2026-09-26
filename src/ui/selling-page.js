/*
 * Torn Bids: every item, both sides - who pays most for it, who sells it
 * cheapest, the flips in between, and where to sell what you hold.
 *
 * Its own tab, on a page of our own (see route.js): the script draws the
 * whole page. It reads only the Torn API (with the Limited key kept here),
 * TornExchange and TornW3B. Nothing is traded, listed or clicked for you:
 * every link is one you follow yourself.
 *
 * The layout (the owner picked it from mockups, mockups/H-item-desk.html):
 *   - a header with the name, one search box, every source as a pill;
 *   - the best flips your cash can make, across the top;
 *   - the desk: every item on the left (All / Mine / Flips), and on the
 *     right everything about the one picked, at once - traders pay, bazaars
 *     sell, the flip plan and, for what you hold, where to sell it;
 *   - one scrollbar: the page scrolls, the desk stays in view.
 *
 * Colour means something: green is the best price, the money made and
 * "online", orange is online but busy (hospital, jail, flying), blue is a
 * link, grey is the rest. A status we do not know yet shows nothing - never a
 * placeholder. Nothing is cut short with an ellipsis. Names from Torn,
 * TornExchange or TornW3B only ever go in via textContent.
 */

import { formatMoney, formatAge, parseMoneyInput } from '../core/parse.js';
import { TOKENS_CSS } from './styles.js';
import { TORN_API_KEY_URL } from './panel.js';
import { TE_SITE_URL, tePriceListUrl } from '../api/te.js';
import { w3bPriceListUrl } from '../api/w3b.js';
import { bazaarUrl } from '../core/feed.js';
import { itemMarketUrl } from '../sources/route.js';
import { LedgerView, LEDGER_CSS } from './ledger-view.js';

export const SELLING_PAGE_TITLE = 'Torn Bids';

export const SELLING_PAGE_DEFAULTS = {
    /* Only traders known to be online. */
    onlineOnly: false,
    /* Only traders whose trust badge is Trusted. On from the start: money changes hands on trust. */
    trustedOnly: true,
    /* Flips never plan to spend more than this; null is no limit. */
    cash: null,
    /* The most items one flip buys: no trader takes thousands. */
    maxPerFlip: 100,
    /* Every link opens a new tab. */
    linksNewTab: true,
    /* A flip never asks a trader to pay more than this share of their networth. */
    networthPct: 10,
};

/** The item list shows this many at a time. */
export const ALL_ITEMS_PAGE = 50;

/** Traders and bazaars shown per item before "Show all". */
export const DESK_ROWS = 5;

/** The item list's filters. */
export const SELL_FILTERS = ['all', 'mine', 'flips'];

/** Your own bazaar's add page, where you list what you hold. */
export const MY_BAZAAR_ADD_URL = 'https://www.torn.com/bazaar.php#/add';

/** The Item Market's add-listing page. */
export const MARKET_ADD_URL = 'https://www.torn.com/page.php?sid=ItemMarket#/addListing';

export function spProfileUrl(id) {
    return 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(String(id));
}

/** Torn's trade page, started with one player. */
export function tradeUrl(id) {
    return 'https://www.torn.com/trade.php#step=start&userID=' + encodeURIComponent(String(id));
}

/** Torn's own picture of an item, as its pages show it. */
export function itemImageUrl(itemId) {
    return 'https://www.torn.com/images/items/' + encodeURIComponent(String(itemId)) + '/small.png';
}

function spEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== null && value !== undefined && value !== false) {
            node.setAttribute(key, String(value));
        }
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

/** "+$3,500" / "−$60,005": money made or lost. */
function signed(n) {
    return (n >= 0 ? '+' : '−') + formatMoney(Math.abs(n));
}

function count(n) {
    return Number(n).toLocaleString('en-US');
}

/** A masked key field with Show / Save. The saved key is never left in the field. */
function keyField({ placeholder, onSave, onReveal, primary = false }) {
    const input = spEl('input', {
        type: 'text',
        class: 'sp-masked sp-key',
        placeholder,
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'data-lpignore': 'true',
        'data-1p-ignore': 'true',
    });
    let revealed = false;
    const show = spEl('button', {
        type: 'button',
        class: 'sp-btn',
        text: 'Show',
        onclick: () => {
            const hidden = input.classList.toggle('sp-masked');
            show.textContent = hidden ? 'Show' : 'Hide';
            if (!hidden && !input.value && onReveal) {
                input.value = onReveal() || '';
                revealed = true;
            } else if (hidden && revealed) {
                input.value = '';
                revealed = false;
            }
        },
    });
    const save = () => {
        const key = input.value.trim();
        input.value = '';
        revealed = false;
        input.classList.add('sp-masked');
        show.textContent = 'Show';
        onSave(key);
    };
    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        save();
    });
    const saveBtn = spEl('button', { type: 'button', class: 'sp-btn' + (primary ? ' sp-primary' : ''), text: 'Save', onclick: save });
    return { input, row: spEl('div', { class: 'sp-inline' }, [input, show, saveBtn]) };
}

export class SellingPage {
    /**
     * @param {object} handlers
     *   onSaveKey(key), onForgetKey(), onRevealKey()
     *   onSaveTeKey(key), onForgetTeKey(), onRevealTeKey(), onRetryTe()
     *   onRefresh(), onPrefsChange(partial)
     *   onSelect(itemId)            - pick an item for the desk
     *   onFilter(key), onQuery(text), onCategory(category), onMore()
     *   onOpenUrl(url)
     */
    constructor(handlers = {}) {
        this.h = handlers;
        this.state = {
            strip: [],
            list: [],
            listTotal: 0,
            counts: { all: 0, mine: 0, flips: 0 },
            filter: 'all',
            desk: null,
            prefs: { ...SELLING_PAGE_DEFAULTS },
            info: {},
            statuses: new Map(),
        };
        this.view = 'list';
        this.query = '';
        this.images = new Map();
        /* Row order last drawn, and whether the pointer is over the list. */
        this.order = [];
        this.hover = false;
        this.orderAsked = '';
        /* "Show all" in the desk, for the item it was pressed on. */
        this.showAll = { item: null, buyers: false, sellers: false };
    }

    /**
     * Rows re-sort as prices arrive. Under the pointer that would move the
     * row you are about to click, so while the pointer is over the list its
     * order is kept; it re-sorts when the pointer leaves. New rows go last.
     * Only prices arriving are held back: a new filter, search or Show
     * toggle is something you asked for, and it applies at once.
     */
    stableOrder(rows) {
        const s = this.state;
        const asked = JSON.stringify([s.filter, s.category, this.query, s.prefs.onlineOnly, s.prefs.trustedOnly, s.prefs.cash]);
        const changed = asked !== this.orderAsked;
        this.orderAsked = asked;
        if (changed || !this.hover || !this.order.length) {
            this.order = rows.map((r) => r.itemId);
            return rows;
        }
        const at = new Map(this.order.map((id, i) => [id, i]));
        const pos = (r) => (at.has(r.itemId) ? at.get(r.itemId) : 1e9);
        const kept = rows.slice().sort((a, b) => pos(a) - pos(b));
        this.order = kept.map((r) => r.itemId);
        return kept;
    }

    mount() {
        if (this.host) return;

        this.host = document.createElement('div');
        this.host.id = 'ttv2-sell-host';
        this.host.style.cssText = 'position:fixed;inset:0;z-index:2147482000;';
        const shadow = this.host.attachShadow({ mode: 'open' });
        shadow.appendChild(spEl('style', { text: SELLING_PAGE_CSS }));

        this.build();
        shadow.appendChild(this.root);
        document.documentElement.appendChild(this.host);
        document.title = SELLING_PAGE_TITLE;
        // A phone lays out a page with no viewport tag 980px wide and shrinks
        // it: this page is laid out for the phone's own width.
        if (!document.querySelector('meta[name="viewport"]')) {
            const meta = spEl('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' });
            (document.head || document.documentElement).appendChild(meta);
        }

        // The page underneath must not scroll behind this one.
        this.prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';

        this.keyHandler = (event) => {
            if (event.key === 'Escape') {
                if (this.view !== 'list') this.showView('list');
                return;
            }
            // "/" jumps to the search box, as on most sites with one.
            const typing = event.composedPath().some((n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA'));
            if (event.key === '/' && !typing && this.view === 'list') {
                event.preventDefault();
                this.searchEl.focus();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
        this.resizeHandler = () => this.fitDesk();
        window.addEventListener('resize', this.resizeHandler);
        this.ticker = setInterval(() => {
            this.renderPills();
            if (this.view === 'settings') this.renderSettingsNav();
        }, 1000);
    }

    destroy() {
        if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
        if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        if (this.ticker) clearInterval(this.ticker);
        if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
        document.documentElement.style.overflow = this.prevOverflow || '';
        this.host = null;
        this.root = null;
    }

    /* ------------------------------------------------------------ build */

    build() {
        const set = (partial) => this.h.onPrefsChange && this.h.onPrefsChange(partial);

        /* header: name, search, sources, refresh, settings */
        this.backBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Back (Esc)',
            'aria-label': 'Back',
            text: '←',
            hidden: '',
            onclick: () => this.showView('list'),
        });
        this.titleEl = spEl('h1', { text: SELLING_PAGE_TITLE });
        this.taglineEl = spEl('span', { class: 'sp-tagline', text: 'Every item, both sides' });
        this.searchEl = spEl('input', {
            type: 'search',
            class: 'sp-search',
            placeholder: 'Search items… ( / )',
            'aria-label': 'Search items',
            autocomplete: 'off',
            spellcheck: 'false',
        });
        this.searchEl.addEventListener('input', () => {
            this.query = this.searchEl.value;
            if (this.h.onQuery) this.h.onQuery(this.searchEl.value);
        });
        // The category (the owner picked mockups/M-category-dropdown.html):
        // Torn's item types, each with how many items it has.
        this.catEl = spEl('select', { class: 'sp-cat', 'aria-label': 'Category', title: 'Category: filters the flips and the list' });
        this.catEl.addEventListener('change', () => this.h.onCategory && this.h.onCategory(this.catEl.value));
        this.pillsEl = spEl('div', { class: 'sp-pills' });
        this.refreshBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Refresh now',
            'aria-label': 'Refresh now',
            text: '↻',
            onclick: () => this.h.onRefresh && this.h.onRefresh(),
        });
        this.ledgerBtn = spEl('button', {
            type: 'button',
            class: 'sp-hbtn',
            title: 'Torn Ledger: what you made',
            'aria-pressed': 'false',
            text: 'Ledger',
            onclick: () => this.showView(this.view === 'ledger' ? 'list' : 'ledger'),
        });
        this.settingsBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Settings',
            'aria-label': 'Settings',
            'aria-pressed': 'false',
            text: '⚙',
            onclick: () => this.showView(this.view === 'settings' ? 'list' : 'settings'),
        });
        this.headEl = spEl('header', { class: 'sp-head' }, [
            this.backBtn,
            spEl('div', { class: 'sp-brand' }, [spEl('span', { class: 'sp-mark', 'aria-hidden': 'true', text: '$' }), this.titleEl, this.taglineEl]),
            this.searchEl,
            this.catEl,
            this.pillsEl,
            this.refreshBtn,
            this.ledgerBtn,
            this.settingsBtn,
        ]);

        this.bannerEl = spEl('div', { class: 'sp-banner', role: 'status' });

        /* the best flips, and what the whole page shows */
        this.onlineBtn = spEl('button', {
            type: 'button',
            class: 'sp-toggle',
            'aria-pressed': 'false',
            onclick: () => set({ onlineOnly: !this.state.prefs.onlineOnly }),
        }, [spEl('span', { class: 'sp-dot', 'data-level': 'online' }), 'Buyers online only']);
        this.trustedBtn = spEl('button', {
            type: 'button',
            class: 'sp-toggle',
            'aria-pressed': 'false',
            onclick: () => set({ trustedOnly: !this.state.prefs.trustedOnly }),
        }, [spEl('span', { class: 'sp-trust', 'data-level': 'trusted', text: 'T' }), 'Trusted buyers only']);
        this.stripEl = spEl('div', { class: 'sp-strip' });
        this.catLineEl = spEl('div', { class: 'sp-catline', hidden: '' });

        /* the desk: every item, and the one picked */
        this.chipBtns = {};
        this.chipCounts = {};
        const chip = (key, label) => {
            this.chipCounts[key] = spEl('small');
            const btn = spEl('button', {
                type: 'button',
                class: 'sp-chip-f',
                'aria-pressed': 'false',
                onclick: () => this.h.onFilter && this.h.onFilter(key),
            }, [label, this.chipCounts[key]]);
            this.chipBtns[key] = btn;
            return btn;
        };
        this.listBox = spEl('div', { class: 'sp-list' });
        this.listBox.addEventListener('pointerenter', () => {
            this.hover = true;
        });
        this.listBox.addEventListener('pointerleave', () => {
            this.hover = false;
            this.listSig = null;
            this.renderList();
        });
        this.moreBtn = spEl('button', {
            type: 'button',
            class: 'sp-btn sp-more',
            text: 'Show more',
            hidden: '',
            onclick: () => this.h.onMore && this.h.onMore(),
        });
        this.deskEl = spEl('section', { class: 'sp-ws', 'aria-label': 'The item picked' });

        this.listEl = spEl('main', { class: 'sp-main' }, [
            spEl('div', { class: 'sp-wrap' }, [
                spEl('div', { class: 'sp-sec' }, [
                    spEl('h2', { text: 'Best flips · each within your cash' }),
                    spEl('span', { class: 'sp-sp' }),
                    this.onlineBtn,
                    this.trustedBtn,
                ]),
                this.stripEl,
                this.catLineEl,
                spEl('div', { class: 'sp-desk' }, [
                    spEl('div', { class: 'sp-col-list' }, [
                        spEl('div', { class: 'sp-chips', role: 'group', 'aria-label': 'Show items' }, [chip('all', 'All'), chip('mine', 'Mine'), chip('flips', 'Flips')]),
                        this.listBox,
                        this.moreBtn,
                    ]),
                    this.deskEl,
                ]),
            ]),
        ]);

        /* the Torn Ledger */
        this.ledgerView = new LedgerView({
            onRead: () => this.h.onLedgerRead && this.h.onLedgerRead(),
            onOpenSettings: () => {
                this.showView('settings');
                const sec = this.snavSections && this.snavSections.find((x) => x.id === 'ledger');
                if (sec) {
                    this.snavPick('ledger');
                    sec.sec.scrollIntoView({ block: 'start' });
                }
                if (this.ledgerKeyInput) this.ledgerKeyInput.focus({ preventScroll: true });
            },
            onOpenUrl: (url) => this.h.onOpenUrl && this.h.onOpenUrl(url),
        });
        this.ledgerEl = spEl('main', { class: 'sp-main', hidden: '' }, [this.ledgerView.el]);

        /* settings */
        this.settingsEl = spEl('main', { class: 'sp-main', hidden: '' });
        this.buildSettings();

        this.root = spEl('div', { class: 'sp-page' }, [this.headEl, this.bannerEl, this.listEl, this.ledgerEl, this.settingsEl]);
    }

    /**
     * Settings (the owner picked mockups/J-settings-sidebar.html): a menu down
     * the left, each part with its state like the header pills, and the full
     * width for the parts themselves - a label on the left, the field on the
     * right. The page scrolls; the menu stays in view and follows it.
     */
    buildSettings() {
        const body = spEl('div', { class: 'sp-sbody' });
        this.snavEl = spEl('nav', { class: 'sp-snav', 'aria-label': 'Settings' });
        const box = spEl('div', { class: 'sp-settings' }, [this.snavEl, body]);
        this.snav = [];
        this.snavSections = [];

        const group = (title) => this.snavEl.appendChild(spEl('div', { class: 'sp-snav-g', text: title }));
        const section = (id, title, lead, children) => {
            const sec = spEl('section', { class: 'sp-card', 'data-sec': id }, [
                spEl('h2', { text: title }),
                lead ? spEl('p', { class: 'sp-lead' }, [].concat(lead)) : null,
                ...children,
            ]);
            const dot = spEl('span', { class: 'sp-dot' });
            const state = spEl('small');
            const btn = spEl('button', {
                type: 'button',
                class: 'sp-snav-a',
                onclick: () => {
                    this.snavPick(id);
                    sec.scrollIntoView({ block: 'start' });
                },
            }, [dot, spEl('span', { text: title }), state]);
            this.snav.push({ id, btn, dot, state });
            this.snavSections.push({ id, sec });
            this.snavEl.appendChild(btn);
            body.appendChild(sec);
        };
        const field = (label, sub, control) =>
            spEl('div', { class: 'sp-field' }, [
                spEl('div', { class: 'sp-flabel' }, [spEl('b', { text: label }), sub ? spEl('small', {}, [].concat(sub)) : null]),
                spEl('div', { class: 'sp-fctl' }, [].concat(control)),
            ]);
        const note = (children) => spEl('p', { class: 'sp-note' }, children);
        const newTab = (text, href) => spEl('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

        // The menu follows the page as it scrolls: the part at the top is lit.
        // At the very bottom the last parts can never reach the top: there,
        // the one you picked stays lit while it is in view, else the last.
        this.settingsEl.addEventListener('scroll', () => {
            const el = this.settingsEl;
            const box = el.getBoundingClientRect();
            let on = this.snavSections[0] && this.snavSections[0].id;
            for (const s of this.snavSections) if (s.sec.getBoundingClientRect().top <= box.top + 24) on = s.id;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
                const picked = this.snavSections.find((s) => s.id === this.snavOn);
                const seen = picked && picked.sec.getBoundingClientRect().top < box.bottom && picked.sec.getBoundingClientRect().bottom > box.top;
                on = seen ? picked.id : this.snavSections[this.snavSections.length - 1].id;
            }
            this.snavPick(on);
        });

        /* Torn key (Limited) */
        group('Keys and sources');
        const torn = keyField({
            placeholder: 'Limited API key',
            primary: true,
            onSave: (key) => this.h.onSaveKey && this.h.onSaveKey(key),
            onReveal: () => this.h.onRevealKey && this.h.onRevealKey(),
        });
        this.keyStateEl = spEl('div', { class: 'sp-keystate', text: 'No key saved.' });
        section('keys', 'Torn API key', 'Used only on this page, sent to api.torn.com only.', [
            field('Limited key', ['Make one at ', newTab('Torn › Settings › API Key', TORN_API_KEY_URL)], [
                torn.row,
                this.keyStateEl,
                note(['Reads your inventory, your own id, item names, the Item Market for the item on the desk, and traders\' online status.']),
                spEl('div', { class: 'sp-inline sp-actions' }, [
                    spEl('button', { type: 'button', class: 'sp-link', text: 'Forget key', onclick: () => this.h.onForgetKey && this.h.onForgetKey() }),
                ]),
            ]),
        ]);

        /* TornExchange key */
        const te = keyField({
            placeholder: 'Key you log into TornExchange with',
            onSave: (key) => this.h.onSaveTeKey && this.h.onSaveTeKey(key),
            onReveal: () => this.h.onRevealTeKey && this.h.onRevealTeKey(),
        });
        this.teStateEl = spEl('div', { class: 'sp-keystate', text: 'No TornExchange key saved.' });
        this.teSameBtn = spEl('button', {
            type: 'button',
            class: 'sp-link',
            text: 'Use my Limited key',
            onclick: () => this.h.onSaveTeKey && this.h.onSaveTeKey(this.h.onRevealKey ? this.h.onRevealKey() : ''),
        });

        section('te', 'TornExchange', 'Traders\' buy prices and trust votes.', [
            field('TornExchange key', ['The Torn key you log into ', newTab('tornexchange.com', TE_SITE_URL), ' with. Often your Limited key.'], [
                te.row,
                this.teStateEl,
                spEl('div', { class: 'sp-inline sp-actions' }, [
                    this.teSameBtn,
                    spEl('button', { type: 'button', class: 'sp-link', text: 'Forget key', onclick: () => this.h.onForgetTeKey && this.h.onForgetTeKey() }),
                ]),
            ]),
        ]);

        this.w3bStateEl = spEl('div', { class: 'sp-keystate' });
        section('w3b', 'TornW3B', ['Bazaar prices and traders\' price lists, from ', newTab('weav3r.dev', 'https://weav3r.dev/'), '. No key needed; it only receives item and trader ids.'], [
            field('State', null, [this.w3bStateEl]),
        ]);

        /* Cash for flips */
        this.cashInput = spEl('input', {
            type: 'text',
            class: 'sp-key',
            placeholder: 'No limit',
            'aria-label': 'Cash for flips',
            autocomplete: 'off',
            spellcheck: 'false',
        });
        this.cashStateEl = spEl('div', { class: 'sp-keystate' });
        const saveCash = () => {
            const text = this.cashInput.value.trim();
            const cash = text ? parseMoneyInput(text) : null;
            if (text && !(cash > 0)) {
                this.cashStateEl.textContent = cash === null ? 'Could not read "' + text + '". Try 5000000, 5m or 500k.' : 'Cash must be more than $0. Blank is no limit.';
                this.cashStateEl.className = 'sp-keystate sp-bad';
                return;
            }
            this.cashInput.value = '';
            this.cashDirty = false;
            if (this.h.onPrefsChange) this.h.onPrefsChange({ cash: cash || null });
        };
        this.cashInput.addEventListener('input', () => {
            this.cashDirty = true;
        });
        this.cashInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveCash();
        });
        /* Most items per flip */
        this.maxInput = spEl('input', { type: 'text', class: 'sp-key', placeholder: '100', 'aria-label': 'Most per flip', autocomplete: 'off', spellcheck: 'false' });
        this.maxStateEl = spEl('div', { class: 'sp-keystate' });
        const saveMax = () => {
            const n = Math.floor(Number(String(this.maxInput.value).replace(/[,\s]/g, '')));
            if (!(n >= 1)) {
                this.maxStateEl.textContent = 'Type a whole number of items, 1 or more.';
                this.maxStateEl.className = 'sp-keystate sp-bad';
                return;
            }
            this.maxInput.value = '';
            this.maxDirty = false;
            if (this.h.onPrefsChange) this.h.onPrefsChange({ maxPerFlip: n });
        };
        this.maxInput.addEventListener('input', () => {
            this.maxDirty = true;
        });
        this.maxInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveMax();
        });
        this.nwInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', placeholder: '10', 'aria-label': 'Networth share a trader can pay', autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal' });
        this.nwStateEl = spEl('div', { class: 'sp-keystate' });
        const saveNw = () => {
            const n = Number(String(this.nwInput.value).replace(/[%,\s]/g, ''));
            if (!(n > 0 && n <= 100)) {
                this.nwStateEl.textContent = 'Type a percent from 1 to 100.';
                this.nwStateEl.className = 'sp-keystate sp-bad';
                return;
            }
            this.nwInput.value = '';
            this.nwDirty = false;
            if (this.h.onPrefsChange) this.h.onPrefsChange({ networthPct: n });
        };
        this.nwInput.addEventListener('input', () => {
            this.nwDirty = true;
        });
        this.nwInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveNw();
        });

        group('Torn Bids');
        section('flips', 'Flips', 'What Best flips and the flip plan may suggest.', [
            field('Cash for flips', 'Blank: no limit', [
                spEl('div', { class: 'sp-inline' }, [this.cashInput, spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Save', onclick: saveCash })]),
                this.cashStateEl,
                note(['Flips never plan to spend more than this. Reads 5000000, 5,000,000, 5m or 500k.']),
            ]),
            field('Most per flip', null, [
                spEl('div', { class: 'sp-inline' }, [this.maxInput, spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Save', onclick: saveMax })]),
                this.maxStateEl,
                note(['The most items one flip plans to buy. No trader takes thousands at once.']),
            ]),
            field('Trader can pay', null, [
                spEl('div', { class: 'sp-inline sp-pct' }, ['At most ', this.nwInput, ' % of their networth ', spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Save', onclick: saveNw })]),
                this.nwStateEl,
                note(['A flip never asks a trader to pay more than this share of their networth. Networth comes from Torn\'s public stats, read with your Limited key.']),
            ]),
        ]);

        /* the Torn Ledger's Full key: masked, never shown again, its own terms */
        this.ledgerKeyInput = spEl('input', {
            type: 'password',
            class: 'sp-masked sp-key',
            placeholder: 'Full API key',
            'aria-label': 'Full API key for the Torn Ledger',
            autocomplete: 'new-password',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'data-lpignore': 'true',
            'data-1p-ignore': 'true',
        });
        const saveLedgerKey = () => {
            const key = this.ledgerKeyInput.value.trim();
            this.ledgerKeyInput.value = '';
            if (this.h.onLedgerSaveKey) this.h.onLedgerSaveKey(key);
        };
        this.ledgerKeyInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveLedgerKey();
        });
        this.ledgerStateEl = spEl('div', { class: 'sp-keystate' });
        this.ledgerForgetBtn = spEl('button', {
            type: 'button',
            class: 'sp-link sp-danger',
            text: 'Forget key and delete the ledger',
            onclick: () => {
                // Twice to delete: a year of log is not read back in a moment.
                if (this.ledgerForgetArmed && Date.now() - this.ledgerForgetArmed < 5000) {
                    this.ledgerForgetArmed = 0;
                    this.ledgerForgetBtn.textContent = 'Forget key and delete the ledger';
                    if (this.h.onLedgerForget) this.h.onLedgerForget();
                    return;
                }
                this.ledgerForgetArmed = Date.now();
                this.ledgerForgetBtn.textContent = 'Press again to delete the key and the ledger';
                setTimeout(() => {
                    if (this.ledgerForgetArmed && Date.now() - this.ledgerForgetArmed >= 5000) {
                        this.ledgerForgetArmed = 0;
                        this.ledgerForgetBtn.textContent = 'Forget key and delete the ledger';
                    }
                }, 5100);
            },
        });
        const ledgerTos = spEl('table', { class: 'sp-tos sp-tos-ledger' });
        for (const [k, v] of [
            ['Data storage', 'Only locally, in this browser: time, item, quantity, price, where, who. Never the log\'s own text.'],
            ['Data sharing', 'Nobody'],
            ['Purpose of use', 'Personal: profit tracking'],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            ['Key access level', 'Full, used only for your log (bazaar, Item Market and NPC shop buys and sells, and muggings), your trades, and key info'],
            ['Other services', 'None: never sent to TornExchange or TornW3B'],
        ]) {
            ledgerTos.appendChild(spEl('tr', {}, [spEl('th', { text: k }), spEl('td', { text: v })]));
        }
        section('ledger', 'Torn Ledger', 'Your profit from your own Torn log. It needs a Full key, kept apart from your Limited key and used for nothing else.', [
            field('Full key', 'Never shown again after Save', [
                spEl('div', { class: 'sp-inline' }, [this.ledgerKeyInput, spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Save', onclick: saveLedgerKey })]),
                this.ledgerStateEl,
                note(['Torn is asked whether it is a Full key before it is saved; anything else is refused. It is sent only to api.torn.com, only for your log, your trades and key info. Paste a new one to change it.']),
                spEl('div', { class: 'sp-inline sp-actions' }, [this.ledgerForgetBtn]),
            ]),
            field('Key use', 'Torn API terms, Full key', [ledgerTos]),
        ]);

        /* preferences */
        group('Other');
        this.linksInput = spEl('input', { type: 'checkbox' });
        this.linksInput.addEventListener('change', () => this.h.onPrefsChange && this.h.onPrefsChange({ linksNewTab: this.linksInput.checked }));
        section('links', 'Links', null, [
            field('Where links open', null, [spEl('label', { class: 'sp-check' }, [this.linksInput, spEl('span', { text: 'Open links in a new tab' })])]),
        ]);

        const tos = spEl('table', { class: 'sp-tos' });
        for (const [k, v] of [
            ['Data storage', 'Only locally, in this browser'],
            ['Data sharing', 'Nobody'],
            ['Purpose of use', 'Personal gain: who pays most for your items, and flips'],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            ['Key access level', 'Limited (your inventory and your own id; item names; Item Market prices; traders\' public status and networth)'],
            ['Other services', 'TornExchange, only with the key you log in there with'],
        ]) {
            tos.appendChild(spEl('tr', {}, [spEl('th', { text: k }), spEl('td', { text: v })]));
        }
        section('terms', 'Key use (Torn API terms)', 'For your Limited key.', [tos]);

        this.settingsEl.appendChild(box);
        this.snavPick('keys');
    }

    /** Light one part in the settings menu. */
    snavPick(id) {
        this.snavOn = id;
        for (const n of this.snav) n.btn.setAttribute('aria-current', n.id === id ? 'true' : 'false');
    }

    /** Each part's state in the settings menu, in the header pills' words. */
    renderSettingsNav() {
        const info = this.state.info || {};
        const p = this.state.prefs;
        const now = Date.now();
        const states = {
            keys: info.keyError ? ['bad', 'refused'] : !info.hasKey ? ['unknown', 'no key'] : ['online', info.keyAccess ? String(info.keyAccess).replace(/\s*access$/i, '') : 'saved'],
            te: info.teBadKey ? ['bad', 'key refused'] : !info.hasTeKey ? ['unknown', 'no key'] : info.teAt ? ['online', formatAge(now - info.teAt)] : ['idle', 'loading'],
            w3b: (info.w3bRead || 0) < (info.w3bKnown || 0) ? ['idle', (info.w3bRead || 0) + '/' + info.w3bKnown] : ['online', count(info.w3bTraders || 0) + ' lists'],
            flips: p.cash > 0 ? ['online', formatMoney(p.cash) + ' · ' + (p.networthPct || 10) + '%'] : ['idle', 'no cash limit'],
            links: ['online', p.linksNewTab !== false ? 'new tab' : 'this tab'],
            ledger: (() => {
                const L = this.state.ledger || {};
                if (L.keyError) return ['bad', 'key refused'];
                if (!L.hasKey) return ['unknown', 'no key'];
                return L.backfilled ? ['online', count((L.rows || []).length) + ' rows'] : ['idle', 'reading'];
            })(),
            terms: [null, ''],
        };
        for (const n of this.snav) {
            const [level, text] = states[n.id] || [null, ''];
            if (level) n.dot.setAttribute('data-level', level);
            else n.dot.removeAttribute('data-level');
            n.dot.hidden = !level;
            n.state.textContent = text;
        }

        const read = info.w3bRead || 0;
        const known = info.w3bKnown || 0;
        const parts = [];
        parts.push(known ? count(read) + ' of ' + count(known) + ' price lists read' : 'No trader known yet');
        parts.push(info.bazaarsAt ? 'bazaar prices ' + formatAge(now - info.bazaarsAt) : 'bazaar prices loading');
        if (info.flipsWanted) parts.push('possible flips checked ' + info.flipsChecked + ' of ' + info.flipsWanted);
        this.w3bStateEl.textContent = parts.join(' · ') + '.';
        this.w3bStateEl.className = 'sp-keystate' + (info.bazaarsError && !info.bazaarsAt ? ' sp-bad' : info.bazaarsAt ? ' sp-ok' : '');
    }

    showView(view) {
        this.view = view === 'settings' || view === 'ledger' ? view : 'list';
        if (!this.root) return;
        const settings = this.view === 'settings';
        const ledger = this.view === 'ledger';
        const list = this.view === 'list';
        this.settingsEl.hidden = !settings;
        this.ledgerEl.hidden = !ledger;
        this.listEl.hidden = !list;
        this.backBtn.hidden = list;
        this.refreshBtn.hidden = !list;
        this.searchEl.hidden = !list;
        this.catEl.hidden = !list;
        this.settingsBtn.setAttribute('aria-pressed', String(settings));
        this.ledgerBtn.setAttribute('aria-pressed', String(ledger));
        this.titleEl.textContent = settings ? 'Settings' : ledger ? 'Torn Ledger' : SELLING_PAGE_TITLE;
        this.taglineEl.hidden = !list;
        this.renderBanner();
        if (ledger) this.ledgerView.render(this.ledgerArgs());
        if (list) this.fitDesk();
    }

    ledgerArgs() {
        const s = this.state;
        return { ledger: s.ledger || {}, nameOf: s.itemNameOf, typeOf: s.itemTypeOf };
    }

    openSettings() {
        this.showView('settings');
    }

    /* ----------------------------------------------------------- render */

    /**
     * @param {object} view
     *   strip     - the best flips: [{itemId, name, plan, buyer}]
     *   list      - item rows: [{itemId, name, held, lowest, badge, pending}]
     *   listTotal - rows before the page cut
     *   counts    - {all, mine, flips}
     *   filter    - 'all' | 'mine' | 'flips'
     *   categories - [{category, count}] for the Category dropdown
     *   category  - the one picked, or ''
     *   desk      - the item picked (see renderDesk), or null
     *   statuses  - Map traderId -> {level, text, title}
     *   prefs     - this page's preferences
     *   info      - key states, sources, loading
     */
    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        const p = this.state.prefs;
        this.onlineBtn.setAttribute('aria-pressed', String(Boolean(p.onlineOnly)));
        this.trustedBtn.setAttribute('aria-pressed', String(Boolean(p.trustedOnly)));
        this.linksInput.checked = p.linksNewTab !== false;
        if (!this.cashDirty) {
            this.cashInput.placeholder = p.cash > 0 ? formatMoney(p.cash) : 'No limit';
            this.cashStateEl.className = 'sp-keystate';
            this.cashStateEl.textContent = p.cash > 0 ? 'Saved: ' + formatMoney(p.cash) + '.' : 'No limit set.';
        }

        if (!this.maxDirty) {
            this.maxInput.placeholder = String(p.maxPerFlip || 100);
            this.maxStateEl.className = 'sp-keystate';
            this.maxStateEl.textContent = 'Saved: ' + count(p.maxPerFlip || 100) + ' items.';
        }
        if (!this.nwDirty) {
            this.nwInput.placeholder = String(p.networthPct || 10);
            this.nwStateEl.className = 'sp-keystate';
            this.nwStateEl.textContent = 'Saved: ' + (p.networthPct || 10) + '%.';
        }

        this.renderCategory();
        this.renderLedgerKey();
        if (this.view === 'ledger') this.ledgerView.render(this.ledgerArgs());
        this.renderKeyStates();
        this.renderSettingsNav();
        this.renderPills();
        this.renderBanner();
        this.renderStrip();
        this.renderList();
        this.renderDesk();
        this.fitDesk();
    }

    /** The Ledger key's state in Settings: never the key itself. */
    renderLedgerKey() {
        const L = this.state.ledger || {};
        const el = this.ledgerStateEl;
        if (!el) return;
        let text;
        let cls = 'sp-keystate';
        if (L.checking) text = 'Asking Torn what this key can read…';
        else if (L.saveMsg && (L.saveMsg.bad || !L.hasKey)) {
            text = L.saveMsg.text;
            if (L.saveMsg.bad) cls += ' sp-bad';
        } else if (L.keyError) {
            text = L.keyError;
            cls += ' sp-bad';
        } else if (L.hasKey) {
            text = 'Saved · Full access · ' + count((L.rows || []).length) + ' buys and sells' + (L.readAt ? ' · log read ' + formatAge(Date.now() - L.readAt) : '') + '.';
            cls += ' sp-ok';
        } else text = 'No key saved.';
        if (el.textContent !== text) el.textContent = text;
        if (el.className !== cls) el.className = cls;
        this.ledgerForgetBtn.hidden = !L.hasKey;
    }

    /** The Category dropdown, and the line under the flips saying what it hides. */
    renderCategory() {
        const s = this.state;
        const cats = s.categories || [];
        const all = cats.reduce((n, c) => n + c.count, 0);
        // Rebuilt only when the categories themselves change; counts change in
        // place, so an open dropdown is not closed under you as prices arrive.
        const setSig = JSON.stringify(cats.map((c) => c.category).sort());
        if (setSig !== this.catSetSig) {
            this.catSetSig = setSig;
            this.catEl.textContent = '';
            this.catEl.appendChild(spEl('option', { value: '' }));
            for (const c of cats.slice().sort((a, b) => a.category.localeCompare(b.category))) this.catEl.appendChild(spEl('option', { value: c.category }));
        }
        const byName = new Map(cats.map((c) => [c.category, c.count]));
        for (const o of this.catEl.options) {
            const text = o.value ? o.value + ' (' + count(byName.get(o.value) || 0) + ')' : 'Category: All (' + count(all) + ')';
            if (o.textContent !== text) o.textContent = text;
        }
        if (this.catEl.value !== (s.category || '')) this.catEl.value = s.category || '';
        this.catEl.classList.toggle('sp-cat-on', Boolean(s.category));
        this.catLineEl.hidden = !s.category;
        if (s.category && this.catLineEl.dataset.cat !== s.category) {
            this.catLineEl.dataset.cat = s.category;
            this.catLineEl.textContent = '';
            this.catLineEl.append('Showing ', spEl('b', { text: s.category }), ' only, in the flips and the list. ');
            this.catLineEl.appendChild(spEl('button', { type: 'button', class: 'sp-link', text: 'Show all', onclick: () => this.h.onCategory && this.h.onCategory('') }));
        }
        if (!s.category) delete this.catLineEl.dataset.cat;
    }

    renderKeyStates() {
        const info = this.state.info || {};

        this.keyStateEl.className = 'sp-keystate';
        if (info.keyError) {
            this.keyStateEl.textContent = info.keyError;
            this.keyStateEl.classList.add('sp-bad');
        } else if (!info.hasKey) {
            this.keyStateEl.textContent = 'No key saved.';
        } else {
            // Torn names it "Limited Access" already: never "Limited Access access".
            const access = info.keyAccess ? String(info.keyAccess).replace(/\s*access$/i, '') : '';
            this.keyStateEl.textContent = 'Saved' + (access ? ' · ' + access + ' access' : '') + '.';
            this.keyStateEl.classList.add('sp-ok');
        }

        this.teStateEl.className = 'sp-keystate';
        if (info.teBadKey || (info.teError && !info.hasTeKey)) {
            this.teStateEl.textContent = info.teError || 'TornExchange did not accept this key.';
            this.teStateEl.classList.add('sp-bad');
        } else if (!info.hasTeKey) {
            this.teStateEl.textContent = 'No key saved.';
        } else if (info.teAt) {
            this.teStateEl.textContent = 'Saved · prices ' + formatAge(Date.now() - info.teAt) + '.';
            this.teStateEl.classList.add('sp-ok');
        } else {
            this.teStateEl.textContent = info.teError || 'Saved.';
            if (info.teError) this.teStateEl.classList.add('sp-bad');
        }
        this.teSameBtn.hidden = !info.hasKey;
    }

    /**
     * Every source as a small pill: a dot and a few words, the detail on
     * hover. A source in trouble turns amber here - it never takes over the
     * page with a banner while the others are working. The last one is your
     * cash for flips: press it to change it.
     */
    renderPills() {
        if (!this.root) return;
        const info = this.state.info || {};
        const now = Date.now();
        const pills = [];
        const pill = (level, label, text, title) => pills.push({ level, label, text, title });
        const age = (at) => formatAge(now - at).replace(' ago', '');

        const known = info.w3bKnown || 0;
        const read = info.w3bRead || 0;
        if (!known) pill('unknown', 'TornW3B', 'no traders yet', 'No trader known yet');
        else if (read < known) pill('idle', 'TornW3B', read + '/' + known, 'Reading traders\' TornW3B price lists: ' + read + ' of ' + known);
        else pill('online', 'TornW3B', (info.w3bTraders || 0) + ' lists', 'Every known trader\'s TornW3B list read; ' + (info.w3bTraders || 0) + ' have one');

        const checked = info.flipsChecked || 0;
        const wanted = info.flipsWanted || 0;
        const flips = wanted ? ' · ' + checked + '/' + wanted : '';
        if (info.bazaarsError && !info.bazaarsAt) pill('bad', 'Bazaars', 'not loaded', info.bazaarsError);
        else if (!info.bazaarsAt) pill('idle', 'Bazaars', 'loading', 'Loading bazaar prices from TornW3B');
        else pill(checked < wanted ? 'idle' : 'online', 'Bazaars', age(info.bazaarsAt) + flips, 'TornW3B bazaar prices, ' + formatAge(now - info.bazaarsAt) + (wanted ? '. Possible flips checked against every bazaar: ' + checked + ' of ' + wanted : ''));

        const perItem = info.heldCount ? ' Best buyer per item, without a key: ' + (info.teOneDone || 0) + ' of ' + info.heldCount + '.' : '';
        if (info.teStatus === 'ok' && info.teError) pill('idle', 'TornExchange', info.teAt ? age(info.teAt) : '', info.teError);
        else if (info.teStatus === 'ok') pill('online', 'TornExchange', info.teAt ? age(info.teAt) : '', 'TornExchange prices ' + (info.teAt ? formatAge(now - info.teAt) : ''));
        else if (info.teStatus === 'badkey') pill('bad', 'TornExchange', 'key', 'Key not accepted.' + perItem);
        else if (info.teStatus === 'nokey') pill('unknown', 'TornExchange', 'no key', 'No TornExchange key.' + perItem);
        else pill('idle', 'TornExchange', 'loading', 'Loading TornExchange prices');

        const want = info.statusesWanted || 0;
        const got = info.statusesKnown || 0;
        pill(want && got >= want ? 'online' : 'idle', 'Online', got + '/' + want, 'Traders\' online status checked: ' + got + ' of ' + want);

        const cash = this.state.prefs.cash;
        const sig = JSON.stringify([pills, cash]);
        if (sig === this.pillSig) return;
        this.pillSig = sig;
        this.pillsEl.textContent = '';
        for (const p of pills) {
            this.pillsEl.appendChild(spEl('span', { class: 'sp-pill', title: p.title, 'data-src': p.label }, [
                spEl('span', { class: 'sp-dot', 'data-level': p.level }),
                spEl('b', { text: p.label }),
                p.text ? ' ' + p.text : '',
            ]));
        }
        this.pillsEl.appendChild(spEl('button', {
            type: 'button',
            class: 'sp-pill sp-pill-btn',
            title: 'Flips never plan to spend more than this. Press to change it.',
            onclick: () => {
                this.showView('settings');
                this.cashInput.focus();
            },
        }, [spEl('b', { text: 'Cash' }), ' ' + (cash > 0 ? formatMoney(cash) : 'no limit')]));
    }

    /** Only what stops the page working: a key missing or refused, or a wait. */
    renderBanner() {
        const info = this.state.info || {};
        const b = this.bannerEl;
        b.textContent = '';
        b.className = 'sp-banner';

        const say = (text, level, label, fn) => {
            b.classList.add('sp-banner-on');
            if (level) b.classList.add('sp-banner-' + level);
            b.appendChild(spEl('span', { text }));
            if (label && this.view !== 'settings') {
                b.appendChild(spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: label, onclick: fn }));
            }
        };
        const toSettings = () => this.showView('settings');
        // Most traders come from TornExchange, whose key is the Torn key you
        // log in there with: usually this same Limited key, one press away.
        const useLimited = () => this.h.onSaveTeKey && this.h.onSaveTeKey(this.h.onRevealKey ? this.h.onRevealKey() : '');

        if (info.keyError) {
            say(info.keyError, 'bad', 'Open Settings', toSettings);
        } else if (!info.hasKey) {
            say('Add your Limited key to see your items.', null, 'Add key', toSettings);
        } else if (!info.hasTeKey) {
            say('For every TornExchange trader, add the key you log in there with.', null, 'Use my Limited key', useLimited);
        } else if (info.teBadKey && !info.teSameAsLimited) {
            say(info.teError || 'TornExchange did not accept this key.', 'bad', 'Use my Limited key', useLimited);
        } else if (info.teBadKey) {
            say(info.teError || 'TornExchange did not accept this key.', 'bad', 'Try again', () => this.h.onRetryTe && this.h.onRetryTe());
        } else if (info.teWaitUntil && info.teWaitUntil > Date.now()) {
            say('TornExchange asked us to wait ' + formatAge(info.teWaitUntil - Date.now()).replace(' ago', '') + '.', 'warn');
        }
    }

    /* ------------------------------------------------------------ links */

    /**
     * A link that goes through onOpenUrl (a new tab, or this one, as you
     * set), never through the row it sits in.
     */
    link(text, url, { cls = 'sp-chip', title = '', focus = '', children = null } = {}) {
        const a = spEl('a', { class: cls, href: url, title: title || null, 'data-focus': focus || null, target: '_blank', rel: 'noopener noreferrer' }, children || [text]);
        a.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            if (this.h.onOpenUrl) this.h.onOpenUrl(url);
        });
        return a;
    }

    /** A player's name, linking to their Torn profile when their id is known. */
    playerName(name, id, focus) {
        if (!id) return spEl('b', { text: name });
        return this.link(name, spProfileUrl(id), { cls: 'sp-pname', title: 'Torn profile', focus });
    }

    /* ------------------------------------------------------------ strip */

    renderStrip() {
        const s = this.state;
        const info = s.info || {};
        const sig = JSON.stringify([
            s.strip.map((f) => [f.itemId, f.name, f.plan.profit, f.plan.units, f.plan.steps.map((st) => st.sellerName), f.buyer.name, f.buyer.price, f.buyer.trust && f.buyer.trust.level]),
            s.desk && s.desk.itemId,
            info.flipsChecked,
            info.flipsWanted,
            Boolean(info.bazaarsAt),
            info.tradersLoading,
            s.prefs.onlineOnly,
            s.prefs.trustedOnly,
        ]);
        if (sig === this.stripSig) return;
        this.stripSig = sig;

        const box = this.stripEl;
        box.textContent = '';
        if (!s.strip.length) {
            const text = this.noFlipsText();
            box.appendChild(spEl('div', { class: 'sp-empty sp-strip-empty', text }));
            return;
        }
        for (const f of s.strip) {
            const on = Boolean(s.desk && s.desk.itemId === f.itemId);
            box.appendChild(spEl('button', {
                type: 'button',
                class: 'sp-fc' + (on ? ' sp-sel' : ''),
                'aria-pressed': String(on),
                title: 'Show its flip plan',
                onclick: () => this.select(f.itemId),
            }, [
                spEl('span', { class: 'sp-fc-top' }, [spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('strip', f.itemId)]), spEl('b', { class: 'sp-iname', text: f.name })]),
                spEl('span', { class: 'sp-fc-p', text: signed(f.plan.profit) }),
                spEl('small', {}, ['Buy ', spEl('b', { text: count(f.plan.units) }), ' from ' + [...new Set(f.plan.steps.map((st) => st.sellerName || 'a bazaar'))].join(', ')]),
                spEl('small', { class: 'sp-fc-sell' }, ['Sell to ', spEl('b', { text: f.buyer.name }), ' at ' + formatMoney(f.buyer.price), this.trustBadge(f.buyer)]),
            ]));
        }
    }

    /* ------------------------------------------------------------- list */

    renderList() {
        const s = this.state;
        const info = s.info || {};
        const list = this.stableOrder(s.list);
        const sig = JSON.stringify([
            s.filter,
            s.counts,
            s.listTotal,
            s.desk && s.desk.itemId,
            info.hasKey,
            info.loading,
            info.inventoryAt ? 1 : 0,
            info.tradersLoading,
            Boolean(info.bazaarsAt),
            this.query,
            list.map((r) => [r.itemId, r.name, r.held, r.lowest, r.badge && [r.badge.kind, r.badge.amount], r.pending]),
        ]);
        if (sig === this.listSig) return;
        this.listSig = sig;

        // A rebuild replaces the item you had focused: focus its new copy.
        const shadow = this.root.getRootNode();
        const active = shadow && shadow.activeElement;
        const focusKey = active && this.listBox.contains(active) && active.dataset ? active.dataset.focus : null;

        for (const key of SELL_FILTERS) {
            this.chipBtns[key].setAttribute('aria-pressed', String(s.filter === key));
            this.chipCounts[key].textContent = count(s.counts[key] || 0);
        }

        this.listBox.textContent = '';
        if (!list.length) {
            let text = 'Loading…';
            const q = this.query.trim();
            if (q) text = 'No item matches "' + q + '"' + (s.category ? ' in ' + s.category : '') + '.';
            else if (s.category && !(s.counts && s.counts[s.filter])) text = 'Nothing in ' + s.category + (s.filter === 'mine' ? ' that you hold' : s.filter === 'flips' ? ' to flip right now' : '') + '.';
            else if (s.filter === 'mine' && !info.hasKey) text = 'Add your Limited key to see your items.';
            else if (s.filter === 'mine' && info.loading) text = 'Loading your inventory…';
            else if (s.filter === 'mine' && info.inventoryAt) text = 'Your inventory has nothing to sell.';
            else if (s.filter === 'flips') text = this.noFlipsText();
            else if (!info.tradersLoading && !info.traderCount && !info.hasKey) text = 'No traders loaded yet.';
            this.listBox.appendChild(spEl('div', { class: 'sp-empty', text }));
        }
        for (const r of list) {
            const on = Boolean(s.desk && s.desk.itemId === r.itemId);
            const sub = [];
            if (r.held) sub.push('You hold ' + count(r.held));
            if (r.lowest) sub.push('from ' + formatMoney(r.lowest));
            this.listBox.appendChild(spEl('div', {
                class: 'sp-it' + (on ? ' sp-sel' : ''),
                role: 'button',
                tabindex: '0',
                'aria-pressed': String(on),
                'data-focus': 'item:' + r.itemId,
                onclick: () => this.select(r.itemId),
                onkeydown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    this.select(r.itemId);
                },
            }, [
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('list', r.itemId)]),
                spEl('b', { class: 'sp-iname', text: r.name }),
                this.badge(r),
                spEl('small', { text: sub.join(' · ') || (r.pending ? 'Checking…' : '') }),
            ]));
        }
        this.moreBtn.hidden = !(s.listTotal > list.length);

        if (focusKey) {
            const again = [...this.listBox.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === focusKey);
            if (again) again.focus({ preventScroll: true });
        }
    }

    /** Why there is no flip to show: still loading, still checking, or none. */
    noFlipsText() {
        const info = this.state.info || {};
        if (!info.bazaarsAt) return 'Loading bazaar prices…';
        if (info.flipsChecked < info.flipsWanted) return 'No flips found yet. Checking ' + info.flipsChecked + ' of ' + info.flipsWanted + '.';
        if (info.tradersLoading) return 'Looking for traders…';
        return 'No flips with these settings right now.';
    }

    /** Flip +$X / List +$X / Sell to trader, or nothing. */
    badge(r) {
        const b = r.badge;
        if (!b) return spEl('span');
        if (b.kind === 'flip') return spEl('span', { class: 'sp-badge sp-badge-flip', text: 'Flip ' + signed(b.amount) });
        if (b.kind === 'list') return spEl('span', { class: 'sp-badge sp-badge-list', text: 'List ' + signed(b.amount) });
        return spEl('span', { class: 'sp-badge sp-badge-sell', text: 'Sell to trader' });
    }

    select(itemId) {
        if (this.h.onSelect) this.h.onSelect(itemId);
        // On a phone the desk sits above the list: bring it into view.
        if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1000px)').matches && this.deskEl.scrollIntoView) {
            this.deskEl.scrollIntoView({ block: 'start' });
        }
    }

    /* ------------------------------------------------------------- desk */

    /**
     * Everything about the item picked, at once.
     *
     * desk: {itemId, name, held, avg, bazaars,
     *   buyers, buyersTotal, buyersLoading, pending,
     *   sellers: {state: 'loading'|'error'|'ok', rows, error},
     *   plan, planWhy: 'nobuyer'|'nounder'|'loading'|null,
     *   where: {options, best, gain}|null, market: {state, lowest}}
     */
    renderDesk() {
        const d = this.state.desk;
        const box = this.deskEl;
        if (d && this.showAll.item !== d.itemId) this.showAll = { item: d.itemId, buyers: false, sellers: false };
        const statusOf = (b) => {
            const st = b.id && this.state.statuses ? this.state.statuses.get(String(b.id)) : null;
            return st ? st.level + st.text : '';
        };
        const now = Date.now();
        const p = this.state.prefs;
        const info = this.state.info || {};
        const sig = d
            ? JSON.stringify([
                d.itemId, d.name, d.held, d.avg, d.bazaars, d.buyersTotal, d.buyersLoading, d.pending, d.planWhy,
                d.buyers.map((b) => [b.id, b.name, b.price, b.te, b.w3b, statusOf(b), b.trust ? b.trust.level + b.trust.score : '', this.state.networth && b.id ? this.state.networth.get(String(b.id)) : null]),
                p.networthPct,
                d.sellers.state, d.sellers.error,
                d.sellers.rows.map((r) => [r.sellerId, r.sellerName, r.price, r.qty, r.stale, Math.floor((now - (r.dataAt || 0)) / 60000)]),
                d.plan, d.where, d.market,
                this.showAll, p.onlineOnly, p.trustedOnly, p.cash, Boolean(info.knownTraders), info.tradersLoading,
            ])
            : JSON.stringify([info.hasKey, info.loading, Boolean(info.bazaarsAt), info.tradersLoading, this.state.counts]);
        if (sig === this.deskSig) return;
        this.deskSig = sig;

        const shadow = this.root.getRootNode();
        const active = shadow && shadow.activeElement;
        const keep = active && box.contains(active) && active.dataset ? active.dataset.focus : null;

        box.textContent = '';
        if (!d) {
            const none = !(this.state.counts && this.state.counts.all);
            box.appendChild(spEl('p', { class: 'sp-note', text: none ? (info.tradersLoading ? 'Looking for traders…' : 'Nothing to show yet.') : 'Pick an item.' }));
            return;
        }

        const facts = ['Item Market Average ' + (d.avg ? formatMoney(d.avg) : '–')];
        if (d.bazaars) facts.push(count(d.bazaars) + (d.bazaars === 1 ? ' bazaar' : ' bazaars'));
        if (d.held) facts.push('you hold ' + count(d.held));
        box.appendChild(spEl('div', { class: 'sp-wsh' }, [
            spEl('span', { class: 'sp-pic sp-pic-l' }, [this.image('desk', d.itemId)]),
            spEl('span', { class: 'sp-wst' }, [
                this.link(d.name, itemMarketUrl(d.itemId, d.name), { cls: 'sp-wsname', title: 'Open it on the Item Market', focus: 'desk:name' }),
                spEl('small', { text: facts.join(' · ') }),
            ]),
        ]));

        const quad = spEl('div', { class: 'sp-quad' });
        quad.append(this.buyersCard(d), this.sellersCard(d), this.planCard(d));
        if (d.held) quad.appendChild(this.whereCard(d));
        box.appendChild(quad);

        if (keep) {
            const node = [...box.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === keep);
            if (node) node.focus({ preventScroll: true });
        }
    }

    /** Traders pay, highest first: name (their profile), trust, status, price; Trade and both price lists. */
    buyersCard(d) {
        const card = spEl('div', { class: 'sp-q' }, [spEl('h3', { text: 'Traders pay · highest first' })]);
        const all = this.showAll.buyers;
        const rows = all ? d.buyers : d.buyers.slice(0, DESK_ROWS);
        if (d.buyersLoading) card.appendChild(spEl('p', { class: 'sp-note', text: 'Loading more buyers from TornExchange…' }));
        if (!rows.length) card.appendChild(spEl('p', { class: 'sp-note', text: this.noTraderText(d) }));
        rows.forEach((b, i) => {
            card.appendChild(spEl('div', { class: 'sp-tr' + (i === 0 ? ' sp-top' : '') }, [
                spEl('span', { class: 'sp-tr-l' }, [
                    spEl('span', { class: 'sp-trader-l' }, [this.playerName(b.name, b.id, 'buyer:' + (b.id || b.name)), this.trustBadge(b)]),
                    this.status(b),
                    this.networthLine(b),
                    // Their two lists disagree: the lower is counted, and said.
                    b.differ
                        ? spEl('small', { class: 'sp-differ', text: 'Lists differ: TE ' + formatMoney(b.te) + ' · W3B ' + formatMoney(b.w3b) + '. Counted at the lower; check before trading.' })
                        : null,
                ]),
                spEl('span', { class: 'sp-tprice', text: formatMoney(b.price) }),
                this.traderLinks(b),
            ]));
        });
        if (d.buyers.length > DESK_ROWS) {
            card.appendChild(spEl('button', {
                type: 'button',
                class: 'sp-link sp-showall',
                'data-focus': 'desk:buyers-all',
                text: all ? 'Show the top ' + DESK_ROWS : 'Show all ' + count(d.buyers.length) + ' traders',
                onclick: () => {
                    this.showAll.buyers = !all;
                    this.renderDesk();
                    this.fitDesk();
                },
            }));
        }
        return card;
    }

    /** "Networth $1.2b" under a trader, once Torn has said. */
    networthLine(b) {
        const nw = b && b.id && this.state.networth ? this.state.networth.get(String(b.id)) : null;
        if (!(nw >= 0)) return null;
        return spEl('small', { class: 'sp-networth', text: 'Networth ' + formatMoney(nw) });
    }

    /** Trade, TE list and W3B list, in fixed slots so they line up row to row. */
    traderLinks(b) {
        const links = spEl('span', { class: 'sp-links' });
        const slot = (text, url, title) => {
            if (!url) {
                links.appendChild(spEl('span', { class: 'sp-chip sp-chip-none', 'aria-hidden': 'true' }));
                return;
            }
            links.appendChild(this.link(text, url, { title, focus: 'link:' + (b.id || b.name) + ':' + text }));
        };
        slot('Trade', b.id ? tradeUrl(b.id) : null, 'Start a trade with ' + b.name);
        slot('TE list', b.te ? tePriceListUrl(b.teName || b.name) : null, 'TornExchange price list: ' + formatMoney(b.te || 0));
        slot('W3B list', b.w3b && b.id ? w3bPriceListUrl(b.id) : null, 'TornW3B price list: ' + formatMoney(b.w3b || 0));
        return links;
    }

    /**
     * The flip's last step: Trade, and the trader's own price lists, so the
     * price can be checked on their page before the trade. Only the links
     * that exist, in the same order as on the traders card.
     */
    stepTraderLinks(b) {
        const links = [];
        if (b.id) links.push(this.link('Trade', tradeUrl(b.id), { title: 'Start a trade with ' + b.name, focus: 'step-trade' }));
        if (b.te) links.push(this.link('TE list', tePriceListUrl(b.teName || b.name), { title: b.name + '\'s TornExchange price list: ' + formatMoney(b.te), focus: 'step-te' }));
        if (b.w3b && b.id) links.push(this.link('W3B list', w3bPriceListUrl(b.id), { title: b.name + '\'s TornW3B price list: ' + formatMoney(b.w3b), focus: 'step-w3b' }));
        return spEl('span', { class: 'sp-step-links' }, links);
    }

    /** Bazaars sell, cheapest first: seller (their profile), stock, when TornW3B saw it, price; Open bazaar. */
    sellersCard(d) {
        const card = spEl('div', { class: 'sp-q' }, [spEl('h3', { text: 'Bazaars sell · cheapest first' })]);
        const sel = d.sellers;
        if (sel.state === 'loading' && !sel.rows.length) card.appendChild(spEl('p', { class: 'sp-note', text: 'Loading bazaars from TornW3B…' }));
        else if (sel.state === 'error' && !sel.rows.length) card.appendChild(spEl('p', { class: 'sp-note sp-bad', text: sel.error || 'TornW3B did not answer. Trying again soon.' }));
        else if (!sel.rows.length) card.appendChild(spEl('p', { class: 'sp-note', text: 'No bazaar is selling it.' }));
        const all = this.showAll.sellers;
        const rows = all ? sel.rows : sel.rows.slice(0, DESK_ROWS);
        const now = Date.now();
        rows.forEach((r, i) => {
            const seen = r.dataAt ? 'seen ' + formatAge(now - r.dataAt) : 'not seen lately';
            card.appendChild(spEl('div', { class: 'sp-tr' + (i === 0 && !r.stale ? ' sp-top' : '') + (r.stale ? ' sp-stale' : '') }, [
                spEl('span', { class: 'sp-tr-l' }, [
                    this.playerName(r.sellerName || 'Player ' + r.sellerId, r.sellerId, 'seller:' + r.sellerId),
                    spEl('small', { text: count(r.qty) + ' in stock · ' + seen }),
                ]),
                spEl('span', { class: 'sp-tprice', text: formatMoney(r.price) }),
                spEl('span', { class: 'sp-links sp-links-one' }, [this.link('Open bazaar', bazaarUrl(r.sellerId, d.itemId, r.price), { title: 'Open ' + (r.sellerName || 'their') + '\'s bazaar', focus: 'bazaar:' + r.sellerId })]),
            ]));
        });
        if (sel.rows.length > DESK_ROWS) {
            card.appendChild(spEl('button', {
                type: 'button',
                class: 'sp-link sp-showall',
                'data-focus': 'desk:sellers-all',
                text: all ? 'Show the cheapest ' + DESK_ROWS : 'Show all ' + count(sel.rows.length) + ' bazaars',
                onclick: () => {
                    this.showAll.sellers = !all;
                    this.renderDesk();
                    this.fitDesk();
                },
            }));
        }
        return card;
    }

    /** The flip plan: buy from these bazaars, sell to this trader, what it makes and costs. */
    planCard(d) {
        const wide = d.held ? '' : ' sp-wide';
        const f = d.plan;
        if (f && f.units > 0) {
            const b = f.buyer || d.buyers[0];
            const card = spEl('div', { class: 'sp-q sp-hot' + wide }, [
                spEl('h3', { text: 'Flip plan' }),
                spEl('div', { class: 'sp-big', text: signed(f.profit) }),
                spEl('p', { class: 'sp-note', text: count(f.units) + ' flipped' + (f.available > f.units ? ' (of ' + count(f.available) + ' under the bid)' : '') + ' · cash needed ' + formatMoney(f.cost) }),
            ]);
            f.steps.forEach((st, i) => {
                card.appendChild(spEl('div', { class: 'sp-step' }, [
                    spEl('span', { class: 'sp-n', text: String(i + 1) }),
                    spEl('span', {}, ['Buy ', spEl('b', { text: count(st.qty) }), ' from ', this.playerName(st.sellerName || 'Player ' + st.sellerId, st.sellerId, 'step-seller:' + st.sellerId), ' at ' + formatMoney(st.price)]),
                    this.link('Open bazaar', bazaarUrl(st.sellerId, d.itemId, st.price), { focus: 'step-bazaar:' + st.sellerId }),
                ]));
            });
            card.appendChild(spEl('div', { class: 'sp-step' }, [
                spEl('span', { class: 'sp-n', text: String(f.steps.length + 1) }),
                spEl('span', {}, ['Sell ', spEl('b', { text: count(f.units) }), ' to ', this.playerName(b.name, b.id, 'step-buyer'), ' at ' + formatMoney(b.price) + ' ', this.trustBadge(b)]),
                this.stepTraderLinks(b),
            ]));
            // Their networth capped the plan: say so, with the numbers.
            if (b.maxUnits && f.units >= b.maxUnits) {
                const nw = b.id && this.state.networth ? this.state.networth.get(String(b.id)) : null;
                card.appendChild(spEl('p', { class: 'sp-note', text: b.name + ' can pay for at most ' + count(b.maxUnits) + ': ' + (this.state.prefs.networthPct || 10) + '% of their networth' + (nw >= 0 ? ' (' + formatMoney(nw) + ')' : '') + '.' }));
            }
            if (b.differ) card.appendChild(spEl('p', { class: 'sp-note sp-warnnote', text: b.name + '\'s lists differ (TE ' + formatMoney(b.te) + ', W3B ' + formatMoney(b.w3b) + '): planned at the lower. Check their list before trading.' }));
            return card;
        }
        const card = spEl('div', { class: 'sp-q' + wide }, [spEl('h3', { text: 'Flip plan' })]);
        let text;
        const top = d.buyers[0];
        const who = this.state.prefs.trustedOnly ? 'trusted buyer' : 'buyer';
        if (f && f.units === 0) text = 'One costs ' + formatMoney(f.needs) + ', more than your cash (' + formatMoney(this.state.prefs.cash) + ').';
        else if (d.planWhy === 'loading') text = 'Loading bazaars from TornW3B…';
        else if (!top) text = 'No flip: no ' + who + ' for this item.';
        else if (d.sellers.rows.some((r) => !r.stale)) text = 'No flip: the cheapest bazaar is ' + formatMoney(d.sellers.rows.find((r) => !r.stale).price - top.price) + ' over the best ' + who + '.';
        else if (d.sellers.rows.length) text = 'No flip: TornW3B has not seen these bazaars in the last 30 minutes.';
        else text = 'No flip: no bazaar is selling it.';
        card.appendChild(spEl('p', { class: 'sp-note', text }));
        return card;
    }

    /** Where to sell your N: a trader now, or wait in your bazaar or on the Item Market. Each row is its link. */
    whereCard(d) {
        const w = d.where;
        const card = spEl('div', { class: 'sp-q' }, [spEl('h3', { text: 'Where to sell your ' + count(d.held) })]);
        const b = d.buyers[0];
        const n = d.held;
        const rows = [
            {
                venue: 'trader',
                name: 'Sell to trader' + (b ? ' ' + b.name : ''),
                when: 'Paid now, in one trade',
                url: b && b.id ? tradeUrl(b.id) : null,
                missing: 'No ' + (this.state.prefs.trustedOnly ? 'trusted ' : '') + 'trader buys it',
            },
            {
                venue: 'bazaar',
                name: 'Your bazaar',
                when: 'Paid when someone buys it · $1 under the cheapest',
                url: MY_BAZAAR_ADD_URL,
                missing: 'No bazaar listing to price against',
            },
            {
                venue: 'market',
                name: 'Item Market',
                when: 'Paid when someone buys it · after the 5% fee',
                url: MARKET_ADD_URL,
                missing: d.market.state === 'loading' ? 'Checking the Item Market…' : 'No Item Market listing to price against',
            },
        ];
        for (const r of rows) {
            const o = w.options.find((x) => x.venue === r.venue);
            const each = o ? o.each : null;
            const win = w.best === r.venue;
            const listAt = r.venue === 'bazaar' && each !== null ? ' at ' + formatMoney(each) : r.venue === 'market' && d.market.lowest > 1 ? ' at ' + formatMoney(d.market.lowest - 1) : '';
            const inner = [
                spEl('span', { class: 'sp-opt-l' }, [spEl('b', { text: r.name + listAt }), spEl('small', { text: each === null ? r.missing : r.when })]),
                spEl('span', { class: 'sp-opt-p' }, each === null ? ['–'] : [formatMoney(each * n), n > 1 ? spEl('small', { text: formatMoney(each) + ' each' }) : null]),
            ];
            if (r.url && each !== null) card.appendChild(this.link('', r.url, { cls: 'sp-opt' + (win ? ' sp-win' : ''), title: r.venue === 'trader' ? 'Start a trade' : r.venue === 'bazaar' ? 'Open your bazaar\'s add page' : 'Open the Item Market\'s add page', focus: 'where:' + r.venue, children: inner }));
            else card.appendChild(spEl('div', { class: 'sp-opt sp-opt-none' }, inner));
        }

        const bazaar = w.options.find((x) => x.venue === 'bazaar');
        let verdict = '';
        if (w.best === 'bazaar' || w.best === 'market') {
            const place = w.best === 'bazaar' ? 'your bazaar' : 'the Item Market';
            verdict = b ? 'Best: ' + place + ', ' + signed(w.gain) + ' more than the trader, but you wait for a buyer.' : 'Best: ' + place + '. ' + rows[0].missing + '.';
        } else if (w.best === 'trader') {
            verdict = 'Best: sell to trader ' + b.name + '.';
            if (bazaar && bazaar.each !== null) {
                const diff = (bazaar.each - b.price) * n;
                verdict += diff > 0 ? ' Your bazaar would get only ' + signed(diff) + ' more, and you would wait.' : ' Your bazaar would get ' + formatMoney(-diff) + ' less.';
            }
        }
        if (verdict) card.appendChild(spEl('p', { class: 'sp-verdict' + (w.best && w.best !== 'trader' ? ' sp-win' : ''), text: verdict }));
        return card;
    }

    /**
     * The desk stays in view while the list scrolls. When it is taller than
     * the window, it scrolls with the page until its bottom shows, then stays.
     */
    fitDesk() {
        if (!this.root || this.view !== 'list') return;
        const room = this.listEl.clientHeight;
        const h = this.deskEl.offsetHeight;
        if (!room || !h) return;
        this.deskEl.style.top = Math.min(16, room - h - 16) + 'px';
    }

    /** A picture, kept per place so a re-render never reloads it. */
    image(place, itemId) {
        const key = place + ':' + itemId;
        let img = this.images.get(key);
        if (!img) {
            img = spEl('img', { class: 'sp-img', alt: '', loading: 'lazy', src: itemImageUrl(itemId) });
            img.addEventListener('error', () => img.classList.add('sp-img-none'));
            this.images.set(key, img);
        }
        return img;
    }

    /** What an item with no trader says: only "No Trader Found" once every source has answered. */
    noTraderText(d) {
        const info = this.state.info || {};
        const p = this.state.prefs;
        if (!info.knownTraders) return 'No traders yet';
        if (d && d.pending) return 'Checking…';
        if (p.onlineOnly && p.trustedOnly) return 'No trusted buyer online';
        if (p.onlineOnly) return 'No trader online';
        if (p.trustedOnly) return 'No trusted trader';
        return 'No Trader Found';
    }

    /** Trusted / Known / New / Caution, from other players' votes; the numbers on hover. */
    trustBadge(b) {
        const t = b && b.trust;
        if (!t) return null;
        const parts = [];
        if (t.votes !== null) parts.push('TornExchange votes ' + (t.votes >= 0 ? '+' : '') + t.votes);
        if (t.up !== null) parts.push('TornW3B rating ' + t.up + '↑ ' + t.down + '↓');
        return spEl('span', { class: 'sp-trust', 'data-level': t.level.toLowerCase(), title: parts.join(' · '), text: t.level });
    }

    /** A dot and a word: Online, Idle 5m, Offline 3h, Online · Hospital. Nothing when not known yet. */
    status(buyer) {
        const st = buyer && buyer.id && this.state.statuses ? this.state.statuses.get(String(buyer.id)) : null;
        const box = spEl('span', { class: 'sp-status', title: st ? buyer.name + ': ' + st.title : '' });
        if (st) box.append(spEl('span', { class: 'sp-dot', 'data-level': st.level }), st.text);
        return box;
    }
}

export const SELLING_PAGE_CSS = LEDGER_CSS + `
:host { all: initial; }
* { box-sizing: border-box; }
.sp-page {
${TOKENS_CSS}
    --page: #131313; --rail: #171717; --card: #1f1f1f; --card2: #252525;
    --cline: #2b2b2b; --cline2: #393939; --price: #a8dd1c; --green-bg: rgba(153, 204, 0, 0.10);
    --hot: #1f2616; --hot-line: #4a5d20; --orange: #e07b39; --head-h: 60px;
    position: absolute; inset: 0; display: flex; flex-direction: column;
    background: var(--page); color: var(--text);
    font: 13px/1.45 Arial, Helvetica, sans-serif;
}
button, input { font: inherit; color: inherit; }
a { color: var(--offer); text-decoration: none; }
a:hover { text-decoration: underline; }
b { font-weight: bold; }
[hidden] { display: none !important; }
.sp-bad { color: var(--bad); }
.sp-note { margin: 0; font-size: 12px; color: var(--muted); }
button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible,
[role="button"]:focus-visible { outline: 2px solid var(--profit); outline-offset: 2px; }

/* ---------------------------------------------------------------- header */
.sp-head {
    flex: 0 0 auto; height: var(--head-h); display: flex; align-items: center; gap: 16px; padding: 0 24px;
    background: linear-gradient(180deg, #1d1d1d, #181818); border-bottom: 1px solid var(--cline);
}
.sp-brand { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.sp-mark { width: 32px; height: 32px; border-radius: 9px; background: var(--profit); color: #131313; display: grid; place-items: center; font-weight: 900; font-size: 17px; }
.sp-brand h1 { margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.3px; }
.sp-tagline { color: var(--muted); font-size: 13px; }
.sp-search { flex: 1; min-width: 0; max-width: 420px; height: 36px; padding: 0 16px; border-radius: 18px; border: 1px solid var(--cline2); background: #0f0f0f; color: var(--text); }
.sp-search::placeholder { color: var(--muted); }
.sp-cat { flex: 0 0 auto; height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--cline2); background: #0f0f0f; color: var(--text); font: inherit; font-weight: bold; cursor: pointer; }
.sp-cat.sp-cat-on { border-color: var(--profit); background: #1a2210; color: #fff; }
.sp-catline { display: flex; align-items: center; gap: 8px; margin: -12px 0 16px; font-size: 12px; color: var(--muted); }
.sp-catline b { color: #fff; }
.sp-catline .sp-link { font-size: 12px; }
.sp-pills { margin-left: auto; display: flex; gap: 6px; }
.sp-pill { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px; border-radius: 14px; background: var(--card); border: 1px solid var(--cline); font-size: 12px; color: var(--muted); white-space: nowrap; cursor: default; }
.sp-pill b { color: var(--text); }
.sp-pill-btn { cursor: pointer; }
.sp-pill-btn:hover { border-color: var(--muted); color: var(--text); }
.sp-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 9px; border: 1px solid var(--cline2); background: none; cursor: pointer; font-size: 15px; color: var(--text); }
.sp-icon:hover { background: #242424; }
.sp-icon[aria-pressed="true"] { color: var(--profit); border-color: var(--profit); }
.sp-hbtn { height: 34px; padding: 0 12px; flex: 0 0 auto; border-radius: 9px; border: 1px solid var(--cline2); background: none; cursor: pointer; font-weight: bold; color: var(--text); white-space: nowrap; }
.sp-hbtn:hover { background: #242424; }
.sp-hbtn[aria-pressed="true"] { color: var(--profit); border-color: var(--profit); }
.sp-link.sp-danger { color: #ff8a80; }

.sp-banner {
    display: none; align-items: center; gap: 12px; flex: 0 0 auto;
    margin: 12px 24px 0; padding: 10px 14px;
    background: var(--card); border: 1px solid var(--cline); border-left: 4px solid var(--offer); border-radius: 10px;
}
.sp-banner > span { flex: 1; }
.sp-banner-on { display: flex; }
.sp-banner-warn { border-left-color: var(--warn); }
.sp-banner-bad { border-left-color: var(--bad); }

/* ------------------------------------------------------------ buttons */
.sp-btn {
    height: 32px; padding: 0 14px; font-size: 13px; font-weight: bold; color: var(--text);
    background: #333; border: 1px solid #444; border-radius: 9px; cursor: pointer; white-space: nowrap;
}
.sp-btn:hover { border-color: var(--muted); }
.sp-btn.sp-primary { color: var(--on-profit); background: var(--profit); border-color: var(--profit); }
.sp-link { background: none; border: 0; padding: 0; color: var(--offer); font-size: 12px; cursor: pointer; text-align: left; }
.sp-link:hover { text-decoration: underline; }
.sp-toggle { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--cline2); background: none; color: var(--muted); font-weight: bold; cursor: pointer; white-space: nowrap; }
.sp-toggle:hover { color: var(--text); }
.sp-toggle[aria-pressed="true"] { color: #fff; border-color: var(--profit); background: var(--green-bg); }

/* ----------------------------------------------------- one scroll, full width */
.sp-main { flex: 1; min-height: 0; overflow-y: auto; }
.sp-wrap { padding: 16px 24px 64px; }
.sp-sec { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
.sp-sec h2 { margin: 0; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.sp-sp { flex: 1; }
.sp-empty { padding: 24px 16px; text-align: center; color: var(--muted); background: var(--card); border: 1px dashed var(--cline2); border-radius: 12px; }
.sp-more { display: block; margin: 12px auto 0; }

/* the strip: the best flips, whatever item they are */
.sp-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.sp-strip-empty { grid-column: 1 / -1; }
.sp-fc { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 12px 14px; text-align: left; background: var(--hot); border: 1px solid var(--hot-line); border-radius: 12px; cursor: pointer; }
.sp-fc:hover { background: #232d18; }
.sp-fc.sp-sel { box-shadow: 0 0 0 2px var(--profit); }
.sp-fc-top { display: flex; align-items: center; gap: 10px; }
.sp-fc .sp-iname { font-size: 14px; }
.sp-fc-p { font-size: 21px; font-weight: bold; color: var(--price); font-variant-numeric: tabular-nums; }
.sp-fc small { font-size: 12px; color: var(--muted); }
.sp-fc small b { color: var(--text); }
.sp-fc-sell { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.sp-fc-sell .sp-trust { margin-left: 2px; }

/* the desk: every item on the left, the one picked on the right */
.sp-desk { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 24px; align-items: start; }
.sp-col-list { min-width: 0; }
.sp-chips { display: flex; gap: 6px; margin-bottom: 10px; }
.sp-chip-f { flex: 1; height: 32px; border-radius: 16px; border: 1px solid var(--cline2); background: none; color: var(--muted); font-weight: bold; cursor: pointer; white-space: nowrap; }
.sp-chip-f small { font-weight: normal; font-size: 12px; margin-left: 4px; }
.sp-chip-f:hover { color: var(--text); }
.sp-chip-f[aria-pressed="true"] { color: #fff; border-color: var(--profit); background: var(--green-bg); }
.sp-it { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; padding: 8px 10px; margin-bottom: 4px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.sp-it:hover { background: var(--card); }
.sp-it.sp-sel { background: #232a17; border-color: var(--profit); }
.sp-it .sp-pic { grid-row: span 2; }
.sp-it small { grid-column: 2 / 4; font-size: 12px; color: var(--muted); }
.sp-it small:empty { display: none; }
.sp-badge { font-size: 12px; font-weight: bold; padding: 3px 8px; border-radius: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sp-badge:empty { display: none; }
.sp-badge-flip { color: var(--price); background: var(--green-bg); }
.sp-badge-list { color: var(--offer); background: rgba(116, 192, 252, 0.10); }
.sp-badge-sell { color: var(--muted); background: #262626; }

.sp-ws { position: sticky; top: 16px; min-width: 0; background: var(--rail); border: 1px solid var(--cline); border-radius: 14px; padding: 16px; }
.sp-wsh { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.sp-wst { display: flex; flex-direction: column; min-width: 0; }
.sp-wsname { font-size: 20px; font-weight: bold; color: #fff; }
.sp-wst small { color: var(--muted); font-size: 12px; }
.sp-quad { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.sp-q { min-width: 0; background: var(--card); border: 1px solid var(--cline); border-radius: 12px; padding: 12px 14px; }
.sp-q h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.sp-q.sp-hot { background: var(--hot); border-color: var(--hot-line); }
.sp-q.sp-wide { grid-column: 1 / -1; }
.sp-q > .sp-note + .sp-note { margin-top: 6px; }
.sp-tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 8px 6px; border-top: 1px solid var(--cline); }
.sp-q h3 + .sp-tr, .sp-q .sp-note + .sp-tr { border-top: 0; }
.sp-tr.sp-top { background: var(--green-bg); border-radius: 9px; border-top-color: transparent; }
.sp-tr.sp-top + .sp-tr { border-top-color: transparent; }
.sp-tr.sp-stale { opacity: 0.6; }
.sp-tr-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sp-tr-l small { font-size: 12px; color: var(--muted); }
.sp-tr-l small.sp-differ { color: var(--warn); }
.sp-note.sp-warnnote { color: var(--warn); }
.sp-trader-l { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.sp-pname { color: #fff; font-weight: bold; }
.sp-tprice { font-weight: bold; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-top .sp-tprice { color: var(--price); }
.sp-links { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.sp-tr .sp-links { display: grid; grid-template-columns: 64px 64px 76px; }
.sp-tr .sp-links.sp-links-one { display: flex; }
.sp-chip {
    display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 10px; font-size: 12px; white-space: nowrap;
    color: var(--offer); border: 1px solid #3d4f5c; border-radius: 8px;
}
.sp-chip:hover { text-decoration: none; background: rgba(116, 192, 252, 0.12); }
.sp-chip-none { visibility: hidden; }
.sp-showall { margin-top: 8px; }
.sp-big { font-size: 22px; font-weight: bold; color: var(--price); font-variant-numeric: tabular-nums; }
.sp-step { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 8px 0; border-top: 1px solid #2f3a1c; }
.sp-q .sp-note + .sp-step { margin-top: 6px; }
.sp-n { width: 22px; height: 22px; border-radius: 50%; background: var(--profit); color: #131313; font-weight: bold; font-size: 12px; display: grid; place-items: center; }
.sp-step .sp-trust { margin-left: 2px; }
.sp-step-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.sp-opt { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; padding: 8px 10px; margin-bottom: 6px; border-radius: 9px; border: 1px solid var(--cline); color: var(--text); }
a.sp-opt:hover { text-decoration: none; border-color: #3d4f5c; background: rgba(116, 192, 252, 0.06); }
.sp-opt-l { display: flex; flex-direction: column; min-width: 0; }
.sp-opt-l small, .sp-opt-p small { font-size: 12px; color: var(--muted); font-weight: normal; }
.sp-opt-p { display: flex; flex-direction: column; align-items: flex-end; font-size: 15px; font-weight: bold; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-opt.sp-win { border-color: var(--hot-line); background: var(--green-bg); }
.sp-opt.sp-win .sp-opt-p { color: var(--price); }
.sp-opt-none { color: var(--muted); }
.sp-verdict { margin: 4px 0 0; font-weight: bold; }
.sp-verdict.sp-win { color: var(--price); }

/* shared pieces */
.sp-pic { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 30px; flex: 0 0 auto; }
.sp-pic-s { width: 44px; height: 22px; }
.sp-pic-l { width: 80px; height: 40px; }
.sp-img { width: 100%; height: 100%; object-fit: contain; }
.sp-img-none { visibility: hidden; }
.sp-iname { color: #fff; }
.sp-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.sp-status:empty { display: none; }
.sp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #666; flex: 0 0 auto; }
.sp-dot[data-level="online"] { background: var(--profit); }
.sp-dot[data-level="idle"] { background: var(--warn); }
.sp-dot[data-level="offline"] { background: #666; }
/* Online, but in hospital, in jail or flying: may not trade right now. */
.sp-dot[data-level="busy"] { background: var(--orange); }
.sp-dot[data-level="bad"] { background: var(--bad); }
.sp-dot[data-level="unknown"] { background: transparent; border: 1px solid #777; }
.sp-trust {
    display: inline-flex; align-items: center; height: 18px; padding: 0 6px; flex: 0 0 auto;
    font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px;
    border-radius: 9px; border: 1px solid #555; color: var(--muted); cursor: help;
}
.sp-trust[data-level="trusted"] { color: #c3ea6f; border-color: #5c7a1e; background: rgba(153, 204, 0, 0.12); }
.sp-trust[data-level="known"] { color: #a7d4ff; border-color: #3d5a74; }
.sp-trust[data-level="caution"] { color: #f0a020; border-color: #7a5210; }

/* ------------------------------------------------------------ settings */
.sp-settings { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 24px; align-items: start; padding: 20px 24px 64px; }
.sp-snav { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 4px; }
.sp-snav-g { margin: 12px 12px 4px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.sp-snav-g:first-child { margin-top: 0; }
.sp-snav-a { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: 0; border-radius: 9px; background: none; color: var(--muted); font-weight: bold; text-align: left; cursor: pointer; }
.sp-snav-a:hover { background: var(--card); color: var(--text); }
.sp-snav-a[aria-current="true"] { background: var(--green-bg); color: #fff; box-shadow: inset 0 0 0 1px var(--hot-line); }
.sp-snav-a small { margin-left: auto; font-weight: normal; font-size: 12px; white-space: nowrap; }
.sp-sbody { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.sp-card { display: flex; flex-direction: column; padding: 20px; background: var(--card); border: 1px solid var(--cline); border-radius: 12px; scroll-margin-top: 20px; }
.sp-card h2 { margin: 0 0 4px; font-size: 15px; color: #fff; }
.sp-lead { margin: 0 0 14px; font-size: 12px; color: var(--muted); }
.sp-field { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 8px 24px; align-items: start; padding: 12px 0; border-top: 1px solid var(--cline); }
.sp-flabel { display: flex; flex-direction: column; padding-top: 8px; }
.sp-flabel small { font-size: 12px; color: var(--muted); }
.sp-fctl { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: 640px; }
.sp-fctl > .sp-keystate:only-child { padding-top: 8px; }
.sp-fctl > .sp-check { padding-top: 8px; }
.sp-inline { display: flex; gap: 8px; align-items: center; }
.sp-inline input { flex: 1; min-width: 0; }
.sp-inline.sp-pct input.sp-pctin { flex: 0 0 80px; text-align: right; }
.sp-inline.sp-actions { gap: 16px; }
input.sp-key { height: 34px; padding: 0 12px; background: #0f0f0f; border: 1px solid #444; border-radius: 9px; color: var(--text); }
input.sp-key::placeholder { color: var(--muted); }
.sp-masked { -webkit-text-security: disc; }
.sp-keystate { font-size: 12px; color: var(--muted); }
.sp-keystate.sp-ok { color: var(--profit); }
.sp-keystate.sp-bad { color: var(--bad); }
.sp-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
input[type="checkbox"] { accent-color: var(--profit); margin: 3px 0 0; }
.sp-tos { width: 100%; max-width: 900px; border-collapse: collapse; font-size: 12px; }
.sp-tos th, .sp-tos td { text-align: left; vertical-align: top; padding: 8px 4px; border-top: 1px solid var(--cline); }
.sp-tos th { width: 220px; color: var(--muted); font-weight: normal; }

/* ---------------------------------------------------------- narrower */
/* With the Category dropdown the header needs room: under 1500px the two
   background-progress pills go (TornW3B's state is in Settings too). On a
   phone the pills get a row of their own and all come back. */
@media (max-width: 1500px) and (min-width: 1001px) {
    .sp-pill[data-src="TornW3B"], .sp-pill[data-src="Online"] { display: none; }
}
@media (max-width: 1300px) {
    .sp-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 1200px) {
    .sp-tagline { display: none; }
    .sp-quad { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1000px) {
    .sp-head { flex-wrap: wrap; height: auto; min-height: var(--head-h); padding: 10px 12px; gap: 8px 10px; }
    .sp-brand { flex: 1; }
    .sp-search { order: 10; flex: 1 1 0; max-width: none; }
    .sp-cat { order: 10; }
    .sp-pills { order: 11; flex: 1 0 100%; flex-wrap: wrap; margin-left: 0; }
    .sp-wrap { padding: 12px 12px 48px; }
    .sp-sec { flex-wrap: wrap; }
    .sp-sec h2 { flex: 1 0 100%; }
    .sp-sp { display: none; }
    .sp-toggle { flex: 1; justify-content: center; }
    .sp-strip { grid-template-columns: minmax(0, 1fr); }
    .sp-desk { grid-template-columns: minmax(0, 1fr); }
    .sp-ws { position: static; order: -1; }
    .sp-settings { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 12px 12px 48px; }
    .sp-snav { position: static; flex-direction: row; flex-wrap: wrap; }
    .sp-snav-g, .sp-snav-a small { display: none; }
    .sp-snav-a { height: 34px; }
    .sp-card { padding: 16px; }
    .sp-field { grid-template-columns: minmax(0, 1fr); }
    .sp-flabel { padding-top: 0; }
    .sp-tos th { width: 40%; }
}
`;
