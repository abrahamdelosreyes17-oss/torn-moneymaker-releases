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

import { formatMoney, formatAge, parseMoneyInput, readWholeNumber } from '../core/parse.js';
import { UsageView, USAGE_CSS } from './usage-view.js';
import { ReportView, REPORT_CSS } from './report-view.js';
import { TOKENS_CSS } from './styles.js';
import { TORN_API_KEY_URL } from './panel.js';
import { TE_SITE_URL, tePriceListUrl } from '../api/te.js';
import { w3bPriceListUrl } from '../api/w3b.js';
import { bazaarUrl } from '../core/feed.js';
import { extrasPerTrade, EXTRA_ITEMS_MAX } from '../core/trade.js';
import { itemMarketUrl } from '../sources/route.js';
import { LedgerView, LEDGER_CSS } from './ledger-view.js';
import { keyInputAttrs, keyMask } from './mask.js';

export const SELLING_PAGE_TITLE = 'Torn Bids';

export const SELLING_PAGE_DEFAULTS = {
    /* Only traders known to be online. */
    onlineOnly: false,
    /* Only traders whose trust badge is Trusted. On from the start: money changes hands on trust. */
    trustedOnly: true,
    /* Flips never plan to spend more than this; null is no limit. */
    cash: null,
    /* The last Cash amount, kept while No limit is picked (Up to brings it back). */
    cashLast: null,
    /* The most items one flip buys: no trader takes thousands. */
    maxPerFlip: 100,
    /* Extra items a trade adds beside the main flip, 1 to 10 (3.14.3; each from at most 3 bazaars). */
    extraItems: 5,
    /* Your traders (favourites and Trusted): the section is open. */
    scanOpen: true,
    /* Every link opens a new tab. */
    linksNewTab: true,
    /* A flip never asks a trader to pay more than this share of their networth. */
    networthPct: 10,
    /* A flip buys only listings that make at least this % per item: $1 is for NPC shops, not people. */
    minProfitPct: 1,
    /* What you keep of your own when a trade offers it: itemId -> n | 'all'. */
    keep: {},
    /*
     * Categories a flip (and so a trade) never buys: the friend, 2026-09-27,
     * "don't include clothes". Weapons, armour and cars are never flipped
     * whatever this says (every copy is its own).
     */
    neverFlip: ['Clothing', 'Other'],
};

/* Your traders: this many cards before "Show all". */
const SCAN_SHOWN = 5;

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

/** The pin (3.14): an outline pin, drawn in the current colour. */
/** $809,351 or $809,351–$820,000: what a plan's steps cost each. */
function priceRange(steps) {
    const prices = (steps || []).map((st) => st.price).filter((p) => p > 0);
    if (!prices.length) return '–';
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? formatMoney(lo) : formatMoney(lo) + '–' + formatMoney(hi);
}

/** A speech bubble, drawn in the current colour (Chat). */
function chatIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3h0A1.5 1.5 0 0 1 2 9.5z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

function pinIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M10.5 1.5l4 4-2 1-2.5 2.5.5 3-1.5 1.5-3-3-3.5 3.5-.5-.5 3.5-3.5-3-3L4.5 5l3 .5L10 3z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

/*
 * Number boxes behave like any form (3.14.3, the owner: "I click on 20, I have
 * to click right of the 0 and backspace... I can't just double-click and type
 * normally"): clicking into one, or tabbing in, selects what is there, so what
 * you type replaces it. A second click places the caret as usual.
 */
function selectOnFocus(input) {
    let fresh = false;
    let pressed = false;
    input.addEventListener('pointerdown', () => {
        pressed = document.activeElement !== input && (!input.getRootNode || input.getRootNode().activeElement !== input);
    });
    input.addEventListener('focus', () => {
        // Tabbed in: selected, and a later click places the caret as usual.
        fresh = pressed;
        pressed = false;
        input.select();
    });
    // The click that focused it would put the caret back: keep the selection.
    input.addEventListener('mouseup', (event) => {
        // A drag chose its own part: kept. A plain click: the whole number again.
        if (fresh && input.selectionStart === input.selectionEnd) {
            event.preventDefault();
            input.select();
        }
        fresh = false;
    });
    input.addEventListener('keydown', () => {
        fresh = false;
    });
}

/** A box that refused what was typed: red for a moment, and why - written beside it, and read out. */
function flashBad(input, why) {
    input.classList.add('sp-in-bad');
    input.setAttribute('aria-invalid', 'true');
    const said = spEl('span', { class: 'sp-inerr', role: 'alert', text: ' ' + why });
    input.after(said);
    setTimeout(() => {
        input.classList.remove('sp-in-bad');
        input.removeAttribute('aria-invalid');
        said.remove();
    }, 3000);
}

function spEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (!key.startsWith('on') && value !== null && value !== undefined && value !== false) {
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

/** "+$3,500" / "−$60,005": money made or lost. */
function signed(n) {
    return (n >= 0 ? '+' : '−') + formatMoney(Math.abs(n));
}

function count(n) {
    return Number(n).toLocaleString('en-US');
}

/** A masked key field with Show / Save. The saved key is never left in the field. */
function keyField({ placeholder, onSave, onReveal, primary = false }) {
    const input = spEl('input', { ...keyInputAttrs(), class: 'sp-key', placeholder });
    const show = spEl('button', { type: 'button', class: 'sp-btn', text: 'Show' });
    const mask = keyMask(input, 'sp-masked', {
        onReveal: onReveal || null,
        onChange: (hidden) => {
            show.textContent = hidden ? 'Show' : 'Hide';
        },
    });
    show.addEventListener('click', () => mask.toggle());
    // No Save button (3.14.3, the owner: "just instant save upon clicking away
    // or enter"): what you pasted is saved on Enter or on leaving the box. The
    // box is emptied at once - a saved key is never left in the page.
    const save = () => {
        const key = input.value.trim();
        if (!key) return;
        mask.hide();
        input.value = '';
        onSave(key);
    };
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            input.value = '';
            input.blur();
            return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        save();
    });
    // Leaving the box saves - but not a click on its own Show button.
    input.addEventListener('blur', (event) => {
        if (event.relatedTarget === show) return;
        save();
    });
    void primary;
    return { input, row: spEl('div', { class: 'sp-inline' }, [input, show]) };
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
                // Nothing is left unsaved (leaving a box saves it): Esc goes back.
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

    /** Settings › Flips › Keep for yourself: each item kept, with Remove. */
    /** Settings › Flips › Never flip: a tick per category (Torn's item types). */
    renderNeverFlip(p) {
        if (!this.neverListEl) return;
        const never = new Set((p && p.neverFlip) || []);
        const seen = (this.state.categories || []).map((c) => c.category);
        const cats = [...new Set([...seen, ...never])].filter((c) => !/^(Melee|Primary|Secondary|Defensive|Weapon|Armor|Armour|Car)$/.test(c)).sort((a, b) => a.localeCompare(b));
        const sig = JSON.stringify([cats, [...never]]);
        if (sig === this.neverSig) return;
        this.neverSig = sig;
        this.neverListEl.textContent = '';
        for (const c of cats) {
            const input = spEl('input', { type: 'checkbox', 'data-focus': 'never:' + c });
            input.checked = never.has(c);
            input.addEventListener('change', () => {
                const next = new Set((this.state.prefs && this.state.prefs.neverFlip) || []);
                if (input.checked) next.add(c);
                else next.delete(c);
                if (this.h.onPrefsChange) this.h.onPrefsChange({ neverFlip: [...next] });
            });
            this.neverListEl.appendChild(spEl('label', { class: 'sp-check sp-never' }, [input, spEl('span', { text: c })]));
        }
    }

    renderKeepList(p) {
        if (!this.keepListEl) return;
        const keep = Object.entries((p && p.keep) || {});
        const sig = JSON.stringify(keep);
        if (sig === this.keepSig) return;
        this.keepSig = sig;
        this.keepListEl.textContent = '';
        if (!keep.length) {
            this.keepListEl.appendChild(spEl('div', { class: 'sp-keystate', text: 'Nothing kept: a trade offers all of it.' }));
            return;
        }
        const nameOf = this.state.itemNameOf || ((id) => 'Item ' + id);
        for (const [id, k] of keep) {
            this.keepListEl.appendChild(spEl('div', { class: 'sp-keeprow' }, [
                spEl('span', { text: nameOf(id) + ': keep ' + (k === 'all' ? 'all' : count(k)) }),
                spEl('button', { type: 'button', class: 'sp-btn', text: 'Remove', onclick: () => this.h.onKeepRemove && this.h.onKeepRemove(id) }),
            ]));
        }
    }

    /** Settings › Flips › Blacklisted traders: each with Undo (3.14.3; also in Ledger › Traders). */
    renderBlackList() {
        if (!this.blackListEl) return;
        const list = this.state.blacklist || [];
        const sig = JSON.stringify(list.map((x) => [x.key, x.name]));
        if (sig === this.blackSig) return;
        this.blackSig = sig;
        this.blackListEl.textContent = '';
        if (!list.length) {
            this.blackListEl.appendChild(spEl('div', { class: 'sp-keystate', text: 'Nobody blacklisted.' }));
            return;
        }
        for (const x of list) {
            this.blackListEl.appendChild(spEl('div', { class: 'sp-keeprow' }, [
                spEl('span', { text: x.name || (x.id ? 'Player ' + x.id : 'Someone') }),
                spEl('button', { type: 'button', class: 'sp-btn', 'data-focus': 'set:unblk:' + x.key, 'aria-label': 'Take ' + (x.name || 'them') + ' off the blacklist', text: 'Undo', onclick: () => this.h.onBlacklist && this.h.onBlacklist({ id: x.id, name: x.name }, false) }),
            ]));
        }
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
        }, [spEl('span', { class: 'sp-trust', 'data-level': 'trusted', 'aria-hidden': 'true', text: 'T' }), 'Trusted buyers only']);
        this.stripEl = spEl('div', { class: 'sp-strip' });
        // Numbers update under your pointer, the order does not: a card never
        // moves while you are about to press it (3.14).
        this.stripEl.addEventListener('mouseenter', () => {
            this.stripHover = true;
        });
        this.stripEl.addEventListener('mouseleave', () => {
            this.stripHover = false;
            this.renderStrip();
        });
        this.catLineEl = spEl('div', { class: 'sp-catline', hidden: '' });
        /* Your traders: the best whole trade with each favourite and Trusted trader now (3.14.3) */
        this.scanEl = spEl('section', { class: 'sp-scan', 'aria-label': 'Your traders' });
        this.scanAll = false;

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
                this.scanEl,
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
            onFavourite: (b, on) => this.h.onFavourite && this.h.onFavourite(b, on),
            onBlacklist: (b, on) => this.h.onBlacklist && this.h.onBlacklist(b, on),
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

        /*
         * Settings boxes (3.14.3, mockup R-inputs A, picked by the owner): the
         * box always shows what is saved; a click or Tab selects it, so typing
         * replaces it; Enter, Tab or clicking away saves, and a green Saved ✓
         * shows for 2 seconds; Esc puts the saved value back; a bad value turns
         * the box red with the reason under it, and the saved one stays in
         * force; an emptied box puts the saved value back. No Save buttons.
         */
        this.boxes = [];
        const settingBox = (input, stateEl, { read, show }) => {
            selectOnFocus(input);
            const saved = () => show(this.state.prefs || SELLING_PAGE_DEFAULTS);
            let bad = false;
            let savedTimer = null;
            const clearBad = () => {
                bad = false;
                input.classList.remove('sp-in-bad');
                input.removeAttribute('aria-invalid');
            };
            const say = (text, cls = '') => {
                stateEl.textContent = text;
                stateEl.className = 'sp-keystate' + (cls ? ' ' + cls : '');
            };
            // Returns false when refused.
            const commit = () => {
                const text = input.value.trim();
                if (!text || text === saved()) {
                    input.value = saved();
                    clearBad();
                    if (!savedTimer) say('');
                    return true;
                }
                const r = read(text);
                if (r.error) {
                    bad = true;
                    input.classList.add('sp-in-bad');
                    input.setAttribute('aria-invalid', 'true');
                    say(r.error + (saved() ? ' Still ' + saved() + '.' : ''), 'sp-bad');
                    return false;
                }
                clearBad();
                if (this.h.onPrefsChange) this.h.onPrefsChange(r.patch);
                input.value = saved();
                say('Saved ✓', 'sp-ok');
                clearTimeout(savedTimer);
                savedTimer = setTimeout(() => {
                    savedTimer = null;
                    if (!bad) say('');
                }, 2000);
                return true;
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    // Esc: the saved value, unchanged - and the page stays open.
                    event.preventDefault();
                    event.stopPropagation();
                    input.value = saved();
                    clearBad();
                    say('');
                    input.blur();
                    return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // Saved: out of the box. Refused: stays, all selected, to type again.
                if (commit()) input.blur();
                else input.select();
            });
            const box = {
                commit,
                // The saved value, unless you are in the box or it is showing a refusal.
                sync: () => {
                    const active = input.getRootNode && input.getRootNode().activeElement;
                    if (active !== input && !bad) input.value = saved();
                },
            };
            this.boxes.push(box);
            return box;
        };

        /* Cash for flips: No limit, or Up to an amount (mockup R-inputs D) */
        this.cashInput = spEl('input', { type: 'text', class: 'sp-key', 'aria-label': 'Cash for flips: up to', autocomplete: 'off', spellcheck: 'false', 'data-focus': 'set:cash' });
        this.cashStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        const cashAmount = (p) => (p.cash > 0 ? p.cash : p.cashLast > 0 ? p.cashLast : null);
        this.cashBox = settingBox(this.cashInput, this.cashStateEl, {
            show: (p) => (cashAmount(p) ? formatMoney(cashAmount(p)) : ''),
            read: (text) => {
                const cash = parseMoneyInput(text);
                if (cash === null) return { error: 'Could not read "' + text + '". Try 5000000, 5m or 500k.' };
                if (!(cash > 0)) return { error: 'Cash must be more than $0 (or pick No limit).' };
                return { patch: { cash, cashLast: cash } };
            },
        });
        const cashRadio = (value, label) => {
            const input = spEl('input', { type: 'radio', name: 'sp-cash-mode', value, 'data-focus': 'set:cashmode:' + value });
            input.addEventListener('change', () => {
                if (!input.checked) return;
                const p = this.state.prefs || SELLING_PAGE_DEFAULTS;
                if (value === 'none') {
                    // The amount waits, greyed, for when you pick Up to again.
                    if (this.h.onPrefsChange) this.h.onPrefsChange({ cash: null, cashLast: p.cash > 0 ? p.cash : p.cashLast || null });
                } else if (cashAmount(p)) {
                    if (this.h.onPrefsChange) this.h.onPrefsChange({ cash: cashAmount(p) });
                } else {
                    this.cashInput.focus();
                }
            });
            return input;
        };
        this.cashNone = cashRadio('none', 'No limit');
        this.cashUpTo = cashRadio('upto', 'Up to');
        // Clicking the box picks Up to.
        this.cashInput.addEventListener('focus', () => {
            this.cashUpTo.checked = true;
        });

        /* Most items per flip */
        this.maxInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'Most per flip', autocomplete: 'off', spellcheck: 'false', inputmode: 'numeric', 'data-focus': 'set:max' });
        this.maxStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        this.maxBox = settingBox(this.maxInput, this.maxStateEl, {
            show: (p) => String(p.maxPerFlip || 100),
            read: (text) => {
                // A whole number, or refused (3.14.3: 1.7 was saved as 1).
                const n = readWholeNumber(text);
                return n >= 1 ? { patch: { maxPerFlip: n } } : { error: 'Type a whole number of items, 1 or more.' };
            },
        });
        /* Extras per trade: 1 to 10 */
        this.extraInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'Extras per trade', autocomplete: 'off', spellcheck: 'false', inputmode: 'numeric', 'data-focus': 'set:extra' });
        this.extraStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        this.extraBox = settingBox(this.extraInput, this.extraStateEl, {
            show: (p) => String(extrasPerTrade(p.extraItems)),
            read: (text) => {
                const n = readWholeNumber(text);
                return n >= 1 && n <= EXTRA_ITEMS_MAX ? { patch: { extraItems: n } } : { error: 'Type a whole number from 1 to ' + EXTRA_ITEMS_MAX + '.' };
            },
        });
        /* Trader can pay: a percent of their networth */
        this.nwInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'Networth share a trader can pay', autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal', 'data-focus': 'set:nw' });
        this.nwStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        this.nwBox = settingBox(this.nwInput, this.nwStateEl, {
            show: (p) => String(p.networthPct || 10),
            read: (text) => {
                const n = Number(String(text).replace(/[%,\s]/g, ''));
                return n >= 1 && n <= 100 ? { patch: { networthPct: n } } : { error: 'Type a percent from 1 to 100.' };
            },
        });
        /* Least profit per item */
        this.minInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'Least profit per item, percent', autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal', 'data-focus': 'set:min' });
        this.minStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        this.minBox = settingBox(this.minInput, this.minStateEl, {
            show: (p) => String(p.minProfitPct ?? 1),
            read: (text) => {
                const raw = String(text).replace(/[%,\s]/g, '');
                const n = Number(raw);
                return raw && n >= 0 && n <= 100 ? { patch: { minProfitPct: n } } : { error: 'Type a percent from 0 to 100.' };
            },
        });

        /* API use (3.15): what every request to Torn, TornW3B and TornExchange was for, over time */
        group('API use');
        this.usageView = new UsageView();
        section('api', 'API use', [
            'Every request this script sends, from every tab - Torn Bids and Torn\'s pages - by what it was for. ',
            'Torn\'s limit is shared by everything you run with your keys, so its calls wait in lanes: what you are doing now goes first, statuses and the Ledger wait for room.',
        ], [this.usageView.el]);

        /* Report a problem (3.15): your words, screenshots, the problem log - one zip to send */
        group('Help');
        this.reportView = new ReportView({ getReport: () => (this.h.getReport ? this.h.getReport() : { log: [] }), onClearLog: () => this.h.onClearLog && this.h.onClearLog() });
        section('report', 'Report a problem', 'Found a bug? Say what happened, add screenshots, and download one .zip to send. It also holds the problem log - what failed and what you did just before, in every tab - so the cause can be found without guessing. Nothing is sent anywhere by this page.', [this.reportView.el]);

        group('Torn Bids');
        section('flips', 'Flips', 'What Best flips and the flip plan may suggest.', [
            field('Cash for flips', null, [
                spEl('div', { class: 'sp-radio', role: 'radiogroup', 'aria-label': 'Cash for flips' }, [
                    spEl('label', { class: 'sp-radio-o' }, [this.cashNone, spEl('span', { text: 'No limit' })]),
                    spEl('label', { class: 'sp-radio-o' }, [this.cashUpTo, spEl('span', { text: 'Up to' }), this.cashInput]),
                ]),
                this.cashStateEl,
                note(['Flips never plan to spend more than this. Reads 5000000, 5,000,000, 5m or 500k.']),
            ]),
            field('Most per flip', null, [
                spEl('div', { class: 'sp-inline sp-pct' }, [this.maxInput, ' items']),
                this.maxStateEl,
                note(['The most items one flip plans to buy. No trader takes thousands at once.']),
            ]),
            field('Extras per trade', null, [
                spEl('div', { class: 'sp-inline sp-pct' }, ['Up to ', this.extraInput, ' items besides the main flip']),
                this.extraStateEl,
                note(['Items the same trader also buys, as cover for the main flip. Each from at most 3 bazaars; the rest are under Show them. 1 to ' + EXTRA_ITEMS_MAX + '.']),
            ]),
            field('Trader can pay', null, [
                spEl('div', { class: 'sp-inline sp-pct' }, ['At most ', this.nwInput, ' % of their networth']),
                this.nwStateEl,
                note(['A flip never asks a trader to pay more than this share of their networth. Networth comes from Torn\'s public stats, read with your Limited key.']),
            ]),
            field('Never flip', null, [
                (this.neverListEl = spEl('div', { class: 'sp-neverlist' })),
                note(['Flips and trades never buy these. Weapons, armour and cars never, whatever is ticked: every copy is its own.']),
            ]),
            field('Keep for yourself', null, [
                (this.keepListEl = spEl('div', { class: 'sp-keeplist' })),
                note(['What a trade leaves out of what you hold. Set it in a trade: untick one of yours, or give fewer than you hold.']),
            ]),
            field('Least profit per item', null, [
                spEl('div', { class: 'sp-inline sp-pct' }, ['At least ', this.minInput, ' % of the price']),
                this.minStateEl,
                note(['A flip skips listings that make less than this on each item. A trader is a person: $1 under their price is not worth a trade.']),
            ]),
            // Blacklisted traders, with Undo - here too, for anyone without a Ledger key (3.14.3).
            field('Blacklisted traders', null, [
                (this.blackListEl = spEl('div', { class: 'sp-keeplist' })),
                note(['Never a buyer in flips, trades or Where to sell. Their bazaars are still bought from.']),
            ]),
        ]);

        /* the Torn Ledger's Full key: masked, never shown again, its own terms */
        // A text box masked by CSS, never a password box (ui/mask.js): a
        // browser would offer to save a Full key into its synced passwords.
        this.ledgerKeyInput = spEl('input', {
            ...keyInputAttrs(),
            class: 'sp-key',
            placeholder: 'Full API key',
            'aria-label': 'Full API key for the Torn Ledger',
        });
        keyMask(this.ledgerKeyInput, 'sp-masked');
        // Enter or leaving the box saves what you pasted (no Save button, 3.14.3).
        const saveLedgerKey = () => {
            const key = this.ledgerKeyInput.value.trim();
            if (!key) return;
            this.ledgerKeyInput.value = '';
            if (this.h.onLedgerSaveKey) this.h.onLedgerSaveKey(key);
        };
        this.ledgerKeyInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.ledgerKeyInput.value = '';
                this.ledgerKeyInput.blur();
                return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveLedgerKey();
        });
        this.ledgerKeyInput.addEventListener('blur', saveLedgerKey);
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
            field('Full key', 'Never shown again once saved', [
                spEl('div', { class: 'sp-inline' }, [this.ledgerKeyInput]),
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
            report: (() => {
                const log = this.problemLog || [];
                const day = log.filter((e) => e.kind === 'error' && now - e.at < 86400000).length;
                return day ? ['idle', day + (day === 1 ? ' error' : ' errors') + ' today'] : ['online', 'no errors'];
            })(),
            api: (() => {
                const u = this.usage && this.usage.live && this.usage.live.t;
                if (!u) return ['idle', ''];
                return [u.used >= u.cap * 0.95 ? 'bad' : u.used >= u.cap * 0.8 ? 'idle' : 'online', 'Torn ' + u.used + '/' + u.cap];
            })(),
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

    /** API use, drawn again every few seconds while Settings is open. */
    renderUsage() {
        if (!this.usageView || !this.h.getUsage) return;
        this.usage = this.h.getUsage();
        this.usageView.render(this.usage);
        if (this.reportView) {
            this.problemLog = this.h.getReport ? this.h.getReport().log || [] : [];
            this.reportView.render();
        }
    }

    showView(view) {
        this.view = view === 'settings' || view === 'ledger' ? view : 'list';
        if (!this.root) return;
        const settings = this.view === 'settings';
        if (settings && !this.usageTimer) {
            this.renderUsage();
            this.usageTimer = setInterval(() => this.renderUsage(), 5000);
        } else if (!settings && this.usageTimer) {
            clearInterval(this.usageTimer);
            this.usageTimer = null;
        }
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
        // Every settings box shows what is saved (not while you are in it).
        for (const box of this.boxes || []) box.sync();
        const hasCash = p.cash > 0;
        this.cashNone.checked = !hasCash;
        if (!(this.cashInput.getRootNode && this.cashInput.getRootNode().activeElement === this.cashInput)) this.cashUpTo.checked = hasCash;
        this.cashInput.classList.toggle('sp-dim', !hasCash);
        this.renderKeepList(p);
        this.renderNeverFlip(p);
        this.renderBlackList();

        this.renderCategory();
        this.renderLedgerKey();
        if (this.view === 'ledger') this.ledgerView.render(this.ledgerArgs());
        this.renderKeyStates();
        this.renderSettingsNav();
        this.renderPills();
        this.renderBanner();
        this.renderStrip();
        this.renderScan();
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
        if (info.teKeyMsg) {
            this.teStateEl.textContent = info.teKeyMsg;
            this.teStateEl.classList.add('sp-bad');
        } else if (info.teBadKey || (info.teError && !info.hasTeKey)) {
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

        const say = (text, level, label, fn, label2 = null, fn2 = null) => {
            b.classList.add('sp-banner-on');
            if (level) b.classList.add('sp-banner-' + level);
            b.appendChild(spEl('span', { text }));
            if (label && this.view !== 'settings') {
                b.appendChild(spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: label, onclick: fn }));
                if (label2) b.appendChild(spEl('button', { type: 'button', class: 'sp-btn', text: label2, onclick: fn2 }));
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
            // What the button does, before it does it: this key goes to tornexchange.com.
            say('Most traders post their prices on TornExchange (tornexchange.com). It reads them only with the Torn key you log in there with. If that is your Limited key, this sends it to TornExchange too.', null, 'Use my Limited key', useLimited);
        } else if (info.teBadKey && !info.teSameAsLimited) {
            // Its message says "then Try again": the button is there (review M13).
            say(info.teError || 'TornExchange did not accept this key.', 'bad', 'Try again', () => this.h.onRetryTe && this.h.onRetryTe(), 'Use my Limited key', useLimited);
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

    /** The focus key of what has the focus inside `box`, or null. */
    focusKeyIn(box) {
        const shadow = this.root && this.root.getRootNode();
        const active = shadow && shadow.activeElement;
        return active && box.contains(active) && active.dataset ? active.dataset.focus || null : null;
    }

    /** After `box` was drawn again: the focus back on the same thing's new copy. */
    focusBack(box, key) {
        if (!key) return;
        const node = [...box.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === key);
        if (node) node.focus({ preventScroll: true });
    }

    /**
     * Your traders (3.14.3; mockup Q4 A, collapsible): one card per favourite
     * and Trusted trader - the best whole trade with them now, and Put on desk.
     * Folded, it says how many; open, the biggest trades first.
     */
    renderScan() {
        const s = this.state;
        const sc = s && s.scan;
        const box = this.scanEl;
        if (!sc) return;
        const refocus = this.focusKeyIn(box);
        queueMicrotask(() => this.focusBack(box, refocus));
        const sig = JSON.stringify([sc.open, sc.favourites, sc.trusted, this.scanAll, s.desk && s.desk.itemId, s.desk && s.desk.trade && s.desk.trade.chosen && s.desk.trade.chosen.key,
            sc.list.map((x) => [x.id, x.name, x.profit, x.items, x.stops, x.reading, x.lastPaid, x.mainId, x.mainUnits, x.favourite, x.traded, x.trust && x.trust.level + x.trust.score])]);
        if (sig === this.scanSig) return;
        this.scanSig = sig;
        box.textContent = '';
        const total = sc.favourites + sc.trusted;
        const toggle = () => this.h.onPrefsChange && this.h.onPrefsChange({ scanOpen: !sc.open });
        box.appendChild(spEl('div', { class: 'sp-sec sp-scanh' }, [
            spEl('button', { type: 'button', class: 'sp-fold', 'aria-expanded': String(sc.open), 'data-focus': 'scan:fold', title: sc.open ? 'Fold away' : 'Show the best trade with each', onclick: toggle }, [
                spEl('span', { class: 'sp-chev', text: sc.open ? '▾' : '▸' }),
                spEl('h2', { text: 'Your traders · best trade now' }),
            ]),
            spEl('span', { class: 'sp-sp' }),
            spEl('small', { class: 'sp-muted', text: total ? count(sc.favourites) + (sc.favourites === 1 ? ' favourite' : ' favourites') + ' · ' + count(sc.trusted) + ' trusted' : 'No favourites or trusted traders yet' }),
        ]));
        if (!sc.open || !total) return;
        const onDesk = s.desk && s.desk.trade && s.desk.trade.chosen ? s.desk.trade.chosen.key : null;
        const shown = this.scanAll ? sc.list : sc.list.slice(0, SCAN_SHOWN);
        const grid = spEl('div', { class: 'sp-scangrid' });
        for (const x of shown) {
            const ready = x.items > 0 && x.profit > 0;
            const sel = ready && onDesk === x.key && s.desk && s.desk.itemId === x.mainId;
            const head = spEl('span', { class: 'sp-fc-top' }, [
                x.favourite ? spEl('span', { class: 'sp-star', title: 'Favourite', text: '★' }) : null,
                spEl('b', { class: 'sp-iname', text: x.name }),
                this.trustBadge(x),
                x.lastPaid ? spEl('span', { class: 'sp-lastpaid', title: 'No public list: the prices they accepted from you last time. Check before buying.', text: 'Last paid' }) : null,
            ]);
            const card = spEl('div', { class: 'sp-fc sp-tc' + (ready ? ' sp-tc-ready' : ' sp-tc-none') + (sel ? ' sp-sel' : '') }, [head]);
            if (ready) {
                card.append(
                    spEl('span', { class: 'sp-fc-p' + (x.lastPaid || x.estimated ? ' sp-est' : ''), title: x.lastPaid ? 'About: from what they paid you last time' : x.estimated ? 'About: some bazaars are still being read' : null, text: (x.lastPaid || x.estimated ? '≈ ' : '') + 'Trade ' + signed(x.profit) }),
                    spEl('small', {}, [spEl('b', { text: count(x.items) + (x.items === 1 ? ' item' : ' items') }), ' · ' + count(x.stops) + (x.stops === 1 ? ' bazaar' : ' bazaars') + (x.mainName ? ' · ' + x.mainName + ' ×' + count(x.mainUnits) + (x.items > 1 ? ' + ' + count(x.items - 1) + (x.items === 2 ? ' extra' : ' extras') : '') : '')]),
                );
            } else {
                card.appendChild(spEl('small', { text: x.reading ? 'Reading their list…' : 'No trade now: nothing in bazaars under their prices' }));
            }
            if (x.traded) card.appendChild(spEl('small', { class: 'sp-traded', text: x.traded }));
            card.appendChild(spEl('button', {
                type: 'button',
                class: 'sp-btn sp-go' + (sel ? ' sp-go-on' : ''),
                'data-focus': 'scan:' + x.id,
                disabled: ready ? null : '',
                title: ready ? 'Put this trade on the desk: ' + x.mainName + ' with ' + x.name : '',
                text: sel ? 'On the desk ✓' : 'Put on desk',
                onclick: () => {
                    if (!ready || !this.h.onTradePick) return;
                    this.h.onTradePick(x.mainId, x.key);
                    this.deskEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
                },
            }));
            grid.appendChild(card);
        }
        box.appendChild(grid);
        if (sc.list.length > SCAN_SHOWN) {
            box.appendChild(spEl('button', {
                type: 'button',
                class: 'sp-link sp-showall',
                'data-focus': 'scan:all',
                text: this.scanAll ? 'Show the top ' + SCAN_SHOWN : 'Show all ' + count(sc.list.length) + ' traders',
                onclick: () => {
                    this.scanAll = !this.scanAll;
                    this.renderScan();
                },
            }));
        }
    }

    renderStrip() {
        const s = this.state;
        if (!s) return;
        const info = s.info || {};
        // Under your pointer the cards keep their places: the numbers update,
        // a card never jumps to another slot (the new order comes on leaving).
        const order = s.strip.map((f) => f.itemId).join(',');
        let strip = s.strip;
        if (this.stripHover && this.stripShown && order !== this.stripOrder) {
            const byId = new Map(s.strip.map((f) => [f.itemId, f]));
            strip = this.stripShown.map((f) => byId.get(f.itemId) || f);
        } else {
            this.stripOrder = order;
        }
        const pinnedIds = new Set((s.pinned || []).map((p) => p.itemId));
        const sig = JSON.stringify([
            [...pinnedIds],
            strip.map((f) => [f.itemId, f.name, f.plan.profit, f.plan.units, f.plan.steps.map((st) => st.sellerName), f.buyer.name, f.buyer.price, f.buyer.trust && f.buyer.trust.level]),
            s.desk && s.desk.itemId,
            info.flipsChecked,
            info.flipsWanted,
            Boolean(info.bazaarsAt),
            info.tradersLoading,
            s.prefs.onlineOnly,
            s.prefs.trustedOnly,
            (s.leftovers || []).map((l) => [l.itemId, l.qty, l.each, l.best && l.best.name, l.best && l.best.price]),
        ]);
        if (sig === this.stripSig) return;
        this.stripSig = sig;
        this.stripShown = strip;

        const box = this.stripEl;
        const refocus = this.focusKeyIn(box);
        box.textContent = '';
        // Leftovers and flips below: focus goes back once they are drawn.
        queueMicrotask(() => this.focusBack(box, refocus));
        // What a trader did not take: first, until it is sold (or you drop it).
        for (const l of s.leftovers || []) {
            const on = Boolean(s.desk && s.desk.itemId === String(l.itemId));
            const card = spEl('div', {
                class: 'sp-fc sp-lo' + (on ? ' sp-sel' : ''),
                role: 'button',
                tabindex: '0',
                'data-focus': 'left:' + l.itemId,
                'aria-pressed': String(on),
                title: 'Left over from the trade with ' + (l.from || 'a trader') + ': show where to sell it',
            }, [
                spEl('span', { class: 'sp-fc-top' }, [
                    spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('left', l.itemId)]),
                    spEl('b', { class: 'sp-iname', text: count(l.qty) + ' ' + l.name }),
                    spEl('button', { type: 'button', class: 'sp-link sp-lo-x', title: 'Sold or kept: take it off this list', 'aria-label': 'Sold: take ' + l.name + ' off the leftovers', text: 'Sold ✓', onclick: (event) => {
                        event.stopPropagation();
                        if (this.h.onLeftoverRemove) this.h.onLeftoverRemove(l.itemId);
                    } }),
                ]),
                spEl('span', { class: 'sp-fc-p', text: l.gain !== null ? signed(l.gain) : '–' }),
                spEl('small', { text: 'Left over · paid ' + formatMoney(l.each) + ' each' }),
                spEl('small', { class: 'sp-fc-sell' }, l.best ? ['Sell to ', spEl('b', { text: l.best.name }), ' at ' + formatMoney(l.best.price)] : ['No trader buys it now']),
            ]);
            card.addEventListener('click', () => this.select(String(l.itemId)));
            card.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                this.select(String(l.itemId));
            });
            box.appendChild(card);
        }
        if (!strip.length && (s.leftovers || []).length) return;
        if (!strip.length) {
            const text = this.noFlipsText();
            box.appendChild(spEl('div', { class: 'sp-empty sp-strip-empty', text }));
            return;
        }
        for (const f of strip) {
            const on = Boolean(s.desk && s.desk.itemId === f.itemId);
            const pinned = pinnedIds.has(f.itemId);
            // The pin: always shown, in the card's top corner; pressing it
            // changes only its colour - the card stays where it is.
            const pin = spEl('button', {
                type: 'button',
                class: 'sp-pin' + (pinned ? ' sp-pin-on' : ''),
                'aria-pressed': String(pinned),
                'data-focus': 'strippin:' + f.itemId,
                'aria-label': (pinned ? 'Unpin ' : 'Pin ') + f.name + '\'s trade',
                title: pinned ? 'Pinned on top of the list: press to unpin' : 'Pin this trade: it stays on top of the list, only prices move',
                onclick: (event) => {
                    event.stopPropagation();
                    if (this.h.onPin) this.h.onPin(f.itemId);
                },
            }, [pinIcon()]);
            const card = spEl('div', {
                class: 'sp-fc' + (on ? ' sp-sel' : ''),
                role: 'button',
                tabindex: '0',
                'data-focus': 'strip:' + f.itemId,
                'aria-pressed': String(on),
                title: 'Show its flip plan',
            }, [
                spEl('span', { class: 'sp-fc-top' }, [spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('strip', f.itemId)]), spEl('b', { class: 'sp-iname', text: f.name }), pin]),
                spEl('span', { class: 'sp-fc-p', text: signed(f.plan.profit) }),
                // What the bazaars sell it for (cheapest to dearest bought), and to whom.
                spEl('small', {}, ['Buy ', spEl('b', { text: count(f.plan.units) }), ' at ', spEl('b', { text: priceRange(f.plan.steps) }), ' from ' + [...new Set(f.plan.steps.map((st) => st.sellerName || 'a bazaar'))].join(', ')]),
                spEl('small', { class: 'sp-fc-sell' }, ['Sell to ', spEl('b', { text: f.buyer.name }), ' at ' + formatMoney(f.buyer.price), this.trustBadge(f.buyer)]),
            ]);
            card.addEventListener('click', () => this.select(f.itemId));
            card.addEventListener('keydown', (event) => {
                if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                this.select(f.itemId);
            });
            box.appendChild(card);
        }
    }

    /* ------------------------------------------------------------- list */

    renderList() {
        const s = this.state;
        const info = s.info || {};
        // A pinned item is listed once: its row moves to the top, pinned (the
        // owner: "it created something doubled, instead of just pinning it").
        const pinnedItems = new Set((s.pinned || []).map((p) => p.itemId));
        const list = this.stableOrder(s.list).filter((r) => !pinnedItems.has(r.itemId));
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
            list.map((r) => [r.itemId, r.name, r.held, r.lowest, r.badge && [r.badge.kind, r.badge.amount], r.pending, r.buy, r.sell]),
            s.pinned || [],
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
        // Pinned trades first, whatever the filter: the main flip, the trader, the profit now.
        for (const pt of s.pinned || []) {
            const unpin = spEl('button', {
                type: 'button',
                class: 'sp-pin sp-pin-on',
                'aria-pressed': 'true',
                'data-focus': 'unpin:' + pt.key,
                'aria-label': 'Unpin the trade with ' + pt.trader,
                title: 'Pinned: press to unpin',
                onclick: (event) => {
                    event.stopPropagation();
                    if (this.h.onUnpin) this.h.onUnpin(pt.key);
                },
            }, [pinIcon()]);
            const open = () => this.h.onPinnedOpen && this.h.onPinnedOpen(pt.key);
            this.listBox.appendChild(spEl('div', {
                class: 'sp-it sp-pinrow' + (pt.on ? ' sp-sel' : ''),
                role: 'button',
                tabindex: '0',
                'aria-pressed': String(pt.on),
                'data-focus': 'pin:' + pt.key,
                title: 'Your pinned trade: only prices and profit move',
                onclick: open,
                onkeydown: (event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    open();
                },
            }, [
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('pin', pt.itemId)]),
                spEl('b', { class: 'sp-iname', text: pt.name }),
                // The whole trade with that trader (the flip and its cover), live.
                spEl('span', { class: 'sp-pinrow-r' }, [spEl('span', { class: 'sp-badge ' + (pt.profit < 0 ? 'sp-badge-bad' : 'sp-badge-flip'), text: 'Trade ' + signed(pt.profit) }), unpin]),
                spEl('small', { text: pt.trader + (pt.mainId !== pt.itemId ? ' · main ' + pt.mainName : '') + ' · ' + count(pt.items) + (pt.items === 1 ? ' item' : ' items') + ' · ' + count(pt.stops) + (pt.stops === 1 ? ' bazaar' : ' bazaars') }),
            ]));
        }
        if ((s.pinned || []).length) this.listBox.appendChild(spEl('div', { class: 'sp-pinsep', 'aria-hidden': 'true' }));
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
        const pinnedIds = new Set((s.pinned || []).map((p) => p.itemId));
        for (const r of list) {
            const on = Boolean(s.desk && s.desk.itemId === r.itemId);
            const sub = [];
            if (r.held) sub.push('You hold ' + count(r.held));
            // A flip: what the bazaar sells it for, and what the trader pays.
            if (r.buy && r.sell) sub.push('Buy ' + formatMoney(r.buy) + ' · Sell ' + formatMoney(r.sell));
            else if (r.lowest) sub.push('from ' + formatMoney(r.lowest));
            // A flip row has the pin too (the owner: "put it here as well"), in
            // its bottom corner, out of the flow: pinning moves nothing.
            const flip = Boolean(r.badge && r.badge.kind === 'flip');
            const pinned = pinnedIds.has(r.itemId);
            const pin = flip
                ? spEl('button', {
                    type: 'button',
                    class: 'sp-pin sp-pin-row' + (pinned ? ' sp-pin-on' : ''),
                    'aria-pressed': String(pinned),
                    'data-focus': 'rowpin:' + r.itemId,
                    'aria-label': (pinned ? 'Unpin ' : 'Pin ') + r.name + '\'s trade',
                    title: pinned ? 'Pinned on top of the list: press to unpin' : 'Pin this trade: it stays on top of the list, only prices move',
                    onclick: (event) => {
                        event.stopPropagation();
                        if (this.h.onPin) this.h.onPin(r.itemId);
                    },
                }, [pinIcon()])
                : null;
            this.listBox.appendChild(spEl('div', {
                class: 'sp-it' + (on ? ' sp-sel' : '') + (flip ? ' sp-it-pin' : ''),
                role: 'button',
                tabindex: '0',
                'aria-pressed': String(on),
                'data-focus': 'item:' + r.itemId,
                onclick: () => this.select(r.itemId),
                onkeydown: (event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    this.select(r.itemId);
                },
            }, [
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('list', r.itemId)]),
                spEl('b', { class: 'sp-iname', text: r.name }),
                this.badge(r),
                spEl('small', { text: sub.join(' · ') || (r.pending ? 'Checking…' : '') }),
                pin,
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
        // Never "looking" forever when TornExchange has refused the key (review M13).
        if (info.teBadKey && !info.knownTraders) return 'No traders: TornExchange refused the key.';
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
        if (d && this.showAll.item !== d.itemId) this.showAll = { item: d.itemId, buyers: false, sellers: false, hidden: false };
        const statusOf = (b) => {
            const st = b.id && this.state.statuses ? this.state.statuses.get(String(b.id)) : null;
            return st ? st.level + st.text : '';
        };
        const now = Date.now();
        const p = this.state.prefs;
        const info = this.state.info || {};
        const sig = d
            ? JSON.stringify([
                d.itemId, d.name, d.held, d.avg, d.bazaars, d.buyersTotal, d.buyersLoading, d.buyersListNote, d.pending, d.planWhy,
                d.buyers.map((b) => [b.id, b.name, b.price, b.te, b.teTop, b.teList, b.w3b, statusOf(b), b.trust ? b.trust.level + b.trust.score : '', this.state.networth && b.id ? this.state.networth.get(String(b.id)) : null, Boolean(b.favourite), b.traded || '', Boolean(b.troll), Boolean(b.lastPaidOnly)]),
                this.justBlacklisted ? this.justBlacklisted.at : 0,
                (d.hidden || []).map((b) => [b.tradeKey, b.price, b.hiddenBy, statusOf(b), b.trust ? b.trust.level + b.trust.score : '']),
                p.networthPct,
                d.sellers.state, d.sellers.error,
                d.sellers.rows.map((r) => [r.sellerId, r.sellerName, r.price, r.qty, r.stale, Math.floor((now - (r.dataAt || 0)) / 60000)]),
                d.plan, d.where, d.market, d.trade,
                this.showAll, p.onlineOnly, p.trustedOnly, p.cash, Boolean(info.knownTraders), info.tradersLoading,
            ])
            : JSON.stringify([info.hasKey, info.loading, Boolean(info.bazaarsAt), info.tradersLoading, this.state.counts]);
        if (sig === this.deskSig) return;

        const shadow = this.root.getRootNode();
        const active = shadow && shadow.activeElement;
        // A box you are in is never replaced (3.14.3: it only waited once you
        // had typed, so a selection made by a double-click was wiped within
        // seconds by the next read): the desk is drawn again once you leave it.
        if (active && box.contains(active) && active.tagName === 'INPUT' && active.type !== 'checkbox' && (active.dataset.dirty || document.hasFocus())) return;
        this.deskSig = sig;
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
        // A trade being planned or bought: its card beside the traders, at the
        // top, where Plan trade was pressed - not below the fold.
        // Two columns, each as tall as its own cards: a long plan never
        // stretches the traders' side (it did as a spanning grid row).
        if (d.trade && (d.trade.chosen || d.trade.accepted)) {
            const plan = this.planCard(d);
            plan.classList.remove('sp-wide');
            quad.append(
                spEl('div', { class: 'sp-col' }, [this.buyersCard(d), this.sellersCard(d), d.held ? this.whereCard(d) : null]),
                spEl('div', { class: 'sp-col' }, [plan]),
            );
        } else {
            quad.append(this.buyersCard(d), this.sellersCard(d), this.planCard(d));
            if (d.held) quad.appendChild(this.whereCard(d));
        }
        box.appendChild(quad);

        if (keep) {
            // A trader just blacklisted is gone from the rows: their Undo takes the focus.
            // Declined: that trader's Undo (never the next trader's "declined", review M3).
            const want = keep.startsWith('blk:') && this.justBlacklisted ? 'desk:bl-undo' : keep.startsWith('trade:decline:') ? 'plan:' + keep.slice('trade:decline:'.length) : keep;
            const node = [...box.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === want);
            if (node) node.focus({ preventScroll: true });
        }
    }

    /** Traders pay, highest first: name (their profile), trust, status, price; Trade and both price lists. */
    buyersCard(d) {
        const card = spEl('div', { class: 'sp-q' }, [spEl('h3', { text: 'Traders pay · highest first' })]);
        const all = this.showAll.buyers;
        // Traders you marked Declined go to the bottom (greyed) until their hour is up.
        const T = d.trade || null;
        const declined = (T && T.declined) || {};
        const ordered = [...d.buyers.filter((b) => !declined[b.tradeKey] && !b.troll), ...d.buyers.filter((b) => !declined[b.tradeKey] && b.troll), ...d.buyers.filter((b) => declined[b.tradeKey])];
        const rows = all ? ordered : ordered.slice(0, DESK_ROWS);
        if (d.buyersLoading) card.appendChild(spEl('p', { class: 'sp-note', text: 'Loading more buyers from TornExchange…' }));
        else if (d.buyersListNote) card.appendChild(spEl('p', { class: 'sp-note', text: d.buyersListNote }));
        // Just blacklisted: a moment to take it back (then only the Ledger's Traders tab has Undo).
        const justOff = this.justBlacklisted && Date.now() - this.justBlacklisted.at < 15000 ? this.justBlacklisted.b : null;
        if (justOff) {
            card.appendChild(spEl('p', { class: 'sp-note sp-blnote' }, [
                'Blacklisted ' + justOff.name + ': never a buyer. ',
                spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'desk:bl-undo', text: 'Undo', onclick: () => {
                    this.justBlacklisted = null;
                    if (this.h.onBlacklist) this.h.onBlacklist(justOff, false);
                } }),
            ]));
        }
        if (!rows.length) card.appendChild(spEl('p', { class: 'sp-note', text: this.noTraderText(d) }));
        // The top row is the best real bid: a troll one (over 3x the market price) is never it.
        const topRow = rows.find((b) => !b.troll && !declined[b.tradeKey]);
        rows.forEach((b) => {
            const planning = Boolean(T && ((T.chosen && T.chosen.key === b.tradeKey) || (T.accepted && T.accepted.key === b.tradeKey)));
            const until = declined[b.tradeKey];
            card.appendChild(spEl('div', { class: 'sp-tr' + (b === topRow ? ' sp-top' : '') + (b.troll ? ' sp-troll' : '') + (planning ? ' sp-planning' : '') + (until ? ' sp-declined' : '') }, [
                spEl('span', { class: 'sp-tr-l' }, [
                    spEl('span', { class: 'sp-trader-l' }, [this.favButton(b), this.playerName(b.name, b.id, 'buyer:' + (b.id || b.name)), this.trustBadge(b)]),
                    this.status(b),
                    this.networthLine(b),
                    // Your own history with them (the Ledger): "Traded 7× · last 3d ago".
                    b.traded ? spEl('small', { class: 'sp-traded', text: b.traded }) : null,
                    // Their two lists disagree: the lower is counted, and said.
                    b.differ
                        ? spEl('small', { class: 'sp-differ', text: 'Lists differ: ' + this.listPrices(b, ' · ') + '. Counted at the lower; check before trading.' })
                        : null,
                    b.troll ? spEl('small', { class: 'sp-differ', text: 'Over 3× Item Market Average: not counted' }) : null,
                    // No public list: what they paid you last (review M2).
                    b.lastPaidOnly ? spEl('small', { class: 'sp-differ', text: 'Last paid: no public list, check with them' }) : null,
                    T ? this.tradeLine(d, b, planning, until) : null,
                ]),
                spEl('span', { class: 'sp-tprice', text: formatMoney(b.price) }),
                this.traderLinks(b, { blacklist: true }),
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
        this.hiddenBuyersPart(card, d);
        return card;
    }

    /**
     * Traders your Buyers online only / Trusted buyers only leave out here:
     * how many and which switch, and on a press, who (greyed, never planned).
     * The list never empties with no reason (the friend, 3.14.4).
     */
    hiddenBuyersPart(card, d) {
        const hidden = d.hidden || [];
        if (!hidden.length) return;
        const open = Boolean(this.showAll.hidden);
        const n = (k) => hidden.filter((b) => b.hiddenBy === k).length;
        const parts = [];
        if (n('trust')) parts.push('Trusted buyers only hides ' + count(n('trust')) + (n('trust') === 1 ? ' trader' : ' traders'));
        if (n('offline')) parts.push('Buyers online only hides ' + count(n('offline')) + (n('offline') === 1 ? ' trader' : ' traders') + ' (offline)');
        card.appendChild(spEl('p', { class: 'sp-note sp-hidnote' }, [
            parts.join(' · ') + ' here. ',
            spEl('button', { type: 'button', class: 'sp-link', 'aria-expanded': String(open), 'data-focus': 'desk:hidden', text: open ? 'Hide them' : 'Show them', onclick: () => {
                this.showAll.hidden = !open;
                this.deskSig = null;
                this.renderDesk();
                this.fitDesk();
            } }),
        ]));
        if (!open) return;
        for (const b of hidden) {
            const why = b.hiddenBy === 'offline'
                ? 'Offline: hidden by Buyers online only'
                : !b.trust ? 'No votes yet: hidden by Trusted buyers only'
                : b.trust.level === 'Caution' ? 'More votes against than for: hidden by Trusted buyers only'
                : 'Fewer than 20 votes: hidden by Trusted buyers only';
            card.appendChild(spEl('div', { class: 'sp-tr sp-hidden' }, [
                spEl('span', { class: 'sp-tr-l' }, [
                    spEl('span', { class: 'sp-trader-l' }, [this.playerName(b.name, b.id, 'hidden:' + (b.id || b.name)), this.trustBadge(b)]),
                    this.status(b),
                    b.traded ? spEl('small', { class: 'sp-traded', text: b.traded }) : null,
                    spEl('small', { class: 'sp-differ', text: why }),
                ]),
                spEl('span', { class: 'sp-tprice', text: formatMoney(b.price) }),
                this.traderLinks(b),
            ]));
        }
    }

    /**
     * A trader's prices for one item, per list: "TE $850,000 · W3B $852,000",
     * or "TE top 3 $140,000 · TE full list $105,000" when TornExchange's own
     * two lists disagree.
     */
    listPrices(b, sep) {
        const parts = [];
        if (b.teTop > 0 && b.teList > 0 && b.teTop !== b.teList) {
            parts.push('TE top 3 ' + formatMoney(b.teTop), 'TE full list ' + formatMoney(b.teList));
        } else if (b.te > 0) {
            parts.push('TE ' + formatMoney(b.te));
        }
        if (b.w3b > 0) parts.push('W3B ' + formatMoney(b.w3b));
        return parts.join(sep);
    }

    /**
     * Under a trader on the desk: what the whole trade with them makes, and
     * the button that puts the flip plan on them (the owner: "trader 1 didn't
     * want to trade - click trader 2 to see the flip plan there"). Declined:
     * how long they are passed over, and Undo.
     */
    tradeLine(d, b, planning, until) {
        const t = d.trade.perTrader[b.tradeKey];
        const words = [];
        if (t && t.items) words.push('whole trade ' + (t.estimated ? '≈ ' : '') + signed(t.profit) + ' · ' + count(t.items) + (t.items === 1 ? ' item' : ' items') + (t.stops ? ' · ' + count(t.stops) + (t.stops === 1 ? ' bazaar' : ' bazaars') : ''));
        else if (t) words.push(b.troll ? 'their bid is not believable' : 'no trade with your Cash');
        if (t && !t.hasItem && t.items) words.push('not this item');
        let btn;
        if (until) {
            words.unshift('Declined · passed over for ' + formatAge(until - Date.now()).replace(' ago', ''));
            btn = spEl('button', { type: 'button', class: 'sp-btn sp-plan', 'data-focus': 'plan:' + b.tradeKey, text: 'Undo', onclick: () => this.h.onTradeUndecline && this.h.onTradeUndecline(b.tradeKey) });
        } else if (planning) {
            btn = spEl('span', { class: 'sp-plan sp-plan-on', text: d.trade.accepted ? 'Accepted' : 'Planning' });
        } else {
            btn = spEl('button', { type: 'button', class: 'sp-btn sp-plan', 'data-focus': 'plan:' + b.tradeKey, title: 'Put the flip plan on ' + b.name + ': this item and their other items', text: 'Plan trade', onclick: () => this.h.onTradePick && this.h.onTradePick(d.itemId, b.tradeKey) });
        }
        return spEl('span', { class: 'sp-tradeline' }, [btn, words.length ? spEl('small', { text: words.join(' · ') }) : null]);
    }

    /** "Networth $1.2b" under a trader, once Torn has said. */
    networthLine(b) {
        const nw = b && b.id && this.state.networth ? this.state.networth.get(String(b.id)) : null;
        if (!(nw >= 0)) return null;
        return spEl('small', { class: 'sp-networth', text: 'Networth ' + formatMoney(nw) });
    }

    /** The star before a trader's name: a favourite (5+ trades this month, or added by you); press to change. */
    favButton(b) {
        if (!b || !b.id) return null;
        const on = Boolean(b.favourite);
        return spEl('button', {
            type: 'button',
            class: 'sp-fav' + (on ? ' sp-fav-on' : ''),
            'data-focus': 'fav:' + b.id,
            title: on ? 'Favourite - press to remove' : 'Make ' + b.name + ' a favourite',
            'aria-pressed': String(on),
            'aria-label': on ? 'Remove ' + b.name + ' from favourites' : 'Make ' + b.name + ' a favourite',
            text: on ? '★' : '☆',
            onclick: () => this.h.onFavourite && this.h.onFavourite(b, !on),
        });
    }

    /** Trade, TE list and W3B list, in fixed slots so they line up row to row; ⊘ (blacklist) at the end on the desk. */
    traderLinks(b, { blacklist = false } = {}) {
        const links = spEl('span', { class: 'sp-links' });
        const slot = (text, url, title) => {
            if (!url) {
                links.appendChild(spEl('span', { class: 'sp-chip sp-chip-none', 'aria-hidden': 'true' }));
                return;
            }
            links.appendChild(this.link(text, url, { title, focus: 'link:' + (b.id || b.name) + ':' + text }));
        };
        slot('TE list', b.te ? tePriceListUrl(b.teName || b.name) : null, 'TornExchange price list: ' + formatMoney(b.te || 0));
        slot('W3B list', b.w3b && b.id ? w3bPriceListUrl(b.id) : null, 'TornW3B price list: ' + formatMoney(b.w3b || 0));
        if (blacklist) {
            links.appendChild(spEl('button', {
                type: 'button',
                class: 'sp-blk',
                'data-focus': 'blk:' + (b.id || b.name),
                title: 'Blacklist ' + b.name + ': never a buyer (their bazaars are still used)',
                'aria-label': 'Blacklist ' + b.name,
                text: '⊘',
                onclick: () => {
                    this.justBlacklisted = { b: { id: b.id || null, name: b.name }, at: Date.now() };
                    clearTimeout(this.blNoteTimer);
                    this.blNoteTimer = setTimeout(() => {
                        this.justBlacklisted = null;
                        this.renderDesk();
                    }, 15000);
                    if (this.h.onBlacklist) this.h.onBlacklist(b, true);
                },
            }));
        }
        return links;
    }

    /**
     * The flip's last step: Trade, and the trader's own price lists, so the
     * price can be checked on their page before the trade. Only the links
     * that exist, in the same order as on the traders card.
     */
    stepTraderLinks(b, { trade = true } = {}) {
        const links = [];
        if (trade && b.id) links.push(this.link('Trade', tradeUrl(b.id), { title: 'Start a trade with ' + b.name, focus: 'step-trade' }));
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

    /**
     * The flip plan as ONE trade with one trader (mockup N3, the owner's pick):
     * Sell to (every trader you can flip this item to, ranked by what the
     * whole trade makes), then every item in the trade - this one first,
     * each with a tick and a number - then what you hold that they pay most
     * for, minus what you keep. Totals, Trade and their lists, and how old
     * their prices are.
     */
    /** "sells fast" / "slow seller" beside an extra item: why it is in, and in that amount. */
    kindTag(kind) {
        if (kind === 'fast') return spEl('span', { class: 'sp-kind sp-kind-fast', text: 'sells fast' });
        if (kind === 'slow') return spEl('span', { class: 'sp-kind sp-kind-slow', text: 'slow seller' });
        return null;
    }

    /**
     * Chat with the trader (the owner, 2026-09-28: "we don't need copy offer,
     * what we need is a button that goes straight to chatting that trader"):
     * their Torn profile, where Torn's own chat button is; a trader known by
     * name only, their TornExchange page.
     */
    chatLink(b) {
        if (b.id) {
            const a = this.link('Chat', spProfileUrl(b.id), { cls: 'sp-btn sp-chat', title: 'Open ' + b.name + '\'s profile: their chat button is marked', focus: 'trade:chat', children: [chatIcon(), 'Chat'] });
            // Remembered for the overlay, which marks Torn's chat button there.
            const want = () => this.h.onChatWanted && this.h.onChatWanted(b.id, b.name);
            a.addEventListener('click', want);
            a.addEventListener('auxclick', want);
            return a;
        }
        if (b.te) return this.link('Chat', tePriceListUrl(b.teName || b.name), { cls: 'sp-btn sp-chat', title: b.name + ' is known by name only: their TornExchange page', focus: 'trade:chat' });
        return null;
    }

    tradeCard(d) {
        const T = d.trade;
        const c = T.chosen;
        const b = c.buyer;
        const approx = c.estimated ? '≈ ' : '';
        const card = spEl('div', { class: 'sp-q sp-hot sp-wide sp-trade' }, [spEl('h3', {}, [
            'Flip plan · one trade with ' + b.name,
            // Held (you started on it) or pinned: the items stay, prices and profit are live.
            c.hold ? spEl('span', { class: 'sp-heldtag', title: 'The items stay as they are; prices and profit are live', text: c.hold.pinned ? 'Pinned' : 'Held' }) : null,
        ])]);
        // Anything you do here pins the desk to this item and this trader, so
        // the plan cannot move away while you buy and trade.
        card.addEventListener('click', (event) => {
            const t = event.target;
            if (t && t.closest && t.closest('a, button, input, label') && this.h.onTradePin) this.h.onTradePin(d.itemId, c.key);
        }, true);

        // In the order you do it: message them (Copy offer), then their answer.
        // Declined passes them over for an hour (the next best is planned).
        card.appendChild(spEl('div', { class: 'sp-tpick' }, [
            spEl('span', { class: 'sp-note', text: c.stops ? count(c.stops) + (c.stops === 1 ? ' bazaar' : ' bazaars') + ' to buy from · about ' + c.minutes + ' min' : 'Nothing to buy: all yours' }),
            spEl('span', { class: 'sp-tpick-b' }, [
                this.chatLink(b),
                spEl('button', { type: 'button', class: 'sp-btn sp-primary', 'data-focus': 'trade:accept:' + c.key, title: b.name + ' said yes: freeze this trade, so nothing in it moves while you buy and send', text: b.name + ' accepted', onclick: () => this.h.onTradeAccept && this.h.onTradeAccept(d.itemId) }),
                spEl('button', { type: 'button', class: 'sp-btn', 'data-focus': 'trade:decline:' + c.key, title: b.name + ' said no to this trade: on to the next flip (this trade is passed over for an hour; their other trades stay)', text: b.name + ' declined', onclick: () => this.h.onTradeDecline && this.h.onTradeDecline(c.key) }),
            ]),
        ]));

        // Who, and the totals.
        card.appendChild(spEl('div', { class: 'sp-th' }, [
            spEl('span', { class: 'sp-th-l' }, [
                spEl('span', {}, [this.playerName(b.name, b.id, 'trade:buyer'), ' ', this.trustBadge(b)]),
                this.status(b),
                this.networthLine(b),
            ]),
            spEl('span', { class: 'sp-th-r' }, [
                spEl('div', { class: 'sp-big', text: approx + signed(c.profit) }),
                spEl('small', { text: count(c.items) + (c.items === 1 ? ' item' : ' items') + ' · cash needed ' + formatMoney(c.cost) + ' · ' + b.name + ' pays ' + approx + formatMoney(c.pays) }),
            ]),
        ]));
        if (c.payCapped) {
            const nw = b.id && this.state.networth ? this.state.networth.get(String(b.id)) : null;
            card.appendChild(spEl('p', { class: 'sp-note', text: b.name + ' can pay at most ' + (this.state.prefs.networthPct || 10) + '% of their networth' + (nw >= 0 ? ' (' + formatMoney(nw) + ')' : '') + ' for the whole trade: it stops there.' }));
        }

        const tick = (checked, label, focus, onChange) => {
            const input = spEl('input', { type: 'checkbox', class: 'sp-tick', 'aria-label': label, 'data-focus': focus });
            input.checked = checked;
            input.addEventListener('change', () => onChange(input.checked));
            return input;
        };
        const qtyBox = (value, label, focus, onSet) => {
            const input = spEl('input', { type: 'text', class: 'sp-qty', inputmode: 'numeric', value: String(value), 'aria-label': label, 'data-focus': focus, autocomplete: 'off', spellcheck: 'false' });
            selectOnFocus(input);
            // Just refused, and the desk drawn again since: still said.
            if (this.qtyRefused && this.qtyRefused.focus === focus && Date.now() - this.qtyRefused.at < 2500) queueMicrotask(() => flashBad(input, 'Type a whole number, like 25'));
            const commit = () => {
                if (!input.dataset.dirty) return;
                delete input.dataset.dirty;
                const n = readWholeNumber(input.value);
                if (n !== null) {
                    onSet(n);
                    return;
                }
                // Not a number: put back what was there, and say so (3.14.3: it was silent).
                input.value = String(value);
                flashBad(input, 'Type a whole number, like 25');
                this.qtyRefused = { focus, at: Date.now() };
            };
            input.addEventListener('input', () => {
                input.dataset.dirty = '1';
            });
            // Saved once focus has moved on (Tab to the next box keeps you there),
            // and the desk catches up with what it held back while you were in the box.
            input.addEventListener('blur', () => setTimeout(() => {
                if (input.dataset.dirty) commit();
                else this.renderDesk();
            }, 0));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    // Esc: what was there, unchanged.
                    event.preventDefault();
                    event.stopPropagation();
                    delete input.dataset.dirty;
                    input.value = String(value);
                    input.blur();
                    return;
                }
                if (event.key !== 'Enter') return;
                // Enter: done - saved, and out of the box.
                event.preventDefault();
                input.blur();
            });
            return input;
        };
        const edit = (id, e) => this.h.onTradeEdit && this.h.onTradeEdit(c.key, id, e);
        // You typed more than bazaars list (mockup R-inputs): the plan takes what there is, and says so.
        const cutNote = (r) => {
            const t = this.typedQty;
            if (!t || t.itemId !== r.itemId || Date.now() - t.at > 8000) return null;
            const got = r.plannedUnits || r.units;
            if (!(t.n > got)) return null;
            return spEl('small', { class: 'sp-warnnote', role: 'status', text: count(got) + ' listed - ' + count(t.n) + ' is more than bazaars have' });
        };

        // Buy, then trade: the main flip first.
        if (c.flips.length || c.off.length || c.itemNote) card.appendChild(spEl('div', { class: 'sp-tsec', text: 'Buy, then trade to ' + b.name }));
        // Another item makes the most with this trader: it is the main flip, this one is cover.
        const mainRow = c.main ? c.flips.find((r) => r.itemId === String(c.main)) : null;
        if (mainRow && mainRow.itemId !== String(d.itemId) && c.flips.some((r) => r.itemId === String(d.itemId))) {
            card.appendChild(spEl('p', { class: 'sp-note sp-mainnote', text: 'Main: ' + mainRow.name + ' ' + signed(mainRow.profit) + ' · ' + d.name + ' is cover' }));
        }
        // Planned with a trader who makes no flip on this item: said, with the numbers.
        if (c.itemNote) {
            const n = c.itemNote;
            const why = {
                type: 'weapons, armour and cars are one of a kind - not flipped',
                never: 'its category is in Settings › Flips › Never flip',
                profit: 'under your least profit per item',
                none: 'no bazaar sells it under their price',
                cash: 'your Cash went to the other items',
            }[n.why] || 'not a flip with your settings';
            card.appendChild(spEl('p', { class: 'sp-note sp-itemnote', text: d.name + ' is not in this trade: ' + b.name + ' pays ' + formatMoney(n.bid) + (n.cheapest ? ', the cheapest bazaar is ' + formatMoney(n.cheapest) : '') + ' - ' + why + '.' }));
        }
        // A held trade's step against the bazaar now: re-priced, fewer left, gone.
        const mark = (st) => {
            const k = st.check && st.check.state;
            if (k === 'price') return spEl('span', { class: 'sp-warnnote', text: ' · now ' + formatMoney(st.price) + ' (was ' + formatMoney(st.planned) + ')' });
            if (k === 'short') return spEl('span', { class: 'sp-warnnote', text: ' · only ' + count(st.qty) + ' left of ' + count(st.plannedQty) });
            if (k === 'gone') return spEl('span', { class: 'sp-bad', text: ' · gone' });
            return null;
        };
        for (const r of c.flips) {
            const here = r.itemId === String(d.itemId);
            const isMain = c.main && r.itemId === String(c.main);
            const steps = r.steps.map((st) => (st.sellerId
                ? spEl('div', { class: 'sp-buy' }, [
                    spEl('span', {}, ['Buy ', spEl('b', { text: count(st.check && st.check.state === 'gone' ? st.plannedQty : st.qty) }), ' from ', this.playerName(st.sellerName || 'Player ' + st.sellerId, st.sellerId, 'trade:seller:' + r.itemId + ':' + st.sellerId), ' at ' + formatMoney(st.check && st.check.state === 'price' ? st.planned : st.price) + (st.along ? ' · same bazaar' : '') + (st.seenAt ? ' · seen ' + formatAge(Date.now() - st.seenAt) : ''), mark(st)]),
                    this.link('Open bazaar', bazaarUrl(st.sellerId, r.itemId, st.price), { focus: 'trade:bazaar:' + r.itemId + ':' + st.sellerId }),
                ])
                : spEl('div', { class: 'sp-buy' }, [spEl('span', { text: '≈ from ' + formatMoney(st.price) + ': its bazaars are being read' })])));
            card.appendChild(spEl('div', { class: 'sp-ti' }, [
                tick(true, 'Include ' + r.name, 'trade:tick:' + r.itemId, (on) => edit(r.itemId, on ? null : { off: true })),
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('trade-buy', r.itemId)]),
                spEl('span', { class: 'sp-ti-l' }, [
                    spEl('span', {}, [this.link(r.name, itemMarketUrl(r.itemId, r.name), { cls: 'sp-tiname', title: 'Open it on the Item Market', focus: 'trade:name:' + r.itemId }), isMain ? spEl('span', { class: 'sp-here', text: 'MAIN' }) : here ? spEl('span', { class: 'sp-here', text: 'THIS ITEM' }) : this.kindTag(r.kind)]),
                    spEl('small', {}, [qtyBox(r.plannedUnits || r.units, 'How many ' + r.name, 'trade:qty:' + r.itemId, (n) => {
                        // Remembered for a moment: more than bazaars have is cut down, and said.
                        this.typedQty = { itemId: r.itemId, n, at: Date.now() };
                        edit(r.itemId, n > 0 ? { qty: n } : { off: true });
                    }), ' at ' + formatMoney(r.bid) + ' each', r.noBid ? spEl('span', { class: 'sp-warnnote', text: ' · not on their list now' }) : null]),
                    cutNote(r),
                ]),
                spEl('span', { class: 'sp-ti-p ' + (r.profit < 0 ? 'sp-bad' : 'sp-good') }, [(r.estimated ? '≈ ' : '') + signed(r.profit), spEl('small', { text: 'cost ' + formatMoney(r.cost) })]),
                spEl('div', { class: 'sp-buys' }, steps),
            ]));
        }
        for (const r of c.off) {
            card.appendChild(spEl('div', { class: 'sp-ti sp-off' }, [
                tick(false, 'Include ' + r.name, 'trade:tick:' + r.itemId, (on) => edit(r.itemId, on ? null : { off: true })),
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('trade-off', r.itemId)]),
                spEl('span', { class: 'sp-ti-l' }, [spEl('b', { text: r.name }), spEl('small', { text: 'left out of this trade' })]),
                spEl('span', { class: 'sp-ti-p', text: '–' }),
            ]));
        }
        // What else they buy, left out so the buying stays quick: listed on a
        // press, each with Add (the owner: "5 extra items, not max, but soft cap").
        if (c.more > 0) {
            const open = this.showLeft === c.key;
            card.appendChild(spEl('p', { class: 'sp-note sp-leftline' }, [
                b.name + ' buys ' + count(c.more) + (c.more === 1 ? ' more item' : ' more items') + ', left out to keep it quick. ',
                spEl('button', { type: 'button', class: 'sp-link', 'aria-expanded': String(open), 'data-focus': 'trade:left', text: open ? 'Hide them' : 'Show them', onclick: () => {
                    this.showLeft = open ? null : c.key;
                    this.deskSig = null;
                    this.renderDesk();
                } }),
                // Add all (the friend, 2026-09-29): every one of them in one press, past Extras per trade.
                (c.left || []).length > 1
                    ? spEl('span', {}, [' · ', spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'trade:addall', title: 'Put every item ' + b.name + ' buys into this trade (more bazaars to visit)', text: 'Add all ' + count(c.left.length), onclick: () => this.h.onTradeAddAll && this.h.onTradeAddAll(c.key, c.left.map((r) => ({ itemId: r.itemId, units: r.units }))) })])
                    : null,
            ]));
            if (open) {
                for (const r of c.left || []) {
                    card.appendChild(spEl('div', { class: 'sp-ti sp-off sp-leftrow' }, [
                        spEl('button', { type: 'button', class: 'sp-btn sp-add', 'data-focus': 'trade:add:' + r.itemId, 'aria-label': 'Add ' + r.name + ' to the trade', text: 'Add', onclick: () => edit(r.itemId, { qty: r.units }) }),
                        spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('trade-left', r.itemId)]),
                        spEl('span', { class: 'sp-ti-l' }, [spEl('span', {}, [spEl('b', { text: r.name }), this.kindTag(r.kind)]), spEl('small', { text: 'from ' + formatMoney(r.price) + ' · ' + b.name + ' pays ' + formatMoney(r.bid) })]),
                        spEl('span', { class: 'sp-ti-p', text: '≈ ' + signed(r.profit) }),
                    ]));
                }
            }
        }
        // Was in this trade, is not now: said, never just gone (the friend lost
        // track of what to buy when rows vanished mid-trade).
        for (const r of c.gone || []) {
            card.appendChild(spEl('div', { class: 'sp-ti sp-off sp-gone' }, [
                spEl('span', { class: 'sp-gone-mark', text: '!' }),
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('trade-gone', r.itemId)]),
                spEl('span', { class: 'sp-ti-l' }, [spEl('b', { text: r.name }), spEl('small', { text: 'no longer in the trade: no bazaar sells it under ' + b.name + '\'s price now (bought, or re-priced), or your Cash went to the others' })]),
                spEl('span', { class: 'sp-ti-p', text: '–' }),
            ]));
        }

        // Yours: what they pay most for, minus what you keep.
        if (c.held.length) card.appendChild(spEl('div', { class: 'sp-tsec', text: 'Yours · ' + b.name + ' pays the most' }));
        for (const r of c.held) {
            const give = (n) => this.h.onTradeHeld && this.h.onTradeHeld(r.itemId, r.held, n, c.key);
            const on = r.units > 0;
            card.appendChild(spEl('div', { class: 'sp-ti' + (on ? '' : ' sp-off') }, [
                tick(on, 'Include your ' + r.name, 'trade:htick:' + r.itemId, (yes) => give(yes ? r.held : null)),
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('trade-yours', r.itemId)]),
                spEl('span', { class: 'sp-ti-l' }, [
                    spEl('b', { text: r.name }),
                    on
                        ? spEl('small', {}, [qtyBox(r.units, 'How many of your ' + r.name, 'trade:hqty:' + r.itemId, give), ' of ' + count(r.held) + ' at ' + formatMoney(r.bid) + ' each' + (r.kept ? ' · keeping ' + (r.kept === 'all' ? 'all' : count(r.kept)) : '') + (r.units < r.spare && !r.kept && !c.payCapped ? ' · a normal amount' : '')])
                        : spEl('small', { text: 'kept · you hold ' + count(r.held) }),
                ]),
                spEl('span', { class: 'sp-ti-p', text: on ? formatMoney(r.units * r.bid) : '–' }),
            ]));
        }
        const kept = Object.entries(T.keep || {});
        if (kept.length) {
            const nameOf = this.state.itemNameOf || ((id) => 'Item ' + id);
            card.appendChild(spEl('p', { class: 'sp-note', text: 'Kept for yourself: ' + kept.map(([id, k]) => nameOf(id) + ' ' + (k === 'all' ? '(all)' : count(k))).join(' · ') + '. Change it in Settings › Flips.' }));
        }

        // Their lists, to check a price; the trade itself opens after buying.
        card.appendChild(spEl('div', { class: 'sp-trade-links' }, [this.stepTraderLinks(b, { trade: !c.stops })]));
        const ages = [];
        if (b.te && T.teAt) ages.push('TE ' + formatAge(Date.now() - T.teAt));
        if (b.w3b && T.w3bAt) ages.push('W3B ' + formatAge(Date.now() - T.w3bAt));
        card.appendChild(spEl('p', { class: 'sp-note sp-warnnote', text: 'Check ' + b.name + '\'s list before buying' + (ages.length ? ': prices from ' + ages.join(', ') : '') + '.' }));
        if (b.differ) card.appendChild(spEl('p', { class: 'sp-note sp-warnnote', text: b.name + '\'s lists differ (' + this.listPrices(b, ', ') + '): planned at the lower.' }));
        return card;
    }

    /**
     * A trade the trader said yes to: frozen, so nothing in it moves. Each
     * buy step is checked against the bazaar now (still there, re-priced,
     * fewer left, gone) with a tick for bought; each item a tick for sent -
     * the same list shows in the panel on Torn's trade page. Then Traded, or
     * back to the live plan.
     */
    acceptedCard(d) {
        const A = d.trade.accepted;
        const b = A.buyer;
        const card = spEl('div', { class: 'sp-q sp-hot sp-wide sp-trade sp-accepted' }, [
            spEl('h3', { text: 'Trade with ' + b.name + ' · accepted ' + formatAge(Date.now() - A.at) }),
        ]);
        const done = (st) => st.bought || st.skipped || st.boughtQty > 0;
        // Only items with something to send count (review: "sent 0 of 2" counted a skipped one).
        const skippedAll = (i) => i.kind !== 'yours' && (i.steps || []).length > 0 && i.steps.every((st) => st.skipped && !st.bought && !(st.boughtQty > 0));
        const toSend = A.items.filter((i) => !skippedAll(i));
        const sent = toSend.filter((i) => i.sent).length;
        const tot = A.totals || { pays: A.pays, cost: A.cost, profit: A.profit };
        const steps = A.items.flatMap((i) => i.steps || []);
        const left = steps.filter((st) => !done(st)).length;
        card.appendChild(spEl('div', { class: 'sp-th' }, [
            spEl('span', { class: 'sp-th-l' }, [
                spEl('span', {}, [this.playerName(b.name, b.id, 'acc:buyer'), ' ', this.trustBadge(b)]),
                this.status(b),
            ]),
            spEl('span', { class: 'sp-th-r' }, [
                spEl('div', { class: 'sp-big', text: signed(tot.profit) }),
                spEl('small', { text: 'buy for ' + formatMoney(tot.cost) + ' · ' + b.name + ' pays ' + formatMoney(tot.pays) + ' · sent ' + sent + ' of ' + toSend.length }),
            ]),
        ]));
        // One thing to press next, always in the same place: buy, then trade.
        const next = left
            ? spEl('button', { type: 'button', class: 'sp-btn sp-primary', 'data-focus': 'acc:start', text: left === steps.length ? 'Start buying' : 'Continue buying', onclick: () => this.h.onTradeStartBuying && this.h.onTradeStartBuying(A.key) })
            : b.id
                ? this.link('Open the trade with ' + b.name, tradeUrl(b.id), { cls: 'sp-btn sp-primary', title: 'Start a trade with ' + b.name, focus: 'acc:trade' })
                : null;
        card.appendChild(spEl('div', { class: 'sp-tpick' }, [
            spEl('span', { class: 'sp-note', text: steps.length ? (steps.length - left) + ' of ' + steps.length + (steps.length === 1 ? ' bazaar' : ' bazaars') + ' done' + (left ? ' · about ' + Math.max(1, Math.round(left / 2)) + ' min left' : ' · now the trade') : 'Nothing to buy: send yours' }),
            next,
        ]));

        const words = {
            ok: (c) => 'still listed' + (c.seenAt ? ' · seen ' + formatAge(Date.now() - c.seenAt) : ''),
            price: (c) => 'now ' + formatMoney(c.price) + ' - re-priced',
            short: (c) => 'only ' + count(c.qty) + ' left',
            gone: () => 'gone from their bazaar',
            unknown: () => 'checking…',
            bought: () => 'bought',
        };
        const box = (checked, label, focus, onChange, title = null) => {
            const input = spEl('input', { type: 'checkbox', class: 'sp-tick', 'aria-label': label, 'data-focus': focus, title });
            input.checked = checked;
            input.addEventListener('change', () => onChange(input.checked));
            return input;
        };
        // The left ticks here mean "sent" (in the plan card they meant "include").
        card.appendChild(spEl('div', { class: 'sp-tsec', text: 'Sent · what goes to ' + b.name }));
        this.leftOpen = this.leftOpen || new Set();
        for (const i of A.items) {
            const send = i.send !== undefined ? i.send : i.units;
            const notTaken = Math.min(send, i.left || 0);
            const bought = i.kind === 'yours' || (i.steps || []).every(done);
            // They did not take some (or all): how many, kept to sell elsewhere at Traded - done.
            let leftCtl = null;
            const openKey = A.key + '|' + i.line;
            const redraw = () => {
                this.deskSig = null;
                this.renderDesk();
            };
            if (notTaken > 0 || this.leftOpen.has(openKey)) {
                // Same focus key as the button that opened it: the box takes the focus.
                const input = spEl('input', { type: 'text', class: 'sp-qty', inputmode: 'numeric', value: notTaken > 0 ? String(notTaken) : '', placeholder: '0-' + send, 'aria-label': 'How many ' + i.name + ' ' + b.name + ' did not take (0 to ' + send + ')', 'data-focus': 'acc:left:' + i.line, autocomplete: 'off', spellcheck: 'false' });
                selectOnFocus(input);
                const was = input.value;
                const commit = () => {
                    if (input.value === was) return;
                    const n = readWholeNumber(input.value);
                    if (n === null || n > send) {
                        // Refused in place (3.14.3: the browser's own bubble), and what was there put back.
                        input.value = was;
                        flashBad(input, 'A number from 0 to ' + send);
                        return;
                    }
                    this.leftOpen.delete(openKey);
                    input.value = String(n);
                    if (this.h.onTradeLeft) this.h.onTradeLeft(A.key, i.line, n);
                };
                // Saved once you leave the box (Enter leaves it); Esc puts back what was there.
                input.addEventListener('blur', () => setTimeout(commit, 0));
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        input.value = was;
                        input.blur();
                        return;
                    }
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    input.blur();
                });
                leftCtl = spEl('small', { class: 'sp-left' }, [
                    input,
                    ' not taken' + (i.kind === 'flip' ? ' - kept to sell elsewhere · ' : ' · '),
                    spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'acc:leftundo:' + i.line, text: notTaken > 0 ? 'They took all' : 'Cancel', onclick: () => {
                        this.leftOpen.delete(openKey);
                        if (notTaken > 0 && this.h.onTradeLeft) this.h.onTradeLeft(A.key, i.line, 0);
                        else redraw();
                    } }),
                ]);
            } else if (bought && send > 0 && !left) {
                // Only once everything is bought: the trade is what is left to happen.
                leftCtl = spEl('button', { type: 'button', class: 'sp-link sp-left', 'data-focus': 'acc:left:' + i.line, title: b.name + ' did not take all of it: say how many, kept to sell elsewhere', text: 'They took fewer…', onclick: () => {
                    this.leftOpen.add(openKey);
                    redraw();
                } });
            }
            card.appendChild(spEl('div', { class: 'sp-ti' + (i.sent ? ' sp-off' : '') }, [
                box(i.sent, 'Sent ' + i.name, 'acc:sent:' + i.line, (yes) => this.h.onTradeTick && this.h.onTradeTick(A.key, i.line, { sent: yes }), 'Tick when it is in the trade'),
                spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image('acc-' + i.kind, i.itemId)]),
                spEl('span', { class: 'sp-ti-l' }, [
                    spEl('b', { text: i.name }),
                    spEl('small', { text: 'send ' + count(send - notTaken) + (i.kind === 'yours' ? ' of yours' : '') + (send !== i.units && i.kind !== 'yours' ? ' (planned ' + count(i.units) + ')' : '') + ' · ' + b.name + ' pays ' + formatMoney(i.bid) + ' each' + (i.sent ? ' · sent' : '') }),
                    leftCtl,
                ]),
                spEl('span', { class: 'sp-ti-p' }, [
                    formatMoney((send - notTaken) * i.bid),
                    // Not profitable any more (no listing under their price): drop it.
                    i.kind !== 'yours' && (i.steps || []).some((st) => ['gone', 'price'].includes(st.check.state) && !st.repl && !st.bought)
                        ? spEl('button', { type: 'button', class: 'sp-btn sp-drop', 'data-focus': 'acc:drop:' + i.line, title: 'No bazaar sells it under ' + b.name + '\'s price now', text: 'Drop it', onclick: () => this.h.onTradeDrop && this.h.onTradeDrop(A.key, i.line) })
                        : null,
                ]),
                i.steps.length ? spEl('div', { class: 'sp-buys' }, i.steps.map((st, k) => spEl('div', { class: 'sp-buy sp-check-' + st.check.state }, [
                    box(st.bought, 'Bought ' + st.qty + ' from ' + (st.sellerName || st.sellerId), 'acc:bought:' + i.line + ':' + k, (yes) => this.h.onTradeTick && this.h.onTradeTick(A.key, i.line, { step: k, bought: yes })),
                    spEl('span', {}, [
                        'Buy ', spEl('b', { text: count(st.qty) }), ' from ', this.playerName(st.sellerName || 'Player ' + st.sellerId, st.sellerId, 'acc:seller:' + i.itemId + ':' + k), ' at ' + formatMoney(st.price) + ' · ',
                        spEl('span', { class: 'sp-checkword', text: st.skipped ? 'skipped' : st.boughtQty > 0 && !st.bought ? 'bought ' + count(st.boughtQty) + ' of ' + count(st.qty) : words[st.check.state](st.check) }),
                        // Gone or re-priced: the next cheapest still under their price.
                        st.repl ? spEl('span', { class: 'sp-repl' }, [' · next cheapest: ' + count(st.repl.qty) + ' from ' + (st.repl.sellerName || 'Player ' + st.repl.sellerId) + ' at ' + formatMoney(st.repl.price) + ' ', spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'acc:repl:' + i.line + ':' + k, text: 'Use it', onclick: () => this.h.onTradeReplace && this.h.onTradeReplace(A.key, i.line, k, st.repl) })]) : null,
                        ['gone', 'price'].includes(st.check.state) && !st.repl && !st.bought ? spEl('span', { class: 'sp-bad', text: ' · not profitable any more' }) : null,
                    ]),
                    st.bought ? null : this.link('Open bazaar', bazaarUrl(st.sellerId, i.itemId, st.price), { focus: 'acc:bazaar:' + i.itemId + ':' + k }),
                ]))) : null,
            ]));
        }
        // Cancel trade (the owner, 2026-09-29): they accepted, then it was
        // called off - the plan goes. Asked first, like on Torn's pages.
        if (this.cancelAsk === A.key) {
            card.appendChild(spEl('div', { class: 'sp-tpick sp-acc-foot sp-cancelask' }, [
                spEl('span', { class: 'sp-warnnote', text: 'Cancel the trade with ' + b.name + '? This flip plan goes (they are not marked declined); what you already bought stays yours to sell.' }),
                spEl('span', { class: 'sp-tpick-b' }, [
                    spEl('button', { type: 'button', class: 'sp-btn', 'data-focus': 'acc:cancel-yes', text: 'Yes, cancel it', onclick: () => {
                        this.cancelAsk = null;
                        if (this.h.onTradeCancel) this.h.onTradeCancel(A.key);
                    } }),
                    spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'acc:cancel-no', text: 'Keep it', onclick: () => {
                        this.cancelAsk = null;
                        this.deskSig = null;
                        this.renderDesk();
                    } }),
                ]),
            ]));
            return card;
        }
        // Back (the plan unfreezes) and Cancel trade on the left, apart from Traded - done on the right.
        card.appendChild(spEl('div', { class: 'sp-tpick sp-acc-foot' }, [
            spEl('span', { class: 'sp-tpick-b' }, [
                spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'acc:back', title: 'Unfreeze: back to the live plan (nothing is kept)', text: '← Back to the live plan', onclick: () => this.h.onTradeClose && this.h.onTradeClose(A.key, false) }),
                spEl('button', { type: 'button', class: 'sp-link', 'data-focus': 'acc:cancel', title: 'They accepted, then the trade was called off: this flip plan goes (not marked declined)', text: 'Cancel trade', onclick: () => {
                    this.cancelAsk = A.key;
                    this.deskSig = null;
                    this.renderDesk();
                } }),
                this.stepTraderLinks(b, { trade: false }),
            ]),
            spEl('button', { type: 'button', class: 'sp-btn', 'data-focus': 'acc:done', title: 'The trade went through: close it' + (A.items.some((i) => i.left > 0 && i.kind === 'flip') ? ', and keep what they did not take to sell elsewhere' : ''), text: 'Traded - done', onclick: () => this.h.onTradeClose && this.h.onTradeClose(A.key, true) }),
        ]));
        return card;
    }

    /** The flip plan: buy from these bazaars, sell to this trader, what it makes and costs. */
    planCard(d) {
        if (d.trade && d.trade.accepted) return this.acceptedCard(d);
        if (d.trade && d.trade.chosen) return this.tradeCard(d);
        const wide = d.held ? '' : ' sp-wide';
        const f = d.plan;
        const fb = f && f.units > 0 ? f.buyer || d.buyers[0] : null;
        const fbKey = fb ? (fb.id ? 'id:' + fb.id : 'name:' + String(fb.name).toLowerCase()) : null;
        const until = fbKey && d.trade && d.trade.declined ? d.trade.declined[fbKey] : null;
        if (until) {
            const card = spEl('div', { class: 'sp-q' + wide }, [spEl('h3', { text: 'Flip plan' })]);
            card.appendChild(spEl('p', { class: 'sp-note', text: fb.name + ' declined (passed over for ' + formatAge(until - Date.now()).replace(' ago', '') + '). No other trader makes a trade on ' + d.name + ' now: Undo above, or pick another item.' }));
            return card;
        }
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
            if (b.differ) card.appendChild(spEl('p', { class: 'sp-note sp-warnnote', text: b.name + '\'s lists differ (' + this.listPrices(b, ', ') + '): planned at the lower. Check their list before trading.' }));
            return card;
        }
        const card = spEl('div', { class: 'sp-q' + wide }, [spEl('h3', { text: 'Flip plan' })]);
        let text;
        const top = d.buyers[0];
        const who = this.state.prefs.trustedOnly ? 'trusted buyer' : 'buyer';
        if (f && f.units === 0) text = 'One costs ' + formatMoney(f.needs) + ', more than your cash (' + formatMoney(this.state.prefs.cash) + ').';
        else if (d.planWhy === 'loading') text = 'Loading bazaars from TornW3B…';
        else if (!top) text = 'No flip: no ' + who + ' for this item.';
        else if (d.statItem) text = 'No flip: every copy is its own (weapons, armour, cars), and traders pay one price for one - nobody buys them by the hundred.';
        else if (d.sellers.rows.some((r) => !r.stale && r.price < top.price && top.price - r.price < Math.max(1, (r.price * (this.state.prefs.minProfitPct ?? 1)) / 100))) {
            // Under the bid, but by less than Settings' least profit per item.
            const r = d.sellers.rows.find((x) => !x.stale);
            text = 'No flip: the cheapest bazaar makes only ' + formatMoney(top.price - r.price) + ' each, under your ' + (this.state.prefs.minProfitPct ?? 1) + '% least profit per item.';
        } else if (d.sellers.rows.some((r) => !r.stale && r.price < top.price)) {
            text = 'No flip: none of these buyers can take it at a profit (their price is over 3× the average, or their networth is too small).';
        } else if (d.sellers.rows.some((r) => !r.stale)) text = 'No flip: the cheapest bazaar is ' + formatMoney(d.sellers.rows.find((r) => !r.stale).price - top.price) + ' over the best ' + who + '.';
        else if (d.sellers.rows.length) text = 'No flip: TornW3B has not seen these bazaars in the last 30 minutes.';
        else text = 'No flip: no bazaar is selling it.';
        card.appendChild(spEl('p', { class: 'sp-note', text }));
        // No flip on this item - but a trader's other items may still make a trade.
        if (d.trade && !d.trade.chosen && d.buyers.length) card.appendChild(spEl('p', { class: 'sp-note', text: 'Press Plan trade on a trader to plan a trade with their other items.' }));
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
            // A listing counted for only the first N (as many as are listed
            // near that price now): the rest go to the trader, and it says so.
            const part = o && each !== null && o.units < n;
            const eachText = formatMoney(each) + ' each' + (part ? ' · first ' + count(o.units) + (b ? ', rest to trader' : '') : '');
            const inner = [
                spEl('span', { class: 'sp-opt-l' }, [spEl('b', { text: r.name + listAt }), spEl('small', { text: each === null ? r.missing : r.when })]),
                spEl('span', { class: 'sp-opt-p' }, each === null ? ['–'] : [formatMoney(o.total !== null ? o.total : each * n), n > 1 ? spEl('small', { text: eachText }) : null]),
            ];
            if (r.url && each !== null) card.appendChild(this.link('', r.url, { cls: 'sp-opt' + (win ? ' sp-win' : ''), title: r.venue === 'trader' ? 'Start a trade' : r.venue === 'bazaar' ? 'Open your bazaar\'s add page' : 'Open the Item Market\'s add page', focus: 'where:' + r.venue, children: inner }));
            else card.appendChild(spEl('div', { class: 'sp-opt sp-opt-none' }, inner));
        }

        const bazaar = w.options.find((x) => x.venue === 'bazaar');
        let verdict = '';
        if (w.best === 'bazaar' || w.best === 'market') {
            const won = w.options.find((x) => x.venue === w.best);
            const place = (w.best === 'bazaar' ? 'your bazaar' : 'the Item Market') + (won && won.units < n ? ' for the first ' + count(won.units) + ' (as many as are listed near that price now)' : '');
            verdict = b ? 'Best: ' + place + ', ' + signed(w.gain) + ' more than the trader, but you wait for a buyer.' : 'Best: ' + place + '. ' + rows[0].missing + '.';
        } else if (w.best === 'trader') {
            verdict = 'Best: sell to trader ' + b.name + '.';
            if (bazaar && bazaar.each !== null) {
                const diff = bazaar.total - b.price * n;
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
        if (info.teBadKey && (!info.knownTraders || (d && d.pending))) return 'No traders: TornExchange refused the key';
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
        // The numbers are read out too, not only shown on hover.
        // The more trades behind them, the bigger the number (3.14, the owner:
        // "the more trusted the trader, show it").
        const score = Number.isFinite(t.score) ? ' ' + count(t.score) : '';
        return spEl('span', { class: 'sp-trust', 'data-level': t.level.toLowerCase(), title: parts.join(' · '), 'aria-label': t.level + (parts.length ? ': ' + parts.join(', ') : ''), text: t.level + score });
    }

    /** A dot and a word: Online, Idle 5m, Offline 3h, Online · Hospital. Nothing when not known yet. */
    status(buyer) {
        const st = buyer && buyer.id && this.state.statuses ? this.state.statuses.get(String(buyer.id)) : null;
        const box = spEl('span', { class: 'sp-status', title: st ? buyer.name + ': ' + st.title : '' });
        if (st) box.setAttribute('aria-label', st.title || st.text);
        if (st) box.append(spEl('span', { class: 'sp-dot', 'data-level': st.level }), st.text);
        return box;
    }
}

