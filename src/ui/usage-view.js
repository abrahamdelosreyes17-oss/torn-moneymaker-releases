/*
 * Settings › API use (3.15, the owner: "a separate tab inside settings... I
 * need to see the usage with a graph, so we're able to analyse what needs
 * more priority and what needs less"). Modelled on Anthropic's own usage
 * pages: a meter per limit ("12 of 70 this minute", like claude.ai's "% used"),
 * then the Console's chart - bars over time, stacked by what used them -
 * and a table of every use with its share.
 */
import { usageSeries, usageCsv, USAGE_SERVICES, USAGE_RANGES, USAGE_LABELS } from '../core/usage.js';
import { makeZip } from '../core/zip.js';

const UV_SVG_NS = 'http://www.w3.org/2000/svg';

function uvEl(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'onclick') node.addEventListener('click', v);
        else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return node;
}

function uvSvg(tag, attrs = {}) {
    const node = document.createElementNS(UV_SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    return node;
}

const uvNum = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/*
 * Each use keeps its colour whatever its rank (a colour follows the use, never
 * its place): seven hues per service, validated for the dark card (the
 * data-viz reference palette's dark steps, all checks passing on #1f1f1f); the
 * rest share one grey "Everything else" in the chart and are listed one by one
 * in the table below it.
 */
const UV_HUES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
const UV_OTHER_HUE = '#6b6b6b';
export const USAGE_COLOURS = {
    t: ['t.feed', 't.status', 't.networth', 't.ledger', 't.inventory', 't.sellers', 't.owner'],
    w: ['w.flips', 'w.buyers', 'w.lists', 'w.sweep', 'w.summary', 'w.desk', 'w.feed'],
    e: ['e.top', 'e.trader', 'e.list', 'e.active', 'e.one'],
};

/** The chart's colour for a use, and the series it is drawn in ('other' when folded). */
export function usageColour(service, label) {
    const i = (USAGE_COLOURS[service] || []).indexOf(label);
    return i >= 0 ? { series: label, colour: UV_HUES[i] } : { series: 'other', colour: UV_OTHER_HUE };
}

const UV_LANE_WORDS = { high: 'goes first', normal: 'normal', low: 'waits for room' };

/* Export (3.15, the owner: "an export API usage button that downloads as a zip file, so he can send it to us to analyse"). */
export const USAGE_EXPORT_KIND = 'torn-trading-api-usage';

/**
 * The files in the zip: counts, settings and coverage - no key. `state`: what
 * the page adds (version, switches, coverage) - see usageNow in main.js.
 * `extra` (3.17.0): the speed log and your trades, as speed/... and
 * trades/... (main.js exportExtras) - the trades name the other traders.
 * `beside`: the same files when they sit beside this folder in a bigger zip
 * (the problem report), so its last line still says the truth.
 *
 * @returns {Array<{name: string, text: string}>}
 */
export function usageExportFiles(record, { state = {}, now = Date.now(), extra = [], beside = [] } = {}) {
    const rec = { m: (record && record.m) || {}, h: (record && record.h) || {} };
    const stamp = new Date(now).toISOString();
    const tz = -new Date(now).getTimezoneOffset();
    return [
        { name: 'README.txt', text: [
            'Torn Trading - API use export',
            'Exported ' + stamp + ' (UTC; the player\'s clock is UTC' + (tz >= 0 ? '+' : '') + tz / 60 + 'h).',
            '',
            'api-usage.json  every request by what it was for: per minute for the last day ("m": minute number since 1970), per hour for the week before ("h").',
            'by-minute.csv   the same, one row per minute, service and use (local time) - opens in Excel.',
            'by-hour.csv     the same per hour.',
            'state.json      the script version, the page\'s switches and limits, and how much it had covered when exported.',
            ...usageExtraLines(extra, undefined, beside),
        ].join('\n') + '\n' },
        { name: 'api-usage.json', text: JSON.stringify({ kind: USAGE_EXPORT_KIND, v: 1, exportedAt: stamp, tzOffsetMin: tz, limits: Object.fromEntries(Object.entries(USAGE_SERVICES).map(([id, sv]) => [id, sv.perMin])), record: rec }) },
        { name: 'by-minute.csv', text: usageCsv(rec, { by: 'minute' }) },
        { name: 'by-hour.csv', text: usageCsv(rec, { by: 'hour' }) },
        { name: 'state.json', text: JSON.stringify({ exportedAt: stamp, ...state }, null, 2) },
        ...extra,
    ];
}

/**
 * What a zip says of itself at the end of its list (3.17.0): the speed log
 * and the trades when they are in it, and what is and is not in these files.
 * The trades name the other traders; nothing else holds a name or an id.
 */
export function usageExtraLines(extra = [], line = (name, text) => name.padEnd(16) + text, beside = []) {
    const has = (dir) => extra.some((f) => f && String(f.name).startsWith(dir + '/'));
    const near = beside.some((f) => f && String(f.name).startsWith('trades/'));
    return [
        ...(has('speed') ? [line('speed/', 'how long the script\'s own work took, the freezes and slow clicks the browser counted, and what is stored - the last week (speed.txt to read, speed.json the same as data).')] : []),
        ...(has('trades') ? [line('trades/', 'your finished trades as the Ledger read them, the prices each accepted trade recorded, and your leftovers (see its README).')] : []),
        '',
        has('trades')
            ? 'No API key is in these files. trades/ names the traders you traded with (their Torn names and ids); nothing else here holds a name or a player id.'
            : near
                ? 'No API key, player id or name is in this folder\'s files. The trades/ folder beside it names the traders you traded with.'
                : 'No API key, player id or name is in these files.',
    ];
}

function uvTime(at, range) {
    const d = new Date(at);
    if (range === '7d') return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export class UsageView {
    /** @param {{getExtras?: function}} [h] - the speed log and trades files, made when a zip is (3.17.0) */
    constructor(h = {}) {
        this.h = h;
        this.service = 't';
        this.range = '1h';
        this.data = null;
        this.el = uvEl('div', { class: 'uv' });
        this.metersEl = uvEl('div', { class: 'uv-meters' });
        this.controlsEl = uvEl('div', { class: 'uv-controls' });
        this.summaryEl = uvEl('p', { class: 'uv-summary' });
        this.chartEl = uvEl('div', { class: 'uv-chart' });
        this.tipEl = uvEl('div', { class: 'uv-tip', role: 'status', hidden: true });
        this.tableEl = uvEl('table', { class: 'uv-table' });
        this.exportNote = uvEl('p', { class: 'uv-summary', role: 'status' });
        this.el.append(this.metersEl, this.controlsEl, this.summaryEl, uvEl('div', { class: 'uv-plot' }, [this.chartEl, this.tipEl]), this.tableEl, this.exportNote);
    }

    /** Export API usage: one .zip to send (every tab's record, this page's settings; no key). */
    exportZip() {
        if (!this.data) return;
        const now = Date.now();
        const extra = this.h.getExtras ? this.h.getExtras() : [];
        const zip = makeZip(usageExportFiles(this.data.record, { state: this.data.state || {}, now, extra }), new Date(now));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
        const d = new Date(now);
        const pad = (n) => String(n).padStart(2, '0');
        a.download = 'torn-api-usage-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.zip';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        this.exportNote.textContent = 'Saved ' + a.download + ' to your downloads: send that file (no key is in it; your trades in it name the traders you traded with).';
    }

    /**
     * @param {{now: number, record: object, live: {t, w, e}: {used: number, cap: number}}} data
     */
    render(data) {
        this.data = data;
        this.renderMeters();
        this.renderControls();
        this.renderChart();
    }

    renderMeters() {
        const { live = {} } = this.data;
        this.metersEl.textContent = '';
        for (const [id, svc] of Object.entries(USAGE_SERVICES)) {
            const l = live[id] || { used: 0, cap: svc.perMin };
            const pct = l.cap ? Math.min(1, l.used / l.cap) : 0;
            // State in words and colour both: never colour alone.
            const state = pct >= 0.95 ? ['bad', 'at the limit'] : pct >= 0.8 ? ['warn', 'busy'] : ['ok', 'room to spare'];
            this.metersEl.appendChild(uvEl('button', {
                type: 'button',
                class: 'uv-meter' + (id === this.service ? ' uv-on' : ''),
                'aria-pressed': String(id === this.service),
                title: 'Show ' + svc.name + ' below',
                onclick: () => {
                    this.service = id;
                    this.hover = null;
                    this.render(this.data);
                },
            }, [
                uvEl('span', { class: 'uv-mname' }, [uvEl('b', { text: svc.name }), uvEl('span', { class: 'uv-state uv-' + state[0], text: state[1] })]),
                uvEl('span', { class: 'uv-mnum' }, [uvEl('b', { text: uvNum(l.used) }), ' of ' + uvNum(l.cap) + ' in the last minute']),
                uvEl('span', { class: 'uv-bar', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': l.cap, 'aria-valuenow': l.used, 'aria-label': svc.name + ' use' }, [
                    uvEl('span', { class: 'uv-fill uv-' + state[0], style: 'width:' + Math.round(pct * 100) + '%' }),
                ]),
                uvEl('small', { text: Math.round(pct * 100) + '% used · ' + svc.note }),
            ]));
        }
    }

    renderControls() {
        this.controlsEl.textContent = '';
        const seg = (items, current, pick, label) => uvEl('div', { class: 'uv-seg', role: 'group', 'aria-label': label }, items.map(([id, name]) => uvEl('button', {
            type: 'button',
            class: id === current ? 'uv-on' : null,
            'aria-pressed': String(id === current),
            text: name,
            onclick: () => pick(id),
        })));
        this.controlsEl.append(
            seg(Object.entries(USAGE_SERVICES).map(([id, s]) => [id, s.name]), this.service, (id) => {
                this.service = id;
                this.hover = null;
                this.render(this.data);
            }, 'Service'),
            uvEl('div', { class: 'uv-right' }, [
                seg(Object.entries(USAGE_RANGES).map(([id, r]) => [id, r.name]), this.range, (id) => {
                    this.range = id;
                    this.hover = null;
                    this.render(this.data);
                }, 'Time'),
                uvEl('button', { type: 'button', class: 'uv-btn', title: 'Download a .zip of the last week\'s API use, the speed log, your trades and this page\'s settings, to send for a look (no key; your trades name the traders you traded with)', text: 'Export API usage', onclick: () => this.exportZip() }),
            ]),
        );
    }

    renderChart() {
        const { now, record } = this.data;
        const svc = USAGE_SERVICES[this.service];
        const range = USAGE_RANGES[this.range];
        const s = usageSeries(record, { service: this.service, range: this.range, now });
        this.summaryEl.textContent = s.total
            ? uvNum(s.total) + ' requests to ' + svc.name + ' in the ' + range.name.toLowerCase() + ' · about ' + (s.perMinute >= 10 ? uvNum(s.perMinute) : s.perMinute.toFixed(1)) + ' a minute · busiest ' + range.barName + ' ' + uvNum(s.peak)
            : 'No requests to ' + svc.name + ' in the ' + range.name.toLowerCase() + ' yet (every tab adds its own every few seconds).';

        // Stacked bars: each bar's uses, biggest share of the range at the bottom.
        const order = s.labels.map((l) => usageColour(this.service, l.id).series).filter((x, i, a) => a.indexOf(x) === i);
        const W = 720;
        const H = 220;
        const pad = { l: 44, r: 8, t: 10, b: 24 };
        const plotW = W - pad.l - pad.r;
        const plotH = H - pad.t - pad.b;
        // The limit line (last hour only: a bar is one minute there).
        const cap = this.range === '1h' ? svc.perMin : null;
        const top = Math.max(1, s.peak, cap || 0);
        const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((x) => top / x <= 4) || Math.ceil(top / 4);
        const yMax = Math.ceil(top / step) * step;
        const y = (v) => pad.t + plotH - (v / yMax) * plotH;
        const slot = plotW / s.bars.length;
        const barW = Math.max(2, slot - 2);

        const root = uvSvg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'uv-svg', role: 'img', 'aria-label': svc.name + ' requests per ' + range.barName + ', ' + range.name.toLowerCase() });
        for (let v = 0; v <= yMax; v += step) {
            root.appendChild(uvSvg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'uv-grid' }));
            const t = uvSvg('text', { x: pad.l - 6, y: y(v) + 4, class: 'uv-axis', 'text-anchor': 'end' });
            t.textContent = uvNum(v);
            root.appendChild(t);
        }
        if (cap) {
            root.appendChild(uvSvg('line', { x1: pad.l, x2: W - pad.r, y1: y(cap), y2: y(cap), class: 'uv-cap' }));
            const t = uvSvg('text', { x: W - pad.r, y: y(cap) - 4, class: 'uv-axis', 'text-anchor': 'end' });
            t.textContent = 'our limit ' + cap + ' a minute';
            root.appendChild(t);
        }
        const labelEvery = this.range === '1h' ? 10 : this.range === '24h' ? 4 : 1;
        s.bars.forEach((b, i) => {
            const x = pad.l + i * slot + 1;
            if (i % labelEvery === 0 || (this.range === '7d')) {
                const t = uvSvg('text', { x: x + barW / 2, y: H - 6, class: 'uv-axis', 'text-anchor': 'middle' });
                t.textContent = uvTime(b.start, this.range);
                root.appendChild(t);
            }
            // Folded into series, drawn bottom up with a 2px gap between segments.
            const bySeries = {};
            for (const [label, n] of Object.entries(b.counts)) {
                const k = usageColour(this.service, label).series;
                bySeries[k] = (bySeries[k] || 0) + n;
            }
            let acc = 0;
            const segs = order.filter((k) => bySeries[k] > 0);
            segs.forEach((k, j) => {
                const v = bySeries[k];
                const y0 = y(acc);
                const y1 = y(acc + v);
                acc += v;
                const h = Math.max(1, y0 - y1 - (j < segs.length - 1 ? 2 : 0));
                const colour = k === 'other' ? UV_OTHER_HUE : usageColour(this.service, k).colour;
                const last = j === segs.length - 1;
                root.appendChild(uvSvg('rect', { x, y: y0 - h, width: barW, height: h, fill: colour, rx: last ? Math.min(3, barW / 2) : 0 }));
            });
            // The hover target: the whole column, bigger than the bar.
            const hit = uvSvg('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: plotH, class: 'uv-hit', tabindex: b.total ? 0 : -1 });
            const show = () => {
                this.hover = i;
                this.showTip(b, i / s.bars.length);
            };
            const hide = () => {
                this.hover = null;
                this.tipEl.hidden = true;
            };
            hit.addEventListener('mouseenter', show);
            hit.addEventListener('focus', show);
            hit.addEventListener('mouseleave', hide);
            hit.addEventListener('blur', hide);
            root.appendChild(hit);
        });
        this.chartEl.textContent = '';
        this.chartEl.appendChild(root);
        // Drawn again every few seconds: the bar under the pointer keeps its (fresh) tooltip.
        if (this.hover !== null && this.hover !== undefined && s.bars[this.hover]) this.showTip(s.bars[this.hover], this.hover / s.bars.length);
        else this.tipEl.hidden = true;

        // The table: every use, its share - also the chart's legend.
        this.tableEl.textContent = '';
        this.tableEl.appendChild(uvEl('thead', {}, [uvEl('tr', {}, [
            uvEl('th', { text: 'What for' }),
            this.service === 't' ? uvEl('th', { text: 'Lane' }) : null,
            uvEl('th', { class: 'uv-r', text: 'Requests' }),
            uvEl('th', { class: 'uv-r', text: 'Share' }),
            uvEl('th', { class: 'uv-r', text: 'A minute' }),
        ])]));
        const body = uvEl('tbody');
        const minutes = Math.max(1, s.total && s.perMinute ? s.total / s.perMinute : 1);
        for (const l of s.labels) {
            const c = usageColour(this.service, l.id);
            body.appendChild(uvEl('tr', {}, [
                uvEl('td', {}, [uvEl('span', { class: 'uv-sw', style: 'background:' + c.colour }), l.name + (c.series === 'other' ? ' (grey in the chart)' : '')]),
                this.service === 't' ? uvEl('td', { class: 'uv-lane uv-lane-' + (l.lane || 'high'), text: UV_LANE_WORDS[l.lane || 'high'] }) : null,
                uvEl('td', { class: 'uv-r', text: uvNum(l.total) }),
                uvEl('td', { class: 'uv-r', text: Math.round(l.share * 100) + '%' }),
                uvEl('td', { class: 'uv-r', text: (l.total / minutes).toFixed(1) }),
            ]));
        }
        if (!s.labels.length) body.appendChild(uvEl('tr', {}, [uvEl('td', { colspan: 5, class: 'uv-empty', text: 'Nothing yet.' })]));
        this.tableEl.appendChild(body);
    }

    showTip(bar, at) {
        if (!bar.total) {
            this.tipEl.hidden = true;
            return;
        }
        const range = USAGE_RANGES[this.range];
        this.tipEl.textContent = '';
        this.tipEl.appendChild(uvEl('b', { text: uvTime(bar.start, this.range) + (this.range === '7d' ? '' : ' – ' + uvTime(bar.start + range.barMs, this.range)) + ' · ' + uvNum(bar.total) }));
        for (const [label, n] of Object.entries(bar.counts).sort((a, b) => b[1] - a[1])) {
            this.tipEl.appendChild(uvEl('div', { class: 'uv-trow' }, [
                uvEl('span', { class: 'uv-sw', style: 'background:' + usageColour(this.service, label).colour }),
                uvEl('span', { text: (USAGE_LABELS[label] || { name: label }).name }),
                uvEl('b', { text: uvNum(n) }),
            ]));
        }
        this.tipEl.style.left = Math.round(Math.min(0.72, Math.max(0.02, at)) * 100) + '%';
        this.tipEl.hidden = false;
    }
}

