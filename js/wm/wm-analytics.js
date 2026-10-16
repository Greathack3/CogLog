/* WM Assessment Platform — analytics across sessions (spec §9).

   Per-family trajectories, accuracy by difficulty/load, RT trends, error distributions,
   interruption history, and configuration-change warnings. Confidence intervals appear
   only where binomial Wilson intervals are computable from real counts; reliable-change
   estimates appear only when a reliability estimate has been supplied. Score changes are
   always labelled as observed change — never as latent-capacity change. */

window.WMAnalytics = (function () {
  'use strict';
  const { esc } = U;

  /* ---------------- session selection ---------------- */

  /** Completed sessions only; incomplete/aborted sessions are listed separately. */
  function completed(includeDifferingConfig) {
    const list = WMStore.completedSessions().filter((s) => s.results && s.status === 'completed');
    if (includeDifferingConfig) return list;
    return list; // config filtering is applied by the caller with warnings, never silently
  }

  function latestConfigVersion() { return WMStore.currentConfigVersion(); }

  /** Sessions whose config materially differs from the newest config (change warnings). */
  function configWarnings(sessions) {
    const newest = latestConfigVersion();
    const out = [];
    sessions.forEach((s) => {
      if (s.configVersion !== newest) {
        const changes = (s.configChangesVsPrev || []);
        out.push({
          session: s,
          note: 'Session ' + s.number + ' used config v' + s.configVersion + ' (current v' + newest + ')' +
            (changes.length ? ' — changed vs previous: ' + changes.slice(0, 4).map((c) => c.field).join(', ') : ''),
          changes
        });
      }
    });
    return out;
  }

  /** Group sessions into comparable runs (identical flattened config). */
  function comparableRuns(sessions) {
    const runs = [];
    sessions.forEach((s) => {
      const sig = JSON.stringify(s.config || {});
      const last = runs[runs.length - 1];
      if (last && last.sig === sig) last.sessions.push(s);
      else runs.push({ sig, configVersion: s.configVersion, sessions: [s] });
    });
    return runs;
  }

  /* ---------------- per-family trajectories ---------------- */

  /* Returns { family: { points: [{x, y, sessionId, number, ci}], series ready for Charts } }.
     x = session completion time (ms); y = family accuracy %. */
  function trajectories(sessions) {
    sessions = sessions || WMStore.completedSessions().filter((s) => s.results);
    const out = {};
    sessions.forEach((s) => {
      const families = (s.results && s.results.families) || {};
      Object.keys(families).forEach((f) => {
        const r = families[f];
        if (!r.available || r.accuracyPct == null) return;
        out[f] = out[f] || { family: f, points: [] };
        out[f].points.push({
          x: U.toMs(s.completedAt || s.startedAt),
          y: r.accuracyPct,
          sessionId: s.id,
          number: s.number,
          date: s.date,
          ci: r.ci95,
          trials: r.trialsCompleted,
          configVersion: s.configVersion
        });
      });
    });
    Object.keys(out).forEach((f) => out[f].points.sort((a, b) => a.x - b.x));
    return out;
  }

  /* Raw (observed) change between first and last completed session for one family. */
  function observedChange(traj, family) {
    const pts = (traj[family] && traj[family].points) || [];
    if (pts.length < 2) {
      return { available: false, reason: 'Needs at least 2 completed sessions with ' + family + ' data (have ' + pts.length + ').' };
    }
    const first = pts[0], last = pts[pts.length - 1];
    return {
      available: true,
      first, last,
      diff: Math.round((last.y - first.y) * 10) / 10,
      elapsedDays: Math.max(0, Math.round(((last.x - first.x) / 86400000) * 10) / 10),
      label: 'Observed change on these tasks — not evidence of a change in latent ability.'
    };
  }

  /* Reliable change (RCI) — only when the user supplied reliability AND variability
     can be estimated from ≥3 comparable sessions. Never fabricated (spec §9). */
  function reliableChange(family) {
    const traj = trajectories();
    const pts = (traj[family] && traj[family].points) || [];
    const rel = (WMStore.getSettings().reliability || {})[family];
    const r = rel ? Number(rel) : NaN;
    if (pts.length < 3) {
      return {
        available: false,
        reason: 'Needs ≥3 completed comparable sessions for ' + family + ' (have ' + pts.length + ').',
        needReliability: isNaN(r)
      };
    }
    const ys = pts.map((p) => p.y);
    const sd = U.stdev(ys);
    const out = WMScoring.reliableChange(ys[0], ys[ys.length - 1], isNaN(r) ? null : r, sd);
    out.sessions = pts.length;
    out.needReliability = isNaN(r);
    return out;
  }

  /* ---------------- accuracy by difficulty & load ---------------- */

  /* Pooled across sessions per family: [{level, n, correct, pct}] in blueprint order. */
  function byDifficulty(family, sessions) {
    sessions = sessions || WMStore.completedSessions().filter((s) => s.results);
    const acc = {};
    WMBlueprint.LEVELS.forEach((l) => { acc[l] = { n: 0, correct: 0 }; });
    sessions.forEach((s) => {
      const r = s.results && s.results.families && s.results.families[family];
      if (!r) return;
      WMBlueprint.LEVELS.forEach((l) => {
        const b = (r.byDifficulty || {})[l];
        if (b) { acc[l].n += b.n; acc[l].correct += b.correct; }
      });
    });
    return WMBlueprint.LEVELS.map((l) => ({
      level: l,
      label: WMBlueprint.LEVEL_LABEL[l],
      n: acc[l].n, correct: acc[l].correct,
      pct: WMScoring.accuracy(acc[l].correct, acc[l].n),
      ci: WMScoring.wilson(acc[l].correct, acc[l].n)
    })).filter((r) => r.n > 0);
  }

  /* Pooled by memory load: [{load, n, correct, pct}] sorted numerically. */
  function byLoad(family, sessions) {
    sessions = sessions || WMStore.completedSessions().filter((s) => s.results);
    const acc = {};
    sessions.forEach((s) => {
      const r = s.results && s.results.families && s.results.families[family];
      if (!r) return;
      Object.keys(r.byLoad || {}).forEach((k) => {
        acc[k] = acc[k] || { n: 0, correct: 0 };
        acc[k].n += r.byLoad[k].n;
        acc[k].correct += r.byLoad[k].correct;
      });
    });
    return Object.keys(acc)
      .map((k) => ({
        load: k === '?' ? null : Number(k),
        n: acc[k].n, correct: acc[k].correct,
        pct: WMScoring.accuracy(acc[k].correct, acc[k].n),
        ci: WMScoring.wilson(acc[k].correct, acc[k].n)
      }))
      .sort((a, b) => (a.load == null ? 1e9 : a.load) - (b.load == null ? 1e9 : b.load));
  }

  /* ---------------- RT trends ---------------- */

  /* Per-family median RT per session: points for a line chart. */
  function rtTrend(family, sessions) {
    sessions = sessions || WMStore.completedSessions().filter((s) => s.results);
    const pts = [];
    sessions.forEach((s) => {
      const r = s.results && s.results.families && s.results.families[family];
      if (!r || r.medianRtMs == null) return;
      pts.push({
        x: U.toMs(s.completedAt || s.startedAt), y: r.medianRtMs,
        sessionId: s.id, number: s.number, date: s.date,
        sd: r.rtSdMs, trials: r.trialsCompleted
      });
    });
    return pts.sort((a, b) => a.x - b.x);
  }

  /* Median RT by difficulty level (pooled). */
  function rtByDifficulty(family, sessions) {
    sessions = sessions || WMStore.completedSessions();
    const bucket = {};
    sessions.forEach((s) => {
      WMStore.sessionTrials(s.id).forEach((t) => {
        if (t.family !== family || t.phase !== 'scored' || !t.completedAt) return;
        if (t.rtMs == null) return;
        (bucket[t.difficulty] = bucket[t.difficulty] || []).push(t.rtMs);
      });
    });
    return WMBlueprint.LEVELS.filter((l) => bucket[l] && bucket[l].length).map((l) => ({
      level: l, label: WMBlueprint.LEVEL_LABEL[l],
      median: Math.round(U.median(bucket[l])), n: bucket[l].length
    }));
  }

  /* ---------------- error distributions ---------------- */

  /* Pooled error classes per family across sessions (bar-chart source). */
  function errorDistribution(family, sessions) {
    sessions = sessions || WMStore.completedSessions();
    const acc = {};
    sessions.forEach((s) => {
      WMStore.sessionTrials(s.id).forEach((t) => {
        if (t.family !== family || t.phase !== 'scored' || !t.completedAt) return;
        const k = t.errorClass || 'unclassified';
        acc[k] = (acc[k] || 0) + 1;
      });
    });
    const LABELS = {
      correct: 'Correct', timeout: 'Timeout / no response', omission: 'Omission',
      order: 'Order error', item_error: 'Item error', false_selection: 'False selection',
      incorrect: 'Incorrect', miss: 'Miss (target)', false_alarm: 'False alarm (non-target)',
      processing_incorrect: 'Processing error', unclassified: 'Unclassified', unsupported: 'Unsupported'
    };
    return Object.keys(acc).map((k) => ({ key: k, label: LABELS[k] || k, n: acc[k] }))
      .sort((a, b) => b.n - a.n);
  }

  /* ---------------- interruptions / timing ---------------- */

  function interruptionHistory() {
    const rows = [];
    WMStore.state.sessions
      .slice()
      .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
      .forEach((s) => {
        const flags = (s.timingDeviations || 0);
        const ints = (s.interruptions || []);
        if (flags || ints.length || s.status !== 'completed') {
          rows.push({
            session: s, status: s.status,
            timingDeviations: flags,
            interruptions: ints,
            note: s.status === 'in_progress' ? 'Resumable — still open'
              : s.status === 'incomplete' ? 'Ended before completion (not counted as a completed assessment)'
                : null
          });
        }
      });
    return rows;
  }

  /* Total recorded timing deviations across scored trials (evidence, not decoration). */
  function timingQuality(sessions) {
    sessions = sessions || WMStore.state.sessions;
    let deviations = 0, trialsFlagged = 0, trialsTimed = 0;
    sessions.forEach((s) => {
      deviations += (s.timingDeviations || 0);
      WMStore.sessionTrials(s.id).forEach((t) => {
        if (t.phase !== 'scored' || !t.completedAt) return;
        trialsTimed++;
        if (t.timingFlags && t.timingFlags.length) trialsFlagged++;
      });
    });
    return { deviations, trialsFlagged, trialsTimed };
  }

  /* ---------------- signal detection & processing/storage ---------------- */

  /* Pooled d′ per session for families with signal-detection scoring (C, recognition). */
  function signalDetectionTrend(family, sessions) {
    sessions = sessions || WMStore.completedSessions().filter((s) => s.results);
    const pts = [];
    sessions.forEach((s) => {
      const r = s.results && s.results.families && s.results.families[family];
      if (!r || !r.signalDetection || r.signalDetection.dprime == null) return;
      pts.push({
        x: U.toMs(s.completedAt || s.startedAt), y: r.signalDetection.dprime,
        sessionId: s.id, number: s.number, date: s.date, sd: r.signalDetection
      });
    });
    return pts.sort((a, b) => a.x - b.x);
  }

  /* Complex span: storage vs processing kept separate across sessions (spec §3D). */
  function spanTrends(sessions) {
    sessions = sessions || WMStore.completedSessions().filter((s) => s.results);
    const storage = [], processing = [];
    sessions.forEach((s) => {
      const r = s.results && s.results.families && s.results.families.D;
      if (!r) return;
      const x = U.toMs(s.completedAt || s.startedAt);
      if (r.storage && r.storage.accuracyPct != null) {
        storage.push({ x, y: r.storage.accuracyPct, sessionId: s.id, number: s.number, date: s.date });
      }
      if (r.processing && r.processing.accuracyPct != null) {
        processing.push({ x, y: r.processing.accuracyPct, sessionId: s.id, number: s.number, date: s.date });
      }
    });
    return { storage: storage.sort((a, b) => a.x - b.x), processing: processing.sort((a, b) => a.x - b.x) };
  }

  /* ---------------- dashboard summary ---------------- */

  function dashboard() {
    const all = WMStore.state.sessions;
    const done = WMStore.completedSessions().filter((s) => s.results);
    const open = WMStore.inProgress();
    const traj = trajectories(done);
    const latest = {};
    Object.keys(traj).forEach((f) => {
      const pts = traj[f].points;
      latest[f] = pts[pts.length - 1];
    });
    const cfg = WMStore.currentConfig();
    let next = null;
    if (cfg.scheduleEnabled && cfg.intervalDays > 0 && done.length) {
      const last = done[done.length - 1];
      const ms = U.toMs(last.completedAt || last.startedAt) + cfg.intervalDays * 86400000;
      next = { date: U.todayISO(new Date(ms)), intervalDays: cfg.intervalDays };
    }
    return {
      totalSessions: all.length,
      completedCount: done.length,
      incompleteCount: all.filter((s) => s.status === 'incomplete').length,
      openSession: open,
      target: cfg.sessionsToTrack || null,
      progressPct: cfg.sessionsToTrack ? Math.min(100, Math.round((done.length / cfg.sessionsToTrack) * 100)) : null,
      latest, trajectories: traj, next,
      configWarnings: configWarnings(done),
      timing: timingQuality()
    };
  }

  /* ---------------- charts (hand-built on the shared SVG engine) ---------------- */

  function trajectoryChart(traj, opts) {
    opts = opts || {};
    const COLORS = { A: '#4f7cff', B: '#2aa18f', C: '#e0913a', D: '#8b7cf6' };
    const series = Object.keys(traj).map((f) => ({
      id: f,
      label: (WMTasks.FAMILIES[f] || {}).short || f,
      color: opts.onlyFamily ? COLORS[opts.onlyFamily] : COLORS[f],
      points: traj[f].points.map((p) => ({
        x: p.x, y: p.y, ref: p,
        tip: (WMTasks.FAMILIES[f] || {}).short + ' · session ' + p.number + ' (' + p.date + ')<br>' +
          p.y + '%' + (p.ci ? ' · 95% CI ' + Math.round(p.ci[0] * 1000) / 10 + '–' + Math.round(p.ci[1] * 1000) / 10 + '%' : '') +
          '<br>' + p.trials + ' trials · config v' + p.configVersion
      }))
    })).filter((s) => s.points.length && (!opts.onlyFamily || s.id === opts.onlyFamily));
    return {
      series, type: 'line', xType: 'date',
      yLabel: 'Accuracy (%)',
      yDomain: [0, 100],
      yFormat: (v) => Math.round(v) + '%',
      height: 260,
      empty: 'No completed sessions yet — run an assessment to populate this trajectory.',
      showTrend: false
    };
  }

  /* ---------------- interpretation helpers (§9 wording) ---------------- */

  function changeLabels() {
    return [
      { k: 'Observed change', v: 'A difference between recorded scores across sessions. Always computable; always shown with session/config context.' },
      { k: 'Reliable change', v: 'An observed difference that exceeds measurement error, computed as RCI only when a reliability estimate and score variability are available.' },
      { k: 'Generalization', v: 'Transfer to untrained measures (e.g., your journal assessments or outside tests). This app never infers it from trained-task gains — record independent measures yourself.' }
    ];
  }

  function capacityDisclaimer() {
    return 'Improvement on these tasks documents better performance on these tasks. ' +
      'It does not, on its own, demonstrate a change in a latent cognitive capacity, and no ' +
      'conversion to IQ-style units is ever performed.';
  }

  function ciNote() {
    return 'Intervals are 95% Wilson score intervals on binomial trial counts — shown only ' +
      'where counts exist. Sessions with zero trials in a cell show no interval rather than a guessed one.';
  }

  function esc_(s) { return esc(s); }

  return {
    completed, configWarnings, comparableRuns,
    trajectories, observedChange, reliableChange,
    byDifficulty, byLoad, rtTrend, rtByDifficulty,
    errorDistribution, interruptionHistory, timingQuality,
    signalDetectionTrend, spanTrends, dashboard,
    trajectoryChart, changeLabels, capacityDisclaimer, ciNote,
    _esc: esc_
  };
})();