export const SELLING_PAGE_CSS = LEDGER_CSS + USAGE_CSS + REPORT_CSS + `
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
a.sp-btn { display: inline-flex; align-items: center; text-decoration: none; }
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
.sp-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.sp-kind { margin-left: 6px; font-size: 11px; font-weight: bold; }
.sp-kind-fast { color: var(--price); }
.sp-kind-slow { color: var(--warn); }
.sp-left { display: block; margin-top: 2px; }
.sp-left .sp-qty { width: 56px; }
.sp-acc-foot { margin-top: 10px; }
.sp-cancelask { justify-content: flex-start; }
.sp-cancelask > .sp-warnnote { flex: 1 1 100%; color: var(--warn); font-size: 13px; }
.sp-tpick-b { align-items: center; }
.sp-fc.sp-lo { border-style: dashed; }
/* The pin sits in the card's corner, out of the flow: the card's contents
   are where they always were, pinned or not (the owner: "you moved the contents"). */
.sp-fc { position: relative; }
.sp-fc .sp-fc-top { padding-right: 28px; }
.sp-pin { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border-radius: 7px; border: 1px solid var(--cline2); background: #161616; color: var(--muted); cursor: pointer; }
.sp-fc .sp-pin { position: absolute; top: 8px; right: 8px; }
.sp-pin:hover { color: #fff; border-color: #555; }
.sp-pin:focus-visible { outline: 2px solid var(--offer); outline-offset: 1px; }
.sp-pin.sp-pin-on { color: var(--offer); border-color: #2f4466; background: #1b2230; }
.sp-it.sp-it-pin { position: relative; }
.sp-it.sp-it-pin small { padding-right: 30px; }
.sp-it .sp-pin-row { position: absolute; right: 10px; bottom: 6px; width: 22px; height: 22px; }
.sp-it.sp-pinrow { background: #1b2230; border-color: #2f4466; }
.sp-it.sp-pinrow.sp-sel { border-color: var(--offer); }
.sp-pinrow-r { display: inline-flex; align-items: center; gap: 6px; }
.sp-pinsep { border-top: 1px dashed var(--cline2); margin: 4px 0 8px; }
.sp-badge-bad { color: var(--bad); }
.sp-heldtag { margin-left: 8px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--offer); }
.sp-mainnote { margin: 4px 0 6px; color: var(--text); }
.sp-add { padding: 2px 10px; }
.sp-fc .sp-lo-x { margin-left: auto; padding: 4px 8px; color: var(--offer); font-weight: bold; }
.sp-chat { min-width: 64px; justify-content: center; gap: 6px; }
.sp-q > .sp-note + .sp-note { margin-top: 6px; }
.sp-tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 8px 6px; border-top: 1px solid var(--cline); }
.sp-q h3 + .sp-tr, .sp-q .sp-note + .sp-tr { border-top: 0; }
.sp-tr.sp-top { background: var(--green-bg); border-radius: 9px; border-top-color: transparent; }
.sp-tr.sp-top + .sp-tr { border-top-color: transparent; }
.sp-tr.sp-stale .sp-tprice, .sp-tr.sp-stale b, .sp-tr.sp-stale small { color: #8c8c8c; }
.sp-tr-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sp-tr-l small { font-size: 12px; color: var(--muted); }
.sp-tr-l small.sp-differ { color: var(--warn); }
.sp-note.sp-warnnote { color: var(--warn); }
.sp-trader-l { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.sp-pname { color: #fff; font-weight: bold; }
.sp-tprice { font-weight: bold; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-top .sp-tprice { color: var(--price); }
.sp-links { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.sp-tr .sp-links { display: grid; grid-template-columns: 64px 64px 76px minmax(0, 1fr); align-items: center; }
.sp-tr .sp-links .sp-blk { grid-column: -2 / -1; justify-self: end; }
.sp-fav, .sp-blk { width: 24px; height: 24px; padding: 0; border-radius: 7px; border: 1px solid var(--cline2); background: #161616; color: #8a8a8a; font: 13px/22px Arial, Helvetica, sans-serif; cursor: pointer; }
.sp-fav:hover, .sp-blk:hover { color: var(--text); border-color: #555; }
.sp-fav.sp-fav-on { color: #f2c94c; border-color: #6b5a22; background: #262110; }
.sp-blk:hover { color: #ff6b6b; }
.sp-tr-l small.sp-traded { color: var(--muted); }
.sp-blnote { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sp-tr .sp-links.sp-links-one { display: flex; }
.sp-chip {
    display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 10px; font-size: 12px; white-space: nowrap;
    color: var(--offer); border: 1px solid #3d4f5c; border-radius: 8px;
}
.sp-chip:hover { text-decoration: none; background: rgba(116, 192, 252, 0.12); }
.sp-chip-none { visibility: hidden; }
.sp-showall { margin-top: 8px; }
.sp-tsec { margin: 12px 0 4px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.sp-th { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-top: 4px; }
.sp-th-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sp-th-r { margin-left: auto; text-align: right; }
.sp-th-r small { display: block; color: var(--muted); font-size: 12px; }
.sp-ti { display: grid; grid-template-columns: 18px 44px minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 8px 0; border-top: 1px solid #2f3a1c; }
.sp-ti.sp-off b, .sp-ti.sp-off small, .sp-ti.sp-off .sp-ti-p { color: #8c8c8c; }
.sp-tick { width: 16px; height: 16px; margin: 0; accent-color: var(--price); }
.sp-ti-l { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sp-ti-l small { color: var(--muted); font-size: 12px; }
.sp-tiname { color: #fff; font-weight: bold; text-decoration: none; }
.sp-tiname:hover { text-decoration: underline; }
.sp-here { margin-left: 6px; font-size: 11px; font-weight: bold; color: var(--price); }
.sp-ti-p { text-align: right; font-weight: bold; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-ti-p.sp-good { color: var(--price); }
.sp-ti-p small { display: block; font-weight: normal; color: var(--muted); font-size: 12px; }
.sp-buys { grid-column: 3 / 5; display: flex; flex-direction: column; gap: 4px; }
.sp-buy { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); }
.sp-buy .sp-chip { margin-left: auto; }
.sp-qty { width: 72px; height: 26px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--cline2); background: #0f0f0f; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; }
.sp-in-bad, .sp-key.sp-in-bad { border-color: #e05a4f !important; box-shadow: 0 0 0 1px #e05a4f; }
.sp-trade-links { display: flex; justify-content: flex-end; margin-top: 10px; }
.sp-tradeline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.sp-tradeline small { color: var(--muted); font-size: 12px; }
.sp-plan { height: 26px; padding: 0 10px; font-size: 12px; }
.sp-plan-on { display: inline-flex; align-items: center; border-radius: 13px; border: 1px solid var(--hot-line); color: var(--price); font-weight: bold; background: var(--green-bg); }
.sp-tr.sp-planning { box-shadow: inset 3px 0 0 var(--price); }
/* Dimmed by colour, not see-through: its words stay readable (review M10). */
.sp-tr.sp-declined .sp-tprice, .sp-tr.sp-declined .sp-trader-l, .sp-tr.sp-declined small, .sp-tr.sp-hidden .sp-tprice, .sp-tr.sp-hidden .sp-trader-l, .sp-tr.sp-hidden small { color: #8c8c8c; }
.sp-tr.sp-troll .sp-tprice { color: var(--muted); text-decoration: line-through; }
.sp-scan { display: flex; flex-direction: column; gap: 8px; margin: 0 0 16px; }
.sp-scanh { margin: 0; }
.sp-fold { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; font: inherit; }
.sp-fold h2 { margin: 0; }
.sp-fold:hover h2 { color: #fff; }
.sp-chev { width: 12px; color: var(--muted); font-size: 12px; }
.sp-scangrid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1400px) { .sp-scangrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.sp-tc { cursor: default; }
.sp-tc.sp-tc-none { background: var(--card); border-color: var(--cline2); }
.sp-inerr { color: #ff8a80; font-size: 12px; font-weight: bold; }
.sp-tc .sp-go { margin-top: auto; }
.sp-tc .sp-go.sp-go-on { border-color: var(--offer); color: var(--offer); }
.sp-star { color: #f2c94c; }
.sp-lastpaid { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; border-radius: 9px; border: 1px solid #7a5210; color: var(--warn); white-space: nowrap; }
.sp-fc-p.sp-est { color: #c3ea6f; }
.sp-tc small.sp-traded { color: var(--muted); }
.sp-tpick { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 2px 0 6px; }
.sp-itemnote { margin: 6px 0; }
.sp-tpick-b { display: flex; gap: 6px; flex-wrap: wrap; }
.sp-buy .sp-tick { flex: 0 0 auto; }
.sp-check-ok .sp-checkword { color: var(--price); }
.sp-check-price .sp-checkword, .sp-check-short .sp-checkword { color: var(--warn); font-weight: bold; }
.sp-check-gone .sp-checkword { color: var(--bad); font-weight: bold; }
.sp-check-bought { opacity: 0.6; }
.sp-gone { opacity: 0.8; }
.sp-gone-mark { width: 16px; height: 16px; border-radius: 50%; background: var(--warn); color: #131313; font-weight: bold; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.sp-gone small { color: var(--warn); }
.sp-buy .sp-bad { color: var(--bad); font-weight: bold; }
.sp-repl { color: var(--text); }
.sp-repl .sp-link { font-size: 12px; }
.sp-drop { display: block; margin: 4px 0 0 auto; height: 24px; padding: 0 8px; font-size: 12px; }
.sp-neverlist { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.sp-never { font-size: 12px; }
.sp-keeplist { display: flex; flex-direction: column; gap: 6px; }
.sp-keeprow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
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
.sp-radio { display: flex; flex-direction: column; gap: 8px; }
.sp-radio-o { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.sp-radio-o input[type="radio"] { width: 16px; height: 16px; margin: 0; accent-color: var(--profit); cursor: pointer; }
.sp-radio-o .sp-key { flex: 0 1 220px; }
.sp-key.sp-dim { color: var(--muted); }
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
    .sp-sec > h2, .sp-scanh .sp-fold { flex: 1 0 100%; }
    .sp-sp { display: none; }
    .sp-toggle { flex: 1; justify-content: center; }
    /* A desktop window at half a screen (3.14.3 review): two cards a row, and the list before the desk. */
    .sp-strip, .sp-scangrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sp-desk { grid-template-columns: minmax(0, 1fr); }
    .sp-ws { position: static; }
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
