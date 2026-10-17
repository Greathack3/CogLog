/* Cognitive Evolution Tracker — Progress dashboard.

   Aggregates stored records into interactive graphs + descriptive statistics.
   Everything here is derived from the underlying records and refreshes on every state change.
   Incompatible metrics are never plotted on a shared Y-axis (spec §7.2). */
window.ViewProgress = (function () {
  'use strict';
  const { el, esc } = U;

  const cfg = {
    range: '30d', from: '', to: '',
    metricId: '', versionFilter: null,
    modeIds: [],            // empty = all
    connect: true, trend: false,
    lifeMetric: 'sleep',    // lifestyle overlay target for association explorer
    showOverlay: false
  };

  const RANGE_OPTS = [
    ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'],
    ['6m', '6 months'], ['1y', '1 year'], ['all', 'All'], ['custom', 'Custom']
  ];

  /* Clock-time axis: ticks every 4 hours so labels land on readable times (00:00…24:00)
     instead of arbitrary nice-number intervals that wrap confusingly. */
  const CLOCK_TICKS = [0, 240, 480, 720, 960, 1200, 1440];
  const fmtClock = (v) => (v >= 1440 ? '24:00' : U.minToHHMM(v));

  function bounds() {
    if (cfg.range === 'custom') return { from: cfg.from || null, to: cfg.to || null };
    return { from: ViewJournal.rangeToFrom(cfg.range), to: null };
  }

  function render(host) {
    host.innerHTML = '';
    const wrap = el('<div class="page progress"></div>');
    wrap.appendChild(rangeBar());
    if (!Store.state.observations.length && !Store.state.tickets.length) {
      wrap.appendChild(el('<div class="empty big"><div class="empty-icon">' + Icons.svg('chart') + '</div>' +
        '<h3>Nothing to graph yet</h3><p>Record a few training sessions in the Journal and your performance, sleep, and activity data will appear here automatically.</p></div>'));
      host.appendChild(wrap);
      return;
    }
    wrap.appendChild(performancePanel());
    wrap.appendChild(lifestyleGrid());
    wrap.appendChild(associationPanel());
    wrap.appendChild(assessmentTimeline());
    host.appendChild(wrap);
    drawAll(wrap);
    bind(wrap, host);
  }

  /* ---------- range bar ---------- */

  function rangeBar() {
    const b = bounds();
    const bar = el('<div class="toolbar card range-bar">' +
      '<div class="tb-range">' + RANGE_OPTS.map(([v, l]) =>
        '<button class="chip-btn' + (cfg.range === v ? ' on' : '') + '" data-range="' + v + '">' + esc(l) + '</button>').join('') + '</div>' +
      (cfg.range === 'custom'
        ? '<div class="tb-custom"><input type="date" data-f="from" value="' + esc(cfg.from || '') + '"><span>→</span><input type="date" data-f="to" value="' + esc(cfg.to || '') + '"></div>'
        : '<div class="range-caption">Showing ' + esc(b.from ? U.fmtDateShort(b.from) : 'the beginning') + ' → ' + esc(b.to ? U.fmtDateShort(b.to) : 'today') + '</div>') +
      '</div>');
    return bar;
  }

  /* ---------- performance panel ---------- */

  function availableMetrics() {
    const b = bounds();
    const used = new Set(Store.state.observations.map((o) => o.metricId));
    return Store.state.metrics.filter((m) => used.has(m.id) && !m.archived);
  }

  function performancePanel() {
    const metrics = availableMetrics();
    if (!cfg.metricId && metrics.length) cfg.metricId = metrics[0].id;
    const metric = Store.metricById(cfg.metricId);

    const modes = Store.state.modes.filter((m) => !m.archived);
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Performance over time</h2>' +
      '<div class="panel-sub">One metric per chart — different units never share a Y-axis.</div></div>' +
      '<div class="panel-controls">' +
      '<select data-f="metric">' + (metrics.length
        ? metrics.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === cfg.metricId ? ' selected' : '') + '>' + esc(m.name) + (m.unit ? ' (' + esc(m.unit) + ')' : '') + '</option>').join('')
        : '<option value="">— no metrics recorded —</option>') + '</select>' +
      '<label class="toggle"><input type="checkbox" data-f="connect"' + (cfg.connect ? ' checked' : '') + '> Connect</label>' +
      '<label class="toggle"><input type="checkbox" data-f="trend"' + (cfg.trend ? ' checked' : '') + '> Trend line</label>' +
      '</div></div>' +
      '<div class="mode-toggles">' + modes.map((m) =>
        '<button class="chip-btn mode-toggle' + (modeActive(m.id) ? ' on' : '') + '" data-mode="' + esc(m.id) + '">' +
        '<i class="dot" style="background:' + esc(m.color) + '"></i>' + esc(m.name) + '</button>').join('') +
      '<button class="chip-btn" data-mode="__all">All</button></div>' +
      '<div class="chart-host" data-chart="perf"></div>' +
      '<div class="stat-strip" data-stats></div>' +
      '<div class="legend" data-legend></div>' +
      '</section>');
    return panel;
  }

  function modeActive(id) { return !cfg.modeIds.length || cfg.modeIds.indexOf(id) >= 0; }

  /* ---------- lifestyle grid ---------- */

  const LIFE = [
    { key: 'sleep', label: 'Sleep duration', unit: 'h', kind: 'daily' },
    { key: 'sleeptimes', label: 'Sleep & wake times', unit: '', kind: 'daily' },
    { key: 'traindur', label: 'Training duration', unit: 'min', kind: 'session' },
    { key: 'trainfreq', label: 'Training frequency', unit: 'sessions/day', kind: 'daily' },
    { key: 'timeofday', label: 'Time of training', unit: '', kind: 'session' }
  ];

  const WORKOUT_COLORS = ['#4f7cff', '#2aa18f', '#e0913a', '#d6459e', '#7c8cf8', '#8b7cf6', '#3aa8c9', '#c9663a'];

  /* Workout types with recorded minutes in this range — one graph per workout. */
  function workoutTypes(b) {
    const map = new Map();
    Store.ticketsInRange(b.from, b.to).forEach((t) => {
      const pa = t.pa || {};
      if (pa.dailyMinutes == null) return;
      const raw = String(pa.type || '').trim();
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, { key: key, label: raw || 'Unspecified workout', first: t.date || '' });
    });
    return Array.from(map.values()).sort((a, c) =>
      String(a.first).localeCompare(String(c.first)) || a.label.localeCompare(c.label));
  }

  function lifestyleGrid() {
    const workouts = workoutTypes(bounds());
    const grid = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Lifestyle &amp; behaviour</h2>' +
      '<div class="panel-sub">Daily measurements, session data, and per-workout minutes — each workout you record gets its own progress graph.</div></div></div>' +
      '<div class="life-grid">' + LIFE.map((l) =>
        '<div class="life-cell"><div class="life-title">' + esc(l.label) +
        '<span class="kind-tag ' + esc(l.kind) + '">' + (l.kind === 'session' ? 'per session' : 'daily') + '</span></div>' +
        '<div class="chart-host small" data-life="' + l.key + '"></div></div>').join('') +
      workouts.map((w) =>
        '<div class="life-cell"><div class="life-title">' + esc(w.label) +
        '<span class="kind-tag workout">per workout</span></div>' +
        '<div class="chart-host small" data-workout="' + esc(w.key) + '"></div></div>').join('') +
      '</div></section>');
    return grid;
  }

  /* ---------- association explorer ---------- */

  function associationPanel() {
    const metrics = availableMetrics();
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Association explorer</h2>' +
      '<div class="panel-sub">Overlay a lifestyle variable on a performance metric to eyeball possible relationships.</div></div>' +
      '<div class="panel-controls">' +
      '<select data-f="assoc-metric">' + metrics.map((m) =>
        '<option value="' + esc(m.id) + '"' + (m.id === cfg.metricId ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select>' +
      '<select data-f="assoc-life">' + LIFE.filter((l) => l.key !== 'sleeptimes' && l.key !== 'timeofday').map((l) =>
        '<option value="' + esc(l.key) + '"' + (l.key === cfg.lifeMetric ? ' selected' : '') + '>' + esc(l.label) + '</option>').join('') + '</select>' +
      '</div></div>' +
      '<div class="chart-host" data-chart="assoc"></div>' +
      '<div class="caution">' + Icons.svg('alert') + ' This overlay is <strong>descriptive only</strong>. Two lines moving together does not establish that the lifestyle variable caused the performance change — sleep, practice, motivation, and time all co-vary.</div>' +
      '</section>');
    return panel;
  }

  /* ---------- assessment timeline ---------- */

  function assessmentTimeline() {
    const items = Store.state.assessments.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!items.length) {
      return el('<section class="panel card"><div class="panel-head"><div><h2>Assessment timeline</h2>' +
        '<div class="panel-sub">No assessments recorded yet — add a baseline in the Profile panel.</div></div></div></section>');
    }
    const first = items[0].date;
    const last = items[items.length - 1].date;
    const trainDates = Store.state.sessions.map((s) => s.date).filter(Boolean).sort();
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Assessment &amp; training timeline</h2>' +
      '<div class="panel-sub">Baseline testing, training periods, and follow-up assessments on one axis.</div></div></div>' +
      '<div class="chart-host timeline" data-timeline></div>' +
      '<div class="assess-list">' + items.map((a) => {
        const mode = a.kind === 'baseline' ? 'baseline' : 'followup';
        return '<div class="assess-row ' + mode + '"><span class="badge ' + mode + '">' + (a.kind === 'baseline' ? 'Baseline' : 'Follow-up') + '</span>' +
          '<strong>' + esc(a.testName || '(unnamed test)') + '</strong>' +
          '<span>' + esc(U.fmtDateShort(a.date)) + '</span>' +
          '<span class="score">' + (a.overallScore == null ? '—' : esc(a.overallScore)) + (a.scoreType ? ' <em>' + esc(a.scoreType) + '</em>' : '') + '</span></div>';
      }).join('') + '</div>' +
      (trainDates.length ? '<div class="hint mt">Training sessions recorded between ' + esc(U.fmtDateShort(trainDates[0])) + ' and ' + esc(U.fmtDateShort(trainDates[trainDates.length - 1])) + ' (' + Store.state.sessions.length + ' total).</div>' : '') +
      '</section>');
    void first; void last;
    return panel;
  }

  /* ---------- drawing ---------- */

  function drawAll(wrap) {
    drawPerformance(wrap);
    LIFE.forEach((l) => drawLifestyle(wrap, l));
    drawWorkouts(wrap);
    drawAssociation(wrap);
    drawTimeline(wrap);
  }

  function drawPerformance(wrap) {
    const host = wrap.querySelector('[data-chart="perf"]');
    const statsHost = wrap.querySelector('[data-stats]');
    const legendHost = wrap.querySelector('[data-legend]');
    const metric = Store.metricById(cfg.metricId);
    if (!metric || !availableMetrics().length) {
      host.innerHTML = '';
      host.appendChild(el('<div class="chart-empty">No metric data recorded yet.</div>'));
      statsHost.innerHTML = '';
      legendHost.innerHTML = '';
      return;
    }
    const b = bounds();
    const rows = Store.queryObservations({
      metricId: metric.id, from: b.from, to: b.to,
      modeIds: cfg.modeIds.length ? cfg.modeIds : null
    }).filter((r) => U.toNum(r.obs.value) != null);

    // group by metric definition version (spec §3.6) — only the selected version is charted
    const versions = Array.from(new Set(rows.map((r) => r.obs.metricVersion || 1))).sort();
    if (cfg.versionFilter == null || versions.indexOf(cfg.versionFilter) < 0) cfg.versionFilter = versions[versions.length - 1];
    const vRows = rows.filter((r) => (r.obs.metricVersion || 1) === cfg.versionFilter);

    const modeIds = Array.from(new Set(vRows.map((r) => r.session.modeId)));
    const series = modeIds.map((mid) => {
      const mode = Store.modeById(mid) || { name: 'Unknown', color: '#999' };
      return {
        id: mid, label: mode.name, color: mode.color || '#999',
        points: vRows.filter((r) => r.session.modeId === mid).map((r) => ({
          x: U.toMs(r.session.date),
          y: U.toNum(r.obs.value),
          ref: { ticketId: r.ticket ? r.ticket.id : null },
          tip: '<strong>' + esc(mode.name) + '</strong> · ' + esc(U.fmtDateShort(r.session.date)) +
            (r.session.startTime ? ' @ ' + esc(r.session.startTime) : '') + '<br>' +
            esc(metric.name) + ': <strong>' + esc(String(r.obs.value)) + '</strong>' + esc(metric.unit ? ' ' + metric.unit : '') +
            (r.metricVersion > 1 ? '<br><em>definition v' + r.metricVersion + '</em>' : '') +
            (r.obs.notes ? '<br>' + esc(r.obs.notes) : '') +
            '<br><em>click to open the source ticket</em>'
        }))
      };
    });

    Charts.render(host, {
      series, type: cfg.connect ? 'line' : 'scatter',
      xType: 'date', yLabel: metric.name + (metric.unit ? ' (' + metric.unit + ')' : ''),
      showTrend: cfg.trend, height: 320,
      empty: 'No ' + metric.name.toLowerCase() + ' observations in this range yet.',
      onPoint: (ref) => { if (ref.ticketId) Editor.open(ref.ticketId); }
    });

    // legend + version selector
    legendHost.innerHTML = '';
    if (series.length > 1) {
      series.forEach((s) => legendHost.appendChild(el('<span class="legend-item"><i class="dot" style="background:' + esc(s.color) + '"></i>' + esc(s.label) + '</span>')));
    }
    if (versions.length > 1) {
      const vSel = el('<div class="version-note">This metric’s definition changed over time. Charting <select data-f="version">' +
        versions.map((v) => '<option value="' + v + '"' + (v === cfg.versionFilter ? ' selected' : '') + '>version ' + v + '</option>').join('') +
        '</select> — observations under different definitions are not pooled.</div>');
      vSel.querySelector('select').addEventListener('change', (e) => { cfg.versionFilter = Number(e.target.value); refresh(wrap); });
      legendHost.appendChild(vSel);
    }

    statsHost.innerHTML = '';
    statsHost.appendChild(statStrip(metric, vRows));
  }

  function statStrip(metric, rows) {
    const vals = rows.map((r) => U.toNum(r.obs.value)).filter((v) => v != null);
    const box = el('<div class="stats"></div>');
    if (vals.length < 2) {
      box.appendChild(el('<div class="hint">Only ' + vals.length + ' observation(s) in range — descriptive statistics need at least 2, and a trend needs at least 3. Nothing is extrapolated.</div>'));
      return box;
    }
    const dates = rows.map((r) => r.session.date);
    const first = rows[0], last = rows[rows.length - 1];
    const delta = U.toNum(last.obs.value) - U.toNum(first.obs.value);
    const dir = metric.direction || 'higher_better';
    const good = dir === 'higher_better' ? delta > 0 : dir === 'lower_better' ? delta < 0 : null;
    const mean = U.mean(vals), sd = U.stdev(vals);
    const items = [
      ['Observations', vals.length + ' across ' + new Set(rows.map((r) => r.session.id)).size + ' session(s)'],
      ['Highest', U.fmtNum(Math.max.apply(null, vals)) + (metric.unit ? ' ' + metric.unit : '')],
      ['Lowest', U.fmtNum(Math.min.apply(null, vals)) + (metric.unit ? ' ' + metric.unit : '')],
      ['Mean ± SD', U.fmtNum(mean) + (sd != null ? ' ± ' + U.fmtNum(sd) : ' —')],
      ['Median', U.fmtNum(U.median(vals))],
      ['First → latest', U.fmtNum(U.toNum(first.obs.value)) + ' → ' + U.fmtNum(U.toNum(last.obs.value)) +
        ' (' + (delta >= 0 ? '+' : '') + U.fmtNum(delta) + ')' +
        (good == null ? '' : good ? ' <span class="trend-good">▲</span>' : ' <span class="trend-warn">▼</span>')]
    ];
    items.forEach(([k, v]) => box.appendChild(el('<div class="stat"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>')));
    box.appendChild(el('<div class="hint wide">Range: ' + esc(U.fmtDateShort(dates[0])) + ' → ' + esc(U.fmtDateShort(dates[dates.length - 1])) +
      '. ▲/▼ compares the first and latest recorded values only — it is not a claim about underlying ability or a prediction of future scores.</div>'));
    return box;
  }

  /* ---------- lifestyle drawing ---------- */

  function drawLifestyle(wrap, l) {
    const host = wrap.querySelector('[data-life="' + l.key + '"]');
    if (!host) return;
    const b = bounds();
    const tickets = Store.ticketsInRange(b.from, b.to);
    const sessions = Store.state.sessions.filter((s) => (!b.from || s.date >= b.from) && (!b.to || s.date <= b.to));
    const D = U.toMs;

    if (l.key === 'sleep') {
      const pts = tickets.filter((t) => (t.sleep || {}).durationMin != null)
        .map((t) => ({ x: D(t.date), y: t.sleep.durationMin / 60, ref: { ticketId: t.id }, tip: esc(U.fmtDateShort(t.date)) + ': <strong>' + U.fmtDuration(t.sleep.durationMin) + '</strong>' + (t.sleep.quality ? '<br>quality ' + esc(t.sleep.quality) + '/5' : '') }));
      Charts.render(host, seriesCfg('Sleep (h)', 'line', pts, '#7c8cf8', 180, 'No sleep recorded in this range.', b));
    } else if (l.key === 'sleeptimes') {
      const bed = tickets.filter((t) => (t.sleep || {}).bedTime)
        .map((t) => ({ x: D(t.date), y: U.hhmmToMin(t.sleep.bedTime), ref: { ticketId: t.id }, tip: esc(U.fmtDateShort(t.date)) + ': asleep <strong>' + esc(t.sleep.bedTime) + '</strong>' }));
      const wake = tickets.filter((t) => (t.sleep || {}).wakeTime)
        .map((t) => ({ x: D(t.date), y: U.hhmmToMin(t.sleep.wakeTime), ref: { ticketId: t.id }, tip: esc(U.fmtDateShort(t.date)) + ': woke <strong>' + esc(t.sleep.wakeTime) + '</strong>' }));
      Charts.render(host, {
        series: [
          { id: 'bed', label: 'Fell asleep', color: '#8b7cf6', points: bed },
          { id: 'wake', label: 'Woke up', color: '#e0913a', points: wake }
        ], type: 'scatter', xType: 'date', yLabel: 'time of day', height: 180,
        yDomain: [0, 1440], yTicks: CLOCK_TICKS, yFormat: fmtClock,
        empty: 'No sleep/wake times recorded in this range.',
        onPoint: (r) => r.ticketId && Editor.open(r.ticketId)
      });
    } else if (l.key === 'traindur') {
      const pts = sessions.filter((s) => s.durationMin != null)
        .map((s) => ({
          x: D(s.date), y: s.durationMin, ref: { ticketId: s.ticketId },
          tip: esc(U.fmtDateShort(s.date)) + (s.startTime ? ' @ ' + esc(s.startTime) : '') + '<br>' +
            esc((Store.modeById(s.modeId) || {}).name || 'session') + ': <strong>' + U.fmtDuration(s.durationMin) + '</strong>'
        }));
      Charts.render(host, seriesCfg('Duration (min)', 'scatter', pts, '#e0913a', 180, 'No session durations recorded yet.', b));
    } else if (l.key === 'trainfreq') {
      const byDate = {};
      sessions.forEach((s) => { byDate[s.date] = (byDate[s.date] || 0) + 1; });
      const pts = Object.keys(byDate).sort().map((d) => ({
        x: D(d), y: byDate[d], ref: { ticketId: (Store.state.tickets.find((t) => t.date === d) || {}).id },
        tip: esc(U.fmtDateShort(d)) + ': <strong>' + byDate[d] + ' session(s)</strong>'
      }));
      Charts.render(host, seriesCfg('Sessions/day', 'bar', pts, '#4f7cff', 180, 'No sessions in this range.', b));
    } else if (l.key === 'timeofday') {
      const pts = sessions.filter((s) => s.startTime)
        .map((s) => ({
          x: D(s.date), y: U.hhmmToMin(s.startTime), ref: { ticketId: s.ticketId },
          tip: esc(U.fmtDateShort(s.date)) + ': started <strong>' + esc(s.startTime) + '</strong><br>' + esc((Store.modeById(s.modeId) || {}).name || '')
        }));
      Charts.render(host, {
        series: [{ id: 'start', label: 'Start time', color: '#d6459e', points: pts }],
        type: 'scatter', xType: 'date', yLabel: 'start time', height: 180,
        yDomain: [0, 1440], yTicks: CLOCK_TICKS, yFormat: fmtClock,
        empty: 'No session start times recorded in this range.',
        onPoint: (r) => r.ticketId && Editor.open(r.ticketId)
      });
    }
  }

  function seriesCfg(label, type, pts, color, height, empty) {
    return {
      series: [{ id: 's', label, color, points: pts }],
      type, xType: 'date', yLabel: label, height, empty,
      onPoint: (r) => r && r.ticketId && Editor.open(r.ticketId)
    };
  }

  /* ---------- per-workout drawing: one graph per workout type ---------- */

  function drawWorkouts(wrap) {
    const hosts = wrap.querySelectorAll('[data-workout]');
    if (!hosts.length) return;
    const b = bounds();
    const tickets = Store.ticketsInRange(b.from, b.to);
    hosts.forEach((host, i) => {
      const key = host.getAttribute('data-workout');
      const pts = tickets
        .filter((t) => {
          const pa = t.pa || {};
          return pa.dailyMinutes != null && String(pa.type || '').trim().toLowerCase() === key;
        })
        .map((t) => ({
          x: U.toMs(t.date), y: t.pa.dailyMinutes, ref: { ticketId: t.id },
          tip: esc(U.fmtDateShort(t.date)) + ': <strong>' + t.pa.dailyMinutes + ' min</strong>' +
            (t.pa.intensity ? '<br>intensity: ' + esc(t.pa.intensity) : '')
        }));
      Charts.render(host, seriesCfg('Minutes', 'line', pts,
        WORKOUT_COLORS[i % WORKOUT_COLORS.length], 180,
        'No minutes recorded in this range.', b));
    });
  }

  /* ---------- association overlay ---------- */

  function drawAssociation(wrap) {
    const host = wrap.querySelector('[data-chart="assoc"]');
    const metric = Store.metricById(cfg.metricId);
    const life = LIFE.find((l) => l.key === cfg.lifeMetric);
    if (!metric || !life) { host.innerHTML = ''; return; }
    const b = bounds();
    const rows = Store.queryObservations({ metricId: metric.id, from: b.from, to: b.to }).filter((r) => U.toNum(r.obs.value) != null);
    const perfPts = rows.map((r) => ({
      x: U.toMs(r.session.date), y: U.toNum(r.obs.value), ref: { ticketId: r.ticket ? r.ticket.id : null },
      tip: esc(metric.name) + ': <strong>' + esc(String(r.obs.value)) + '</strong> · ' + esc(U.fmtDateShort(r.session.date))
    }));
    const tickets = Store.ticketsInRange(b.from, b.to);
    let lifePts = [];
    if (cfg.lifeMetric === 'sleep') {
      lifePts = tickets.filter((t) => (t.sleep || {}).durationMin != null)
        .map((t) => ({ x: U.toMs(t.date), y: t.sleep.durationMin / 60, ref: { ticketId: t.id }, tip: 'sleep <strong>' + U.fmtDuration(t.sleep.durationMin) + '</strong> · ' + esc(U.fmtDateShort(t.date)) }));
    } else if (cfg.lifeMetric === 'traindur') {
      const sessions = Store.state.sessions.filter((s) => s.durationMin != null && (!b.from || s.date >= b.from) && (!b.to || s.date <= b.to));
      const byDate = {};
      sessions.forEach((s) => { byDate[s.date] = (byDate[s.date] || 0) + s.durationMin; });
      lifePts = Object.keys(byDate).map((d) => ({ x: U.toMs(d), y: byDate[d], ref: { ticketId: (Store.state.tickets.find((t) => t.date === d) || {}).id }, tip: 'training <strong>' + U.fmtDuration(byDate[d]) + '</strong> · ' + esc(U.fmtDateShort(d)) }));
    } else if (cfg.lifeMetric === 'trainfreq') {
      const sessions = Store.state.sessions.filter((s) => (!b.from || s.date >= b.from) && (!b.to || s.date <= b.to));
      const byDate = {};
      sessions.forEach((s) => { byDate[s.date] = (byDate[s.date] || 0) + 1; });
      lifePts = Object.keys(byDate).map((d) => ({ x: U.toMs(d), y: byDate[d], ref: { ticketId: (Store.state.tickets.find((t) => t.date === d) || {}).id }, tip: '<strong>' + byDate[d] + '</strong> session(s) · ' + esc(U.fmtDateShort(d)) }));
    }
    if (!perfPts.length || !lifePts.length) {
      host.innerHTML = '';
      host.appendChild(el('<div class="chart-empty">Need both ' + esc(metric.name) + ' observations and ' + esc(life.label.toLowerCase()) + ' records in this range.</div>'));
      return;
    }
    const lifeVals = lifePts.map((p) => p.y);
    Charts.render(host, {
      series: [
        { id: 'perf', label: metric.name, color: '#4f7cff', points: perfPts },
        { id: 'life', label: life.label, color: '#2aa18f', points: lifePts }
      ],
      type: 'scatter', xType: 'date',
      yLabel: metric.name + (metric.unit ? ' (' + metric.unit + ')' : ''),
      dual: { seriesId: 'life', label: life.label, domain: [Math.min.apply(null, lifeVals), Math.max.apply(null, lifeVals)], format: (v) => U.fmtNum(v, 0) },
      height: 300,
      empty: 'Not enough overlapping data yet.',
      onPoint: (r) => r && r.ticketId && Editor.open(r.ticketId)
    });
  }

  /* ---------- timeline ---------- */

  function drawTimeline(wrap) {
    const host = wrap.querySelector('[data-timeline]');
    if (!host) return;
    const items = Store.state.assessments.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!items.length) return;
    const trainDates = Store.state.sessions.map((s) => s.date).filter(Boolean).sort();
    const from = U.addDays(items[0].date, -7);
    const to = U.addDays(items[items.length - 1].date, 7);
    Charts.timeline(host, {
      from, to,
      bands: trainDates.length ? [{ from: trainDates[0], to: trainDates[trainDates.length - 1], label: 'training period', color: '#e8ecff' }] : [],
      markers: items.map((a) => ({
        date: a.date,
        label: (a.kind === 'baseline' ? 'Baseline: ' : 'Follow-up: ') + (a.testName || 'test') + ' · ' + (a.overallScore == null ? '—' : a.overallScore),
        color: a.kind === 'baseline' ? '#4f7cff' : '#e0913a'
      }))
    });
  }

  /* ---------- binding ---------- */

  function bind(wrap, host) {
    wrap.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { cfg.range = b.dataset.range; refresh(host); }));
    const from = wrap.querySelector('[data-f="from"]');
    if (from) from.addEventListener('change', () => { cfg.from = from.value; refresh(host); });
    const to = wrap.querySelector('[data-f="to"]');
    if (to) to.addEventListener('change', () => { cfg.to = to.value; refresh(host); });
    const mSel = wrap.querySelector('[data-f="metric"]');
    if (mSel) mSel.addEventListener('change', () => { cfg.metricId = mSel.value; cfg.versionFilter = null; refresh(wrap); });
    const connect = wrap.querySelector('[data-f="connect"]');
    if (connect) connect.addEventListener('change', () => { cfg.connect = connect.checked; refresh(wrap); });
    const trend = wrap.querySelector('[data-f="trend"]');
    if (trend) trend.addEventListener('change', () => { cfg.trend = trend.checked; refresh(wrap); });
    wrap.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.mode;
      if (id === '__all') cfg.modeIds = [];
      else {
        const i = cfg.modeIds.indexOf(id);
        if (i >= 0) cfg.modeIds.splice(i, 1);
        else cfg.modeIds.push(id);
        if (cfg.modeIds.length === Store.state.modes.filter((m) => !m.archived).length) cfg.modeIds = [];
      }
      refresh(wrap);
    }));
    const am = wrap.querySelector('[data-f="assoc-metric"]');
    if (am) am.addEventListener('change', () => { cfg.metricId = am.value; refresh(wrap); });
    const al = wrap.querySelector('[data-f="assoc-life"]');
    if (al) al.addEventListener('change', () => { cfg.lifeMetric = al.value; refresh(wrap); });
  }

  function refresh(target) {
    const container = document.getElementById('view');
    void target;
    container.innerHTML = '';
    render(container);
  }

  return { render, cfg };
})();
