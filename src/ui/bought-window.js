/*
 * Bought since you accepted (3.14.3; the owner, 2026-09-28: "have another
 * overlay window popup... recent items bought ever since I clicked accepted
 * trade"; "can we make that overlay something we can freely move around the
 * page"; "a checklist if we already input it in the trade, that naturally
 * checks if we have it in and warns if we missed something out").
 *
 * Its own window, apart from NPC Arbitrage, shown only while a trade is
 * accepted. It starts at the top of the free space right of Torn's content;
 * dragged by its title it goes anywhere on the page (the owner's choice), and
 * it folds to one line. On Torn's trade page each row says whether it is in
 * the trade, and anything bought but not added is named. Read only: it never
 * presses anything of Torn's. Names go in through textContent only.
 */

const BW_HOST_ID = 'ttv2-bought-host';

function bwEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

function bwMoney(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');
}

function bwSigned(n) {
    const v = Math.round(Number(n) || 0);
    return (v >= 0 ? '+$' : '−$') + Math.abs(v).toLocaleString('en-US');
}

function bwTime(t) {
    if (!t) return '';
    const d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Where the window may sit: inside the page's view, its title bar always
 * reachable. Pure - tested.
 * @returns {{x: number, y: number}}
 */
export function clampWindowPos(x, y, { width, height, viewW, viewH }) {
    const w = Math.max(0, Number(width) || 0);
    const minX = 0;
    const maxX = Math.max(0, viewW - Math.min(w, viewW));
    const maxY = Math.max(0, viewH - 32);
    return {
        x: Math.round(Math.min(maxX, Math.max(minX, Number(x) || 0))),
        y: Math.round(Math.min(maxY, Math.max(0, Number(y) || 0))),
    };
}

/**
 * Where the window starts, before you drag it (3.15.1): just above NPC
 * Arbitrage when it fits there; else beside it, to its left - it used to be
 * pushed down over the panel and its Next bazaar button once the checkout
 * list made it taller. Pure - tested.
 *
 * @param {{left, top, right, width, height}|null} panel
 * @returns {{x: number, y: number}}
 */
export function windowStart(panel, { width, height, viewW }) {
    if (!panel || !panel.width) return { x: viewW - 16 - width, y: 64 };
    const above = panel.top - 8 - height;
    if (above >= 8) return { x: panel.right - width, y: above };
    if (panel.left - 8 - width >= 0) return { x: panel.left - 8 - width, y: Math.max(8, panel.top) };
    return { x: panel.right - width, y: 8 };
}

/**
 * The window fits the screen (3.16; the owner: the Checkout list could not
 * be scrolled - it is pinned to the screen, so what went past the bottom was
 * out of reach). Moved up just enough to fit when it can; when it is taller
 * than the screen, its list scrolls inside it (a pinned window has no other
 * way). Pure - tested.
 *
 * @param {number} y - where its top is now
 * @param {{height: number, viewH: number}} o - its natural height, the view's
 * @returns {{y: number, maxHeight: number}}
 */
export function fitWindow(y, { height, viewH }) {
    const gap = 8;
    const h = Math.max(0, Number(height) || 0);
    let top = Math.max(0, Number(y) || 0);
    if (top + h > viewH - gap) top = Math.max(Math.min(top, gap), viewH - gap - h);
    return { y: Math.round(top), maxHeight: Math.max(120, Math.round(viewH - gap - top)) };
}

export class BoughtWindow {
    /**
     * @param {object} h - onMove({x, y}), onFold(folded), panelRect() - NPC Arbitrage's box, to sit above it
     * @param {object} [o] - {pos: {x, y}|null, folded: boolean}
     */
    constructor(h = {}, { pos = null, folded = false } = {}) {
        this.h = h;
        this.pos = pos;
        this.folded = folded;
        this.sig = null;
        this.host = null;
    }

    mount() {
        if (this.host && this.host.isConnected) return;
        const old = document.getElementById(BW_HOST_ID);
        if (old) old.remove();
        this.host = bwEl('div', { id: BW_HOST_ID });
        const root = this.host.attachShadow({ mode: 'open' });
        root.appendChild(bwEl('style', { text: BOUGHT_CSS }));
        this.box = bwEl('section', { class: 'bw', role: 'region', 'aria-label': 'Bought since you accepted' });
        root.appendChild(this.box);
        document.body.appendChild(this.host);
        this.place();
        this.resizer = () => this.place();
        window.addEventListener('resize', this.resizer);
    }

    unmount() {
        if (this.resizer) window.removeEventListener('resize', this.resizer);
        this.resizer = null;
        if (this.host) this.host.remove();
        this.host = null;
        this.sig = null;
    }

    /** Its place: where you left it, else the top of the free space right of Torn's content. */
    place() {
        if (!this.box) return;
        const viewW = document.documentElement.clientWidth || window.innerWidth;
        const viewH = window.innerHeight;
        const width = this.box.offsetWidth || 300;
        let p = this.pos;
        if (!p) {
            // Right-aligned with NPC Arbitrage, ending just above it (mockup B): the
            // free space right of Torn's content, never on Torn's own page by itself.
            const panel = this.h.panelRect ? this.h.panelRect() : null;
            p = windowStart(panel, { width, height: this.box.offsetHeight || 200, viewW });
        }
        const c = clampWindowPos(p.x, p.y, { width, height: this.box.offsetHeight, viewW, viewH });
        // Its whole height on screen when it fits; else the list scrolls inside (3.16).
        this.box.style.maxHeight = '';
        const fit = fitWindow(c.y, { height: this.box.offsetHeight, viewH });
        this.box.style.left = c.x + 'px';
        this.box.style.top = fit.y + 'px';
        this.box.style.maxHeight = fit.maxHeight + 'px';
    }

    /** Dragged by its title bar: anywhere on the page, kept for next time. */
    dragFrom(event) {
        if (event.button !== 0 || (event.target && event.target.closest && event.target.closest('button'))) return;
        event.preventDefault();
        const r = this.box.getBoundingClientRect();
        const dx = event.clientX - r.left;
        const dy = event.clientY - r.top;
        const move = (e) => {
            const c = clampWindowPos(e.clientX - dx, e.clientY - dy, { width: r.width, height: r.height, viewW: document.documentElement.clientWidth || window.innerWidth, viewH: window.innerHeight });
            this.box.style.left = c.x + 'px';
            this.box.style.top = c.y + 'px';
            this.pos = c;
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            this.box.classList.remove('bw-drag');
            if (this.pos && this.h.onMove) this.h.onMove(this.pos);
            // Dropped low: fitted to the screen again.
            this.place();
        };
        this.box.classList.add('bw-drag');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    /**
     * Cancel trade (the owner, 2026-09-29): they accepted, then it was called
     * off - this window and the plan go. Asked first: "Cancel the trade with X?".
     */
    cancelPart(m) {
        const again = () => {
            this.sig = null;
            this.render(m);
        };
        if (this.cancelAsk !== m.key) {
            return bwEl('div', { class: 'bw-cancel' }, [
                bwEl('button', { type: 'button', class: 'bw-link', title: 'They accepted, then the trade was called off: this flip plan goes (not marked declined)', text: 'Cancel trade', onclick: () => {
                    this.cancelAsk = m.key;
                    again();
                } }),
            ]);
        }
        // Sell what you're holding (3.16, the friend: stuck with items after the
        // trader went offline): what you bought, and who pays most for it now.
        const holding = m.holding || [];
        return bwEl('div', { class: 'bw-cancel bw-ask' }, [
            bwEl('p', { class: 'bw-warn', text: 'Cancel the trade with ' + (m.trader || 'them') + '? ' + (holding.length ? 'What you bought goes to Torn Bids as leftovers, to sell elsewhere:' : 'Nothing is recorded as bought for it.') }),
            holding.length ? bwEl('ul', { class: 'bw-hold' }, holding.map((l) => bwEl('li', {}, [
                bwEl('b', { text: l.name }),
                ' ×' + l.qty.toLocaleString('en-US') + ' · ',
                l.best
                    ? bwEl('span', {}, ['sell to ', bwEl('b', { text: l.best.name }), ' at ' + bwMoney(l.best.price) + ' (', bwEl('span', { class: l.gain >= 0 ? 'bw-g' : 'bw-neg', text: bwSigned(l.gain) }), ')'])
                    : bwEl('span', { class: 'bw-mute', text: 'no other trader buys it now' }),
            ]))) : null,
            bwEl('button', { type: 'button', class: 'bw-btn', text: 'Yes, cancel it', onclick: () => {
                this.cancelAsk = null;
                if (this.h.onCancel) this.h.onCancel(m.key);
            } }),
            bwEl('button', { type: 'button', class: 'bw-btn', text: 'Keep it', onclick: () => {
                this.cancelAsk = null;
                again();
            } }),
        ]);
    }

    /**
     * One line of the cart: a tick that follows the buying run (to buy, you
     * are here, bought, fewer than planned, skipped), what and from whom, and
     * the bazaar - a plain link, opened by you.
     */
    cartRow(l, m) {
        const mark = { todo: ['bw-m-todo', '☐', 'To buy'], here: ['bw-m-here', '▶', 'You are on this bazaar'], done: ['bw-m-done', '✓', 'Bought'], part: ['bw-m-part', '✓', 'Bought fewer than planned'], skipped: ['bw-m-skip', '–', 'Skipped'] }[l.state] || ['bw-m-todo', '☐', ''];
        const count = l.state === 'here' ? l.bought.toLocaleString('en-US') + ' of ' + l.qty.toLocaleString('en-US')
            : l.state === 'part' ? l.bought.toLocaleString('en-US') + ' of ' + l.qty.toLocaleString('en-US')
            : '×' + l.qty.toLocaleString('en-US');
        // Open: only a bazaar still to go to (not the one you are on).
        const open = l.state === 'todo' && l.url;
        return bwEl('div', { class: 'bw-cart bw-cart-' + l.state }, [
            bwEl('span', { class: 'bw-mark ' + mark[0], title: mark[2], 'aria-label': mark[2], text: mark[1] }),
            bwEl('span', { class: 'bw-n' }, [
                bwEl('b', { text: l.name }),
                ' ' + count,
                l.state === 'skipped' ? bwEl('span', { class: 'bw-tag bw-tag-mute', text: 'skipped' }) : l.state === 'here' ? bwEl('span', { class: 'bw-tag bw-tag-here', text: 'here' }) : null,
            ]),
            open ? bwEl('a', { class: 'bw-open', href: l.url, title: 'Open ' + (l.seller || 'this') + '\'s bazaar', text: 'Open' })
                // On the trade page (3.16): each line bought, in the trade or not yet.
                : m.onTradePage && l.inTrade !== undefined
                    ? l.inTrade >= l.bought
                        ? bwEl('span', { class: 'bw-ck bw-in', title: 'In the trade', text: '✓ in' })
                        : bwEl('span', { class: 'bw-ck bw-miss', title: 'Not in the trade yet', text: 'add ' + (l.bought - l.inTrade).toLocaleString('en-US') })
                    : bwEl('span'),
            bwEl('span', { class: 'bw-d', text: 'from ' + (l.seller || 'Player ' + l.sellerId) + ' at ' + bwMoney(l.price) + ' · ' + (m.trader || 'they') + ' pays ' + bwMoney(l.bid) }),
        ]);
    }

    /**
     * @param {object|null} m - boughtSince(trade, {inside}) plus {onTradePage, key, cart: checkoutList(...) with each line's url}; null hides it
     */
    render(m) {
        if (!m) {
            this.unmount();
            return;
        }
        this.mount();
        if (this.cancelAsk !== m.key) this.cancelAsk = null;
        const sig = JSON.stringify([m, this.folded, this.cancelAsk, this.showFinished]);
        if (sig === this.sig) return;
        this.sig = sig;
        const box = this.box;
        // Drawn again (a buy counted, the log read): the list stays where you scrolled it.
        const scrolled = this.body && this.body.isConnected ? this.body.scrollTop : 0;
        box.textContent = '';
        box.classList.toggle('bw-folded', this.folded);

        const buys = m.rows.length;
        const fold = bwEl('button', {
            type: 'button',
            class: 'bw-ic',
            'aria-expanded': String(!this.folded),
            'aria-label': this.folded ? 'Show the list' : 'Fold to one line',
            title: this.folded ? 'Show the list' : 'Fold to one line',
            text: this.folded ? '▸' : '▾',
            onclick: () => {
                this.folded = !this.folded;
                if (this.h.onFold) this.h.onFold(this.folded);
                this.sig = null;
                this.render(m);
            },
        });
        // The checkout cart (3.15.1): the plan's lines, each ticking itself off.
        const cart = m.cart || null;
        const cartLines = cart ? cart.lines : [];
        const left = cart ? cart.bazaarsLeft : 0;
        const mini = cart && cartLines.length
            ? ' · ' + (cart.done ? 'all bought' : left + (left === 1 ? ' bazaar' : ' bazaars') + ' to go') + ' · ' + cart.unitsBought.toLocaleString('en-US') + ' of ' + cart.units.toLocaleString('en-US') + ' items' + (buys ? ' · ' + bwSigned(m.totals.profit) : '')
            : ' · ' + buys + (buys === 1 ? ' buy' : ' buys') + ' · ' + bwSigned(m.totals.profit) + (m.toBuy ? ' · ' + m.toBuy + ' to buy' : '');
        const head = bwEl('div', { class: 'bw-hd', title: 'Drag to move it anywhere' }, [
            bwEl('span', { class: 'bw-ti' }, [
                'Checkout · ' + (m.trader || 'the trade'),
                this.folded ? bwEl('span', { class: 'bw-mini', text: mini }) : null,
            ]),
            fold,
        ]);
        head.addEventListener('pointerdown', (e) => this.dragFrom(e));
        box.appendChild(head);
        if (this.folded) {
            this.place();
            return;
        }

        const body = bwEl('div', { class: 'bw-body' });
        body.appendChild(bwEl('div', { class: 'bw-since', text: 'Since "' + (m.trader || 'they') + ' accepted"' + (m.at ? ' at ' + bwTime(m.at) : '') }));
        // Whether your buys were checked with your Torn log (3.16).
        if (m.logNote) body.appendChild(bwEl('div', { class: 'bw-log' + (m.logNote.ok ? ' bw-log-ok' : ''), role: 'status', text: m.logNote.text }));
        if (cartLines.length) {
            body.appendChild(bwEl('div', { class: 'bw-sec' }, [
                bwEl('span', { text: 'To buy' }),
                bwEl('span', { class: cart.done ? 'bw-g' : '', text: cart.done ? 'all done ✓' : left + ' of ' + cart.bazaars + (cart.bazaars === 1 ? ' bazaar' : ' bazaars') + ' left' }),
            ]));
            // Finished lines fold into one (3.16): the list stays short as you buy.
            const finished = cartLines.filter((l) => l.state === 'done' || l.state === 'skipped');
            if (finished.length && !this.showFinished) {
                const bought = finished.filter((l) => l.state === 'done').length;
                const skipped = finished.length - bought;
                const inAll = !m.onTradePage || finished.every((l) => l.inTrade === undefined || l.inTrade >= l.bought);
                body.appendChild(bwEl('button', { type: 'button', class: 'bw-cart bw-fold', 'aria-expanded': 'false', title: 'Show them', onclick: () => {
                    this.showFinished = true;
                    this.sig = null;
                    this.render(m);
                } }, [
                    bwEl('span', { class: 'bw-mark bw-m-done', text: '✓' }),
                    bwEl('span', { class: 'bw-n', text: [bought ? bought + ' bought' : '', skipped ? skipped + ' skipped' : ''].filter(Boolean).join(' · ') + (inAll ? '' : ' · not all in the trade') }),
                    bwEl('span', { class: 'bw-open', text: 'Show ▸' }),
                ]));
            }
            for (const l of cartLines) {
                if (!this.showFinished && (l.state === 'done' || l.state === 'skipped')) continue;
                body.appendChild(this.cartRow(l, m));
            }
            if (finished.length && this.showFinished) {
                body.appendChild(bwEl('button', { type: 'button', class: 'bw-link bw-fold-back', 'aria-expanded': 'true', text: 'Fold the finished ones', onclick: () => {
                    this.showFinished = false;
                    this.sig = null;
                    this.render(m);
                } }));
            }
            body.appendChild(bwEl('div', { class: 'bw-sec' }, [bwEl('span', { text: 'Bought' }), bwEl('span', { text: buys ? bwSigned(m.totals.profit) : '' })]));
        }
        if (!buys) body.appendChild(bwEl('p', { class: 'bw-empty', text: cartLines.length ? 'Nothing recorded yet: what you take at a bazaar is added here when you press Next, and from your Torn log.' : 'Nothing bought yet. What you buy for this trade shows here.' }));
        for (const r of m.rows) {
            const check = m.onTradePage
                ? r.inTrade >= r.send
                    ? bwEl('span', { class: 'bw-ck bw-in', title: 'In the trade', text: '✓ in' })
                    : bwEl('span', { class: 'bw-ck bw-miss', title: 'Not in the trade yet', text: 'add ' + (r.send - r.inTrade).toLocaleString('en-US') })
                : null;
            body.appendChild(bwEl('div', { class: 'bw-it bw-' + r.tone }, [
                bwEl('span', { class: 'bw-n' }, [
                    bwEl('b', { text: r.name }),
                    ' ×' + r.qty.toLocaleString('en-US'),
                    r.planned ? null : bwEl('span', { class: 'bw-tag', text: r.tone === 'loss' ? 'not planned · loses' : 'not planned' }),
                ]),
                bwEl('span', { class: 'bw-p' + (r.profit < 0 ? ' bw-neg' : '') }, [bwSigned(r.profit), check]),
                bwEl('span', { class: 'bw-d', text: 'at ' + bwMoney(r.each) + (r.sellers && r.sellers.length ? ' · ' + r.sellers.join(', ') : r.seller ? ' · ' + r.seller : '') + (r.at ? ' · ' + bwTime(r.at) : '') + ' · ' + (m.trader || 'they') + ' pays ' + bwMoney(r.bid) }),
            ]));
        }
        if (buys) {
            body.appendChild(bwEl('div', { class: 'bw-tot' }, [
                bwEl('span', { text: 'Cost' }), bwEl('b', { text: bwMoney(m.totals.cost) }),
                bwEl('span', { text: (m.trader || 'They') + ' pays' }), bwEl('b', { text: bwMoney(m.totals.pays) }),
                bwEl('span', { text: 'Profit' }), bwEl('b', { class: m.totals.profit >= 0 ? 'bw-g' : 'bw-neg', text: bwSigned(m.totals.profit) }),
            ]));
        }
        // Without the cart (no plan lines): the count, as before.
        if (m.toBuy && !cartLines.length) body.appendChild(bwEl('p', { class: 'bw-todo', text: 'Still to buy: ' + m.toBuy + (m.toBuy === 1 ? ' bazaar' : ' bazaars') }));
        // The checklist's verdict on the trade page: all in, or what is missing.
        if (m.onTradePage && buys) {
            body.appendChild(m.missing.length
                ? bwEl('p', { class: 'bw-warn', role: 'status', text: 'Not in the trade yet: ' + m.missing.map((x) => x.name + ' ×' + x.qty.toLocaleString('en-US')).join(', ') })
                : bwEl('p', { class: 'bw-ok', role: 'status', text: 'Everything you bought is in the trade ✓' }));
        }
        body.appendChild(this.cancelPart(m));
        box.appendChild(body);
        this.body = body;
        this.place();
        if (scrolled) body.scrollTop = scrolled;
    }
}

export const BOUGHT_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.bw {
    --bg: #2e2e2e; --row: #2b2b2b; --line: #444; --text: #ddd; --muted: #b3b3b3; --profit: #99cc00;
    --buy: #4dabf7; --orange: #ff9f43; --red: #ff8a80; --warn: #f0a020;
    position: fixed; z-index: 2147483001; width: 300px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
    display: flex; flex-direction: column; background: var(--bg); color: var(--text);
    border: 1px solid var(--buy); border-radius: 4px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font: 13px/1.4 Arial, Helvetica, sans-serif;
}
.bw.bw-drag { opacity: 0.92; }
.bw-hd { display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 4px 4px 4px 12px; cursor: move; user-select: none;
    background: repeating-linear-gradient(90deg, #242424 0 2px, #2e2e2e 0 4px); border-bottom: 1px solid var(--line); touch-action: none; }
.bw-folded .bw-hd { border-bottom: 0; }
.bw-ti { flex: 1; min-width: 0; font-weight: bold; color: #fff; overflow-wrap: anywhere; }
.bw-mini { font-weight: normal; color: var(--profit); }
.bw-ic { width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text); font: 15px/22px Arial, Helvetica, sans-serif; cursor: pointer; }
.bw-ic:hover { border-color: var(--line); }
.bw-ic:focus-visible { outline: 2px solid var(--profit); outline-offset: 1px; }
.bw-body { padding: 8px 12px 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.bw-hd { flex: 0 0 auto; }
.bw-log { font-size: 12px; color: var(--warn); margin: -2px 0 6px; }
.bw-log.bw-log-ok { color: var(--muted); }
.bw-fold { width: 100%; text-align: left; color: var(--text); font: 13px/1.4 Arial, Helvetica, sans-serif; cursor: pointer; }
.bw-fold:hover { border-color: var(--buy); }
.bw-fold:focus-visible { outline: 2px solid var(--profit); outline-offset: 1px; }
.bw-fold .bw-n { color: var(--muted); }
.bw-fold-back { display: block; margin: 0 0 6px auto; }
.bw-hold { flex: 1 1 100%; margin: 0; padding-left: 16px; font-size: 12px; }
.bw-hold li { margin: 2px 0; overflow-wrap: anywhere; }
.bw-hold b { color: #fff; }
.bw-g { color: var(--profit); }
.bw-mute { color: var(--muted); }
.bw-since { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.bw-empty { margin: 0; font-size: 12px; color: var(--muted); }
.bw-it { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; padding: 6px 8px; margin-bottom: 6px;
    background: var(--row); border: 1px solid var(--line); border-left: 3px solid var(--buy); border-radius: 4px; }
.bw-it.bw-extra { border-left-color: var(--orange); }
.bw-it.bw-loss { border-left-color: var(--red); }
.bw-n { min-width: 0; overflow-wrap: anywhere; }
.bw-n b { color: #fff; }
.bw-tag { margin-left: 6px; font-size: 11px; font-weight: bold; color: var(--orange); white-space: nowrap; }
.bw-loss .bw-tag { color: var(--red); }
.bw-p { text-align: right; font-weight: bold; color: var(--profit); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bw-p.bw-neg, .bw-neg { color: var(--red); }
.bw-d { grid-column: 1 / -1; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.bw-ck { display: block; font-size: 11px; }
.bw-in { color: var(--profit); }
.bw-miss { color: var(--warn); }
.bw-tot { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); font-size: 12px; }
.bw-tot span { color: var(--muted); }
.bw-tot b { text-align: right; font-variant-numeric: tabular-nums; }
.bw-tot b.bw-g { color: var(--profit); font-size: 15px; }
.bw-todo { margin: 8px 0 0; font-size: 12px; color: var(--buy); }
.bw-warn { margin: 8px 0 0; font-size: 12px; font-weight: bold; color: var(--warn); }
.bw-ok { margin: 8px 0 0; font-size: 12px; font-weight: bold; color: var(--profit); }
.bw-cancel { margin-top: 8px; text-align: right; }
.bw-sec { display: flex; justify-content: space-between; margin: 8px 0 6px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
.bw-sec:first-of-type { margin-top: 2px; }
.bw-sec .bw-g { color: var(--profit); }
.bw-cart { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 2px 8px; align-items: baseline; padding: 6px 8px; margin-bottom: 4px; background: var(--row); border: 1px solid var(--line); border-radius: 4px; }
.bw-cart .bw-d { grid-column: 2 / -1; }
.bw-cart-here { border-color: var(--buy); box-shadow: inset 3px 0 0 var(--buy); }
.bw-cart-done .bw-n, .bw-cart-skipped .bw-n { color: var(--muted); }
.bw-cart-done .bw-n b, .bw-cart-skipped .bw-n b { color: var(--muted); text-decoration: line-through; }
.bw-mark { font-weight: bold; text-align: center; }
.bw-m-todo { color: var(--muted); }
.bw-m-here { color: var(--buy); }
.bw-m-done { color: var(--profit); }
.bw-m-part { color: var(--warn); }
.bw-m-skip { color: var(--muted); }
.bw-tag-here { color: var(--buy); }
.bw-tag-mute { color: var(--muted); }
.bw-open { color: var(--buy); font-size: 12px; text-decoration: none; white-space: nowrap; }
.bw-open:hover { text-decoration: underline; }
.bw-cancel.bw-ask { display: flex; flex-wrap: wrap; gap: 6px; text-align: left; }
.bw-cancel.bw-ask .bw-warn { flex: 1 1 100%; margin: 0; }
.bw-link { padding: 0; border: 0; background: none; color: var(--muted); font: 12px Arial, Helvetica, sans-serif; text-decoration: underline; cursor: pointer; }
.bw-link:hover { color: var(--text); }
.bw-btn { flex: 1; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 4px; background: #3a3a3a; color: var(--text); font: 12px Arial, Helvetica, sans-serif; cursor: pointer; }
.bw-btn:hover { border-color: var(--buy); }
.bw-link:focus-visible, .bw-btn:focus-visible { outline: 2px solid var(--profit); outline-offset: 1px; }
`;
