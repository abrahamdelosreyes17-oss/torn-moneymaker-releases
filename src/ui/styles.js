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
    box-shadow:
        inset 0 0 0 1px rgba(53, 211, 90, 0.55),
        inset 3px 0 0 0 #35d35a !important;
}

.ttv2-hit-top {
    box-shadow:
        inset 0 0 0 1px rgba(126, 224, 143, 0.85),
        inset 4px 0 0 0 #7ee08f !important;
}

.ttv2-panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483000;
    width: 340px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: #1b1f1c;
    color: #e8efe9;
    border: 1px solid #3a4a3d;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
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
    padding: 8px 10px;
    border-bottom: 1px solid #3a4a3d;
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
    background: #2b342d;
    color: #e8efe9;
    border: 1px solid #46584a;
    border-radius: 5px;
    padding: 4px 7px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
}

.ttv2-panel button:hover {
    background: #38463b;
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
    padding: 6px 10px;
    border-bottom: 1px solid #2c382e;
    color: #a9bdad;
    font-size: 11px;
}

.ttv2-summary {
    border-bottom: 1px solid #2c382e;
    color: #8ea394;
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
    border-bottom: 1px solid #2c382e;
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
    color: #a9bdad;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}

.ttv2-panel input[type="text"],
.ttv2-panel input[type="password"] {
    background: #121614;
    color: #e8efe9;
    border: 1px solid #46584a;
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
    color: #a9bdad;
    font-size: 11px;
}

.ttv2-list {
    overflow-y: auto;
    min-height: 0;
}

.ttv2-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-bottom: 1px solid #2c382e;
}

.ttv2-row.ttv2-stale {
    opacity: 0.45;
}

.ttv2-row-main {
    flex: 1;
    min-width: 0;
}

.ttv2-row-name {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-row-line {
    color: #c4d4c7;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-row-total {
    color: #7ee08f;
    font-weight: bold;
    font-size: 12px;
}

.ttv2-row-shop {
    color: #8ea394;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ttv2-guess {
    color: #ffd24a;
    cursor: help;
}

.ttv2-settings {
    display: none;
    flex-direction: column;
    gap: 9px;
    padding: 10px;
    border-bottom: 1px solid #2c382e;
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
    color: #8ea394;
}

.ttv2-note {
    color: #8ea394;
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
    color: #8ea394;
}

.ttv2-keystate.ttv2-ok {
    color: #7ee08f;
}

.ttv2-keystate.ttv2-bad {
    color: #ffd24a;
}

.ttv2-settings textarea {
    background: #121614;
    color: #e8efe9;
    border: 1px solid #46584a;
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
    padding: 14px 10px;
    color: #a9bdad;
    text-align: center;
}

.ttv2-diag {
    padding: 6px 10px;
    border-top: 1px solid #2c382e;
    color: #8ea394;
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
