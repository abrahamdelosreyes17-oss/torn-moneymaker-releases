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
 */

export const UI_PREFIX = 'ttv2';

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

/* The best few opportunities on the page get a warmer fill. */
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

/* Bazaar owner status, right after their name in the page banner. */
.ttv2-owner {
    display: inline-block;
    margin: 0 4px 0 6px;
    padding: 0 7px 0 6px;
    border-radius: 9px;
    font: bold 11px/17px Arial, Helvetica, sans-serif;
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
    margin-right: 5px;
    border-radius: 50%;
    background: #888;
    vertical-align: 0;
}

.ttv2-owner[data-level="online"]::before { background: #5ed36f; }
.ttv2-owner[data-level="idle"]::before { background: #f0c040; }
.ttv2-owner[data-level="offline"]::before { background: #777; }
`;

export const PANEL_CSS = `
/* Nothing from the page is inherited into the panel. */
:host {
    all: initial;
}

/*
 * Neutral greys, cards with a rank, a green profit column and a full-width
 * GO button - the original script's look, which people liked.
 */
.ttv2-panel {
    --bg: #1f1f1f;
    --bg2: #262626;
    --bg3: #2d2d2d;
    --line: #3a3a3a;
    --line2: #4a4a4a;
    --text: #eee;
    --muted: #9a9a9a;
    --faint: #777;
    --green: #65d27a;
    --amber: #ffcc4d;
    --red: #ff8f7a;

    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483000;
    width: 430px;
    max-width: calc(100vw - 32px);
    /* Fits its content; the list scrolls beyond this. */
    max-height: min(75vh, 720px);
    min-height: 220px;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    border: 1px solid #555;
    border-radius: 8px;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
    font: 12px/1.35 Arial, Helvetica, sans-serif;
    text-align: left;
    overflow: hidden;
}

.ttv2-panel *,
.ttv2-panel *::before,
.ttv2-panel *::after {
    box-sizing: border-box;
}

.ttv2-panel a {
    color: var(--green);
}

.ttv2-panel button {
    font: inherit;
    font-size: 11px;
    font-weight: bold;
    color: var(--text);
    background: #353535;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 5px 9px;
    cursor: pointer;
}

.ttv2-panel button:hover:not(:disabled) {
    background: #444;
}

.ttv2-panel button:disabled {
    opacity: 0.5;
    cursor: default;
}

.ttv2-panel button:focus-visible,
.ttv2-panel input:focus-visible,
.ttv2-panel summary:focus-visible {
    outline: 2px solid var(--green);
    outline-offset: 1px;
}

.ttv2-panel button.ttv2-primary {
    background: #2f5d38;
    border-color: #3f7d4b;
}

.ttv2-panel button.ttv2-primary:hover:not(:disabled) {
    background: #37703f;
}

.ttv2-panel button.ttv2-link {
    background: none;
    border: 0;
    padding: 2px 0;
    color: var(--muted);
    font-weight: normal;
    text-decoration: underline;
    align-self: flex-start;
}

.ttv2-panel input[type="text"] {
    font: inherit;
    color: var(--text);
    background: #181818;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 5px 7px;
    width: 100%;
}

.ttv2-panel input[type="checkbox"] {
    accent-color: var(--green);
    margin: 2px 0 0;
}

/* ---------------------------------------------------------------- header */

.ttv2-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 6px 6px 12px;
    background: #292929;
    border-bottom: 1px solid #444;
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
}

.ttv2-title-text {
    font-size: 13px;
    font-weight: bold;
}

.ttv2-ver {
    margin-left: 6px;
    color: var(--faint);
    font-size: 10px;
}

.ttv2-mini {
    margin-left: 6px;
    color: var(--green);
    font-weight: bold;
}

.ttv2-panel button.ttv2-icon {
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 15px;
    line-height: 26px;
    text-align: center;
    background: transparent;
    border-color: transparent;
    color: #ccc;
}

.ttv2-panel button.ttv2-icon:hover:not(:disabled) {
    background: #3a3a3a;
    color: #fff;
}

.ttv2-panel button.ttv2-icon[aria-pressed="true"] {
    background: #3a3a3a;
    border-color: #555;
    color: var(--green);
}

.ttv2-panel button.ttv2-back {
    display: none;
    margin-left: -6px;
}

.ttv2-on-settings button.ttv2-back {
    display: inline-block;
}

.ttv2-panel button.ttv2-scan {
    height: 24px;
    padding: 0 9px;
    margin-right: 2px;
    font-size: 12px;
    font-weight: bold;
    color: var(--green);
    background: transparent;
    border-color: #4a6a4a;
}

.ttv2-panel button.ttv2-scan:hover:not(:disabled) {
    background: #2f3d2f;
}

.ttv2-scanning button.ttv2-scan {
    animation: ttv2-pulse 0.8s ease-out;
}

@keyframes ttv2-pulse {
    0% { box-shadow: 0 0 0 0 rgba(120, 200, 120, 0.7); background: #2f4a2f; }
    100% { box-shadow: 0 0 0 8px rgba(120, 200, 120, 0); }
}

.ttv2-sweep {
    position: absolute;
    left: 0;
    bottom: -1px;
    height: 2px;
    width: 30%;
    background: linear-gradient(90deg, transparent, var(--green), transparent);
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

.ttv2-seller {
    display: none;
    padding: 5px 12px;
    font-size: 12px;
    color: #ccc;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Never squeezed by a long list: overflow:hidden lets flex shrink it to nothing. */
    flex: 0 0 auto;
}

.ttv2-seller.ttv2-shown {
    display: block;
}

.ttv2-seller b {
    color: #fff;
}

.ttv2-seller .ttv2-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin: 0 4px 0 6px;
    border-radius: 50%;
    background: #888;
}

.ttv2-seller .ttv2-dot[data-level="online"] { background: #5ed36f; }
.ttv2-seller .ttv2-dot[data-level="idle"] { background: #f0c040; }
.ttv2-seller .ttv2-dot[data-level="offline"] { background: #777; }

.ttv2-seller .ttv2-closed {
    margin-left: 6px;
    color: #ff8a80;
    font-weight: bold;
}

.ttv2-spin {
    animation: ttv2-spin 0.9s linear infinite;
}

@keyframes ttv2-spin {
    to { transform: rotate(360deg); }
}

/* -------------------------------------------------------------- collapsed */

.ttv2-panel.ttv2-collapsed {
    min-height: 0;
}

.ttv2-collapsed .ttv2-body {
    display: none;
}

.ttv2-collapsed .ttv2-head {
    border-bottom: 0;
    cursor: pointer;
}

.ttv2-collapsed .ttv2-ver {
    display: none;
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
    gap: 10px;
    padding: 6px 12px;
    background: var(--bg2);
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
}

.ttv2-bar.ttv2-warn .ttv2-bar-left {
    color: var(--amber);
    font-weight: normal;
}

.ttv2-bar.ttv2-error .ttv2-bar-left {
    color: var(--red);
    font-weight: normal;
}

.ttv2-bar-right {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
}

.ttv2-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 5px;
    border-radius: 50%;
    background: #666;
    vertical-align: 0;
}

.ttv2-dot-live { background: var(--green); box-shadow: 0 0 5px var(--green); }
.ttv2-dot-warn { background: var(--amber); }
.ttv2-dot-other { background: #7aa7d6; }

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
    padding: 10px 12px 14px;
    gap: 14px;
}

/* ------------------------------------------------------------------ chips */

.ttv2-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
}

.ttv2-chips-label {
    color: var(--muted);
    font-size: 11px;
    margin-right: 2px;
}

.ttv2-chips-gap {
    flex: 1;
}

.ttv2-panel button.ttv2-chip {
    padding: 3px 9px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: normal;
    background: transparent;
    border-color: #555;
    color: var(--muted);
}

.ttv2-panel button.ttv2-chip[aria-pressed="true"] {
    color: #fff;
    border-color: var(--green);
    background: rgba(101, 210, 122, 0.14);
}

.ttv2-panel button.ttv2-chip[aria-pressed="true"]::before {
    content: '✓ ';
    color: var(--green);
}

.ttv2-panel button.ttv2-chip-set {
    color: #fff;
    border-color: #777;
}

.ttv2-panel input.ttv2-chip-input {
    width: 90px;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11px;
}

/* ------------------------------------------------------------------- tabs */

.ttv2-tabs {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 6px 10px 0;
    background: #292929;
    border-bottom: 1px solid #444;
    flex: 0 0 auto;
}

.ttv2-panel button.ttv2-tab {
    border-radius: 5px 5px 0 0;
    border-bottom: 0;
    background: #242424;
    color: var(--muted);
    padding: 6px 12px;
}

.ttv2-panel button.ttv2-tab.ttv2-tab-on {
    background: var(--bg);
    color: #fff;
    box-shadow: inset 0 2px 0 var(--green);
}

.ttv2-credit {
    margin-left: auto;
    padding-bottom: 6px;
    color: var(--faint);
    font-size: 10px;
}

/* ------------------------------------------------------------------- list */

.ttv2-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 7px;
}

.ttv2-row {
    display: grid;
    grid-template-columns: 25px minmax(0, 1fr) 105px;
    gap: 4px 7px;
    padding: 9px 8px;
    margin-bottom: 6px;
    background: #292929;
    border: 1px solid #444;
    border-radius: 5px;
}

.ttv2-row.ttv2-onpage {
    border-color: #3f6b48;
}

.ttv2-rank {
    color: #888;
    font-weight: bold;
    padding-top: 2px;
}

.ttv2-row-main {
    min-width: 0;
}

.ttv2-row-name {
    font-size: 13px;
    font-weight: bold;
    color: #fff;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-row-src {
    color: var(--muted);
    font-size: 10px;
    white-space: pre-wrap;
}

/* Each part stays whole; a narrow row wraps between them. */
.ttv2-src-part {
    display: inline-block;
    max-width: 100%;
    vertical-align: top;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* The seller's status, right after their name: "● Offline 3h ago". */
.ttv2-src-status {
    margin-left: 5px;
    font-weight: bold;
    color: #aaa;
}

.ttv2-src-status::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 3px;
    border-radius: 50%;
    background: #777;
    vertical-align: 0;
}

.ttv2-src-status[data-level="online"] { color: var(--green); }
.ttv2-src-status[data-level="online"]::before { background: var(--green); }
.ttv2-src-status[data-level="idle"] { color: var(--amber); }
.ttv2-src-status[data-level="idle"]::before { background: var(--amber); }

.ttv2-row-prices {
    color: #bbb;
    font-size: 11px;
    margin-top: 3px;
}

.ttv2-row-prices b {
    color: #fff;
}

.ttv2-row-qty {
    margin-top: 3px;
    color: var(--faint);
    font-size: 10px;
}

.ttv2-row-profit {
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: right;
    color: var(--green);
}

.ttv2-row-profit strong {
    font-size: 14px;
}

.ttv2-row-profit span {
    color: #aaa;
    font-size: 10px;
    margin-top: 2px;
}

.ttv2-panel button.ttv2-go {
    grid-column: 2 / 4;
    width: 100%;
    text-align: center;
    padding: 5px 7px;
    color: #ddd;
}

.ttv2-guess {
    color: var(--amber);
    cursor: help;
}

.ttv2-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 28px 16px;
    text-align: center;
}

.ttv2-empty-text {
    color: var(--muted);
    max-width: 300px;
}

/* --------------------------------------------------------------- settings */

.ttv2-section {
    display: flex;
    flex-direction: column;
    gap: 7px;
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

.ttv2-note,
.ttv2-sub {
    color: var(--muted);
    font-size: 11px;
}

.ttv2-sub {
    display: block;
    margin-top: 2px;
    font-size: 10.5px;
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

.ttv2-inline {
    display: flex;
    gap: 5px;
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
    font-size: 11px;
    color: var(--muted);
}

.ttv2-keystate.ttv2-ok { color: var(--green); }
.ttv2-keystate.ttv2-bad { color: var(--red); }

.ttv2-tos-box {
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 6px 8px;
    background: var(--bg2);
}

.ttv2-tos-box summary {
    cursor: pointer;
    color: var(--text);
    font-size: 11px;
}

.ttv2-tos {
    width: 100%;
    margin-top: 6px;
    border-collapse: collapse;
    font-size: 10.5px;
    color: #bbb;
}

.ttv2-tos th,
.ttv2-tos td {
    text-align: left;
    vertical-align: top;
    padding: 3px 4px;
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
