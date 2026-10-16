/* Cognitive Evolution Tracker — small SVG chart engine (no dependencies).

   One flexible renderer used for performance, lifestyle, and assessment charts.
   cfg = {
     series: [{ id, label, color, points: [{ x (ms), y, ref, tip }] }],
     type: 'scatter' | 'line' | 'bar',
     xType: 'date' | 'time' | 'number',
     yLabel, yDomain?, yFormat?, xFormat?, height?, empty?, showTrend?,
     dual?: { seriesId, label, domain:[lo,hi], format },   // second y-axis (association explorer)
     onPoint(ref)                                          // click a data point
   } */
window.Charts = (function () {
  'use strict';
  const { esc, niceTicks, timeTicks, toMs, fmtDateShort, minToHHMM } = U;

  const instances = [];
  let resizeBound = false;

  function render(host, cfg) {
    const inst = { host, cfg };
    // replace any previous render for this host
    const idx = instances.findIndex((i) => i.host === host);
    if (idx >= 0) instances[idx] = inst; else instances.push(inst);
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', U.debounce(() => {
        instances.forEach((i) => { if (document.contains(i.host)) draw(i.host, i.cfg); });
      }, 250));
    }
    draw(host, cfg);
  }

  function clear(host) { host.innerHTML = ''; }

  function draw(host, cfg) {
    clear(host);
    const allPts = [];
    cfg.series.forEach((s) => s.points.forEach((p) => allPts.push(p)));
    // never let a malformed point poison the scales or produce NaN/Infinity SVG attributes
    const finitePts = (pts) => pts.filter((p) => isFinite(p.x) && isFinite(p.y));
    if (!allPts.length || !finitePts(allPts).length) {
      host.appendChild(U.el('<div class="chart-empty">' + esc(cfg.empty || 'No data in this range yet.') + '</div>'));
      return;
    }

    const W = Math.max(320, host.clientWidth || 640);
    const H = cfg.height || 300;
    const M = { l: 58, r: cfg.dual ? 58 : 18, t: 14, b: 40 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;

    // ---- domains
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    finitePts(allPts).forEach((p) => {
      if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
    });
    const dualSeries = cfg.dual ? cfg.series.find((s) => s.id === cfg.dual.seriesId) : null;
    if (dualSeries) dualSeries.points.forEach((p) => { /* dual uses its own domain */ });

    if (cfg.type === 'bar') { yMin = Math.min(0, yMin); }
    let yT;
    if (cfg.yTicks && cfg.yDomain) {
      // Explicit tick values (used for clock-time axes so ticks land on readable times).
      yT = { min: cfg.yDomain[0], max: cfg.yDomain[1], ticks: cfg.yTicks.slice() };
    } else if (cfg.yDomain) {
      yT = niceTicks(cfg.yDomain[0], cfg.yDomain[1], 5);
    } else {
      const padY = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.1 || 1;
      yT = niceTicks(yMin === yMax ? yMin - 1 : yMin - (yMin === 0 ? 0 : padY), yMax + padY, 5);
    }

    if (xMax === xMin) { xMin -= 43200000; xMax += 43200000; }
    if (cfg.type === 'bar' && xMax - xMin < 86400000) { xMin -= 43200000; xMax += 43200000; }
    // pad x a little for scatter
    const xPad = (xMax - xMin) * 0.03;
    const x0 = xMin - xPad, x1 = xMax + xPad;

    // dual-axis domain: normalise degenerate/empty ranges so sy2 never divides by zero
    // (a lifestyle overlay with a single value gives min === max; an empty series gives ±Infinity)
    let dualDomain = null;
    if (cfg.dual) {
      let d0 = cfg.dual.domain[0], d1 = cfg.dual.domain[1];
      if (!isFinite(d0) || !isFinite(d1)) { d0 = 0; d1 = 1; }
      if (d1 - d0 < 1e-9) {
        const p = Math.abs(d1) * 0.1 || 1;
        d0 -= p; d1 += p;
      }
      dualDomain = [d0, d1];
    }

    const sx = (x) => M.l + ((x - x0) / (x1 - x0)) * iw;
    const sy = (y) => M.t + ih - ((y - yT.min) / (yT.max - yT.min)) * ih;
    const sy2 = dualDomain ? (y) => M.t + ih - ((y - dualDomain[0]) / (dualDomain[1] - dualDomain[0])) * ih : null;

    // ---- svg scaffold
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', (cfg.yLabel || 'Chart') + ' over ' + (cfg.xLabel || 'time'));
    const add = (tag, attrs, parent) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(n);
      return n;
    };

    // ---- gridlines + y axis
    yT.ticks.forEach((t) => {
      const y = sy(t);
      add('line', { x1: M.l, x2: M.l + iw, y1: y, y2: y, class: 'grid' });
      const lab = add('text', { x: M.l - 8, y: y + 4, class: 'axis-label y' });
      lab.textContent = cfg.yFormat ? cfg.yFormat(t) : U.fmtNum(t, Math.abs(t) < 10 && t % 1 !== 0 ? 1 : 0);
    });

    // ---- x axis
    const xAxis = add('line', { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih, class: 'axis' });
    void xAxis;
    let xTickEls = [];
    if (cfg.xType === 'date') {
      const tt = timeTicks(x0, x1);
      xTickEls = tt.ticks;
    } else if (cfg.xType === 'time') {
      for (let m = 0; m <= 1440; m += 360) xTickEls.push({ x: m * 60000, label: minToHHMM(m) });
    } else {
      const xt = niceTicks(x0, x1, 6);
      xTickEls = xt.ticks.map((t) => ({ x: t, label: cfg.xFormat ? cfg.xFormat(t) : U.fmtNum(t, 0) }));
    }
    xTickEls.forEach((t) => {
      const x = sx(t.x == null ? t.ms : t.x);
      if (x < M.l - 1 || x > M.l + iw + 1) return;
      add('line', { x1: x, x2: x, y1: M.t + ih, y2: M.t + ih + 4, class: 'axis' });
      const lab = add('text', { x: x, y: M.t + ih + 18, class: 'axis-label x' });
      lab.textContent = t.label;
    });

    // y axis title
    if (cfg.yLabel) {
      const t = add('text', { x: 12, y: M.t + ih / 2, class: 'axis-title', transform: 'rotate(-90 12 ' + (M.t + ih / 2) + ')', 'text-anchor': 'middle' });
      t.textContent = cfg.yLabel;
    }

    // dual axis
    if (cfg.dual && sy2 && dualDomain) {
      const dT = niceTicks(dualDomain[0], dualDomain[1], 5);
      dT.ticks.forEach((t) => {
        const y = sy2(t);
        add('line', { x1: M.l + iw, x2: M.l + iw, y1: y, y2: y, class: 'grid dual' });
        const lab = add('text', { x: M.l + iw + 8, y: y + 4, class: 'axis-label y dual' });
        lab.textContent = cfg.dual.format ? cfg.dual.format(t) : U.fmtNum(t, 0);
      });
    }

    // ---- series
    const tooltip = U.el('<div class="chart-tip" hidden></div>');
    host.appendChild(tooltip);
    host.appendChild(svg);

    const dotR = 4.2;
    cfg.series.forEach((s) => {
      const pts = finitePts(s.points).slice().sort((a, b) => a.x - b.x);
      if (cfg.type === 'line' && pts.length > 1) {
        const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ');
        add('path', { d, class: 'series-line', stroke: s.color, 'stroke-width': 1.8, fill: 'none' });
      }
      if (cfg.type === 'bar') {
        const bw = Math.max(2, Math.min(18, iw / Math.max(6, pts.length) * 0.6));
        pts.forEach((p) => {
          const x = sx(p.x), y = sy(Math.max(0, p.y));
          const r = add('rect', {
            x: x - bw / 2, y: Math.min(y, sy(0)), width: bw, height: Math.abs(sy(0) - y),
            fill: s.color, class: 'bar', rx: 2
          });
          bindPoint(r, p, s, tooltip, cfg);
        });
      } else {
        pts.forEach((p) => {
          const c = add('circle', {
            cx: sx(p.x), cy: cfg.dual && s.id === cfg.dual.seriesId ? sy2(p.y) : sy(p.y),
            r: dotR, fill: s.color, class: 'dot'
          });
          bindPoint(c, p, s, tooltip, cfg);
        });
      }
    });

    // ---- descriptive trend line (OLS) per series
    if (cfg.showTrend) {
      cfg.series.forEach((s) => {
        const tpts = finitePts(s.points);
        if (tpts.length < 3) return;
        const fit = U.ols(tpts.map((p) => ({ x: p.x, y: p.y })));
        if (!fit) return;
        const xs = tpts.map((p) => p.x);
        const a = Math.min(...xs), b = Math.max(...xs);
        add('line', {
          x1: sx(a), y1: sy(fit.slope * a + fit.intercept), x2: sx(b), y2: sy(fit.slope * b + fit.intercept),
          class: 'trend', stroke: s.color
        });
      });
    }

    function bindPoint(node, p, s, tip, cfg2) {
      node.classList.add('hit');
      node.addEventListener('mouseenter', (e) => {
        tip.innerHTML = p.tip || (esc(s.label) + ': ' + U.fmtNum(p.y));
        tip.hidden = false;
        positionTip(e);
        node.setAttribute('r', dotR + 2);
      });
      node.addEventListener('mousemove', positionTip);
      node.addEventListener('mouseleave', () => { tip.hidden = true; node.setAttribute('r', dotR); });
      if (cfg2.onPoint && p.ref) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => cfg2.onPoint(p.ref));
      }
      function positionTip(e) {
        const rect = host.getBoundingClientRect();
        let left = e.clientX - rect.left + 14;
        let top = e.clientY - rect.top - 12;
        if (left + tip.offsetWidth > rect.width - 6) left = e.clientX - rect.left - tip.offsetWidth - 14;
        if (top < 0) top = 4;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      }
    }
  }

  /** Simple horizontal date timeline used for the assessment history. */
  function timeline(host, cfg) {
    // cfg: { from, to, markers: [{date, label, color, sub}], bands: [{from,to,label,color}] }
    host.innerHTML = '';
    const W = Math.max(320, host.clientWidth || 640);
    const H = cfg.height || 130;
    const M = { l: 20, r: 20, t: 24, b: 34 };
    const toM = (d) => U.toMs(d);
    let a = toM(cfg.from), b = toM(cfg.to);
    if (!isFinite(a) || !isFinite(b) || a === b) { a = Date.now() - 30 * 86400000; b = Date.now() + 86400000; }
    const iw = W - M.l - M.r;
    const sx = (x) => M.l + ((x - a) / (b - a)) * iw;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', H);
    const add = (tag, attrs, parent) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(n);
      return n;
    };
    const y = M.t + 34;
    add('line', { x1: M.l, x2: M.l + iw, y1: y, y2: y, class: 'axis' });
    (cfg.bands || []).forEach((band) => {
      const x1 = sx(Math.max(a, toM(band.from))), x2 = sx(Math.min(b, toM(band.to)));
      if (x2 <= x1) return;
      add('rect', { x: x1, y: y - 9, width: x2 - x1, height: 18, rx: 4, fill: band.color || '#e8ecf6', class: 'tl-band' });
      const t = add('text', { x: (x1 + x2) / 2, y: y + 26, class: 'axis-label x', 'text-anchor': 'middle' });
      t.textContent = band.label || '';
    });
    const tt = timeTicks(a, b);
    tt.ticks.forEach((t) => {
      const x = sx(t.ms);
      if (x < M.l || x > M.l + iw) return;
      add('line', { x1: x, x2: x, y1: y + 9, y2: y + 13, class: 'axis' });
      const lab = add('text', { x, y: y + 26, class: 'axis-label x', 'text-anchor': 'middle' });
      if (!(cfg.bands || []).length) lab.textContent = t.label;
    });
    (cfg.markers || []).forEach((m, i) => {
      const x = sx(toM(m.date));
      if (x < M.l - 4 || x > M.l + iw + 4) return;
      add('line', { x1: x, x2: x, y1: y - 16, y2: y + 9, stroke: m.color, 'stroke-width': 2 });
      add('circle', { cx: x, cy: y - 16, r: 5, fill: m.color, class: 'hit' });
      const t = add('text', { x, y: y - 24 - (i % 2) * 14, class: 'tl-label', 'text-anchor': i === 0 ? 'start' : (x > M.l + iw - 90 ? 'end' : 'middle') });
      t.textContent = m.label;
      if (m.sub) {
        const s = add('text', { x, y: y - 12 + 24 + 20, class: 'axis-label x', 'text-anchor': 'middle' });
        s.textContent = m.sub;
      }
    });
    host.appendChild(svg);
  }

  return { render, timeline, clear };
})();
