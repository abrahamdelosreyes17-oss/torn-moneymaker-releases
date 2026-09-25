/*
 * All CSS for the script, in one place.
 *
 * The row marker is the important part. It is a pure `box-shadow: inset`,
 * which paints INSIDE the row's existing box: it adds no element, occupies no
 * space, and shifts nothing. That is what stops it covering the Buy button,
 * which is what V1's absolutely-positioned badge did.
 *
 * `!important` appears only on the marker's own box-shadow and tint, because
 * Torn's row styles set box-shadow themselves. It is deliberately not used on
 * `outline`, and the marker never touches `position`.
 *
 * Design rules the panel and the selling page share (see README):
 *   font Arial; sizes 11px (uppercase labels only), 12px (secondary), 13px
 *   (body), 15px bold (the key money number); line-height 1.4; spacing in
 *   4/8/12/16px; money right-aligned in tabular figures; colours only from
 *   the tokens below; a Torn-style striped title bar.
 */

export const UI_PREFIX = 'ttv2';

/*
 * Colour tokens, shared by the panel and the selling page. All fixed and
 * dark. The background used to borrow Torn's --default-bg-panel-color, but
 * Torn sets its dark value on <body>; the selling page is attached outside
 * it and got Torn's LIGHT default - light-grey text on a light page.
 */
export const TOKENS_CSS = `
    --bg: #2e2e2e;
    --row: #2b2b2b;
    --line: #444;
    --text: #ddd;
    --muted: #999;
    --profit: #99cc00;
    --offer: #74c0fc;
    --warn: #e0a000;
    --bad: #d83500;
    --on-profit: #1b1b1b;
    --title: repeating-linear-gradient(90deg, #242424 0 2px, #2e2e2e 0 4px);
`;

/*
 * Two stylesheets, deliberately apart.
 *
 * PAGE_CSS marks Torn's own item cards, so it must live in the page.
 * PANEL_CSS styles the panel, which lives in a shadow root: Torn's page CSS
 * cannot reach in (it had been restyling our headings to giant type), and
 * ours cannot leak out.
 */
export const PAGE_CSS = `
.ttv2-hit {
    position: relative !important;

    box-shadow:
        inset 0 0 0 3px #35d35a,
        inset 0 0 0 9999px rgba(53, 211, 90, 0.16) !important;

    transition: box-shadow 0.15s ease;
}

/*
 * The profit label, drawn as a pseudo-element from a data attribute.
 *
 * pointer-events: none is the important line: it means this can never
 * intercept a click, so it cannot block Torn's Buy button no matter where it
 * lands. That was the original complaint about V1, and it is fixed by making
 * the label unclickable rather than by removing it.
 */
.ttv2-hit.ttv2-hit::after {
    /*
     * Every declaration here is load-bearing, and all of it was worked out
     * against a live Torn page rather than guessed.
     *
     * - The doubled class and !important on 'content': Torn defines ::after
     *   on its own item tiles at equal specificity and wins on document
     *   order, so the plain rule computed to content: "" and the label
     *   silently never appeared.
     * - The width/height/inset resets: overriding 'content' alone leaves
     *   Torn's geometry in place, which clipped the label to an 8px sliver.
     * - The chip background: white text alone was invisible against the
     *   tile's artwork.
     */
    content: attr(data-ttv2-profit) !important;

    display: block !important;
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    left: auto !important;
    bottom: auto !important;

    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 1px 4px !important;
    transform: none !important;

    overflow: visible !important;
    white-space: nowrap !important;
    opacity: 1 !important;
    visibility: visible !important;
    z-index: 2147483000 !important;

    background: rgba(10, 40, 16, 0.92) !important;
    border: 1px solid #35d35a !important;
    border-radius: 0 0 0 5px !important;

    color: #7ee08f !important;
    font: 800 11px/14px Arial, Helvetica, sans-serif !important;

    /* Cannot intercept a click, so it can never block Torn's Buy button. */
    pointer-events: none !important;
}

/* The listing a feed link was opened for. Paint-only, like .ttv2-hit. */
.ttv2-target {
    box-shadow:
        inset 0 0 0 3px #ffd24a,
        inset 0 0 0 9999px rgba(255, 210, 74, 0.14) !important;
}

.ttv2-hit-top {
    box-shadow:
        inset 0 0 0 3px #7ee08f,
        inset 0 0 0 9999px rgba(126, 224, 143, 0.24) !important;
}

/*
 * Profitable, but below your Min: amber, thinner and fainter than green, so
 * the deals that meet your Min still stand out first. (Yellow is taken: it
 * marks the listing a panel link was opened for.)
 */
.ttv2-hit.ttv2-hit-low {
    box-shadow:
        inset 0 0 0 2px #f0a020,
        inset 0 0 0 9999px rgba(240, 160, 32, 0.12) !important;
}

.ttv2-hit.ttv2-hit-low.ttv2-hit-low::after {
    background: rgba(48, 30, 4, 0.9) !important;
    border-color: #f0a020 !important;
    color: #f5c060 !important;
    font-weight: 700 !important;
}

/* Bazaar owner status, right after their name in the page banner. */
.ttv2-owner {
    display: inline-block;
    margin: 0 4px 0 8px;
    padding: 0 8px;
    border-radius: 9px;
    font: bold 12px/18px Arial, Helvetica, sans-serif;
    color: #ddd;
    background: rgba(0, 0, 0, 0.35);
    white-space: nowrap;
    vertical-align: middle;
}

.ttv2-owner::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 50%;
    background: #999;
    vertical-align: 0;
}

.ttv2-owner[data-level="online"]::before { background: #99cc00; }
.ttv2-owner[data-level="idle"]::before { background: #e0a000; }
.ttv2-owner[data-level="offline"]::before { background: #999; }

/*
 * Your own bazaar's add / manage rows: the current asking prices, after the
 * item name. Text only; nothing is filled in or clicked.
 */
.ttv2-bztag {
    display: inline-block;
    margin-left: 8px;
    padding: 0 8px;
    border: 1px solid #444;
    border-radius: 4px;
    font: 12px/20px Arial, Helvetica, sans-serif;
    font-variant-numeric: tabular-nums;
    color: #ddd;
    background: #2b2b2b;
    white-space: nowrap;
    vertical-align: middle;
    cursor: pointer;
}

.ttv2-bztag:hover,
.ttv2-bztag[data-selected="true"] {
    border-color: #99cc00;
}

.ttv2-bztag b {
    color: #a8dd1c;
    font-weight: bold;
}
`;

