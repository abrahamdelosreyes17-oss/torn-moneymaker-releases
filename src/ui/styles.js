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
 * Design rules the panel and the selling page share (see README; 3.20
 * Graphite): system fonts only (nothing to download), Georgia for titles;
 * sizes 11px (uppercase labels only), 12px (secondary), 13px (body), 15px
 * semibold (the key money number); line-height 1.5; spacing in
 * 4/8/12/16/24px; radii 8/12/16; money right-aligned in tabular figures;
 * colours only from the tokens below; only cheap motion (opacity,
 * transform, background), none under prefers-reduced-motion.
 */

export const UI_PREFIX = 'ttv2';

/*
 * Colour tokens, shared by the panel and the selling page (3.20: Graphite,
 * mockups/T-graphite-everything.html - one colour per meaning: green money,
 * blue buying and your trade, amber check this, red gone, gold favourites,
 * teal trust, violet the brand). All fixed and dark. The background used to borrow Torn's --default-bg-panel-color, but
 * Torn sets its dark value on <body>; the selling page is attached outside
 * it and got Torn's LIGHT default - light-grey text on a light page.
 */
import { FILL_FORM_CSS } from './fill-form.js';

export const TOKENS_CSS = `
    --page: #111215;
    --rail: #16171b;
    --surface: #1c1e23;
    --raised: #24272e;
    --hover: #2b2f37;
    --input: #0e0f12;
    --bg: #1c1e23;
    --row: #24272e;
    --line: #2c2f36;
    --line2: #3a3d45;
    --text: #f2f4f8;
    --text2: #cdd2db;
    --muted: #949bab;
    --faint: #6a7180;
    --profit: #6fdc7f;
    --profit-bg: rgba(111, 220, 127, 0.12);
    --profit-line: rgba(111, 220, 127, 0.42);
    --buy: #5aa7ff;
    --buy-bg: rgba(90, 167, 255, 0.12);
    --buy-line: rgba(90, 167, 255, 0.45);
    --offer: #8cc0ff;
    --warn: #f6b74a;
    --warn-bg: rgba(246, 183, 74, 0.12);
    --warn-line: rgba(246, 183, 74, 0.42);
    --bad: #ff7b6e;
    --bad-bg: rgba(255, 123, 110, 0.12);
    --bad-line: rgba(255, 123, 110, 0.42);
    --fav: #ffcc4d;
    --fav-bg: rgba(255, 204, 77, 0.10);
    --fav-line: rgba(255, 204, 77, 0.45);
    --trust: #43d1be;
    --trust-bg: rgba(67, 209, 190, 0.12);
    --known: #b8a4ff;
    --brand: #8f9bff;
    --on-profit: #0d1a10;
    --on-buy: #06121f;
    --title: #16171b;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 12px 32px rgba(0, 0, 0, 0.35);
    --sans: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
    --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
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
/*
 * Every mark on Torn's own pages takes no room (3.20, the owner: "it
 * shouldn't resize a row, add columns etc. it should just sit at the side or
 * on top like a bring to front"). Outlines are inset box-shadows, labels are
 * pseudo-elements or absolutely placed, and nothing sets a Torn element's
 * size, padding, margin or wrapping. Colours: green money, blue buying and
 * your trade, amber check this, red the listing you opened (Graphite,
 * mockups/T-graphite-everything.html).
 */
.ttv2-hit {
    position: relative !important;

    box-shadow:
        inset 0 0 0 2px #6fdc7f,
        inset 0 0 0 9999px rgba(111, 220, 127, 0.12) !important;

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
     * - On the card's top edge, half in the gap above it, one line (3.20.4,
     *   the owner: inside the card it covered the item's name and price).
     */
    content: attr(data-ttv2-profit) !important;

    display: block !important;
    position: absolute !important;
    top: -13px !important;
    right: 4px !important;
    left: auto !important;
    bottom: auto !important;

    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 1px 7px !important;
    transform: none !important;

    overflow: visible !important;
    white-space: nowrap !important;
    opacity: 1 !important;
    visibility: visible !important;
    z-index: 2147483000 !important;

    background: rgba(15, 36, 20, 0.94) !important;
    border: 1px solid rgba(111, 220, 127, 0.55) !important;
    border-radius: 9px !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5) !important;

    color: #6fdc7f !important;
    font: 700 11px/15px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif !important;
    text-align: right !important;

    /* Cannot intercept a click, so it can never block Torn's Buy button. */
    pointer-events: none !important;
}

/*
 * A trusted trader pays more than this listing asks: "FAFFO pays $73,500 /
 * +$3,500 each", drawn the same way as the profit label and just as unable
 * to catch a click. In blue (a trader, not an NPC deal); one line on the
 * card's top edge (3.20.4). On a card that is also a deal, profit and
 * trader share that one line.
 */
.ttv2-trader {
    position: relative !important;
}

.ttv2-trader.ttv2-trader::after {
    content: attr(data-ttv2-trader) !important;

    display: block !important;
    position: absolute !important;
    top: -13px !important;
    right: 4px !important;
    left: auto !important;
    bottom: auto !important;

    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 2px 7px !important;
    transform: none !important;

    overflow: visible !important;
    white-space: nowrap !important;
    text-align: right !important;
    opacity: 1 !important;
    visibility: visible !important;
    z-index: 2147483000 !important;

    background: rgba(15, 26, 42, 0.94) !important;
    border: 1px solid rgba(90, 167, 255, 0.5) !important;
    border-radius: 9px !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5) !important;

    color: #8cc0ff !important;
    font: 700 11px/15px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif !important;

    pointer-events: none !important;
}

.ttv2-hit.ttv2-trader.ttv2-trader::after {
    content: attr(data-ttv2-profit) "  ·  " attr(data-ttv2-trader) !important;
    white-space: nowrap !important;
    text-align: right !important;
    background: rgba(15, 36, 20, 0.94) !important;
    border-color: rgba(111, 220, 127, 0.55) !important;
    color: #6fdc7f !important;
}

/*
 * A trade you accepted (3.12.8): the listing to buy on a bazaar, in blue with
 * its own words, apart from the NPC deals' green; on Torn's trade page the
 * rows to send, and Fill.
 */
.ttv2-buyhere,
.ttv2-target.ttv2-buyhere {
    position: relative !important;
    box-shadow:
        inset 0 0 0 2px #5aa7ff,
        inset 0 0 0 9999px rgba(90, 167, 255, 0.12),
        0 0 14px rgba(90, 167, 255, 0.35) !important;
}

/* Fill's line on the trade page (3.14.2) moved to the panel's trade box in 3.20: this only hides one an older version left. */
.ttv2-fillnote {
    display: none !important;
}

/* Chat from Torn Bids (3.14): Torn's own Start chat button on that profile, in blue. You press it. */
.ttv2-chatmark {
    outline: 3px solid #5aa7ff !important;
    outline-offset: 2px;
    border-radius: 6px;
    box-shadow: 0 0 0 7px rgba(90, 167, 255, 0.28) !important;
    animation: ttv2-chatpulse 1.2s ease-in-out 4;
}

@keyframes ttv2-chatpulse {
    50% { box-shadow: 0 0 0 11px rgba(90, 167, 255, 0.12); }
}

.ttv2-buyhere::before {
    content: attr(data-ttv2-buy);
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 2;
    max-width: calc(100% - 8px);
    padding: 1px 7px;
    border-radius: 9px;
    background: #5aa7ff;
    color: #06121f;
    font: 700 11px/16px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    pointer-events: none;
}

/*
 * The card you are buying for a trade says so in blue; the trader tag and
 * deal label (green) on it are hidden - they covered the blue words, and the
 * trade already says who pays what (the owner, 2026-09-27: "no longer needed").
 */
.ttv2-buyhere.ttv2-buyhere.ttv2-buyhere.ttv2-buyhere::after {
    display: none !important;
}

/*
 * On the listing you are buying (3.13): one strip across the card's top with
 * the words, Fill and Next, so the pointer does not cross the page to the
 * panel after every buy. It takes the place of the card's own label. One
 * line, always (3.20): two lines covered the item's picture and its name.
 */
.ttv2-buyhere.ttv2-hasbar::before {
    display: none !important;
}

.ttv2-buybar {
    position: absolute !important;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
    display: flex !important;
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 4px 4px 0 0;
    background: #5aa7ff;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45);
    white-space: nowrap;
}

.ttv2-buybar-l {
    margin-right: auto;
    padding: 0 4px;
    background: none;
    color: #06121f;
    font: 700 11px/18px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    white-space: nowrap;
}

.ttv2-buybar button {
    flex: 0 0 auto;
    height: 20px;
    padding: 0 7px;
    border: 0;
    border-radius: 6px;
    background: rgba(6, 18, 31, 0.18);
    color: #06121f;
    font: 700 11px/20px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    white-space: nowrap;
    cursor: pointer;
}

.ttv2-buybar button:hover {
    background: rgba(6, 18, 31, 0.3);
}

.ttv2-buybar button:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
}

.ttv2-buybar button[data-act="next"] {
    background: #06121f;
    color: #cfe5ff;
}

.ttv2-sendrow {
    box-shadow: inset 3px 0 0 #5aa7ff, inset 0 0 0 9999px rgba(90, 167, 255, 0.08) !important;
}

/*
 * Fill on the trade page: floats beside the item's name (3.20). Taken out of
 * the line, so Torn's name cell keeps its size and its wrapping; placed by
 * main.js placeFloat where the cell lays its items out as a row.
 */
.ttv2-float {
    position: absolute !important;
    z-index: 3;
    box-sizing: border-box;
    white-space: nowrap !important;
}

.ttv2-sendrow .name-wrap {
    overflow: visible !important;
}

.ttv2-sendfill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    margin-left: 10px !important;
    padding: 0 8px;
    border: 1px solid rgba(90, 167, 255, 0.45);
    border-radius: 7px;
    background: #10233b;
    color: #cfe5ff;
    font: 600 11px/20px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    vertical-align: baseline;
    cursor: default;
}

.ttv2-sendfill[data-fill] { cursor: pointer; }
.ttv2-sendfill[data-fill]:hover { background: #163152; }
.ttv2-sendfill[aria-pressed="true"] { background: #5aa7ff; color: #06121f; border-color: transparent; }
.ttv2-sendfill:not([data-fill]) { background: #23262c; color: #cfd4dc; border-color: rgba(255, 255, 255, 0.14); }

/* One Fill for every marked row (3.16.4), beside Torn's ADD TO TRADE: the row chips' look, a size up. */
.ttv2-sendfillall {
    display: inline-flex;
    align-items: center;
    height: 26px;
    margin-left: 12px !important;
    padding: 0 10px;
    border: 1px solid rgba(90, 167, 255, 0.45);
    border-radius: 8px;
    background: #10233b;
    color: #cfe5ff;
    font: 600 12px/24px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    vertical-align: baseline;
    cursor: pointer;
    user-select: none;
}

.ttv2-sendfillall:hover { background: #163152; }
.ttv2-sendfillall:focus-visible { outline: 2px solid #5aa7ff; outline-offset: 1px; }
.ttv2-sendfillall[aria-pressed="true"] { background: #5aa7ff; color: #06121f; border-color: transparent; }

/* The listing a feed link was opened for: light red (3.14.2, the owner; it was yellow). Paint-only, like .ttv2-hit. */
.ttv2-target {
    box-shadow:
        inset 0 0 0 2px #ff7b6e,
        inset 0 0 0 9999px rgba(255, 123, 110, 0.12) !important;
}

.ttv2-hit-top {
    box-shadow:
        inset 0 0 0 2px #a6f5b0,
        inset 0 0 0 9999px rgba(111, 220, 127, 0.2),
        0 0 12px rgba(111, 220, 127, 0.35) !important;
}

.ttv2-hit-top.ttv2-hit-top::after {
    background: #6fdc7f !important;
    border-color: transparent !important;
    color: #0d1a10 !important;
}

/*
 * Profitable, but below your Min: amber, thinner and fainter than green, so
 * the deals that meet your Min still stand out first. (Light red marks the
 * listing a panel link was opened for.)
 */
.ttv2-hit.ttv2-hit-low {
    box-shadow:
        inset 0 0 0 1px #f6b74a,
        inset 0 0 0 9999px rgba(246, 183, 74, 0.08) !important;
}

.ttv2-hit.ttv2-hit-low.ttv2-hit-low::after {
    background: rgba(42, 33, 16, 0.94) !important;
    border-color: rgba(246, 183, 74, 0.5) !important;
    color: #f6b74a !important;
    font-weight: 700 !important;
}

/* Bazaar owner status: floats at the end of the bazaar's banner line (3.20), taking no room in it. */
.ttv2-owner {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    margin-left: 10px !important;
    padding: 0 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    font: 600 11px/18px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #e5e8ee;
    background: #23262c;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
    white-space: nowrap;
    vertical-align: baseline;
}

.ttv2-owner::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6a7180;
}

.ttv2-owner[data-level="online"] { color: #6fdc7f; border-color: rgba(111, 220, 127, 0.42); background: #10261a; }
.ttv2-owner[data-level="online"]::before { background: #6fdc7f; }
.ttv2-owner[data-level="idle"] { color: #f6b74a; border-color: rgba(246, 183, 74, 0.42); background: #2a2110; }
.ttv2-owner[data-level="idle"]::before { background: #f6b74a; }
.ttv2-owner[data-level="offline"]::before { background: #6a7180; }

/*
 * Your own bazaar's manage rows and the Item Market's: the asking prices
 * and Fill, together in one group that floats in the row (3.20): at its
 * right, just left of Torn's boxes, centred on the row - over the row, never
 * a line or a column of its own. Text only; nothing is clicked on Torn's.
 */
.ttv2-rowfloat {
    position: absolute !important;
    top: 50%;
    right: var(--ttv2-fr, 8px);
    z-index: 3;
    display: inline-flex !important;
    align-items: center;
    gap: 6px;
    margin: 0 !important;
    transform: translateY(-50%);
    white-space: nowrap;
}

.ttv2-rowfloat[data-tight="1"] .ttv2-bztag { display: none; }

.ttv2-bztag {
    display: inline-block;
    height: 22px;
    padding: 0 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    font: 500 11px/20px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
    color: #cfd4dc;
    background: #23262c;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
    white-space: nowrap;
    vertical-align: middle;
    cursor: pointer;
}

.ttv2-bztag:hover,
.ttv2-bztag[data-selected="true"] {
    border-color: rgba(111, 220, 127, 0.55);
}

.ttv2-bztag b {
    color: #6fdc7f;
    font-weight: 650;
}

.ttv2-bztag .ttv2-bztag-low {
    color: #8cc0ff;
}

/*
 * Your bazaar's add page: IMA and BP chips and the Fill tick float in Torn's
 * own value column, at its right end (3.20: the cell keeps its own padding -
 * nothing is pushed). Where they would cover Torn's own words in the cell,
 * IMA goes first, then BP - whole chips only (main.js fitBazaarCells sets
 * data-tight); both stay in My bazaar's list beside the page.
 */
.ttv2-bzcell {
    position: relative;
}

.ttv2-bztag.ttv2-bzchips {
    position: absolute;
    top: 50%;
    right: calc(var(--ttv2-fillw, 64px) + 8px);
    z-index: 3;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: auto;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
    transform: translateY(-50%);
    cursor: default;
    white-space: nowrap;
}

.ttv2-bzchip {
    display: inline-block;
    height: 20px;
    padding: 0 7px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    background: #23262c;
    color: #cfd4dc;
    font: 500 11px/18px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
    cursor: pointer;
}

.ttv2-bzchip b { font-weight: 650; font-variant-numeric: tabular-nums; }
.ttv2-bzchip-ima b { color: #6fdc7f; }
.ttv2-bzchip-bp b { color: #8cc0ff; }
.ttv2-bzchip:hover,
.ttv2-bzchips[data-selected="true"] .ttv2-bzchip { border-color: rgba(111, 220, 127, 0.55); }

.ttv2-fillbox.ttv2-fillcell {
    position: absolute;
    right: 2px;
    top: 50%;
    z-index: 3;
    transform: translateY(-50%);
    margin: 0;
    flex-wrap: nowrap;
}

.ttv2-fillcell .ttv2-filltag { display: none; }
.ttv2-fillcell .ttv2-fillbtn { height: 20px; font-size: 11px; }
.ttv2-bzchips[data-tight="1"] .ttv2-bzchip-ima { display: none; }
.ttv2-bzchips.ttv2-bzchips[data-tight="2"] { display: none; }
.ttv2-fillbtn[data-level="good"] .ttv2-filllabel { color: #6fdc7f; }
.ttv2-fillbtn[data-level="warn"] .ttv2-filllabel { color: #f6b74a; }
.ttv2-fillbtn[data-level="bad"] { border-color: #ff7b6e; }

/*
 * The Fill button: ours, beside the prices. It types into Torn's boxes; it
 * never presses Torn's buttons. What it typed, or why it could not, shows on
 * its hover, in the panel's My bazaar, and for a moment in a note beside
 * Torn's page (the toast) - never as a line in Torn's row.
 */
.ttv2-fillbox {
    display: inline-flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    vertical-align: middle;
    font: 12px/20px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
}

.ttv2-rowfloat .ttv2-filltag { display: none; }

.ttv2-fillbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px 0 6px;
    border: 1px solid rgba(90, 167, 255, 0.45);
    border-radius: 7px;
    background: #10233b;
    color: #cfe5ff;
    font: 600 11px/20px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
    cursor: pointer;
    white-space: nowrap;
}

.ttv2-fillbtn:hover { background: #163152; }
.ttv2-fillbtn:disabled { opacity: 0.6; cursor: progress; }

/* The tick box: empty, or ticked in green once the row is filled. */
.ttv2-fillmark {
    width: 13px;
    height: 13px;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    background: #0e0f12;
    box-sizing: border-box;
    position: relative;
}

.ttv2-fillbtn[aria-checked="true"] { border-color: rgba(111, 220, 127, 0.55); background: #10261a; color: #6fdc7f; }
.ttv2-fillbtn[aria-checked="true"] .ttv2-fillmark { background: #6fdc7f; border-color: #6fdc7f; }
.ttv2-fillbtn[aria-checked="true"] .ttv2-fillmark::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 0;
    width: 3px;
    height: 7px;
    border: solid #0d1a10;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}

/* "Fill settings": floats at the right end of Torn's links bar (3.20), not one of its links. */
a.ttv2-fillset {
    position: absolute !important;
    z-index: 3;
    display: inline-flex;
    white-space: nowrap;
    align-items: center;
    height: 22px;
    padding: 0 9px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    background: #23262c;
    color: #cfd4dc !important;
    font: 600 11px/20px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
    text-decoration: none !important;
    cursor: pointer;
}

a.ttv2-fillset:hover { border-color: rgba(255, 255, 255, 0.3); }
.ttv2-fillbtn:focus-visible { outline: 2px solid #8cc0ff; outline-offset: 1px; }

.ttv2-filltag {
    color: #e5e8ee;
    white-space: normal;
    font-variant-numeric: tabular-nums;
}

.ttv2-filltag[data-level="good"] { color: #6fdc7f; }
.ttv2-filltag[data-level="warn"] { color: #f6b74a; }
.ttv2-filltag[data-level="bad"] { color: #ff7b6e; }
.ttv2-filltag[hidden] { display: none; }

/* Fill's result, beside Torn's page for a few seconds (3.20): in place of the line it used to add to the row. */
.ttv2-toast {
    position: fixed;
    z-index: 2147483001;
    max-width: 400px;
    padding: 8px 12px;
    border: 1px solid rgba(111, 220, 127, 0.42);
    border-radius: 10px;
    background: #1c1e23;
    color: #cdd2db;
    font: 12px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 12px 32px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    animation: ttv2-toast-in 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.ttv2-toast[data-level="warn"] { border-color: rgba(246, 183, 74, 0.42); color: #f6b74a; }
.ttv2-toast[data-level="bad"] { border-color: rgba(255, 123, 110, 0.42); color: #ff7b6e; }

@keyframes ttv2-toast-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
    .ttv2-toast, .ttv2-chatmark { animation: none !important; }
    .ttv2-hit { transition: none !important; }
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
    font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
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
    font: bold 12px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
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
    font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
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
    0% { box-shadow: 0 0 0 0 rgba(111, 220, 127, 0.7); }
    100% { box-shadow: 0 0 0 8px rgba(111, 220, 127, 0); }
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

/* A number being typed scrolls inside its box; the box can be narrow. */
.ttv2-panel.ttv2-tighter input.ttv2-chip-input {
    width: 56px;
    padding: 0 4px;
    font-size: 11px;
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
.ttv2-tradebox {
    margin: 0 0 8px;
    padding: 8px 10px;
    border: 1px solid var(--profit);
    border-radius: 6px;
    background: rgba(111, 220, 127, 0.08);
}

.ttv2-buybox {
    border-color: #5aa7ff;
    background: rgba(90, 167, 255, 0.08);
}

.ttv2-buybox .ttv2-sub, .ttv2-buybox .ttv2-tb-ok, .ttv2-buybox .ttv2-tb-warn {
    margin-top: 4px;
}

/* Grey on the blue-tinted box: lighter than --muted, to read (5.7:1, not 4.2:1). */
.ttv2-buybox .ttv2-sub {
    color: #cdd2db;
}

.ttv2-buynext {
    margin-top: 8px;
    width: 100%;
}

/* Its label is never cut (3.14.3): a long seller's name goes to a second line. */
.ttv2-panel button.ttv2-buynext {
    height: auto;
    min-height: 28px;
    padding: 6px 12px;
    line-height: 16px;
    white-space: normal;
    overflow-wrap: anywhere;
}

/* Under the header (3.13): its own margin, since it is outside the pages. */
.ttv2-panel > .ttv2-buybox {
    margin: 8px 10px;
}

.ttv2-kbd {
    display: inline-block;
    margin-left: 8px;
    padding: 0 5px;
    border: 1px solid currentColor;
    border-radius: 3px;
    font-size: 10px;
    line-height: 14px;
    opacity: 0.7;
}

.ttv2-buybox .ttv2-sub.ttv2-tb-late,
.ttv2-tb-late {
    color: var(--warn);
    font-weight: bold;
}


/* "Did you buy it?": two answers, side by side. */
.ttv2-tb-ask {
    display: flex;
    gap: 6px;
    margin-top: 8px;
}

.ttv2-tb-ask button { flex: 1; }

/* Cancel trade (3.14.5): a quiet link under Next; asked before it acts. */
.ttv2-tb-cancel {
    margin-top: 6px;
    text-align: right;
}

.ttv2-tb-cancel.ttv2-tb-ask { flex-wrap: wrap; text-align: left; }
.ttv2-tb-cancel.ttv2-tb-ask .ttv2-tb-warn { flex: 1 1 100%; margin-top: 0; }

.ttv2-panel button.ttv2-linkbtn {
    height: auto;
    padding: 0;
    border: 0;
    background: none;
    color: #cdd2db;
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
}

.ttv2-panel button.ttv2-linkbtn:hover { color: var(--text, #e5e8ee); }

.ttv2-tb-ok {
    color: var(--profit);
    font-size: 12px;
}

.ttv2-tb-warn {
    color: var(--warn);
    font-size: 12px;
    font-weight: bold;
}

.ttv2-tb-mark {
    color: var(--profit);
    font-weight: bold;
}

.ttv2-tb-in {
    color: var(--muted);
    font-size: 12px;
}

.ttv2-tb + .ttv2-tb {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
}

.ttv2-tb-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0 8px;
    font-size: 13px;
    overflow-wrap: anywhere;
}

/* The status: on the right, or whole on its own line when it does not fit. */
.ttv2-buybox .ttv2-tb-head .ttv2-tb-status { margin: 0 0 0 auto; text-align: right; }
.ttv2-nobr { white-space: nowrap; }

.ttv2-tb-row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
    cursor: pointer;
}

.ttv2-tb-row.ttv2-tb-done .ttv2-tb-name {
    color: var(--muted);
    text-decoration: line-through;
}

/* Never cut with "…": a long name or status goes on to a second line. */
.ttv2-seller {
    display: none;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    white-space: normal;
    overflow: visible;
    overflow-wrap: anywhere;
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
    background: rgba(111, 220, 127, 0.12);
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

/* A Min or Cash box being edited, in the chip's place; Cash's Any beside it. */
.ttv2-chip-edit {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
}

.ttv2-panel.ttv2-tighter .ttv2-chip-edit {
    gap: 2px;
}

/* In the least room Cash's box gives Any its width (what is typed scrolls inside). */
.ttv2-panel.ttv2-tighter .ttv2-chip-edit-any input.ttv2-chip-input {
    width: 48px;
}

.ttv2-panel input.ttv2-chip-input-dim {
    color: var(--muted);
}

/* A value the box could not read: red, and the reason under the chips.
   #ff7b6e, not --bad: a red that reads on the panel (5.9:1), as Torn Bids' .sp-inerr. */
.ttv2-panel input.ttv2-chip-input.ttv2-bad {
    border-color: #ff7b6e;
    box-shadow: 0 0 0 1px #ff7b6e;
}

.ttv2-panel input.ttv2-chip-input.ttv2-bad:focus-visible {
    outline: 0;
}

.ttv2-panel button.ttv2-chip-any {
    font-weight: bold;
    color: var(--text);
    background: var(--line);
}

/* Right under the chips: "Saved ✓" for 2 seconds, or why a value was not taken. */
.ttv2-chip-note {
    display: none;
    margin-top: -4px;
    padding: 0 12px 8px;
    font-size: 12px;
    line-height: 16px;
    text-align: right;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
    flex: 0 0 auto;
}

.ttv2-chip-note.ttv2-shown {
    display: block;
}

.ttv2-chip-note[data-level="ok"] {
    color: var(--profit);
}

.ttv2-chip-note[data-level="bad"] {
    color: #ff7b6e;
}

.ttv2-chips.ttv2-chips-noted {
    border-bottom-color: transparent;
}

.ttv2-panel.ttv2-narrow .ttv2-chip-note {
    padding: 0 8px 6px;
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
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px 16px;
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
    overflow-wrap: anywhere;
    color: var(--text);
}

.ttv2-bzrow .ttv2-money {
    color: var(--text);
    font-variant-numeric: tabular-nums;
}

/* The header in little room: "Item" keeps its width and the money labels
   wrap ("IM / average") - never one on top of the other. */
.ttv2-bzhead {
    grid-template-columns: minmax(max-content, 1fr) auto auto;
}

.ttv2-bzhead .ttv2-money {
    white-space: normal;
}

.ttv2-panel button.ttv2-bzrow[aria-pressed="true"] .ttv2-money {
    color: #6fdc7f;
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
    color: #6fdc7f;
    font-variant-numeric: tabular-nums;
}

.ttv2-graph-box {
    position: relative;
}

.ttv2-graph {
    display: block;
    width: 100%;
    height: auto;
    background: #24272e;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: crosshair;
}

.ttv2-graph-grid { stroke: #383a40; stroke-width: 1; }
.ttv2-graph-label { fill: #949bab; font: 11px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; font-variant-numeric: tabular-nums; }
.ttv2-graph-empty { fill: #949bab; font: 12px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
.ttv2-graph-cursor { stroke: #6a7180; stroke-width: 1; }

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
.ttv2-tip-mv { color: #6fdc7f; font-weight: bold; }
.ttv2-tip-im { color: var(--offer); }

.ttv2-graph-keys {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--muted);
}

.ttv2-graph-keys span { display: inline-flex; align-items: center; gap: 4px; }
.ttv2-graph-keys i { display: inline-block; width: 16px; height: 0; border-top: 2px solid; }
.ttv2-graph-keys .ttv2-key-mv i { border-color: #6fdc7f; }
.ttv2-graph-keys .ttv2-key-im i { border-color: var(--offer); border-top-width: 1px; }
.ttv2-graph-keys .ttv2-key-mark i { border-color: #f6b74a; border-top-style: dashed; }

.ttv2-bzrow .ttv2-bzlow { color: var(--offer); }

.ttv2-fillnow {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--row);
}
.ttv2-fillnow-done { border-color: #6fdc7f; }
.ttv2-fillprice {
    font-size: 20px;
    font-weight: bold;
    line-height: 1.2;
    color: #f6b74a;
    font-variant-numeric: tabular-nums;
}
.ttv2-fillnow-done .ttv2-fillprice { color: #6fdc7f; }
.ttv2-verdict[data-level="good"] { color: #6fdc7f; }
.ttv2-verdict[data-level="warn"] { color: #f6b74a; }
.ttv2-panel button.ttv2-fillgo { align-self: flex-start; margin-top: 4px; }

.ttv2-lows {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
}
.ttv2-lowcol { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ttv2-panel button.ttv2-lowrow {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    height: auto;
    padding: 4px 8px;
    text-align: left;
    font-weight: normal;
    background: var(--row);
    border: 1px solid var(--line);
}
.ttv2-panel button.ttv2-lowrow:hover:not(:disabled) { border-color: var(--offer); }
.ttv2-panel button.ttv2-lowrow:disabled { cursor: default; opacity: 1; }
.ttv2-lowrow .ttv2-money { color: var(--text); font-variant-numeric: tabular-nums; }
.ttv2-lowsub { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
/* "×10 · $28 after fee" wraps inside the row's padding in little room (buttons are nowrap). */
.ttv2-panel button.ttv2-lowrow { white-space: normal; min-width: 0; max-width: 100%; }
.ttv2-lowrow .ttv2-lowsub { white-space: normal; max-width: 100%; }
.ttv2-lowmine { border-style: dashed !important; }
.ttv2-lowmine .ttv2-money { color: var(--muted); }
.ttv2-lowstale .ttv2-money { color: var(--muted); }


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

.ttv2-panel .ttv2-pct input[type="text"] {
    flex: 0 0 auto;
    width: 44px;
    text-align: right;
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
.ttv2-sub.ttv2-bad { color: var(--bad); }

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

/*
 * 3.20 Graphite (mockups/T-graphite-everything.html, picked by the owner):
 * the panel's look, over the rules above - the same parts and sizes the
 * fitting in panel.js measures, a softer surface, system fonts, a serif
 * title, one colour per meaning. The narrow steps above still win where
 * they set a size (they are more specific).
 */
.ttv2-panel {
    background: var(--surface);
    border: 1px solid var(--line2);
    border-radius: 14px;
    box-shadow: var(--shadow);
    font: 13px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
}

.ttv2-panel b,
.ttv2-panel strong {
    font-weight: 600;
}

.ttv2-panel a:hover { text-underline-offset: 3px; }

.ttv2-panel button {
    font: 600 12px/1 var(--sans);
    border-radius: 7px;
    background: var(--raised);
    border: 1px solid var(--line2);
    color: var(--text2);
    transition: background-color 0.15s var(--ease);
}

.ttv2-panel button:hover:not(:disabled) {
    background: var(--hover);
    border-color: var(--line2);
}

.ttv2-panel button.ttv2-primary {
    color: var(--on-profit);
    background: var(--profit);
    border-color: transparent;
    font-weight: 650;
}

.ttv2-panel button.ttv2-primary:hover:not(:disabled) {
    background: #86e594;
    border-color: transparent;
}

.ttv2-panel button.ttv2-link,
.ttv2-panel button.ttv2-link:hover:not(:disabled) {
    background: none;
    border: 0;
    color: var(--offer);
    font-weight: 500;
}

.ttv2-panel input[type="text"] {
    font: 13px/1.4 var(--sans);
    background: var(--input);
    border: 1px solid var(--line2);
    border-radius: 8px;
}

.ttv2-panel input[type="text"]:focus {
    border-color: var(--brand);
    outline: none;
}

.ttv2-label {
    font: 650 11px/1.3 var(--sans);
    letter-spacing: 0.08em;
    color: var(--faint);
}

/* Lists scroll inside: a quiet dark scrollbar, not the browser's white one. */
.ttv2-panel * {
    scrollbar-width: thin;
    scrollbar-color: #3a3d45 transparent;
}

.ttv2-head {
    height: 40px;
    gap: 6px;
    padding: 0 8px 0 14px;
    background: var(--rail);
}

.ttv2-title {
    font: 400 15px/1.2 var(--serif);
    letter-spacing: 0;
    color: var(--text);
    text-shadow: none;
}

.ttv2-mini {
    font: 600 12px var(--sans);
}

.ttv2-panel button.ttv2-icon {
    height: 26px;
    border-radius: 7px;
    color: var(--text2);
}

.ttv2-panel button.ttv2-icon:hover:not(:disabled) {
    background: var(--hover);
}

.ttv2-panel button.ttv2-scan {
    height: 26px;
    padding: 0 10px;
    color: var(--on-profit);
    background: var(--profit);
    border-color: transparent;
    font-weight: 650;
}

.ttv2-panel button.ttv2-scan:hover:not(:disabled) {
    background: #86e594;
    border-color: transparent;
}

.ttv2-panel button.ttv2-sell {
    height: 26px;
    padding: 0 10px;
    background: transparent;
    border-color: rgba(143, 155, 255, 0.45);
    color: var(--brand);
}

@keyframes ttv2-pulse {
    0% { box-shadow: 0 0 0 0 rgba(111, 220, 127, 0.6); }
    100% { box-shadow: 0 0 0 8px rgba(111, 220, 127, 0); }
}

.ttv2-bar {
    padding: 10px 14px;
}

.ttv2-dot {
    width: 7px;
    height: 7px;
}

.ttv2-seller {
    padding: 8px 14px;
}

.ttv2-chips {
    gap: 6px;
    padding: 10px 14px;
}

.ttv2-panel button.ttv2-chip {
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-weight: 500;
    background: transparent;
    border-color: var(--line2);
    color: var(--text2);
}

.ttv2-panel button.ttv2-chip[aria-pressed="true"] {
    color: var(--profit);
    border-color: var(--profit-line);
    background: var(--profit-bg);
}

.ttv2-panel button.ttv2-chip-set {
    color: var(--text);
    border-color: var(--line2);
    background: var(--raised);
}

.ttv2-panel input.ttv2-chip-input {
    height: 26px;
    border-radius: 999px;
    border-color: var(--brand);
}

.ttv2-panel button.ttv2-chip-any {
    color: var(--text);
    background: var(--raised);
}

.ttv2-chip-note {
    padding: 0 14px 8px;
}

.ttv2-tabs {
    gap: 4px;
    padding: 0 14px;
}

.ttv2-panel button.ttv2-tab {
    height: 34px;
    padding: 0 10px;
    margin-bottom: -1px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-weight: 500;
}

.ttv2-panel button.ttv2-tab:hover:not(:disabled) {
    background: transparent;
    color: var(--text);
}

.ttv2-panel button.ttv2-tab.ttv2-tab-on {
    background: transparent;
    color: var(--text);
    font-weight: 600;
    box-shadow: none;
    border-bottom-color: var(--profit);
}

.ttv2-credit {
    padding-bottom: 0;
    font-size: 11px;
    color: var(--faint);
}

.ttv2-list {
    padding: 4px 8px 8px;
}

.ttv2-cols {
    padding: 10px 14px 4px;
}

.ttv2-row {
    padding: 10px;
    margin-bottom: 4px;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid transparent;
    border-radius: 10px;
    transition: background-color 0.15s var(--ease);
}

.ttv2-row:hover {
    background: var(--raised);
}

.ttv2-row.ttv2-onpage {
    border-color: var(--profit-line);
    background: rgba(111, 220, 127, 0.05);
}

.ttv2-row-name {
    font-weight: 600;
}

.ttv2-row-profit {
    font: 650 15px var(--sans);
    font-variant-numeric: tabular-nums;
}

.ttv2-row-details b {
    color: var(--text2);
    font-weight: 500;
}

.ttv2-status::before {
    width: 7px;
    height: 7px;
}

.ttv2-panel button.ttv2-go {
    height: 26px;
    padding: 0 12px;
    font-weight: 650;
    color: var(--text);
}

.ttv2-empty-text {
    color: var(--muted);
}

/* The trade being worked on Torn's trade page, and the buying run. */
.ttv2-tradebox {
    padding: 12px;
    border: 1px solid var(--line2);
    border-radius: 12px;
    background: var(--raised);
}

.ttv2-panel > .ttv2-tradebox {
    margin: 10px;
}

.ttv2-buybox {
    border-color: var(--buy-line);
    background: var(--buy-bg);
}

.ttv2-buybox .ttv2-tb-head > b {
    color: var(--buy);
}

.ttv2-buybox .ttv2-sub {
    color: #cdd2db;
}

.ttv2-panel button.ttv2-buynext {
    min-height: 32px;
    border-radius: 10px;
    background: var(--buy);
    color: var(--on-buy);
    border-color: transparent;
}

.ttv2-panel button.ttv2-buynext:hover:not(:disabled) {
    background: #77b7ff;
    border-color: transparent;
}

.ttv2-panel button.ttv2-linkbtn {
    color: var(--muted);
    text-decoration: none;
    font-weight: 500;
}

.ttv2-panel button.ttv2-linkbtn:hover:not(:disabled) {
    background: none;
    color: var(--text);
}

.ttv2-tb-mark {
    color: var(--profit);
}

.ttv2-tb-fillnote {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
    font-size: 12px;
    color: var(--warn);
}

.ttv2-tb-fillnote.ttv2-tb-fillnote-ok {
    color: var(--text2);
}

/* My bazaar */
.ttv2-panel button.ttv2-bzrow {
    border-radius: 8px;
}

.ttv2-panel button.ttv2-bzrow[aria-pressed="true"] {
    background: var(--raised);
    border-color: var(--line2);
}

.ttv2-bzhero h3 {
    font: 400 16px/1.25 var(--serif);
    color: var(--text);
}

.ttv2-bzavg {
    font: 650 20px/1.2 var(--sans);
}

.ttv2-graph {
    background: var(--rail);
    border-radius: 10px;
}

.ttv2-graph-tip {
    background: rgba(17, 18, 21, 0.94);
    border-radius: 8px;
}

.ttv2-graph-marklabel {
    font: 600 11px var(--sans);
}

.ttv2-graph-keys {
    flex-wrap: wrap;
    gap: 4px 14px;
}

.ttv2-fillnow {
    padding: 12px;
    border-radius: 10px;
    background: var(--raised);
    border-color: var(--line2);
}

.ttv2-fillnow-done {
    border-color: var(--profit-line);
}

.ttv2-tos-box {
    border-radius: 10px;
    background: var(--raised);
}

/* The serif title reads small at the narrow steps' sans sizes: one step up (still measured to fit). */
.ttv2-panel.ttv2-narrow .ttv2-head .ttv2-title {
    font-size: 13px;
}

.ttv2-panel.ttv2-tight .ttv2-head .ttv2-title {
    font-size: 12px;
}

.ttv2-panel.ttv2-tighter .ttv2-tabs {
    gap: 0;
}

.ttv2-panel.ttv2-tighter button.ttv2-tab {
    padding: 0 3px;
}

@media (prefers-reduced-motion: reduce) {
    .ttv2-panel *,
    .ttv2-panel *::before,
    .ttv2-panel *::after {
        animation: none !important;
        transition: none !important;
    }
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
    style.textContent = PANEL_CSS + FILL_FORM_CSS;
    return style;
}
