/* WM Assessment Platform — Performance Analytics, Session History,
   Data Management, Methodology & Limitations (spec §9–§14).

   Registers the remaining four sections into ViewWM.sections. Every number shown here
   derives from persisted sessions; empty cells say "no data" instead of inventing a
   value, intervals only render where binomial counts allow them, and reliable change
   stays "unavailable" until a reliability estimate is supplied. */

(function () {
  'use strict';
  const { el, esc } = U;
  const V = window.ViewWM;
  const S = V.sections;
  const { panel, statCard, famChip, statusChip, barRows, noteBox, resultsTable, num, pctStr, go } = V;

  let anFilter = 'all';   // 'all' | 'A' | 'B' | 'C' | 'D'
  let histFilter = 'all'; // 'all' | 'completed' | 'in_progress' | 'incomplete'

  /* ================= 4 · Performance analytics ================= */

  S.analytics = function (host) {
    const done = WMStore.completedSessions().filter((s) => s.results);

    /* family filter */
    const filters = el('<div class="wm-filters"></div>');
    [['all', 'All families']].concat(
      Object.keys(WMTasks.FAMILIES).map((f) => [f, f + ' · ' + WMTasks.FAMILIES[f].short])
    ).forEach(([id, label]) => {
      const b = el('<button type="button" class="chip-btn' + (anFilter === id ? ' on' : '') + '"></button>');
      b.textContent = label;
      b.addEventListener('click', () => { anFilter = id; go('analytics'); });
      filters.appendChild(b);
    });
    host.appendChild(filters);

    if (!done.length) {
      const p = panel('Performance analytics',
        'Nothing to analyze yet — analytics start at the first completed assessment session.');
      host.appendChild(p.root);
      p.body.appendChild(el('<p class="hint">No completed sessions with results. Sessions that were ended early still appear in ' +
        'Session History and are listed as incomplete here — they are never averaged into completed-session trends.</p>'));
      p.body.appendChild(el('<div class="btn-row"><button class="btn primary" data-act="start">Start an assessment</button></div>'));
      p.body.querySelector('[data-act="start"]').addEventListener('click', () => WMRunner.startNew());
      return;
    }

    const scope = anFilter === 'all'
      ? Object.keys(WMTasks.FAMILIES).filter((f) => done.some((s) => s.results.families[f] && s.results.families[f].available))
      : [anFilter];
    const charts = [];   // deferred renders (host must be in the DOM first)

    /* ---- trajectories ---- */
    const traj = WMAnalytics.trajectories(done);
    const tp = panel('Accuracy trajectories',
      'One line per family, x = session completion date. Hover for session number, config version, and ' +
      '95% Wilson interval; click a point to open that session in History.');
    host.appendChild(tp.root);
    const trajHost = el('<div class="chart-host" data-chart></div>');
    tp.body.appendChild(trajHost);
    charts.push(() => Charts.render(trajHost, Object.assign(
      WMAnalytics.trajectoryChart(traj, { onlyFamily: anFilter === 'all' ? null : anFilter }),
      { onPoint: (ref) => focusHistory(ref && ref.sessionId) }
    )));

    /* ---- change interpretation ---- */
    const cp = panel('Change across sessions — observed, reliable, generalization',
      'Three distinct concepts, kept distinct (spec §9). Nothing here is labelled a change in latent ability.');
    host.appendChild(cp.root);
    const changeGrid = el('<div class="wm-grid-2"></div>');
    scope.forEach((f) => {
      const meta = WMTasks.FAMILIES[f];
      const obs = WMAnalytics.observedChange(traj, f);
      const rci = WMAnalytics.reliableChange(f);
      const card = el('<div class="wm-mini"><div class="wm-mini-head">' + famChip(f) + '</div>');
      if (obs.available) {
        card.appendChild(el('<div class="wm-kv"><span>Observed change</span><strong>' +
          pctStr(obs.first.y) + ' → ' + pctStr(obs.last.y) + ' (' + (obs.diff >= 0 ? '+' : '') + obs.diff + ' pts)</strong></div>' +
          '<div class="hint">across ' + obs.elapsedDays + ' day(s), sessions ' + obs.first.number + ' → ' + obs.last.number +
          ' · ' + obs.label + '</div>'));
      } else {
        card.appendChild(el('<div class="wm-kv"><span>Observed change</span><strong>unavailable</strong></div>' +
          '<div class="hint">' + esc(obs.reason) + '</div>'));
      }
      if (rci.available) {
        card.appendChild(el('<div class="wm-kv"><span>Reliable change (RCI)</span><strong>' +
          (rci.reliable ? 'yes' : 'no') + '</strong></div>' +
          '<div class="hint">z = ' + num(rci.z, 2) + ' · SEM = ' + num(rci.sem, 2) + ' · ' + esc(rci.formula) +
          '<br>' + esc(rci.assumptions) + '</div>'));
      } else {
        card.appendChild(el('<div class="wm-kv"><span>Reliable change (RCI)</span><strong class="muted">unavailable</strong></div>' +
          '<div class="hint">' + esc(rci.reason) + (rci.needReliability ? ' Setting → Assessment settings.' : '') + '</div>'));
      }
      const rel = ((WMStore.getSettings().reliability || {})[f]);
      card.appendChild(el('<div class="hint">reliability r = ' + (rel != null ? num(rel, 2) : 'not supplied') +
        (scope.length ? '' : '') + '</div>'));
      changeGrid.appendChild(card);
    });
    cp.body.appendChild(changeGrid);
    cp.body.appendChild(el('<div class="wm-mini"><div class="wm-mini-head"><strong>Generalization</strong></div>' +
      '<div class="hint">' + esc(WMAnalytics.changeLabels()[2].v) + '</div></div>'));
    cp.body.appendChild(noteBox('warn', '<strong>Not latent-capacity change:</strong> ' + esc(WMAnalytics.capacityDisclaimer())));

    /* ---- accuracy by difficulty ---- */
    const dp = panel('Accuracy by difficulty level',
      'Pooled across completed sessions, per family. Difficulty labels are family-specific — ' +
      'a “high” in family A is not the same task demand as a “high” in family C.');
    host.appendChild(dp.root);
    const dGrid = el('<div class="wm-grid-2"></div>');
    scope.forEach((f) => {
      const rows = WMAnalytics.byDifficulty(f, done);
      const box = el('<div class="wm-mini"><div class="wm-mini-head">' + famChip(f) + '</div></div>');
      box.appendChild(barRows(rows.map((r) => ({
        label: r.label,
        pct: r.pct == null ? 0 : r.pct,
        valueLabel: (r.pct == null ? '—' : pctStr(r.pct)) + ' · n=' + r.n,
        tip: r.ci ? '95% CI ' + (Math.round(r.ci[0] * 1000) / 10) + '–' + (Math.round(r.ci[1] * 1000) / 10) + '%' : '',
        color: (WMTasks.FAMILIES[f] || {}).color
      })), { empty: 'No ' + f + ' trials in completed sessions yet.' }));
      dGrid.appendChild(box);
    });
    dp.body.appendChild(dGrid);
    dp.body.appendChild(noteBox('', esc(WMAnalytics.ciNote())));

    /* ---- accuracy by load ---- */
    const lp = panel('Accuracy by memory load',
      'Memory load is the task-specific item count for that difficulty (see Task configuration). ' +
      'Loads present in the data only.');
    host.appendChild(lp.root);
    const lGrid = el('<div class="wm-grid-2"></div>');
    scope.forEach((f) => {
      const rows = WMAnalytics.byLoad(f, done);
      const box = el('<div class="wm-mini"><div class="wm-mini-head">' + famChip(f) + '</div></div>');
      box.appendChild(barRows(rows.map((r) => ({
        label: r.load == null ? 'unrecorded' : 'Load ' + r.load,
        pct: r.pct == null ? 0 : r.pct,
        valueLabel: (r.pct == null ? '—' : pctStr(r.pct)) + ' · n=' + r.n,
        tip: r.ci ? '95% CI ' + (Math.round(r.ci[0] * 1000) / 10) + '–' + (Math.round(r.ci[1] * 1000) / 10) + '%' : '',
        color: (WMTasks.FAMILIES[f] || {}).color
      })), { empty: 'No load data yet.' }));
      lGrid.appendChild(box);
    });
    lp.body.appendChild(lGrid);

    /* ---- RT trends ---- */
    const rp = panel('Response-time trends',
      'Median RT per session (line) and pooled median RT per difficulty level (table). ' +
      'RT is recorded for every response, including self-paced recall — treat browser RT as approximate.');
    host.appendChild(rp.root);
    const rtSeries = scope.map((f) => ({
      id: f, label: (WMTasks.FAMILIES[f] || {}).short, color: (WMTasks.FAMILIES[f] || {}).color,
      points: WMAnalytics.rtTrend(f, done).map((p) => ({
        x: p.x, y: p.y, ref: p,
        tip: (WMTasks.FAMILIES[f] || {}).short + ' · session ' + p.number + ' (' + p.date + ')<br>median ' +
          p.y + ' ms · SD ' + (p.sd == null ? '—' : p.sd) + ' ms · ' + p.trials + ' trials'
      }))
    })).filter((s) => s.points.length);
    const rtHost = el('<div class="chart-host" data-chart></div>');
    rp.body.appendChild(rtHost);
    charts.push(() => Charts.render(rtHost, {
      series: rtSeries, type: 'line', xType: 'date', yLabel: 'Median RT (ms)', height: 240,
      empty: 'No response times recorded in completed sessions yet.'
    }));

    const rtTable = el('<table class="cmp-table wm-table"><thead><tr><th>Family</th><th>Difficulty</th><th>Median RT</th><th>Trials</th></tr></thead><tbody></tbody></table>');
    scope.forEach((f) => {
      WMAnalytics.rtByDifficulty(f, done).forEach((r) => {
        rtTable.querySelector('tbody').appendChild(el('<tr><td>' + famChip(f) + '</td><td>' + esc(r.label) + '</td>' +
          '<td>' + num(r.median) + ' ms</td><td>' + r.n + '</td></tr>'));
      });
    });
    if (rtTable.querySelector('tbody').children.length) rp.body.appendChild(rtTable);

    /* ---- error distributions ---- */
    const ep = panel('Error distributions',
      'Every scored, completed trial is classified. Unclassified/timeout rows are shown, not hidden.');
    host.appendChild(ep.root);
    const eGrid = el('<div class="wm-grid-2"></div>');
    scope.forEach((f) => {
      const rows = WMAnalytics.errorDistribution(f, done);
      const total = rows.reduce((s, r) => s + r.n, 0);
      const box = el('<div class="wm-mini"><div class="wm-mini-head">' + famChip(f) +
        '<span class="hint">' + total + ' scored trials</span></div></div>');
      box.appendChild(barRows(rows.map((r) => ({
        label: r.label,
        pct: total ? Math.round((r.n / total) * 1000) / 10 : 0,
        valueLabel: r.n + ' trial' + (r.n === 1 ? '' : 's'),
        tip: r.key === 'correct' ? 'Correct responses' : 'error class: ' + r.key
      })), { empty: 'No scored trials for this family yet.' }));
      eGrid.appendChild(box);
    });
    ep.body.appendChild(eGrid);

    /* ---- signal detection (families that produce target/non-target decisions) ---- */
    const sdFams = scope.filter((f) => done.some((s) => s.results.families[f] && s.results.families[f].signalDetection));
    if (sdFams.length) {
      const sp = panel('Signal detection (d′)',
        'For families that make target/non-target decisions (updating streams, recognition probes). ' +
        'Hit and false-alarm rates use the loglinear correction (k+0.5)/(n+1) so extreme cells stay finite — ' +
        'the correction is reported with every value.');
      host.appendChild(sp.root);
      const sdSeries = sdFams.map((f) => ({
        id: f, label: (WMTasks.FAMILIES[f] || {}).short, color: (WMTasks.FAMILIES[f] || {}).color,
        points: WMAnalytics.signalDetectionTrend(f, done).map((p) => ({
          x: p.x, y: p.y, ref: p,
          tip: (WMTasks.FAMILIES[f] || {}).short + ' · session ' + p.number + '<br>d′ = ' + num(p.y, 2) +
            '<br>hits ' + p.sd.hits + ' · misses ' + p.sd.misses + ' · FA ' + p.sd.falseAlarms + ' · CR ' + p.sd.correctRejections
        }))
      })).filter((s) => s.points.length);
      const sdHost = el('<div class="chart-host" data-chart></div>');
      sp.body.appendChild(sdHost);
      charts.push(() => Charts.render(sdHost, {
        series: sdSeries, type: 'line', xType: 'date', yLabel: 'd′', height: 220,
        empty: 'No signal-detection trials completed yet.'
      }));
    }

    /* ---- complex span: storage vs processing ---- */
    if (scope.indexOf('D') >= 0) {
      const span = WMAnalytics.spanTrends(done);
      if (span.storage.length || span.processing.length) {
        const cp2 = panel('Complex span — storage and processing (separate)',
          'Family D reports recall accuracy and processing accuracy as two distinct measures. ' +
          'They are never merged into one span score.');
        host.appendChild(cp2.root);
        const spanHost = el('<div class="chart-host" data-chart></div>');
        cp2.body.appendChild(spanHost);
        charts.push(() => Charts.render(spanHost, {
          series: [
            { id: 'storage', label: 'Storage (recall)', color: '#8b7cf6', points: span.storage.map((p) => ({ x: p.x, y: p.y, ref: p, tip: 'session ' + p.number + '<br>recall ' + p.y + '%' })) },
            { id: 'processing', label: 'Processing', color: '#2aa18f', points: span.processing.map((p) => ({ x: p.x, y: p.y, ref: p, tip: 'session ' + p.number + '<br>processing ' + p.y + '%' })) }
          ].filter((s) => s.points.length),
          type: 'line', xType: 'date', yLabel: 'Accuracy (%)', yDomain: [0, 100],
          yFormat: (v) => Math.round(v) + '%', height: 220,
          empty: 'No completed family-D sessions yet.'
        }));
      }
    }

    /* ---- interruptions & timing ---- */
    const hist = WMAnalytics.interruptionHistory();
    const iq = WMAnalytics.timingQuality();
    const ip = panel('Interruptions & timing quality',
      'Recorded, not smoothed over: pauses, tab visibility loss, and schedule drift beyond 80 ms.');
    host.appendChild(ip.root);
    const iStrip = el('<div class="stat-strip wm-stats"></div>');
    iStrip.appendChild(statCard('Timing deviations', String(iq.deviations), 'across sessions'));
    iStrip.appendChild(statCard('Trials with flags', iq.trialsFlagged + ' / ' + iq.trialsTimed, 'scored trials measured'));
    iStrip.appendChild(statCard('Ended early', String(done.length ? WMStore.state.sessions.filter((s) => s.status === 'incomplete').length : 0), 'never counted as completed'));
    ip.body.appendChild(iStrip);
    if (!hist.length) {
      ip.body.appendChild(el('<p class="hint">No interruptions, timing deviations, or unfinished sessions recorded.</p>'));
    } else {
      const t = el('<table class="cmp-table wm-table"><thead><tr><th>Session</th><th>Date</th><th>Status</th>' +
        '<th>Deviations</th><th>Interruptions</th><th>Note</th></tr></thead><tbody></tbody></table>');
      hist.forEach((r) => {
        t.querySelector('tbody').appendChild(el('<tr><td>#' + r.session.number + '</td><td>' + esc(r.session.date) + '</td>' +
          '<td>' + statusChip(r.status) + '</td><td>' + r.timingDeviations + '</td><td>' + r.interruptions.length + '</td>' +
          '<td>' + esc(r.note || r.interruptions.map((i) => (i.reason || '') + ' @ ' + (i.at || '')).join('; ')) + '</td></tr>'));
      });
      ip.body.appendChild(t);
    }

    /* ---- config-change warnings ---- */
    const cw = WMAnalytics.configWarnings(done);
    const wp = panel('Configuration-change warnings',
      'Sessions are grouped by identical configuration. Cross-version comparisons are possible but flagged — ' +
      'never silently merged.');
    host.appendChild(wp.root);
    if (!cw.length) {
      wp.body.appendChild(el('<p class="hint">All completed sessions ran under the current configuration — no warnings.</p>'));
    } else {
      cw.forEach((w) => wp.body.appendChild(noteBox('warn', esc(w.note))));
    }
    const runs = WMAnalytics.comparableRuns(done);
    if (runs.length > 1) {
      const runTable = el('<table class="cmp-table wm-table"><thead><tr><th>Run</th><th>Config</th><th>Sessions</th></tr></thead><tbody></tbody></table>');
      runs.forEach((r, i) => {
        runTable.querySelector('tbody').appendChild(el('<tr><td>' + (i + 1) + '</td><td>v' + r.configVersion + '</td>' +
          '<td>' + r.sessions.map((s) => '#' + s.number).join(', ') + '</td></tr>'));
      });
      wp.body.appendChild(runTable);
    }

    /* deferred chart rendering — hosts are in the DOM now */
    charts.forEach((fn) => { try { fn(); } catch (e) { console.error('[WM] chart render', e); } });
  };

  function focusHistory(sessionId) {
    lastHistoryFocus = sessionId;
    go('history');
  }
  let lastHistoryFocus = null;

  /* ================= 5 · Session history ================= */

  S.history = function (host) {
    const all = WMStore.sortedSessions(true).slice().reverse();

    /* filters */
    const filters = el('<div class="wm-filters"></div>');
    [['all', 'All'], ['completed', 'Completed'], ['in_progress', 'Open'], ['incomplete', 'Ended early']].forEach(([id, label]) => {
      const b = el('<button type="button" class="chip-btn' + (histFilter === id ? ' on' : '') + '"></button>');
      b.textContent = label;
      b.addEventListener('click', () => { histFilter = id; go('history'); });
      filters.appendChild(b);
    });
    host.appendChild(filters);

    const p = panel('Session history',
      'Answer keys, seeds, and stimulus parameters are inspectable here — after the session, never during scored trials.');
    host.appendChild(p.root);

    const list = all.filter((s) => histFilter === 'all' || s.status === histFilter);
    if (!list.length) {
      p.body.appendChild(el('<p class="hint">No sessions match this filter yet.</p>'));
      return;
    }

    list.forEach((s) => p.body.appendChild(sessionCard(s)));

    if (lastHistoryFocus) {
      const node = Array.prototype.find.call(
        p.body.querySelectorAll('[data-sess]'),
        (x) => x.dataset.sess === lastHistoryFocus
      );
      lastHistoryFocus = null;
      if (node) {
        node.classList.add('focus');
        node.scrollIntoView({ block: 'center' });
        const btn = node.querySelector('[data-act="details"]');
        if (btn && btn.getAttribute('aria-expanded') === 'false') btn.click();
      }
    }
  };

  function sessionCard(s) {
    const fams = Object.keys(s.config.families).filter((f) => s.config.families[f]);
    const card = el('<article class="wm-sess' + (s.status === 'completed' ? ' done' : s.status === 'in_progress' ? ' open' : ' partial') +
      '" data-sess="' + esc(s.id) + '">' +
      '<header class="wm-sess-head">' +
      '<div class="wm-sess-title"><strong>Session #' + s.number + '</strong> <span class="muted">' + esc(s.date) + '</span></div>' +
      '<div class="wm-sess-chips">' + statusChip(s.status) + ' ' + fams.map((f) => famChip(f)).join(' ') + '</div>' +
      '</header>' +
      '<div class="wm-sess-meta">' +
      '<span>' + (s.trialsCompleted || 0) + ' / ' + (s.trialsPlanned || 0) + ' trials</span>' +
      '<span>config v' + s.configVersion + '</span>' +
      '<span>seed <code>' + esc(s.seedHex || '—') + '</code></span>' +
      '<span>gen ' + esc(s.generatorVersion || '—') + '</span>' +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn tiny" data-act="details" aria-expanded="false">Details</button>' +
      '<button class="btn tiny" data-act="trials" aria-expanded="false">Trials' +
      (WMStore.getSettings().devMode ? ' (dev view)' : '') + '</button>' +
      (s.status === 'in_progress' ? '<button class="btn tiny primary" data-act="resume">Resume</button>' : '') +
      '<button class="btn tiny danger" data-act="delete">Delete…</button>' +
      '</div>' +
      '<div class="wm-sess-body" data-details hidden></div>' +
      '<div class="wm-sess-body" data-trials hidden></div>' +
      '</article>');

    card.querySelector('[data-act="details"]').addEventListener('click', (e) => {
      togglePane(card, 'details', e.currentTarget, () => renderDetails(card.querySelector('[data-details]'), s));
    });
    card.querySelector('[data-act="trials"]').addEventListener('click', (e) => {
      togglePane(card, 'trials', e.currentTarget, () => renderTrials(card.querySelector('[data-trials]'), s));
    });
    const res = card.querySelector('[data-act="resume"]');
    if (res) res.addEventListener('click', () => WMRunner.resume());
    card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Delete session #' + s.number + '?',
        message: 'Removes the session, its blocks, and all ' + (s.trialsPlanned || 0) + ' trials (including its seed). ' +
          'Other sessions keep their own seeds and stay reproducible. Export first if you want a copy.',
        okLabel: 'Delete session'
      });
      if (!ok) return;
      await WMStore.deleteSession(s.id);
      UI.toast('Session #' + s.number + ' deleted.');
    });
    return card;
  }

  function togglePane(card, name, btn, build) {
    const pane = card.querySelector('[data-' + name + ']');
    const open = !pane.hidden;
    if (open) {
      pane.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    } else {
      build();
      pane.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function renderDetails(pane, s) {
    pane.innerHTML = '';
    /* stats */
    const strip = el('<div class="stat-strip wm-stats"></div>');
    strip.appendChild(statCard('Started', U.fmtDateTime(s.startedAt), s.completedAt ? 'completed ' + U.fmtDateTime(s.completedAt) : 'not completed'));
    strip.appendChild(statCard('Trials', (s.trialsCompleted || 0) + ' / ' + (s.trialsPlanned || 0), (s.blocksCount || 0) + ' blocks'));
    strip.appendChild(statCard('Interruptions', String((s.interruptions || []).length), (s.timingDeviations || 0) + ' timing deviations'));
    strip.appendChild(statCard('Blueprint', s.blueprintIntended ? 'recorded' : '—',
      s.blueprintRealized ? 'delivered over ' + s.blueprintRealized.n + ' scheduled units' : 'no realized counts'));
    pane.appendChild(strip);

    /* blueprint intended vs realized */
    if (s.blueprintIntended && s.blueprintRealized) {
      const t = el('<table class="cmp-table wm-table"><thead><tr><th>Difficulty</th><th>Intended</th><th>Delivered</th><th>Trials</th></tr></thead><tbody></tbody></table>');
      WMBlueprint.LEVELS.forEach((l) => {
        t.querySelector('tbody').appendChild(el('<tr><td>' + esc(WMBlueprint.LEVEL_LABEL[l]) + '</td>' +
          '<td>' + s.blueprintIntended[l] + '%</td><td>' + (s.blueprintRealized.pct[l] || 0) + '%</td>' +
          '<td>' + s.blueprintRealized.counts[l] + '</td></tr>'));
      });
      pane.appendChild(el('<h3 class="wm-h3">Difficulty blueprint: intended vs delivered</h3>'));
      pane.appendChild(t);
      const driftNotes = WMBlueprint.drift(s);
      if (driftNotes.length) {
        pane.appendChild(noteBox('warn', 'Largest-remainder rounding delivered: ' + esc(driftNotes.join(' · '))));
      }
    }

    /* config changes */
    pane.appendChild(el('<h3 class="wm-h3">Configuration</h3>'));
    if ((s.configChangesVsPrev || []).length) {
      const t = el('<table class="cmp-table wm-table"><thead><tr><th>Field</th><th>Previous</th><th>This session</th></tr></thead><tbody></tbody></table>');
      s.configChangesVsPrev.forEach((c) => {
        t.querySelector('tbody').appendChild(el('<tr><td><code>' + esc(c.field) + '</code></td><td>' +
          esc(String(c.from)) + '</td><td>' + esc(String(c.to)) + '</td></tr>'));
      });
      pane.appendChild(t);
    } else {
      pane.appendChild(el('<p class="hint">Same material configuration as the previous session (or first session under this configuration).</p>'));
    }
    const fams = Object.keys(s.config.families).filter((f) => s.config.families[f]);
    pane.appendChild(el('<p class="hint">' + esc(fams.map((f) => f + ' · ' + s.config.variants[f] +
      (f === 'B' ? ' (' + s.config.modality.B + ')' : '')).join(' · ')) +
      '<br>timing: stimulus ' + s.config.timing.stimulusMs + ' · ISI ' + s.config.timing.isiMs +
      ' · retention ' + s.config.timing.retentionMs + ' · window ' + s.config.timing.responseMs +
      ' · ITI ' + s.config.timing.itiMs + ' ms</p>'));

    /* interruptions detail */
    if ((s.interruptions || []).length) {
      pane.appendChild(el('<h3 class="wm-h3">Interruptions</h3>'));
      const t = el('<table class="cmp-table wm-table"><thead><tr><th>At</th><th>Reason</th></tr></thead><tbody></tbody></table>');
      s.interruptions.forEach((i) => {
        t.querySelector('tbody').appendChild(el('<tr><td>' + esc(U.fmtDateTime(i.at)) + '</td><td>' + esc(i.reason || '—') + '</td></tr>'));
      });
      pane.appendChild(t);
    }

    /* results */
    if (s.results) {
      pane.appendChild(el('<h3 class="wm-h3">Scores (' + (s.results.complete ? 'completed session' : 'partial — ended early') + ')</h3>'));
      pane.appendChild(resultsTable(s.results));
      if (s.results.provisionalComposite != null) {
        pane.appendChild(el('<p class="hint">Composite shown because “Show provisional composite” is enabled — ' +
          'exploratory equal-weight mean, not a validated working-memory score.</p>'));
      }
    } else if (s.status === 'in_progress') {
      pane.appendChild(noteBox('', 'This session has not been scored yet — scoring happens when it is completed or ended early.'));
    }
  }

  function renderTrials(pane, s) {
    pane.innerHTML = '';
    const dev = !!WMStore.getSettings().devMode;
    const trials = WMStore.sessionTrials(s.id)
      .slice()
      .sort((a, b) => (a.phase === b.phase ? (a.trialIndex || 0) - (b.trialIndex || 0) : (a.phase === 'scored' ? -1 : 1)));
    if (!trials.length) {
      pane.appendChild(el('<p class="hint">No trials stored for this session.</p>'));
      return;
    }
    const famCol = '<th>Family / variant</th><th>Kind</th><th>Difficulty</th><th>Load</th>';
    const t = el('<table class="cmp-table wm-table wm-trials"><thead><tr>' +
      '<th>#</th>' + famCol + '<th>Phase</th><th>Stimulus</th><th>Correct</th><th>Response</th>' +
      '<th>RT (ms)</th><th>Result</th><th>Error class</th>' +
      (dev ? '<th>Seed</th><th>Params</th>' : '') +
      '</tr></thead><tbody></tbody></table>');
    const tb = t.querySelector('tbody');
    trials.forEach((tr) => {
      const stim = tr.stimulus ? JSON.stringify(tr.stimulus) : '—';
      const row = el('<tr class="' + (tr.phase === 'familiarization' ? 'fam' : '') + '">' +
        '<td>' + (tr.phase === 'familiarization' ? 'practice' : (tr.trialIndex + 1)) + '</td>' +
        '<td>' + esc(tr.family + ' · ' + tr.variant) + '</td>' +
        '<td>' + esc(tr.kind || '—') + '</td>' +
        '<td>' + esc(tr.difficulty || '—') + '</td>' +
        '<td>' + esc(tr.memoryLoad == null ? '—' : String(tr.memoryLoad)) + '</td>' +
        '<td>' + (tr.phase === 'familiarization' ? '<span class="wm-warn-text">familiarization</span>' : 'scored') + '</td>' +
        '<td class="stim" title="' + esc(stim) + '">' + esc(stim.length > 60 ? stim.slice(0, 57) + '…' : stim) + '</td>' +
        '<td class="key">' + esc(fmtResponse(tr.correctResponse)) + '</td>' +
        '<td>' + esc(fmtResponse(tr.userResponse)) + '</td>' +
        '<td>' + esc(tr.rtMs == null ? '—' : String(tr.rtMs)) + '</td>' +
        '<td>' + (tr.completedAt ? (tr.correct ? '✔' : '✘') : '<span class="muted">pending</span>') + '</td>' +
        '<td>' + esc(tr.errorClass || (tr.completedAt ? '' : '—')) +
        ((tr.timingFlags || []).length ? '<div class="hint">' + tr.timingFlags.length + ' timing flag(s)</div>' : '') + '</td>' +
        (dev ? '<td><code>' + esc(WMRng.seedToHex(tr.seed || 0)) + '</code></td>' +
          '<td class="hint">' + esc(JSON.stringify(tr.params || {})) + '</td>' : '') +
        '</tr>');
      tb.appendChild(row);
    });
    pane.appendChild(t);
    pane.appendChild(el('<p class="hint">' +
      (dev ? 'Dev mode: seeds and stimulus parameters are visible here (post-session only). '
        : 'Enable dev mode in Assessment settings to add seed + parameter columns. ') +
      'Familiarization rows are marked and excluded from every score and default export. ' +
      trials.length + ' trial record(s).</p>'));
  }

  function fmtResponse(v) {
    if (v == null) return '—';
    if (Array.isArray(v)) return v.join(' ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /* ================= 6 · Data management ================= */

  S.data = function (host) {
    const p = panel('Data management',
      'Everything is local: IndexedDB (or the localStorage fallback) on this device. No account, no server, no CDN.');
    host.appendChild(p.root);

    /* counts */
    const strip = el('<div class="stat-strip wm-stats"></div>');
    strip.appendChild(statCard('Sessions', String(WMStore.state.sessions.length),
      WMStore.completedSessions().length + ' completed'));
    strip.appendChild(statCard('Blocks', String(WMStore.state.blocks.length), 'task blocks'));
    strip.appendChild(statCard('Trials', String(WMStore.state.trials.length), 'trial-level records'));
    strip.appendChild(statCard('Config versions', String(WMStore.configVersions().length), 'configuration history'));
    strip.appendChild(statCard('Backend', DB.storageMode === 'idb' ? 'IndexedDB' : 'localStorage', 'survives refresh'));
    p.body.appendChild(strip);

    /* export */
    const ex = el('<div class="wm-cols"></div>');
    const exL = el('<div><h3 class="wm-h3">Export</h3><div class="btn-row">' +
      '<button class="btn" data-act="json">JSON (hierarchical)</button>' +
      '<button class="btn" data-act="csv-trials">CSV — trials</button>' +
      '<button class="btn" data-act="csv-sessions">CSV — sessions</button></div>' +
      '<p class="hint">JSON preserves session → blocks → trials with seeds, stimulus parameters, difficulty, load, ' +
      'responses, RT, omissions, error classes, generator + config version, completion status, and timing flags. ' +
      'CSV flattens trial records for analysis. Familiarization trials are excluded unless you opt in under Assessment settings. ' +
      'The full-site backup (Data &amp; Backup in the footer) also bundles WM data.</p></div>');
    ex.appendChild(exL);
    exL.querySelector('[data-act="json"]').addEventListener('click', () => { WMExport.exportJSON(); UI.toast('WM JSON exported.'); });
    exL.querySelector('[data-act="csv-trials"]').addEventListener('click', () => { WMExport.exportTrialsCSV(); UI.toast('Trials CSV exported.'); });
    exL.querySelector('[data-act="csv-sessions"]').addEventListener('click', () => { WMExport.exportSessionsCSV(); UI.toast('Sessions CSV exported.'); });

    /* import */
    const exR = el('<div><h3 class="wm-h3">Import (JSON)</h3>' +
      '<input type="file" accept=".json,application/json" data-import>' +
      '<p class="hint">Merge only: records whose id already exists are skipped, never overwritten — ' +
      'your local sessions always win. Reports exactly what was added.</p>' +
      '<div data-report></div></div>');
    ex.appendChild(exR);
    p.body.appendChild(ex);
    exR.querySelector('[data-import]').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const report = exR.querySelector('[data-report]');
      try {
        const text = await file.text();
        const res = await WMExport.importJSON(text);
        if (!res.ok) {
          report.innerHTML = '';
          report.appendChild(noteBox('warn', 'Import failed: ' + esc(res.error)));
          return;
        }
        report.innerHTML = '';
        report.appendChild(noteBox('', '<strong>Imported:</strong> ' + res.added.sessions + ' session(s), ' +
          res.added.blocks + ' block(s), ' + res.added.trials + ' trial(s); ' + res.added.skipped +
          ' existing session(s) skipped (not overwritten).'));
        UI.toast('WM import complete.');
      } catch (err) {
        report.innerHTML = '';
        report.appendChild(noteBox('warn', 'Could not read file: ' + esc(err.message)));
      }
      e.target.value = '';
    });

    /* scope note + destructive */
    const dz = el('<div class="wm-cols" style="margin-top:14px"><div>' +
      '<h3 class="wm-h3">Delete WM data</h3>' +
      '<div class="btn-row"><button class="btn danger" data-act="erase">Erase WM assessment data only…</button>' +
      '<button class="btn danger" data-act="erase-all">Erase everything (site-wide)…</button></div>' +
      '<p class="hint">Scoped erase removes only WM sessions/blocks/trials/config history and WM settings — ' +
      'your journal is untouched. Site-wide erase also removes journal data (both need confirmation).</p></div>' +
      '<div><h3 class="wm-h3">Privacy</h3><p class="hint">No data leaves this device: no accounts, no analytics, no network ' +
      'requests. Participant id is random and the label is yours to set. Journal profile fields marked sensitive are ' +
      'excluded from journal exports unless opted in; WM exports contain no personal fields beyond your label.</p></div></div>');
    p.body.appendChild(dz);
    dz.querySelector('[data-act="erase"]').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Erase WM assessment data?',
        messageHtml: 'Deletes all assessment sessions, blocks, trials, seeds, and configuration history for the WM Assessment Platform. ' +
          'Your journal (tickets, sessions, metrics) is untouched.<br><br><strong>This cannot be undone.</strong> Export first if unsure.',
        okLabel: 'Erase WM data'
      });
      if (!ok) return;
      await WMStore.deleteAllData();
      UI.toast('WM assessment data erased.');
    });
    dz.querySelector('[data-act="erase-all"]').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Erase ALL data (journal + WM)?',
        messageHtml: 'Deletes every journal record and every WM assessment record on this device, then restores the empty starter state.' +
          '<br><br><strong>This cannot be undone.</strong> Export a full backup first.',
        okLabel: 'Erase everything'
      });
      if (!ok) return;
      await Store.eraseAll();
      UI.toast('All data erased (journal + WM assessments).');
    });
  };

  /* ================= 8 · Methodology & limitations ================= */

  S.methodology = function (host) {
    /* families & rules */
    const fam = panel('The four task families',
      'Scored strictly per family. There is no validated global working-memory score in this app, so none is produced.');
    host.appendChild(fam.root);
    const t = el('<table class="cmp-table wm-table"><thead><tr><th>Family</th><th>Variants (rule)</th><th>Response</th></tr></thead><tbody></tbody></table>');
    Object.keys(WMTasks.FAMILIES).forEach((f) => {
      const meta = WMTasks.FAMILIES[f];
      t.querySelector('tbody').appendChild(el('<tr><td>' + famChip(f) + '<div class="hint">' + esc(meta.name) + '</div></td>' +
        '<td>' + meta.variants.map((v) => '<strong>' + esc(v.name) + '</strong> — ' + esc(v.rule)).join('<br>') + '</td>' +
        '<td>' + meta.variants.map((v) => esc(v.response)).join('<br>') + '</td></tr>'));
    });
    fam.body.appendChild(t);
    fam.body.appendChild(el('<p class="hint">Family C variants are not equivalent to a canonical N-back and are not ' +
      'interchangeable with family A/B tasks; each documents its own rule above. Family D keeps storage (recall) and ' +
      'processing (verification) scores separate at all times.</p>'));

    /* randomization */
    const rnd = panel('Procedural generation, seeds & audit trail',
      'Every session is procedurally generated from a stored seed so any form can be reconstructed exactly.');
    host.appendChild(rnd.root);
    rnd.body.appendChild(el('<ul class="wm-list">' +
      '<li><strong>PRNG:</strong> mulberry32, generator version <code>' + esc(WMRng.VERSION) + '</code>. Each session stores ' +
      'its seed (hex) and generator version; block streams are derived from the seed with a label, so forms replay exactly.</li>' +
      '<li><strong>Audit metadata:</strong> every trial records seed, derived parameters, item source (' +
      '<em>generated</em> vs <em>template</em> + template id), difficulty parameters, load, generator version, and config version.</li>' +
      '<li><strong>Constraint guards:</strong> no repeated items within a sequence, no straight-line runs on the grid, ' +
      'no alphabetical/digit runs or ABAB patterns in verbal lists, minimum item distance by difficulty band, ' +
      'balanced old/new and match/no-match answer status with no streaks ≥ 3, and no 3+ same-quadrant grids.</li>' +
      '<li><strong>Duplicate prevention:</strong> item-signature sets are seeded from persisted trials, so regenerated ' +
      'forms avoid sequences this participant has already seen.</li>' +
      '<li><strong>Novelty ≠ equivalent difficulty:</strong> a fresh random form is not guaranteed to be as hard as ' +
      'another fresh form — random forms differ. Fixed difficulty distributions reduce but cannot remove this.</li>' +
      '</ul>'));

    /* blueprint */
    const bp = panel('Difficulty blueprint (fixed, v1)',
      '25% low · ~33% moderate · 25% high · ~17% very high, split by deterministic largest-remainder rounding.');
    host.appendChild(bp.root);
    bp.body.appendChild(el('<ul class="wm-list">' +
      '<li>The distribution is <strong>fixed, not adaptive</strong> in v1: the same intended percentages every session, ' +
      'recorded as intended vs delivered per session (see Session History → Details).</li>' +
      '<li><strong>Difficulty is defined per family</strong> through task-specific variables (memory load, retention ' +
      'multiplier, interference, lure/distractor similarity, processing load). The same label is never equivalent ' +
      'across families — accuracy at “high” in family A and family C are different demands. The v1 mapping table lives ' +
      'in Task configuration.</li>' +
      '<li>The distribution is configurable (Task configuration) but stays percentage-based and deterministic.</li>' +
      '</ul>'));

    /* procedure */
    const pr = panel('Procedure & feedback policy', 'What happens during a session, and what never does.');
    host.appendChild(pr.root);
    pr.body.appendChild(el('<ul class="wm-list">' +
      '<li><strong>No correctness feedback during scored trials.</strong> Feedback appears only during familiarization ' +
      'practice, which is excluded from scores by default and excluded from default exports.</li>' +
      '<li>Settings are locked when a session starts; changing configuration afterwards creates a new version, and ' +
      'analytics flag cross-version comparisons instead of merging them silently.</li>' +
      '<li>Interrupted sessions are saved trial by trial and resumable at the exact stopping point; ending early records ' +
      'the session as <em>incomplete</em>, which is never counted as completed.</li>' +
      '<li>Scheduled waits are measured; drift beyond 80 ms is recorded on the trial and session. Pauses, tab-visibility ' +
      'loss, and manual ends are recorded as interruption events.</li>' +
      '</ul>'));

    /* scoring */
    const sc = panel('Scoring rules', 'Denominators, corrections, and what each number means.');
    host.appendChild(sc.root);
    sc.body.appendChild(el('<ul class="wm-list">' +
      '<li><strong>Denominator:</strong> scored, completed trials only. Familiarization trials and pending trials never ' +
      'contribute. Missing responses count as incorrect (timeouts are errors, not exclusions).</li>' +
      '<li><strong>Sequences:</strong> exact-sequence accuracy (all-or-nothing) and item-level accuracy (matching ' +
      'positions ÷ length) are reported separately — a reordered sequence can be item-correct but exact-wrong.</li>' +
      '<li><strong>Signal detection:</strong> hit/miss/false-alarm/correct-rejection counts feed d′; hit and false-alarm ' +
      'rates use the loglinear correction (k+0.5)/(n+1), so extreme cells stay finite. The correction is reported with the value.</li>' +
      '<li><strong>Intervals:</strong> 95% Wilson score intervals on binomial counts, rendered only when counts exist.</li>' +
      '<li><strong>Complex span:</strong> storage (recall) and processing (verification) accuracies are separate measures ' +
      'with separate denominators.</li>' +
      '<li><strong>No global score.</strong> An optional equal-weight composite can be displayed, but it is off by default ' +
      'and always labelled provisional/exploratory.</li>' +
      '</ul>'));

    /* change interpretation */
    const ci = panel('Interpreting change', 'Three distinct concepts (spec §9).');
    host.appendChild(ci.root);
    const cl = el('<table class="cmp-table wm-table"><thead><tr><th>Concept</th><th>Meaning</th></tr></thead><tbody></tbody></table>');
    WMAnalytics.changeLabels().forEach((c) => {
      cl.querySelector('tbody').appendChild(el('<tr><td><strong>' + esc(c.k) + '</strong></td><td>' + esc(c.v) + '</td></tr>'));
    });
    ci.body.appendChild(cl);
    ci.body.appendChild(noteBox('warn', '<strong>Score gains are never auto-labelled capacity gains:</strong> ' +
      esc(WMAnalytics.capacityDisclaimer())));
    ci.body.appendChild(el('<p class="hint"><strong>Reliable change (RCI)</strong> needs a test–retest reliability for the ' +
      'exact task configuration. This app will not invent one: without a value in Assessment settings, the analysis ' +
      'shows “unavailable” with the reason. With it: RCI = (last − first) / (√2 × SEM), SEM = SD × √(1 − r), α = .05 two-tailed, ' +
      'assumptions stated on screen (parallel forms, normally distributed errors, reliability applies to this configuration).</p>'));

    /* limitations */
    const lim = panel('Limitations', 'Read before drawing conclusions.');
    host.appendChild(lim.root);
    lim.body.appendChild(el('<ul class="wm-list">' +
      '<li><strong>Working memory is multi-component.</strong> These four families probe different subsystems; gains in ' +
      'one family do not imply gains in another, and none of them equals “intelligence”.</li>' +
      '<li><strong>Fresh items ≠ no practice effect.</strong> Novel sequences remove simple item memory but not learning ' +
      'of the task rule, response strategy, or general familiarity.</li>' +
      '<li><strong>Random forms differ.</strong> Two forms generated from different seeds are equivalent only in expectation; ' +
      'per-session differences can come from the form itself.</li>' +
      '<li><strong>Browser timing limits.</strong> Rendering, speech synthesis, GC pauses, and timer coarseness mean ' +
      'stimulus timing is approximate. Deviations are recorded, but laboratory-grade precision is not claimed — ' +
      'never interpret tens of milliseconds here.</li>' +
      '<li><strong>RT in self-paced phases</strong> reflects reading/typing speed as well as processing.</li>' +
      '<li><strong>Signal detection is limited</strong> when hit or false-alarm counts are small; intervals widen accordingly.</li>' +
      '<li><strong>Prototype status.</strong> This platform is a local research prototype (phases 1–5: data model, ' +
      'generators, scoring, analytics, reliability infrastructure). It is not a clinical instrument, and no clinical ' +
      'or diagnostic interpretation is offered or implied.</li>' +
      '<li><strong>No normative data.</strong> There are no age-corrected norms, percentile ranks, or IQ conversions — ' +
      'comparisons are only against your own recorded sessions.</li>' +
      '</ul>'));

    /* tests */
    const ts = panel('Automated tests', 'Runs entirely in this browser tab; test records are created and deleted, never mixed into your data.');
    host.appendChild(ts.root);
    const btnRow = el('<div class="btn-row"><button class="btn primary" data-act="run">Run test suite</button>' +
      '<span class="hint" data-count>' + WMTests.suiteCount() + ' tests registered (RNG, blueprint, generators, answer keys, ' +
      'scoring, duplicates, interruption/resume, export, timing, persistence, analytics)</span></div>');
    ts.body.appendChild(btnRow);
    const out = el('<div data-out></div>');
    ts.body.appendChild(out);
    btnRow.querySelector('[data-act="run"]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'Running…';
      out.innerHTML = '<p class="hint">Running…</p>';
      let results;
      try {
        results = await WMTests.run();
      } catch (err) {
        results = [{ name: 'test runner', ok: false, error: err.message }];
      }
      b.disabled = false;
      b.textContent = 'Run test suite';
      const passed = results.filter((r) => r.ok).length;
      const failed = results.length - passed;
      out.innerHTML = '';
      out.appendChild(el('<div class="stat-strip wm-stats">' +
        '<div class="stat-card"><div class="stat-label">Passed</div><div class="stat-value">' + passed + '</div><div class="stat-sub">of ' + results.length + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value">' + failed + '</div><div class="stat-sub">' +
        (failed ? 'see rows below' : 'all green') + '</div></div></div>'));
      const tbl = el('<table class="cmp-table wm-table"><tbody></tbody></table>');
      results.forEach((r) => {
        tbl.querySelector('tbody').appendChild(el('<tr class="' + (r.ok ? 'wm-pass' : 'wm-fail') + '">' +
          '<td style="width:28px">' + (r.ok ? '✔' : '✘') + '</td><td>' + esc(r.name) +
          (r.error ? '<div class="hint">' + esc(r.error) + '</div>' : '') + '</td></tr>'));
      });
      out.appendChild(tbl);
      UI.toast(failed ? failed + ' test(s) failed.' : 'All ' + passed + ' tests passed.', failed ? 'error' : 'success');
    });
  };
})();