export const PANEL_CSS = `
/* Nothing from the page is inherited into the panel. */
:host {
    all: initial;
}

.ttv2-panel {
${TOKENS_CSS}
    position: fixed;
    right: var(--fit-right, 16px);
    bottom: 16px;
    z-index: 2147483000;
    /* Its usual 430px, or the free space beside Torn's content when that is less. */
    width: var(--fit-width, 430px);
    max-width: calc(100vw - 16px);
    /* One fixed height on every tab and page; lists scroll inside it. */
    height: min(75vh, 640px);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font: 13px/1.4 Arial, Helvetica, sans-serif;
    text-align: left;
    overflow: hidden;
}

.ttv2-panel *,
.ttv2-panel *::before,
.ttv2-panel *::after {
    box-sizing: border-box;
}

.ttv2-panel a {
    color: var(--offer);
    text-decoration: none;
}

.ttv2-panel a:hover {
    text-decoration: underline;
}

.ttv2-panel b,
.ttv2-panel strong {
    font-weight: bold;
}

.ttv2-panel button {
    font: bold 12px/1 Arial, Helvetica, sans-serif;
    height: 28px;
    padding: 0 12px;
    color: var(--text);
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}

.ttv2-panel button:hover:not(:disabled) {
    border-color: var(--muted);
}

.ttv2-panel button:disabled {
    opacity: 0.5;
    cursor: default;
}

.ttv2-panel button:focus-visible,
.ttv2-panel input:focus-visible,
.ttv2-panel summary:focus-visible {
    outline: 2px solid var(--profit);
    outline-offset: 1px;
}

.ttv2-panel button.ttv2-primary {
    color: var(--on-profit);
    background: var(--profit);
    border-color: var(--profit);
}

.ttv2-panel button.ttv2-link {
    height: auto;
    padding: 0;
    background: none;
    border: 0;
    color: var(--offer);
    font-weight: normal;
    font-size: 12px;
}

.ttv2-panel button.ttv2-link:hover:not(:disabled) {
    text-decoration: underline;
}

.ttv2-panel input[type="text"] {
    font: 13px/1.4 Arial, Helvetica, sans-serif;
    height: 28px;
    color: var(--text);
    background: var(--row);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 8px;
    width: 100%;
}

.ttv2-panel input[type="checkbox"] {
    accent-color: var(--profit);
    margin: 3px 0 0;
}

.ttv2-money {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

.ttv2-label {
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--muted);
}

/* ---------------------------------------------------------------- header */

.ttv2-head {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 4px 0 12px;
    background: var(--title);
    border-bottom: 1px solid var(--line);
    cursor: move;
    user-select: none;
    flex: 0 0 auto;
    position: relative;
}

.ttv2-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 1px;
    color: #fff;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.65);
}

.ttv2-mini {
    margin-left: 8px;
    color: var(--profit);
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
}

.ttv2-panel button.ttv2-icon {
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 15px;
    line-height: 22px;
    text-align: center;
    background: transparent;
    border-color: transparent;
    color: var(--text);
}

.ttv2-panel button.ttv2-icon:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: transparent;
}

.ttv2-panel button.ttv2-icon[aria-pressed="true"] {
    color: var(--profit);
}

.ttv2-panel button.ttv2-back {
    display: none;
    margin-left: -8px;
}

.ttv2-on-settings button.ttv2-back {
    display: inline-block;
}

.ttv2-panel button.ttv2-scan {
    height: 24px;
    padding: 0 12px;
    color: var(--on-profit);
    background: var(--profit);
    border-color: var(--profit);
}

.ttv2-panel button.ttv2-sell {
    height: 24px;
    padding: 0 8px;
    background: transparent;
    border-color: var(--offer);
    color: var(--offer);
}

.ttv2-scanning button.ttv2-scan {
    animation: ttv2-pulse 0.8s ease-out;
}

@keyframes ttv2-pulse {
    0% { box-shadow: 0 0 0 0 rgba(153, 204, 0, 0.7); }
    100% { box-shadow: 0 0 0 8px rgba(153, 204, 0, 0); }
}

.ttv2-sweep {
    position: absolute;
    left: 0;
    bottom: -1px;
    height: 2px;
    width: 30%;
    background: linear-gradient(90deg, transparent, var(--profit), transparent);
    opacity: 0;
    pointer-events: none;
}

.ttv2-scanning .ttv2-sweep {
    animation: ttv2-sweep 0.8s ease-in-out;
}

@keyframes ttv2-sweep {
    0% { left: -30%; opacity: 1; }
    100% { left: 100%; opacity: 1; }
}

.ttv2-spin {
    animation: ttv2-spin 0.9s linear infinite;
}

@keyframes ttv2-spin {
    to { transform: rotate(360deg); }
}

/* -------------------------------------------------------------- collapsed */

.ttv2-panel.ttv2-collapsed {
    height: auto;
}

.ttv2-collapsed .ttv2-body {
    display: none;
}

.ttv2-collapsed .ttv2-head {
    border-bottom: 0;
    cursor: pointer;
}

/*
 * Fitted beside Torn's content (see fit() in panel.js): where the free space
 * is narrower than the usual header, the header stays ONE row with slightly
 * smaller type and tighter spacing - nothing is cut short and nothing wraps.
 */
.ttv2-panel.ttv2-narrow .ttv2-head {
    gap: 4px;
    padding: 0 4px 0 8px;
}

.ttv2-panel.ttv2-narrow .ttv2-title {
    flex: 1 0 auto;
    min-width: max-content;
    overflow: visible;
    text-overflow: clip;
    font-size: 12px;
    letter-spacing: 0;
}

.ttv2-panel.ttv2-narrow .ttv2-mini {
    margin-left: 4px;
}

.ttv2-panel.ttv2-narrow button.ttv2-sell,
.ttv2-panel.ttv2-narrow button.ttv2-scan {
    height: 22px;
    padding: 0 8px;
    font-size: 12px;
}

.ttv2-panel.ttv2-narrow button.ttv2-icon {
    width: 20px;
}

/* Still too little room: one step smaller, still one row, nothing cut. */
.ttv2-panel.ttv2-tight .ttv2-head {
    gap: 2px;
    padding: 0 2px 0 6px;
}

.ttv2-panel.ttv2-tight .ttv2-title,
.ttv2-panel.ttv2-tight button.ttv2-sell,
.ttv2-panel.ttv2-tight button.ttv2-scan {
    font-size: 11px;
}

.ttv2-panel.ttv2-tight button.ttv2-sell,
.ttv2-panel.ttv2-tight button.ttv2-scan {
    padding: 0 5px;
}

.ttv2-panel.ttv2-tight button.ttv2-icon {
    width: 18px;
}

.ttv2-panel.ttv2-tight .ttv2-mini {
    margin-left: 2px;
}

/*
 * The filter chips and the tabs: one row each, like the header. In less
 * room the chips and their spacing get smaller, never wrapped or cut.
 */
.ttv2-panel.ttv2-narrow .ttv2-chips {
    gap: 4px;
    padding: 6px 8px;
}

.ttv2-panel.ttv2-narrow button.ttv2-chip {
    height: 22px;
    padding: 0 6px;
    font-size: 12px;
}

.ttv2-panel.ttv2-narrow input.ttv2-chip-input {
    width: 72px;
    height: 22px;
    padding: 0 6px;
}

.ttv2-panel.ttv2-narrow .ttv2-tabs {
    gap: 2px;
    padding: 6px 8px 0;
}

.ttv2-panel.ttv2-narrow button.ttv2-tab {
    padding: 0 8px;
    font-size: 12px;
}

.ttv2-panel.ttv2-narrow .ttv2-credit {
    font-size: 11px;
}

.ttv2-panel.ttv2-tight .ttv2-chips {
    gap: 3px;
    padding: 6px;
}

.ttv2-panel.ttv2-tight button.ttv2-chip {
    padding: 0 5px;
    font-size: 11px;
}

.ttv2-panel.ttv2-tight .ttv2-tabs {
    padding: 6px 6px 0;
}

.ttv2-panel.ttv2-tight button.ttv2-tab {
    padding: 0 6px;
    font-size: 11px;
}

/* The last step, for the least room: tighter spacing again, and the chips a size smaller. */
.ttv2-panel.ttv2-tighter .ttv2-chips {
    gap: 2px;
    padding: 6px 4px;
}

.ttv2-panel.ttv2-tighter button.ttv2-chip {
    padding: 0 3px;
    font-size: 10px;
}

.ttv2-panel.ttv2-tighter .ttv2-tabs {
    padding: 6px 4px 0;
}

.ttv2-panel.ttv2-tighter button.ttv2-tab {
    padding: 0 4px;
}

/* The status line wraps rather than cutting its message short. */
.ttv2-panel.ttv2-narrow .ttv2-bar-left {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
}

/* ------------------------------------------------------------ status bar */

.ttv2-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.ttv2-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
    flex: 0 0 auto;
}

.ttv2-bar-left {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
}

.ttv2-bar.ttv2-warn .ttv2-bar-left {
    color: var(--warn);
    font-weight: normal;
}

.ttv2-bar.ttv2-error .ttv2-bar-left {
    color: var(--bad);
    font-weight: normal;
}

.ttv2-bar-right {
    color: var(--muted);
    white-space: nowrap;
}

.ttv2-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--muted);
    vertical-align: 0;
}

.ttv2-dot-live { background: var(--profit); }
.ttv2-dot-warn { background: var(--warn); }
.ttv2-dot-other { background: var(--offer); }

/* Seller of the bazaar you are on. */
.ttv2-seller {
    display: none;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 0 auto;
}

.ttv2-seller.ttv2-shown {
    display: block;
}

.ttv2-seller b {
    color: var(--text);
}

.ttv2-seller .ttv2-closed {
    margin-left: 8px;
    color: var(--bad);
    font-weight: bold;
}

/* ------------------------------------------------------------------ pages */

.ttv2-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.ttv2-page-settings,
.ttv2-on-settings .ttv2-page-list {
    display: none;
}

.ttv2-on-settings .ttv2-page-settings {
    display: flex;
    overflow-y: auto;
    padding: 12px;
    gap: 16px;
}

/* ------------------------------------------------------------------ chips */

.ttv2-chips {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
    overflow: hidden;
}

.ttv2-panel button.ttv2-chips-end {
    margin-left: auto;
}

.ttv2-panel button.ttv2-chip {
    flex: 0 0 auto;
    white-space: nowrap;
    height: 24px;
    padding: 0 8px;
    border-radius: 12px;
    font-weight: normal;
    background: transparent;
    border-color: var(--line);
    color: var(--muted);
}

.ttv2-panel button.ttv2-chip[aria-pressed="true"] {
    color: var(--text);
    border-color: var(--profit);
    background: rgba(153, 204, 0, 0.12);
}

.ttv2-panel button.ttv2-chip-set {
    color: var(--text);
    border-color: var(--muted);
}

.ttv2-panel input.ttv2-chip-input {
    width: 96px;
    height: 24px;
    padding: 0 8px;
    border-radius: 12px;
    font-size: 12px;
}

/* ------------------------------------------------------------------- tabs */

.ttv2-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
}

.ttv2-panel button.ttv2-tab {
    flex: 0 0 auto;
    height: 28px;
    border-radius: 4px 4px 0 0;
    border-bottom: 0;
    background: transparent;
    color: var(--muted);
    font-weight: normal;
}

.ttv2-panel button.ttv2-tab.ttv2-tab-on {
    background: var(--row);
    color: var(--text);
    font-weight: bold;
    box-shadow: inset 0 2px 0 var(--profit);
}

.ttv2-credit {
    flex: 0 0 auto;
    margin-left: auto;
    padding-bottom: 8px;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
}

/* ------------------------------------------------------------------- list */

.ttv2-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px;
}

.ttv2-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px;
    gap: 8px;
    padding: 0 12px 4px;
}

.ttv2-cols .ttv2-money {
    color: var(--muted);
}

/*
 * One deal, two lines:
 *   Xanax ×390                                   +$11,255
 *   Bazaar · Garrett89 ● Offline 3h · Buy $838,745 · 40s     [Go]
 */
.ttv2-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    align-items: start;
    column-gap: 8px;
    row-gap: 4px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--row);
    border: 1px solid var(--line);
    border-radius: 4px;
}

.ttv2-row.ttv2-onpage {
    border-color: var(--profit);
}

.ttv2-row-name {
    min-width: 0;
    font-weight: bold;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-row-name .ttv2-qty {
    margin-left: 4px;
    font-weight: normal;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

.ttv2-row-profit {
    font-size: 15px;
    font-weight: bold;
    color: var(--profit);
    min-width: 96px;
}

.ttv2-row-profit .ttv2-per {
    display: block;
    font-size: 12px;
    font-weight: normal;
    color: var(--muted);
}

.ttv2-row-details {
    align-self: center;
}

.ttv2-row-details {
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
}

.ttv2-row-details b {
    color: var(--text);
    font-weight: normal;
}

.ttv2-row-details .ttv2-guess {
    color: var(--warn);
    cursor: help;
}

/* "● Online" / "● Offline 3h" - an 8px dot and a word. */
.ttv2-status::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin: 0 4px 0 4px;
    border-radius: 50%;
    background: var(--muted);
    vertical-align: 0;
}

.ttv2-status[data-level="online"]::before { background: var(--profit); }
.ttv2-status[data-level="idle"]::before { background: var(--warn); }
.ttv2-status[data-level="unknown"]::before {
    background: transparent;
    border: 1px solid var(--muted);
}

.ttv2-panel button.ttv2-go {
    justify-self: end;
    min-width: 40px;
    padding: 0 8px;
}

.ttv2-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px 16px;
    text-align: center;
}

.ttv2-empty-text {
    color: var(--muted);
    max-width: 320px;
}

/* --------------------------------------------------------- my bazaar view */

.ttv2-bzlist {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
    max-height: 40%;
    overflow-y: auto;
}

.ttv2-bzrow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 120px;
    gap: 8px;
    align-items: center;
    width: 100%;
    height: auto;
    padding: 4px 8px;
    margin-bottom: 4px;
    text-align: left;
    font-weight: normal;
    background: transparent;
    border-color: transparent;
}

.ttv2-panel button.ttv2-bzrow {
    height: auto;
    padding: 4px 8px;
    font-weight: normal;
    font-size: 13px;
    background: transparent;
    border-color: transparent;
}

.ttv2-panel button.ttv2-bzrow[aria-pressed="true"] {
    background: var(--row);
    border-color: var(--line);
}

.ttv2-bzrow .ttv2-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
}

.ttv2-bzrow .ttv2-money {
    color: var(--text);
    font-variant-numeric: tabular-nums;
}

.ttv2-panel button.ttv2-bzrow[aria-pressed="true"] .ttv2-money {
    color: #a8dd1c;
    font-weight: bold;
}

.ttv2-bzdetail {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ttv2-bzhero {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.ttv2-bzhero h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: bold;
    color: #fff;
}

.ttv2-bzavg {
    font-size: 20px;
    font-weight: bold;
    line-height: 1.2;
    color: #a8dd1c;
    font-variant-numeric: tabular-nums;
}

.ttv2-graph-box {
    position: relative;
}

.ttv2-graph {
    display: block;
    width: 100%;
    height: auto;
    background: #262626;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: crosshair;
}

.ttv2-graph-grid { stroke: #3a3a3a; stroke-width: 1; }
.ttv2-graph-label { fill: #999; font: 11px Arial, Helvetica, sans-serif; font-variant-numeric: tabular-nums; }
.ttv2-graph-empty { fill: #999; font: 12px Arial, Helvetica, sans-serif; }
.ttv2-graph-cursor { stroke: #777; stroke-width: 1; }

.ttv2-graph-tip {
    position: absolute;
    top: 8px;
    min-width: 120px;
    padding: 4px 8px;
    font-size: 12px;
    line-height: 1.4;
    background: rgba(20, 20, 20, 0.92);
    border: 1px solid var(--line);
    border-radius: 4px;
    pointer-events: none;
    white-space: nowrap;
}

.ttv2-graph-tip[hidden] { display: none; }
.ttv2-tip-when { color: var(--muted); }
.ttv2-tip-mv { color: #a8dd1c; font-weight: bold; }
.ttv2-tip-im { color: var(--offer); }

.ttv2-graph-keys {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--muted);
}

.ttv2-graph-keys span { display: inline-flex; align-items: center; gap: 4px; }
.ttv2-graph-keys i { display: inline-block; width: 16px; height: 0; border-top: 2px solid; }
.ttv2-graph-keys .ttv2-key-mv i { border-color: #a8dd1c; }
.ttv2-graph-keys .ttv2-key-im i { border-color: var(--offer); border-top-width: 1px; }

.ttv2-windows {
    display: flex;
    gap: 4px;
}

.ttv2-panel button.ttv2-window {
    height: 24px;
    padding: 0 8px;
    font-weight: normal;
    background: transparent;
}

.ttv2-panel button.ttv2-window[aria-pressed="true"] {
    background: var(--row);
    border-color: var(--muted);
    font-weight: bold;
}

.ttv2-note {
    color: var(--muted);
    font-size: 12px;
}

/* --------------------------------------------------------------- settings */

.ttv2-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ttv2-h {
    margin: 0;
    padding: 0;
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
}

.ttv2-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
}

.ttv2-check-label {
    color: var(--text);
}

.ttv2-sub {
    display: block;
    color: var(--muted);
    font-size: 12px;
}

.ttv2-inline {
    display: flex;
    gap: 8px;
    align-items: center;
}

.ttv2-inline input {
    flex: 1;
    min-width: 0;
}

.ttv2-masked {
    -webkit-text-security: disc;
}

.ttv2-keystate {
    font-size: 12px;
    color: var(--muted);
}

.ttv2-keystate.ttv2-ok { color: var(--profit); }
.ttv2-keystate.ttv2-bad { color: var(--bad); }

.ttv2-tos-box {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 8px;
    background: var(--row);
}

.ttv2-tos-box summary {
    cursor: pointer;
    color: var(--text);
    font-size: 12px;
}

.ttv2-tos {
    width: 100%;
    margin-top: 8px;
    border-collapse: collapse;
    font-size: 12px;
    color: var(--text);
}

.ttv2-tos th,
.ttv2-tos td {
    text-align: left;
    vertical-align: top;
    padding: 4px;
    border-top: 1px solid var(--line);
}

.ttv2-tos th {
    width: 36%;
    color: var(--muted);
    font-weight: normal;
}
`;

/** Inject the page (card marker) stylesheet once. */
export function injectStyles(doc = document) {
    const id = UI_PREFIX + '-styles';
    if (doc.getElementById(id)) return;

    const style = doc.createElement('style');
    style.id = id;
    style.textContent = PAGE_CSS;

    (doc.head || doc.documentElement).appendChild(style);
}

/** A <style> for the panel's shadow root. */
export function panelStyleElement(doc = document) {
    const style = doc.createElement('style');
    style.textContent = PANEL_CSS;
    return style;
}
