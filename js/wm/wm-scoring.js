/* WM Assessment Platform — scoring (spec §8).

   Per-task-family scores only — there is no validated global WM score.
   Signal-detection measures use the loglinear (Hautus) correction when rates hit 0 or 1;
   the correction is documented in the Methodology page. Confidence intervals are Wilson
   score intervals on binomial proportions — computed only where the data actually support
   them (n ≥ 1), never invented. */

window.WMScoring = (function () {
  'use strict';

  /* -------- signal detection -------- */

  /** Loglinear correction: (k + 0.5) / (n + 1). Keeps z finite when a rate is 0 or 1. */
  function correctedRate(k, n) { return (k + 0.5) / (n + 1); }

  function probit(p) {
    // Acklam's inverse-normal approximation (adequate for d-prime reporting).
    if (p <= 0) return -8; if (p >= 1) return 8;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /** d-prime from 2×2 counts {hits, misses, falseAlarms, correctRejections}. */
  function dprime(counts) {
    const { hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0 } = counts || {};
    const nT = hits + misses, nN = falseAlarms + correctRejections;
    if (!nT || !nN) return null;                      // needs both trial types — never invent
    const hr = correctedRate(hits, nT);
    const far = correctedRate(falseAlarms, nN);
    return Math.round((probit(hr) - probit(far)) * 1000) / 1000;
  }

  /* -------- Wilson score interval (95%) for a proportion -------- */

  function wilson(successes, n, z) {
    if (!n || n < 1) return null;
    z = z || 1.959963984540054;
    const p = successes / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return [
      Math.max(0, Math.round(((centre - half) / denom) * 1000) / 1000),
      Math.min(1, Math.round(((centre + half) / denom) * 1000) / 1000)
    ];
  }

  /* -------- aggregation over one session's scored trials -------- */

  function median(arr) { return U.median(arr); }
  function sd(arr) { return U.stdev(arr); }

  /** Accuracy (%) = 100 × correct / scored responses, denominator documented per family. */
  function accuracy(correct, total) { return total ? Math.round((100 * correct) / total * 10) / 10 : null; }

  /* Family-specific aggregation. `trials` = scored (non-familiarization) completed trials. */
  function aggregateFamily(family, variant, trials) {
    const done = trials.filter((t) => t.completedAt && t.phase === 'scored');
    const res = {
      family, variant,
      trialsPlanned: trials.length,
      trialsCompleted: done.length,
      accuracyPct: null, correct: 0, total: 0,
      omissionRate: null, medianRtMs: null, rtSdMs: null,
      byDifficulty: {}, byLoad: {},
      errors: {}, signalDetection: null,
      exactSequencePct: null, itemLevelPct: null, serialOrderPct: null,
      processing: null, ci95: null, available: false
    };
    if (!done.length) return res;

    const rts = [];
    const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

    done.forEach((t) => {
      const m = t.scoreMetrics || {};
      const isCorrect = t.correct === true;
      res.total++;
      if (isCorrect) res.correct++;
      bump(res.errors, t.errorClass || 'unclassified');
      if (m.omissions) res.omissions = (res.omissions || 0) + m.omissions;
      if (t.rtMs != null) rts.push(t.rtMs);
      // per-difficulty
      const d = t.difficulty || 'low';
      res.byDifficulty[d] = res.byDifficulty[d] || { n: 0, correct: 0 };
      res.byDifficulty[d].n++;
      if (isCorrect) res.byDifficulty[d].correct++;
      const l = t.memoryLoad == null ? '?' : String(t.memoryLoad);
      res.byLoad[l] = res.byLoad[l] || { n: 0, correct: 0 };
      res.byLoad[l].n++;
      if (isCorrect) res.byLoad[l].correct++;
      // sequence-level accumulators
      if (m.itemLevel != null) { res._itemSum = (res._itemSum || 0) + m.itemLevel; res._itemN = (res._itemN || 0) + 1; }
      if (m.exact != null) { res._exactSum = (res._exactSum || 0) + m.exact; res._exactN = (res._exactN || 0) + 1; }
      // signal detection accumulators (C + recognition)
      if (m.isTarget != null) {
        res._sd = res._sd || { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 };
        if (m.isTarget) { if (m.hit) res._sd.hits++; else res._sd.misses++; }
        else { if (m.falseAlarm) res._sd.falseAlarms++; else res._sd.correctRejections++; }
      }
      // complex span processing
      if (t.kind === 'processing') {
        res._proc = res._proc || { n: 0, correct: 0, rts: [] };
        res._proc.n++;
        if (isCorrect) res._proc.correct++;
        if (t.rtMs != null) res._proc.rts.push(t.rtMs);
      }
      if (t.kind === 'recall' && family === 'D') {
        res._recall = res._recall || { n: 0, correct: 0 };
        res._recall.n++;
        if (isCorrect) res._recall.correct++;
      }
    });

    res.accuracyPct = accuracy(res.correct, res.total);
    res.omissionRate = res.total && res.omissions ? Math.round((100 * res.omissions) / res.total * 10) / 10 : 0;
    if (rts.length) {
      res.medianRtMs = Math.round(median(rts));
      res.rtSdMs = sd(rts) == null ? null : Math.round(sd(rts));
    }
    res.ci95 = wilson(res.correct, res.total);
    if (res._itemN) res.itemLevelPct = Math.round((100 * res._itemSum) / res._itemN * 10) / 10;
    if (res._exactN) res.exactSequencePct = Math.round((100 * res._exactSum) / res._exactN * 10) / 10;
    if (res._sd && (res._sd.hits + res._sd.misses) > 0 && (res._sd.falseAlarms + res._sd.correctRejections) > 0) {
      res.signalDetection = Object.assign({
        dprime: dprime(res._sd),
        hitRate: Math.round(correctedRate(res._sd.hits, res._sd.hits + res._sd.misses) * 1000) / 1000,
        falseAlarmRate: Math.round(correctedRate(res._sd.falseAlarms, res._sd.falseAlarms + res._sd.correctRejections) * 1000) / 1000,
        correction: 'loglinear (k+0.5)/(n+1)'
      }, res._sd);
    }
    if (res._proc && res._proc.n) {
      res.processing = {
        n: res._proc.n, correct: res._proc.correct,
        accuracyPct: accuracy(res._proc.correct, res._proc.n),
        medianRtMs: res._proc.rts.length ? Math.round(median(res._proc.rts)) : null,
        ci95: wilson(res._proc.correct, res._proc.n)
      };
      // storage vs processing kept separate (spec §3D): recall line reported alongside
      if (res._recall && res._recall.n) {
        res.storage = { n: res._recall.n, correct: res._recall.correct, accuracyPct: accuracy(res._recall.correct, res._recall.n) };
        res.serialOrderPct = res.storage.accuracyPct;
      }
    }
    if (family === 'D' && res._recall && !res._proc) {
      res.storage = { n: res._recall.n, correct: res._recall.correct, accuracyPct: accuracy(res._recall.correct, res._recall.n) };
      res.serialOrderPct = res.storage.accuracyPct;
    }

    res.available = res.total > 0;
    ['_itemSum', '_itemN', '_exactSum', '_exactN', '_sd', '_proc', '_recall'].forEach((k) => delete res[k]);
    // byDifficulty/byLoad percentages for charts
    Object.keys(res.byDifficulty).forEach((k) => {
      const b = res.byDifficulty[k];
      b.pct = accuracy(b.correct, b.n);
    });
    Object.keys(res.byLoad).forEach((k) => {
      const b = res.byLoad[k];
      b.pct = accuracy(b.correct, b.n);
    });
    return res;
  }

  /* Score a whole session: returns { families: {...}, provisionalComposite }.
     Incomplete sessions are scored over completed trials but flagged (never silently
     treated as complete — spec §7). */
  function scoreSession(session, trials) {
    const scored = trials.filter((t) => t.phase === 'scored');
    const famDone = {};
    scored.forEach((t) => {
      const key = t.family;
      famDone[key] = famDone[key] || { variant: t.variant, trials: [] };
      famDone[key].trials.push(t);
    });
    const families = {};
    Object.keys(famDone).forEach((f) => {
      families[f] = aggregateFamily(f, famDone[f].variant, famDone[f].trials);
    });

    // Optional exploratory composite — equal weights, explicitly provisional (spec §8).
    const pcts = Object.keys(families).map((f) => families[f].accuracyPct).filter((v) => v != null);
    const composite = pcts.length
      ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10
      : null;

    return {
      families,
      provisionalComposite: composite,
      compositeNote: pcts.length > 1
        ? 'Exploratory equal-weight mean of per-family accuracy. Provisional — not a validated WM score.'
        : null,
      scoredTrialCount: scored.length,
      computedAt: new Date().toISOString(),
      complete: session.status === 'completed'
    };
  }

  /* -------- reliable change (only when assumptions can be stated) -------- */

  /* RCI requires a reliability estimate. We never fabricate one: if the user has not
     supplied a test–retest reliability for a family, this returns available:false. */
  function reliableChange(first, last, reliability, sdAcrossSessions) {
    if (!reliability || reliability <= 0 || reliability >= 1) {
      return { available: false, reason: 'No test–retest reliability supplied for this family. Supply one in Assessment Settings to enable the reliable-change estimate.' };
    }
    if (!sdAcrossSessions || sdAcrossSessions <= 0) {
      return { available: false, reason: 'Not enough comparable sessions to estimate score variability (need ≥3 completed sessions with the same configuration).' };
    }
    const sem = sdAcrossSessions * Math.sqrt(1 - reliability);
    const sDiff = Math.SQRT2 * sem;
    const diff = last - first;
    const z = diff / sDiff;
    return {
      available: true, diff: Math.round(diff * 10) / 10,
      sem: Math.round(sem * 100) / 100,
      z: Math.round(z * 100) / 100,
      reliable: Math.abs(z) >= 1.96,
      formula: 'RCI = (last − first) / (√2 × SEM), SEM = SD × √(1 − r), α = .05 two-tailed',
      assumptions: 'Assumes parallel forms, normally distributed errors, and that the supplied reliability applies to this exact task configuration. Alternate-form reliability may differ from test–retest reliability.'
    };
  }

  return { correctedRate, probit, dprime, wilson, accuracy, aggregateFamily, scoreSession, reliableChange };
})();
