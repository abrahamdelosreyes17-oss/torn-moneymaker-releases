/*
 * Torn Bids' shell (3.25.0, mockup AD third pass): a sidebar with a page per job, a bar across the top
 * (where you are, its tabs, your Cash, how old the prices are, Read now) and one line along the bottom.
 *
 *   Today      the few totals, what to do now, the best flips, your trades, what you hold, your profit
 *   Flips      Best flips | By trader | All items: pick on the left, who sells and who pays in the
 *              middle, the trade on the right
 *   Trades     Going | History: a card per trade in the lane of its step, and the one you pressed under
 *              them; the last 30 trades, each with the prices it was made on
 *   My items   what you hold, and where to sell it
 *   To sell    what you bought to resell, by who pays most
 *   Ledger     Trading | Sold | Receipts, traders, mugged
 *   Settings   Keys and sharing | Flips and reading | Help
 *
 * This file builds the frame and moves the page's parts into the page in view; what is in each part is
 * drawn by ui/selling-page.js and ui/bids-pages.js. One instance of each part exists (the list, the head of
 * what you picked, the trade), so a part is never drawn twice: going to another page moves it there.
 *
 * Names from Torn, TornExchange or TornW3B only ever go in as text.
 */

const BD_SVG = 'http://www.w3.org/2000/svg';

/* Line icons, 20 x 20, drawn in the current colour. Our own constant strings: nothing from outside. */
const BD_ICONS = {
    dash: '<rect x="3" y="3" width="6" height="8" rx="1.5"/><rect x="11" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="13" width="6" height="4" rx="1.5"/><rect x="11" y="10" width="6" height="7" rx="1.5"/>',
    flip: '<path d="M3 14.5 7.5 10l3 3L17 6.5"/><path d="M12.5 6.5H17V11"/>',
    trades: '<path d="M4 7h12l-3-3M16 13H4l3 3"/>',
    stock: '<path d="M10 3 3 6.5 10 10l7-3.5L10 3Z"/><path d="m3 10 7 3.5 7-3.5"/><path d="m3 13.5 7 3.5 7-3.5"/>',
    tag: '<path d="M3.5 10.4V4.5a1 1 0 0 1 1-1h5.9l6 6a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 0 1-1.4 0l-6.4-5.6Z"/><circle cx="7.2" cy="7.2" r="1.1"/>',
    book: '<path d="M6 3.5h9.5v13H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M4.5 14.8A1.5 1.5 0 0 1 6 13.5h9.5M8 7h4.5M8 9.8h3"/>',
    set: '<path d="M4 6h6.5M15.5 6h.5M4 14h.5M9.5 14H16"/><circle cx="13" cy="6" r="2.2"/><circle cx="7" cy="14" r="2.2"/>',
    pin: '<path d="M7 3h6l-.8 5 2.3 2.5v1.5h-9v-1.5L7.8 8 7 3ZM10 12v5"/>',
    buy: '<path d="M2.5 4h2l1.7 8.2h8.3l1.8-5.7H5.4"/><circle cx="7.8" cy="15.6" r="1.2"/><circle cx="13.8" cy="15.6" r="1.2"/>',
};