export const USAGE_CSS = `
.uv { display: flex; flex-direction: column; gap: 14px; }
.uv-meters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.uv-meter { display: flex; flex-direction: column; gap: 6px; padding: 12px; text-align: left; background: var(--card2); border: 1px solid var(--cline2); border-radius: 10px; color: var(--text); cursor: pointer; }
.uv-meter:hover { border-color: var(--muted); }
.uv-meter.uv-on { border-color: var(--hot-line); box-shadow: inset 0 0 0 1px var(--hot-line); }
.uv-mname { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.uv-mnum { color: var(--muted); }
.uv-mnum b { color: var(--text); font-size: 20px; font-variant-numeric: tabular-nums; }
.uv-meter small { color: var(--muted); font-size: 12px; }
.uv-bar { display: block; height: 8px; border-radius: 4px; background: #333; overflow: hidden; }
.uv-fill { display: block; height: 100%; border-radius: 4px; background: #3987e5; }
.uv-fill.uv-warn { background: #c98500; }
.uv-fill.uv-bad { background: #e66767; }
.uv-state { font-size: 12px; font-weight: bold; }
.uv-state.uv-ok { color: var(--muted); }
.uv-state.uv-warn { color: #e0a530; }
.uv-state.uv-bad { color: #ff8a80; }
.uv-controls { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
.uv-seg { display: inline-flex; border: 1px solid var(--cline2); border-radius: 8px; overflow: hidden; }
.uv-seg button { padding: 6px 12px; border: 0; background: none; color: var(--muted); cursor: pointer; }
.uv-seg button + button { border-left: 1px solid var(--cline2); }
.uv-seg button.uv-on { background: var(--green-bg); color: var(--text); font-weight: bold; }
.uv-summary { margin: 0; color: var(--muted); }
.uv-right { display: inline-flex; flex-wrap: wrap; gap: 8px; }
.uv-btn { padding: 6px 12px; border: 1px solid var(--cline2); border-radius: 8px; background: var(--card2); color: var(--text); cursor: pointer; }
.uv-btn:hover { border-color: var(--muted); }

.uv-plot { position: relative; }
.uv-svg { display: block; width: 100%; height: auto; }
.uv-grid { stroke: #2f2f2f; stroke-width: 1; }
.uv-cap { stroke: #ff8a80; stroke-width: 1; stroke-dasharray: 4 4; }
.uv-axis { fill: var(--muted); font-size: 11px; font-family: Arial, Helvetica, sans-serif; }
.uv-hit { fill: transparent; cursor: default; }
.uv-hit:hover, .uv-hit:focus { fill: rgba(255, 255, 255, 0.05); outline: none; }
.uv-tip { position: absolute; top: 0; min-width: 200px; max-width: 280px; padding: 8px 10px; background: #111; border: 1px solid var(--cline2); border-radius: 8px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5); pointer-events: none; font-size: 12px; }
.uv-tip > b { display: block; margin-bottom: 4px; }
.uv-trow { display: grid; grid-template-columns: 10px 1fr auto; gap: 6px; align-items: center; }
.uv-sw { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; vertical-align: -1px; }
.uv-trow .uv-sw { margin: 0; }
.uv-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.uv-table th { text-align: left; font-size: 11px; letter-spacing: 0.4px; text-transform: uppercase; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--cline2); }
.uv-table td { padding: 6px 8px; border-bottom: 1px solid var(--cline); }
.uv-r { text-align: right; }
.uv-lane { color: var(--muted); font-size: 12px; }
.uv-lane-high { color: var(--price); }
.uv-empty { color: var(--muted); }
`;
