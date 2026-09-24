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

export const STYLE_CSS = `
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

/*
 * Panel chrome and rows follow the original ChatGPT script's look, which
 * the people using this liked: neutral greys, cards with a rank, a green
 * profit column and a full-width GO button.
 */
.ttv2-panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483000;
    width: 430px;
    max-width: calc(100vw - 32px);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    background: #1f1f1f;
    color: #eee;
    border: 1px solid #555;
    border-radius: 7px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    line-height: 1.35;
}

.ttv2-panel.ttv2-collapsed .ttv2-body {
    display: none;
}

.ttv2-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 12px;
    background: #292929;
    border-bottom: 1px solid #444;
    border-radius: 7px 7px 0 0;
    cursor: move;
}

.ttv2-title {
    font-weight: bold;
    font-size: 13px;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-panel button {
    background: #353535;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 11px;
    font-weight: bold;
    cursor: pointer;
    font-family: inherit;
}

.ttv2-panel button:hover {
    background: #444;
}

.ttv2-panel button[disabled] {
    opacity: 0.5;
    cursor: default;
}

.ttv2-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.ttv2-status {
    padding: 7px 12px;
    border-bottom: 1px solid #383838;
    color: #aaa;
    font-size: 11px;
}

.ttv2-summary {
    background: #242424;
    border-bottom: 1px solid #383838;
    color: #ddd;
    font-size: 12px;
}

.ttv2-summary:empty {
    display: none;
}

.ttv2-status.ttv2-warn {
    color: #ffd24a;
}

.ttv2-status.ttv2-error {
    color: #ff8f7a;
}

.ttv2-filters {
    display: none;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid #383838;
}

.ttv2-filters.ttv2-open {
    display: flex;
}

.ttv2-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 45%;
}

.ttv2-field label {
    color: #aaa;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}

.ttv2-panel input[type="text"],
.ttv2-panel input[type="password"] {
    background: #181818;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
}

.ttv2-masked {
    -webkit-text-security: disc;
    text-security: disc;
}

.ttv2-check {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1 1 100%;
    color: #aaa;
    font-size: 11px;
}

.ttv2-tabs {
    display: flex;
    gap: 6px;
    padding: 8px 10px 0;
    background: #292929;
    border-bottom: 1px solid #444;
}

.ttv2-panel button.ttv2-tab {
    flex: 1;
    border-radius: 4px 4px 0 0;
    border-bottom: 0;
    background: #242424;
    color: #aaa;
    padding: 6px 8px;
}

.ttv2-panel button.ttv2-tab.ttv2-tab-on {
    background: #1f1f1f;
    color: #fff;
    box-shadow: inset 0 2px 0 #65d27a;
}

.ttv2-credit {
    padding: 5px 12px;
    color: #888;
    font-size: 10px;
    border-bottom: 1px solid #383838;
}

.ttv2-credit a {
    color: #65d27a;
}

.ttv2-list {
    overflow-y: auto;
    min-height: 0;
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

/* A listing on the page you are viewing. */
.ttv2-row.ttv2-onpage {
    border-color: #3f6b48;
}

.ttv2-row.ttv2-stale {
    opacity: 0.5;
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
    color: #777;
    font-size: 10px;
}

.ttv2-row-profit {
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: right;
    color: #65d27a;
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
    display: block;
    width: 100%;
    text-align: center;
    padding: 5px 7px;
    color: #ddd;
}

.ttv2-panel button.ttv2-go:hover {
    color: #fff;
}

.ttv2-guess {
    color: #ffd24a;
    cursor: help;
}

/* Where a row came from and how old its data is. */
.ttv2-row-src {
    color: #aaa;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-row.ttv2-stale .ttv2-age {
    color: #ffd24a;
}

/* Already followed: dimmed until the source re-confirms the listing. */
.ttv2-row.ttv2-opened .ttv2-row-name {
    color: #999;
}

.ttv2-live {
    font-size: 10px;
}

/* Torn's required API-key disclosure table. */
.ttv2-tos {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    color: #aaa;
}

.ttv2-tos th,
.ttv2-tos td {
    text-align: left;
    vertical-align: top;
    padding: 2px 4px;
    border-bottom: 1px solid #383838;
}

.ttv2-tos th {
    width: 38%;
    color: #999;
    font-weight: normal;
}

.ttv2-settings {
    display: none;
    flex-direction: column;
    gap: 9px;
    padding: 10px;
    border-bottom: 1px solid #383838;
    overflow-y: auto;
}

.ttv2-settings.ttv2-open {
    display: flex;
}

.ttv2-settings h4 {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #999;
}

.ttv2-note {
    color: #999;
    font-size: 10px;
    line-height: 1.4;
}

.ttv2-note a {
    color: #7ee08f;
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

.ttv2-keystate {
    font-size: 10px;
    color: #999;
}

.ttv2-keystate.ttv2-ok {
    color: #7ee08f;
}

.ttv2-keystate.ttv2-bad {
    color: #ffd24a;
}

.ttv2-settings textarea {
    background: #181818;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 5px 6px;
    font-family: Consolas, monospace;
    font-size: 10px;
    min-height: 60px;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
}

.ttv2-profit {
    color: #7ee08f;
    font-weight: bold;
    white-space: nowrap;
}

.ttv2-unverified {
    color: #ffd24a;
}

.ttv2-empty {
    padding: 20px 10px;
    color: #888;
    text-align: center;
}

.ttv2-diag {
    padding: 6px 10px;
    border-top: 1px solid #383838;
    color: #999;
    font-size: 10px;
    white-space: pre-wrap;
    display: none;
}

.ttv2-diag.ttv2-open {
    display: block;
}
`;

/** Inject the stylesheet once. */
export function injectStyles(doc = document) {
    const id = UI_PREFIX + '-styles';
    if (doc.getElementById(id)) return;

    const style = doc.createElement('style');
    style.id = id;
    style.textContent = STYLE_CSS;

    (doc.head || doc.documentElement).appendChild(style);
}
