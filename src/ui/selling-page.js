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
import { sharedNowLine, sharedKeyLine, sharedKeyBoxLine, sharedSplit, sharedKnown } from '../core/shared.js';
import { TRADE_MAX_UNITS, countView, stepRank } from '../core/accepted.js';
import { enoughProfit } from '../core/profit.js';
import { stillLine, togetherBy, keptOrder } from '../core/still.js';
import { sameGoodsWords } from '../core/same-goods.js';
import { TO_SELL_WHY, whereRowView } from '../core/to-sell.js';
import { matchFifo, ledgerByPeriod, periodStart } from '../core/ledger.js';
import { listAgeText, nextSort, SORT_FIRST_DIR } from '../core/traders.js';
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
import { FRESH_DEFAULTS, FRESH_MIN, FRESH_MAX, FRESH_TOP, freshMinutes, keepsUp } from '../core/desk.js';
import { BIDS_CSS } from './bids-css.js';
import { SELLER_MOST_ENEMIES, SELLER_ENEMIES_PER_FRIEND } from '#engines/rules/seller-rule.js';
import { bdBuildShell, bdShow, bdTabs, bdNavCount, bdPut, bdMoveInd, bdIcon, bdFilterOf, BD_FLIPS_BEST, BD_FLIPS_TRADER, BD_FLIPS_ITEMS, BD_FLIPS_OWNER, BD_TRADES_PAST, BD_ITEMS_ALL, BD_ITEMS_RESELL } from './bids-shell.js';
import { OwnerView, OWNER_CSS } from './owner-page.js';
import { OWNER_MARKET, OWNER_MARKET_NAME } from '../core/owner-tab.js';
import { pastState, pastMoved, pastTotals, pastSpan, pastWhen, pastSource, pastTradeText } from '../core/past-trades.js';

export const SELLING_PAGE_TITLE = 'Torn Bids';

export const SELLING_PAGE_DEFAULTS = {
    /* Only traders known to be online. */
    onlineOnly: false,
    /* Only traders whose trust badge is Trusted. On from the start: money changes hands on trust. */
    trustedOnly: true,
    /* Not a TornW3B price from a list its trader has not changed in a day (3.22.0; PRICES_STALE_MS). */
    freshOnly: true,
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
    /*
     * The seller rule (3.33.0, the owner's rule; #engines/rules/seller-rule.js): a bazaar's seller with more
     * enemies than this, or more enemies than friends times the second, is never bought from.
     */
    sellerMostEnemies: SELLER_MOST_ENEMIES,
    sellerEnemiesPerFriend: SELLER_ENEMIES_PER_FRIEND,
    /* What you keep of your own when a trade offers it: itemId -> n | 'all'. */
    keep: {},
    /*
     * Categories a flip (and so a trade) never buys: the friend, 2026-09-27,
     * "don't include clothes". Weapons, armour and cars are never flipped
     * whatever this says (every copy is its own).
     */
    neverFlip: ['Clothing', 'Other'],
    /* My items and All items: the column each is sorted by, {all, mine} -> {key, dir} (none: the usual order). */
    listSort: {},
    /*
     * Settings › Bazaar prices (3.20): how often each group's bazaars are read
     * again, in whole minutes from 1 to 10 (core/desk.js freshnessMs).
     */
    freshDeskMin: FRESH_DEFAULTS.desk,
    freshTopMin: FRESH_DEFAULTS.top,
    freshOtherMin: FRESH_DEFAULTS.other,
};

/* Settings' tabs, and which of its parts each holds. */
const BD_SET_KEYS = 0;
const BD_SET_FLIPS = 1;
const BD_SET_HELP = 2;
const BD_SET_OF = { keys: BD_SET_KEYS, te: BD_SET_KEYS, w3b: BD_SET_KEYS, shared: BD_SET_KEYS, ledger: BD_SET_KEYS, flips: BD_SET_FLIPS, fresh: BD_SET_FLIPS, links: BD_SET_FLIPS, api: BD_SET_HELP, report: BD_SET_HELP, terms: BD_SET_KEYS };
/* The Ledger's tabs, in the order of the tabs on top. */
const BD_LEDGER_TABS = ['trade', 'sold', 'receipts', 'traders', 'mugs'];
/* Bazaars and traders shown for an item before "Show all" (its box scrolls). */
const BD_ROWS = 12;


/** The item list shows this many at a time. */
export const ALL_ITEMS_PAGE = 50;

/** Traders and bazaars shown per item before "Show all" (on Torn's pages; Torn Bids' own boxes scroll). */
export const DESK_ROWS = 5;

/** The item list's filters. */
export const SELL_FILTERS = ['all', 'mine', 'flips', 'sell', 'trades'];

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

/** Torn's own picture of an item, as its pages show it: 'small', 'medium' or 'large'. */
export function itemImageUrl(itemId, size = 'small') {
    return 'https://www.torn.com/images/items/' + encodeURIComponent(String(itemId)) + '/' + (size === 'large' || size === 'medium' ? size : 'small') + '.png';
}

/** The pin (3.14): an outline pin, drawn in the current colour. */
/**
 * The (i) beside a name (mockup AM): what it is for, shown on hover or focus. It is a real box, not a
 * title, so the links in it stay links.
 */
function helpTip(children, label = '') {
    const tip = spEl('span', { class: 'ip', role: 'tooltip' }, children);
    return spEl('span', { class: 'i', tabindex: '0', 'aria-label': label ? 'About ' + label : 'About this' }, ['i', tip]);
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
/** The waiting deals shown when the amber line is opened: the best few (a peek, not a second list). */
const STILL_PEEK = 6;

function signed(n) {
    return (n >= 0 ? '+' : '−') + formatMoney(Math.abs(n));
}

function count(n) {
    return Number(n).toLocaleString('en-US');
}

/** "+$56k", "−$1.2m": a profit in the little room over a bar. */
function shortMoney(n) {
    const v = Math.abs(n);
    const text = v >= 1e9 ? (v / 1e9).toFixed(1) + 'b' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'm' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v));
    return (n >= 0 ? '+$' : '−$') + text.replace('.0', '');
}

/** Sets style values on a node (a name starting "--" is a variable) and returns it. Never an inline style attribute. */
function spVars(node, vars) {
    for (const [name, value] of Object.entries(vars)) {
        if (name.startsWith('--')) node.style.setProperty(name, String(value));
        else node.style[name] = String(value);
    }
    return node;
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

/**
 * The one line under a trade's left-out items (3.23.0): how many are not
 * offered, and why - no cash, no pay or no room for even one of them.
 * @param {string} name - the trader
 * @param {number} shown - left-out items that still fit
 * @param {number} hidden - left-out items that do not
 */
export function leftHiddenText(name, shown, hidden) {
    if (!(hidden > 0)) return '';
    const n = Number(hidden).toLocaleString('en-US');
    const why = ': your Cash for flips, what ' + name + ' can pay or the ' + TRADE_MAX_UNITS.toLocaleString('en-US') + ' items of one trade leave no room for ' + (hidden === 1 ? 'it' : 'them') + '.';
    return shown > 0
        ? n + ' more ' + (hidden === 1 ? 'is' : 'are') + ' not shown' + why
        : name + ' buys ' + n + (hidden === 1 ? ' more item' : ' more items') + ', not shown' + why;
}

/**
 * Torn Bids, closed (3.25.0): the panel on Torn's pages is on NPC Arbitrage, and the owner's rule is one
 * job at a time - "if were at tornbids, npc arbitradge is closed. 0 api calls, same thing when we have npc
 * arbitradge open, tornbids is closed". The page says so and holds one button; nothing else of Torn Bids
 * is started, so nothing is read.
 *
 * @param {object} h
 * @param {function} h.onTurnOn - Torn Bids is turned on (NPC Arbitrage closes), and this page starts
 * @returns {HTMLElement} the host element
 */
export function mountBidsClosed({ onTurnOn }) {
    const host = document.createElement('div');
    host.id = 'ttv2-sell-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147482000;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(spEl('style', { text: TOKENS_CSS + `
:host { all: initial; }
.closed-page { position: absolute; inset: 0; display: grid; place-items: center; background: #0c0d10; color: #e6e8ee; font: 400 14px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
.closed-box { width: min(440px, calc(100% - 40px)); padding: 26px 26px 24px; border-radius: 14px; background: #17191e; display: grid; gap: 12px; justify-items: start; }
.closed-box h1 { margin: 0; font: 400 24px/1.2 Georgia, "Iowan Old Style", "Times New Roman", serif; }
.closed-box p { margin: 0; color: #a2a8b6; }
.closed-box p b { color: #e6e8ee; font-weight: 600; }
.closed-box button { height: 34px; padding: 0 16px; border: 0; border-radius: 9px; background: #6fdc7f; color: #0b1a0e; font: 650 14px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; cursor: pointer; }
.closed-box button:hover { background: #8ae897; }
.closed-box button:focus-visible { outline: 2px solid #e6e8ee; outline-offset: 2px; }
.closed-box small { color: #7c8392; font-size: 12px; }
` }));
    const btn = spEl('button', { type: 'button', text: 'Turn Torn Bids on', onclick: () => onTurnOn && onTurnOn() });
    shadow.appendChild(spEl('div', { class: 'closed-page' }, [
        spEl('div', { class: 'closed-box', role: 'status' }, [
            spEl('h1', { text: 'Torn Bids is closed' }),
            spEl('p', {}, [spEl('b', { text: 'NPC Arbitrage is on' }), ', so nothing is read here: 0 API calls. Your trades, To sell and Ledger are kept as they were.']),
            btn,
            spEl('small', { text: 'Turning it on closes NPC Arbitrage in the panel on Torn\'s pages. One job at a time.' }),
        ]),
    ]));
    document.documentElement.appendChild(host);
    document.title = SELLING_PAGE_TITLE + ' (closed)';
    if (!document.querySelector('meta[name="viewport"]')) {
        (document.head || document.documentElement).appendChild(spEl('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }));
    }
    document.documentElement.style.overflow = 'hidden';
    btn.focus({ preventScroll: true });
    return host;
}

export class SellingPage {
    /**
     * @param {object} handlers
     *   onSaveKey(key), onForgetKey(), onRevealKey()
     *   onSaveTeKey(key), onForgetTeKey(), onRevealTeKey(), onRetryTe()
     *   onRefresh(), onPrefsChange(partial)
     *   onSelect(itemId)            - pick an item for the desk
 *   onTradeUnpick(itemId, key)  - Planning pressed again: that plan off the desk
 *   onTradeEvery(itemId, key, on) - Every flip: the trade with that trader planned with every item they buy (off: the usual plan)
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
        // Refresh pressed on a trader: trade key -> when (the row says "Reading…" until the answer is in).
        this.checkPressed = new Map();
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
        const asked = JSON.stringify([s.filter, s.category, this.query, s.prefs.onlineOnly, s.prefs.trustedOnly, s.prefs.freshOnly, s.prefs.cash, s.prefs.listSort]);
        const changed = asked !== this.orderAsked;
        this.orderAsked = asked;
        if (changed || !this.hover || !this.order.length) {
            this.order = rows.map((r) => r.itemId);
            return rows;
        }
        // Best flips (2026-10-16): each trader's rows together at the first of them (core/still.js keptOrder) - a
        // Dahlia that turned up a moment later stood last, as a second KayMalta row.
        const kept = keptOrder(this.order, rows);
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
                // Nothing is left unsaved (leaving a box saves it): Esc goes back from the Ledger and Settings.
                if (this.view !== 'list') this.go(this.backTo || 'today');
                return;
            }
            // "/" jumps to the list's search box, as on most sites with one.
            const typing = event.composedPath().some((n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT'));
            if (event.key === '/' && !typing && this.listPanel.isConnected && !this.findEl.hidden) {
                event.preventDefault();
                this.searchEl.focus();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
        this.resizeHandler = () => bdMoveInd(this);
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
        if (this.stepHandler) window.removeEventListener('popstate', this.stepHandler);
        if (this.ticker) clearInterval(this.ticker);
        if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
        document.documentElement.style.overflow = this.prevOverflow || '';
        this.host = null;
        this.root = null;
    }

    /* ------------------------------------------------------------ build */

    build() {
        const set = (partial) => this.h.onPrefsChange && this.h.onPrefsChange(partial);
        this.tabAt = {};
        this.visit = {};
        this.traderQuery = '';
        this.favOnly = false;
        const ph = (title, sub, more = []) => spEl('div', { class: 'ph' }, [spEl('h2', { text: title }), sub ? spEl('span', { class: 'sub', text: sub }) : null, ...more]);
        const sp = () => spEl('span', { class: 'sp' });

        /* the bar across the top: your Cash, how old the prices are, Read now */
        this.cashPill = spEl('button', { type: 'button', class: 'pill', title: 'Flips never plan to spend more than this. Press to change it.', onclick: () => {
            this.go('settings', BD_SET_FLIPS);
            this.cashInput.focus();
        } });
        this.pricesPill = spEl('span', { class: 'pill', tabindex: '0' });
        this.refreshBtn = spEl('button', { type: 'button', class: 'btn', title: 'Force read: what is on show is read again now from Torn, TornW3B and TornExchange, within their limits', text: 'Read now', onclick: () => this.h.onRefresh && this.h.onRefresh() });
        // Redraw (mockup AM, the owner: "a reload button that updates ui if slow"): no read, the page drawn again from what is kept.
        this.redrawBtn = spEl('button', { type: 'button', class: 'ib', 'aria-label': 'Redraw', title: 'Redraw: the page drawn again now from the prices already read (no read)', onclick: () => this.redrawAll() }, [bdIcon('redo')]);
        this.bannerEl = spEl('div', { class: 'sp-banner', role: 'status' });

        /* the list: its own search and filters, then a table */
        this.searchEl = spEl('input', { type: 'search', class: 'inp q', placeholder: 'Search items… ( / )', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' });
        this.searchEl.addEventListener('input', () => {
            // By trader: the box looks through the traders, here; elsewhere through the items.
            if (this.onTraders()) {
                this.traderQuery = this.searchEl.value;
                this.listSig = null;
                this.renderList();
                return;
            }
            this.query = this.searchEl.value;
            if (this.h.onQuery) this.h.onQuery(this.searchEl.value);
        });
        // The category (the owner picked mockups/M-category-dropdown.html): Torn's item types, each with how many items it has.
        this.catEl = spEl('select', { class: 'inp', 'aria-label': 'Category', title: 'Category: filters the flips and the list' });
        this.catEl.addEventListener('change', () => this.h.onCategory && this.h.onCategory(this.catEl.value));
        this.invEl = spEl('span', { class: 'quiet', hidden: '', title: 'Torn\'s count of what is in your inventory' });
        this.findEl = spEl('div', { class: 'find' }, [this.searchEl, this.catEl, this.invEl]);
        const tog = (label, title, key) => spEl('button', { type: 'button', class: 'tog', 'aria-pressed': 'false', title, text: label, onclick: () => set({ [key]: !this.state.prefs[key] }) });
        this.onlineBtn = tog('Online', 'Only traders known to be online', 'onlineOnly');
        this.trustedBtn = tog('Trusted', 'Only traders other players vouch for', 'trustedOnly');
        // Fresh prices only (3.22.0, the owner): a price from a list not changed in a day (PRICES_STALE_MS) is not shown.
        this.freshBtn = tog('Fresh prices', 'Hides a trader\'s TornW3B price when they have not changed their price list in a day, unless their list was just read open (TornExchange prices have no date and stay)', 'freshOnly');
        this.favBtn = spEl('button', { type: 'button', class: 'tog', 'aria-pressed': 'false', hidden: '', title: 'Your favourites only', text: '★ Favourites', onclick: () => {
            this.favOnly = !this.favOnly;
            this.favBtn.classList.toggle('on', this.favOnly);
            this.favBtn.setAttribute('aria-pressed', String(this.favOnly));
            this.listSig = null;
            this.renderList();
        } });
        this.onlyEl = spEl('div', { class: 'only' }, ['Only', this.onlineBtn, this.trustedBtn, this.freshBtn, sp(), this.favBtn]);
        // Clear all asks first (the whole list goes in one press): the question stands where the button was.
        this.clearEl = spEl('span', { class: 'clearq' });
        const drawClear = (asking) => {
            this.clearEl.textContent = '';
            if (!asking) {
                this.clearEl.appendChild(spEl('button', {
                    type: 'button',
                    class: 'quiet u',
                    'data-focus': 'sell:clear',
                    title: 'Takes every row a trade left off this list. The items stay in your inventory; rows also go by themselves, as your Ledger shows them sold.',
                    text: 'Clear all',
                    onclick: () => drawClear(true),
                }));
                return;
            }
            const yes = spEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'sell:clear-yes', text: 'Yes, clear', onclick: () => {
                drawClear(false);
                if (this.h.onLeftoversClear) this.h.onLeftoversClear();
            } });
            this.clearEl.append(spEl('span', { text: 'Clear every row? The items stay in your inventory.' }), yes, this.wordBtn('Keep them', 'sell:clear-no', '', () => drawClear(false)));
            yes.focus({ preventScroll: true });
        };
        drawClear(false);
        this.listPh = ph('Bought to resell, still held', 'by who pays most · a row leaves when it is sold', [sp(), this.clearEl]);
        this.listPh.hidden = true;
        // A trade stays still (3.25.0): the line above the list.
        this.stillEl = spEl('div', { class: 'sp-still-box', hidden: '' });
        this.stillTag = spEl('span');
        this.stillOpen = false;
        this.listHead = spEl('thead');
        this.listBody = spEl('tbody');
        this.listEmpty = spEl('div', { class: 'empty', hidden: '' });
        this.moreBtn = spEl('button', { type: 'button', class: 'btn sm more', text: 'Show more', hidden: '', onclick: () => this.h.onMore && this.h.onMore() });
        this.listBox = spEl('div', { class: 'pb flush' }, [spEl('table', { class: 't' }, [this.listHead, this.listBody]), this.listEmpty, this.moreBtn]);
        // Numbers update under your pointer, the order does not: a row never moves while you are about to press it.
        this.listBox.addEventListener('pointerenter', () => {
            this.hover = true;
        });
        this.listBox.addEventListener('pointerleave', () => {
            this.hover = false;
            this.listSig = null;
            this.renderList();
        });
        this.listSum = spEl('div', { class: 'sumrow' });
        this.listPanel = spEl('div', { class: 'panel' }, [this.listPh, this.findEl, this.onlyEl, this.listSum, this.stillEl, this.listBox]);

        /* what you picked: its head, who sells it, who pays for it, the trade, where to sell it */
        this.headEl = spEl('div', { class: 'panel hd fx' });
        this.askBox = spEl('div', { class: 'pb flush' });
        this.askEl = spEl('div', { class: 'panel' }, [ph('Bazaars sell', 'cheapest first'), this.askBox]);
        this.paySub = spEl('span', { class: 'sub', text: 'highest first · press one to trade with them' });
        this.payBox = spEl('div', { class: 'pb flush' });
        this.payEl = spEl('div', { class: 'panel' }, [spEl('div', { class: 'ph' }, [spEl('h2', { text: 'Traders pay' }), this.paySub]), this.payBox]);
        this.buysTitle = spEl('h2', { text: 'What they pay' });
        this.buysBox = spEl('div', { class: 'pb flush' });
        this.buysEl = spEl('div', { class: 'panel' }, [spEl('div', { class: 'ph' }, [this.buysTitle, spEl('span', { class: 'sub', text: 'beside the cheapest bazaar · grey rows leave too little' })]), this.buysBox]);
        this.planEl = spEl('div', { class: 'panel planp' });
        this.whereEl = spEl('div', { class: 'panel' });
        // On My items and To sell the trade is one row: the whole of it is on Flips and on Trades.
        this.tradeFoldEl = spEl('div', { class: 'panel fold', hidden: '' });
        this.deskParts = [this.headEl, this.askEl, this.payEl, this.buysEl, this.planEl, this.whereEl, this.tradeFoldEl];

        /* each page's few totals, the Trades board, and Today */
        // Each page's few totals are one line (mockup AM): what each means is in its hover.
        this.tradesTiles = spEl('div', { class: 'sumline' });
        this.mineTiles = spEl('div', { class: 'sumline' });
        this.sellTiles = spEl('div', { class: 'sumline' });
        this.boardEl = spEl('div', { class: 'board' });
        this.boardPanel = spEl('div', { class: 'panel' }, [spEl('div', { class: 'ph' }, [spEl('h2', { text: 'Going' }), this.tradesTiles]), spEl('div', { class: 'pb flush' }, [this.boardEl])]);
        // Trades > History (3.27.0): its totals, the last 30 trades, and the one picked.
        this.pastTiles = spEl('div', { class: 'sumline' });
        this.pastBody = spEl('tbody');
        this.pastEmpty = spEl('div', { class: 'empty', hidden: '', text: 'No trade yet. A trade is written down here the moment its trader says yes, with the prices it was made on.' });
        this.pastTable = spEl('table', { class: 't' }, [spEl('thead', {}, [spEl('tr', {}, [spEl('th', { text: 'Trader' }), spEl('th', { text: 'They said yes' }), spEl('th', { class: 'n', text: 'In it' }), spEl('th', { class: 'n', text: 'They pay' }), spEl('th', { text: 'How it ended' })])]), this.pastBody]);
        this.pastListEl = spEl('div', { class: 'panel' }, [spEl('div', { class: 'ph' }, [spEl('h2', { text: 'The last 30 trades' }), this.pastTiles]), spEl('div', { class: 'pb flush' }, [this.pastTable, this.pastEmpty])]);
        this.pastSideEl = spEl('div', { class: 'panel planp hist' });
        this.pastSel = null;
        // Today (mockup AM): four totals; the best trades and what to do now; your profit per day and what you hold.
        this.todayTiles = spEl('div', { class: 'kpis' });
        this.todayFlips = spEl('div', { class: 'grow-rows' });
        this.todayDo = spEl('div', { class: 'next' });
        this.todayHold = spEl('div', { class: 'pb' });
        this.todayChart = spEl('div', { class: 'chartbox' });
        const goBtn = (label, id, tab = null) => spEl('button', { type: 'button', class: 'btn sm gh', text: label, onclick: () => this.go(id, tab) });
        // By trader while a trader's trade is ready; else Best flips, where the flips by item are.
        this.todayAll = spEl('button', { type: 'button', class: 'btn sm gh', text: 'All traders', onclick: () => this.go('flips', this.todayAllTab == null ? BD_FLIPS_TRADER : this.todayAllTab) });
        const today = [
            this.todayTiles,
            spEl('div', { class: 'panel s8' }, [ph('Best flips', 'the whole trade, by trader', [sp(), this.todayAll]), spEl('div', { class: 'pb flush' }, [this.todayFlips])]),
            spEl('div', { class: 'panel s4' }, [ph('Do now', null), spEl('div', { class: 'pb' }, [this.todayDo])]),
            spEl('div', { class: 'panel s8' }, [ph('Profit per day', '10 days', [sp(), goBtn('Ledger', 'ledger')]), spEl('div', { class: 'pb' }, [this.todayChart])]),
            spEl('div', { class: 'panel s4' }, [ph('What you hold', 'at the best trader', [sp(), goBtn('Items', 'items', BD_ITEMS_ALL)]), this.todayHold]),
        ];

        /* the Torn Ledger */
        // 3.32.0 - Flips > For <the shared server's owner>: its three parts and its tiles (place() moves them in).
        this.ownerView = new OwnerView(this, { tradeUrl });
        this.ledgerView = new LedgerView({
            onRead: () => this.h.onLedgerRead && this.h.onLedgerRead(),
            onOpenSettings: () => {
                this.go('settings', BD_SET_KEYS);
                const sec = this.snavSections && this.snavSections.find((x) => x.id === 'ledger');
                if (sec) sec.sec.scrollIntoView({ block: 'start' });
                if (this.ledgerKeyInput) this.ledgerKeyInput.focus({ preventScroll: true });
            },
            // The Ledger moved to another of its tabs by itself (a press inside it): the tabs on top follow.
            onTab: (key) => {
                const i = BD_LEDGER_TABS.indexOf(key);
                if (i >= 0 && this.bd.page === 'ledger') this.go('ledger', i, true);
            },
            onOpenUrl: (url) => this.h.onOpenUrl && this.h.onOpenUrl(url),
            onFavourite: (b, on) => this.h.onFavourite && this.h.onFavourite(b, on),
            onBlacklist: (b, on) => this.h.onBlacklist && this.h.onBlacklist(b, on),
        });

        /* settings */
        this.settingsEl = spEl('div');
        this.buildSettings();

        bdBuildShell(this, {
            title: SELLING_PAGE_TITLE,
            tagline: 'Every item, both sides',
            parts: { top: [this.cashPill, this.pricesPill, this.refreshBtn, this.redrawBtn], today, ledger: [this.ledgerView.el], settings: [this.settingsEl] },
        });
        this.bd.mainEl.insertBefore(this.bannerEl, this.bd.viewEl);
        this.bd.sharedEl.addEventListener('click', () => this.go('settings', BD_SET_KEYS));
        this.go('today', 0, true);
        // 3.26.1 - the browser's Back and Forward (and a mouse's side buttons) go between the pages: the address
        // keeps the page. Opened or reloaded with a page in the address, that page is shown. (#mine and #sell,
        // from before Items, open its two tabs.)
        const named = String(location.hash || '').slice(1);
        const old = { mine: ['items', BD_ITEMS_ALL], sell: ['items', BD_ITEMS_RESELL] }[named];
        if (old) this.go(old[0], old[1], true);
        else if (named !== 'today' && this.bd.pages[named]) this.go(named, null, true);
        this.stepReady = true;
        this.remember(false);
        this.stepHandler = (e) => {
            const at = (e && e.state) || {};
            let page = at.ttv2Page || String(location.hash || '').slice(1) || 'today';
            let tab = Number.isInteger(at.ttv2Tab) ? at.ttv2Tab : null;
            if (page === 'mine' || page === 'sell') [page, tab] = ['items', page === 'sell' ? BD_ITEMS_RESELL : BD_ITEMS_ALL];
            if (!this.bd || !this.bd.pages[page]) return;
            this.stepping = true;
            try {
                this.go(page, tab);
            } finally {
                this.stepping = false;
            }
        };
        window.addEventListener('popstate', this.stepHandler);
    }

    /** The page and tab in view, kept in the address: a new page is a new step for Back, a tab only updates the step it is on. */
    remember(step) {
        if (!this.stepReady || this.stepping) return;
        try {
            window.history[step ? 'pushState' : 'replaceState']({ ttv2Page: this.bd.page, ttv2Tab: this.bd.tab }, '', '#' + this.bd.page);
        } catch {
            // a page that cannot keep its address still works
        }
    }

    /* ------------------------------------------------------- pages and tabs */

    /** The tabs of a page, in the words shown now. */
    tabsOf(id) {
        // 3.32.0 - a tab for the one trader whose own price list the shared server holds, by the name Torn gave.
        if (id === 'flips') {
            return ['Best flips', 'By trader', 'All items', ...(this.state.owner ? ['For ' + this.state.owner.name] : [])];
        }
        if (id === 'ledger') {
            const mugs = ((this.state.ledger || {}).mugs || []).length;
            return ['Trading', 'Sold', 'Receipts', 'Traders', 'Mugged' + (mugs ? ' · ' + count(mugs) : '')];
        }
        if (id === 'settings') return ['Keys and sharing', 'Flips and reading', 'Help'];
        if (id === 'trades') return ['Going', 'History'];
        if (id === 'items') {
            const c = this.state.counts || {};
            return ['Everything' + (c.mine ? ' · ' + count(c.mine) : ''), 'To resell' + (c.sell ? ' · ' + count(c.sell) : '')];
        }
        return null;
    }

    /**
     * The page in view in the words the parts use: Items' two tabs are what were the My items and To sell
     * pages ('mine', 'sell'), every other page is its own id.
     */
    pg() {
        const { page, tab } = this.bd;
        return page === 'items' ? (tab === BD_ITEMS_RESELL ? 'sell' : 'mine') : page;
    }

    /** Redraw (mockup AM): every part drawn again from what is kept, and the script works the page out again now. Nothing is read. */
    redrawAll() {
        for (const k of Object.keys(this)) if (/Sig$/.test(k)) this[k] = null;
        this.tileSigs = {};
        if (this.ledgerView) this.ledgerView.sig = null;
        if (this.ownerView) this.ownerView.sig = null;
        if (this.bd) this.bd.tabsSig = null;
        if (this.h.onRedraw) this.h.onRedraw();
        else this.render({});
    }

    /** Trades › History is in view. */
    onPast() {
        return Boolean(this.bd) && this.bd.page === 'trades' && this.bd.tab === BD_TRADES_PAST;
    }

    /** Flips › By trader is in view. */
    onTraders() {
        return Boolean(this.bd) && this.bd.page === 'flips' && this.bd.tab === BD_FLIPS_TRADER;
    }

    /** Flips › For <the owner> is in view (and a list of his is held). */
    onOwner() {
        return Boolean(this.bd) && this.bd.page === 'flips' && this.bd.tab === BD_FLIPS_OWNER && Boolean(this.state.owner);
    }

    /**
     * Goes to a page and one of its tabs (the tab it had last when none is given). The parts move there, and
     * the script is told, so the list it works out is this page's.
     * @param {boolean} quiet - only the frame: nothing is told (the page being built, or a tab the Ledger changed itself)
     */
    go(id, tab = null, quiet = false) {
        if (!this.bd || !this.bd.pages[id]) return;
        const t = tab === null || tab === undefined ? this.tabAt[id] || 0 : tab;
        const moved = this.bd.page !== id || this.bd.tab !== t;
        const paged = this.bd.page !== id;
        bdShow(this, id, t, this.tabsOf(id));
        this.tabAt[id] = this.bd.tab;
        if (moved) this.remember(paged);
        this.view = id === 'settings' ? 'settings' : id === 'ledger' ? 'ledger' : 'list';
        // API use and the report are drawn again every few seconds while Settings is open.
        if (id === 'settings' && !this.usageTimer) {
            this.renderUsage();
            this.usageTimer = setInterval(() => this.renderUsage(), 5000);
        } else if (id !== 'settings' && this.usageTimer) {
            clearInterval(this.usageTimer);
            this.usageTimer = null;
        }
        if (id === 'settings') this.settingsTab();
        else if (id !== 'ledger') this.backTo = id;
        if (id === 'ledger') {
            const key = BD_LEDGER_TABS[this.bd.tab] || 'trade';
            if (this.ledgerView.tab !== key) {
                this.ledgerView.tab = key;
                this.ledgerView.sig = null;
            }
            this.ledgerView.render(this.ledgerArgs());
        }
        if (moved) this.visit = {};
        this.syncFind();
        this.place();
        this.listSig = null;
        this.deskSig = null;
        this.renderBanner();
        if (quiet) return;
        if (this.h.onPage) this.h.onPage(this.bd.page, this.bd.tab, bdFilterOf(this.bd.page, this.bd.tab));
        else this.render({});
    }

    /** The page and tab in view, and the list they show: {page, tab, filter} - null before the page is built. */
    shownNow() {
        return this.bd ? { page: this.bd.page, tab: this.bd.tab, filter: bdFilterOf(this.bd.page, this.bd.tab) } : null;
    }

    /** The older names for the three views: the list (Flips), the Ledger, Settings. */
    showView(view) {
        if (view === 'settings') this.go('settings');
        else if (view === 'ledger') this.go('ledger');
        else if (this.view !== 'list') this.go('flips');
    }

    openSettings() {
        this.go('settings', BD_SET_KEYS);
    }

    /** Settings shows the parts of the tab in view. */
    settingsTab() {
        const tab = this.bd.tab;
        for (const s of this.snavSections || []) s.sec.hidden = BD_SET_OF[s.id] !== tab;
        // The first part of a tab has no line over it.
        const first = (this.snavSections || []).map((x) => x.sec).filter((sec) => !sec.hidden).sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))[0];
        for (const x of this.snavSections || []) x.sec.classList.toggle('sp-first', x.sec === first);
        this.flagSettingsTabs();
    }

    /** The mark on a Settings tab that holds something to do (renderSettingsNav works out which). */
    flagSettingsTabs() {
        if (!this.bd || this.bd.page !== 'settings') return;
        [...this.bd.tabsEl.children].forEach((b, i) => {
            const flag = (this.setFlags || [])[i] || null;
            if (flag) {
                b.setAttribute('data-flag', flag);
                b.title = flag === 'bad' ? 'A key was refused' : 'A key is missing';
            } else if (b.hasAttribute('data-flag')) {
                b.removeAttribute('data-flag');
                b.removeAttribute('title');
            }
        });
    }

    /** The list's search row and filters, as the page in view uses them. */
    syncFind() {
        const page = this.pg();
        const traders = this.onTraders();
        this.listPh.hidden = page !== 'sell';
        this.findEl.hidden = page === 'sell';
        this.catEl.hidden = traders;
        this.favBtn.hidden = !traders;
        this.invEl.hidden = page !== 'mine';
        this.searchEl.placeholder = traders ? 'Search traders… ( / )' : page === 'mine' ? 'Search your items… ( / )' : 'Search items… ( / )';
        const want = traders ? this.traderQuery || '' : this.query;
        if (this.searchEl.value !== want) this.searchEl.value = want;
    }

    /** A trade is shown beside what you hold only once you asked for it (or they said yes). */
    planOnSide() {
        const T = this.state.desk && this.state.desk.trade;
        return Boolean(T && (T.accepted || (T.chosen && T.picked)));
    }

    /** Each part into the page in view: one list, one head, one trade - moved, never drawn twice. */
    place() {
        const { page } = this.bd;
        const traders = this.onTraders();
        // For the owner: the section is laid out as a page of totals over two columns, and the picker's pane is off.
        const owner = this.onOwner();
        const flips = page === 'flips' && !owner;
        const fl = this.bd.pages.flips;
        fl.classList.toggle('fit', !owner);
        fl.classList.toggle('pgrows', owner);
        fl.classList.toggle('pgfill', owner);
        fl.firstElementChild.classList.toggle('on', !owner);
        this.bd.ownerPane.classList.toggle('on', owner);
        bdPut(this, 'owner-tiles', owner ? this.ownerView.tilesEl : null);
        bdPut(this, 'owner-left', owner ? this.ownerView.leftEl : null);
        bdPut(this, 'owner-right', ...(owner ? this.ownerView.right() : []));
        // All items: the item list is wider than the trade (mockup AM); Best flips and By trader: the trade is.
        fl.firstElementChild.classList.toggle('wide', this.bd.tab === BD_FLIPS_ITEMS);
        fl.firstElementChild.classList.toggle('trd', traders);
        bdPut(this, 'flips-list', flips ? this.listPanel : null);
        // Who sells and who pays are tabs of the trade's pane (drawPlan moves them in): none stands on its own.
        bdPut(this, 'flips-plan', flips ? this.planEl : null);
        // Trades: the board and the trade pressed (Going), or the last 30 trades and the one picked (History).
        const past = this.onPast();
        bdPut(this, 'trades-board', page === 'trades' && !past ? this.boardPanel : null);
        bdPut(this, 'trades-detail', page === 'trades' && !past ? this.planEl : null);
        bdPut(this, 'past-list', past ? this.pastListEl : null);
        bdPut(this, 'past-side', past ? this.pastSideEl : null);
        this.bd.goingPane.classList.toggle('on', !past);
        this.bd.pastPane.classList.toggle('on', past);
        // Beside what you hold: where to sell it straight under its head, then its trade as one row.
        const items = page === 'items';
        bdPut(this, 'items-list', items ? this.listPanel : null);
        bdPut(this, 'items-side', ...(items ? [this.headEl, this.whereEl, this.planOnSide() ? this.tradeFoldEl : null] : []));
        // The list's one line of totals: Everything's or To resell's.
        const sum = items ? (this.pg() === 'sell' ? this.sellTiles : this.mineTiles) : null;
        if (this.listSum.firstChild !== sum) {
            this.listSum.textContent = '';
            if (sum) this.listSum.appendChild(sum);
        }
        this.listSum.hidden = !sum;
    }

    ledgerArgs() {
        const s = this.state;
        return { ledger: s.ledger || {}, nameOf: s.itemNameOf, typeOf: s.itemTypeOf };
    }

    /* ----------------------------------------------------------- render */

    /**
     * @param {object} view
     *   strip     - the best flips: [{itemId, name, plan, buyer}]
     *   list      - item rows for the filter: [{itemId, name, held, lowest, badge, pending, units, stops, to, top, bid}]
     *   listTotal - rows before the page cut
     *   counts    - {all, mine, flips, sell, trades}
     *   filter    - 'all' | 'mine' | 'flips' | 'sell' | 'trades'
     *   categories - [{category, count}] for the Category dropdown
     *   category  - the one picked, or ''
     *   desk      - the item picked (see renderDesk), or null
     *   scan      - Your traders: the best whole trade with each
     *   toSell, trades, hold, ledger - the pages of those names
     *   statuses  - Map traderId -> {level, text, title}
     *   prefs     - this page's preferences
     *   info      - key states, sources, loading
     */
    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        const p = this.state.prefs;
        for (const [btn, on] of [[this.onlineBtn, p.onlineOnly], [this.trustedBtn, p.trustedOnly], [this.freshBtn, p.freshOnly]]) {
            btn.setAttribute('aria-pressed', String(Boolean(on)));
            btn.classList.toggle('on', Boolean(on));
        }
        this.linksInput.checked = p.linksNewTab !== false;
        // Every settings box shows what is saved (not while you are in it).
        for (const box of this.boxes || []) box.sync();
        const hasCash = p.cash > 0;
        this.cashNone.checked = !hasCash;
        if (!(this.cashInput.getRootNode && this.cashInput.getRootNode().activeElement === this.cashInput)) this.cashUpTo.checked = hasCash;
        this.cashInput.classList.toggle('sp-dim', !hasCash);
        this.renderKeepList(p);
        this.renderNeverFlip(p);
        this.renderFresh(p);
        this.renderBlackList();

        this.renderCategory();
        this.renderLedgerKey();
        if (this.bd.page === 'ledger') this.ledgerView.render(this.ledgerArgs());
        this.renderKeyStates();
        this.renderShared();
        this.renderSettingsNav();
        this.renderPills();
        this.renderBanner();
        this.renderNav();
        this.autoPick();
        this.renderOwner();
        this.place();
        this.renderStill();
        this.renderList();
        this.renderDesk();
        this.renderTiles();
        this.renderBoard();
        this.renderPast();
        this.renderToday();
        this.renderTape();
    }

    /**
     * Flips › For <the owner> (3.32.0), drawn before the parts are placed (what is under the plan depends on it).
     * His list is no longer held while the tab is in view: back to Best flips - the tab is gone from the bar.
     */
    renderOwner() {
        if (this.onOwner()) this.ownerView.render(this.state.owner);
        else if (this.bd.page === 'flips' && this.bd.tab === BD_FLIPS_OWNER) queueMicrotask(() => this.bd.page === 'flips' && this.bd.tab === BD_FLIPS_OWNER && !this.state.owner && this.go('flips', BD_FLIPS_BEST));
    }

    /**
     * A page that shows one thing of a list opens on the first: To sell on its first row, Trades on the
     * first trade going, By trader on the best trade. Once a visit, and never under a press of yours.
     */
    autoPick() {
        const s = this.state;
        const v = this.visit;
        if (v.picked) return;
        const page = this.pg();
        if (page === 'sell' && s.filter === 'sell') {
            v.picked = true;
            const first = s.toSell && s.toSell.open ? (s.toSell.groups[0] ? s.toSell.groups[0].rows[0] : s.toSell.rows[0]) : null;
            if (first) queueMicrotask(() => this.select(first.itemId));
        } else if (page === 'trades' && s.filter === 'trades') {
            v.picked = true;
            const first = s.trades && s.trades.open ? this.tradesGoing().slice().reverse()[0] : null;
            if (first) queueMicrotask(() => this.openTrade(first[0], first[1]));
        } else if (this.onTraders()) {
            const list = ((s.scan && s.scan.list) || []).filter((x) => this.traderReady(x));
            if (!list.length) return;
            v.picked = true;
            const key = this.tradeKeyOnShow();
            if (!list.some((x) => x.key === key)) queueMicrotask(() => this.h.onTradePick && this.h.onTradePick(list[0].mainId, list[0].key));
        }
    }

    /** The key of the trader whose trade is on show, or null. */
    tradeKeyOnShow() {
        const T = this.state.desk && this.state.desk.trade;
        return T && T.accepted ? T.accepted.key : T && T.chosen ? T.chosen.key : null;
    }

    /** A Your traders row has a trade to plan now. */
    traderReady(x) {
        return x.items > 0 && x.profit > 0 && !x.hiddenBy && !x.waiting;
    }

    /* ------------------------------------------ top bar, sidebar, bottom line */

    /**
     * Your Cash for flips (press it to change it), and one pill for how old the prices are: the four
     * sources behind it are on its hover and read out. A source in trouble turns the pill amber or red
     * and is named in it - it never takes over the page while the others are working.
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
        if (info.bazaarsError && !info.bazaarsAt) pill('bad', 'Bazaars', 'not loaded', info.bazaarsError);
        else if (!info.bazaarsAt) pill('idle', 'Bazaars', 'loading', 'Loading bazaar prices from TornW3B');
        // 3.29.0 - TornW3B's sellers lists are used up (its minute, our day's share, or it refused): said, with when
        // the next one can be read. Until now the page only stood still, and nothing said why or for how long.
        else if (info.w3bListing && info.w3bListing.freeAt > now) {
            const ms = info.w3bListing.freeAt - now;
            const wait = ms < 90000 ? Math.max(5, Math.ceil(ms / 5000) * 5) + ' s' : ms < 90 * 60000 ? Math.ceil(ms / 60000) + ' min' : Math.ceil(ms / 3600000) + ' h';
            pill('idle', 'Bazaars', 'TornW3B frees up in ' + wait, 'TornW3B\'s sellers lists are used up for now: the next can be read in ' + wait + '. Prices already read stay, trader price lists are still read (they have no such limit)' + (wanted ? ', and ' + checked + ' of ' + wanted + ' possible flips are checked against every bazaar' : '') + '.');
        }
        else pill(checked < wanted ? 'idle' : 'online', 'Bazaars', age(info.bazaarsAt), 'TornW3B bazaar prices, ' + formatAge(now - info.bazaarsAt) + (wanted ? '. Possible flips checked against every bazaar: ' + checked + ' of ' + wanted : ''));

        const perItem = info.heldCount ? ' Best buyer per item, without a key: ' + (info.teOneDone || 0) + ' of ' + info.heldCount + '.' : '';
        if (info.teStatus === 'ok' && info.teError) pill('idle', 'TornExchange', info.teAt ? age(info.teAt) : '', info.teError);
        else if (info.teStatus === 'ok') pill('online', 'TornExchange', info.teAt ? age(info.teAt) : '', 'TornExchange prices ' + (info.teAt ? formatAge(now - info.teAt) : ''));
        else if (info.teStatus === 'badkey') pill('bad', 'TornExchange', 'key refused', 'Key not accepted.' + perItem);
        else if (info.teStatus === 'nokey') pill('unknown', 'TornExchange', 'no key', 'No TornExchange key.' + perItem);
        else pill('idle', 'TornExchange', 'loading', 'Loading TornExchange prices');

        const want = info.statusesWanted || 0;
        const got = info.statusesKnown || 0;
        pill(want && got >= want ? 'online' : 'idle', 'Online', got + '/' + want, 'Traders\' online status checked: ' + got + ' of ' + want);

        const inv = info.inventoryAt ? 'inventory read ' + formatAge(now - info.inventoryAt) : '';
        if (this.invEl.textContent !== inv) this.invEl.textContent = inv;

        // What the line along the bottom counted (mockup AM): in the Prices pill's hover, with Torn's calls this minute.
        const counts = [];
        if (info.flipsWanted) counts.push(['Possible flips priced', (info.flipsPriced ?? info.flipsChecked) + ' of ' + info.flipsWanted]);
        if (info.flipsWanted) counts.push(['Bazaars read', info.flipsChecked + ' of ' + info.flipsWanted]);
        if (info.pricesWaiting) counts.push(['Flips waiting for a price check', count(info.pricesWaiting)]);
        if (info.w3bKnown) counts.push(['Price lists', count(info.w3bRead || 0) + ' of ' + count(info.w3bKnown)]);
        if (this.h.getUsage && (!this.usageAt || now - this.usageAt > 5000)) {
            this.usageAt = now;
            this.usage = this.h.getUsage();
        }
        const u = this.usage && this.usage.live && this.usage.live.t;
        if (u) counts.push(['Torn API', u.used + ' of ' + u.cap + ' a min']);
        const cash = this.state.prefs.cash;
        const sig = JSON.stringify([pills, cash, counts]);
        if (sig === this.pillSig) return;
        this.pillSig = sig;
        this.cashPill.textContent = '';
        this.cashPill.append('Cash', spEl('b', { text: cash > 0 ? formatMoney(cash) : 'no limit' }));
        // The worst of the four is the pill's dot; a refused or missing one is named in it.
        const bad = pills.find((x) => x.level === 'bad');
        const worst = bad || pills.find((x) => x.level === 'unknown' && x.label === 'TornExchange') || null;
        const busy = pills.some((x) => x.level === 'idle');
        const bz = pills[1];
        const text = worst ? worst.label + ': ' + worst.text : bz.text;
        this.pricesPill.textContent = '';
        const lv = (level) => (level === 'bad' ? ' bad' : level === 'online' ? '' : level === 'unknown' ? ' off' : ' warn');
        const pop = spEl('div', { class: 'pop', role: 'tooltip' }, [
            ...pills.map((x) => spEl('div', { title: x.title }, [spEl('span', {}, [spEl('i', { class: 'dot' + lv(x.level) }), x.label]), spEl('b', { text: x.text || '–' })])),
            counts.length ? spEl('hr') : null,
            ...counts.map(([k, v]) => spEl('div', {}, [spEl('span', { text: k }), spEl('b', { text: v })])),
        ]);
        this.pricesPill.append(spEl('i', { class: 'dot' + (bad ? ' bad' : worst || busy ? ' warn' : '') }), worst ? '' : 'Prices', spEl('b', { text }), pop);
        this.pricesPill.removeAttribute('title');
        this.pricesPill.setAttribute('aria-label', 'Prices. ' + pills.map((x) => x.title).join('. '));
    }

    /** The sidebar: how many each page holds, the tabs' words, and Shared in one line. */
    renderNav() {
        const s = this.state;
        const c = s.counts || {};
        const T = s.trades || {};
        bdNavCount(this, 'flips', c.flips || 0);
        bdNavCount(this, 'trades', c.trades || 0, Boolean((T.ready || []).length));
        // Items holds both tabs: My items, and To sell after a dot when there is something to sell.
        bdNavCount(this, 'items', c.sell ? count(c.mine || 0) + ' · ' + count(c.sell) : c.mine || 0);
        bdTabs(this, this.tabsOf(this.bd.page));

        const info = s.info || {};
        const now = Date.now();
        const st = info.shared || null;
        const line = sharedKnown(st) ? sharedNowLine(st, now) : null;
        const word = !line ? '' : line.level === 'ok' ? (st.people ? st.people + (st.people === 1 ? ' person' : ' people') : 'connected')
            : line.level === 'bad' ? 'update Torn Bids'
                : line.level === 'idle' ? 'connecting' : 'working alone';
        const sig = JSON.stringify([line && line.level, word, info.beside || null]);
        if (sig === this.sharedSig) return;
        this.sharedSig = sig;
        const box = this.bd.sharedEl;
        box.textContent = '';
        box.hidden = !line && !info.beside;
        if (box.hidden) return;
        box.title = [line ? 'Shared: ' + line.text : '', info.beside || ''].filter(Boolean).join('\n');
        box.append(
            spEl('i', { class: 'dot' + (line && line.level === 'ok' && !info.beside ? '' : line && line.level === 'bad' ? ' bad' : ' warn') }),
            spEl('span', { class: 'lab' }, [
                line ? spEl('span', {}, [spEl('b', { text: 'Shared' }), ' · ' + word]) : null,
                line && info.beside ? spEl('br') : null,
                info.beside ? spEl('span', { text: 'Torn Archive is in front: fewer reads here' }) : null,
            ]),
        );
    }

    /** The line along the bottom: what just happened, and how far the reading is. */
    renderTape() {
        const s = this.state;
        const info = s.info || {};
        const now = Date.now();
        const said = [];
        if (s.stillEnded) said.push(['', s.stillEnded]);
        const d = s.desk;
        if (d && d.friend && d.friend.going) said.push([d.name, d.friend.going.lead + ' · ' + d.friend.going.rest]);
        // The item on show has said it: once.
        const shown = d && d.friend && d.friend.going ? String(d.itemId) : null;
        for (const r of s.list || []) if (r.mark && r.mark.kind === 'friend' && String(r.itemId) !== shown) said.push([r.name, r.mark.text]);
        const HOW = { traded: 'traded', cancel: 'cancelled', old: 'no trade in a day' };
        for (const e of ((s.trades && s.trades.ended) || []).slice(0, 4)) {
            said.push([e.name, (HOW[e.how] || 'ended') + (e.how === 'traded' && e.profit ? ' ' + signed(e.profit) : '') + (e.moved && e.moved.length ? ' · ' + e.moved.map((m) => count(m.qty) + ' ' + m.name).join(', ') + ' went to To sell' : '') + ' · ' + formatAge(now - e.at)]);
        }
        const st = info.shared || null;
        if (sharedKnown(st)) said.push(['Shared', sharedNowLine(st, now).text]);
        if (!said.length) said.push(['', info.bazaarsAt ? 'Nothing new. Prices are read as they change.' : 'Loading bazaar prices…']);
        // Mockup AM: what is happening now on the left, what happened just before on the right. How far the
        // reading is moved to the Prices pill's hover (renderPills).
        const sig = JSON.stringify([said, Boolean(info.bazaarsAt)]);
        if (sig === this.tapeSig) return;
        this.tapeSig = sig;
        const bd = this.bd;
        const [first, ...rest] = said;
        bd.tapeDot.className = 'dot' + (info.bazaarsAt ? '' : ' warn');
        bd.tapeEl.textContent = '';
        bd.tapeEl.appendChild(spEl('span', { class: 'tk now' }, [first[0] ? spEl('b', { text: first[0] }) : null, first[0] ? ' ' : null, first[1]]));
        bd.tapeRight.textContent = '';
        const tks = rest.map(([lead, text]) => spEl('span', { class: 'tk' }, [lead ? spEl('b', { text: lead }) : null, lead ? ' ' : null, text]));
        for (const tk of tks) bd.tapeRight.appendChild(tk);
        bd.tapeRight.hidden = !rest.length;
        // What does not fit whole is never cut: the last ones go into "+ N more", their words in its hover.
        const fit = () => {
            const box = bd.tapeRight;
            if (!box.isConnected || box.hidden) return;
            const out = [];
            let more = null;
            while (tks.length > out.length && box.scrollWidth > box.clientWidth + 1) {
                const tk = tks[tks.length - 1 - out.length];
                out.unshift(rest[tks.length - 1 - out.length]);
                tk.remove();
                if (!more) more = box.appendChild(spEl('span', { class: 'tk more', tabindex: '0' }));
                more.textContent = '+ ' + count(out.length) + ' more';
                more.title = out.map(([lead, text]) => (lead ? lead + ' ' : '') + text).join('\n');
            }
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit);
        else fit();
    }

    /* ------------------------------------------------------- small pieces */

    /** A picture, kept per place so a re-render never reloads it. */
    image(place, itemId, size = 'small') {
        const key = place + ':' + itemId;
        let img = this.images.get(key);
        if (!img) {
            img = spEl('img', { alt: '', loading: 'lazy', src: itemImageUrl(itemId, size) });
            img.addEventListener('error', () => {
                img.style.visibility = 'hidden';
            });
            this.images.set(key, img);
        }
        return img;
    }

    /** Torn's picture of an item in its frame: small in a row, 'lg' or 'xl' where it leads. */
    pic(place, itemId, size = '') {
        return spEl('span', { class: 'it' + (size ? ' ' + size : '') }, [this.image(place + size, itemId, size === 'xl' ? 'large' : size === 'lg' ? 'medium' : 'small')]);
    }

    /** A trader's status as one dot (green online, amber busy or idle, grey offline). Nothing when not known yet. */
    dot(b) {
        const st = b && b.id && this.state.statuses ? this.state.statuses.get(String(b.id)) : null;
        if (!st) return null;
        return spEl('i', { class: 'dot' + (st.level === 'online' ? '' : st.level === 'offline' ? ' off' : ' warn'), title: (b.name ? b.name + ': ' : '') + (st.title || st.text), 'aria-label': st.title || st.text });
    }

    /** What the status dot of a trader shows, for a signature. */
    dotSig(b) {
        const st = b && b.id && this.state.statuses ? this.state.statuses.get(String(b.id)) : null;
        return st ? st.level + st.text : '';
    }

    /** A bar beside a number: how big it is next to the others. */
    bar(value, max, cls = '') {
        const w = max > 0 ? Math.max(2, Math.min(100, Math.round((value / max) * 100))) : 2;
        return spEl('span', { class: 'bar' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, [spVars(spEl('i'), { '--w': w + '%' })]);
    }

    /** A table row you can press; Enter and Space press it too. A button or a link inside it keeps its own press. */
    pickRow(cls, focus, onPick, cells, title = '') {
        const tr = spEl('tr', { class: 'pick' + (cls ? ' ' + cls : ''), tabindex: '0', role: 'button', 'data-focus': focus, title: title || null }, cells);
        tr.addEventListener('click', (event) => {
            const t = event.target;
            if (t && t.closest && t.closest('a, button, input, select') && t.closest('a, button, input, select') !== tr) return;
            onPick();
        });
        tr.addEventListener('keydown', (event) => {
            if (event.target !== tr || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            onPick();
        });
        return tr;
    }

    /** A small button in words (Undo, Show them, Keep). It never presses the row it sits in. */
    wordBtn(text, focus, title, onPress, cls = 'quiet u') {
        return spEl('button', { type: 'button', class: cls, 'data-focus': focus, title: title || null, text, onclick: (event) => {
            event.stopPropagation();
            onPress();
        } });
    }

    /** An item's name, opening the Item Market at it. */
    itemLink(itemId, name, focus) {
        return this.link(name, itemMarketUrl(itemId, name), { cls: 'tiname', title: 'Opens the Item Market at this item', focus });
    }

    /** Shared: "<Torn name> is going for this · opened 3m ago" / "<Torn name> bought 2 at <bazaar> · 1m ago · your plan is now 3". */
    friendEl(line, sep = ' · ', more = '') {
        if (!line) return null;
        return spEl('span', { class: 'frl', title: 'A mark, not a lock: you can still take it' + (more ? ' · ' + more : '') }, [spEl('b', { text: line.lead }), sep + line.rest]);
    }

    select(itemId) {
        if (this.h.onSelect) this.h.onSelect(itemId);
    }

    /* ------------------------------------------------------------- lists */

    /** The list of the page in view: flips, every item, what you hold, what you bought to resell, or the traders. */
    renderList() {
        if (!this.listPanel.isConnected) return;
        const page = this.pg();
        if (this.onTraders()) this.renderTraderList();
        else if (page === 'sell') this.renderSellList();
        else if (page === 'mine') this.renderItemList('mine');
        else if (page === 'flips') this.renderItemList(this.bd.tab === BD_FLIPS_ITEMS ? 'all' : 'flips');
    }

    /** The table's head and rows put in, the focus kept on the same row's new copy. */
    listDraw(heads, rows, empty, sort = null, onSort = null) {
        const key = this.focusKeyIn(this.listBox);
        this.listHead.textContent = '';
        // A head with a sort key is a button (3.33.0): pressed, the list sorts by it; again, the other way.
        const button = (h) => {
            const on = Boolean(sort && sort.key === h.sort);
            return spEl('button', { type: 'button', class: 'thsort' + (on ? ' on' : ''), title: h.title || null, 'data-focus': 'sort:' + h.sort, onclick: () => onSort(h.sort), text: h.text + (on ? (sort.dir === 1 ? ' ↑' : ' ↓') : '') });
        };
        const head = (h) => {
            if (!h.sort || !onSort) return spEl('th', { class: h.n ? 'n' : '', title: h.title || null, text: h.text });
            const on = [h, h.also].find((x) => x && sort && sort.key === x.sort);
            return spEl('th', { class: h.n ? 'n' : '', 'aria-sort': on ? (sort.dir === 1 ? 'ascending' : 'descending') : null }, [button(h), h.also ? ' · ' : null, h.also ? button(h.also) : null]);
        };
        this.listHead.appendChild(spEl('tr', {}, heads.map(head)));
        this.listBody.textContent = '';
        for (const r of rows) this.listBody.appendChild(r);
        this.listHead.hidden = !rows.length || !heads.length;
        this.listEmpty.hidden = rows.length > 0;
        this.listEmpty.textContent = rows.length ? '' : empty;
        this.focusBack(this.listBox, key);
    }

    /**
     * All items and My items: one row an item (Best flips: drawFlipRows, a row a trade).
     *   all    Item (its flip, if any)                | You hold | Item Market | Bazaar | Best trader | Second trader
     *   mine   Item (bought to resell: what you paid) | the same | For all of it
     * (3.33.0: every column of all and mine sorts; Item also by the cheapest place to buy.)
     * A pinned trade is listed once, on top (the owner: "it created something doubled, instead of just pinning it").
     */
    renderItemList(kind) {
        const s = this.state;
        const info = s.info || {};
        // The rows are still the last page's: the script draws again in a moment.
        if (s.filter !== kind) return;
        const pinnedItems = new Set((s.pinned || []).map((p) => p.itemId));
        const list = this.stableOrder(s.list).filter((r) => !pinnedItems.has(r.itemId));
        const paidOf = new Map(kind === 'mine' ? ((s.toSell && s.toSell.rows) || []).map((r) => [String(r.itemId), r]) : []);
        const now = Date.now();
        const sig = JSON.stringify([
            'items', kind, s.counts, s.listTotal, s.desk && s.desk.itemId, info.hasKey, info.loading, info.inventoryAt ? 1 : 0, info.tradersLoading, Boolean(info.bazaarsAt), this.query, s.category, Boolean(s.still),
            list.map((r) => [r.itemId, r.name, r.held, r.lowest, r.badge && [r.badge.kind, r.badge.amount], r.pending, r.units, r.stops, r.pace, r.bid, r.mark && r.mark.text, r.still && [r.still.move, r.still.gone, r.still.was], r.group,
                r.to && [r.to.name, this.dotSig(r.to), r.to.old ? listAgeText(now - r.to.old.at) : '', Boolean(r.to.teOnly)], r.top && [r.top.name, r.top.price, this.dotSig(r.top), r.top.checked], r.second && [r.second.name, r.second.price, this.dotSig(r.second), r.second.checked], r.market && [r.market.price, r.market.about], paidOf.has(r.itemId) ? paidOf.get(r.itemId).each : 0]),
            s.pinned || [], (s.prefs.listSort || {})[kind] || null,
        ]);
        if (sig === this.listSig) return;
        this.listSig = sig;
        if (kind === 'flips') {
            this.drawFlipRows(list);
            return;
        }

        // 3.33.0 - My items and All items: where it is bought (the Item Market, the bazaars) beside the two best
        // traders, each column sortable; "Cheapest" sorts by the lower of the two places to buy.
        const shared = [{ text: 'You hold', n: true, sort: 'held' }, { text: 'Item Market', n: true, sort: 'market' }, { text: 'Bazaar', n: true, sort: 'bazaar' }, { text: 'Best trader', n: true, sort: 'price' }, { text: 'Second trader', n: true, sort: 'next' }];
        const heads = kind === 'all'
            ? [{ text: 'Item', sort: 'name' }, ...shared]
            : [{ text: 'Item', sort: 'name' }, ...shared, { text: 'For all of it', n: true, sort: 'worth' }];
        // While a trade holds the list still its order is the hold's: no sort is offered then.
        const sortable = !s.still;
        const sort = sortable ? ((s.prefs.listSort || {})[kind] || null) : null;
        heads[0].also = { text: 'Cheapest', sort: 'cheap', title: 'Sort by the cheaper of the Item Market and the bazaars' };
        const rows = [];
        // Pinned trades first, whatever the list: the main flip, the trader, the profit now.
        for (const pt of s.pinned || []) {
            const unpin = spEl('button', { type: 'button', class: 'rowpin on', 'aria-pressed': 'true', 'data-focus': 'unpin:' + pt.key, 'aria-label': 'Unpin the trade with ' + pt.trader, title: 'Pinned: press to unpin', onclick: (event) => {
                event.stopPropagation();
                if (this.h.onUnpin) this.h.onUnpin(pt.key);
            } }, [pinIcon()]);
            rows.push(this.pickRow('pinrow' + (pt.on ? ' sel' : ''), 'pin:' + pt.key, () => this.h.onPinnedOpen && this.h.onPinnedOpen(pt.key), [
                spEl('td', { colspan: String(heads.length - 1) }, [spEl('div', { class: 'cell' }, [this.pic('pin', pt.itemId), spEl('div', {}, [
                    spEl('b', { text: pt.name }),
                    spEl('small', { text: pt.trader + (pt.mainId !== pt.itemId ? ' · main ' + pt.mainName : '') + ' · ' + count(pt.items) + (pt.items === 1 ? ' item' : ' items') + ' · ' + count(pt.stops) + (pt.stops === 1 ? ' bazaar' : ' bazaars') }),
                ])])]),
                spEl('td', { class: 'n' }, [spEl('b', { class: pt.profit < 0 ? 't-bad' : 't-good', text: signed(pt.profit) }), unpin]),
            ], 'Your pinned trade: only prices and profit move'));
        }
        const max = Math.max(1, ...list.map((r) => (r.held || 0) * (r.bid || 0)));
        // 3.29.0: a price TornW3B has not confirmed in the last 5 minutes is shown muted (it is a figure to read:
        // pick the item, and their list is read at once).
        const unsure = 'Not checked: TornW3B has not confirmed this price in the last 5 minutes. Pick the item and their list is read now.';
        for (const r of list) {
            const on = Boolean(s.desk && s.desk.itemId === r.itemId);
            const flip = Boolean(r.badge && r.badge.kind === 'flip');
            const friend = Boolean(r.mark && r.mark.kind === 'friend');
            // A trade is under way and this row is no flip any more (3.25.0): it keeps its place, greyed.
            const gone = Boolean(r.still && r.still.gone);
            const tags = [
                r.mark ? spEl('span', { class: 'tag', title: friend ? 'A mark, not a lock: you can still take it' : 'Your friends see that you are going for this', text: r.mark.text }) : null,
                gone ? spEl('span', { class: 'tag', title: 'It was a flip when the list was held. It keeps its place until your trade ends.', text: 'No flip now' }) : null,
            ];
            let sub;
            if (kind === 'all') sub = flip ? null : r.badge && r.badge.kind === 'list' ? 'your bazaar pays ' + signed(r.badge.amount) + ' more than a trader' : r.pending ? 'Checking…' : 'no flip now';
            else {
                const paid = paidOf.get(r.itemId);
                sub = paid ? 'bought to resell · you paid ' + formatMoney(paid.each) : r.badge && r.badge.kind === 'list' ? 'your bazaar pays ' + signed(r.badge.amount) + ' more than a trader' : '';
            }
            const first = spEl('td', {}, [spEl('div', { class: 'cell' }, [this.pic('list', r.itemId), spEl('div', {}, [
                spEl('b', { text: r.name }),
                ...tags,
                kind === 'all' && flip ? spEl('small', { class: 't-good', text: 'flip ' + signed(r.badge.amount) }) : sub ? spEl('small', { text: sub }) : null,
            ])])]);
            const cells = [first];
            const dash = (text = '–') => spEl('span', { class: 't-muted', text });
            // A trader's column: what they pay, their name under it.
            const pays = (b) => (b ? [b.checked === false ? spEl('span', { class: 't-muted', title: unsure, text: formatMoney(b.price) }) : spEl('b', { text: formatMoney(b.price) }), spEl('small', {}, [this.dot(b), b.name])] : [dash(r.pending ? 'Checking…' : '–')]);
            const m = r.market;
            cells.push(spEl('td', { class: 'n' }, [r.held ? count(r.held) : dash()]));
            cells.push(spEl('td', { class: 'n' }, [m ? (m.about ? spEl('span', { class: 't-muted', title: 'Torn\'s market value. Pick the item to read the Item Market.', text: '≈ ' + formatMoney(m.price) }) : formatMoney(m.price)) : dash()]));
            cells.push(spEl('td', { class: 'n' }, [r.lowest ? formatMoney(r.lowest) : dash()]));
            cells.push(spEl('td', { class: 'n' }, pays(r.top)));
            cells.push(spEl('td', { class: 'n' }, r.second ? pays(r.second) : [dash()]));
            if (kind === 'mine') {
                const worth = (r.held || 0) * (r.bid || 0);
                const about = Boolean(r.top && r.top.checked === false);
                cells.push(spEl('td', { class: 'n' }, worth > 0 ? [this.bar(worth, max), spEl('b', { class: 'amt', title: about ? 'About: at a price that is not checked' : null, text: (about ? '≈ ' : '') + formatMoney(worth) })] : [spEl('span', { class: 't-muted', text: '–' })]));
            }
            rows.push(this.pickRow((on ? 'sel' : '') + (gone ? ' gone' : ''), 'item:' + r.itemId, () => this.select(r.itemId), cells));
        }
        let empty = 'Loading…';
        const q = this.query.trim();
        if (q) empty = 'No item matches "' + q + '"' + (s.category ? ' in ' + s.category : '') + '.';
        else if (s.category && !(s.counts && s.counts[s.filter])) empty = 'Nothing in ' + s.category + (kind === 'mine' ? ' that you hold' : '') + '.';
        else if (kind === 'mine' && !info.hasKey) empty = 'Add your Limited key to see your items.';
        else if (kind === 'mine' && info.loading) empty = 'Loading your inventory…';
        else if (kind === 'mine' && info.inventoryAt) empty = 'Your inventory has nothing to sell.';
        else if (!info.tradersLoading && !info.traderCount && !info.hasKey) empty = 'No traders loaded yet.';
        const onSort = !sortable ? null : (key) => {
            // A third press on the same column: back to the usual order (money to be made first).
            const next = sort && sort.key === key && sort.dir !== SORT_FIRST_DIR[key] ? null : nextSort(sort, key);
            if (this.h.onPrefsChange) this.h.onPrefsChange({ listSort: { ...(s.prefs.listSort || {}), [kind]: next } });
        };
        this.listDraw(heads, rows, empty, sort, onSort);
        this.moreBtn.hidden = !(s.listTotal > s.list.length);
    }

    /**
     * Best flips (mockup AM): one row a trade - the trader, what the trade makes, its main item and how many
     * more, and how the money splits. Flips that sell to one trader are one trade with them (3.30.0), so they
     * are one row; pressed, it opens the trade on its biggest flip, and the pane lists every item of it.
     * Pinned trades come first. A row that was a flip when a trade held the list still keeps its place, greyed.
     */
    drawFlipRows(list) {
        const s = this.state;
        const now = Date.now();
        const rows = [];
        const row = (cls, focus, onPick, a, p, sub, sub2, title) => this.pickRow('lr' + (cls ? ' ' + cls : ''), focus, onPick, [
            spEl('td', {}, [spEl('div', { class: 'lrow' }, [spEl('div', { class: 'a' }, a), spEl('div', { class: 'p' }, p), spEl('div', { class: 's' }, sub), spEl('div', { class: 's2' }, sub2)])]),
        ], title);
        const tags = (to, r) => [
            to && to.teOnly ? this.link('TE only', tePriceListUrl(to.teName || to.name), { cls: 'tag w te-pulse', title: to.name + '\'s price is only on TornExchange, which cannot say whether their list is open: press to look at their list before you trade', focus: 'te-only:' + to.name }) : null,
            r && r.mark ? spEl('span', { class: 'tag b', title: r.mark.kind === 'friend' ? 'A mark, not a lock: you can still take it' : 'Your friends see that you are going for this', text: r.mark.text }) : null,
            to && to.old ? spEl('span', { class: 'tag w', title: 'Their TornW3B price list was last changed then: check it before you buy', text: 'list changed ' + listAgeText(now - to.old.at) }) : null,
        ];
        // Pinned trades first, whatever the list: the trader, the main flip, the profit now.
        for (const pt of s.pinned || []) {
            const unpin = spEl('button', { type: 'button', class: 'rowpin on', 'aria-pressed': 'true', 'data-focus': 'unpin:' + pt.key, 'aria-label': 'Unpin the trade with ' + pt.trader, title: 'Pinned: press to unpin', onclick: (event) => {
                event.stopPropagation();
                if (this.h.onUnpin) this.h.onUnpin(pt.key);
            } }, [pinIcon()]);
            rows.push(row('pinrow' + (pt.on ? ' sel' : ''), 'pin:' + pt.key, () => this.h.onPinnedOpen && this.h.onPinnedOpen(pt.key),
                [spEl('b', { text: pt.trader }), spEl('span', { class: 'tag b', text: 'pinned' })],
                [spEl('b', { class: pt.profit < 0 ? 't-bad' : 't-good', text: signed(pt.profit) }), unpin],
                [pt.name + (pt.mainId !== pt.itemId ? ' · main ' + pt.mainName : '')],
                [this.plural(pt.items, 'item') + ' · ' + this.plural(pt.stops, 'bazaar')],
                'Your pinned trade: only prices and profit move'));
        }
        const pinnedIds = new Set((s.pinned || []).map((p) => p.itemId));
        const deskId = s.desk && s.desk.itemId;
        for (let i = 0; i < list.length;) {
            let j = i + 1;
            while (list[i].group && j < list.length && list[j].group === list[i].group) j += 1;
            const run = list.slice(i, j);
            i = j;
            const live = run.filter((r) => r.badge && r.badge.kind === 'flip' && !(r.still && r.still.gone));
            const lead = live[0] || run[0];
            const to = (run.find((r) => r.to) || {}).to || null;
            const goneRows = run.filter((r) => r.still && r.still.gone);
            const gone = !live.length && goneRows.length > 0;
            const goneWas = goneRows.reduce((a, r) => a + (Number(r.still.was) || 0), 0);
            const total = live.reduce((a, r) => a + r.badge.amount, 0);
            const units = live.reduce((a, r) => a + (r.units || 0), 0);
            const stops = live.reduce((a, r) => a + (r.stops || 0), 0);
            const on = run.some((r) => r.itemId === deskId);
            const one = run.length === 1;
            const paced = one && live.length && lead.units && typeof lead.pace === 'number';
            // Every trade has its pin (one item or many): it pins the trade on its main item.
            const pin = live.length ? (() => {
                const pinned = pinnedIds.has(lead.itemId);
                // The pin (the owner: "put it here as well"): pressing it changes only its colour - the row stays where it is.
                return spEl('button', { type: 'button', class: 'rowpin' + (pinned ? ' on' : ''), 'aria-pressed': String(pinned), 'data-focus': 'rowpin:' + lead.itemId, 'aria-label': (pinned ? 'Unpin ' : 'Pin ') + lead.name + '\'s trade', title: pinned ? 'Pinned on top of the list: press to unpin' : 'Pin this trade: it stays on top of the list, only prices move', onclick: (event) => {
                    event.stopPropagation();
                    if (this.h.onPin) this.h.onPin(lead.itemId);
                } }, [pinIcon()]);
            })() : null;
            const a = [this.dot(to), spEl('b', { text: to ? to.name : lead.name }), ...tags(to, run.find((r) => r.mark)), gone ? spEl('span', { class: 'tag', title: 'It was a flip when the list was held. It keeps its place until your trade ends.', text: 'No flip now' }) : null];
            const p = gone
                ? [spEl('b', { class: 't-muted', text: signed(goneWas) })]
                : live.length ? [spEl('b', { class: 't-good', title: one ? null : 'What these flips make together. The trade with ' + (to ? to.name : 'them') + ' may take more of their items: it is in the pane once you open it.', text: signed(total) }), this.stillMark(lead.still), pin] : [];
            const sub = [lead.name + (lead.units ? ' × ' + count(lead.units) : ''), live.length > 1 ? spEl('span', { class: 't-muted', text: ' + ' + count(live.length - 1) + ' more' }) : null,
                live.length && goneRows.length ? spEl('span', { class: 't-muted', title: 'They were flips when the list was held: they keep their place in the trade until it ends', text: ' · ' + count(goneRows.length) + ' no flip now' }) : null];
            // 3.28.0: the amount is what moves in about an hour, where that is less than there is to buy - said, so "× 3" is no riddle.
            const sub2 = gone ? ['held in its place']
                : one && live.length ? [count(lead.stops) + (lead.stops === 1 ? ' bazaar' : ' bazaars') + (lead.buy && lead.sell ? ' · buy ' + formatMoney(lead.buy) + ' · sell ' + formatMoney(lead.sell) : '') + (paced ? ' · ' + (lead.pace >= 1 ? 'about ' + count(Math.round(lead.pace)) + ' an hour sell' : 'under one an hour sells') : '')]
                    : live.length ? [this.plural(live.length, 'flip') + ' · ' + this.plural(units, 'item') + ' · ' + this.plural(stops, 'bazaar')] : [];
            // 2026-10-17: a row is its trader's trade - pressed, the trade with them opens (it opened the item's best
            // trader, which could be another one, or the item alone).
            const open = to && to.key && live.length ? () => (this.h.onTradePick ? this.h.onTradePick(lead.itemId, to.key) : this.select(lead.itemId)) : () => this.select(lead.itemId);
            rows.push(row((on ? 'sel' : '') + (gone ? ' gone' : ''), one ? 'item:' + lead.itemId : 'group:' + lead.group, open, a, p, sub, sub2,
                to ? 'Open the trade with ' + to.name : ''));
        }
        const q = this.query.trim();
        const empty = q ? 'No item matches "' + q + '"' + (s.category ? ' in ' + s.category : '') + '.'
            : s.category && !(s.counts && s.counts[s.filter]) ? 'Nothing in ' + s.category + ' to flip right now.'
                : this.noFlipsText();
        this.listDraw([], rows, empty);
        this.listHead.hidden = true;
        this.moreBtn.hidden = !(s.listTotal > s.list.length);
    }

    /**
     * Flips › By trader (Your traders, 3.14.3): one row per favourite and Trusted trader - the best whole
     * trade with each now, the biggest first. A favourite a filter leaves out stays in view, greyed, saying why.
     */
    renderTraderList() {
        const s = this.state;
        const sc = s.scan || { list: [], favourites: 0, trusted: 0 };
        const q = (this.traderQuery || '').trim().toLowerCase();
        const list = (sc.list || []).filter((x) => (!q || String(x.name).toLowerCase().includes(q)) && (!this.favOnly || x.favourite));
        const key = this.tradeKeyOnShow();
        const now = Date.now();
        const sig = JSON.stringify(['traders', q, this.favOnly, key, sc.favourites, sc.trusted, sc.open,
            list.map((x) => [x.id, x.name, x.profit, x.items, x.stops, x.reading, x.lastPaid, x.mainId, x.mainUnits, x.every, x.favourite, x.waiting, x.hiddenBy, this.dotSig(x), x.traded, x.offline, x.notOpen,
                x.basket && x.basket.lines.map((l) => [l.itemId, l.units, l.cost, l.bid, l.profit, l.second && [l.second.name, l.second.price]]), x.trust && x.trust.level + x.trust.score, x.estimated, x.same && [x.same.n, x.same.of, x.same.own, x.same.with], x.listOld ? x.listOld.level + listAgeText(now - x.listOld.at) : ''])]);
        if (sig === this.listSig) return;
        this.listSig = sig;
        const rows = list.map((x) => {
            const ready = this.traderReady(x);
            const about = x.lastPaid || x.estimated;
            let sub;
            if (x.hiddenBy) sub = (x.hiddenBy === 'offline' ? 'offline: not counted while Online is ticked' : x.hiddenBy === 'stale' ? 'old price list: not counted while Fresh prices is ticked' : 'not counted while Trusted is ticked');
            else if (ready) sub = count(x.items) + (x.items === 1 ? ' item' : ' items') + ' · ' + count(x.stops) + (x.stops === 1 ? ' bazaar' : ' bazaars') + (x.basket ? ' · pay ' + formatMoney(x.basket.cost) + ', back ' + formatMoney(x.basket.back) : '') + (x.every ? ' · everything they buy' : '') + (x.offline ? ' · offline' : x.notOpen ? ' · list not seen open' : '');
            else sub = x.waiting ? 'Checking if they are online…' : x.reading ? 'Reading their list…' : 'No trade now: nothing in bazaars under their prices';
            // Mockup AM: a row a trader - who, what the trade makes, what it holds; what it shares with a bigger trade under it.
            const cells = [
                spEl('td', {}, [spEl('div', { class: 'lrow' }, [
                    spEl('div', { class: 'a' }, [this.dot(x), x.favourite ? spEl('span', { class: 'star', title: 'A favourite', text: '★' }) : null, spEl('b', { text: x.name }),
                        x.lastPaid ? spEl('span', { class: 'tag w', title: 'No public list: the prices they accepted from you last time. Check before buying.', text: 'Last paid' }) : null]),
                    spEl('div', { class: 'p' }, ready
                        ? [spEl('b', { class: 't-good', title: x.lastPaid ? 'About: from what they paid you last time' : x.estimated ? 'About: some bazaars are still being read' : null, text: (about ? '≈ ' : '') + signed(x.profit) })]
                        : [spEl('span', { class: 't-muted', text: '–' })]),
                    spEl('div', { class: 's' }, [sub + (x.traded ? ' · ' + x.traded : '')]),
                    spEl('div', { class: 's2' }, [
                        // 3.30.0: each trade is planned alone - what this one shares with a bigger one above can be bought once.
                        ready && x.same && x.same.with ? spEl('span', { title: 'The trade with each trader is planned alone, from the same bazaar listings. What two trades both have is one or the other.', text: sameGoodsWords(x.same.n, x.same.of) + ' the trade with ' + x.same.with + (x.same.n < x.same.of && x.same.own > 0 ? ' · the rest makes ' + signed(x.same.own) : '') }) : null,
                        ready && x.listOld ? this.oldListEl(x.listOld) : null,
                    ]),
                ])]),
            ];
            if (!ready) return spEl('tr', { class: 'lr dim', title: x.hiddenBy ? 'A favourite stays in view. Their trade is not counted while the filter is on.' : null }, cells);
            const pick = () => this.h.onTradePick && this.h.onTradePick(x.mainId, x.key);
            // 2026-10-17 (the owner: "i dont need to see the items here in per trader. just the trader"): one row a
            // trader; the trade's lines are in the desk once picked.
            return this.pickRow('lr' + (key === x.key ? ' sel' : ''), 'scan:' + x.id, pick, cells, 'Show the trade with ' + x.name);
        });
        const total = (sc.favourites || 0) + (sc.trusted || 0);
        const empty = q || this.favOnly
            ? (this.favOnly && !sc.favourites ? 'No favourites yet. Press ☆ beside a trader to keep them here; traders you traded with 5 or more times in 30 days join by themselves.' : 'No trader matches.')
            : !sc.open || (total && !(sc.list || []).length) ? 'Working out the best trade with each…'
                : 'No favourites or trusted traders yet. Press ☆ beside a trader to keep them here; traders you traded with 5 or more times in 30 days join by themselves.';
        this.listDraw([], rows, empty);
        this.listHead.hidden = true;
        this.moreBtn.hidden = true;
    }

    /** Why a To sell item is in the list, in a word or two. */
    whyText(why) {
        return why === 'cancel' ? 'Cancelled trade' : TO_SELL_WHY[why] || TO_SELL_WHY.left;
    }

    /**
     * To sell (3.21.0): what you bought to resell and still hold, under the trader who pays most for it now -
     * one trade for everything of yours they take. Then what nobody pays more for yet (never a trader who
     * pays less than you paid, 3.22.0), then what you marked Not for sale (3.23.0).
     */
    renderSellList() {
        const s = this.state;
        if (s.filter !== 'sell') return;
        const T = s.toSell || { rows: [], groups: [], unchecked: [], waiting: [], kept: [] };
        const rowSig = (r) => [r.itemId, r.name, r.qty, r.each, r.why, r.best && [r.best.name, r.best.price, r.best.te, r.best.w3b], r.gain, r.short, r.bazaar, r.kept, r.ready, r.unchecked, r.check];
        const sig = JSON.stringify(['sell', s.desk && s.desk.itemId, s.prefs.onlineOnly, s.prefs.trustedOnly,
            (T.groups || []).map((g) => [g.key, g.trader.name, this.dotSig(g.trader), g.gain, g.rows.map(rowSig)]), (T.unchecked || []).map(rowSig), (T.waiting || []).map(rowSig), (T.kept || []).map(rowSig)]);
        if (sig === this.listSig) return;
        this.listSig = sig;
        const heads = [{ text: 'Item' }, { text: 'Why it is here' }, { text: 'You paid', n: true }, { text: 'Best trader', n: true }, { text: 'Profit', n: true }, { text: '' }];
        const rows = [];
        const max = Math.max(1, ...(T.groups || []).flatMap((g) => g.rows.map((r) => r.gain || 0)));
        // "Not for sale" on a row (3.23.0), and the way back: the row is kept out of every trade, not removed.
        const keep = (r) => this.wordBtn(r.kept ? 'For sale again' : 'Keep', 'board:keep:' + r.itemId,
            r.kept ? 'Put ' + r.name + ' back: traders who pay more than you paid are named again, and it goes into their trades'
                : 'Not for sale: ' + r.name + ' stays in this list, in no trade and off your bazaar\'s Fill all, until you put it back',
            () => this.h.onNotForSale && this.h.onNotForSale(r.itemId, !r.kept));
        const row = (r, best, profit) => this.pickRow(s.desk && s.desk.itemId === r.itemId ? 'sel' : '', 'sell:' + r.itemId, () => this.select(r.itemId), [
            spEl('td', {}, [spEl('div', { class: 'cell' }, [this.pic('sell', r.itemId), spEl('span', {}, [this.itemLink(r.itemId, r.name, 'sell:name:' + r.itemId), ' × ' + count(r.qty)])])]),
            spEl('td', { text: this.whyText(r.why) }),
            spEl('td', { class: 'n', text: formatMoney(r.each) }),
            spEl('td', { class: 'n' }, best),
            spEl('td', { class: 'n' }, profit),
            spEl('td', { class: 'n act' }, [keep(r)]),
        ], 'Show where to sell it');
        for (const g of T.groups || []) {
            const b = g.trader;
            rows.push(spEl('tr', { class: 'g' }, [
                // (3.29.0: their price lists beside the name - the price is checked, and one press shows it to you.)
                spEl('td', { colspan: '4' }, [this.dot(b), spEl('b', {}, [this.playerName(b.name, b.id, 'board:who:' + g.key)]), ' pays more than you paid · ' + count(g.rows.length) + (g.rows.length === 1 ? ' item' : ' items') + ' · ', spEl('span', { class: 't-good', text: signed(g.gain) }), ' ', ...this.traderLinks(b)]),
                spEl('td', { class: 'n', colspan: '2' }, [spEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'board:plan:' + g.key, title: 'One trade for everything of yours ' + b.name + ' takes: these go in as yours', text: 'Trade ' + (g.rows.length === 1 ? 'it' : 'these') + ' to ' + b.name, onclick: () => this.h.onTradePick && this.h.onTradePick(g.rows[0].itemId, g.key) })]),
            ]));
            for (const r of g.rows) rows.push(row(r, [spEl('b', { text: formatMoney(r.best.price) })], [this.bar(r.gain, max), spEl('b', { class: 't-good', text: signed(r.gain) })]));
        }
        // 3.29.0 - a trader's list says they pay more than you paid, and that price is not checked: named, muted,
        // with their lists to look at - in no total, and no "Trade these" until TornW3B has confirmed it.
        if ((T.unchecked || []).length) {
            const n = T.unchecked.length;
            const never = T.unchecked.every((r) => r.check === 'closed' || r.check === 'no-id');
            rows.push(spEl('tr', { class: 'g' }, [spEl('td', { colspan: '6' }, [spEl('b', { text: 'Waiting for a price check' }), ' · ' + count(n) + (n === 1 ? ' item' : ' items') + ' · '
                + (never ? 'their TornW3B list is closed or cannot be read' : 'a trader\'s list says more than you paid; shown as a trade once their list is seen open')])]));
            for (const r of T.unchecked) {
                const b = r.best;
                const why = this.uncheckedWhy(r.check);
                rows.push(row(r,
                    [spEl('span', { class: 't-muted', title: b.name + '\'s price is not checked: ' + why }, [b.name + ' ' + formatMoney(b.price)]), ' ', ...this.traderLinks(b)],
                    [spEl('span', { class: 't-muted', title: 'What it would make at that price. Not counted until the price is checked.', text: 'not checked' })]));
            }
        }
        if ((T.waiting || []).length) {
            rows.push(spEl('tr', { class: 'g' }, [spEl('td', { colspan: '6' }, [spEl('b', { text: 'Nobody pays more yet' }), ' · ' + count(T.waiting.length) + (T.waiting.length === 1 ? ' item waits' : ' items wait') + ' for a trader who pays more than you paid'])]));
            for (const r of T.waiting) {
                // One over what you paid but under your least profit, your own bazaar, or nothing yet.
                const best = r.best
                    ? [spEl('span', { class: 't-muted', title: 'Over what you paid, but under your least profit per item' }, [r.best.name + ' ' + formatMoney(r.best.price)])]
                    : r.bazaar ? [spEl('span', { class: 't-muted', title: '$1 under the cheapest bazaar', text: 'your bazaar ' + formatMoney(r.bazaar.price) })] : [spEl('span', { class: 't-muted', text: '–' })];
                rows.push(row(r, best, [r.bazaar && !r.best ? spEl('span', { class: 't-muted', text: 'bazaar ' + signed(r.bazaar.gain) }) : spEl('span', { class: 't-muted', text: 'waiting' })]));
            }
        }
        if ((T.kept || []).length) {
            rows.push(spEl('tr', { class: 'g' }, [spEl('td', { colspan: '6' }, [spEl('b', { text: 'Not for sale' }), ' · in no trade, and off your bazaar\'s Fill all'])]));
            for (const r of T.kept) rows.push(row(r, [spEl('span', { class: 't-muted', text: '–' })], [spEl('span', { class: 't-muted', text: 'kept' })]));
        }
        const all = T.rows || [];
        if (all.length) {
            rows.push(spEl('tr', { class: 'sum' }, [
                spEl('td', { text: count(all.reduce((a, r) => a + r.qty, 0)) + ' items' }),
                spEl('td'),
                spEl('td', { class: 'n', text: formatMoney(all.reduce((a, r) => a + r.qty * r.each, 0)) }),
                spEl('td', { class: 'n', text: 'if sold now' }),
                spEl('td', { class: 'n t-good', text: signed((T.groups || []).reduce((a, g) => a + g.gain, 0)) }),
                spEl('td'),
            ]));
        }
        this.listDraw(heads, rows, 'Nothing to sell. What you bought for a trade that was cancelled, what a trader did not take, and extra buys wait here until a trader pays more than you paid.');
        this.moreBtn.hidden = true;
    }

    /* ------------------------------------------------- what you picked */

    /**
     * Everything about the item picked, each part in its own panel: its head, who sells it, who pays for
     * it (or, by trader, everything they pay for), the trade, and where to sell what you hold. One
     * signature for all of them, so they are drawn again together and only when something shown changed.
     *
     * desk: {itemId, name, held, avg, bazaars,
     *   buyers, buyersTotal, buyersLoading, pending,
     *   sellers: {state: 'loading'|'error'|'ok', rows, error},
     *   plan, planWhy: 'nobuyer'|'nounder'|'loading'|null,
     *   where: {options, best, gain}|null, market: {state, lowest}, trade}
     */
    renderDesk() {
        const page = this.pg();
        if (page !== 'flips' && page !== 'mine' && page !== 'sell' && page !== 'trades') return;
        const s = this.state;
        // Trades: until a trade is opened, none is on show.
        const d = page === 'trades' && s.trades && s.trades.open ? null : s.desk;
        if (d && this.showAll.item !== d.itemId) this.showAll = { item: d.itemId, buyers: false, sellers: false, hidden: false };
        const statusOf = (b) => {
            const st = b.id && s.statuses ? s.statuses.get(String(b.id)) : null;
            return st ? st.level + st.text : '';
        };
        const now = Date.now();
        const p = s.prefs;
        const info = s.info || {};
        const where = [page, this.bd.tab, this.planOnSide(), this.paneKey(), this.paneTab()];
        const sig = d
            ? JSON.stringify([
                where,
                d.itemId, d.name, d.held, d.avg, d.bazaars, d.buyersTotal, d.buyersLoading, d.buyersListNote, d.pending, d.planWhy, d.paid,
                d.yesNote || false, d.trade && d.trade.listCheck && d.trade.listCheck.readAt ? Math.min(13, Math.floor((now - d.trade.listCheck.readAt) / 5000)) : 0,
                d.buyers.map((b) => [b.id, b.name, b.price, b.te, b.teTop, b.teList, b.w3b, b.bulk || null, statusOf(b), b.trust ? b.trust.level + b.trust.score : '', s.networth && b.id ? s.networth.get(String(b.id)) : null, Boolean(b.favourite), b.traded || '', Boolean(b.troll), Boolean(b.lastPaidOnly), this.checkSig(b, now), b.listAt ? listAgeText(Math.max(0, now - b.listAt)) : '', this.h.listsOf ? JSON.stringify(this.h.listsOf(b)) : '']),
                this.justBlacklisted ? this.justBlacklisted.at : 0,
                (d.hidden || []).map((b) => [b.tradeKey, b.price, b.hiddenBy, statusOf(b), b.trust ? b.trust.level + b.trust.score : '']),
                // How old a list is, in the words shown: drawn again when they change, not every second.
                Object.entries(d.oldLists || {}).map(([k, o]) => [k, o.level, listAgeText(now - o.at)]),
                p.freshOnly, p.networthPct, p.minProfitPct,
                d.sellers.state, d.sellers.error,
                d.sellers.rows.map((r) => [r.sellerId, r.sellerName, r.price, r.qty, r.stale, Math.floor((now - (r.dataAt || 0)) / 60000)]),
                d.plan, d.where, d.market, d.trade, d.friend || null,
                this.showAll, this.showLeft || null, this.cancelAsk || null, [...(this.leftOpen || [])],
                p.onlineOnly, p.trustedOnly, p.cash, Boolean(info.knownTraders), info.tradersLoading,
                (s.pinned || []).map((x) => x.itemId), this.askedNow(d), this.keptNow(d), this.askSig(d),
                where[2] ? this.foldView(d) : null, this.goingWith(d), page === 'trades' ? (this.waitingOnDesk(d) || {}).key || null : null,
            ])
            : JSON.stringify([where, info.hasKey, info.loading, Boolean(info.bazaarsAt), info.tradersLoading, s.counts, (s.trades || {}).going || 0]);
        if (sig === this.deskSig) return;

        const shadow = this.root.getRootNode();
        const active = shadow && shadow.activeElement;
        const inside = (n) => this.deskParts.some((part) => part.contains(n));
        // A box you are in is never replaced (3.14.3: it only waited once you had typed, so a selection
        // made by a double-click was wiped within seconds by the next read): drawn again once you leave it.
        if (active && inside(active) && active.tagName === 'INPUT' && active.type !== 'checkbox' && (active.dataset.dirty || document.hasFocus())) return;
        this.deskSig = sig;
        const keep = active && inside(active) && active.dataset ? active.dataset.focus : null;

        // The trade's pane first: it moves the part of its tab in view into itself, and that part is drawn
        // next. A part in no tab in view is not drawn (mockup AM: only what is in view is drawn).
        if (this.planEl.isConnected) this.drawPlan(d);
        if (this.headEl.isConnected) this.drawHead(d);
        if (this.askEl.isConnected) this.drawAsk(d);
        if (this.payEl.isConnected) this.drawPay(d);
        if (this.buysEl.isConnected) this.drawBuys(d);
        if (this.whereEl.isConnected) this.drawWhere(d);
        if (this.tradeFoldEl.isConnected) this.drawFold(d);

        if (keep) {
            // A trader just blacklisted is gone from the rows: their Undo takes the focus.
            // Said no: that trader's Undo (never the next trader's, review M3).
            const want = keep.startsWith('blk:') && this.justBlacklisted ? 'desk:bl-undo' : keep.startsWith('trade:decline:') ? 'plan:undo:' + keep.slice('trade:decline:'.length) : keep;
            for (const part of this.deskParts) {
                const node = part.isConnected ? [...part.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === want) : null;
                if (node) {
                    node.focus({ preventScroll: true });
                    break;
                }
            }
        }
    }

    /** Drawn again now, whatever the signature says (something of the page's own changed: a fold, a question). */
    redrawDesk() {
        this.deskSig = null;
        this.renderDesk();
    }

    /** Whether the traders the desk may show an Ask for can be asked now (3.33.0): the desk is drawn again when it moves. */
    askSig(d) {
        if (!this.h.askOf) return '';
        // Every trader a press on the desk can stand on: the trade's, the plan's, the first buyer's (the plan's
        // stand-in when it names none), the accepted trade's.
        const T = d.trade || {};
        const ids = [T.chosen && T.chosen.buyer, T.accepted && T.accepted.trader, d.plan && d.plan.buyer, d.buyers && d.buyers[0]].map((b) => (b && b.id ? String(b.id) : null)).filter(Boolean);
        return [...new Set(ids)].map((id) => id + ':' + this.h.askOf(id).why).join(',');
    }

    /** You asked the trader of the trade on show (Chat, or their Trade link): it waits for their yes. */
    askedNow(d) {
        const c = d && d.trade && !d.trade.accepted ? d.trade.chosen : null;
        if (!c) return false;
        return ((this.state.trades || {}).waiting || []).some((w) => w.asked && w.itemId === String(d.itemId) && w.key === c.key);
    }

    /**
     * The trade of the item on show, in one row's worth: who, its profit, the step it is at, and where
     * the whole of it is - Trades once you asked or they said yes, Flips while it is only a plan.
     */
    foldView(d) {
        const T = d && d.trade;
        const A = T && T.accepted;
        const c = !A && T && T.chosen && T.picked ? T.chosen : null;
        if (!A && !c) return null;
        const b = (A || c).buyer || {};
        const going = this.tradesGoing();
        if (A) {
            const at = going.findIndex(([kind, r]) => kind !== 'waiting' && r.key === A.key);
            const profit = Math.round((A.totals || A).profit || 0);
            return { name: b.name, id: b.id || null, profit, about: false, line: at >= 0 ? this.tradeStage(going[at][0], going[at][1]).line : 'said yes ' + formatAge(Date.now() - A.at), to: 'trades', at };
        }
        const at = going.findIndex(([kind, r]) => kind === 'waiting' && r.key === c.key && String(r.itemId) === String(d.itemId));
        const line = at >= 0 ? this.tradeStage('waiting', going[at][1]).line : this.plural((c.flips || []).length, 'item') + (c.stops ? ' · ' + this.plural(c.stops, 'bazaar') : '');
        return { name: b.name, id: b.id || null, profit: Math.round(c.profit || 0), about: Boolean(c.estimated), line, to: at >= 0 ? 'trades' : 'flips', at };
    }

    /**
     * A trade already going with the trader who pays most for the item on show: [kind, row], or null.
     * Where to sell then points at that trade, and offers no second one.
     */
    goingWith(d) {
        const b = d && d.held && d.where ? d.buyers[0] : null;
        const key = b ? b.tradeKey || (b.id ? 'id:' + b.id : null) : null;
        if (!key) return null;
        return this.tradesGoing().find(([kind, r]) => r.key === key && (kind !== 'waiting' || String(r.itemId) === String(d.itemId))) || null;
    }

    /** The trade as one row, on My items and To sell. */
    drawFold(d) {
        const box = this.tradeFoldEl;
        box.textContent = '';
        const v = this.foldView(d);
        box.hidden = !v;
        if (!v) return;
        const row = v.at >= 0 ? this.tradesGoing()[v.at] : null;
        box.append(
            spEl('div', { class: 'lbl', text: 'Your trade on this item' }),
            spEl('div', { class: 'foldrow' }, [
                spEl('span', { class: 'w' }, [spEl('b', {}, [this.playerName(v.name, v.id, 'fold:who')]), spEl('small', { text: v.line })]),
                spEl('span', { class: 'p' + (v.profit > 0 ? '' : v.profit < 0 ? ' neg' : ' zero'), text: (v.about ? '≈ ' : '') + signed(v.profit) }),
                spEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'fold:open', title: v.to === 'trades' ? 'The whole trade, bazaar by bazaar, is on Trades' : 'The whole plan, bazaar by bazaar, is on Flips', text: v.to === 'trades' ? 'Open on Trades' : 'Open on Flips', onclick: () => {
                    if (v.to === 'flips') this.showFlip(d.itemId);
                    else if (row) this.showTrade(row[0], row[1]);
                    else this.go('trades');
                } }),
            ]),
        );
    }

    /** The item on show is one you marked Not for sale. */
    keptNow(d) {
        const row = d ? (((this.state.toSell || {}).rows) || []).find((r) => String(r.itemId) === String(d.itemId)) : null;
        return row ? Boolean(row.kept) : null;
    }

    /** Who a piece is priced against in Bazaars sell: the trader of the trade on show, else the best one. */
    payFor(d) {
        const T = d.trade;
        const c = T && (T.accepted || T.chosen);
        if (c && c.buyer) {
            const line = (c.flips || c.items || []).find((r) => String(r.itemId) === String(d.itemId));
            const row = d.buyers.find((b) => b.tradeKey === c.key);
            const price = line && line.bid > 0 ? line.bid : row ? row.price : 0;
            if (price > 0) return { name: c.buyer.name, price };
        }
        // 3.29.0: else the best trader whose price is checked; with none checked, the best believable one - and the
        // gaps beside each bazaar are then muted ("not checked"), never green.
        const sure = (d.plan && d.plan.units > 0 && d.plan.buyer) || d.buyers.find((x) => !x.troll && (!x.check || x.check.ok)) || null;
        const b = sure || d.buyers.find((x) => !x.troll) || null;
        return b ? { name: b.name, price: b.price, unchecked: !sure } : null;
    }

    /** The head of what you picked: its picture, its name (the Item Market), a friend's mark, its few numbers. */
    drawHead(d) {
        const box = this.headEl;
        const s = this.state;
        const info = s.info || {};
        box.textContent = '';
        if (!d) {
            const none = !(s.counts && s.counts.all);
            // The list beside it says what is being waited for: this says what will stand here, once.
            box.appendChild(spEl('div', { class: 'none', text: none ? 'The bazaars that sell an item, and the traders who pay for it, show here.' : 'Pick an item.' }));
            return;
        }
        const page = this.pg();
        const avg = ['Market average', d.avg ? formatMoney(d.avg) : '–'];
        const cheapest = d.sellers.rows.find((r) => !r.stale) || d.sellers.rows[0] || null;
        const sellRow = page === 'sell' ? (((s.toSell || {}).rows) || []).find((r) => String(r.itemId) === String(d.itemId)) : null;
        const facts = (page === 'flips'
            ? [avg, d.held ? ['You hold', count(d.held)] : null, ['Bazaars', count(d.bazaars || d.sellers.rows.length)], ['Traders', count(d.buyers.length)]]
            : page === 'sell'
                ? [sellRow ? ['To sell', count(sellRow.qty) + (d.held !== sellRow.qty ? ' of ' + count(d.held) + ' held' : '')] : ['You hold', count(d.held)], d.paid ? ['You paid', formatMoney(d.paid)] : null, sellRow ? ['Why', this.whyText(sellRow.why)] : null, avg]
                : [['You hold', count(d.held)], avg, cheapest ? ['Bazaar', formatMoney(cheapest.price)] : null]).filter(Boolean);
        box.append(
            this.pic('desk', d.itemId, 'xl'),
            spEl('div', {}, [
                spEl('h3', {}, [this.link(d.name, itemMarketUrl(d.itemId, d.name), { cls: 'lk', title: 'Opens the Item Market at this item', focus: 'desk:name' })]),
                // One line of what a friend did: going for it now, else what they took. The rest is in its title.
                d.friend && d.friend.going
                    ? this.friendEl(d.friend.going, ' · ', d.friend.took ? d.friend.took.lead + ' ' + d.friend.took.rest + ' · ' + d.friend.took.was : '')
                    : this.friendEl(d.friend && d.friend.took, ' ', d.friend && d.friend.took ? d.friend.took.was : ''),
            ]),
            spEl('span', { class: 'sp' }),
            spEl('div', { class: 'facts' }, facts.map(([k, v]) => spEl('span', { title: k === 'Market average' ? 'Item Market Average' : null }, [k, spEl('b', { text: v })]))),
        );
    }

    /**
     * Bazaars sell, cheapest first: the seller (their bazaar at this item), how many, the price, what a
     * piece leaves you with the trader of the trade on show, and when TornW3B last saw it. One line says
     * where profit stops.
     */
    drawAsk(d) {
        const box = this.askBox;
        box.textContent = '';
        this.askEl.hidden = !d;
        if (!d) return;
        const sel = d.sellers;
        if (sel.state === 'loading' && !sel.rows.length) box.appendChild(spEl('p', { class: 'note', text: 'Loading bazaars from TornW3B…' }));
        else if (sel.state === 'error' && !sel.rows.length) box.appendChild(spEl('p', { class: 'note t-bad', text: sel.error || 'TornW3B did not answer. Trying again soon.' }));
        else if (!sel.rows.length) box.appendChild(spEl('p', { class: 'note', text: 'No bazaar is selling it.' }));
        if (!sel.rows.length) return;
        const pay = this.payFor(d);
        const pct = this.state.prefs.minProfitPct ?? 1;
        const good = (r) => Boolean(pay) && !r.stale && pay.price - r.price >= Math.max(1, (r.price * pct) / 100);
        const all = this.showAll.sellers;
        const rows = all ? sel.rows : sel.rows.slice(0, BD_ROWS);
        const most = Math.max(1, ...rows.map((r) => r.qty || 0));
        // The line sits over the first bazaar seen lately that leaves too little; every one under it does too.
        const cut = pay ? rows.findIndex((r) => !r.stale && !good(r)) : -1;
        const anyGood = rows.some(good);
        const now = Date.now();
        const body = spEl('tbody');
        rows.forEach((r, i) => {
            if (i === cut) {
                body.appendChild(spEl('tr', { class: 'mk' }, [spEl('td', { colspan: '5' }, [
                    spEl('b', { text: pay.name + ' pays ' + formatMoney(pay.price) + (pay.unchecked ? ', not checked.' : '.') }),
                    anyGood ? ' Under this line a piece leaves less than your ' + pct + '%.' : ' No bazaar leaves your ' + pct + '% now.',
                ])]));
            }
            const ok = good(r);
            const gap = pay ? pay.price - r.price : 0;
            const piece = !pay ? null
                : r.stale ? spEl('span', { title: 'TornW3B has not seen this bazaar lately: it is not counted', text: 'not seen' })
                    : ok ? (pay.unchecked ? spEl('span', { class: 't-muted', title: 'At a price that is not checked: ' + pay.name + ' pays ' + formatMoney(pay.price), text: '≈ ' + signed(gap) }) : spEl('b', { class: 't-good', text: signed(gap) }))
                        : gap > 0 ? spEl('span', { title: signed(gap) + ' a piece: under your least profit of ' + pct + '%', text: 'too thin' })
                            : spEl('span', { title: 'Over what ' + pay.name + ' pays', text: 'over' });
            const name = r.sellerName || 'Player ' + r.sellerId;
            body.appendChild(spEl('tr', { class: ok || !pay ? (r.stale ? 'dim' : '') : 'dim' }, [
                spEl('td', {}, [this.link(name, bazaarUrl(r.sellerId, d.itemId, r.price), { cls: 'lk', title: 'Opens ' + name + '\'s bazaar at this item', focus: 'bazaar:' + r.sellerId, children: [spEl('b', { text: name })] })]),
                spEl('td', { class: 'n' }, [this.bar(r.qty, most, ok ? '' : 'dimb'), count(r.qty)]),
                spEl('td', { class: 'n' }, [spEl('b', { text: formatMoney(r.price) })]),
                spEl('td', { class: 'n' }, [piece]),
                spEl('td', { class: 'n t-muted', text: r.dataAt ? formatAge(now - r.dataAt).replace(' ago', '') : '–' }),
            ]));
        });
        if (sel.rows.length > BD_ROWS) {
            body.appendChild(spEl('tr', {}, [spEl('td', { colspan: '5' }, [this.wordBtn(all ? 'Show the cheapest ' + BD_ROWS : 'Show all ' + count(sel.rows.length) + ' bazaars', 'desk:sellers-all', '', () => {
                this.showAll.sellers = !all;
                this.redrawDesk();
            })])]));
        }
        box.appendChild(spEl('table', { class: 't' }, [
            spEl('thead', {}, [spEl('tr', {}, [
                spEl('th', { text: 'Seller' }), spEl('th', { class: 'n', text: 'Has' }), spEl('th', { class: 'n', text: 'Price' }),
                spEl('th', { class: 'n', title: pay ? 'What a piece leaves you when it goes to ' + pay.name : null, text: 'A piece' }),
                spEl('th', { class: 'n', title: 'When TornW3B last saw this listing', text: 'Seen' }),
            ])]),
            body,
        ]));
    }

    /**
     * Traders pay, highest first. A row is the trader: press it to plan the trade with them (the owner:
     * "trader 1 didn't want to trade - click trader 2 to see the flip plan there"); pressed again, a plan
     * you picked comes off. What the whole trade with each makes is beside their price. A trader who said
     * no goes to the bottom, greyed, with Undo; what your filters leave out is counted in one line.
     */
    drawPay(d) {
        const box = this.payBox;
        box.textContent = '';
        this.payEl.hidden = !d;
        if (!d) return;
        const T = d.trade || null;
        const declined = (T && T.declined) || {};
        const ordered = [...d.buyers.filter((b) => !declined[b.tradeKey] && !b.troll), ...d.buyers.filter((b) => !declined[b.tradeKey] && b.troll), ...d.buyers.filter((b) => declined[b.tradeKey])];
        const all = this.showAll.buyers;
        const rows = all ? ordered : ordered.slice(0, BD_ROWS);
        this.paySub.textContent = T ? 'highest first · press one to trade with them' : 'highest first';
        if (d.buyersLoading) box.appendChild(spEl('p', { class: 'note', text: 'Loading more buyers from TornExchange…' }));
        else if (d.buyersListNote) box.appendChild(spEl('p', { class: 'note', text: d.buyersListNote }));
        // Just blacklisted: a moment to take it back (then only the Ledger's Traders tab has Undo).
        const justOff = this.justBlacklisted && Date.now() - this.justBlacklisted.at < 15000 ? this.justBlacklisted.b : null;
        if (justOff) {
            box.appendChild(spEl('p', { class: 'note' }, ['Blacklisted ' + justOff.name + ': never a buyer. ', this.wordBtn('Undo', 'desk:bl-undo', '', () => {
                this.justBlacklisted = null;
                if (this.h.onBlacklist) this.h.onBlacklist(justOff, false);
            })]));
        }
        if (!rows.length) box.appendChild(spEl('p', { class: 'note', text: this.noTraderText(d) }));
        const tradeOf = (b) => (T && T.perTrader ? T.perTrader[b.tradeKey] : null);
        const max = Math.max(1, ...rows.map((b) => (tradeOf(b) && tradeOf(b).items ? tradeOf(b).profit : 0)));
        const body = spEl('tbody');
        for (const b of rows) {
            const planning = Boolean(T && ((T.chosen && T.chosen.key === b.tradeKey) || (T.accepted && T.accepted.key === b.tradeKey)));
            const until = declined[b.tradeKey];
            const t = tradeOf(b);
            const first = spEl('td', { class: 'wrap' }, [
                b.favourite ? spEl('span', { class: 'star', title: 'A favourite', text: '★' }) : null,
                this.dot(b),
                spEl('b', { text: b.name }),
                until ? spEl('small', {}, ['said no · passed over for ' + formatAge(until - Date.now()).replace(' ago', '') + ' · ', this.wordBtn('Undo', 'plan:undo:' + b.tradeKey, 'Plan with ' + b.name + ' again', () => this.h.onTradeUndecline && this.h.onTradeUndecline(b.tradeKey))]) : null,
                this.oldListLine(d, b),
                this.checkLine(d, b),
                // 3.29.0 - their list pays another price from a count up: said in amber; the sums stand on the price for one.
                b.bulk ? spEl('small', { class: 't-warn', title: 'Their TornW3B list has a bulk price for this item. The sums here use ' + formatMoney(b.price) + ' each: check their list before a big trade.', text: 'Bulk price from ' + count(b.bulk.from) + ': ' + formatMoney(b.bulk.price) }) : null,
                // Their two lists disagree: the lower is counted, and said.
                b.differ ? spEl('small', { title: 'Their two price lists do not agree: check before trading', text: 'Lists differ: ' + this.listPrices(b, ' · ') + ' · counted at the lower' }) : null,
                b.troll ? spEl('small', { class: 't-warn', text: 'Over 3× Item Market Average: not counted' }) : null,
                // No public list: what they paid you last (review M2).
                b.lastPaidOnly ? spEl('small', { class: 't-warn', text: 'Last paid: no public list, check with them' }) : null,
            ]);
            const trade = !t ? []
                : t.items ? [this.bar(t.profit, max), spEl('b', { class: 't-good', text: (t.estimated ? '≈ ' : '') + signed(t.profit) }), spEl('small', { text: count(t.items) + (t.items === 1 ? ' item' : ' items') + (t.stops ? ' · ' + count(t.stops) + (t.stops === 1 ? ' bazaar' : ' bazaars') : '') + (!t.hasItem ? ' · not this item' : '') }),
                    // 3.30.0: planned alone, from the same listings as the trade on show - it is that trade's goods, sold to another trader.
                    t.same && T && T.chosen && T.chosen.buyer ? spEl('small', { title: 'The trade with each trader is planned alone, from the same bazaar listings. What both trades have can be bought once: it is one or the other.' + (t.own > 0 ? ' Its other items make ' + signed(t.own) + '.' : ''), text: sameGoodsWords(t.same, t.flips) + ' the trade with ' + T.chosen.buyer.name }) : null]
                    : [spEl('span', { class: 't-muted', text: b.troll ? 'their bid is not believable' : 'no trade with your Cash' })];
            const cells = [first, spEl('td', { class: 'n' }, [spEl('b', { text: formatMoney(b.price) })]), spEl('td', { class: 'n' }, trade)];
            if (until || !T) {
                body.appendChild(spEl('tr', { class: until ? 'dim' : '' }, cells));
                continue;
            }
            // Shared: a friend is on this item. Said, never a lock.
            const anyway = Boolean(d.friend && d.friend.going);
            const title = planning
                ? (T.accepted ? b.name + ' said yes: the trade is the one on show' : T.picked ? 'Planning with ' + b.name + ': press to take this plan off' : 'The trade on show is with ' + b.name)
                : (anyway ? d.friend.going.lead + '. ' : '') + 'Plan the trade with ' + b.name + ': this item and their other items';
            body.appendChild(this.pickRow(planning ? 'sel' : '', 'plan:' + b.tradeKey, () => {
                // Pressed again, a plan you picked comes off (3.20.2): nothing was said yet.
                if (planning && !T.accepted && T.picked) return this.h.onTradeUnpick && this.h.onTradeUnpick(d.itemId, b.tradeKey);
                if (!planning) return this.h.onTradePick && this.h.onTradePick(d.itemId, b.tradeKey);
                return null;
            }, cells, title));
        }
        if (d.buyers.length > BD_ROWS) {
            body.appendChild(spEl('tr', {}, [spEl('td', { colspan: '3' }, [this.wordBtn(all ? 'Show the top ' + BD_ROWS : 'Show all ' + count(d.buyers.length) + ' traders', 'desk:buyers-all', '', () => {
                this.showAll.buyers = !all;
                this.redrawDesk();
            })])]));
        }
        this.hiddenBuyers(body, d);
        if (!body.children.length) return;
        box.appendChild(spEl('table', { class: 't' }, [
            spEl('thead', {}, [spEl('tr', {}, [spEl('th', { text: 'Trader' }), spEl('th', { class: 'n', text: 'Pays' }), spEl('th', { class: 'n', title: 'What the whole trade with them makes: this item and their other items', text: 'The trade' })])]),
            body,
        ]));
        // Why a price makes no flip: the rows say it in a few words, the reason itself is here once.
        const note = this.checkNote(rows);
        if (note) box.appendChild(spEl('p', { class: 'note', text: note }));
    }

    /**
     * Traders your Online / Trusted / Fresh prices leave out here, and those who pay no more than you paid:
     * how many and why in one line and, on a press, who (greyed, never planned). The list never empties
     * with no reason (the friend, 3.14.4).
     */
    hiddenBuyers(body, d) {
        const hidden = d.hidden || [];
        if (!hidden.length) return;
        const open = Boolean(this.showAll.hidden);
        const n = (k) => hidden.filter((b) => b.hiddenBy === k).length;
        const parts = [];
        if (n('trust')) parts.push('Trusted hides ' + count(n('trust')));
        if (n('offline')) parts.push('Online hides ' + count(n('offline')));
        if (n('stale')) parts.push('Fresh prices hides ' + count(n('stale')));
        if (n('loss')) parts.push(count(n('loss')) + (n('loss') === 1 ? ' pays' : ' pay') + ' no more than the ' + formatMoney(d.paid) + ' you paid');
        body.appendChild(spEl('tr', { class: 'dim' }, [spEl('td', { colspan: '3', class: 'wrap' }, [
            parts.join(' · ') + ' · ',
            this.wordBtn(open ? 'Hide them' : 'Show them', 'desk:hidden', '', () => {
                this.showAll.hidden = !open;
                this.redrawDesk();
            }),
        ])]));
        if (!open) return;
        for (const b of hidden) {
            const why = b.hiddenBy === 'loss'
                ? 'Pays no more than you paid: a loss, never suggested'
                : b.hiddenBy === 'offline'
                    ? 'Offline: hidden by Online'
                    : b.hiddenBy === 'stale' ? 'Price list last changed ' + formatAge(Date.now() - b.listAt) + ': hidden by Fresh prices'
                        : !b.trust ? 'No votes yet: hidden by Trusted'
                            : b.trust.level === 'Caution' ? 'More votes against than for: hidden by Trusted'
                                : 'Fewer than 20 votes: hidden by Trusted';
            body.appendChild(spEl('tr', { class: 'dim' }, [
                spEl('td', { class: 'wrap' }, [this.dot(b), this.playerName(b.name, b.id, 'hidden:' + (b.id || b.name)), spEl('small', { text: why + (b.traded ? ' · ' + b.traded : '') })]),
                spEl('td', { class: 'n', text: formatMoney(b.price) }),
                spEl('td'),
            ]));
        }
    }

    /**
     * Flips › By trader: everything the trader of the trade on show pays for that a bazaar sells, beside
     * the cheapest bazaar - what a piece leaves, and what the flip makes. Grey rows leave too little.
     * A row in black can be pressed: the trade is planned again with that item leading.
     */
    drawBuys(d) {
        const box = this.buysBox;
        box.textContent = '';
        const T = d && d.trade;
        const c = T && (T.accepted || T.chosen);
        this.buysTitle.textContent = c && c.buyer ? 'What ' + c.buyer.name + ' pays' : 'What they pay';
        if (!c) {
            box.appendChild(spEl('p', { class: 'note', text: 'Pick a trader on the left: what they pay shows here, and the trade beside it.' }));
            return;
        }
        const pct = this.state.prefs.minProfitPct ?? 1;
        const made = new Map();
        for (const r of c.flips || []) made.set(String(r.itemId), { profit: r.profit, about: Boolean(r.estimated) });
        for (const r of c.left || []) if (!made.has(String(r.itemId))) made.set(String(r.itemId), { profit: r.profit, about: true });
        for (const i of T.accepted ? c.items || [] : []) {
            if (i.kind === 'yours') continue;
            made.set(String(i.itemId), { profit: (i.steps || []).reduce((a, st) => a + (i.bid - st.price) * st.qty, 0), about: false });
        }
        const rows = (T.buys || []).slice().sort((a, b) => ((made.get(b.itemId) || {}).profit || 0) - ((made.get(a.itemId) || {}).profit || 0) || (b.bid - (b.ask || b.bid)) - (a.bid - (a.ask || a.bid)) || String(a.name).localeCompare(String(b.name)));
        if (!rows.length) {
            box.appendChild(spEl('p', { class: 'note', text: 'Nothing a bazaar sells is on ' + c.buyer.name + '\'s list now.' }));
            return;
        }
        const max = Math.max(1, ...rows.map((r) => (made.get(r.itemId) || {}).profit || 0));
        const body = spEl('tbody');
        for (const r of rows) {
            const gap = r.ask ? r.bid - r.ask : null;
            const ok = gap !== null && gap >= Math.max(1, (r.ask * pct) / 100);
            const m = made.get(r.itemId) || null;
            const cells = [
                spEl('td', {}, [spEl('div', { class: 'cell' }, [this.pic('buys', r.itemId), spEl('b', { text: r.name })])]),
                spEl('td', { class: 'n' }, [spEl('b', { text: formatMoney(r.bid) })]),
                spEl('td', { class: 'n', text: r.ask ? formatMoney(r.ask) : '–' }),
                spEl('td', { class: 'n' }, [gap === null ? spEl('span', { title: 'Its bazaars are not read yet', text: '–' })
                    : ok ? spEl('span', { class: 't-good', text: signed(gap) })
                        : gap > 0 ? spEl('span', { title: signed(gap) + ' a piece: under your least profit of ' + pct + '%', text: 'too thin' }) : spEl('span', { title: 'Over what ' + c.buyer.name + ' pays', text: 'over' })]),
                spEl('td', { class: 'n' }, m && m.profit > 0 ? [this.bar(m.profit, max), spEl('b', { class: 't-good', text: (m.about ? '≈ ' : '') + signed(m.profit) })] : []),
            ];
            const on = String(d.itemId) === String(r.itemId);
            if (ok && !T.accepted) body.appendChild(this.pickRow(on ? 'sel' : '', 'buys:' + r.itemId, () => !on && this.h.onTradePick && this.h.onTradePick(r.itemId, c.key), cells, on ? r.name + ' leads this trade' : 'Plan the trade with ' + r.name + ' leading'));
            else body.appendChild(spEl('tr', { class: ok ? (on ? 'sel' : '') : 'dim' }, cells));
        }
        box.appendChild(spEl('table', { class: 't' }, [
            spEl('thead', {}, [spEl('tr', {}, [spEl('th', { text: 'Item' }), spEl('th', { class: 'n', text: c.buyer.name + ' pays' }), spEl('th', { class: 'n', text: 'A bazaar asks' }), spEl('th', { class: 'n', text: 'A piece' }), spEl('th', { class: 'n', text: 'The flip' })])]),
            body,
        ]));
    }

    /* ------------------------------------------------------------ traders */

    /**
     * A price from a TornW3B list its trader has not changed in over 24 hours (3.22.3; the owner picked
     * mockup X-B): amber, and how long ago, under the trader - the price itself is left as it is.
     */
    oldListLine(d, b) {
        const o = d.oldLists && b.tradeKey ? d.oldLists[b.tradeKey] : null;
        return o ? this.oldListEl(o) : null;
    }

    /**
     * A price that makes no flip, and why (3.26.0; the owner, 2026-10-11: "everytime it shows a flip, its
     * because the item list is checked ... a refresh button on traders so it takes the price list from
     * there and we get fresh prices"): under the trader, with Refresh - their list is read at once, then
     * the item's buyers. A checked price says nothing: its Refresh is beside the name. A price that is
     * only what they last paid has its own line.
     */
    checkLine(d, b) {
        const c = b.check;
        if (!c || b.troll || b.lastPaidOnly) return null;
        const now = Date.now();
        const reading = this.checkReading(b, now);
        const refresh = b.id && b.w3b > 0
            ? this.wordBtn('Refresh', 'check:' + b.tradeKey, 'Reads ' + b.name + '\'s price list on TornW3B now, then who buys this item' + (c.at ? ' (price last checked ' + this.checkAge(now - c.at) + ')' : ''), () => {
                this.checkPressed.set(b.tradeKey, Date.now());
                this.deskSig = null;
                if (this.h.onTraderCheck) this.h.onTraderCheck(d.itemId, b.tradeKey);
                this.redrawDesk();
            })
            : null;
        if (reading) return spEl('small', { text: 'Reading their price list…' });
        // 3.31.0: their own word, told by their Torn Archive through the shared server - also with their shop closed.
        // 3.33.0 - TornExchange only: shown, in pulsing amber, with their list to look at (the owner, 2026-10-16:
        // "always show the torn exchange ... a warning or pulsating amber so were reminded to click the pricelist").
        if (c.ok && c.why === 'te-only') return spEl('small', {}, [this.teWarn(b), refresh ? ' · ' : null, refresh]);
        const said = c.ok && c.why === 'said' ? 'Their own price list, told ' + this.checkAge(now - c.at) + (c.closed ? ' · their shop is closed' : '')
            : c.ok ? 'Open · checked ' + this.checkAge(now - c.at) : this.checkWhy(b, now);
        // 3.33.0 - when they last changed their list, beside every price (the owner: "needs to show when pricelist was last update").
        const changed = b.listAt > 0 && !(c.ok && c.why === 'said') && c.why !== 'old-list' ? ' · list changed ' + listAgeText(Math.max(0, now - b.listAt)) : '';
        return spEl('small', {}, [said, changed, refresh ? ' · ' : null, refresh]);
    }

    /** Why a price is not checked (core/checked.js), as the end of a sentence: "X's price is not checked: …". */
    uncheckedWhy(why) {
        if (why === 'no-id') return 'their TornW3B list cannot be read (no Torn id)';
        if (why === 'closed') return 'their TornW3B list is closed';
        if (why === 'not-checked') return 'their open list does not give this price';
        if (why === 'old-list') return 'their list was not changed in over a day';
        return 'their list has not been seen open in the last 3 minutes; it is being read';
    }

    /** A price only on TornExchange (3.33.0): shown, pulsing amber, a link to their TornExchange list. */
    teWarn(b) {
        return this.link('TornExchange only · check their list', tePriceListUrl(b.teName || b.name), { cls: 'te-warn', title: b.name + '\'s price is only on TornExchange, which cannot say whether their list is open: look at it before you trade', focus: 'te-warn:' + (b.id || b.name) });
    }

    /** How long ago a price was checked: "just now" under five seconds (a Refresh just answered), else the age. */
    checkAge(ms) {
        return ms < 5000 ? 'just now' : formatAge(ms);
    }

    /**
     * Why a price makes no flip: the row's few words. One line in the row (the Trader column is narrow
     * at 1280); the whole reason is said once under the table (checkNote), not under every trader.
     */
    checkWhy(b, now = Date.now()) {
        const c = b.check || {};
        if (c.why === 'no-id') return 'No Torn id: no flip';
        if (c.why === 'closed') return 'List closed: no flip';
        if (c.why === 'not-checked') return 'Not on their open list: no flip';
        if (c.why === 'not-open') return c.open === 'unclear' || c.open === 'failed' ? 'Couldn\'t confirm open: no flip' : 'Checking their list is open…';
        // The amber line above says when their list last changed.
        if (c.why === 'old-list') return 'Over a day old: no flip';
        return c.at ? 'Last checked ' + this.checkAge(now - c.at) + ': no flip' : 'Not checked yet: no flip';
    }

    /**
     * The reason behind "no flip", once under the Traders pay table: one sentence for each kind of
     * reason among the rows on show, in the rows' order. '' when every shown price makes a flip.
     */
    checkNote(rows) {
        const words = {
            'closed': 'A closed TornW3B list makes no flip.',
            'not-open': 'A TornW3B price makes a flip only once their list is seen open, in the last 3 minutes.',
            'old-list': 'A TornExchange list not changed in over a day makes no flip until they change it.',
            'unchecked': 'A price makes a flip only once checked with its trader; Refresh checks it now.',
        };
        const kinds = [];
        for (const b of rows) {
            const c = b.check;
            if (!c || c.ok || b.troll || b.lastPaidOnly) continue;
            const kind = words[c.why] ? c.why : 'unchecked';
            if (!kinds.includes(kind)) kinds.push(kind);
        }
        return kinds.map((k) => words[k]).join(' ');
    }

    /** Refresh was pressed on this trader in the last 15 seconds, and the answer is not in yet. */
    checkReading(b, now = Date.now()) {
        const at = this.checkPressed.get(b.tradeKey) || 0;
        return at > 0 && now - at < 15000 && !(b.check && b.check.at >= at);
    }

    /** What of a check is on screen (the desk is drawn again when it changes, not every second). */
    checkSig(b, now = Date.now()) {
        const c = b.check;
        if (!c) return '';
        return c.why + (c.at ? this.checkAge(now - c.at) : '') + (this.checkReading(b, now) ? 'r' : '');
    }

    /** The line itself. @param {{at: number, level: 'aging'|'stale'}} o */
    oldListEl(o) {
        return spEl('small', { class: 't-warn', title: 'Check their list before you buy' }, ['Price list last changed ' + listAgeText(Date.now() - o.at)]);
    }

    /** The star of a trader: a favourite (5+ trades this month, or added by you); press to change. */
    favButton(b) {
        if (!b || !b.id) return null;
        const on = Boolean(b.favourite);
        return spEl('button', {
            type: 'button',
            class: 'star' + (on ? '' : ' off'),
            'data-focus': 'fav:' + b.id,
            title: on ? 'A favourite: press to remove. Traders you traded with 5 or more times in 30 days join by themselves.' : 'Make ' + b.name + ' a favourite: they stay in view in By trader',
            'aria-pressed': String(on),
            'aria-label': on ? 'Remove ' + b.name + ' from favourites' : 'Make ' + b.name + ' a favourite',
            text: on ? '★' : '☆',
            onclick: () => this.h.onFavourite && this.h.onFavourite(b, !on),
        });
    }

    /** TE list and W3B list, the ones that exist; then ⊘ (blacklist: never a buyer). @returns {Node[]} */
    traderLinks(b, { blacklist = false } = {}) {
        const out = [];
        // Every list the trader has, whatever this item's price stands on (2026-10-16, the owner: "says TE only, but
        // it has the tornw3b link, not their torn exchange as well").
        const has = this.h.listsOf ? this.h.listsOf(b) : { te: false, w3b: false };
        if (b.te || has.te) out.push(this.link('TE list', tePriceListUrl(b.teName || b.name), { cls: 'btn sm lk', title: b.name + '\'s TornExchange price list' + (b.te ? ': ' + formatMoney(b.te) : ''), focus: 'step-te' }));
        if (b.id && (b.w3b || has.w3b)) out.push(this.link('W3B list', w3bPriceListUrl(b.id), { cls: 'btn sm lk', title: b.name + '\'s TornW3B price list' + (b.w3b ? ': ' + formatMoney(b.w3b) : ''), focus: 'step-w3b' }));
        if (blacklist) {
            out.push(spEl('button', {
                type: 'button',
                class: 'quiet',
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
        return out;
    }

    /**
     * Who a trade is with: a label over it (and Pinned / Held), their two price lists, their star, the
     * blacklist, then the name (their Torn profile) with the trust badge, and one line - online or not,
     * their networth, your own history with them.
     */
    whoBox(d, b, label, { tag = null, extra = [], focus = 'trade:buyer' } = {}) {
        const row = (d.buyers || []).find((x) => b.tradeKey && x.tradeKey === b.tradeKey) || (d.buyers || []).find((x) => b.id && String(x.id) === String(b.id)) || b;
        const nw = row.id && this.state.networth ? this.state.networth.get(String(row.id)) : null;
        const st = this.status(row);
        const sub = [st.childNodes.length ? st : null, nw >= 0 && nw !== null ? (st.childNodes.length ? ' · ' : '') + 'networth ' + formatMoney(nw) : null, ' · ' + (row.traded || 'not traded with yet')];
        if (!st.childNodes.length && !(nw >= 0 && nw !== null)) sub[2] = row.traded || 'not traded with yet';
        return spEl('div', { class: 'who' }, [
            spEl('div', { class: 'who-t' }, [
                spEl('span', { class: 'lbl' }, [label, tag ? spEl('span', { class: 'tag', title: tag.title, text: tag.text }) : null]),
                spEl('span', { class: 'sp' }),
                ...this.traderLinks(row, { blacklist: true }),
                this.favButton(row),
                ...extra,
            ]),
            spEl('h3', {}, [this.playerName(b.name, b.id || row.id, focus), this.trustBadge(row)]),
            spEl('span', { class: 'sub' }, sub),
        ]);
    }

    /** Ask, Yes, Buy, Trade: where a trade stands (0 to 3). */
    stepBar(at) {
        return spEl('div', { class: 'stepbar' }, ['Ask', 'Yes', 'Buy', 'Trade'].map((word, i) => spEl('span', { class: i < at ? 'done' : i === at ? 'now' : '' }, [spEl('i', { text: i < at ? '✓' : String(i + 1) }), word])));
    }

    /** "sells fast" / "slow seller" beside an extra item: why it is in, and in that amount. Measured where the shared server counted it (3.28.0), else by its type. */
    kindTag(kind) {
        if (kind === 'fast') return spEl('span', { class: 'kind', text: 'sells fast' });
        if (kind === 'slow') return spEl('span', { class: 'kind', text: 'slow seller' });
        return null;
    }

    /**
     * Ask the trader (the owner, 2026-09-28: "we don't need copy offer, what we need is a button that goes
     * straight to chatting that trader"): their Torn profile, where Torn's own chat button is marked; a
     * trader known by name only, their TornExchange page.
     */
    chatLink(b, cls, at = null) {
        const label = 'Ask ' + b.name;
        // 3.33.0 - only on a page read of their TornW3B list, in the last minute, that says it is open
        // (core/open-check.js pressReady; the money loss of 2026-10-14): else it is checked first.
        const ask = b.id && this.h.askOf ? this.h.askOf(b.id, { w3b: !(b.te > 0 && !(b.w3b > 0)) }) : { ready: true, why: 'no-list', at: 0, until: 0 };
        if (b.id && !ask.ready) return this.checkFirst(b, cls, at, ask, 'trade:chat');
        if (b.id) {
            this.redrawWhenStale(b.id, ask);
            const a = this.link(label, spProfileUrl(b.id), { cls: cls + ' sp-chat', title: 'Opens ' + b.name + '\'s profile on Torn: their chat button is marked' + (ask.at > 0 ? ' (their price list read ' + this.checkAge(Date.now() - ask.at) + ')' : ''), focus: 'trade:chat' });
            // Remembered for the overlay, which marks Torn's chat button there.
            const want = () => this.h.onChatWanted && this.h.onChatWanted(b.id, b.name);
            a.addEventListener('click', want);
            a.addEventListener('auxclick', want);
            return a;
        }
        if (b.te) return this.link(label, tePriceListUrl(b.teName || b.name), { cls: cls + ' sp-chat', title: b.name + ' is known by name only: their TornExchange page', focus: 'trade:chat' });
        return null;
    }

    /** "Open the trade" (3.33.0): as Ask, only on a page read of their list in the last minute that says open. */
    tradeLink(b, cls, at, focus, text = 'Open the trade') {
        if (!b || !b.id) return null;
        const ask = this.h.askOf ? this.h.askOf(b.id, { w3b: !(b.te > 0 && !(b.w3b > 0)) }) : { ready: true, why: 'no-list', at: 0, until: 0 };
        if (!ask.ready) return this.checkFirst(b, cls, at, ask, focus);
        this.redrawWhenStale(b.id, ask);
        return this.link(text, tradeUrl(b.id), { cls, title: 'Start a trade with ' + b.name + ' on Torn', focus });
    }

    /**
     * A step that moves money, held for a fresh look at their list (3.33.0, core/open-check.js pressReady): the
     * button that checks it, "Checking…" while it is read, or why it cannot go - their list is closed.
     */
    checkFirst(b, cls, at, ask, focus) {
        const name = b.name;
        if (ask.why === 'reading') return spEl('button', { type: 'button', class: cls, disabled: '', 'data-focus': focus, text: 'Checking ' + name + '\'s list…' });
        if (ask.why === 'closed') return spEl('button', { type: 'button', class: cls, disabled: '', 'data-focus': focus, title: 'TornW3B says ' + name + '\'s price list is closed' + (ask.at > 0 ? ' (read ' + this.checkAge(Date.now() - ask.at) + ')' : '') + ': no trade on it', text: name + '\'s list is closed' });
        const unsure = ask.why === 'unclear' || ask.why === 'failed';
        return spEl('button', { type: 'button', class: cls, 'data-focus': focus, title: 'Goes on only on ' + name + '\'s list as TornW3B shows it now, open: it is read first (a few seconds)', text: unsure ? 'Couldn\'t confirm ' + name + '\'s list is open · check again' : 'Check ' + name + '\'s list', onclick: () => {
            if (this.h.onTraderCheck) this.h.onTraderCheck(at ? at.itemId : null, at && at.key ? at.key : 'id:' + b.id);
            this.redrawDesk();
        } });
    }

    /** A check goes stale by the clock alone: the desk is drawn again the moment it does (one timer per trader). */
    redrawWhenStale(id, ask) {
        if (!(ask && ask.until > 0)) return;
        const timers = this.pressTimers || (this.pressTimers = new Map());
        clearTimeout(timers.get(String(id)));
        timers.set(String(id), setTimeout(() => {
            timers.delete(String(id));
            this.deskSig = null;
            this.todaySig = null;
            this.redrawDesk();
            this.renderToday();
        }, Math.max(0, ask.until - Date.now()) + 50));
    }

    /* -------------------------------------------------------------- the trade */

    /**
     * Which pane the trade is drawn in (mockup AM): 'items' on Flips > All items (the item first, its trade
     * a tab), 'trader' on By trader (what the trader pays is a tab), 'trade' everywhere else.
     */
    paneKey() {
        if (!this.bd) return 'trade';
        if (this.bd.page === 'flips' && this.bd.tab === BD_FLIPS_ITEMS) return 'items';
        if (this.onTraders()) return 'trader';
        return 'trade';
    }

    /** The tab of the trade's pane in view: the last one pressed in this kind of pane. */
    paneTab() {
        this.paneTabs = this.paneTabs || {};
        return this.paneTabs[this.paneKey()] || (this.paneKey() === 'items' ? 'pay' : 'plan');
    }

    /**
     * The trade's pane (mockup AM, the owner approved it 2026-10-16): who the trade is with, what it makes and
     * its step on top; then tabs - the plan (or, once they said yes, what to buy and what goes into the trade),
     * the bazaars that sell the item, the traders who pay for it, what a trader pays (By trader) - and the
     * buttons along the foot. Only the tab in view is drawn. On All items the item leads and its trade is a tab.
     */
    drawPlan(d) {
        const box = this.planEl;
        box.textContent = '';
        const page = this.bd.page;
        const onTrades = page === 'trades';
        const T = d && d.trade;
        const on = T && (T.accepted || T.chosen);
        // A waiting trade just pressed: its prices are being read, the plan with its trader follows.
        const loading = onTrades ? this.waitingOnDesk(d) : null;
        if (!d || (onTrades && (!on || loading))) {
            const going = (this.state.trades || {}).going || 0;
            box.appendChild(spEl('div', { class: 'none', text: onTrades
                ? (loading ? 'Loading the trade with ' + loading.name + '…' : going ? 'Press a trade on the left to open it.' : 'No trade going. A trade you ask a trader about, pin, or mark "said yes" shows here until it is traded, cancelled or they say no.')
                : 'Pick an item: the trade with its best trader shows here.' }));
            return;
        }
        const notes = [];
        // 3.29.0 - "said yes" was pressed, and their list as read at that press no longer makes the trade: said for a
        // minute, so a press that wrote nothing down says why.
        if (d.yesNote && !(T && T.accepted)) {
            const why = { moved: 'Their list, read as you pressed, no longer makes this trade. What is here now is at their prices as just read.', closed: 'Their TornW3B list is closed.', slow: 'Their list did not answer in time. Press again.' }[d.yesNote] || 'Couldn\'t confirm their list is open. Press again.';
            notes.push(spEl('div', { class: 'amber', role: 'status' }, [spEl('span', {}, [spEl('b', { text: 'The yes was not written down.' }), ' ' + why])]));
        }
        const key = this.paneKey();
        const parts = on ? (T.accepted ? this.acceptedPlan(d) : this.tradePlan(d)) : null;
        const b = parts && on ? (T.accepted ? null : T.chosen.buyer) : null;
        // The trade's own head (who, what it makes, its step) and its notes; the "Take" choice sits on the tabs' line.
        const head = parts ? parts.left.slice(0, 3) : [];
        const rest = parts ? parts.left.slice(3) : [];
        const take = rest.find((n) => n.classList && n.classList.contains('take')) || null;
        const leftNotes = rest.filter((n) => n !== take);

        const tabs = [];
        const tab = (id, label, n, nodes, title = null) => tabs.push({ id, label, n, nodes, title });
        const ask = [key === 'items' || !parts ? null : this.headEl, this.askEl].filter(Boolean);
        const sellers = d.bazaars || d.sellers.rows.length;
        if (key === 'items') {
            tab('pay', 'Traders pay', d.buyersTotal || d.buyers.length, [this.payEl], 'Highest first · press one to trade with them');
            tab('ask', 'Bazaars sell', sellers, ask, 'Cheapest first');
            tab('plan', 'Trade', null, parts ? [...head, ...leftNotes, take, ...parts.right] : [this.flipPlan(d)]);
        } else {
            if (parts && T.accepted) {
                tab('plan', 'Buy', parts.nBuy, [...leftNotes, ...parts.buy]);
                tab('send', 'Into the trade', parts.nSend, parts.send);
            } else {
                tab('plan', 'Plan', parts ? parts.n : null, parts ? [...leftNotes, ...parts.right] : [this.flipPlan(d)]);
            }
            if (key === 'trader') tab('buys', b ? 'What ' + b.name + ' pays' : 'What they pay', null, [this.buysEl], 'Beside the cheapest bazaar · grey rows leave too little');
            tab('ask', 'Bazaars', sellers, ask, 'Cheapest first');
            tab('pay', 'Traders', d.buyersTotal || d.buyers.length, [this.payEl], 'Highest first · press one to trade with them');
        }
        const want = this.paneTab();
        const cur = tabs.find((t) => t.id === want) || tabs[0];

        const pane = spEl('div', { class: 'tp' });
        // The head: the trade (who, what it makes, its step), or the item while there is no trade with anyone.
        if (key === 'items' || !parts) pane.appendChild(spEl('div', { class: 'tph' }, [this.headEl]));
        else pane.appendChild(spEl('div', { class: 'tph' }, head));
        if (notes.length) pane.appendChild(spEl('div', { class: 'tpn' }, notes));
        const bar = spEl('div', { class: 'subtabs', role: 'tablist' }, tabs.map((t) => spEl('button', {
            type: 'button',
            role: 'tab',
            class: t === cur ? 'on' : '',
            'aria-selected': String(t === cur),
            'data-focus': 'pane:' + t.id,
            title: t.title,
            onclick: () => {
                if (t === cur) return;
                this.paneTabs[key] = t.id;
                this.redrawDesk();
            },
        }, [t.label, t.n === null || t.n === undefined ? null : spEl('span', { class: 'c', text: count(t.n) })])));
        if (cur.id === 'plan' && take && key !== 'items') {
            bar.appendChild(spEl('span', { class: 'sp' }));
            bar.appendChild(take);
        }
        pane.appendChild(bar);
        const body = spEl('div', { class: 'pb tpb' }, cur.nodes.filter(Boolean));
        pane.appendChild(body);
        // The buttons along the foot: what to do next with this trade, in every tab.
        if (parts && (key !== 'items' || cur.id === 'plan')) {
            parts.acts.classList.add('foot');
            pane.appendChild(parts.acts);
        }
        // A press in the trade itself (never in a tab of who sells or who pays) holds it on show.
        if (parts && parts.wire) {
            const own = ['plan', 'send'].includes(cur.id) ? [pane.firstChild, body] : [pane.firstChild];
            if (key === 'items') own.splice(0, 1);
            for (const el of own) parts.wire(el);
            if (parts.acts.isConnected || pane.contains(parts.acts)) parts.wire(parts.acts);
        }
        box.appendChild(pane);
    }

    /** A tick you can press (a checkbox drawn as the drawing's tick). */
    tickBox(checked, label, focus, onChange, title = null) {
        const input = spEl('input', { type: 'checkbox', class: 'tick', 'aria-label': label, 'data-focus': focus, title });
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        return input;
    }

    /**
     * A how-many box: what is there is selected when you enter it; Enter or leaving it saves, Esc puts
     * back what was there; anything that is not a whole number is refused in place, and said.
     */
    qtyBox(value, label, focus, onSet) {
        const input = spEl('input', { type: 'text', class: 'qty', inputmode: 'numeric', value: String(value), 'aria-label': label, 'data-focus': focus, autocomplete: 'off', spellcheck: 'false' });
        selectOnFocus(input);
        // Just refused, and the panel drawn again since: still said.
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
        // Saved once focus has moved on (Tab to the next box keeps you there), and the panel catches up
        // with what it held back while you were in the box.
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
    }

    /**
     * The flip plan as ONE trade with one trader (mockup N3, the owner's pick; drawn bazaar by bazaar
     * since 3.25.0): every item in it under the bazaar it is bought from - a tick to leave an item out
     * and a number to change how many, on the item's first line - then what you hold that they pay more
     * for than you paid, what else they buy, and Ask / said yes / said no.
     * @returns {{left: Node[], right: Node[], acts: Node, wire: function}}
     */
    tradePlan(d) {
        const T = d.trade;
        const c = T.chosen;
        const b = c.buyer;
        const approx = c.estimated ? '≈ ' : '';
        const now = Date.now();
        const pinnedTrade = c.hold && c.hold.pinned;
        const itemPinned = (this.state.pinned || []).some((x) => x.itemId === String(d.itemId));
        const pin = spEl('button', {
            type: 'button',
            class: 'pin' + (itemPinned ? ' on' : ''),
            'aria-pressed': String(itemPinned),
            'data-focus': 'trade:pin',
            'aria-label': (itemPinned ? 'Unpin' : 'Pin') + ' this trade',
            title: itemPinned ? 'Pinned on top of the list and in Trades: press to unpin' : 'Keep this trade on top of the list and in Trades: only its prices move',
            onclick: () => this.h.onPin && this.h.onPin(d.itemId),
        }, [bdIcon('pin')]);
        const left = [
            this.whoBox(d, b, 'Trade with', {
                // Held (you started on it) or pinned: the items stay, prices and profit are live.
                tag: c.hold ? { text: c.hold.pinned ? 'Pinned' : 'Held', title: 'The items stay as they are; prices and profit are live' } : null,
                extra: [pin],
            }),
            spEl('div', { class: 'bigrow' }, [
                spEl('div', {}, [spEl('span', { class: 'lbl', text: 'Profit' }), spEl('div', { class: 'big' + this.moneyTone(c.profit), text: approx + signed(c.profit) })]),
                spEl('div', { class: 'eq' }, ['Total cost', spEl('b', { text: formatMoney(c.cost) }), spEl('br'), 'You get', spEl('b', { text: approx + formatMoney(c.pays) })]),
            ]),
            this.stepBar(this.askedNow(d) ? 1 : 0),
        ];
        const note = (cls, children) => left.push(spEl(cls === 'amber' ? 'div' : 'p', { class: cls }, children));
        if (c.payCapped) {
            const nw = b.id && this.state.networth ? this.state.networth.get(String(b.id)) : null;
            note('note', [b.name + ' can pay at most ' + (this.state.prefs.networthPct || 10) + '% of their networth' + (nw >= 0 && nw !== null ? ' (' + formatMoney(nw) + ')' : '') + ' for the whole trade: it stops there.']);
        }
        // Held with a trader who is not on this item's list now (3.25.0): the trade stays, and says what it is.
        if (c.away) note('amber', [spEl('span', {}, [spEl('b', { text: b.name + ' is not on the list of buyers for ' + d.name + ' now.' }), ' This trade is shown as you held it: check their list before buying.'])]);
        // Another trader's whole trade makes more now (3.25.0): said here, never swapped in under you.
        if (T.better && !c.hold) {
            note('amber', [
                spEl('span', {}, [spEl('b', { text: T.better.name + '\'s whole trade makes ' + formatMoney(T.better.more) + ' more now.' }), ' This plan stays with ' + b.name + ' until you change it.']),
                spEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'trade:better:' + T.better.key, title: 'Plan the trade with ' + T.better.name + ' instead', text: 'Plan with ' + T.better.name, onclick: (event) => {
                    event.stopPropagation();
                    if (this.h.onTradePick) this.h.onTradePick(d.itemId, T.better.key);
                } }),
            ]);
        }
        // One trade takes 10,000 items (3.23.0): the plan stops there, and says so.
        if (c.unitsCapped) note('note', [count(c.units) + ' of ' + count(TRADE_MAX_UNITS) + ' items: one trade takes no more, so this one stops there. The rest is for a second trade with ' + b.name + '.']);
        // Another item makes the most with this trader: it is the main flip, this one is cover.
        // Everything they buy: no main flip and cover - each line is a flip of its own.
        const mainRow = c.main && !c.every ? c.flips.find((r) => r.itemId === String(c.main)) : null;
        if (mainRow && mainRow.itemId !== String(d.itemId) && c.flips.some((r) => r.itemId === String(d.itemId))) {
            note('note', ['Main: ', spEl('b', { text: mainRow.name + ' ' + signed(mainRow.profit) }), ' · ' + d.name + ' is cover']);
        }
        // Planned with a trader who makes no flip on this item: said, with the numbers.
        if (c.itemNote) {
            const n = c.itemNote;
            const why = {
                type: 'weapons, armour and cars are one of a kind - not flipped',
                never: 'its category is in Settings › Flips and reading › Never flip',
                profit: 'under your least profit per item',
                none: 'no bazaar sells it under their price',
                cash: 'your Cash went to the other items',
            }[n.why] || 'not a flip with your settings';
            note('note', [spEl('b', { text: d.name + ' is not in this trade:' }), ' ' + b.name + ' pays ' + formatMoney(n.bid) + (n.cheapest ? ', the cheapest bazaar is ' + formatMoney(n.cheapest) : '') + ' - ' + why + '.']);
        }
        // Main flip and a few extras, or everything this trader buys. A pinned trade stays as pinned.
        const takeBtn = (label, every, title) => spEl('button', {
            type: 'button',
            class: Boolean(c.every) === every ? 'on' : '',
            'aria-pressed': String(Boolean(c.every) === every),
            'data-focus': 'trade:every:' + (every ? 'all' : 'main'),
            disabled: pinnedTrade ? '' : null,
            title: pinnedTrade ? 'Pinned as it is: unpin it to plan it another way' : title,
            text: label,
            onclick: () => Boolean(c.every) !== every && this.h.onTradeEvery && this.h.onTradeEvery(d.itemId, c.key, every),
        });
        left.push(spEl('div', { class: 'take' }, [
            spEl('span', { text: 'Take' }),
            spEl('div', { class: 'seg' }, [
                takeBtn('Main flip and extras', false, 'The flip you picked and a few more they buy (Settings › Extras per trade)'),
                takeBtn('Everything ' + b.name + ' buys', true, 'Every item ' + b.name + ' buys that a bazaar sells for less: up to your Cash, what they can pay and the ' + count(TRADE_MAX_UNITS) + ' items one trade takes'),
            ]),
            spEl('span', { class: 'sp' }),
            spEl('span', { text: c.stops ? count(c.stops) + (c.stops === 1 ? ' bazaar' : ' bazaars') + ' · about ' + c.minutes + ' min' : 'Nothing to buy: all yours' }),
        ]));

        const edit = (id, e) => this.h.onTradeEdit && this.h.onTradeEdit(c.key, id, e);
        // You typed more than bazaars list (mockup R-inputs): the plan takes what there is, and says so.
        const cutNote = (r) => {
            const t = this.typedQty;
            if (!t || t.itemId !== r.itemId || Date.now() - t.at > 8000) return null;
            const got = r.plannedUnits || r.units;
            if (!(t.n > got)) return null;
            return spEl('small', { class: 'warnw', role: 'status', text: count(got) + ' listed - ' + count(t.n) + ' is more than bazaars have' });
        };
        // A held trade's step against the bazaar now: re-priced, fewer left, gone.
        const mark = (st) => {
            const k = st.check && st.check.state;
            if (k === 'price') return spEl('span', { class: 'warnw', text: ' · now ' + formatMoney(st.price) + ' (was ' + formatMoney(st.planned) + ')' });
            if (k === 'short') return spEl('span', { class: 'warnw', text: ' · only ' + count(st.qty) + ' left of ' + count(st.plannedQty) });
            if (k === 'gone') return spEl('span', { class: 'badw', text: ' · gone' });
            return null;
        };
        // Bazaar by bazaar, in the order the plan visits them: each line is one item bought there.
        const stops = [];
        const stopOf = new Map();
        for (const r of c.flips) {
            r.steps.forEach((st, k) => {
                const key = st.sellerId ? 'id:' + st.sellerId : 'read';
                if (!stopOf.has(key)) {
                    stopOf.set(key, { key, sellerId: st.sellerId || null, sellerName: st.sellerName, lines: [] });
                    stops.push(stopOf.get(key));
                }
                stopOf.get(key).lines.push({ r, st, first: k === 0, many: r.steps.length > 1 });
            });
        }
        const line = ({ r, st, first, many }, j) => {
            const isMain = !c.every && c.main && r.itemId === String(c.main);
            const here = r.itemId === String(d.itemId);
            const qty = st.check && st.check.state === 'gone' ? st.plannedQty : st.qty;
            const price = st.check && st.check.state === 'price' ? st.planned : st.price;
            const made = (r.bid - price) * qty;
            const box = first ? this.qtyBox(r.plannedUnits || r.units, 'How many ' + r.name, 'trade:qty:' + r.itemId, (n) => {
                // Remembered for a moment: more than bazaars have is cut down, and said.
                this.typedQty = { itemId: r.itemId, n, at: Date.now() };
                edit(r.itemId, n > 0 ? { qty: n } : { off: true });
            }) : null;
            const at = first ? '' : ':' + (st.sellerId || 'read');
            return spEl('div', { class: 'pl' }, [
                first ? this.tickBox(true, 'Include ' + r.name, 'trade:tick:' + r.itemId, (yes) => edit(r.itemId, yes ? null : { off: true }), 'Untick to leave it out') : spEl('span'),
                this.pic('trade-buy' + at, r.itemId),
                spEl('span', {}, [
                    this.itemLink(r.itemId, r.name, 'trade:name:' + r.itemId + at),
                    ' × ',
                    box && !many ? box : count(qty),
                    box && many ? spEl('small', { title: 'How many in all, over every bazaar' }, ['of ', box]) : null,
                    spEl('small', {}, [st.sellerId ? 'at ' + formatMoney(price) : '≈ from ' + formatMoney(st.price), mark(st), first && r.noBid ? spEl('span', { class: 'warnw', text: ' · not on their list now' }) : null,
                        // 3.29.0 - a held line whose price check lapsed keeps the last checked price, and says how long ago that was.
                        first && r.lapsed ? spEl('span', { class: 'warnw', title: b.name + '\'s ' + formatMoney(r.bid) + ' for it is the last price that was checked. Refresh reads their list now.', text: ' · price ' + (r.lapsed.at ? 'checked ' + formatAge(now - r.lapsed.at) : 'not checked yet') }) : null,
                        // Their list has a bulk price for it (3.29.0): shown, in no sum.
                        first && r.bulk ? spEl('span', { class: 'warnw', title: 'Their list pays another price from that count up. The sums here use ' + formatMoney(r.bid) + ' each: check their list before a big trade.', text: ' · bulk price from ' + count(r.bulk.from) + ': ' + formatMoney(r.bulk.price) }) : null]),
                    first ? (isMain ? spEl('span', { class: 'here', text: 'MAIN' }) : here && !c.every ? spEl('span', { class: 'here', text: 'THIS ITEM' }) : this.kindTag(r.kind)) : null,
                    // 2026-10-16: an item whose price is only on their TornExchange list says so on its own line.
                    first && r.teOnly ? ' ' : null,
                    first && r.teOnly ? this.link('TE only', tePriceListUrl(b.teName || b.name), { cls: 'tag w te-pulse', title: b.name + '\'s price for ' + r.name + ' is only on TornExchange, which cannot say whether their list is open: press to look at their list before you trade', focus: 'trade:te-only:' + r.itemId }) : null,
                    // A space before it: "at $370" and "bazaar" never run together (engines plan 4c).
                    j > 0 && st.sellerId ? ' ' : null,
                    j > 0 && st.sellerId ? this.link('bazaar', bazaarUrl(st.sellerId, r.itemId, st.price), { cls: 'quiet lk', title: 'Opens their bazaar at this item and the price', focus: 'trade:bazaar:' + r.itemId + ':' + st.sellerId }) : null,
                    first ? cutNote(r) : null,
                ]),
                spEl('span', { class: 'p' + (made < 0 ? ' badw' : '') }, [(r.estimated ? '≈ ' : '') + signed(made)]),
            ]);
        };
        const route = spEl('div', { class: 'route' });
        stops.forEach((stop, i) => {
            const l0 = stop.lines[0];
            const seen = stop.lines.map((x) => Number(x.st.seenAt) || 0).filter((t) => t > 0);
            const name = stop.sellerName || 'Player ' + stop.sellerId;
            route.appendChild(spEl('div', { class: 'rt' }, [
                spEl('span', { class: 'stop-n', text: String(i + 1) }),
                spEl('div', {}, [
                    spEl('div', { class: 'rt-h' }, stop.sellerId ? [
                        this.playerName(name, stop.sellerId, 'trade:seller:' + stop.sellerId),
                        seen.length ? spEl('span', { class: 'seen', title: 'When TornW3B last saw these listings', text: 'seen ' + formatAge(now - Math.min(...seen)) }) : null,
                        spEl('span', { class: 'st' }),
                        this.link('bazaar', bazaarUrl(stop.sellerId, l0.r.itemId, l0.st.price), { cls: 'quiet lk', title: 'Opens ' + name + '\'s bazaar at the item and the price', focus: 'trade:bazaar:' + l0.r.itemId + ':' + stop.sellerId }),
                    ] : [spEl('b', { text: 'Still being read' }), spEl('span', { class: 'seen', text: 'TornW3B\'s lowest price stands in until its bazaars are read' })]),
                    ...stop.lines.map(line),
                ]),
            ]));
        });
        // Yours: what you bought to resell (the To sell page), where this trader pays more than you paid.
        if (c.held.length) {
            route.appendChild(spEl('div', { class: 'rt' }, [
                spEl('span', { class: 'stop-n', text: '★' }),
                spEl('div', {}, [
                    spEl('div', { class: 'rt-h' }, [spEl('b', { text: 'Yours to sell' }), spEl('span', { class: 'seen', text: b.name + ' pays more than you paid' })]),
                    ...c.held.map((r) => {
                        const give = (n) => this.h.onTradeHeld && this.h.onTradeHeld(r.itemId, r.held, n, c.key);
                        const on = r.units > 0;
                        return spEl('div', { class: 'pl' + (on ? '' : ' off') }, [
                            this.tickBox(on, 'Include your ' + r.name, 'trade:htick:' + r.itemId, (yes) => give(yes ? r.held : null), 'Untick to keep it'),
                            this.pic('trade-yours', r.itemId),
                            spEl('span', {}, on
                                ? [spEl('b', { text: r.name }), ' × ', this.qtyBox(r.units, 'How many of your ' + r.name, 'trade:hqty:' + r.itemId, give), spEl('small', { text: 'of ' + count(r.held) + ' at ' + formatMoney(r.bid) + ' each' + (r.kept ? ' · keeping ' + (r.kept === 'all' ? 'all' : count(r.kept)) : '') + (r.units < r.spare && !r.kept && !c.payCapped ? ' · a normal amount' : '') })]
                                : [spEl('b', { text: r.name }), spEl('small', { text: 'kept · you hold ' + count(r.held) })]),
                            spEl('span', { class: 'p' + (on ? '' : ' none0'), text: on ? formatMoney(r.units * r.bid) : '–' }),
                        ]);
                    }),
                ]),
            ]));
        }
        // Yours, at a price of theirs that is not checked (3.29.0): listed, in no sum - it joins once the price is confirmed.
        if ((c.heldWaiting || []).length) {
            route.appendChild(spEl('div', { class: 'rt' }, [
                spEl('span', { class: 'stop-n', text: '…' }),
                spEl('div', {}, [
                    spEl('div', { class: 'rt-h' }, [spEl('b', { text: 'Yours, waiting for a price check' }), spEl('span', { class: 'seen', text: 'not counted until ' + b.name + '\'s price is confirmed' })]),
                    ...c.heldWaiting.map((r) => spEl('div', { class: 'pl off' }, [
                        spEl('span'),
                        this.pic('trade-yours-wait', r.itemId),
                        spEl('span', {}, [spEl('b', { text: r.name }), ' × ' + count(r.held), spEl('small', { title: 'Not checked: ' + this.uncheckedWhy(r.check), text: 'their list says ' + formatMoney(r.bid) + ' each · not checked' })]),
                        spEl('span', { class: 'p none0', text: '–' }),
                    ])),
                ]),
            ]));
        }
        // Left out by you: back in with its tick.
        for (const r of c.off) {
            route.appendChild(spEl('div', { class: 'pl off' }, [
                this.tickBox(false, 'Include ' + r.name, 'trade:tick:' + r.itemId, (yes) => edit(r.itemId, yes ? null : { off: true }), 'Tick to put it back'),
                this.pic('trade-off', r.itemId),
                spEl('span', {}, [spEl('b', { text: r.name }), spEl('small', { text: 'left out of this trade' })]),
                spEl('span', { class: 'p none0', text: '–' }),
            ]));
        }
        // Was in this trade, is not now: said, never just gone (the friend lost track of what to buy when rows vanished mid-trade).
        for (const r of c.gone || []) {
            route.appendChild(spEl('div', { class: 'pl off' }, [
                spEl('span', { class: 'warnw', text: '!' }),
                this.pic('trade-gone', r.itemId),
                spEl('span', {}, [spEl('b', { text: r.name }), spEl('small', { text: c.unitsCapped ? 'no longer in the trade: it is full at ' + count(TRADE_MAX_UNITS) + ' items' : 'no longer in the trade: no bazaar sells it under ' + b.name + '\'s price now (bought, or re-priced), or your Cash went to the others' })]),
                spEl('span', { class: 'p none0', text: '–' }),
            ]));
        }
        const right = [];
        if (this.bd.page === 'trades') right.push(spEl('div', { class: 'lbl', text: 'The plan · prices can still move until they say yes' }));
        if (route.children.length) right.push(route);
        // What else they buy, left out so the buying stays quick: listed on a press, each with Add (the owner:
        // "5 extra items, not max, but soft cap"). What does not fit this trade is counted in one line (3.23.0).
        const fits = (c.left || []).length;
        const hidden = c.leftHidden || 0;
        if (!fits && hidden) {
            right.push(spEl('p', { class: 'note', text: leftHiddenText(b.name, 0, hidden) }));
        } else if (c.more > 0) {
            const open = this.showLeft === c.key;
            right.push(spEl('p', { class: 'note' }, [
                b.name + ' buys ' + count(c.more) + (c.more === 1 ? ' more item' : ' more items') + ', left out to keep it quick. ',
                this.wordBtn(open ? 'Hide ' + (c.more === 1 ? 'it' : 'them') : 'Show ' + (c.more === 1 ? 'it' : 'them'), 'trade:left', '', () => {
                    this.showLeft = open ? null : c.key;
                    this.redrawDesk();
                }),
                // Add all (the friend, 2026-09-29): every one of them in one press, past Extras per trade.
                fits > 1 ? ' · ' : null,
                fits > 1 ? this.wordBtn('Add all ' + count(fits), 'trade:addall', 'Put every item ' + b.name + ' buys into this trade (more bazaars to visit)', () => this.h.onTradeAddAll && this.h.onTradeAddAll(c.key, c.left.map((r) => ({ itemId: r.itemId, units: r.units })))) : null,
            ]));
            if (open) {
                right.push(spEl('div', { class: 'leftrows' }, (c.left || []).map((r) => spEl('div', { class: 'pl noti' }, [
                    spEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'trade:add:' + r.itemId, 'aria-label': 'Add ' + r.name + ' to the trade', text: 'Add', onclick: () => edit(r.itemId, { qty: r.units }) }),
                    spEl('span', {}, [this.pic('trade-left', r.itemId), spEl('b', { text: r.name }), this.kindTag(r.kind), spEl('small', { text: 'from ' + formatMoney(r.price) + ' · ' + b.name + ' pays ' + formatMoney(r.bid) })]),
                    spEl('span', { class: 'p', text: '≈ ' + signed(r.profit) }),
                ]))));
            }
            if (hidden) right.push(spEl('p', { class: 'note', text: leftHiddenText(b.name, fits, hidden) }));
        }
        const kept = Object.entries(T.keep || {});
        if (kept.length) {
            const nameOf = this.state.itemNameOf || ((id) => 'Item ' + id);
            right.push(spEl('p', { class: 'note', text: 'Kept for yourself: ' + kept.map(([id, k]) => nameOf(id) + ' ' + (k === 'all' ? '(all)' : count(k))).join(' · ') + '. Change it in Settings › Flips and reading.' }));
        }
        // How old their prices are: amber once the list itself is old, or their two lists disagree.
        const old = d.oldLists && d.oldLists[c.key] ? d.oldLists[c.key] : null;
        const ages = [];
        if (b.te && T.teAt) ages.push('TornExchange ' + formatAge(now - T.teAt));
        if (b.w3b && T.w3bAt) ages.push('TornW3B ' + formatAge(now - T.w3bAt));
        // 3.29.0 - their list is read at the press of a deal (picking it, Plan trade, said yes): said while it is
        // out, and for a minute after what the read found.
        const LC = T.listCheck || {};
        const refresh = b.id ? this.wordBtn('Refresh', 'trade:check', 'Reads ' + b.name + '\'s price list on TornW3B now', () => this.h.onTraderCheck && this.h.onTraderCheck(d.itemId, c.key)) : null;
        if (LC.reading) right.push(spEl('p', { class: 'note', role: 'status', text: LC.waitingYes ? 'Checking ' + b.name + '\'s list is open before the yes is written down…' : 'Checking ' + b.name + '\'s list…' }));
        else if (LC.open && LC.open.state !== 'open' && now - LC.open.at < 3 * 60 * 1000) {
            right.push(spEl('div', { class: 'amber', role: 'status' }, [spEl('span', {}, [spEl('b', { text: LC.open.state === 'closed' ? b.name + '\'s list is closed.' : 'Couldn\'t confirm ' + b.name + '\'s list is open.' }), ' Checked ' + this.checkAge(now - LC.open.at) + ' · no trade on it. ']), refresh]));
        } else if (LC.readAt && now - LC.readAt < 60000) {
            right.push(spEl('p', { class: 'note', role: 'status' }, [
                spEl('b', { text: 'Price list read ' + this.checkAge(now - LC.readAt) + '.' }),
                LC.changed === null ? '' : LC.changed > 0 ? ' ' + this.plural(LC.changed, 'price') + ' of theirs had changed: this trade is priced with the list as it is now.' : ' None of their prices had changed.',
            ]));
        }
        if (c.lapsed > 0 && !LC.reading) {
            right.push(spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: this.plural(c.lapsed, 'price') + ' in this trade ' + (c.lapsed === 1 ? 'is' : 'are') + ' not checked now.' }), ' Each keeps the last price that was checked, and says when. ']), refresh]));
        }
        if (old) right.push(spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: 'Check ' + b.name + '\'s list before you buy.' }), ' Their prices were last changed ' + listAgeText(now - old.at) + '.'])]));
        else if (ages.length && !LC.reading && !(LC.readAt && now - LC.readAt < 60000)) right.push(spEl('p', { class: 'note', text: b.name + '\'s prices were read from ' + ages.join(', ') + '. Check their list before you buy.' }));
        if (b.differ) right.push(spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: b.name + '\'s lists differ' }), ' (' + this.listPrices(b, ', ') + '): planned at the lower.'])]));

        // In the order you do it: ask them, then their answer. "Said no" passes this trade over for an hour.
        const acts = spEl('div', { class: 'acts' }, [
            this.chatLink(b, 'btn go big out', { itemId: d.itemId, key: c.key }),
            // (3.29.0: their price list is read first - a few seconds - and the yes is written with the prices as just read.)
            spEl('button', { type: 'button', class: 'btn big', 'data-focus': 'trade:accept:' + c.key, disabled: LC.waitingYes ? '' : null, title: b.name + ' said yes: their price list is read first (a few seconds), then the trade is frozen as it is, so nothing in it moves while you buy and send. It moves to Trades.', text: LC.waitingYes ? 'Reading their list…' : b.name + ' said yes', onclick: () => this.h.onTradeAccept && this.h.onTradeAccept(d.itemId) }),
            // Nothing to buy: the trade itself can be opened now.
            !c.stops && b.id ? this.tradeLink(b, 'btn big out', { itemId: d.itemId, key: c.key }, 'step-trade') : null,
            spEl('span', { class: 'sp' }),
            this.wordBtn(b.name + ' said no', 'trade:decline:' + c.key, b.name + ' said no to this trade: on to the next (this trade is passed over for an hour; their other trades stay). Undo shows on their row.', () => this.h.onTradeDecline && this.h.onTradeDecline(c.key), 'quiet'),
        ]);
        const wire = (el) => {
            // Anything you do here pins the page to this item and this trader, so the plan cannot move
            // away while you buy and trade.
            el.addEventListener('click', (event) => {
                const t = event.target;
                if (t && t.closest && t.closest('a, button, input, label') && this.h.onTradePin) this.h.onTradePin(d.itemId, c.key);
            }, true);
            // Ask, or the trade's own link: you asked - the trade waits for their yes in Trades (3.22.0).
            const asked = (event) => {
                const a = event.target && event.target.closest ? event.target.closest('a') : null;
                if (a && (a.classList.contains('sp-chat') || a.dataset.focus === 'step-trade') && this.h.onTradeAsked) this.h.onTradeAsked(d.itemId, c.key);
            };
            el.addEventListener('click', asked, true);
            el.addEventListener('auxclick', asked, true);
        };
        return { left, right, acts, wire, n: (c.stops || 0) + c.held.filter((r) => r.units > 0).length };
    }

    /**
     * A trade the trader said yes to: frozen, so nothing in it moves. Bazaar by bazaar, each buy is
     * checked against the bazaar now (still there, re-priced, fewer left, gone) with a tick for bought;
     * then each item a tick for sent - the same list shows in the panel on Torn's trade page. One thing to
     * press next, always in the same place: the next bazaar, then the trade, then Traded.
     * @returns {{left: Node[], right: Node[], acts: Node}}
     */
    acceptedPlan(d) {
        const A = d.trade.accepted;
        const b = A.buyer;
        const now = Date.now();
        const done = (st) => st.bought || st.skipped || st.boughtQty > 0;
        // Only items with something to send count (review: "sent 0 of 2" counted a skipped one).
        const skippedAll = (i) => i.kind !== 'yours' && (i.steps || []).length > 0 && i.steps.every((st) => st.skipped && !st.bought && !(st.boughtQty > 0));
        const toSend = A.items.filter((i) => !skippedAll(i));
        const sent = toSend.filter((i) => i.sent).length;
        const tot = A.totals || { pays: A.pays, cost: A.cost, profit: A.profit };
        const open = tot.toBuy || { cost: 0, pays: 0 };
        const kept = tot.left || { cost: 0 };
        const steps = A.items.flatMap((i) => i.steps || []);
        const left0 = steps.filter((st) => !done(st)).length;
        // A buy skipped is not a buy done: each is counted as what it is.
        const boughtN = steps.filter((st) => st.bought || st.boughtQty > 0).length;
        const skippedN = steps.filter((st) => st.skipped && !st.bought && !(st.boughtQty > 0)).length;
        const inTrade = toSend.length ? sent + ' of ' + this.plural(toSend.length, 'line') + ' in Torn\'s trade' : 'nothing to send';
        const left = [
            this.whoBox(d, b, 'said yes ' + formatAge(now - A.at), { focus: 'acc:buyer' }),
            spEl('div', { class: 'bigrow' }, [
                // What the trade comes to now (planned prices until you buy, then what you took). A zero is never green.
                spEl('div', {}, [spEl('span', { class: 'lbl', text: 'Profit' }), spEl('div', { class: 'big' + this.moneyTone(tot.profit), text: signed(tot.profit) })]),
                // The two sums are of the same items, so they come to the profit beside them (3.26.0); what is
                // not in them yet, or no longer, has a line of its own.
                spEl('div', { class: 'eq' }, ['Total cost', spEl('b', { text: formatMoney(tot.cost) }), spEl('br'), 'You get', spEl('b', { text: formatMoney(tot.pays) }),
                    ...(tot.own > 0 ? [spEl('br'), 'of it for your own items', spEl('b', { text: formatMoney(tot.own) })] : []),
                    ...(open.cost > 0 ? [spEl('br'), 'Still to buy', spEl('b', { title: 'Bazaars of this trade you have not been to yet: not paid, and not counted above until you buy', text: formatMoney(open.cost) + ' (' + signed(open.pays - open.cost) + ')' })] : []),
                    ...(kept.cost > 0 ? [spEl('br'), 'Left with you', spEl('b', { title: 'Bought and not taken by ' + b.name + ': it goes to To sell, and is not a loss of this trade', text: formatMoney(kept.cost) })] : []),
                    // It no longer comes to what they said yes to (a buy skipped, dropped or re-priced): said once, here.
                    ...(A.profit > 0 && Math.round(A.profit) !== Math.round(tot.profit + open.pays - open.cost) ? [spEl('br'), 'Planned at their yes', spEl('b', { text: signed(A.profit) })] : [])]),
            ]),
            this.stepBar(left0 ? 2 : 3),
            spEl('p', { class: 'note', text: steps.length
                ? count(boughtN) + ' of ' + this.plural(steps.length, 'buy') + ' done' + (skippedN ? ' · ' + count(skippedN) + ' skipped' : '') + (left0 ? ' · about ' + Math.max(1, Math.round(left0 / 2)) + ' min left' : boughtN ? ' · now the trade' : ' · nothing bought') + ' · ' + inTrade
                : 'Nothing to buy: send yours · ' + inTrade }),
        ];
        // 3.29.0 - their price list was read as you pressed "said yes": what that read found, once, here.
        const PC = A.priceCheck || null;
        if (PC && !PC.confirmed) left.push(spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: 'No TornW3B list to check.' }), ' ', this.teWarn(b)])]));
        else if (PC && PC.changed > 0) left.push(spEl('p', { class: 'note', text: 'Open at the yes · ' + this.plural(PC.changed, 'price') + ' had changed: written down at the new prices.' }));
        else if (PC && PC.confirmed) left.push(spEl('p', { class: 'note', text: 'Open at the yes · prices confirmed.' }));
        // 3.33.0 - their list, read again since the yes, pays less for a line now (or not at all): said before more is bought.
        const dropped = A.items.filter((i) => i.since && (i.since.state === 'lower' || i.since.state === 'gone') && !i.sent);
        if (dropped.length) {
            left.push(spEl('div', { class: 'amber' }, [spEl('span', {}, [
                spEl('b', { text: b.name + '\'s list pays less now.' }),
                ' ' + dropped.map((i) => i.name + ' ' + (i.since.state === 'gone' ? 'not on it' : formatMoney(i.since.price)) + ' (' + formatMoney(i.bid) + ' at the yes)').join(' · ') + '. Ask them before you buy more.',
            ])]));
        }
        // Its items against the 10,000 one trade takes (3.23.0): said from nine tenths of it.
        const cv = countView(A.count, b.name);
        if (cv && cv.say) left.push(cv.state === 'full' ? spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: cv.text + ' items.' }), ' ' + cv.say])]) : spEl('p', { class: 'note', text: cv.text + ' items. ' + cv.say }));

        const words = {
            ok: (c) => 'still listed' + (c.seenAt ? ' · seen ' + formatAge(now - c.seenAt) : ''),
            price: (c, st) => 'now ' + formatMoney(c.price) + (c.price < st.price ? ' - cheaper' : ' - dearer'),
            short: (c) => 'only ' + count(c.qty) + ' left',
            gone: () => 'gone from their bazaar',
            unknown: () => 'checking…',
            bought: () => 'bought',
        };
        const right = [];
        // Buy: bazaar by bazaar. A tick says bought (by hand, if Torn Bids did not see the buy).
        const stops = [];
        const stopOf = new Map();
        for (const i of A.items) {
            (i.steps || []).forEach((st, k) => {
                const key = 'id:' + st.sellerId;
                if (!stopOf.has(key)) {
                    stopOf.set(key, { sellerId: st.sellerId, sellerName: st.sellerName, lines: [] });
                    stops.push(stopOf.get(key));
                }
                stopOf.get(key).lines.push({ i, st, k });
            });
        }
        // 3.32.0 - a trade that names its stops is drawn in the order Next walks it: its bazaars, the Item Market last.
        stops.sort((x, y) => stepRank(A, x.sellerId) - stepRank(A, y.sellerId));
        if (stops.length) {
            const cur = stops.find((s) => !s.lines.every((x) => done(x.st))) || null;
            const route = spEl('div', { class: 'route' });
            stops.forEach((stop, n) => {
                const all = stop.lines.every((x) => done(x.st));
                const skipped = stop.lines.every((x) => x.st.skipped && !x.st.bought && !(x.st.boughtQty > 0));
                const l0 = stop.lines.find((x) => !done(x.st)) || stop.lines[0];
                // 3.32.0 - a stop on the Item Market (a list made on Flips > For <the owner>): no player, no bazaar.
                const market = String(stop.sellerId) === OWNER_MARKET;
                const name = market ? OWNER_MARKET_NAME : stop.sellerName || 'Player ' + stop.sellerId;
                const kids = [spEl('div', { class: 'rt-h' }, [
                    market ? spEl('b', { text: name }) : this.playerName(name, stop.sellerId, 'acc:seller:' + stop.sellerId),
                    spEl('span', { class: 'st', text: skipped ? 'skipped' : all ? 'bought' : stop === cur ? 'next' : '' }),
                    all ? null : market
                        ? this.link('market', itemMarketUrl(l0.i.itemId, l0.i.name), { cls: 'quiet lk', title: 'Opens the Item Market at the item', focus: 'acc:bazaar:' + l0.i.itemId + ':' + l0.k })
                        : this.link('bazaar', bazaarUrl(stop.sellerId, l0.i.itemId, l0.st.price), { cls: 'quiet lk', title: 'Opens ' + name + '\'s bazaar at the item and the price', focus: 'acc:bazaar:' + l0.i.itemId + ':' + l0.k }),
                ])];
                for (const { i, st, k } of stop.lines) {
                    // Listed at another price now (cheaper included): over their price there is no profit; under it but
                    // under your least profit it is said so; with enough profit it is news, not something to look at.
                    const nowAt = st.check.state === 'price' && !st.bought ? st.check.price : null;
                    const nowEach = nowAt !== null ? i.bid - nowAt : 0;
                    const stillGood = nowAt !== null && nowEach > 0 && enoughProfit(nowEach, nowAt, 'TRADER', this.state.prefs.minProfitPct);
                    const thin = nowAt !== null && nowEach > 0 && !stillGood;
                    const bad = ['gone', 'price'].includes(st.check.state) && !st.bought && !stillGood;
                    kids.push(spEl('div', { class: 'pl' }, [
                        this.tickBox(st.bought, 'Bought ' + st.qty + ' ' + i.name + ' from ' + name, 'acc:bought:' + i.line + ':' + k, (yes) => this.h.onTradeTick && this.h.onTradeTick(A.key, i.line, { step: k, bought: yes }), 'Bought: tick it by hand if Torn Bids did not see the buy'),
                        this.pic('acc-buy:' + i.line + ':' + k, i.itemId),
                        spEl('span', {}, [spEl('b', { text: i.name }), ' × ' + count(st.qty), spEl('small', {}, ['at ' + formatMoney(st.price) + ' · ', spEl('span', { class: bad ? 'warnw' : '', text: st.skipped ? 'skipped' : st.boughtQty > 0 && !st.bought ? 'bought ' + count(st.boughtQty) + ' of ' + count(st.qty) : words[st.check.state](st.check, st) })])]),
                        spEl('span', { class: 'p' + (bad || (st.skipped && !st.bought) ? ' none0' : ''), text: signed((i.bid - st.price) * st.qty) }),
                    ]));
                    // Gone or re-priced: the next cheapest still under their price, or drop the line.
                    if (stillGood && !st.skipped) kids.push(spEl('p', { class: 'note', text: 'Now ' + formatMoney(nowAt) + (nowAt < st.price ? ', cheaper than planned: ' : ', dearer than planned, still over your least profit: ') + signed(nowEach * st.qty) + ' on this line.' }));
                    if (bad) {
                        kids.push(spEl('div', { class: 'amber' }, [
                            spEl('span', {}, [
                                spEl('b', { text: st.check.state === 'gone' ? 'Gone: no profit here any more.' : thin ? 'Now ' + formatMoney(nowAt) + ': ' + signed(nowEach) + ' a piece, under your least profit.' : 'Now ' + formatMoney(st.check.price) + ': no profit any more.' }),
                                st.repl ? ' Next cheapest: ' + count(st.repl.qty) + ' from ' + (st.repl.sellerName || 'Player ' + st.repl.sellerId) + ' at ' + formatMoney(st.repl.price) + '.' : thin ? ' No other bazaar sells it with enough profit now.' : ' No bazaar sells it under ' + b.name + '\'s price now.',
                            ]),
                            st.repl ? this.wordBtn('Use it', 'acc:repl:' + i.line + ':' + k, 'Buy this one instead', () => this.h.onTradeReplace && this.h.onTradeReplace(A.key, i.line, k, st.repl)) : null,
                            this.wordBtn('Drop it', 'acc:drop:' + i.line + ':' + k, 'Take ' + i.name + ' out of this trade', () => this.h.onTradeDrop && this.h.onTradeDrop(A.key, i.line)),
                        ]));
                    }
                }
                route.appendChild(spEl('div', { class: 'rt' + (skipped ? ' skip' : all ? ' done' : stop === cur ? ' cur' : '') }, [spEl('span', { class: 'stop-n', text: skipped ? '–' : all ? '✓' : String(n + 1) }), spEl('div', {}, kids)]));
            });
            right.push(spEl('div', { class: 'lbl', title: 'Next bazaar counts only what you took', text: 'Buy, bazaar by bazaar' }), route);
        }
        const buyParts = right.slice();
        // Into Torn's trade: a tick says sent. They took fewer: how many, kept to sell elsewhere at Traded.
        this.leftOpen = this.leftOpen || new Set();
        const sendBox = spEl('div', { class: 'route sec' });
        for (const i of A.items) {
            const send = i.send !== undefined ? i.send : i.units;
            const notTaken = Math.min(send, i.left || 0);
            const bought = i.kind === 'yours' || (i.steps || []).every(done);
            let leftCtl = null;
            const openKey = A.key + '|' + i.line;
            if (notTaken > 0 || this.leftOpen.has(openKey)) {
                // Same focus key as the button that opened it: the box takes the focus.
                const input = spEl('input', { type: 'text', class: 'qty', inputmode: 'numeric', value: notTaken > 0 ? String(notTaken) : '', placeholder: '0-' + send, 'aria-label': 'How many ' + i.name + ' ' + b.name + ' did not take (0 to ' + send + ')', 'data-focus': 'acc:left:' + i.line, autocomplete: 'off', spellcheck: 'false' });
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
                leftCtl = spEl('small', {}, [
                    input,
                    ' not taken' + (i.kind === 'flip' ? ' - kept to sell elsewhere · ' : ' · '),
                    this.wordBtn(notTaken > 0 ? 'They took all' : 'Cancel', 'acc:leftundo:' + i.line, '', () => {
                        this.leftOpen.delete(openKey);
                        if (notTaken > 0 && this.h.onTradeLeft) this.h.onTradeLeft(A.key, i.line, 0);
                        else this.redrawDesk();
                    }),
                ]);
            } else if (bought && send > 0 && !left0) {
                // Only once everything is bought: the trade is what is left to happen.
                leftCtl = this.wordBtn('They took fewer…', 'acc:left:' + i.line, b.name + ' did not take all of it: say how many, kept to sell elsewhere', () => {
                    this.leftOpen.add(openKey);
                    this.redrawDesk();
                });
            }
            const out = skippedAll(i);
            sendBox.appendChild(spEl('div', { class: 'pl' + (out ? ' off' : '') }, [
                this.tickBox(i.sent, 'Sent ' + i.name, 'acc:sent:' + i.line, (yes) => this.h.onTradeTick && this.h.onTradeTick(A.key, i.line, { sent: yes }), 'Sent: tick it by hand if Torn Bids did not see it go into the trade'),
                this.pic('acc-' + i.kind, i.itemId),
                spEl('span', {}, [
                    spEl('b', { text: i.name }), ' × ' + count(send - notTaken),
                    spEl('small', { text: formatMoney(i.bid) + ' each' + (i.kind === 'yours' ? ' · yours' : '') + (send !== i.units && i.kind !== 'yours' ? ' · planned ' + count(i.units) : '') }),
                    i.since && !i.sent && (i.since.state === 'lower' || i.since.state === 'gone') ? spEl('small', { class: 'warnw', text: ' · their list now ' + (i.since.state === 'gone' ? 'does not pay for it' : formatMoney(i.since.price)) }) : null,
                    leftCtl ? spEl('small', {}, [' ', leftCtl]) : null,
                ]),
                spEl('span', { class: 'p ' + (i.sent ? 'in' : out ? 'none0' : 'warn'), text: i.sent ? 'in the trade ✓' : out ? 'skipped' : bought ? 'add ' + count(send - notTaken) : 'buy it first' }),
            ]));
        }
        right.push(spEl('div', { class: 'lbl', text: 'Into Torn\'s trade · Fill all types these on the trade page' }), sendBox);
        const split = { buy: buyParts, send: right.slice(buyParts.length), nBuy: steps.length, nSend: toSend.length };

        // Cancel trade (the owner, 2026-09-29): they said yes, then it was called off - the plan goes. Asked first.
        if (this.cancelAsk === A.key) {
            const acts = spEl('div', { class: 'amber' }, [
                spEl('span', {}, [spEl('b', { text: 'Cancel the trade with ' + b.name + '?' }), ' This plan goes (they are not marked as having said no); what you already bought stays yours and goes to To sell.']),
                spEl('button', { type: 'button', class: 'btn sm bad', 'data-focus': 'acc:cancel-yes', text: 'Yes, cancel it', onclick: () => {
                    this.cancelAsk = null;
                    if (this.h.onTradeCancel) this.h.onTradeCancel(A.key);
                } }),
                this.wordBtn('Keep it', 'acc:cancel-no', '', () => {
                    this.cancelAsk = null;
                    this.redrawDesk();
                }),
            ]);
            return { left, right, acts, ...split };
        }
        const cur = [...steps].sort((x, y) => stepRank(A, x.sellerId) - stepRank(A, y.sellerId)).find((st) => !done(st)) || null;
        const curMarket = Boolean(cur) && String(cur.sellerId) === OWNER_MARKET;
        const acts = spEl('div', { class: 'acts' }, [
            left0
                ? spEl('button', { type: 'button', class: 'btn go big out', 'data-focus': 'acc:start', title: curMarket ? 'Opens the Item Market on Torn at the next piece to buy' : 'Opens the next bazaar on Torn: what to buy is marked there', text: curMarket ? 'Next: ' + OWNER_MARKET_NAME : 'Next bazaar' + (cur && cur.sellerName ? ': ' + cur.sellerName : ''), onclick: () => this.h.onTradeStartBuying && this.h.onTradeStartBuying(A.key) })
                : b.id ? this.tradeLink(b, 'btn go big out', { itemId: A.itemId, key: A.key }, 'acc:trade') : null,
            left0 ? null : spEl('button', { type: 'button', class: 'btn big', 'data-focus': 'acc:done', title: 'The trade went through: close it' + (A.items.some((i) => i.left > 0 && i.kind === 'flip') ? ', and keep what they did not take to sell elsewhere' : '') + '. Torn Bids marks it traded by itself when it sees the trade finish.', text: 'Traded', onclick: () => this.h.onTradeClose && this.h.onTradeClose(A.key, true) }),
            spEl('span', { class: 'sp' }),
            spEl('span', { class: 'quiets' }, [
                left0 ? this.wordBtn('Traded', 'acc:done', 'The trade went through: close it (what they did not take goes to To sell)', () => this.h.onTradeClose && this.h.onTradeClose(A.key, true), 'quiet') : null,
                this.wordBtn('Back to the live plan', 'acc:back', 'Unfreeze: back to the live plan (nothing is kept)', () => this.h.onTradeClose && this.h.onTradeClose(A.key, false), 'quiet'),
                this.wordBtn('Cancel trade', 'acc:cancel', 'They said yes, then the trade was called off: this plan goes (they are not marked as having said no)', () => {
                    this.cancelAsk = A.key;
                    this.redrawDesk();
                }, 'quiet'),
            ]),
        ]);
        return { left, right, acts, ...split };
    }

    /**
     * No trade with a trader is on show: the plain flip (buy from these bazaars, sell to this trader) when
     * there is one, else why there is none - in the numbers.
     */
    flipPlan(d) {
        const f = d.plan;
        const fb = f && f.units > 0 ? f.buyer || d.buyers[0] : null;
        const fbKey = fb ? (fb.id ? 'id:' + fb.id : 'name:' + String(fb.name).toLowerCase()) : null;
        const until = fbKey && d.trade && d.trade.declined ? d.trade.declined[fbKey] : null;
        const none = (text, more = null) => spEl('div', { class: 'plan' }, [spEl('span', { class: 'lbl', text: 'The trade' }), spEl('div', { class: 'none', text }), more ? spEl('p', { class: 'note', text: more }) : null]);
        if (until) return none(fb.name + ' said no (passed over for ' + formatAge(until - Date.now()).replace(' ago', '') + '). No other trader makes a trade on ' + d.name + ' now: Undo on their row, or pick another item.');
        if (f && f.units > 0) {
            const b = fb;
            const kids = [
                this.whoBox(d, b, 'Sell to', { focus: 'step-buyer' }),
                spEl('div', { class: 'bigrow' }, [
                    spEl('div', {}, [spEl('span', { class: 'lbl', text: 'Profit' }), spEl('div', { class: 'big', text: signed(f.profit) })]),
                    spEl('div', { class: 'eq' }, ['Total cost', spEl('b', { text: formatMoney(f.cost) }), spEl('br'), count(f.units) + ' flipped' + (f.available > f.units ? ' of ' + count(f.available) + ' under their price' : ''), spEl('b', { text: formatMoney(b.price) + ' each' })]),
                ]),
                spEl('div', { class: 'route' }, f.steps.map((st, i) => spEl('div', { class: 'rt' }, [
                    spEl('span', { class: 'stop-n', text: String(i + 1) }),
                    spEl('div', {}, [
                        spEl('div', { class: 'rt-h' }, [
                            this.playerName(st.sellerName || 'Player ' + st.sellerId, st.sellerId, 'step-seller:' + st.sellerId),
                            spEl('span', { class: 'st' }),
                            this.link('bazaar', bazaarUrl(st.sellerId, d.itemId, st.price), { cls: 'quiet lk', title: 'Opens their bazaar at this item and the price', focus: 'step-bazaar:' + st.sellerId }),
                        ]),
                        spEl('div', { class: 'pl noti' }, [this.pic('step:' + i, d.itemId), spEl('span', {}, [spEl('b', { text: d.name }), ' × ' + count(st.qty), spEl('small', { text: 'at ' + formatMoney(st.price) })]), spEl('span', { class: 'p', text: signed((b.price - st.price) * st.qty) })]),
                    ]),
                ]))),
            ];
            // Their networth capped the plan: say so, with the numbers.
            if (b.maxUnits && f.units >= b.maxUnits) {
                const nw = b.id && this.state.networth ? this.state.networth.get(String(b.id)) : null;
                kids.push(spEl('p', { class: 'note', text: b.name + ' can pay for at most ' + count(b.maxUnits) + ': ' + (this.state.prefs.networthPct || 10) + '% of their networth' + (nw >= 0 && nw !== null ? ' (' + formatMoney(nw) + ')' : '') + '.' }));
            }
            if (b.differ) kids.push(spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: b.name + '\'s lists differ' }), ' (' + this.listPrices(b, ', ') + '): planned at the lower. Check their list before trading.'])]));
            kids.push(spEl('div', { class: 'acts' }, [this.chatLink(b, 'btn go big out', { itemId: d.itemId, key: fbKey }), b.id ? this.tradeLink(b, 'btn big out', { itemId: d.itemId, key: fbKey }, 'step-trade') : null]));
            return spEl('div', { class: 'plan' }, kids);
        }
        let text;
        // 3.29.0: the best trader whose price is checked (it was the top row, checked or not, troll bid or not);
        // with none checked, the best believable one - and the sentence says its price is not checked.
        const real = d.buyers.filter((x) => !x.troll);
        const sure = real.find((x) => !x.check || x.check.ok) || null;
        const top = sure || real[0] || d.buyers[0];
        const p = this.state.prefs;
        const who = p.trustedOnly ? 'trusted buyer' : 'buyer';
        const pct = p.minProfitPct ?? 1;
        const fresh = d.sellers.rows.find((r) => !r.stale) || null;
        if (f && f.units === 0) text = 'One costs ' + formatMoney(f.needs) + ', more than your cash (' + formatMoney(p.cash) + ').';
        else if (d.planWhy === 'loading') text = 'Loading bazaars from TornW3B…';
        else if (!top) text = 'No flip: no ' + who + ' for this item.';
        else if (d.statItem) text = 'No flip: every copy is its own (weapons, armour, cars), and traders pay one price for one - nobody buys them by the hundred.';
        else if (!sure && top.check && !top.check.ok && !top.troll && fresh && top.price > fresh.price) text = 'No flip yet: ' + top.name + ' pays ' + formatMoney(top.price) + ', bazaar ' + formatMoney(fresh.price) + ', but that price is not checked: ' + this.uncheckedWhy(top.check.why) + '.';
        else if (d.sellers.rows.some((r) => !r.stale && r.price < top.price && top.price - r.price < Math.max(1, (r.price * pct) / 100))) text = 'No flip: ' + top.name + ' pays ' + formatMoney(top.price) + ' and the cheapest bazaar asks ' + formatMoney(fresh.price) + '. That leaves ' + formatMoney(top.price - fresh.price) + ' a piece, under your least profit of ' + pct + '%.';
        else if (d.sellers.rows.some((r) => !r.stale && r.price < top.price)) text = 'No flip: none of these buyers can take it at a profit (their price is over 3× the average, or their networth is too small).';
        else if (fresh) text = 'No flip: ' + top.name + ' pays ' + formatMoney(top.price) + '; the cheapest bazaar asks ' + formatMoney(fresh.price) + ', ' + formatMoney(fresh.price - top.price) + ' over it.';
        else if (d.sellers.rows.length) text = 'No flip: TornW3B has not seen these bazaars in the last 30 minutes.';
        else text = 'No flip: no bazaar is selling it.';
        // No flip on this item - but a trader's other items may still make a trade.
        return none(text, d.trade && !d.trade.chosen && d.buyers.length ? 'Press a trader under Traders pay to plan a trade with their other items.' : null);
    }

    /* ------------------------------------------------------ where to sell */

    /**
     * Where to sell your N: a trader now, or wait in your bazaar or on the Item Market - the one that
     * pays most first, marked Best. A place that gives no more than you paid is said so, and is no link
     * (3.22.0). For what you bought to resell: Not for sale, which keeps it out of every trade.
     */
    drawWhere(d) {
        const box = this.whereEl;
        box.textContent = '';
        box.hidden = !(d && d.held && d.where);
        if (box.hidden) return;
        const w = d.where;
        // 3.29.0 - the trader this counts is the best one whose price is CHECKED (it was the top row, checked or
        // not, troll bid or not). With none checked, the best believable one is named (`u`): muted, "not
        // checked", with their lists and Refresh - never Best, never a trade link.
        const b = w.trader || null;
        const u = b ? null : w.unchecked || null;
        const who = b || u;
        const n = d.held;
        // A trade with them is going already: the row points at it, and offers no second one.
        const going = who ? this.goingWith(d) : null;
        const folded = Boolean(going && this.planOnSide() && this.tradeKeyOnShow() === going[1].key);
        const rows = [
            { venue: 'trader', name: 'Trade to ' + (who ? who.name : 'a trader'), when: going ? (going[0] === 'waiting' ? 'you asked ' + who.name + ' · it waits for their yes' : 'a trade with ' + who.name + ' is going') + (folded ? ' · below' : '') : 'paid now, in one trade', url: b && b.id ? tradeUrl(b.id) : null, go: b ? 'Start a trade with ' + b.name : '', missing: 'No ' + (this.state.prefs.trustedOnly ? 'trusted ' : '') + 'trader buys it' },
            { venue: 'bazaar', name: 'Your bazaar', when: '$1 under the cheapest · paid when someone buys', url: MY_BAZAAR_ADD_URL, go: 'Add to your bazaar', missing: 'No bazaar listing to price against' },
            { venue: 'market', name: 'Item Market', when: 'after the 5% fee · paid when someone buys', url: MARKET_ADD_URL, go: 'List on the Item Market', missing: d.market.state === 'loading' ? 'Checking the Item Market…' : 'No Item Market listing to price against' },
        ].map((r) => {
            const o = w.options.find((x) => x.venue === r.venue) || null;
            const v = whereRowView(o, n, w.paid);
            return { ...r, o, v, each: v.known ? o.each : null, total: v.total };
        }).sort((x, y) => (y.venue === w.best) - (x.venue === w.best) || (y.total === null ? -1 : y.total) - (x.total === null ? -1 : x.total));
        const body = spEl('div', { class: 'pb' });
        for (const r of rows) {
            const { each, v } = r;
            const win = w.best === r.venue;
            // The words and the figure are for the same units (whereRowView): a loss never sits beside a plus.
            const { loss, part, gain } = v;
            const listAt = r.venue === 'bazaar' && each !== null ? ' at ' + formatMoney(each) : r.venue === 'market' && d.market.lowest > 1 ? ' at ' + formatMoney(d.market.lowest - 1) : '';
            // A listing counted for only the first N (as many as are listed near that price now): the rest go to the trader, and it says so.
            const rest = b ? (loss ? ' · the rest to the trader' : ', the rest to the trader') : '';
            // A trader named at a price that is not checked: what their list says, muted - and how to check it.
            const unsure = r.venue === 'trader' && each === null && u ? u : null;
            body.appendChild(spEl('div', { class: 'opt' + (win ? ' best' : '') + (each === null || loss ? ' dimo' : '') }, [
                spEl('span', { class: 'w' }, [
                    spEl('b', { text: r.name + listAt }),
                    win ? spEl('span', { class: 'badge best', text: 'Best' }) : null,
                    spEl('small', { text: unsure ? unsure.name + ' pays ' + formatMoney(unsure.price) + '. Not checked: ' + this.uncheckedWhy(unsure.why) + '.'
                        : each === null ? r.missing : loss ? 'No more than the ' + formatMoney(w.paid) + ' you paid: a loss' + (part ? ' on the first ' + count(v.units) + rest : '') : r.when + (part ? ' · first ' + count(v.units) + rest : '') }),
                ]),
                spEl('span', { class: 'v' }, unsure ? [spEl('b', { class: 't-muted', text: formatMoney(unsure.price * n) }), spEl('small', { class: 't-muted', text: 'not checked' })] : each === null ? [spEl('b', { text: '–' })] : [
                    spEl('b', { text: formatMoney(r.total) }),
                    gain !== null ? spEl('small', { class: gain <= 0 ? 'loss' : '', text: signed(gain) }) : n > 1 ? spEl('small', { class: 't-muted', text: formatMoney(each) + ' each' }) : null,
                ]),
                r.venue === 'trader' && going ? (folded ? spEl('span') : spEl('button', { type: 'button', class: 'btn', 'data-focus': 'where:going', title: 'The trade with ' + who.name + ' is on Trades', text: 'Open on Trades', onclick: () => this.showTrade(going[0], going[1]) }))
                    : unsure ? spEl('span', {}, [...this.traderLinks(unsure), unsure.id && unsure.w3b > 0 ? this.wordBtn('Refresh', 'where:check', 'Reads ' + unsure.name + '\'s price list on TornW3B now, then who buys this item', () => this.h.onTraderCheck && this.h.onTraderCheck(d.itemId, unsure.tradeKey)) : null])
                    : r.url && each !== null && !loss ? this.link(r.go, r.url, { cls: 'btn out' + (win ? ' go' : ''), title: r.venue === 'trader' ? 'Start a trade on Torn' : r.venue === 'bazaar' ? 'Opens your bazaar\'s add page' : 'Opens the Item Market\'s add page', focus: 'where:' + r.venue }) : spEl('span'),
            ]));
        }
        const bazaar = w.options.find((x) => x.venue === 'bazaar');
        let verdict = '';
        if (w.best === 'bazaar' || w.best === 'market') {
            const won = w.options.find((x) => x.venue === w.best);
            const place = (w.best === 'bazaar' ? 'your bazaar' : 'the Item Market') + (won && won.units < n ? ' for the first ' + count(won.units) + ' (as many as are listed near that price now)' : '');
            verdict = b ? 'Best: ' + place + ', ' + signed(w.gain) + ' more than the trader, but you wait for a buyer.'
                : u ? 'Best: ' + place + '. ' + u.name + '\'s price is not checked, so it is not counted.' : 'Best: ' + place + '. ' + rows.find((r) => r.venue === 'trader').missing + '.';
        } else if (w.best === 'trader' && bazaar && bazaar.each !== null) {
            const diff = bazaar.total - b.price * n;
            verdict = diff > 0 ? 'Your bazaar would get only ' + signed(diff) + ' more than ' + b.name + '\'s trade, and you would wait.' : 'Your bazaar would get ' + formatMoney(-diff) + ' less than ' + b.name + '\'s trade.';
        }
        if (verdict) body.appendChild(spEl('p', { class: 'note', text: verdict }));
        if (!w.best && w.paid) {
            body.appendChild(spEl('div', { class: 'amber' }, [spEl('span', {}, u && u.price > w.paid
                ? [spEl('b', { text: 'No checked price is over the ' + formatMoney(w.paid) + ' you paid.' }), ' ' + u.name + '\'s ' + formatMoney(u.price) + ' waits for its check; it stays in To sell until then.']
                : [spEl('b', { text: 'Nobody pays more than the ' + formatMoney(w.paid) + ' you paid.' }), ' It waits in To sell until someone does.'])]));
        }
        const kept = this.keptNow(d);
        if (kept !== null) {
            body.appendChild(spEl('div', { class: 'field' }, [
                spEl('div', { class: 'f-l' }, [spEl('b', { text: 'Not for sale' }), spEl('span', { text: 'keeps it out of every trade and off your bazaar\'s Fill all' })]),
                spEl('button', { type: 'button', class: 'sw-t' + (kept ? '' : ' off'), role: 'switch', 'aria-checked': String(kept), 'aria-label': 'Not for sale', 'data-focus': 'where:keep', onclick: () => this.h.onNotForSale && this.h.onNotForSale(d.itemId, !kept) }),
            ]));
        }
        box.append(spEl('div', { class: 'ph' }, [spEl('h2', { text: 'Where to sell your ' + count(n) }), d.paid > 0 ? spEl('span', { class: 'sub' }, ['you paid ', spEl('b', { text: formatMoney(d.paid) }), ' each']) : null]), body);
    }

    /* ------------------------------------------- totals, the Trades board, Today */

    /** One total in a tile: a label, the number, a line under it. `pick`: pressing it goes somewhere. */
    tile({ label, value, small = '', sub = [], good = false, bad = false, cls = 'tile', onPick = null, title = null }) {
        // A zero is never green.
        const zero = value === '+$0' || value === '$0';
        const el = spEl('div', { class: 'panel ' + cls + (onPick ? ' pick' : ''), title }, [
            spEl('div', { class: 'k-l', text: label }),
            spEl('div', { class: 'k-v' + (good && !zero ? ' good' : bad ? ' bad' : '') }, [value, small ? spEl('small', { text: small }) : null]),
            spEl('div', { class: 'k-s' }, sub),
        ]);
        if (onPick) {
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.addEventListener('click', onPick);
            el.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onPick();
            });
        }
        return el;
    }

    /** A page's few totals, drawn again only when a number in them changes. */
    tilesInto(box, key, tiles) {
        const sig = JSON.stringify(tiles.map((t) => [t.label, t.value, t.small, t.sub.map((x) => (typeof x === 'string' ? x : x.textContent)), t.good, t.bad]));
        this.tileSigs = this.tileSigs || {};
        if (this.tileSigs[key] === sig) return;
        this.tileSigs[key] = sig;
        box.textContent = '';
        if (!box.classList.contains('sumline')) {
            for (const t of tiles) box.appendChild(this.tile(t));
            return;
        }
        // One line (mockup AM): each total as its name and number; what it means is its hover.
        for (const t of tiles) {
            const zero = t.value === '+$0' || t.value === '$0';
            const why = t.sub.map((x) => (typeof x === 'string' ? x : x.textContent)).join('');
            const el = spEl(t.onPick ? 'button' : 'span', { type: t.onPick ? 'button' : null, class: 'si' + (t.onPick ? ' pick' : ''), title: [t.title, why].filter(Boolean).join(' · ') || null, onclick: t.onPick || null }, [
                t.label + ' ',
                spEl('b', { class: t.good && !zero ? 't-good' : t.bad ? 't-bad' : '', text: t.value }),
                t.small ? ' ' + t.small : null,
            ]);
            box.appendChild(el);
        }
    }

    /** The class of a big money figure: green only over zero, red under it. */
    moneyTone(n) {
        const v = Math.round(Number(n) || 0);
        return v > 0 ? '' : v < 0 ? ' neg' : ' zero';
    }

    /** "3 trades", "1 item": a number and its word. */
    plural(n, word) {
        return count(n) + ' ' + word + (n === 1 ? '' : 's');
    }

    renderTiles() {
        const s = this.state;
        const page = this.pg();
        const b = (text, cls = '') => spEl('b', { class: cls, text });
        if (page === 'trades' && this.onPast()) {
            // Drawn with the list (renderPast): its totals are of the trades kept.
        } else if (page === 'trades') {
            const T = s.trades || { waiting: [], buying: [], ready: [] };
            const yes = [...T.buying, ...T.ready];
            const all = [...T.waiting, ...yes];
            const stand = [T.ready.length ? count(T.ready.length) + ' ready to trade' : null, T.buying.length ? count(T.buying.length) + ' buying' : null, T.waiting.length ? count(T.waiting.length) + ' waiting for a yes' : null].filter(Boolean);
            const paid = yes.reduce((a, r) => a + (r.paid || 0), 0);
            const toBuy = yes.reduce((a, r) => a + (r.toBuy || 0), 0);
            this.tilesInto(this.tradesTiles, 'trades', [
                { label: 'Going', value: count(all.length), small: all.length === 1 ? 'trade' : 'trades', sub: [stand.length ? stand.join(' · ') : 'none now'] },
                { label: 'Paid to bazaars so far', value: formatMoney(paid), sub: yes.length ? ['in the ' + this.plural(yes.length, 'trade') + ' they said yes to · ', b(formatMoney(toBuy)), ' still to buy'] : ['nothing is bought before a yes'] },
                { label: 'They pay you', value: formatMoney(yes.reduce((a, r) => a + (r.pays || 0), 0)), sub: [yes.length ? 'when ' + (yes.length === 1 ? 'that one is' : 'those ' + count(yes.length) + ' are') + ' traded' : 'no trade said yes to yet'] },
                { label: 'Profit in all of them', value: signed(all.reduce((a, r) => a + (r.profit || 0), 0)), good: all.reduce((a, r) => a + (r.profit || 0), 0) > 0, sub: yes.length ? [b(signed(yes.reduce((a, r) => a + (r.profit || 0), 0))), ' in the ' + this.plural(yes.length, 'trade') + ' said yes to'] : ['none said yes to yet'] },
            ]);
        } else if (page === 'mine') {
            const H = s.hold || { items: 0, kinds: 0, paidKinds: 0, worth: 0 };
            const rows = ((s.toSell || {}).rows || []);
            const gain = ((s.toSell || {}).groups || []).reduce((a, g) => a + g.gain, 0);
            this.tilesInto(this.mineTiles, 'mine', [
                { label: 'In your inventory', value: count(H.items), small: 'items', sub: [b(count(H.paidKinds)), ' of ' + this.plural(H.kinds, 'kind') + ' a trader pays for'] },
                // 3.29.0: about (≈) while a price in it is not checked - a figure to read, not a price to act on.
                { label: 'Traders pay now', value: (H.approx ? '≈ ' : '') + formatMoney(H.worth), good: H.worth > 0, sub: ['for all of it, each item at its best trader' + (H.approx ? ' · some prices not checked' : '')], title: H.approx ? 'About: some of these prices were not checked with TornW3B in the last 5 minutes' : null },
                { label: 'Bought to resell', value: count(rows.length), small: (rows.length === 1 ? 'kind' : 'kinds') + ' · ' + this.plural(rows.reduce((a, r) => a + r.qty, 0), 'item'), sub: [b(signed(gain), gain > 0 ? 't-good' : ''), ' over what you paid if sold now, at checked prices · see To sell'], onPick: () => this.go('items', BD_ITEMS_RESELL), title: 'Open To resell' },
            ]);
        } else if (page === 'sell') {
            const T = s.toSell || { rows: [], groups: [], unchecked: [], waiting: [] };
            const rows = T.rows || [];
            const good = (T.groups || []).reduce((a, g) => a + g.rows.length, 0);
            // 3.29.0: only what a CHECKED price makes is in the sum; a trader whose price waits for its check is counted beside it.
            const unsure = (T.unchecked || []).length;
            const nobody = (T.waiting || []).length;
            this.tilesInto(this.sellTiles, 'sell', [
                { label: 'Held to resell', value: count(rows.reduce((a, r) => a + r.qty, 0)), small: 'items', sub: ['you paid ', b(formatMoney(rows.reduce((a, r) => a + r.qty * r.each, 0))), ' in all'] },
                { label: 'If sold to traders now', value: signed((T.groups || []).reduce((a, g) => a + g.gain, 0)), good: good > 0, sub: [b(count(good)), ' of ' + this.plural(rows.length, 'kind') + ': a trader pays more than you paid, price checked'] },
                { label: 'Waiting', value: count(unsure + nobody), small: unsure + nobody === 1 ? 'kind' : 'kinds', sub: [[unsure ? count(unsure) + ' for a price check' : null, nobody || !unsure ? 'nobody pays more than you paid yet' + (unsure ? ' for ' + count(nobody) : '') : null, (T.kept || []).length ? count(T.kept.length) + ' not for sale' : null].filter(Boolean).join(' · ')] },
            ]);
        }
    }

    /** One trade of the Trades page: how far it is (a bar), and its line. */
    tradeStage(kind, r) {
        const ago = (at) => formatAge(Date.now() - at);
        if (kind === 'waiting') return { at: 1, prog: 25, line: (r.asked ? 'asked ' : 'pinned ') + ago(r.at) + ' · ' + this.plural(r.items, 'item') };
        // A bazaar skipped is said as skipped, never as bought.
        const skipped = r.skippedStops ? ' · ' + count(r.skippedStops) + ' skipped' : '';
        const boughtOf = count(r.boughtStops || 0) + ' of ' + this.plural(r.bazaars, 'bazaar') + ' bought' + skipped;
        if (kind === 'buying') return { at: 2, prog: 25 + Math.round((50 * (r.bazaarsDone || 0)) / Math.max(1, r.bazaars || 1)), line: !r.next && !r.bought ? 'nothing bought' + skipped : boughtOf };
        return { at: 3, prog: 75 + Math.round((25 * (r.sent || 0)) / Math.max(1, r.items || 1)), line: (!r.bazaars ? 'all yours' : r.skippedStops ? boughtOf : 'all bought') + ' · ' + count(r.sent || 0) + ' of ' + this.plural(r.items, 'line') + ' in Torn\'s trade' };
    }

    /** Every trade going, as [kind, row] in the board's order. */
    tradesGoing() {
        const T = this.state.trades || { waiting: [], buying: [], ready: [] };
        return [...T.waiting.map((r) => ['waiting', r]), ...T.buying.map((r) => ['buying', r]), ...T.ready.map((r) => ['ready', r])];
    }

    /** A trade opened from Trades or Today: on show as planned, or as they said yes to it. */
    openTrade(kind, r) {
        if (kind === 'waiting') return this.h.onTradesOpen && this.h.onTradesOpen(r.itemId, r.key);
        return this.h.onTradesShow && this.h.onTradesShow(r.itemId, r.key);
    }

    /** The trade a card stands for is the one on show. */
    tradeOnShow(r, kind = '') {
        const s = this.state;
        if ((s.trades && s.trades.open) || !s.desk || String(s.desk.itemId) !== String(r.itemId)) return false;
        // A waiting trade just pressed, its prices not read yet: no plan with them to show so far, and it is still the one picked.
        const loading = kind === 'waiting' ? this.waitingOnDesk(s.desk) : null;
        return loading ? loading === r : this.tradeKeyOnShow() === r.key;
    }

    /**
     * The waiting trade (asked or pinned) of the item on show while the plan with its trader is not
     * worked out yet - nothing read so far, or only another trader's prices: its row, or null.
     */
    waitingOnDesk(d) {
        const T = d && d.trade;
        if (!d || (T && (T.accepted || (T.chosen && T.picked)))) return null;
        const rows = ((this.state.trades || {}).waiting || []).filter((r) => String(r.itemId) === String(d.itemId));
        if (T && T.chosen && rows.some((r) => r.key === T.chosen.key)) return null;
        return rows.length === 1 ? rows[0] : null;
    }

    /**
     * The Trades board (3.22.0, mockup V; as lanes since 3.25.0): a card per trade in the lane of its step -
     * waiting for a yes, buying, ready to trade - and what ended today, with what went to To sell by itself.
     * Pressing a card opens the trade under the board.
     */
    renderBoard() {
        if (this.bd.page !== 'trades') return;
        const s = this.state;
        const T = s.trades || { waiting: [], buying: [], ready: [], ended: [] };
        const minute = Math.floor(Date.now() / 60000);
        const going = this.tradesGoing();
        const sig = JSON.stringify(['board', going.map(([kind, r]) => [kind, r.itemId, r.key, r.name, r.items, r.profit, r.at, r.asked, r.bazaars, r.bazaarsDone, r.sent, r.boughtStops, r.skippedStops, r.bought, r.next, this.dotSig(r), this.tradeOnShow(r, kind)]), (T.ended || []).map((e) => [e.key, e.how, e.at, e.profit, e.moved]), minute]);
        if (sig === this.boardSig) return;
        this.boardSig = sig;
        const box = this.boardEl;
        const keep = this.focusKeyIn(box);
        box.textContent = '';
        const lane = (title, n, cards) => spEl('div', { class: 'lane' }, [spEl('div', { class: 'lane-h' }, [spEl('i'), spEl('span', { class: 'lbl', text: title }), spEl('span', { text: count(n) })]), ...cards]);
        const card = (kind, r) => {
            const st = this.tradeStage(kind, r);
            const off = s.statuses && r.id && s.statuses.get(String(r.id)) && s.statuses.get(String(r.id)).level === 'offline';
            const el = spEl('div', { class: 'tc' + (this.tradeOnShow(r, kind) ? ' sel' : ''), role: 'button', tabindex: '0', 'data-focus': 'tb:' + kind + ':' + r.itemId + ':' + r.key, title: 'Open the trade with ' + r.name, onclick: () => this.openTrade(kind, r) }, [
                spEl('div', { class: 'tc-h' }, [this.dot(r), spEl('b', { text: r.name }), spEl('span', { class: 'p', text: signed(r.profit) })]),
                spEl('div', { class: 'prog' }, [spVars(spEl('i'), { '--w': st.prog + '%' })]),
                spEl('small', { class: off && kind === 'waiting' ? 't-warn' : '', text: (off && kind === 'waiting' ? 'offline · ' : '') + st.line }),
            ]);
            el.addEventListener('keydown', (event) => {
                if (event.target !== el || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                this.openTrade(kind, r);
            });
            return el;
        };
        const HOW = { traded: 'traded', cancel: 'cancelled', old: 'no answer in a day' };
        box.append(
            lane('Waiting for a yes', T.waiting.length, T.waiting.map((r) => card('waiting', r))),
            lane('Buying', T.buying.length, T.buying.map((r) => card('buying', r))),
            lane('Ready to trade', T.ready.length, T.ready.map((r) => card('ready', r))),
            lane('Ended today', (T.ended || []).length, (T.ended || []).map((e) => spEl('div', { class: 'tc end' }, [
                spEl('div', { class: 'tc-h' }, [spEl('b', {}, [this.playerName(e.name, /^id:\d+$/.test(String(e.key)) ? String(e.key).slice(3) : null, 'tb:ended:' + e.key + ':' + e.at)]), spEl('span', { class: 'p', text: e.how === 'traded' && e.profit ? signed(e.profit) : '' })]),
                spEl('small', { text: (HOW[e.how] || 'ended') + ' · ' + (e.moved && e.moved.length ? e.moved.map((m) => count(m.qty) + ' ' + m.name).join(', ') + ' went to To sell' : e.how === 'traded' ? 'they took everything' : 'nothing was bought') + ' · ' + formatAge(Date.now() - e.at) }),
            ]))),
        );
        this.focusBack(box, keep);
    }

    /**
     * Trades › History (3.27.0, mockup AH; the owner, 2026-10-11: "trader cancelled trade, and then he asked
     * what pricelist did you see, we couldnt find them again"): the last 30 trades from their yes, and for the
     * one picked the prices it was made on, where each came from, how long before the yes it was checked, what
     * their list said when the trade ended, and what you bought for it.
     */
    renderPast() {
        if (!this.onPast()) return;
        const P = this.state.past;
        // Not read yet (the script reads the trades only while this tab is in view): what is drawn stays.
        if (!P) return;
        const rows = P.rows || [];
        const now = Date.now();
        const idOf = (r) => r.key + '|' + r.at;
        if (!rows.some((r) => idOf(r) === this.pastSel)) this.pastSel = rows.length ? idOf(rows[0]) : null;
        const minute = Math.floor(now / 60000);
        const sig = JSON.stringify(['past', rows, this.pastSel, this.pastCopied || null, this.pastCopyFailed || null, minute]);
        if (sig === this.pastSig) return;
        this.pastSig = sig;

        /* the totals */
        const T = pastTotals(rows);
        const b = (text, cls = '') => spEl('b', { class: cls, text });
        const none = T.old + T.back;
        this.tilesInto(this.pastTiles, 'past', [
            { label: 'Kept', value: count(T.kept), small: T.kept === 1 ? 'trade' : 'trades', sub: [(T.going ? count(T.going) + ' still going · ' : '') + 'the last 30 stay, on this PC only'] },
            { label: 'Traded', value: count(T.traded), sub: T.traded ? [b(signed(T.profit), T.profit > 0 ? 't-good' : ''), ' made in ' + (T.traded === 1 ? 'it' : 'them')] : ['none yet'] },
            { label: 'Cancelled', value: count(T.cancelled), sub: [T.cancelled ? 'after the yes · what was bought went to To sell' : 'none after a yes'] },
            { label: 'No trade made', value: count(none), sub: [none ? [T.old ? count(T.old) + ' with no trade in a day' : null, T.back ? count(T.back) + (T.back === 1 ? ' yes undone' : ' yeses undone') : null].filter(Boolean).join(' · ') : 'every yes was traded or cancelled'] },
        ]);

        /* the list */
        const keep = this.focusKeyIn(this.pastListEl);
        this.bd.pastPane.classList.toggle('one', !rows.length);
        this.pastTable.hidden = !rows.length;
        this.pastEmpty.hidden = rows.length > 0;
        this.pastSideEl.hidden = !rows.length;
        this.pastBody.textContent = '';
        const HOW = { traded: 'Traded', cancel: 'Cancelled', old: 'No trade in a day', back: 'Yes undone' };
        for (const r of rows) {
            const state = pastState(r);
            const units = (r.lines || []).reduce((a, l) => a + (l.units || 0), 0);
            const kinds = new Set((r.lines || []).map((l) => l.itemId)).size;
            const L = r.live || null;
            const head = state === 'going' ? (L && L.ready ? 'Ready to trade' : L ? 'Buying' : 'Going') : HOW[state] || 'Ended';
            const sub = state === 'traded' ? signed(r.end.profit)
                : state === 'cancel' ? pastSpan(r.end.at - r.at) + ' after the yes'
                    : state === 'old' ? 'what was bought went to To sell'
                        : state === 'back' ? 'back to the live plan'
                            : L && L.bazaars ? count(L.boughtStops || 0) + ' of ' + this.plural(L.bazaars, 'bazaar') + ' bought' : 'said yes ' + formatAge(now - r.at);
            const pick = () => {
                this.pastSel = idOf(r);
                this.renderPast();
            };
            const tr = spEl('tr', { class: 'pick' + (idOf(r) === this.pastSel ? ' sel' : ''), tabindex: '0', 'data-focus': 'past:' + idOf(r), title: 'See the prices this trade was made on', onclick: pick }, [
                spEl('td', {}, [spEl('div', { class: 'cell' }, [spEl('div', {}, [spEl('b', { text: r.trader.name || 'Trader ' + (r.trader.id || '') })])])]),
                spEl('td', { text: pastWhen(r.at, now) }),
                spEl('td', { class: 'n' }, [count(units), spEl('small', { text: this.plural(kinds, 'kind') })]),
                spEl('td', { class: 'n', text: formatMoney(r.pays) }),
                spEl('td', { class: state === 'cancel' || state === 'old' ? 't-warn' : '' }, [head, spEl('small', { class: state === 'traded' && r.end.profit > 0 ? 't-good' : '', text: sub })]),
            ]);
            tr.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                pick();
            });
            this.pastBody.appendChild(tr);
        }
        this.focusBack(this.pastListEl, keep);

        /* the trade picked */
        const rec = rows.find((r) => idOf(r) === this.pastSel);
        const side = this.pastSideEl;
        const keepSide = this.focusKeyIn(side);
        side.textContent = '';
        if (!rec) return;
        const state = pastState(rec);
        const end = rec.end;
        const L = rec.live || null;
        const then = end || L;
        const who = rec.trader.name || 'Trader ' + (rec.trader.id || '');
        const copied = this.pastCopied === idOf(rec);
        // Refused by the browser (it copies only from a page you are on): said on the button, never silent.
        const failed = this.pastCopyFailed === idOf(rec);
        const copy = spEl('button', { type: 'button', class: 'btn sm' + (copied ? ' done' : ''), 'data-focus': 'past:copy', title: 'Copies this trade as plain text, in Torn\'s time, to paste to ' + who, text: copied ? 'Copied' : failed ? 'Could not copy: press again' : 'Copy for ' + who, onclick: () => this.copyPast(rec, idOf(rec)) });
        const BY = { seen: 'seen in your Torn trades', hand: 'Traded - done pressed in Torn Bids', bids: 'Cancel trade pressed in Torn Bids', torn: 'Cancel trade pressed on a Torn page', gone: 'it left your open trades on Torn without going through' };
        const later = end ? pastSpan(end.at - rec.at) + ' later' : '';
        const story = ['Said yes ' + pastWhen(rec.at, now)];
        if (state === 'traded') story.push(spEl('b', { text: 'traded ' + pastWhen(end.at, now) }), later, BY[end.by] || null);
        else if (state === 'cancel') story.push(spEl('b', { text: 'cancelled ' + pastWhen(end.at, now) }), later, BY[end.by] || null);
        else if (state === 'old') story.push(spEl('b', { text: 'no trade made in a day' }), 'let go ' + pastWhen(end.at, now));
        else if (state === 'back') story.push(spEl('b', { text: 'yes undone ' + pastWhen(end.at, now) }), later, 'Back to the live plan pressed');
        else story.push(spEl('b', { text: L && L.ready ? 'ready to trade' : L ? 'buying' : 'still going' }), L && L.bazaars ? count(L.boughtStops || 0) + ' of ' + this.plural(L.bazaars, 'bazaar') + ' bought' : null);
        const subKids = [];
        // "traded today 21:31, 26 min later · seen in your Torn trades": the time and how long after go together.
        story.filter(Boolean).forEach((part, i) => {
            if (i) subKids.push(i === 2 && later && part === later ? ', ' : ' · ');
            subKids.push(part);
        });
        const made = state === 'traded';
        const off = Boolean(end) && !made;
        const plan = spEl('div', { class: 'plan' }, [
            spEl('div', { class: 'who' }, [
                spEl('div', { class: 'who-t' }, [
                    spEl('span', { class: 'lbl', text: 'Trade with' }), spEl('span', { class: 'sp' }),
                    rec.trader.id ? this.link('W3B list', w3bPriceListUrl(rec.trader.id), { cls: 'btn sm lk', title: who + '\'s TornW3B price list, as it is now', focus: 'past:w3b' }) : null,
                    rec.trader.name ? this.link('TE list', tePriceListUrl(rec.trader.name), { cls: 'btn sm lk', title: who + '\'s TornExchange price list, as it is now', focus: 'past:te' }) : null,
                    copy,
                ]),
                spEl('h3', {}, [this.playerName(who, rec.trader.id, 'past:who')]),
                spEl('span', { class: 'sub' }, subKids),
            ]),
            spEl('div', { class: 'bigrow' }, [
                spEl('div', {}, [spEl('span', { class: 'lbl', text: made ? 'Profit' : off ? 'It would have made' : 'Profit as planned' }), spEl('div', { class: 'big' + (off ? ' off' : this.moneyTone(made ? end.profit : rec.profit)), text: signed(made ? end.profit : rec.profit) })]),
                spEl('div', { class: 'eq' }, made
                    ? ['You paid the bazaars', spEl('b', { text: formatMoney(end.cost) }), spEl('br'), who + ' paid you', spEl('b', { text: formatMoney(end.pays) })]
                    : off ? ['You were to pay the bazaars', spEl('b', { text: formatMoney(rec.cost) }), spEl('br'), who + ' was to pay you', spEl('b', { text: formatMoney(rec.pays) })]
                        : ['Total cost', spEl('b', { text: formatMoney(rec.cost) }), spEl('br'), 'You get', spEl('b', { text: formatMoney(rec.pays) })]),
            ]),
        ]);
        const M = pastMoved(rec, then);
        if (M.moved.length) {
            const what = M.moved.map((x) => x.name + (x.is > 0 ? ' went from ' + formatMoney(x.was) + ' to ' + formatMoney(x.is) : ' is no longer on their list')).join('; ') + '.';
            const lead = M.changedAt ? who + ' changed their list ' + pastWhen(M.changedAt, now) + ', ' + pastSpan(M.changedAt - rec.at) + ' after the yes.' : who + '\'s prices moved after the yes.';
            const rest = (rec.lines || []).length > M.moved.length ? ' The other prices stayed.' : '';
            plan.appendChild(spEl('div', { class: 'amber' }, [spEl('span', {}, [spEl('b', { text: lead }), ' ' + what + rest])]));
        }
        side.appendChild(plan);

        /* their prices at the yes */
        const list = rec.list;
        const onW3b = (rec.lines || []).some((l) => pastSource(l) === 'w3b');
        let listNote;
        if (!list) listNote = ['This trade was accepted before Torn Bids kept a history: these are the prices it was accepted at. Where they came from and how old ' + who + '\'s list was were not written down.'];
        else {
            listNote = [spEl('b', { text: onW3b ? 'TornW3B list' : 'TornExchange prices' })];
            if (onW3b) listNote.push(list.changedAt ? ', last changed by ' + who + ' ' + pastWhen(list.changedAt, now) + ', ' + pastSpan(rec.at - list.changedAt) + ' before the yes.' : '. When ' + who + ' last changed it is not known.');
            else listNote.push(': TornExchange gives no date for a price.');
            if (onW3b && list.readAt) listNote.push(' Torn Bids read it ' + pastWhen(list.readAt, now) + '.');
            if (M.known && !M.moved.length) listNote.push(M.changedAt ? ' They changed it ' + pastWhen(M.changedAt, now) + ', after the yes: none of this trade\'s prices moved.' : M.readAfter ? (end ? ' It had not changed when the trade ended.' : ' It has not changed since.') : ' Torn Bids has not read it again since the yes.');
        }
        side.appendChild(spEl('div', { class: 'ph' }, [spEl('h2', { text: who + '\'s prices when they said yes' })]));
        side.appendChild(spEl('p', { class: 'note' }, listNote));
        const priceRows = (rec.lines || []).map((l) => {
            const src = pastSource(l);
            const from = src === 'w3b' ? ['TornW3B', spEl('small', { text: l.te > 0 ? 'TornExchange said ' + formatMoney(l.te) : 'not on TornExchange' })]
                : src === 'te' ? ['TornExchange', spEl('small', { text: 'not on TornW3B' })] : ['–'];
            const checked = l.checkedAt > 0 && l.checkedAt <= rec.at ? pastSpan(rec.at - l.checkedAt) : '–';
            const moved = M.moved.find((x) => x.itemId === l.itemId);
            const last = !M.known ? spEl('td', { class: 'n t-muted', text: '–' })
                : !moved ? spEl('td', { class: 'n same', text: 'the same' })
                    : moved.is > 0 ? spEl('td', { class: 'n t-warn' }, [formatMoney(moved.is), spEl('small', { text: signed(moved.is - moved.was) + ' each' })])
                        : spEl('td', { class: 'n t-warn', text: 'not listed' });
            return spEl('tr', {}, [
                spEl('td', {}, [this.pic('past', l.itemId), spEl('b', { text: l.name || 'Item ' + l.itemId }), l.kind === 'yours' ? spEl('span', { class: 'tag', text: 'yours' }) : null]),
                spEl('td', { class: 'n', text: count(l.units) }),
                spEl('td', { class: 'n' }, [spEl('b', { text: formatMoney(l.bid) })]),
                spEl('td', {}, from),
                spEl('td', { class: 'n', text: checked }),
                last,
            ]);
        });
        side.appendChild(spEl('div', { class: 'pb flush' }, [spEl('table', { class: 't tight wrapth' }, [
            spEl('thead', {}, [spEl('tr', {}, [spEl('th', { text: 'Item' }), spEl('th', { class: 'n', text: 'Count' }), spEl('th', { class: 'n', text: 'They pay each' }), spEl('th', { text: 'Price from' }), spEl('th', { class: 'n', title: 'How long before their yes TornW3B last confirmed this price', text: 'Checked before the yes' }), spEl('th', { class: 'n', text: end ? 'When it ended' : 'Now' })])]),
            spEl('tbody', {}, priceRows),
        ])]));

        /* what you bought for it */
        const bought = (end ? end.bought : L ? L.bought : null) || [];
        if (bought.length) {
            const each = (n) => (n === null || n === undefined ? '–' : formatMoney(n));
            const stops = (n) => this.plural(n, 'bazaar');
            const thenOf = (r) => {
                if (state === 'going') return r.kind === 'yours' ? 'to send' : r.got >= r.of ? 'bought' : r.got ? 'some still to buy' : 'still to buy';
                if (state === 'traded') {
                    const took = Math.max(0, r.got - (r.kept || 0));
                    return who + ' took ' + count(took) + (r.kept ? ' · ' + count(r.kept) + ' went to To sell' : '');
                }
                if (r.kind === 'yours') return r.each === null ? 'stayed yours' : 'stayed in To sell';
                return r.got ? (r.kept ? (r.kept < r.got ? count(r.kept) + ' went to To sell' : 'went to To sell') : 'stayed yours') : 'not bought';
            };
            side.appendChild(spEl('div', { class: 'ph' }, [spEl('h2', { text: 'What you bought for it' }), spEl('span', { class: 'sub', text: state === 'going' ? 'so far' : made ? 'and what ' + who + ' took' : 'when it ended' })]));
            side.appendChild(spEl('div', { class: 'pb flush' }, [spEl('table', { class: 't tight' }, [
                spEl('thead', {}, [spEl('tr', {}, [spEl('th', { text: 'Item' }), spEl('th', { class: 'n', text: 'Bought' }), spEl('th', { class: 'n', text: 'You paid each' }), spEl('th', { text: 'At' }), spEl('th', { text: 'Then' })])]),
                spEl('tbody', {}, bought.map((r) => spEl('tr', {}, [
                    spEl('td', {}, [this.pic('past', r.itemId), spEl('b', { text: r.name || 'Item ' + r.itemId })]),
                    spEl('td', { class: 'n', text: r.kind === 'yours' ? 'yours, ' + count(r.got) : r.kind === 'extra' ? count(r.got) + ', not planned' : count(r.got) + ' of ' + count(r.of) }),
                    spEl('td', { class: 'n', text: r.got || r.kind === 'yours' ? each(r.each) : '–' }),
                    spEl('td', { text: r.kind === 'yours' ? (r.each === null ? 'your own' : 'from To sell') : r.got ? stops(r.stops) : stops(r.stopsAll) + ', not been to' }),
                    spEl('td', { class: !r.got && r.kind !== 'yours' ? 't-muted' : '', text: thenOf(r) }),
                ]))),
            ])]));
        }
        this.focusBack(side, keepSide);
    }

    /** Copy for the trader: the trade as plain text on the clipboard. The button says Copied for a moment, or that it could not. */
    copyPast(rec, id) {
        const text = pastTradeText(rec, rec.live || null);
        const done = (ok) => {
            this.pastCopied = ok ? id : null;
            this.pastCopyFailed = ok ? null : id;
            this.renderPast();
            clearTimeout(this.pastCopyTimer);
            this.pastCopyTimer = setTimeout(() => {
                this.pastCopied = null;
                this.pastCopyFailed = null;
                this.renderPast();
            }, 2500);
        };
        const old = () => {
            // No clipboard permission: the older way, through a text box of our own.
            try {
                const box = spEl('textarea', { 'aria-hidden': 'true' });
                box.value = text;
                box.style.cssText = 'position:fixed;left:-9999px;top:0;';
                this.root.appendChild(box);
                box.select();
                const ok = document.execCommand('copy');
                box.remove();
                done(ok);
            } catch {
                done(false);
            }
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), old);
            else old();
        } catch {
            old();
        }
    }

    /** Profit per day for the last `n` days, from your Ledger: [{start, profit}], oldest first. Empty without a Ledger key. */
    profitDays(n) {
        const L = this.state.ledger || {};
        const rows = L.rows || [];
        if (!L.hasKey || !rows.length) return [];
        const sig = rows.length + ':' + rows[rows.length - 1].id + ':' + n + ':' + periodStart(Date.now(), 'day');
        if (this.daysSig !== sig) {
            this.daysSig = sig;
            const by = new Map(ledgerByPeriod(rows, matchFifo(rows), 'day').map((p) => [p.start, p.profit]));
            const today = periodStart(Date.now(), 'day');
            this.days = [];
            for (let i = n - 1; i >= 0; i -= 1) {
                // Midnight of each day by the calendar (a day is not always 24 hours).
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const start = periodStart(d.getTime(), 'day');
                this.days.push({ start, profit: by.get(start) || 0 });
            }
        }
        return this.days;
    }

    /**
     * Today: the few totals, the best flips, what to do now, your trades, what you hold and your profit.
     * Everything here is a way in: a press opens the page it is from.
     */
    renderToday() {
        if (this.bd.page !== 'today') return;
        const s = this.state;
        const info = s.info || {};
        const T = s.trades || { waiting: [], buying: [], ready: [] };
        const going = this.tradesGoing();
        // 3.30.0 - the flips that sell to one trader are one trade: they stand together, the trader named once.
        // (Not while a trade holds the list still: the cards keep the places of the hold.)
        const flipTo = (f) => (f.buyer ? (f.buyer.id ? 'id:' + f.buyer.id : 'name:' + String(f.buyer.name || '').toLowerCase()) : null);
        const flipsNow = (s.strip || []).filter((f) => f.plan);
        const flips = s.still ? flipsNow : togetherBy(flipsNow, flipTo, (f) => f.plan.profit);
        // 3.33.0 - the scan's own order (core/flips-engine.js basketOrder): online and open first, then by the whole trade.
        const traders = ((s.scan || {}).list || []).filter((x) => this.traderReady(x));
        const best = traders[0] || null;
        const sellT = s.toSell || { rows: [], groups: [] };
        const sellGain = (sellT.groups || []).reduce((a, g) => a + g.gain, 0);
        const H = s.hold || { items: 0, kinds: 0, worth: 0, top: [] };
        const days = this.profitDays(10);
        const week = days.slice(-7).reduce((a, x) => a + x.profit, 0);
        const todayP = days.length ? days[days.length - 1].profit : 0;
        const minute = Math.floor(Date.now() / 60000);
        const sig = JSON.stringify(['today',
            traders.slice(0, 7).map((x) => [x.key, x.name, x.profit, x.items, x.stops, x.basket && x.basket.cost, x.estimated, x.lastPaid, x.offline, x.notOpen, this.dotSig(x)]), (s.counts || {}).flips, flips.slice(0, 7).map((f) => [f.itemId, f.name, f.plan.profit, f.buyer && f.buyer.name, this.dotSig(f.buyer)]),
            best && [best.key, best.profit, best.items, best.stops, best.name],
            going.map(([kind, r]) => [kind, r.itemId, r.key, r.name, r.profit, r.items, r.bazaars, r.bazaarsDone, r.sent, r.next, r.at]),
            sellGain, (sellT.rows || []).length, (sellT.groups || []).map((g) => [g.key, g.gain, g.rows.length]),
            H, days, Boolean((s.ledger || {}).hasKey), this.noFlipsText(), info.hasKey, minute,
            s.still ? [s.still.trader, (s.still.waiting || []).length] : null,
            going.map(([, r]) => [r.boughtStops, r.skippedStops, r.bought]),
            this.h.askOf ? going.map(([, r]) => (r.id ? this.h.askOf(r.id).why : '')) : null]);
        if (sig === this.todaySig) return;
        this.todaySig = sig;
        const b = (text, cls = '') => spEl('b', { class: cls, text });

        /* the four totals (mockup AM: how many flips there are is on the sidebar and on Best flips' button) */
        this.todayTiles.textContent = '';
        const kpi = (o) => this.todayTiles.appendChild(this.tile({ ...o, cls: 'kpi' }));
        kpi(best
            ? { label: 'Best trade now', value: signed(best.profit), good: best.profit > 0, sub: [b(best.name), ' · ' + this.plural(best.items, 'item') + ' · ' + this.plural(best.stops, 'bazaar')], onPick: () => this.showTrader(best), title: 'Open this trade' }
            : { label: 'Best trade now', value: '–', sub: [(s.scan || {}).open && !((s.scan || {}).list || []).length ? 'working it out…' : 'none with your traders now'], onPick: () => this.go('flips', BD_FLIPS_TRADER) });
        // A trade under way holds the list: Today says so, and where what is new waits.
        const heldFor = !flips.length && s.still && s.still.trader ? s.still.trader : null;
        const heldNew = heldFor ? (s.still.waiting || []).length : 0;
        const nFlips = (s.counts || {}).flips || 0;
        this.todayAllTab = traders.length ? BD_FLIPS_TRADER : BD_FLIPS_BEST;
        this.todayAll.textContent = traders.length ? 'All ' + count(traders.length) + (traders.length === 1 ? ' trader' : ' traders') : nFlips ? 'All ' + this.plural(nFlips, 'flip') : 'Flips';
        this.todayAll.title = nFlips ? this.plural(nFlips, 'flip') + ' now' + (flips.length ? ' · ' + signed(flips.reduce((a, f) => a + f.plan.profit, 0)) + ' in the best ' + count(flips.length) : '') : this.noFlipsText();
        kpi({ label: 'Trades going', value: count(going.length), sub: going.length ? [T.ready.length ? b(count(T.ready.length) + ' ready to trade') : T.buying.length ? b(count(T.buying.length) + ' buying') : b(count(T.waiting.length) + ' waiting for a yes'), ' · ' + signed(going.reduce((a, [, r]) => a + (r.profit || 0), 0)) + ' in all'] : ['none now'], onPick: () => this.go('trades') });
        kpi({ label: 'To resell', value: (sellT.rows || []).length ? signed(sellGain) : '–', sub: (sellT.rows || []).length ? ['if sold now · ', b(count(sellT.rows.reduce((a, r) => a + r.qty, 0))), ' items held'] : ['nothing bought to resell'], onPick: () => this.go('items', BD_ITEMS_RESELL) });
        kpi(days.length
            ? { label: 'Profit, 7 days', value: signed(week), good: week > 0, bad: week < 0, sub: ['today ', b(signed(todayP))], onPick: () => this.go('ledger') }
            : { label: 'Profit, 7 days', value: '–', sub: [(s.ledger || {}).hasKey ? 'reading your log…' : 'needs your Full key: Settings'], onPick: () => this.go((s.ledger || {}).hasKey ? 'ledger' : 'settings', (s.ledger || {}).hasKey ? null : BD_SET_KEYS) });

        /* best flips now: by trader (3.33.0), each the whole trade with them */
        const fbox = this.todayFlips;
        fbox.textContent = '';
        const th = (text, n) => spEl('th', { class: n ? 'n' : '', text });
        const goingWith = new Set(going.map(([, r]) => String(r.key)));
        if (traders.length) {
            const body = spEl('tbody');
            for (const x of traders.slice(0, 7)) {
                const lines = (x.basket && x.basket.lines) || [];
                const lead = lines[0] || null;
                const about = x.estimated || x.lastPaid ? '≈ ' : '';
                body.appendChild(this.pickRow('', 'today:trader:' + x.key, () => this.showTrader(x), [
                    spEl('td', {}, [spEl('div', { class: 'cell' }, [this.dot(x), spEl('b', { text: x.name }), goingWith.has(String(x.key)) ? spEl('span', { class: 'tag b', text: 'going' }) : null])]),
                    spEl('td', { class: 't2' }, lead ? [lead.name, lines.length > 1 ? spEl('span', { class: 't-muted', text: ' + ' + count(lines.length - 1) + ' more' }) : null] : [this.plural(x.items, 'item')]),
                    spEl('td', { class: 'n t2', text: x.basket ? formatMoney(x.basket.cost) : '–' }),
                    spEl('td', { class: 'n t2', text: x.basket ? about + formatMoney(x.basket.back) : '–' }),
                    spEl('td', { class: 'n' }, [spEl('b', { class: 't-good', text: about + signed(x.profit) })]),
                ], 'Open the trade with ' + x.name + ' · ' + this.plural(x.stops, 'bazaar')));
            }
            fbox.appendChild(spEl('table', { class: 't' }, [spEl('thead', {}, [spEl('tr', {}, [th('Trader'), th('Items'), th('Cost', true), th('They pay', true), th('Profit', true)])]), body]));
        }
        // No trader's trade ready yet (being worked out, checked, or every buyer known by name only): the flips, by item.
        if (!traders.length && flips.length) {
            const body = spEl('tbody');
            for (const f of flips.slice(0, 7)) {
                body.appendChild(this.pickRow('', 'today:flip:' + f.itemId, () => this.showFlip(f.itemId), [
                    spEl('td', {}, [spEl('div', { class: 'cell' }, [this.pic('today', f.itemId), spEl('b', { text: f.name })])]),
                    spEl('td', {}, [spEl('div', { class: 'cell' }, [this.dot(f.buyer), f.buyer ? f.buyer.name : ''])]),
                    spEl('td', { class: 'n' }, [spEl('b', { class: 't-good', text: signed(f.plan.profit) })]),
                ], 'Open this flip'));
            }
            fbox.appendChild(spEl('table', { class: 't' }, [spEl('thead', {}, [spEl('tr', {}, [th('Item'), th('Sell to'), th('Profit', true)])]), body]));
        }
        if (traders.length) {
            // The trader rows say it all.
        } else if (!flips.length && heldFor) {
            fbox.appendChild(spEl('div', { class: 'empty' }, [
                'Held while you trade with ' + heldFor + '. ' + (heldNew ? this.plural(heldNew, 'new flip') + (heldNew === 1 ? ' waits' : ' wait') + ' in Flips. ' : 'New flips wait in Flips. '),
                spEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'today:held', text: 'Open Flips', onclick: () => this.go('flips', BD_FLIPS_BEST) }),
            ]));
        } else if (!flips.length) fbox.appendChild(spEl('div', { class: 'empty', text: this.noFlipsText() }));

        /* do now: the next step of each trade, then the best trade to ask for, then what to sell */
        const dbox = this.todayDo;
        dbox.textContent = '';
        const nx = (icon, lead, rest, btn) => dbox.appendChild(spEl('div', { class: 'nx' }, [spEl('span', { class: 'nx-i' }, [bdIcon(icon)]), spEl('span', { class: 'nx-t' }, [spEl('b', { text: lead }), ' ' + rest]), btn]));
        const press = (label, fn, go = false, focus = '') => spEl('button', { type: 'button', class: 'btn sm' + (go ? ' go' : ''), 'data-focus': focus || null, text: label, onclick: fn });
        let first = true;
        const lead = () => {
            const was = first;
            first = false;
            return was;
        };
        for (const r of T.ready.slice(0, 2)) {
            nx('trades', r.name + ': ' + (!r.bazaars ? 'all yours.' : r.skippedStops ? count(r.boughtStops || 0) + ' of ' + this.plural(r.bazaars, 'bazaar') + ' bought, ' + count(r.skippedStops) + ' skipped.' : 'everything is bought.'), count(r.sent || 0) + ' of ' + this.plural(r.items, 'line') + ' in Torn\'s trade.',
                r.id ? this.tradeLink({ id: r.id, name: r.name }, 'btn sm out' + (lead() ? ' go' : ''), { key: r.key }, 'today:trade:' + r.key) : press('See it', () => this.showTrade('ready', r)));
        }
        for (const r of T.buying.slice(0, 2)) {
            // Every bazaar skipped: nothing to press next but the trade itself.
            if (!r.next) nx('buy', r.name + ': nothing bought.', count(r.skippedStops || 0) + ' of ' + this.plural(r.bazaars, 'bazaar') + ' skipped.', press('See it', () => this.showTrade('buying', r), false, 'today:skipped:' + r.key));
            else nx('buy', r.name + ': ' + count(r.boughtStops || 0) + ' of ' + this.plural(r.bazaars, 'bazaar') + ' bought' + (r.skippedStops ? ', ' + count(r.skippedStops) + ' skipped' : '') + '.', 'Next is ' + r.next + '.',
                press('Next bazaar', () => this.h.onTradeStartBuying && this.h.onTradeStartBuying(r.key), lead(), 'today:next:' + r.key));
        }
        for (const r of T.waiting.filter((w) => w.asked).slice(0, 1)) {
            nx('trades', r.name + ' has not answered yet.', 'Asked ' + formatAge(Date.now() - r.at) + ' · ' + signed(r.profit) + '.', press('See it', () => this.showTrade('waiting', r), false, 'today:wait:' + r.key));
        }
        if (best) nx('flip', 'Ask ' + best.name + '.', signed(best.profit) + ' for ' + this.plural(best.items, 'item') + ' at ' + this.plural(best.stops, 'bazaar') + '.', press('See it', () => this.showTrader(best), lead(), 'today:best'));
        const g0 = (sellT.groups || [])[0] || null;
        if (g0) nx('tag', 'Sell your ' + (g0.rows.length === 1 ? count(g0.rows[0].qty) + ' ' + g0.rows[0].name : this.plural(g0.rows.length, 'item') + ' held') + '.', g0.trader.name + ' pays ' + formatMoney(g0.gain) + ' more than you paid.', press('To resell', () => this.go('items', BD_ITEMS_RESELL), false, 'today:sell'));
        if (!dbox.children.length) dbox.appendChild(spEl('div', { class: 'empty', text: info.hasKey ? 'Nothing to do now. ' + this.noFlipsText() : 'Add your Limited key in Settings to see your items and your trades.' }));

        /* what you hold: all of it in one bar, the biggest four named */
        const hbox = this.todayHold;
        hbox.textContent = '';
        if (!H.kinds) hbox.appendChild(spEl('div', { class: 'empty', text: !info.hasKey ? 'Add your Limited key in Settings to see your items.' : info.loading ? 'Loading your inventory…' : 'Your inventory has nothing a trader pays for.' }));
        else {
            const greys = ['#8b93a3', '#6d7584', '#555c6a', '#434a57', '#333842'];
            const rest = { kinds: H.kinds - H.top.length, worth: H.worth - H.top.reduce((a, r) => a + r.worth, 0) };
            const share = (v) => Math.max(1, (v / Math.max(1, H.worth)) * 100).toFixed(1) + '%';
            hbox.append(...[
                // 3.29.0: about (≈) while a price in it is not checked.
                spEl('div', { class: 'bigrow' }, [spEl('div', { class: 'hero', title: H.approx ? 'About: some of these prices were not checked with TornW3B in the last 5 minutes' : null, text: (H.approx ? '≈ ' : '') + formatMoney(H.worth) }), spEl('div', { class: 'eq', text: count(H.items) + ' items · ' + this.plural(H.kinds, 'kind') })]),
                spEl('div', { class: 'stack' }, [...H.top.map((r, i) => spVars(spEl('i'), { '--c': greys[i], '--w': share(r.worth) })), rest.kinds > 0 ? spVars(spEl('i'), { '--c': greys[4], '--w': share(rest.worth) }) : null]),
                ...H.top.map((r, i) => spEl('div', { class: 'hl' }, [spVars(spEl('i'), { '--c': greys[i] }), spEl('b', { text: r.name }), ' × ' + count(r.held), spEl('span', { text: formatMoney(r.worth) })])),
                rest.kinds > 0 ? spEl('div', { class: 'hl' }, [spVars(spEl('i'), { '--c': greys[4] }), this.plural(rest.kinds, 'more kind'), spEl('span', { text: formatMoney(rest.worth) })]) : null,
            ].filter(Boolean));
        }

        /* profit per day */
        const cbox = this.todayChart;
        cbox.textContent = '';
        if (!days.length) cbox.appendChild(spEl('div', { class: 'empty', text: (s.ledger || {}).hasKey ? 'Reading your log…' : 'Your profit per day comes from your own Torn log. It needs a Full key, kept apart: Settings › Keys and sharing.' }));
        else {
            const top = Math.max(1, ...days.map((x) => Math.abs(x.profit)));
            for (const x of days) {
                const day = new Date(x.start);
                cbox.appendChild(spEl('div', { class: 'day', title: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ': ' + signed(x.profit) }, [
                    x.profit ? spEl('b', { class: x.profit < 0 ? 't-bad' : '', text: shortMoney(x.profit) }) : null,
                    spVars(spEl('i', { class: x.profit < 0 ? 'neg' : x.profit ? '' : 'zero' }), { height: x.profit ? Math.max(4, Math.round((Math.abs(x.profit) / top) * 70)) + '%' : '2px' }),
                    String(day.getDate()),
                ]));
            }
        }
    }

    /** From Today: a flip opened in Flips › Best flips. */
    showFlip(itemId) {
        this.go('flips', BD_FLIPS_BEST);
        this.select(itemId);
    }

    /** From Today: the trade with a trader opened in Flips › By trader. */
    showTrader(x) {
        this.go('flips', BD_FLIPS_TRADER);
        this.visit.picked = true;
        if (this.h.onTradePick) this.h.onTradePick(x.mainId, x.key);
    }

    /** From Today: a trade going opened in Trades. */
    showTrade(kind, r) {
        this.go('trades');
        this.visit.picked = true;
        this.openTrade(kind, r);
    }

    /**
     * Settings: its parts under three tabs on top (Keys and sharing | Flips and reading | Help). Mockup AM: a
     * part is a panel, two side by side; a row is the setting's name on the left and its control and one line
     * of state on the right. What a part or a setting is for is in the (i) beside its name - hovered or
     * focused, with its links still links - never a sentence on the page.
     */
    buildSettings() {
        const body = spEl('div', { class: 'sp-sbody' });
        const box = spEl('div', { class: 'sp-settings' }, [body]);
        this.snav = [];
        this.snavSections = [];

        const group = () => {};
        const section = (id, title, lead, children) => {
            // What the part's state is, in the words the pills use: beside its name.
            const dot = spEl('span', { class: 'sp-dot' });
            const state = spEl('span', { class: 'sstate' });
            const sec = spEl('section', { class: 'sp-card', 'data-sec': id }, [
                spEl('h2', {}, [title, lead ? helpTip([].concat(lead), title) : null, dot, state]),
                ...children,
            ]);
            this.snav.push({ id, dot, state });
            this.snavSections.push({ id, sec });
            body.appendChild(sec);
        };
        const field = (label, sub, control) => {
            const parts = [].concat(control);
            // What a setting is for is in the (i) beside its name: the right side is the control and its one line of state.
            const notes = parts.filter((n) => n && n.classList && n.classList.contains('sp-note'));
            const beside = notes.length < parts.length ? notes : [];
            const why = [...(sub ? [spEl('span', {}, [].concat(sub))] : []), ...beside];
            return spEl('div', { class: 'sp-field' }, [
                spEl('div', { class: 'sp-flabel' }, [spEl('b', {}, [label, why.length ? helpTip(why, label) : null])]),
                spEl('div', { class: 'sp-fctl' }, parts.filter((n) => !beside.includes(n))),
            ]);
        };
        const note = (children) => spEl('p', { class: 'sp-note' }, children);
        const newTab = (text, href) => spEl('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

        /* Torn key (Limited) */
        group('Keys and sources');
        const torn = keyField({
            placeholder: 'Limited API key',
            primary: true,
            onSave: (key) => this.h.onSaveKey && this.h.onSaveKey(key),
            onReveal: () => this.h.onRevealKey && this.h.onRevealKey(),
        });
        this.keyStateEl = spEl('div', { class: 'sp-keystate', text: 'No key saved.' });
        this.keyForgetBtn = spEl('button', { type: 'button', class: 'sp-link sp-quiet', text: 'Forget key', onclick: () => this.h.onForgetKey && this.h.onForgetKey() });
        torn.row.appendChild(this.keyForgetBtn);
        /* The Public key (3.26.0): the one NPC Arbitrage's panel saves - shown here too, saved from either. */
        const pub = keyField({
            placeholder: 'Public Only API key',
            onSave: (key) => this.h.onSavePublicKey && this.h.onSavePublicKey(key),
            onReveal: () => (this.h.onRevealPublicKey ? this.h.onRevealPublicKey() : ''),
        });
        this.pubStateEl = spEl('div', { class: 'sp-keystate', text: 'No key saved.' });
        this.pubServerEl = spEl('div', { class: 'sp-keystate' });
        this.pubServerEl.hidden = true;
        this.pubForgetBtn = spEl('button', { type: 'button', class: 'sp-link sp-quiet', text: 'Forget key', onclick: () => this.h.onForgetPublicKey && this.h.onForgetPublicKey() });
        pub.row.appendChild(this.pubForgetBtn);
        section('keys', 'Torn API keys', ['Both are sent to api.torn.com only. Make them at ', newTab('Torn › Settings › API Key', TORN_API_KEY_URL), '.'], [
            field('Limited key', 'Used only on this page.', [
                torn.row,
                this.keyStateEl,
                note(['Reads your inventory, your own id, item names, the Item Market for the item on the desk, and traders\' online status.']),
            ]),
            field('Public key', 'The key NPC Arbitrage uses on Torn\'s pages. Save it here or in its panel: it is one key, both places.', [
                pub.row,
                this.pubStateEl,
                this.pubServerEl,
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
            class: 'sp-link sp-quiet',
            text: 'Use my Limited key',
            onclick: () => this.h.onSaveTeKey && this.h.onSaveTeKey(this.h.onRevealKey ? this.h.onRevealKey() : ''),
        });

        this.teForgetBtn = spEl('button', { type: 'button', class: 'sp-link sp-quiet', text: 'Forget key', onclick: () => this.h.onForgetTeKey && this.h.onForgetTeKey() });
        te.row.append(this.teSameBtn, this.teForgetBtn);
        section('te', 'TornExchange', 'Traders\' buy prices and trust votes.', [
            field('TornExchange key', ['The Torn key you log into ', newTab('tornexchange.com', TE_SITE_URL), ' with. Often your Limited key.'], [
                te.row,
                this.teStateEl,
            ]),
        ]);

        this.w3bStateEl = spEl('div', { class: 'sp-keystate' });
        /* The key registered on TornW3B (3.26.0): optional - with it TornW3B allows 25 sellers lists a minute, not 10. */
        const w3k = keyField({
            placeholder: 'Key you registered on TornW3B (optional)',
            onSave: (key) => this.h.onSaveW3bKey && this.h.onSaveW3bKey(key),
            onReveal: () => (this.h.onRevealW3bKey ? this.h.onRevealW3bKey() : ''),
        });
        this.w3bKeyStateEl = spEl('div', { class: 'sp-keystate', text: 'No key saved · an item\'s bazaars: 8 reads a minute.' });
        this.w3bKeyForgetBtn = spEl('button', { type: 'button', class: 'sp-link sp-quiet', text: 'Forget key', onclick: () => this.h.onForgetW3bKey && this.h.onForgetW3bKey() });
        w3k.row.append(this.w3bKeyForgetBtn);
        section('w3b', 'TornW3B', ['Bazaar prices and traders\' price lists, from ', newTab('weav3r.dev', 'https://weav3r.dev/'), '. No key needed; without one it only receives item and trader ids.'], [
            field('State', null, [this.w3bStateEl]),
            field('TornW3B key', ['Optional. The Torn key you registered on ', newTab('weav3r.dev', 'https://weav3r.dev/'), '. With it TornW3B lets this page read an item\'s bazaars 22 times a minute instead of 8. It goes to weav3r.dev only, and only with those reads. Your Limited key goes there only if you paste it in this box.'], [
                w3k.row,
                this.w3bKeyStateEl,
            ]),
        ]);

        /*
         * Shared (3.25): what the server last said and what it does with your key. Nothing is typed
         * here - the address is built in and this PC is known by its Public key - and the part shows
         * only to the server's own people (renderShared).
         */
        this.sharedNowEl = spEl('div', { class: 'sp-keystate' });
        this.sharedKeyEl = spEl('div', { class: 'sp-keystate' });
        this.sharedUsePc = spEl('span', { class: 'sp-use-pc' });
        this.sharedUseSv = spEl('span', { class: 'sp-use-sv' });
        this.sharedUseFr = spEl('span', { class: 'sp-use-fr' });
        this.sharedUseEl = spEl('div', { class: 'sp-use' }, [this.sharedUsePc, this.sharedUseSv, this.sharedUseFr]);
        this.sharedUseNote = spEl('div', { class: 'sp-keystate' });
        section('shared', 'Shared', 'One server for you and your friends. While any of you is on, it reads bazaar prices from Torn itself and passes them to everyone. Nothing to set up here.', [
            field('Now', 'If the server does not answer, nothing waits for it.', [this.sharedNowEl]),
            field('Your Torn key on the server', 'A Public Only key. You gave it to whoever runs the server, and they typed it in there. This page never sends a key anywhere.', [this.sharedKeyEl]),
            field('Your 100 Torn calls this minute', 'This PC always goes first. The server takes only what is left, and always leaves some free for TornTools or your phone.', [this.sharedUseEl, this.sharedUseNote]),
            field('What leaves this PC', 'Checked on the way out.', [
                note(['Which bazaars and items matter to you (player numbers, item numbers, the most a trader pays for an item), how many Torn calls this PC made, and two marks your friends see: the trade you are going for (the item and its bazaars) and what you just bought at a bazaar (the item, how many, the price). ', spEl('b', { text: 'Never' }), ' your inventory, ledger, cash, names or keys.']),
            ]),
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
        /* The seller rule: most enemies, enemies per friend */
        this.enemyInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'Most enemies', autocomplete: 'off', spellcheck: 'false', inputmode: 'numeric', 'data-focus': 'set:enemies' });
        this.enemyStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        this.enemyBox = settingBox(this.enemyInput, this.enemyStateEl, {
            show: (p) => String(p.sellerMostEnemies ?? SELLER_MOST_ENEMIES),
            read: (text) => {
                const n = readWholeNumber(text);
                return n !== null && n >= 0 ? { patch: { sellerMostEnemies: n } } : { error: 'Type a whole number, 0 or more.' };
            },
        });
        this.perFriendInput = spEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'Enemies per friend', autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal', 'data-focus': 'set:perfriend' });
        this.perFriendStateEl = spEl('div', { class: 'sp-keystate', role: 'status' });
        this.perFriendBox = settingBox(this.perFriendInput, this.perFriendStateEl, {
            show: (p) => String(p.sellerEnemiesPerFriend ?? SELLER_ENEMIES_PER_FRIEND),
            read: (text) => {
                const n = Number(String(text).replace(/[,\s]/g, ''));
                return String(text).trim() !== '' && n >= 0 && n <= 100 ? { patch: { sellerEnemiesPerFriend: n } } : { error: 'Type a number from 0 to 100.' };
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
        this.usageView = new UsageView({ getExtras: () => (this.h.getExtras ? this.h.getExtras() : []) });
        section('api', 'API use', [
            'Every request this script sends, from every tab - Torn Bids and Torn\'s pages - by what it was for. ',
            'Torn\'s limit is shared by everything you run with your keys, so its calls wait in lanes: what you are doing now goes first, statuses and the Ledger wait for room.',
        ], [this.usageView.el]);

        /* Report a problem (3.15): your words, screenshots, the problem log - one zip to send */
        group('Help');
        this.reportView = new ReportView({ getReport: () => (this.h.getReport ? this.h.getReport() : { log: [] }), onClearLog: () => this.h.onClearLog && this.h.onClearLog(), getExtras: () => (this.h.getExtras ? this.h.getExtras() : []) });
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
            field('Sellers', null, [
                spEl('div', { class: 'sp-inline sp-pct' }, ['Skip a seller with over ', this.enemyInput, ' enemies']),
                this.enemyStateEl,
                spEl('div', { class: 'sp-inline sp-pct' }, ['or over ', this.perFriendInput, ' enemies per friend']),
                this.perFriendStateEl,
                note(['From their Torn profile. Not read yet: bought from.']),
            ]),
            // Blacklisted traders, with Undo - here too, for anyone without a Ledger key (3.14.3).
            field('Blacklisted traders', null, [
                (this.blackListEl = spEl('div', { class: 'sp-keeplist' })),
                note(['Never a buyer in flips, trades or Where to sell. Their bazaars are still bought from.']),
            ]),
        ]);

        /*
         * Bazaar prices (3.20, the owner: "make it live in settings where they
         * can change up to 10 mins"): how often each group is read again, and
         * whether TornW3B's reads a minute can keep up with that.
         */
        this.freshSelects = {};
        const freshSelect = (key, label) => {
            const sel = spEl('select', { class: 'sp-cat sp-fresh', 'aria-label': label, 'data-focus': 'set:' + key });
            for (let m = FRESH_MIN; m <= FRESH_MAX; m += 1) sel.appendChild(spEl('option', { value: String(m), text: m === 1 ? 'Every minute' : 'Every ' + m + ' minutes' }));
            sel.addEventListener('change', () => this.h.onPrefsChange && this.h.onPrefsChange({ [key]: Number(sel.value) }));
            this.freshSelects[key] = sel;
            return sel;
        };
        this.keepUpEl = spEl('div', { class: 'sp-keepup', role: 'status' });
        section('fresh', 'Bazaar prices', 'How often each item\'s bazaars are read again from TornW3B. Faster is fresher; TornW3B itself sees a bazaar every few minutes.', [
            field('Desk and trade items', 'The item on the desk, and the items of the trade you are working on', [freshSelect('freshDeskMin', 'Desk and trade items: read every')]),
            field('Top ' + FRESH_TOP + ' flips', 'The best possible flips', [freshSelect('freshTopMin', 'Top ' + FRESH_TOP + ' flips: read every')]),
            field('Other possible flips', 'Every other item a trader pays more for than a bazaar asks', [freshSelect('freshOtherMin', 'Other possible flips: read every'), this.keepUpEl]),
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
            class: 'sp-link sp-quiet sp-danger',
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
        section('ledger', 'Torn Ledger', 'Your profit from your own Torn log. It needs a Full key, kept apart from your Limited key and used for nothing else.', [
            field('Full key', 'Never shown again once saved', [
                spEl('div', { class: 'sp-inline' }, [this.ledgerKeyInput, this.ledgerForgetBtn]),
                this.ledgerStateEl,
                note(['Torn is asked whether it is a Full key before it is saved; anything else is refused. It is sent only to api.torn.com, only for your log, your trades and key info. Paste a new one to change it.']),
            ]),
        ]);

        /* preferences */
        group('Other');
        this.linksInput = spEl('input', { type: 'checkbox' });
        this.linksInput.addEventListener('change', () => this.h.onPrefsChange && this.h.onPrefsChange({ linksNewTab: this.linksInput.checked }));
        section('links', 'Links', null, [
            field('Where links open', null, [spEl('label', { class: 'sp-check' }, [this.linksInput, spEl('span', { text: 'Open links in a new tab' })])]),
        ]);

        /*
         * Key use (Torn's API terms), once for every key: it was a table under each. The server's column
         * shows only to the server's own people (renderShared).
         */
        const tos = spEl('table', { class: 'sp-tos' });
        this.tosEl = tos;
        tos.appendChild(spEl('tr', {}, [spEl('th'), spEl('th', { text: 'Limited key' }), spEl('th', { text: 'Public key (NPC Arbitrage)' }), spEl('th', { text: 'Full key (Torn Ledger)' }), spEl('th', { class: 'tos-sv', text: 'Public key on the shared server' })]));
        // The Public key's column (3.26.0: it can be pasted on this page now) says what its panel on Torn's pages says.
        for (const [k, limited, open, full, server] of [
            ['Data storage', 'Only locally, in this browser', 'Only locally, in this browser', 'Only locally, in this browser: time, item, quantity, price, where, who. Never the log\'s own text.', 'On the server: the bazaar prices your key read, and how many requests this PC made of TornW3B, TornExchange and Torn (counts only). Nothing about your account.'],
            ['Data sharing', 'Nobody', 'Nobody', 'Nobody. Your trades go into a zip only when you download one yourself (Report a problem, Export API usage): it names the traders you traded with, and you choose who gets it.', 'The people on this server only.'],
            ['Purpose of use', 'Personal gain: who pays most for your items, and flips', 'Competitive advantage: finding Bazaar and Item Market listings below NPC or market value, and filling your own listing prices', 'Personal: profit tracking', 'Reading bazaars for the group, while any of you is on.'],
            ['Key storage & sharing', 'Stored locally / Not shared', 'Stored locally / Not shared. A one-way code made from it, never the key, is sent to Torn Bids\' own server to ask whether this PC is one of its people.', 'Stored locally / Not shared', 'Kept on the server as a secret that cannot be read back. Shared with no one.'],
            ['Key access level', 'Limited (your inventory and your own id; item names; Item Market prices; traders\' public status and networth)', 'Public (item names and shop prices; Item Market prices; key info; bazaar owners\' public status; your own id)', 'Full, used only for your log (bazaar, Item Market and NPC shop buys and sells, and muggings), your trades, and key info', 'Public Only'],
            ['Other services', 'TornExchange, only with the key you log in there with. TornW3B, only if the key you paste in the TornW3B box is this one', 'None: TornW3B receives item ids only, never this key', 'None: never sent to TornExchange or TornW3B', 'None'],
        ]) {
            tos.appendChild(spEl('tr', {}, [spEl('th', { text: k }), spEl('td', { text: limited }), spEl('td', { text: open }), spEl('td', { text: full }), spEl('td', { class: 'tos-sv', text: server })]));
        }
        section('terms', 'Key use', 'Torn\'s API terms: what each key is used for, and where it is kept.', [tos]);

        // The order on each tab, top to bottom: what you set first, what you only read last.
        for (const id of ['keys', 'te', 'w3b', 'shared', 'ledger', 'terms', 'flips', 'fresh', 'links', 'report', 'api']) {
            const x = this.snavSections.find((y) => y.id === id);
            if (x) body.appendChild(x.sec);
        }

        this.settingsEl.appendChild(box);
    }

    /** Settings › Bazaar prices: the saved minutes, and whether they keep up. */
    renderFresh(p) {
        if (!this.keepUpEl) return;
        const minutes = {
            desk: freshMinutes(p.freshDeskMin, FRESH_DEFAULTS.desk),
            top: freshMinutes(p.freshTopMin, FRESH_DEFAULTS.top),
            other: freshMinutes(p.freshOtherMin, FRESH_DEFAULTS.other),
        };
        for (const [key, m] of [['freshDeskMin', minutes.desk], ['freshTopMin', minutes.top], ['freshOtherMin', minutes.other]]) {
            const sel = this.freshSelects[key];
            if (sel && sel.value !== String(m)) sel.value = String(m);
        }
        const info = this.state.info || {};
        // Before the flips are known: as many as a page usually has.
        const counts = info.freshCounts && info.flipsWanted ? info.freshCounts : { desk: 1, top: FRESH_TOP, other: 130 };
        const k = keepsUp(minutes, counts, info.w3bPerMin || 60);
        const text = k.ok
            ? 'Keeps up: every group is asked again on time. TornW3B allows only a few reads of an item\'s bazaars a minute (Keys and sharing › TornW3B), so between two of them only the ten cheapest prices are checked, and the bazaars are read again when those changed. Room is left for traders\' price lists.'
            : k.otherEvery
                ? 'Can\'t keep up: the other possible flips would be read about every ' + k.otherEvery + ' minutes instead. The desk and the top ' + FRESH_TOP + ' still come first.'
                : 'Too fast to keep up: the other possible flips would hardly be read. The desk and the top ' + FRESH_TOP + ' still come first.';
        const cls = 'sp-keepup ' + (k.ok ? 'sp-keepup-ok' : 'sp-keepup-behind');
        if (this.keepUpEl.textContent !== text) this.keepUpEl.textContent = text;
        if (this.keepUpEl.className !== cls) this.keepUpEl.className = cls;
    }

    /** Settings › Shared: what is saved, what the server last said, and how your 100 calls are split. */
    renderShared() {
        if (!this.sharedNowEl) return;
        const st = (this.state.info || {}).shared || null;
        const now = Date.now();
        // Only for the server's own people: to anyone else there is no server, and no part of Settings for one.
        const sec = (this.snavSections.find((x) => x.id === 'shared') || {}).sec;
        if (sec) sec.classList.toggle('sp-unknown', !sharedKnown(st));
        if (this.tosEl) this.tosEl.classList.toggle('no-sv', !sharedKnown(st));
        const say = (el, line) => {
            const cls = 'sp-keystate' + (line.level === 'ok' ? ' sp-ok' : line.level === 'bad' ? ' sp-bad' : line.level === 'warn' ? ' sp-warn' : '');
            if (el.textContent !== line.text) el.textContent = line.text;
            if (el.className !== cls) el.className = cls;
            el.hidden = !line.text;
        };
        say(this.sharedNowEl, sharedNowLine(st, now));
        say(this.sharedKeyEl, sharedKeyLine(st));
        const split = sharedSplit(st, now);
        this.sharedUseEl.hidden = !split;
        if (split) {
            for (const [el, label, n] of [[this.sharedUsePc, 'This PC', split.pc], [this.sharedUseSv, 'Server', split.server], [this.sharedUseFr, 'Free', split.free]]) {
                const text = label + ' ' + n;
                if (el.textContent !== text) el.textContent = text;
                el.style.width = n + '%';
                el.hidden = !(n > 0);
            }
        }
        say(this.sharedUseNote, split ? { level: '', text: '' } : { level: '', text: st && st.on ? 'Not agreed with the server yet: this PC uses your calls alone, as before.' : 'Shared is off: this PC uses your calls alone, as before.' });
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
            shared: (() => {
                const st = info.shared || null;
                if (!sharedKnown(st)) return ['unknown', 'off'];
                const level = sharedNowLine(st, now).level;
                return [level === 'ok' ? 'online' : level === 'bad' ? 'bad' : 'idle', level === 'bad' ? 'refused' : level === 'ok' ? (st.people ? st.people + (st.people === 1 ? ' person' : ' people') : 'on') : 'no answer'];
            })(),
            flips: p.cash > 0 ? ['online', formatMoney(p.cash) + ' · ' + (p.networthPct || 10) + '%'] : ['idle', 'no cash limit'],
            fresh: ['online', freshMinutes(p.freshDeskMin, FRESH_DEFAULTS.desk) + ' · ' + freshMinutes(p.freshTopMin, FRESH_DEFAULTS.top) + ' · ' + freshMinutes(p.freshOtherMin, FRESH_DEFAULTS.other) + ' min'],
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
        // What needs you is seen from any tab: a mark on the tab that holds it (a key refused, a key Torn Bids cannot work without).
        const need = [null, null, null];
        for (const n of this.snav) {
            const level = (states[n.id] || [])[0];
            const flag = level === 'bad' ? 'bad' : level === 'unknown' && (n.id === 'keys' || n.id === 'te') ? 'warn' : null;
            const t = BD_SET_OF[n.id];
            if (flag && (flag === 'bad' || !need[t])) need[t] = flag;
        }
        this.setFlags = need;
        this.flagSettingsTabs();

        const read = info.w3bRead || 0;
        const known = info.w3bKnown || 0;
        const parts = [];
        parts.push(known ? count(read) + ' of ' + count(known) + ' price lists read' : 'No trader known yet');
        parts.push(info.bazaarsAt ? 'bazaar prices ' + formatAge(now - info.bazaarsAt) : 'bazaar prices loading');
        if (info.flipsWanted) parts.push('possible flips priced ' + (info.flipsPriced ?? info.flipsChecked) + ' of ' + info.flipsWanted + ', bazaars read ' + info.flipsChecked);
        if (info.pricesWaiting) parts.push(count(info.pricesWaiting) + (info.pricesWaiting === 1 ? ' possible flip waits' : ' possible flips wait') + ' for a price check');
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

    /**
     * A trade stays still (3.25.0; mockup AA, drawing 2). While a trade is under way the list and the
     * cards keep their order; this is the one line that says so and counts the deals waiting:
     *
     *   Held while you trade with Lumei. 3 new deals waiting · best +$41,200      [Show ▸]
     *
     * Opened, it lists them ("Let them in now" sorts once; "Keep waiting" folds it). With nothing
     * waiting it still says the list is held - on purpose, not stuck. When the trade ends, one green
     * line for a few seconds.
     */
    renderStill() {
        const s = this.state;
        const held = s.still || null;
        const line = held ? stillLine({ trader: held.trader }, held.waiting || [], held.now, signed) : null;
        const ended = s.stillEnded || null;
        // The box, with its Show and its way in, is on Flips only; My items says it in one quiet line.
        const quiet = s.filter === 'mine';
        const onList = s.filter !== 'sell' && s.filter !== 'trades';
        if (!line || !line.count) this.stillOpen = false;
        const sig = JSON.stringify([line, ended, this.stillOpen, onList, quiet]);
        if (sig === this.stillSig) return;
        this.stillSig = sig;

        this.stillTag.hidden = !line;
        this.stillTag.textContent = line ? 'Held' + (line.count ? ' · ' + count(line.count) + ' new waiting' : '') : '';

        const box = this.stillEl;
        const refocus = this.focusKeyIn(box);
        box.textContent = '';
        box.hidden = !onList || (!line && !ended) || (quiet && !line);
        if (box.hidden) return;
        if (quiet) {
            box.appendChild(spEl('div', { class: 'sp-still sp-still-none', role: 'status' }, [spEl('span', { class: 'sp-dot sp-dot-off' }), spEl('span', { class: 'sp-still-t', text: 'Held while you trade with ' + held.trader + '. ' + (line.count ? 'The waiting deals are on Flips.' : 'New deals wait on Flips.') })]));
            return;
        }
        if (ended) {
            box.appendChild(spEl('div', { class: 'sp-still sp-still-done', role: 'status' }, [spEl('span', { class: 'sp-dot sp-dot-done' }), spEl('span', { class: 'sp-still-t', text: ended })]));
            return;
        }
        const open = this.stillOpen;
        box.appendChild(spEl('div', { class: 'sp-still' + (line.count ? '' : ' sp-still-none'), role: 'status' }, [
            spEl('span', { class: 'sp-dot ' + (line.count ? 'sp-dot-wait' : 'sp-dot-off') }),
            spEl('span', { class: 'sp-still-t' }, [line.lead + ' ', line.count ? spEl('b', { text: line.rest }) : line.rest]),
            line.count
                ? spEl('button', {
                    type: 'button',
                    class: 'sp-btn sp-still-show',
                    'data-focus': 'still:show',
                    'aria-expanded': String(open),
                    title: open ? 'Fold the waiting deals' : 'Look at the waiting deals. Nothing comes in until you say so.',
                    text: open ? 'Show ▾' : 'Show ▸',
                    onclick: () => {
                        this.stillOpen = !open;
                        this.renderStill();
                    },
                })
                : null,
        ]));
        if (open) {
            box.appendChild(spEl('div', { class: 'sp-still-fold' }, [
                ...line.rows.slice(0, STILL_PEEK).map((w) => {
                    const cut = w.text.indexOf(' → ') >= 0 ? w.text.indexOf(' → ') : w.text.indexOf(' · ');
                    return spEl('button', { type: 'button', class: 'sp-still-w', 'data-focus': 'still:' + w.itemId, title: 'Look at it on the desk. It stays waiting.', onclick: () => this.select(w.itemId) }, [
                        spEl('b', { text: cut >= 0 ? w.text.slice(0, cut) : w.text }),
                        spEl('small', { text: cut >= 0 ? w.text.slice(cut) : '' }),
                        spEl('span', { text: w.profit }),
                    ]);
                }),
                line.rows.length > STILL_PEEK ? spEl('small', { class: 'sp-still-more', text: 'and ' + count(line.rows.length - STILL_PEEK) + ' more, smaller' }) : null,
                spEl('div', { class: 'sp-still-acts' }, [
                    spEl('button', { type: 'button', class: 'sp-btn sp-primary', 'data-focus': 'still:let', title: 'The new deals come in and the rows sort, once. Your trade goes on.', text: 'Let them in now', onclick: () => {
                        this.stillOpen = false;
                        if (this.h.onStillLet) this.h.onStillLet();
                    } }),
                    spEl('button', { type: 'button', class: 'sp-btn', 'data-focus': 'still:keep', text: 'Keep waiting', onclick: () => {
                        this.stillOpen = false;
                        this.renderStill();
                    } }),
                ]),
            ]));
        }
        this.focusBack(box, refocus);
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
        this.catEl.classList.toggle('on', Boolean(s.category));
    }

    renderKeyStates() {
        const info = this.state.info || {};

        // Nothing to forget, nothing offered.
        this.keyForgetBtn.hidden = !info.hasKey;
        this.teForgetBtn.hidden = !info.hasTeKey;
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

        // The Public key: NPC Arbitrage's, the same one its panel on Torn's pages shows.
        const pk = info.publicKey || {};
        this.pubForgetBtn.hidden = !pk.has;
        this.pubStateEl.className = 'sp-keystate';
        if (pk.error) {
            this.pubStateEl.textContent = pk.error;
            this.pubStateEl.classList.add('sp-bad');
        } else if (!pk.has) {
            this.pubStateEl.textContent = 'No key saved: NPC Arbitrage on Torn\'s pages is off.';
        } else {
            const access = pk.access ? String(pk.access).replace(/\s*access$/i, '') : '';
            this.pubStateEl.textContent = 'Saved' + (access ? ' · ' + access + ' access' : '') + '.' + (pk.over ? ' A Public Only key is enough here.' : '');
            this.pubStateEl.classList.add(pk.over ? 'sp-warn' : 'sp-ok');
        }
        const serverSays = pk.has ? sharedKeyBoxLine(info.shared || null) : '';
        if (this.pubServerEl.textContent !== serverSays) this.pubServerEl.textContent = serverSays;
        this.pubServerEl.hidden = !serverSays;

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

        // The key registered on TornW3B, and what is left of its sellers lists (their own minute and day).
        // (The minute's count moves every few seconds: not on a settings page. The day's is said.)
        const L = info.w3bListing || null;
        // 3.26.1: the day is paced, so the hour's share is said too (it is what holds the reads, not the minute).
        const left = L ? ' · ' + count(L.day) + ' of 900 today' + (L.hourLeft !== null && L.hourLeft !== undefined ? ', up to ' + count(L.hourLeft) + ' more this hour' : '') : '';
        this.w3bKeyStateEl.className = 'sp-keystate';
        if (info.w3bKeyMsg) {
            this.w3bKeyStateEl.textContent = info.w3bKeyMsg;
            this.w3bKeyStateEl.classList.add('sp-bad');
        } else if (info.w3bKey === 'refused') {
            this.w3bKeyStateEl.textContent = 'TornW3B does not know this key: it is not sent. An item\'s bazaars: 8 reads a minute' + left + '.';
            this.w3bKeyStateEl.classList.add('sp-bad');
        } else if (info.w3bKey === 'saved') {
            this.w3bKeyStateEl.textContent = 'Saved · an item\'s bazaars: 22 reads a minute' + left + '.';
            this.w3bKeyStateEl.classList.add('sp-ok');
        } else {
            this.w3bKeyStateEl.textContent = 'No key saved · an item\'s bazaars: 8 reads a minute' + left + '.';
        }
        this.w3bKeyForgetBtn.hidden = info.w3bKey === 'none' || !info.w3bKey;
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
        // A pulse keeps its beat with the clock: a row drawn again picks it up where it was, never starts it over.
        if (/\bte-(pulse|warn)\b/.test(cls)) a.style.animationDelay = -(Date.now() % 1600) + 'ms';
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
        return this.link(name, spProfileUrl(id), { cls: 'pname', title: 'Their profile on Torn', focus });
    }

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

    /** A held row's or card's number changed since the list was held: ▲ or ▼ beside it (the row itself stays put). */
    stillMark(st) {
        if (!st || !st.move) return null;
        const up = st.move === 'up';
        return spEl('small', { class: 'sp-chg ' + (up ? 'sp-chg-up' : 'sp-chg-dn'), title: (up ? 'Higher' : 'Lower') + ' than when the list was held. It keeps its place until your trade ends.', text: up ? ' ▲' : ' ▼' });
    }

    /** Why there is no flip to show: still loading, still checking, or none. */
    noFlipsText() {
        const info = this.state.info || {};
        if (!info.bazaarsAt) return 'Loading bazaar prices…';
        // Never "looking" forever when TornExchange has refused the key (review M13).
        if (info.teBadKey && !info.knownTraders) return 'No traders: TornExchange refused the key.';
        // Buyers online only (3.20.5): flips are found, their buyers' statuses are being read.
        if (info.flipsWaiting) return 'Checking who is online…';
        // 3.26.0: a flip is shown only once TornW3B confirmed its buyer's price minutes ago.
        if (info.pricesWaiting) return 'Checking the price of ' + count(info.pricesWaiting) + (info.pricesWaiting === 1 ? ' possible flip' : ' possible flips') + ' with its trader…';
        if (info.flipsChecked < info.flipsWanted) return 'No flips found yet. Checking ' + info.flipsChecked + ' of ' + info.flipsWanted + '.';
        // A trade under way holds the list as it was: empty then, empty now, and that is said - before
        // "Looking for traders", which a held list is not doing.
        const held = this.state.still;
        if (held && held.trader) return 'No flips were here when the list was held for your trade with ' + held.trader + '.';
        if (info.tradersLoading) return 'Looking for traders…';
        return 'No flips with these settings right now.';
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
        return spEl('span', { class: 'badge trust', 'data-level': t.level.toLowerCase(), title: parts.join(' · '), 'aria-label': t.level + (parts.length ? ': ' + parts.join(', ') : ''), text: t.level + score });
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
/*
 * 3.20 Graphite (mockups/T-graphite-everything.html, picked by the owner):
 * four surface steps so areas separate (page, rail, card, raised), one
 * colour per meaning, system fonts, Georgia for titles, figures in columns.
 */
.sp-page {
${TOKENS_CSS}
    --card: var(--surface); --card2: var(--raised);
    --cline: var(--line); --cline2: var(--line2); --price: var(--profit); --green-bg: var(--profit-bg);
    --hot: var(--surface); --hot-line: var(--profit-line); --orange: #ff9b5a; --head-h: 60px;
    position: absolute; inset: 0; display: flex; flex-direction: column;
    background: var(--page); color: var(--text);
    font: 400 13px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
a { color: var(--offer); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
b { font-weight: 600; }
[hidden] { display: none !important; }
.sp-bad { color: var(--bad); }
.sp-note { margin: 0; font-size: 12px; color: var(--muted); }
.sp-muted { color: var(--muted); font-size: 12px; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible,
[role="button"]:focus-visible { outline: 2px solid var(--profit); outline-offset: 2px; }
@keyframes sp-rise { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes sp-pop { 0% { transform: scale(1); } 50% { transform: scale(1.25); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }

/* ---------------------------------------------------------------- header */
.sp-head {
    flex: 0 0 auto; height: var(--head-h); display: flex; align-items: center; gap: 12px; padding: 0 24px;
    background: var(--rail); border-bottom: 1px solid var(--line);
}
.sp-brand { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
.sp-mark { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(145deg, #a3adff, #7381ff); color: #0b0e24; display: grid; place-items: center; font: 800 16px var(--sans); }
.sp-brand h1 { margin: 0; font: 400 21px/1 var(--serif); color: var(--text); letter-spacing: -0.01em; }
.sp-brand { border-radius: 10px; outline-offset: 4px; }
.sp-brand.sp-brand-back { cursor: pointer; }
.sp-brand.sp-brand-back:hover h1 { color: var(--brand); }
.sp-crumb { font: 400 21px/1 var(--serif); color: var(--muted); letter-spacing: -0.01em; }
.sp-tagline { color: var(--muted); font-size: 12px; }
.sp-search { flex: 1; min-width: 0; max-width: 420px; height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line2); background: var(--input); color: var(--text); transition: border-color 0.15s var(--ease); }
.sp-search:focus { border-color: var(--brand); outline: none; }
.sp-search::placeholder { color: var(--faint); }
.sp-cat { flex: 0 0 auto; height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--line2); background: var(--surface); color: var(--text); font: inherit; font-weight: 500; cursor: pointer; }
.sp-cat.sp-cat-on { border-color: var(--profit-line); background: var(--profit-bg); color: var(--text); }
/* The list a dropdown opens (3.22.1): its own dark ground and light words. It took the box's see-through
   green over the browser's white list once a category was picked - white words on near-white. */
.sp-cat, select { color-scheme: dark; }
.sp-cat option, select option, select optgroup { background-color: #1c1e23; color: #e6e8ee; }
.sp-catline { display: flex; align-items: center; gap: 8px; margin: -12px 0 16px; font-size: 12px; color: var(--muted); }
.sp-catline b { color: var(--text); }
.sp-catline .sp-link { font-size: 12px; }
.sp-pills { margin-left: auto; display: flex; gap: 6px; }
.sp-pill { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 11px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font-size: 12px; color: var(--muted); white-space: nowrap; cursor: default; font-variant-numeric: tabular-nums; }
.sp-pill b { color: var(--text); font-weight: 600; }
.sp-pill-btn { cursor: pointer; }
.sp-pill-btn:hover { border-color: var(--line2); color: var(--text); background: var(--raised); }
.sp-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 10px; border: 1px solid var(--line2); background: var(--raised); cursor: pointer; font-size: 15px; color: var(--text); transition: background-color 0.15s var(--ease); }
.sp-icon:hover { background: var(--hover); }
.sp-icon[aria-pressed="true"] { color: var(--profit); border-color: var(--profit-line); }
.sp-hbtn { height: 34px; padding: 0 12px; flex: 0 0 auto; border-radius: 10px; border: 1px solid var(--line2); background: var(--raised); cursor: pointer; font-weight: 500; color: var(--text); white-space: nowrap; transition: background-color 0.15s var(--ease); }
.sp-hbtn:hover { background: var(--hover); }
.sp-hbtn[aria-pressed="true"] { color: var(--profit); border-color: var(--profit-line); }
.sp-link.sp-danger { color: var(--bad); }

.sp-banner {
    display: none; align-items: center; gap: 12px; flex: 0 0 auto;
    margin: 16px 24px 0; padding: 12px 16px; color: var(--text2);
    background: var(--buy-bg); border: 1px solid var(--buy-line); border-radius: 12px;
}
.sp-banner > span { flex: 1; }
.sp-banner-on { display: flex; animation: sp-rise 0.2s var(--ease); }
.sp-banner-warn { background: var(--warn-bg); border-color: var(--warn-line); }
.sp-banner-bad { background: var(--bad-bg); border-color: var(--bad-line); }

/* ------------------------------------------------------------ buttons */
a.sp-btn { display: inline-flex; align-items: center; text-decoration: none; }
.sp-btn {
    height: 32px; padding: 0 12px; font-size: 13px; font-weight: 500; color: var(--text);
    background: var(--raised); border: 1px solid var(--line2); border-radius: 10px; cursor: pointer; white-space: nowrap;
    transition: background-color 0.15s var(--ease);
}
.sp-btn:hover { background: var(--hover); }
.sp-btn:disabled { opacity: 0.45; cursor: default; }
.sp-btn:disabled:hover { background: var(--raised); }
.sp-btn.sp-primary { color: var(--on-profit); background: var(--profit); border-color: transparent; font-weight: 600; }
.sp-btn.sp-primary:hover { background: #86e594; }
.sp-link { background: none; border: 0; padding: 0; color: var(--offer); font-size: 12px; cursor: pointer; text-align: left; }
.sp-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.sp-toggle { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line2); background: var(--surface); color: var(--text2); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: background-color 0.15s var(--ease); }
.sp-toggle:hover { color: var(--text); background: var(--raised); }
.sp-toggle[aria-pressed="true"] { color: var(--text); border-color: var(--profit-line); background: var(--profit-bg); }

/* ----------------------------------------------------- one scroll, full width */
.sp-main { flex: 1; min-height: 0; overflow-y: auto; }
.sp-wrap { padding: 24px 24px 64px; }
.sp-sec { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; }
.sp-sec h2 { margin: 0; font: 650 11px/1 var(--sans); letter-spacing: 0.09em; text-transform: uppercase; color: var(--text2); white-space: nowrap; display: flex; align-items: center; gap: 8px; }
.sp-sec h2::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: var(--c, var(--faint)); flex: 0 0 auto; }
.sp-sec-flips { --c: var(--profit); }
.sp-scan { --c: var(--fav); }
.sp-sp { flex: 1; }
.sp-empty { padding: 28px 16px; text-align: center; color: var(--muted); background: transparent; border: 1px dashed var(--line2); border-radius: 16px; }
.sp-more { display: block; margin: 12px auto 0; }

/* the strip: the best flips, whatever item they are */
.sp-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.sp-strip-empty { grid-column: 1 / -1; }
.sp-fc { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 16px; text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; cursor: pointer; transition: background-color 0.15s var(--ease), border-color 0.15s var(--ease); }
.sp-fc:hover { background: var(--raised); }
.sp-fc.sp-sel { border-color: var(--profit-line); box-shadow: inset 0 0 0 1px var(--profit-line); }
.sp-fc-top { display: flex; align-items: center; gap: 10px; }
.sp-fc .sp-iname { font: 600 14px/1.3 var(--sans); }
.sp-fc-p { font: 650 20px/1.15 var(--sans); color: var(--profit); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.sp-fc small { font-size: 12px; color: var(--muted); line-height: 1.55; }
.sp-fc small b { color: var(--text2); }
.sp-fc-sell { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.sp-fc-sell .sp-trust { margin-left: 2px; }
.sp-seen { display: flex; align-items: center; gap: 6px; margin-top: auto; color: var(--faint) !important; font-variant-numeric: tabular-nums; }
.sp-seen .sp-dot { width: 6px; height: 6px; }

/* Your traders (3.20): a gold row of favourites, then Trusted */
.sp-tgroups { display: grid; gap: 12px; }
.sp-tgroup { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; align-items: stretch; }
.sp-tlabel { display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); }
.sp-tlabel b { font: 400 16px/1.2 var(--serif); }
.sp-tlabel small { color: var(--muted); font-size: 12px; }
.sp-tg-fav .sp-tlabel { background: linear-gradient(160deg, rgba(255, 204, 77, 0.14), rgba(255, 204, 77, 0.03)); border-color: var(--fav-line); }
.sp-tg-fav .sp-tlabel b { color: var(--fav); }
.sp-tg-trust .sp-tlabel b { color: var(--trust); }
.sp-tg-empty { display: grid; place-items: center; gap: 6px; padding: 20px 16px; }
.sp-tg-empty b { color: var(--text2); }
.sp-fc.sp-tc-fav { border-color: var(--fav-line); background: linear-gradient(180deg, rgba(255, 204, 77, 0.06), var(--surface) 55%); }
.sp-fc.sp-tc-fav:hover { background: linear-gradient(180deg, rgba(255, 204, 77, 0.09), var(--raised) 55%); }
.sp-fc.sp-tc-hidden { opacity: 0.62; }
.sp-tc-why { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.sp-tc-why b { color: var(--text2); }

/* the desk: every item on the left, the one picked on the right */
.sp-desk { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; }
.sp-col-list { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sp-chips { display: grid; grid-template-columns: repeat(5, auto); gap: 2px; padding: 3px; margin-bottom: 4px; border-radius: 11px; background: var(--input); border: 1px solid var(--line); }
.sp-chip-f { height: 28px; border-radius: 8px; border: 0; background: none; color: var(--muted); font-weight: 500; cursor: pointer; white-space: nowrap; transition: background-color 0.15s var(--ease); }
.sp-chip-f small { font-weight: 400; font-size: 12px; margin-left: 5px; color: var(--faint); font-variant-numeric: tabular-nums; }
.sp-chip-f:hover { color: var(--text); }
.sp-chip-f[aria-pressed="true"] { color: var(--text); background: var(--raised); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }
/* To sell (3.21.0, mockup U): the tab, its rows, its board */
.sp-chip-f.sp-chip-has small { color: var(--buy); font-weight: 600; }
.sp-why { font: 600 11px/18px var(--sans); height: 18px; padding: 0 7px; border-radius: 999px; white-space: nowrap; color: var(--muted); background: rgba(255, 255, 255, 0.07); flex: 0 0 auto; }
.sp-why[data-why="cancel"] { color: var(--warn); background: var(--warn-bg); }
.sp-why[data-why="extra"] { color: var(--buy); background: var(--buy-bg); }
.sp-why[data-why="old"] { color: var(--warn); background: var(--warn-bg); }
/* The Trades tab (3.22.0, mockup V): a row per trade, and its board by stage. */
.sp-it.sp-tl { grid-template-columns: minmax(0, 1fr) auto; }
.sp-it.sp-tl small { grid-column: 1 / 3; }
.sp-st { align-self: start; font-weight: 600; }
.sp-st-ask { color: var(--warn); background: var(--warn-bg); }
.sp-st-yes { color: var(--buy); background: var(--buy-bg); }
.sp-st-go { color: var(--profit); background: var(--profit-bg); }
.sp-tb-stage { margin-bottom: 16px; }
.sp-tb-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 0 2px 6px; }
.sp-tb-h small, .sp-tb-r small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.sp-tb-r small b { color: var(--text); font-weight: 600; }
.sp-tb-r { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 9px 12px; margin-bottom: 5px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); }
.sp-tb-r.sp-tb-ask { border-color: var(--warn-line, rgba(246, 183, 74, 0.42)); }
.sp-tb-r.sp-tb-yes { border-color: var(--buy-line); }
.sp-tb-r.sp-tb-go { border-color: var(--profit-line); background: var(--profit-bg); }
.sp-tb-r.sp-tb-end { background: transparent; }
.sp-tb-end .sp-bd-who { color: var(--muted); font-weight: 600; }
.sp-tb-arrow { color: var(--buy) !important; }
.sp-it.sp-ts { grid-template-columns: 44px minmax(0, 1fr) auto; }
.sp-ts-top { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
.sp-it.sp-ts.sp-sel { border-color: var(--buy-line); background: var(--buy-bg); }
.sp-ts-wait .sp-iname { color: var(--text2); }
.sp-badge-kept { color: var(--muted); background: rgba(255, 255, 255, 0.07); font-weight: 600; align-self: start; }
.sp-link.sp-keep { color: var(--muted); white-space: nowrap; padding: 4px 2px; }
.sp-link.sp-keep:hover, .sp-link.sp-keep:focus-visible { color: var(--text); }
.sp-bd-kept .sp-link.sp-keep { color: var(--offer); }
.sp-badge-tosell { color: var(--buy); background: var(--buy-bg); align-self: start; }
.sp-badge-wait { color: var(--warn); background: var(--warn-bg); font-weight: 600; align-self: start; }
.sp-bd-top { margin-bottom: 16px; }
.sp-bd-g { border: 1px solid var(--line); border-radius: 14px; padding: 10px; margin-bottom: 10px; background: var(--surface); }
.sp-bd-g.sp-bd-ready { border-color: var(--buy-line); }
.sp-bd-g.sp-bd-wait { background: transparent; }
.sp-bd-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 2px 2px 10px; }
.sp-q-tosell { border-color: var(--buy-line); }
.sp-bd-who { font-size: 14px; font-weight: 700; }
.sp-bd-who .sp-pname { font-size: inherit; font-weight: inherit; text-decoration: none; }
.sp-bd-who .sp-pname:hover, .sp-ts small .sp-pname:hover, .sp-bd-r small .sp-pname:hover { text-decoration: underline; text-underline-offset: 3px; }
.sp-ts small .sp-pname, .sp-bd-r small .sp-pname { font-size: inherit; text-decoration: none; }
.sp-iname .sp-tiname { font: inherit; color: inherit; }
.sp-tb-end .sp-bd-who .sp-pname, .sp-bd-wait .sp-bd-who .sp-pname { color: inherit; }
.sp-bd-wait .sp-bd-who { color: var(--muted); font-weight: 600; }
.sp-bd-h small, .sp-bd-r small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.sp-bd-r small b { color: var(--text); font-weight: 600; }
.sp-bd-gain { font: 650 14px/1.2 var(--sans); color: var(--profit); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-bd-short { font: 600 13px/1.2 var(--sans); color: var(--warn); white-space: nowrap; }
.sp-bd-gain.sp-bd-baz { color: var(--offer); }
.sp-bd-r { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 9px 10px; margin-bottom: 4px; border-radius: 10px; background: var(--rail); border: 1px solid transparent; cursor: pointer; }
.sp-bd-r:last-child { margin-bottom: 0; }
.sp-bd-r:hover { border-color: var(--line); }
.sp-bd-r .sp-iname { font-weight: 600; }
.sp-bd-back { display: inline-block; margin: -8px 0 12px; font-size: 13px; }
.sp-it { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; padding: 10px 12px; margin-bottom: 0; border-radius: 12px; border: 1px solid transparent; cursor: pointer; transition: background-color 0.15s var(--ease); }
.sp-it:hover { background: var(--surface); }
.sp-it.sp-sel { background: var(--surface); border-color: var(--profit-line); }
.sp-it .sp-pic { grid-row: span 2; }
.sp-it .sp-iname { font-weight: 600; }
.sp-it small { grid-column: 2 / 4; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.sp-it small:empty { display: none; }
.sp-itop { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
.sp-tag { font: 650 11px/18px var(--sans); height: 18px; padding: 0 7px; border-radius: 999px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sp-tag-friend { color: var(--known); background: rgba(184, 164, 255, 0.14); }
.sp-tag-you { color: var(--buy); background: var(--buy-bg); }
.sp-tag-gone { color: var(--muted); background: var(--raised); font-weight: 600; }
.sp-it-gone .sp-iname, .sp-badge-gone, .sp-fc-gone .sp-fc-p { color: var(--faint); text-decoration: line-through; }
.sp-badge-gone { background: rgba(255, 255, 255, 0.05); }
.sp-fc-gone { opacity: 0.6; }
.sp-chg { font-size: 10px; font-weight: 700; }
.sp-chg-up { color: var(--profit); }
.sp-chg-dn { color: var(--warn); }
.sp-fc-p .sp-chg { font-size: 12px; vertical-align: middle; }
.sp-still-box { display: grid; gap: 6px; }
.sp-still-box[hidden] { display: none; }
.sp-still { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: var(--warn-bg); border: 1px solid var(--warn-line); font-size: 12.5px; color: var(--text2); }
.sp-still b { color: var(--text); }
.sp-still-t { min-width: 0; }
.sp-still .sp-btn { margin-left: auto; flex: none; }
.sp-still-none { background: var(--surface); border-color: var(--line); }
.sp-still-done { background: var(--profit-bg); border-color: var(--profit-line); }
.sp-dot-wait { background: var(--warn); }
.sp-dot-off { background: var(--faint); }
.sp-dot-done { background: var(--profit); }
.sp-still-fold { display: grid; gap: 2px; padding: 8px; border-radius: 12px; border: 1px dashed var(--warn-line); }
.sp-still-w { display: flex; align-items: baseline; gap: 8px; padding: 4px 6px; border: 0; border-radius: 8px; background: none; color: var(--text); font: inherit; font-size: 12.5px; text-align: left; white-space: nowrap; cursor: pointer; }
.sp-still-w:hover, .sp-still-w:focus-visible { background: var(--surface); }
.sp-still-w small { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.sp-still-w span { margin-left: auto; color: var(--profit); font-weight: 700; font-variant-numeric: tabular-nums; }
.sp-still-more { padding: 2px 6px; color: var(--muted); font-size: 12px; }
.sp-still-acts { display: flex; gap: 6px; justify-content: flex-end; padding-top: 6px; }
.sp-it.sp-it-friend { border-color: rgba(184, 164, 255, 0.4); }
.sp-it-friend .sp-badge-flip { color: var(--muted); background: rgba(255, 255, 255, 0.05); }
.sp-fc.sp-fc-friend { border-color: rgba(184, 164, 255, 0.4); }
.sp-fc-friend .sp-fc-p { color: var(--muted); }
.sp-friend { display: flex; align-items: baseline; gap: 6px; color: var(--text2); }
.sp-friend b { color: var(--text); font-weight: 600; }
.sp-dot.sp-dot-friend { background: var(--known); flex: none; align-self: center; }
.sp-badge { font: 650 12px/22px var(--sans); height: 22px; padding: 0 8px; border-radius: 7px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sp-badge:empty { display: none; }
.sp-badge-flip { color: var(--profit); background: var(--profit-bg); }
.sp-badge-list { color: var(--offer); background: var(--buy-bg); }
.sp-badge-sell { color: var(--text2); background: rgba(255, 255, 255, 0.07); }

.sp-ws { position: sticky; top: 16px; min-width: 0; background: var(--rail); border: 1px solid var(--line); border-radius: 20px; padding: 24px; }
.sp-wsh { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.sp-wst { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.sp-wsname { font: 400 24px/1.15 var(--serif); color: var(--text); }
.sp-wst small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.sp-quad { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr); gap: 16px; align-items: start; }
.sp-q { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
.sp-q h3 { margin: 0 0 12px; font: 650 11px/1 var(--sans); letter-spacing: 0.09em; text-transform: uppercase; color: var(--text2); display: flex; align-items: center; gap: 8px; }
.sp-q h3::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: var(--c, var(--faint)); flex: 0 0 auto; }
.sp-q.sp-hot { background: var(--surface); border-color: var(--profit-line); --c: var(--profit); }
.sp-q.sp-wide { grid-column: 1 / -1; }
.sp-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.sp-kind { margin-left: 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.sp-kind-fast { color: var(--profit); }
.sp-kind-slow { color: var(--warn); }
.sp-left { display: block; margin-top: 4px; }
.sp-left .sp-qty { width: 96px; margin-right: 6px; }
.sp-acc-foot { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.sp-acc-foot .sp-tpick-b { gap: 8px 20px; }
.sp-link.sp-cancel { color: var(--bad); }
.sp-btn.sp-btn-bad { color: var(--bad); background: var(--bad-bg); border-color: transparent; }
.sp-btn.sp-btn-bad:hover { background: rgba(255, 123, 110, 0.2); }
.sp-cancelask { justify-content: flex-start; }
.sp-cancelask > .sp-warnnote { flex: 1 1 100%; color: var(--warn); font-size: 13px; }
.sp-tpick-b { align-items: center; }
.sp-fc.sp-lo { border-style: dashed; border-color: var(--line2); background: transparent; }
.sp-fc.sp-lo:hover { background: var(--surface); }
/* The pin sits in the card's corner, out of the flow: the card's contents
   are where they always were, pinned or not (the owner: "you moved the contents"). */
.sp-fc { position: relative; }
.sp-fc .sp-fc-top { padding-right: 30px; }
.sp-pin { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border-radius: 7px; border: 1px solid var(--line); background: transparent; color: var(--faint); cursor: pointer; transition: background-color 0.15s var(--ease); }
.sp-fc .sp-pin { position: absolute; top: 12px; right: 12px; }
.sp-pin:hover { color: var(--text); border-color: var(--line2); background: var(--raised); }
.sp-pin:focus-visible { outline: 2px solid var(--offer); outline-offset: 1px; }
.sp-pin.sp-pin-on { color: var(--buy); border-color: var(--buy-line); background: var(--buy-bg); }
.sp-it.sp-it-pin { position: relative; }
.sp-it.sp-it-pin small { padding-right: 30px; }
.sp-it .sp-pin-row { position: absolute; right: 12px; bottom: 8px; width: 22px; height: 22px; }
.sp-it.sp-pinrow { background: var(--buy-bg); border-color: var(--buy-line); }
.sp-it.sp-pinrow.sp-sel { border-color: var(--buy); }
.sp-pinrow-r { display: inline-flex; align-items: center; gap: 6px; }
.sp-pinsep { border-top: 1px dashed var(--line2); margin: 4px 8px 8px; }
.sp-badge-bad { color: var(--bad); background: var(--bad-bg); }
.sp-heldtag { margin-left: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--buy); }
.sp-mainnote { margin: 4px 0 8px; color: var(--text2); }
/* A left-out row: Add takes the tick's place and its own width (3.20: it ran over the picture). */
.sp-ti.sp-leftrow { grid-template-columns: auto 44px minmax(0, 1fr) auto; }
.sp-add { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.sp-fc .sp-lo-x { margin-left: auto; padding: 4px 8px; color: var(--offer); font-weight: 500; }
.sp-chat { min-width: 64px; justify-content: center; gap: 6px; }
.sp-q > .sp-note + .sp-note { margin-top: 8px; }
.sp-tr { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; align-items: center; padding: 12px; border-top: 1px solid var(--line); }
.sp-q h3 + .sp-tr, .sp-q .sp-note + .sp-tr { border-top: 0; }
.sp-tr.sp-top { background: var(--profit-bg); border-radius: 12px; border-top-color: transparent; }
.sp-tr.sp-top + .sp-tr { border-top-color: transparent; }
.sp-tr.sp-stale .sp-tprice, .sp-tr.sp-stale b, .sp-tr.sp-stale small { color: var(--faint); }
.sp-tr.sp-favrow::after { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--fav); pointer-events: none; }
.sp-favtag { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 999px; font: 700 10px/1 var(--sans); letter-spacing: 0.05em; text-transform: uppercase; color: var(--fav); background: var(--fav-bg); white-space: nowrap; }
.sp-tr-l { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sp-tr-l small { font-size: 12px; color: var(--muted); }
.sp-tr-l small.sp-differ { color: var(--warn); }
.sp-note.sp-warnnote { color: var(--warn); }
/* A trade against the 10,000 items one trade takes (3.23.0): amber near it, red when full. */
.sp-note.sp-units { color: var(--warn); margin: 0 0 8px; }
.sp-note.sp-units.sp-units-full { color: var(--bad); }
.sp-note.sp-lefthidden { margin: 4px 0 0; }
/*
 * An old price list (3.22.3): amber, with a dot. The pulse is a ring behind
 * the dot that grows and fades - transform and opacity only, so it costs no
 * layout and no repaint of the row.
 */
.sp-tr-l small.sp-oldlist, .sp-fc small.sp-oldlist { display: flex; align-items: flex-start; gap: 6px; color: var(--warn); }
/* The dot sits in the middle of the first line, whatever that line's height (a desk row's, a card's). */
.sp-olddot { position: relative; flex: 0 0 auto; width: 7px; height: 7px; margin-top: 5px; margin-top: calc((1lh - 7px) / 2); border-radius: 50%; background: var(--warn); }
.sp-oldlist-pulse .sp-olddot::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--warn); pointer-events: none; animation: sp-oldpulse 1600ms ease-out infinite; animation-delay: inherit; }
@keyframes sp-oldpulse { 0% { transform: scale(1); opacity: 0.7; } 70%, 100% { transform: scale(3); opacity: 0; } }
.sp-trader-l { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.sp-pname { color: var(--text); font-weight: 600; }
.sp-tprice { font: 650 15px var(--sans); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-top .sp-tprice { color: var(--profit); }
.sp-links { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.sp-tr .sp-links { display: flex; align-items: center; gap: 6px; }
.sp-tr .sp-links .sp-blk { margin-left: auto; }
.sp-fav, .sp-blk { width: 24px; height: 24px; padding: 0; border-radius: 7px; border: 1px solid var(--line); background: transparent; color: var(--faint); font: 13px/22px var(--sans); cursor: pointer; transition: background-color 0.15s var(--ease); }
.sp-fav:hover, .sp-blk:hover { color: var(--text); border-color: var(--line2); background: var(--raised); }
.sp-fav.sp-fav-on { color: var(--fav); border-color: var(--fav-line); background: var(--fav-bg); animation: sp-pop 0.3s var(--ease); }
.sp-blk:hover { color: var(--bad); }
.sp-tr-l small.sp-traded { color: var(--muted); }
.sp-blnote { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sp-tr .sp-links.sp-links-one { display: flex; }
.sp-chip {
    display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 9px; font-size: 12px; font-weight: 500; white-space: nowrap;
    color: var(--offer); background: var(--buy-bg); border: 1px solid transparent; border-radius: 7px;
    transition: background-color 0.15s var(--ease);
}
.sp-chip:hover { text-decoration: none; background: rgba(90, 167, 255, 0.2); }
.sp-chip-none { visibility: hidden; }
.sp-showall { margin-top: 12px; }
.sp-tsec { margin: 16px 0 6px; font: 650 11px/1 var(--sans); letter-spacing: 0.09em; text-transform: uppercase; color: var(--text2); }
.sp-th { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-top: 4px; padding: 12px 16px; border-radius: 12px; background: var(--raised); }
.sp-th-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sp-th-r { margin-left: auto; text-align: right; }
.sp-th-r small { display: block; color: var(--muted); font-size: 12px; }
.sp-ti { display: grid; grid-template-columns: 18px 44px minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
.sp-ti.sp-off b, .sp-ti.sp-off small, .sp-ti.sp-off .sp-ti-p { color: var(--faint); }
.sp-tick { width: 16px; height: 16px; margin: 0; accent-color: var(--profit); }
.sp-ti-l { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sp-ti-l small { color: var(--muted); font-size: 12px; }
.sp-tiname { color: var(--text); font-weight: 600; text-decoration: none; }
.sp-tiname:hover { text-decoration: underline; text-underline-offset: 3px; }
.sp-here { margin-left: 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--profit); }
.sp-ti-p { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-ti-p.sp-good { color: var(--profit); }
.sp-ti-p small { display: block; font-weight: 400; color: var(--muted); font-size: 12px; }
.sp-buys { grid-column: 3 / 5; display: flex; flex-direction: column; gap: 6px; }
.sp-buy { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.sp-buy .sp-chip { margin-left: auto; }
.sp-qty { width: 72px; height: 28px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--line2); background: var(--input); color: var(--text); text-align: right; font-variant-numeric: tabular-nums; }
.sp-qty:focus { border-color: var(--brand); outline: none; }
.sp-in-bad, .sp-key.sp-in-bad { border-color: var(--bad) !important; box-shadow: 0 0 0 3px var(--bad-bg); }
.sp-trade-links { display: flex; justify-content: flex-end; margin-top: 12px; }
.sp-tradeline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.sp-tradeline small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.sp-plan { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.sp-plan-on { display: inline-flex; align-items: center; border-radius: 8px; border: 0; color: var(--on-profit); font-weight: 650; background: var(--profit); }
.sp-btn.sp-plan-on:hover { background: #86e594; }
.sp-tr.sp-planning { box-shadow: inset 3px 0 0 var(--profit); }
/* Dimmed by colour, not see-through: its words stay readable (review M10). */
.sp-tr.sp-declined .sp-tprice, .sp-tr.sp-declined .sp-trader-l, .sp-tr.sp-declined small, .sp-tr.sp-hidden .sp-tprice, .sp-tr.sp-hidden .sp-trader-l, .sp-tr.sp-hidden small { color: var(--faint); }
.sp-tr.sp-troll .sp-tprice { color: var(--muted); text-decoration: line-through; }
.sp-scan { display: flex; flex-direction: column; gap: 12px; margin: 0 0 32px; }
.sp-scanh { margin: 0; }
.sp-fold { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; font: inherit; }
.sp-fold h2 { margin: 0; }
.sp-fold:hover h2 { color: var(--text); }
.sp-chev { width: 12px; color: var(--muted); font-size: 12px; }
.sp-scangrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
/* One row: cards past the row's end take no height and are clipped (Show all brings them). */
.sp-scangrid.sp-onerow { grid-template-rows: auto; grid-auto-rows: 0; row-gap: 0; overflow: hidden; }
@media (max-width: 1400px) { .sp-scangrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.sp-tc { cursor: default; }
.sp-tc:hover { background: var(--surface); }
.sp-tc.sp-tc-none { background: var(--surface); border-color: var(--line); }
.sp-tc.sp-tc-fav.sp-tc-none { border-color: var(--fav-line); background: linear-gradient(180deg, rgba(255, 204, 77, 0.06), var(--surface) 55%); }
.sp-inerr { color: var(--bad); font-size: 12px; font-weight: 600; }
.sp-tc-acts { display: flex; gap: 6px; margin-top: auto; }
.sp-tc-acts .sp-go { flex: 1 1 0; min-width: 0; white-space: nowrap; }
.sp-tc .sp-go { margin-top: auto; height: 28px; border-radius: 8px; font-size: 12px; }
.sp-btn.sp-every-on { color: var(--buy); border-color: var(--buy); font-weight: 600; }
.sp-tc .sp-go.sp-go-on { color: var(--on-profit); background: var(--profit); border-color: transparent; font-weight: 600; }
.sp-star { color: var(--fav); }
.sp-lastpaid { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; font: 700 10px/1 var(--sans); text-transform: uppercase; letter-spacing: 0.05em; border-radius: 999px; color: var(--known); background: rgba(184, 164, 255, 0.12); white-space: nowrap; }
.sp-fc-p.sp-est { color: var(--profit); }
.sp-fc-p.sp-fc-none { color: var(--muted); }
.sp-tc small.sp-traded { color: var(--muted); }
.sp-tpick { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 4px 0 8px; }
.sp-itemnote { margin: 8px 0; }
.sp-better { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; margin: 8px 0; }
.sp-tpick-b { display: flex; gap: 8px; flex-wrap: wrap; }
.sp-buy .sp-tick { flex: 0 0 auto; }
.sp-check-ok .sp-checkword { color: var(--profit); font-weight: 600; }
.sp-check-price .sp-checkword, .sp-check-short .sp-checkword { color: var(--warn); font-weight: 600; }
.sp-check-gone .sp-checkword { color: var(--bad); font-weight: 600; }
.sp-check-bought { opacity: 0.6; }
.sp-gone { background: var(--bad-bg); border-radius: 10px; padding: 12px; border-top: 0; margin: 4px 0; }
.sp-gone-mark { width: 16px; height: 16px; border-radius: 50%; background: var(--bad); color: var(--page); font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.sp-gone small { color: var(--warn); }
.sp-buy .sp-bad { color: var(--bad); font-weight: 600; }
.sp-repl { color: var(--text2); }
.sp-repl .sp-link { font-size: 12px; }
.sp-drop { display: block; margin: 4px 0 0 auto; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.sp-neverlist { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.sp-never { font-size: 12px; }
.sp-keeplist { display: flex; flex-direction: column; gap: 8px; }
.sp-keeprow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sp-big { font: 650 22px var(--sans); color: var(--profit); font-variant-numeric: tabular-nums; }
.sp-step { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
.sp-q .sp-note + .sp-step { margin-top: 8px; }
.sp-n { width: 22px; height: 22px; border-radius: 50%; background: var(--profit); color: var(--on-profit); font-weight: 700; font-size: 12px; display: grid; place-items: center; }
.sp-step .sp-trust { margin-left: 2px; }
.sp-step-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.sp-opt { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; padding: 12px 14px; margin-bottom: 8px; border-radius: 12px; border: 1px solid var(--line); color: var(--text); transition: background-color 0.15s var(--ease); }
a.sp-opt:hover { text-decoration: none; border-color: var(--buy-line); background: var(--buy-bg); }
.sp-opt-l { display: flex; flex-direction: column; min-width: 0; }
.sp-opt-l small, .sp-opt-p small { font-size: 12px; color: var(--muted); font-weight: 400; }
.sp-opt-p { display: flex; flex-direction: column; align-items: flex-end; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-opt.sp-win { border-color: var(--profit-line); background: var(--profit-bg); }
.sp-opt.sp-win .sp-opt-p { color: var(--profit); }
.sp-opt-none { color: var(--muted); }
.sp-verdict { margin: 4px 0 0; font-weight: 600; }
.sp-verdict.sp-win { color: var(--profit); }

/* shared pieces */
.sp-pic { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 30px; flex: 0 0 auto; }
.sp-pic-s { width: 44px; height: 22px; }
.sp-pic-l { width: 80px; height: 40px; }
.sp-img { width: 100%; height: 100%; object-fit: contain; }
.sp-img-none { visibility: hidden; }
.sp-iname { color: var(--text); }
.sp-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.sp-status:empty { display: none; }
.sp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: 0 0 auto; }
.sp-dot[data-level="online"] { background: var(--profit); }
.sp-dot[data-level="idle"] { background: var(--warn); }
.sp-dot[data-level="offline"] { background: var(--faint); }
/* Online, but in hospital, in jail or flying: may not trade right now. */
.sp-dot[data-level="busy"] { background: var(--orange); }
.sp-dot[data-level="bad"] { background: var(--bad); }
.sp-dot[data-level="unknown"] { background: transparent; border: 1px solid var(--faint); }
.sp-trust {
    display: inline-flex; align-items: center; height: 18px; padding: 0 7px; flex: 0 0 auto;
    font: 700 10px/1 var(--sans); text-transform: uppercase; letter-spacing: 0.05em;
    border-radius: 999px; border: 0; color: var(--muted); background: rgba(255, 255, 255, 0.06); cursor: help; white-space: nowrap;
}
.sp-trust[data-level="trusted"] { color: var(--trust); background: var(--trust-bg); }
.sp-trust[data-level="known"] { color: var(--known); background: rgba(184, 164, 255, 0.12); }
.sp-trust[data-level="caution"] { color: var(--warn); background: var(--warn-bg); }

/* ------------------------------------------------------------ settings */
.sp-settings { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 24px; align-items: start; padding: 24px 24px 64px; }
.sp-snav { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 2px; }
.sp-snav-g { margin: 14px 10px 6px; font: 650 10.5px/1 var(--sans); letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint); }
.sp-snav-g:first-child { margin-top: 0; }
.sp-snav-a { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 0; border-radius: 9px; background: none; color: var(--text2); font-weight: 500; text-align: left; cursor: pointer; transition: background-color 0.15s var(--ease); }
.sp-snav-a:hover { background: var(--surface); color: var(--text); }
.sp-snav-a[aria-current="true"] { background: var(--surface); color: var(--text); box-shadow: inset 2px 0 0 var(--brand); }
.sp-snav-a small { margin-left: auto; font-weight: 400; font-size: 12px; color: var(--faint); white-space: nowrap; }
.sp-sbody { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.sp-card { display: flex; flex-direction: column; padding: 20px 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; scroll-margin-top: 24px; }
.sp-card h2 { margin: 0 0 4px; font: 400 17px/1.3 var(--serif); color: var(--text); }
.sp-lead { margin: 0 0 14px; font-size: 13px; color: var(--muted); }
.sp-field { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 8px 24px; align-items: start; padding: 14px 0; border-top: 1px solid var(--line); }
.sp-flabel { display: flex; flex-direction: column; gap: 2px; padding-top: 7px; }
.sp-flabel b { font-weight: 600; }
.sp-flabel small { font-size: 12px; color: var(--muted); }
.sp-fctl { display: flex; flex-direction: column; gap: 8px; min-width: 0; max-width: 640px; }
.sp-fctl > .sp-keystate:only-child { padding-top: 8px; }
.sp-fctl > .sp-check { padding-top: 8px; }
.sp-fctl > .sp-fresh { align-self: flex-start; min-width: 200px; }
.sp-keepup { padding: 12px; border-radius: 12px; font-size: 12px; }
.sp-keepup-ok { background: var(--profit-bg); color: var(--text2); }
.sp-keepup-behind { background: var(--warn-bg); color: var(--warn); }
.sp-inline { display: flex; gap: 8px; align-items: center; }
.sp-inline input { flex: 1; min-width: 0; }
.sp-inline.sp-pct input.sp-pctin { flex: 0 0 80px; text-align: right; }
.sp-inline.sp-actions { gap: 16px; }
input.sp-key { height: 34px; padding: 0 12px; background: var(--input); border: 1px solid var(--line2); border-radius: 10px; color: var(--text); transition: border-color 0.15s var(--ease); }
input.sp-key:focus { border-color: var(--brand); outline: none; }
input.sp-key::placeholder { color: var(--faint); }
.sp-masked { -webkit-text-security: disc; }
.sp-keystate { font-size: 12px; color: var(--muted); }
.sp-keystate.sp-ok { color: var(--profit); }
.sp-radio { display: flex; flex-direction: column; gap: 8px; }
.sp-radio-o { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.sp-radio-o input[type="radio"] { width: 16px; height: 16px; margin: 0; accent-color: var(--profit); cursor: pointer; }
.sp-radio-o .sp-key { flex: 0 1 220px; }
.sp-key.sp-dim { color: var(--muted); }
.sp-keystate.sp-bad { color: var(--bad); }
.sp-keystate.sp-warn { color: var(--warn); }
.sp-use { display: flex; height: 22px; max-width: 420px; border-radius: 7px; overflow: hidden; border: 1px solid var(--line2); font-size: 11px; font-weight: 600; line-height: 20px; white-space: nowrap; }
.sp-use span { text-align: center; overflow: hidden; min-width: 0; }
.sp-use-pc { background: var(--buy-bg); color: var(--text); }
.sp-use-sv { background: rgba(184, 164, 255, 0.16); color: var(--text); }
.sp-use-fr { background: var(--input); color: var(--muted); }
.sp-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
input[type="checkbox"] { accent-color: var(--profit); margin: 3px 0 0; }
.sp-tos { width: 100%; max-width: 900px; border-collapse: collapse; font-size: 12.5px; }
.sp-tos th, .sp-tos td { text-align: left; vertical-align: top; padding: 9px 4px; border-top: 1px solid var(--line); color: var(--text2); }
.sp-tos th { width: 220px; color: var(--muted); font-weight: 400; }

/* ---------------------------------------------------------- narrower */
/* With the Category dropdown the header needs room: under 1500px the two
   background-progress pills go (TornW3B's state is in Settings too). On a
   phone the pills get a row of their own and all come back. */
@media (max-width: 1500px) and (min-width: 1001px) {
    .sp-pill[data-src="TornW3B"], .sp-pill[data-src="Online"] { display: none; }
}
@media (max-width: 1400px) {
    .sp-tgroup { grid-template-columns: 128px minmax(0, 1fr); }
    .sp-tlabel { padding: 14px 12px; }
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
    .sp-tgroup { grid-template-columns: minmax(0, 1fr); }
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
` + BIDS_CSS + OWNER_CSS;
