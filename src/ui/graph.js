/*
 * A small SVG line graph of recorded asking prices, built as DOM nodes
 * (never innerHTML). Two lines - the lowest Item Market ask and the lowest
 * bazaar ask - and Torn's daily market value as a dashed step line. Gaps in
 * the record stay gaps: a line is broken where a bucket has no data, so the
 * picture never pretends to know more than was recorded.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
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

/**
 * @param {object} data - from core/history.js series(): { from, to, points, mv, step }
 * @param {object} [opts] - { width, height, colors: { im, bz, mv } }
 * @returns {SVGElement}
 */
export function renderPriceGraph(data, opts = {}) {
    const width = opts.width || 400;
    const height = opts.height || 96;
    const pad = { l: 8, r: 8, t: 8, b: 8 };
    const colors = { im: '#74c0fc', bz: '#99cc00', mv: '#e0a000', ...(opts.colors || {}) };

    const svg = svgEl('svg', {
        viewBox: '0 0 ' + width + ' ' + height,
        preserveAspectRatio: 'none',
        class: 'ttv2-graph',
        role: 'img',
    });

    const values = [];
    for (const p of data.points || []) {
        if (p.im !== null && p.im !== undefined) values.push(p.im);
        if (p.bz !== null && p.bz !== undefined) values.push(p.bz);
    }
    for (const m of data.mv || []) if (m.mv) values.push(m.mv);

    if (values.length < 1) {
        const t = svgEl('text', { x: width / 2, y: height / 2 + 4, 'text-anchor': 'middle', fill: '#999', 'font-size': 12, 'font-family': 'Arial' });
        t.textContent = 'Nothing recorded yet';
        svg.appendChild(t);
        return svg;
    }

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
        min *= 0.95;
        max *= 1.05;
    }
    const span = data.to - data.from || 1;
    const x = (t) => pad.l + ((t - data.from) / span) * (width - pad.l - pad.r);
    const y = (v) => height - pad.b - ((v - min) / (max - min)) * (height - pad.t - pad.b);

    // A bucket with nothing recorded is simply absent from the points, so a
    // jump of more than one bucket between neighbours is a gap too.
    const step = Number(data.step) || inferStep(data.points || []);

    const line = (key, color, dashed) => {
        let d = '';
        let pen = false;
        let run = 0;
        const lone = [];
        let prev = null;
        let prevT = null;
        for (const p of data.points || []) {
            const v = p[key];
            if (v === null || v === undefined) {
                if (run === 1 && prev) lone.push(prev);
                pen = false;
                run = 0;
                continue;
            }
            if (pen && step && prevT !== null && p.t - prevT > step * 1.5) {
                if (run === 1 && prev) lone.push(prev);
                pen = false;
                run = 0;
            }
            d += (pen ? ' L' : ' M') + x(p.t).toFixed(1) + ' ' + y(v).toFixed(1);
            pen = true;
            run += 1;
            prev = { cx: x(p.t), cy: y(v) };
            prevT = p.t;
        }
        if (run === 1 && prev) lone.push(prev);
        if (!d) return;
        const attrs = { d: d.trim(), fill: 'none', stroke: color, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' };
        if (dashed) attrs['stroke-dasharray'] = '4 3';
        svg.appendChild(svgEl('path', attrs));
        // A sample with no neighbour would be an invisible zero-length line.
        for (const c of lone) svg.appendChild(svgEl('circle', { cx: c.cx.toFixed(1), cy: c.cy.toFixed(1), r: 2, fill: color }));
    };

    line('im', colors.im, false);
    line('bz', colors.bz, false);

    // Market value: one value a day, drawn as steps to the next day.
    const mv = (data.mv || []).filter((m) => m.mv);
    if (mv.length) {
        let d = '';
        for (let i = 0; i < mv.length; i += 1) {
            const start = Math.max(mv[i].t, data.from);
            const end = i + 1 < mv.length ? mv[i + 1].t : data.to;
            d += (d ? ' L' : 'M') + x(start).toFixed(1) + ' ' + y(mv[i].mv).toFixed(1);
            d += ' L' + x(Math.min(end, data.to)).toFixed(1) + ' ' + y(mv[i].mv).toFixed(1);
        }
        svg.appendChild(svgEl('path', { d, fill: 'none', stroke: colors.mv, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
    }

    return svg;
}
