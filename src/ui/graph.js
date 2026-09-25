/*
 * The price graph on your own bazaar's add / manage pages, built as DOM
 * nodes (never innerHTML).
 *
 * Made to be read, not just looked at:
 *   - a price scale (top, middle, bottom) and time marks along the bottom,
 *     so any point can be read off;
 *   - two lines only: the Item Market Average (Torn's average of what the
 *     item sold for, one value a day) and the lowest Item Market price this
 *     script saw; the average is the one that matters, so it is the solid,
 *     brighter line;
 *   - hours with nothing recorded are bridged with a faint dotted line, so
 *     the trend reads as one line while the gap is still marked;
 *   - point at the graph to read the price and time under the pointer.
 */

import { formatMoney, formatMoneyShort } from '../core/parse.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
}

function htmlEl(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The smallest spacing between points: the bucket width, when `step` is not given. */
function inferStep(points) {
    let min = 0;
    for (let i = 1; i < points.length; i += 1) {
        const gap = points[i].t - points[i - 1].t;
        if (gap > 0 && (!min || gap < min)) min = gap;
    }
    return min;
}

/** "now", "6h ago", "3d ago" for a time mark. */
function markText(t, to) {
    const ago = to - t;
    if (ago < 60 * 1000) return 'now';
    const h = ago / 3600000;
    if (h < 48) return Math.round(h) + 'h ago';
    return Math.round(h / 24) + 'd ago';
}

function whenText(t, now = Date.now()) {
    const d = new Date(t);
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (now - t < 20 * 3600000) return time;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
}

/**
 * The price range to draw. With an Item Market Average, the scale spans the
 * average and the middle of the recorded prices (10th to 90th percentile),
 * never wider than a third to three times the average. Without one, the
 * middle of the recorded prices. Outliers fall outside and are pinned.
 */
export function scaleRange(asks, avgs) {
    const sorted = asks.filter((v) => v > 0).sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
    const lo = sorted.length ? pick(sorted.length >= 10 ? 0.1 : 0) : null;
    const hi = sorted.length ? pick(sorted.length >= 10 ? 0.9 : 1) : null;
    const good = avgs.filter((v) => v > 0);

    if (!good.length) {
        if (lo === null) return { min: lo, max: hi };
        // No average to anchor on: a third to three times the median.
        const med = pick(0.5);
        return { min: Math.max(lo, med / 3), max: Math.min(hi, med * 3) };
    }
    let min = Math.min(...good);
    let max = Math.max(...good);
    const floor = min / 3;
    const ceil = max * 3;
    if (lo !== null) min = Math.min(min, Math.max(lo, floor));
    if (hi !== null) max = Math.max(max, Math.min(hi, ceil));
    return { min, max };
}

/**
 * The Item Market Average as a value at time t: the day's value in force.
 * @param {Array<{t, mv}>} mv - oldest first
 */
function avgAt(mv, t) {
    let v = null;
    for (const m of mv) {
        if (m.t <= t) v = m.mv;
        else break;
    }
    return v === null && mv.length ? mv[0].mv : v;
}

/**
 * @param {object} data - from core/history.js series(): { from, to, points, mv, step }
 * @param {object} [opts] - { width, height, colors: { im, mv } }
 * @returns {HTMLElement} a figure holding the graph, its scale and its hover label
 */
export function renderPriceGraph(data, opts = {}) {
    const width = opts.width || 400;
    const height = opts.height || 160;
    const pad = { l: 8, r: 64, t: 12, b: 20 };
    const colors = { im: '#74c0fc', mv: '#a8dd1c', ...(opts.colors || {}) };

    const fig = htmlEl('div', 'ttv2-graph-box');
    const svg = svgEl('svg', {
        viewBox: '0 0 ' + width + ' ' + height,
        width,
        height,
        class: 'ttv2-graph',
        role: 'img',
    });
    fig.appendChild(svg);

    const points = (data.points || []).filter((p) => p.im !== null && p.im !== undefined);
    const mv = (data.mv || []).filter((m) => m.mv).sort((a, b) => a.t - b.t);

    const values = points.map((p) => p.im).concat(mv.map((m) => m.mv));
    if (!values.length) {
        const t = svgEl('text', { x: width / 2, y: height / 2 + 4, 'text-anchor': 'middle', class: 'ttv2-graph-empty' });
        t.textContent = 'Nothing recorded yet';
        svg.appendChild(t);
        return fig;
    }

    // Fit the scale to the prices that matter. One troll listing (a
    // $9,999,999 Xanax on an empty market) would otherwise flatten every
    // other line; such a point is pinned to the edge and marked instead.
    let { min, max } = scaleRange(points.map((p) => p.im), mv.map((m) => m.mv));
    const room = (max - min) * 0.08 || max * 0.02 || 1;
    min = Math.max(0, min - room);
    max += room;
    const clamp = (v) => Math.min(max, Math.max(min, v));

    const span = data.to - data.from || 1;
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const x = (t) => pad.l + ((t - data.from) / span) * plotW;
    const y = (v) => pad.t + (1 - (clamp(v) - min) / (max - min)) * plotH;

    /* scale: three price lines, labelled at the right */
    for (const f of [0, 0.5, 1]) {
        const v = min + (max - min) * (1 - f);
        const yy = pad.t + f * plotH;
        svg.appendChild(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: yy, y2: yy, class: 'ttv2-graph-grid' }));
        const label = svgEl('text', { x: width - 4, y: yy + 4, 'text-anchor': 'end', class: 'ttv2-graph-label' });
        label.textContent = formatMoneyShort(Math.round(v));
        svg.appendChild(label);
    }
    /* time marks: start, middle, end */
    for (const [f, anchor] of [[0, 'start'], [0.5, 'middle'], [1, 'end']]) {
        const t = data.from + span * f;
        const label = svgEl('text', { x: pad.l + f * plotW, y: height - 4, 'text-anchor': anchor, class: 'ttv2-graph-label' });
        label.textContent = markText(t, data.to);
        svg.appendChild(label);
    }

    /* the lowest price seen: solid where recorded, dotted across gaps */
    const step = Number(data.step) || inferStep(points);
    let solid = '';
    let dotted = '';
    const lone = [];
    for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const prev = points[i - 1];
        const next = points[i + 1];
        const px = x(p.t).toFixed(1);
        const py = y(p.im).toFixed(1);
        const joined = prev && (!step || p.t - prev.t <= step * 1.5);
        if (prev && !joined) dotted += ' M' + x(prev.t).toFixed(1) + ' ' + y(prev.im).toFixed(1) + ' L' + px + ' ' + py;
        solid += (joined ? ' L' : ' M') + px + ' ' + py;
        const joinsNext = next && (!step || next.t - p.t <= step * 1.5);
        if (!joined && !joinsNext) lone.push([px, py]);
    }
    if (dotted) svg.appendChild(svgEl('path', { d: dotted.trim(), fill: 'none', stroke: colors.im, 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: 0.6 }));
    if (solid) svg.appendChild(svgEl('path', { d: solid.trim(), fill: 'none', stroke: colors.im, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
    for (const [cx, cy] of lone) svg.appendChild(svgEl('circle', { cx, cy, r: 2, fill: colors.im }));
    // Off the scale: a small arrow at the edge, pointing where it went.
    for (const p of points) {
        if (p.im <= max && p.im >= min) continue;
        const up = p.im > max;
        const px = x(p.t);
        const py = up ? pad.t : pad.t + plotH;
        const d = up
            ? 'M' + (px - 4) + ' ' + (py + 6) + ' L' + px + ' ' + py + ' L' + (px + 4) + ' ' + (py + 6) + ' Z'
            : 'M' + (px - 4) + ' ' + (py - 6) + ' L' + px + ' ' + py + ' L' + (px + 4) + ' ' + (py - 6) + ' Z';
        svg.appendChild(svgEl('path', { d, fill: colors.im, class: 'ttv2-graph-off' }));
    }

    /* the Item Market Average: one value a day, drawn as steps */
    if (mv.length) {
        let d = '';
        for (let i = 0; i < mv.length; i += 1) {
            const start = Math.max(mv[i].t, data.from);
            const end = Math.min(i + 1 < mv.length ? mv[i + 1].t : data.to, data.to);
            if (end < data.from) continue;
            d += (d ? ' L' : 'M') + x(start).toFixed(1) + ' ' + y(mv[i].mv).toFixed(1);
            d += ' L' + x(end).toFixed(1) + ' ' + y(mv[i].mv).toFixed(1);
        }
        if (d) svg.appendChild(svgEl('path', { d, fill: 'none', stroke: colors.mv, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    }

    /* point at the graph to read it */
    const cursor = svgEl('line', { y1: pad.t, y2: pad.t + plotH, class: 'ttv2-graph-cursor', visibility: 'hidden' });
    const dotIm = svgEl('circle', { r: 3, fill: colors.im, visibility: 'hidden' });
    const dotMv = svgEl('circle', { r: 3, fill: colors.mv, visibility: 'hidden' });
    for (const n of [cursor, dotIm, dotMv]) svg.appendChild(n);
    const tip = htmlEl('div', 'ttv2-graph-tip');
    tip.hidden = true;
    fig.appendChild(tip);

    const hide = () => {
        tip.hidden = true;
        for (const n of [cursor, dotIm, dotMv]) n.setAttribute('visibility', 'hidden');
    };
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointermove', (event) => {
        const box = svg.getBoundingClientRect();
        if (!box.width) return;
        const sx = ((event.clientX - box.left) / box.width) * width;
        if (sx < pad.l || sx > pad.l + plotW) return hide();
        const t = data.from + ((sx - pad.l) / plotW) * span;

        let near = null;
        for (const p of points) if (!near || Math.abs(p.t - t) < Math.abs(near.t - t)) near = p;
        // Only a point close to the pointer counts; far away is a gap.
        if (near && Math.abs(near.t - t) > Math.max(step * 1.5, span / 60)) near = null;
        const avg = mv.length ? avgAt(mv, t) : null;

        cursor.setAttribute('x1', sx.toFixed(1));
        cursor.setAttribute('x2', sx.toFixed(1));
        cursor.setAttribute('visibility', 'visible');
        if (near) {
            dotIm.setAttribute('cx', x(near.t).toFixed(1));
            dotIm.setAttribute('cy', y(near.im).toFixed(1));
        }
        dotIm.setAttribute('visibility', near ? 'visible' : 'hidden');
        if (avg) {
            dotMv.setAttribute('cx', sx.toFixed(1));
            dotMv.setAttribute('cy', y(avg).toFixed(1));
        }
        dotMv.setAttribute('visibility', avg ? 'visible' : 'hidden');

        tip.textContent = '';
        tip.appendChild(htmlEl('div', 'ttv2-tip-when', whenText(near ? near.t : t, data.to)));
        if (avg) tip.appendChild(htmlEl('div', 'ttv2-tip-mv', 'Average ' + formatMoney(avg)));
        tip.appendChild(htmlEl('div', 'ttv2-tip-im', near ? 'Lowest ' + formatMoney(near.im) : 'Not recorded'));
        tip.hidden = false;
        const left = (sx / width) * box.width;
        tip.style.left = Math.max(0, Math.min(left - 60, box.width - 128)) + 'px';
    });

    return fig;
}
