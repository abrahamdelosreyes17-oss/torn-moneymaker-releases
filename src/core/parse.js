/*
 * Pure parsing + formatting helpers. No DOM, no network.
 */

function applyMagnitude(value, suffix) {
    if (!Number.isFinite(value)) return null;

    switch ((suffix || '').toLowerCase()) {
        case 'k':
            return value * 1e3;
        case 'm':
            return value * 1e6;
        case 'b':
            return value * 1e9;
        default:
            return value;
    }
}

/**
 * Parse a money string into a number.
 *
 * Handles "$1,234", "1,234", "$1.2m", "806000". Returns null when the input
 * contains no number, rather than guessing.
 *
 * Note: unlike V1 this is never handed whole-row text. Callers pass the
 * contents of one specific cell, so there is no "first $ in the row" problem
 * to solve here.
 */
export function parseMoney(text) {
    if (typeof text !== 'string' && typeof text !== 'number') return null;

    const cleaned = String(text).replace(/[$,\s]/g, '');

    const exact = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/i);
    if (exact) return applyMagnitude(Number(exact[1]), exact[2]);

    /*
     * Embedded in a longer string. The number must END there: a following
     * letter or digit means we are looking at something else.
     *
     * This guard is load-bearing. Without it "$2,896 Buy" collapsed to
     * "2896Buy", the "B" was read as the billions suffix, and the price came
     * out as 2,896,000,000,000. Same for "$3,000 min" and "$500 market".
     */
    const loose = cleaned.match(/(-?\d+(?:\.\d+)?)([kmb])?(?![A-Za-z0-9])/);
    if (!loose) return null;

    return applyMagnitude(Number(loose[1]), loose[2]);
}

/**
 * Parse a quantity from strings like "x12", "12", "12 available", "Qty: 12".
 * Returns null when no quantity is present, so the caller decides whether to
 * assume 1 or to skip the row.
 */
export function parseQuantity(text) {
    if (text === null || text === undefined) return null;

    /*
     * Strip money figures before looking for a count.
     *
     * Without this, parseQuantity('$2,896') returned 2896 — so a price cell
     * whose class happened to contain "amount" became the quantity, and total
     * profit was inflated by three orders of magnitude.
     */
    const s = String(text)
        .toLowerCase()
        .replace(/,/g, '')
        .replace(/\$\s*\d+(?:\.\d+)?/g, ' ');

    // "x12" or "12x"
    const xForm = s.match(/(?:^|[^a-z0-9])x\s*(\d+)|(\d+)\s*x(?:[^a-z0-9]|$)/);
    if (xForm) {
        const n = Number(xForm[1] !== undefined ? xForm[1] : xForm[2]);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }

    const plain = s.match(/(\d+)/);
    if (plain) {
        const n = Number(plain[1]);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }

    return null;
}

/**
 * A money amount typed by a person: "1000000", "1,000,000", "$1m", "1.5m",
 * "500k", "2b", "1kk", "1 million". Returns null for anything else.
 *
 * The chips used to drop every non-digit, so "1m" became $1 - and a $1 cash
 * cap hides every deal without saying why.
 */
export function parseMoneyInput(text) {
    const raw = String(text == null ? '' : text).trim().toLowerCase().replace(/[$,\s_]/g, '');
    if (!raw) return null;

    const m = raw.match(/^(-?\d+(?:\.\d+)?)(k|kk|m|mil|mill|million|b|bil|bill|billion|thousand)?$/);
    if (!m) return null;

    const mult = {
        k: 1e3, thousand: 1e3,
        kk: 1e6, m: 1e6, mil: 1e6, mill: 1e6, million: 1e6,
        b: 1e9, bil: 1e9, bill: 1e9, billion: 1e9,
    }[m[2] || ''] || 1;

    const n = Number(m[1]) * mult;
    return Number.isFinite(n) ? Math.round(n) : null;
}

/** "$1,234" */
export function formatMoney(value) {
    if (!Number.isFinite(value)) return '-';

    const rounded = Math.round(value);
    const sign = rounded < 0 ? '-' : '';

    return sign + '$' + Math.abs(rounded).toLocaleString('en-US');
}

/** "$1.2m" - compact form for tight panel rows. */
export function formatMoneyShort(value) {
    if (!Number.isFinite(value)) return '-';

    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'b';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'm';
    if (abs >= 1e4) return sign + '$' + (abs / 1e3).toFixed(1) + 'k';

    return formatMoney(value);
}

/** "4.2%" */
export function formatPct(ratio) {
    if (!Number.isFinite(ratio)) return '-';
    return (ratio * 100).toFixed(1) + '%';
}

/** "12s ago" / "4m ago" - for the staleness readout. */
export function formatAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'never';

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return seconds + 's ago';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';

    return Math.floor(hours / 24) + 'd ago';
}