export function bdIcon(name) {
    const svg = document.createElementNS(BD_SVG, 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = BD_ICONS[name] || '';
    return svg;
}

/** An element: `text` is text, on* a listener, everything else an attribute. Children: nodes or strings (as text). */
export function bdEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        // A string "on..." is never set: no inline handler, ever.
        else if (!key.startsWith('on') && value !== null && value !== undefined && value !== false) node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

/** The pages, in the sidebar's order. `gap`: a thin line between groups; `push`: what follows sits at the bottom. */
export const BD_PAGES = [
    { id: 'today', label: 'Today', icon: 'dash' },
    { id: 'flips', label: 'Flips', icon: 'flip', tabs: ['Best flips', 'By trader', 'All items'] },
    { id: 'trades', label: 'Trades', icon: 'trades', tabs: ['Going', 'History'] },
    { gap: true },
    { id: 'mine', label: 'My items', icon: 'stock' },
    { id: 'sell', label: 'To sell', icon: 'tag' },
    { id: 'ledger', label: 'Ledger', icon: 'book' },
    { push: true },
    { id: 'settings', label: 'Settings', icon: 'set', tabs: ['Keys and sharing', 'Flips and reading', 'Help'] },
];

/** The tabs of Trades. */
export const BD_TRADES_GOING = 0;
export const BD_TRADES_PAST = 1;

/** The tabs of Flips. */
export const BD_FLIPS_BEST = 0;
export const BD_FLIPS_TRADER = 1;
export const BD_FLIPS_ITEMS = 2;

/**
 * Which list a page shows: main.js works the item list out for one filter at a time
 * ('all' | 'mine' | 'flips' | 'sell' | 'trades'). null: the page shows no item list of its own.
 */
export function bdFilterOf(pageId, tab) {
    if (pageId === 'flips') return tab === BD_FLIPS_ITEMS ? 'all' : tab === BD_FLIPS_BEST ? 'flips' : null;
    if (pageId === 'mine') return 'mine';
    if (pageId === 'sell') return 'sell';
    if (pageId === 'trades') return 'trades';
    return null;
}

/** The page and tab that show a filter (a filter set from elsewhere: "see To sell", a trade opened from Today). */
export function bdPageOf(filter) {
    if (filter === 'mine') return { page: 'mine', tab: 0 };
    if (filter === 'sell') return { page: 'sell', tab: 0 };
    if (filter === 'trades') return { page: 'trades', tab: 0 };
    if (filter === 'all') return { page: 'flips', tab: BD_FLIPS_ITEMS };
    return { page: 'flips', tab: BD_FLIPS_BEST };
}

const BD_SIDE_PIN_KEY = 'tornBids.sidePinned';

/**
 * Builds the frame into `page` (a SellingPage). It makes:
 *   page.root            the whole page
 *   page.bd.pages[id]    each page's section
 *   page.bd.slots        where the parts go: slots[name] is an element a part is moved into
 *   page.bd.nav[id]      {btn, count} of each sidebar entry
 * and expects the parts themselves (page.listPanel, page.headEl, ...) to exist already.
 */
export function bdBuildShell(page, { title, tagline, parts }) {
    const bd = { pages: {}, slots: {}, nav: {}, page: 'today', tab: 0, tabsOf: {} };
    page.bd = bd;

    /* ---- sidebar ---- */
    bd.ind = bdEl('div', { class: 'nav-ind' });
    const nav = bdEl('nav', { class: 'nav', 'aria-label': 'Pages' }, [bd.ind]);
    for (const p of BD_PAGES) {
        if (p.gap) {
            nav.appendChild(bdEl('div', { class: 'nav-g' }));
            continue;
        }
        if (p.push) {
            nav.appendChild(bdEl('span', { class: 'sp' }));
            continue;
        }
        const count = bdEl('span', { class: 'lab cnt', hidden: '' });
        const pip = bdEl('i', { class: 'pip', hidden: '' });
        const btn = bdEl('button', { type: 'button', class: 'nav-b', 'data-go': p.id, title: p.label, onclick: () => page.go(p.id) }, [bdIcon(p.icon), pip, bdEl('span', { class: 'lab', text: p.label }), count]);
        bd.nav[p.id] = { btn, count, pip };
        bd.tabsOf[p.id] = p.tabs || null;
        nav.appendChild(btn);
    }
    bd.pinBtn = bdEl('button', { type: 'button', class: 'pin lab', title: 'Keep the sidebar open', 'aria-pressed': 'false', onclick: () => bdPin(page, !bd.pinned) }, [bdIcon('pin')]);
    bd.sharedEl = bdEl('div', { class: 'shop', hidden: '' });
    bd.sideEl = bdEl('aside', { class: 'side' }, [bdEl('div', { class: 'side-in' }, [
        bdEl('div', { class: 'brand' }, [bdEl('div', { class: 'mark', 'aria-hidden': 'true', text: '$' }), bdEl('div', { class: 'lab' }, [bdEl('b', { text: title }), bdEl('span', { text: tagline })]), bd.pinBtn]),
        nav,
        bdEl('div', { class: 'side-f' }, [bd.sharedEl]),
    ])]);
    // The rail opens when the pointer is over it, and closes a moment after it leaves (never under a press).
    let timer = null;
    const open = (on) => {
        clearTimeout(timer);
        timer = setTimeout(() => bd.sideEl.classList.toggle('open', on), on ? 80 : 240);
    };
    bd.sideEl.addEventListener('mouseenter', () => open(true));
    bd.sideEl.addEventListener('mouseleave', () => open(false));
    bd.sideEl.addEventListener('focusin', () => open(true));
    bd.sideEl.addEventListener('focusout', () => open(false));

    /* ---- the bar across the top ---- */
    bd.titleEl = bdEl('h1', { text: 'Today' });
    bd.tabsEl = bdEl('nav', { class: 'tabs', 'aria-label': 'Tabs of this page' });
    bd.topEl = bdEl('header', { class: 'top' }, [bd.titleEl, bd.tabsEl, bdEl('span', { class: 'sp' }), ...parts.top]);

    /* ---- the pages ---- */
    const slot = (name, tag = 'div', cls = '') => {
        bd.slots[name] = bdEl(tag, { class: cls });
        return bd.slots[name];
    };
    const section = (id, cls, children) => {
        bd.pages[id] = bdEl('section', { class: 'page ' + cls, 'data-page': id }, children);
        return bd.pages[id];
    };
    bd.viewEl = bdEl('div', { class: 'view' }, [
        section('today', 'p-dash', parts.today),
        // Flips: the picker, the middle and the trade; By trader swaps what the first two hold.
        section('flips', 'fit', [bdEl('div', { class: 'pane on c3 snug' }, [slot('flips-list', 'div', 'slot'), slot('flips-mid', 'div', 'col join'), slot('flips-plan', 'div', 'slot')])]),
        // Trades: Going is the board and the trade pressed; History is its own pane (the list, and the trade picked).
        section('trades', 'pgrows', [slot('trades-tiles', 'div', 'slot'), slot('trades-board', 'div', 'slot'), slot('trades-detail', 'div', 'slot'), (bd.pastPane = bdEl('div', { class: 'pane c57 snug' }, [slot('past-list', 'div', 'slot'), slot('past-side', 'div', 'col')]))]),
        section('mine', 'pgrows pgfill', [slot('mine-tiles', 'div', 'slot'), bdEl('div', { class: 'pane on c75 snug' }, [slot('mine-list', 'div', 'slot'), slot('mine-side', 'div', 'col')])]),
        section('sell', 'pgrows pgfill', [slot('sell-tiles', 'div', 'slot'), bdEl('div', { class: 'pane on c75 snug' }, [slot('sell-list', 'div', 'slot'), slot('sell-side', 'div', 'col')])]),
        section('ledger', 'g1', parts.ledger),
        section('settings', 'g1', parts.settings),
    ]);

    /* ---- the line along the bottom ---- */
    bd.tapeEl = bdEl('div', { class: 'tape-t' });
    bd.tapeRight = bdEl('div', { class: 'tape-r' });
    const tape = bdEl('footer', { class: 'tape' }, [bdEl('div', { class: 'tape-l', text: 'Happening now' }), bdEl('div', { class: 'tape-m' }, [bd.tapeEl]), bd.tapeRight]);

    bd.mainEl = bdEl('div', { class: 'main' }, [bd.topEl, bd.viewEl, tape]);
    page.root = bdEl('div', { class: 'sp-page bd app' }, [bd.sideEl, bd.mainEl]);

    let pinned = false;
    try {
        pinned = window.localStorage.getItem(BD_SIDE_PIN_KEY) === '1';
    } catch {
        // No page storage: the sidebar starts as a rail.
    }
    bdPin(page, pinned, false);
    return bd;
}

/** The sidebar kept open, or a rail that opens under the pointer. Remembered in this browser. */
function bdPin(page, on, save = true) {
    const bd = page.bd;
    bd.pinned = Boolean(on);
    page.root.classList.toggle('pinned', bd.pinned);
    bd.pinBtn.setAttribute('aria-pressed', String(bd.pinned));
    bd.pinBtn.title = bd.pinned ? 'Fold the sidebar to a rail' : 'Keep the sidebar open';
    if (save) {
        try {
            window.localStorage.setItem(BD_SIDE_PIN_KEY, bd.pinned ? '1' : '0');
        } catch {
            // Not remembered: it works for this visit.
        }
    }
    bdMoveInd(page);
}

/** The sidebar's marker slides to the page in view. */
export function bdMoveInd(page) {
    const bd = page.bd;
    const cur = bd.nav[bd.page];
    if (cur) bd.ind.style.transform = 'translateY(' + cur.btn.offsetTop + 'px)';
}

/**
 * Shows a page and one of its tabs: the sidebar, the title, the tabs. What the page holds is moved in by
 * the caller (page.place()), which knows the parts.
 * @param {string[]|null} tabs - the tabs' words now (their counts change), or null for a page without tabs
 */
export function bdShow(page, id, tab, tabs) {
    const bd = page.bd;
    const entry = BD_PAGES.find((p) => p.id === id) || BD_PAGES[0];
    bd.page = entry.id;
    bd.tab = tabs && tab >= 0 && tab < tabs.length ? tab : 0;
    for (const [key, el] of Object.entries(bd.pages)) el.classList.toggle('on', key === bd.page);
    for (const [key, n] of Object.entries(bd.nav)) {
        n.btn.classList.toggle('on', key === bd.page);
        n.btn.setAttribute('aria-current', key === bd.page ? 'page' : 'false');
    }
    bd.titleEl.textContent = entry.label;
    bdTabs(page, tabs);
    bdMoveInd(page);
    bd.viewEl.scrollTop = 0;
}

/** The tabs of the page in view, with the words given (drawn again only when they change). */
export function bdTabs(page, tabs) {
    const bd = page.bd;
    const sig = JSON.stringify([bd.page, bd.tab, tabs || null]);
    if (sig === bd.tabsSig) return;
    bd.tabsSig = sig;
    const had = bd.tabsEl.contains(page.root.getRootNode().activeElement);
    bd.tabsEl.textContent = '';
    (tabs || []).forEach((label, i) => {
        bd.tabsEl.appendChild(bdEl('button', { type: 'button', class: 'tab' + (i === bd.tab ? ' on' : ''), 'aria-pressed': String(i === bd.tab), text: label, onclick: () => page.go(bd.page, i) }));
    });
    if (had && bd.tabsEl.children[bd.tab]) bd.tabsEl.children[bd.tab].focus({ preventScroll: true });
}

/** A number beside a sidebar entry (hidden at zero); `hot`: in the accent, for the one thing to do now. */
export function bdNavCount(page, id, text, hot = false) {
    const n = page.bd.nav[id];
    if (!n) return;
    const shown = text === null || text === undefined || text === '' || text === 0 ? '' : String(text);
    if (n.count.textContent !== shown) n.count.textContent = shown;
    n.count.hidden = !shown;
    n.count.classList.toggle('hot', Boolean(hot));
    // Folded to a rail there is no room for the number: a dot says there is something.
    n.pip.hidden = !(shown && hot);
}

/** Moves a part into a slot (a part is in one place at a time). `null` empties the slot. */
export function bdPut(page, slotName, ...parts) {
    const slot = page.bd.slots[slotName];
    if (!slot) return;
    const want = parts.filter(Boolean);
    const have = [...slot.children];
    if (have.length === want.length && have.every((n, i) => n === want[i])) return;
    for (const n of have) if (!want.includes(n)) slot.removeChild(n);
    for (const n of want) slot.appendChild(n);
}
