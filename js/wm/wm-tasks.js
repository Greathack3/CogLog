/* WM Assessment Platform — task-family logic (spec §3, §4).

   Four families, each with documented variants:
     A  Visuospatial          — reproduce / reverse / identify
     B  Verbal & auditory     — forward / backward / positions / recognition (visual|auditory)
     C  Updating              — n-back / recent-set (documented rule per variant)
     D  Complex span          — interleaved storage + processing, scored separately

   This module owns stimulus generation, randomization constraints, and answer keys.
   It never touches the DOM — presentation lives in wm-runner.js (spec §13). */

window.WMTasks = (function () {
  'use strict';

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const DIGITS = '0123456789'.split('');
  const TOKENS = ('BA BE BI BO BU DA DE DI DO DU FA FE FI FO FU GA GE GI GO GU HA HE HI HO HU ' +
    'JA JE JI JO JU KA KE KI KO KU LA LE LI LO LU MA ME MI MO MU NA NE NI NO NU PA PE PI PO PU ' +
    'RA RE RI RO RU SA SE SI SO SU TA TE TI TO TU VA VE VI VO VA ZA ZE ZI ZO ZU').split(' ')
    .filter((t, i, a) => t.length === 2 && a.indexOf(t) === i);

  const ITEM_SETS = { letters: LETTERS, digits: DIGITS, tokens: TOKENS };

  const FAMILIES = {
    A: {
      id: 'A', name: 'Visuospatial working memory', short: 'Visuospatial', color: '#4f7cff',
      variants: [
        { id: 'reproduce', name: 'Reproduce sequence', response: 'ordered selection',
          rule: 'Locations are highlighted one at a time. Click them back in the same order.' },
        { id: 'reverse', name: 'Reproduce in reverse', response: 'ordered selection',
          rule: 'Locations are highlighted one at a time. Click them back in reverse order (last first).' },
        { id: 'identify', name: 'Identify presented locations', response: 'set selection',
          rule: 'Locations are highlighted one at a time. Afterwards, select every location that was shown — order does not matter.' }
      ]
    },
    B: {
      id: 'B', name: 'Verbal & auditory working memory', short: 'Verbal', color: '#2aa18f',
      variants: [
        { id: 'forward', name: 'Forward serial recall', response: 'sequence entry',
          rule: 'Items are presented one at a time. Enter them in the same order.' },
        { id: 'backward', name: 'Backward serial recall', response: 'sequence entry',
          rule: 'Items are presented one at a time. Enter them in reverse order (last first).' },
        { id: 'positions', name: 'Recall specified positions', response: 'sequence entry',
          rule: 'Items are presented one at a time. When prompted, enter only the items from the requested positions, in ascending position order.' },
        { id: 'recognition', name: 'Recognition', response: 'old/new probe',
          rule: 'Items are presented one at a time. For each probe afterwards, decide whether it was in the sequence (OLD) or not (NEW).' }
      ]
    },
    C: {
      id: 'C', name: 'Working-memory updating', short: 'Updating', color: '#e0913a',
      variants: [
        { id: 'nback', name: 'N-back match', response: 'match / no-match per step',
          rule: 'A continuous stream of items appears. Respond MATCH when the current item is the same as the item shown exactly N steps earlier (N = the load recorded for that stream). Respond NO-MATCH otherwise.' },
        { id: 'recent_set', name: 'Recent-set membership', response: 'match / no-match per step',
          rule: 'A continuous stream of items appears. Respond MATCH when the current item appears anywhere among the last N items (N = the load recorded for that stream). Respond NO-MATCH otherwise.' }
      ]
    },
    D: {
      id: 'D', name: 'Complex-span working memory', short: 'Complex span', color: '#8b7cf6',
      variants: [
        { id: 'interleaved', name: 'Interleaved storage + processing', response: 'verification + sequence entry',
          rule: 'A storage item (letter) appears, followed by a verification problem (e.g. “7 + 5 = 12?”). Answer each problem, then continue. At the end of the list, recall the letters in order.' }
      ]
    }
  };

  const DEFAULT_CONFIG = {
    sessionsToTrack: 10,
    scheduleEnabled: false, intervalDays: 3,
    trialsPerTask: { A: 12, B: 12, C: 32, D: 6 },
    families: { A: true, B: true, C: true, D: true },
    variants: { A: 'reproduce', B: 'forward', C: 'nback', D: 'interleaved' },
    timing: { stimulusMs: 600, isiMs: 300, retentionMs: 1000, responseMs: 4000, itiMs: 700 },
    blueprint: { low: 25, moderate: 33, high: 25, very_high: 17 },
    modality: { B: 'visual' },          // visual | auditory (recorded per trial)
    itemSet: { B: 'letters', C: 'letters' },  // letters | digits | tokens (B), letters|digits (C)
    updateTargetRate: 30,               // % of stream steps that are targets (C)
    familiarizationTrials: 2
  };

  /* ---------------- helpers ---------------- */

  function alphabetIndex(ch) { return LETTERS.indexOf(ch.toUpperCase()); }

  /** Distance between two items in their item set (alphabet or digit line). */
  function itemDistance(a, b) {
    const ia = alphabetIndex(a), ib = alphabetIndex(b);
    if (ia >= 0 && ib >= 0) return Math.abs(ia - ib);
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return Math.abs(na - nb);
    return a === b ? 0 : 99;
  }

  function cellQuadrant(cell, rows, cols) {
    const r = Math.floor(cell / cols), c = cell % cols;
    return (r < rows / 2 ? 't' : 'b') + (c < cols / 2 ? 'l' : 'r');
  }

  /** Straight-line run check on a flat grid: three consecutive cells sharing row, column, or diagonal step. */
  function collinearRun(cells, cols) {
    for (let i = 2; i < cells.length; i++) {
      const r1 = Math.floor(cells[i - 2] / cols), c1 = cells[i - 2] % cols;
      const r2 = Math.floor(cells[i - 1] / cols), c2 = cells[i - 1] % cols;
      const r3 = Math.floor(cells[i] / cols), c3 = cells[i] % cols;
      if (r1 === r2 && r2 === r3) return true;                       // same row
      if (c1 === c2 && c2 === c3) return true;                       // same column
      if ((r2 - r1) === (r3 - r2) && (c2 - c1) === (c3 - c2) &&
        Math.abs(r2 - r1) + Math.abs(c2 - c1) === 2) return true;    // same diagonal step
    }
    return false;
  }

  /** Reject verbal sequences with 3+ alphabetical consecutive runs or simple patterns. */
  function hasVerbalPattern(seq) {
    for (let i = 2; i < seq.length; i++) {
      const a = alphabetIndex(seq[i - 2]), b = alphabetIndex(seq[i - 1]), c = alphabetIndex(seq[i]);
      if (a >= 0 && b >= 0 && c >= 0) {
        if (b - a === 1 && c - b === 1) return true;   // C D E
        if (a - b === 1 && b - c === 1) return true;   // E D C
      }
      const na = Number(seq[i - 2]), nb = Number(seq[i - 1]), nc = Number(seq[i]);
      if (!isNaN(na) && !isNaN(nb) && !isNaN(nc) && seq[i - 2].length === 1) {
        if (nb - na === 1 && nc - nb === 1) return true;  // 4 5 6
        if (na - nb === 1 && nb - nc === 1) return true;  // 6 5 4
      }
    }
    // alternating ABAB
    if (seq.length >= 4) {
      for (let i = 3; i < seq.length; i++) {
        if (seq[i] === seq[i - 2] && seq[i - 1] === seq[i - 3] && seq[i] !== seq[i - 1]) return true;
      }
    }
    return false;
  }

  /** Stable signature used for duplicate-sequence detection (spec §4). */
  function signature(family, variant, core) {
    return family + ':' + variant + ':' + (Array.isArray(core) ? core.join('') : JSON.stringify(core));
  }

  function freshCtx(extra) {
    return Object.assign({
      signatures: new Set(),
      firstQuadrant: { tl: 0, tr: 0, bl: 0, br: 0 },
      probe: { old: 0, new: 0, streak: 0, last: null }
    }, extra || {});
  }

  function tryAttempt(max, fn) {
    for (let i = 0; i < max; i++) {
      const r = fn(i);
      if (r) return r;
    }
    return null;
  }

  /* ---------------- A: visuospatial ---------------- */

  function generateA(variant, level, rng, cfg, ctx) {
    const p = window.WMBlueprint.FAMILY_LEVELS.A[level];
    const rows = ctx.grid ? ctx.grid.rows : 0;
    const cols = ctx.grid ? ctx.grid.cols : 0;
    const nCells = rows * cols;
    const load = Math.min(p.load, Math.floor(nCells * 0.6));

    const seq = tryAttempt(200, () => {
      const out = [];
      for (let i = 0; i < load; i++) {
        let cell = null;
        const tries = 120;
        for (let t = 0; t < tries; t++) {
          const cand = rng.int(0, nCells - 1);
          if (out.indexOf(cand) >= 0) continue;
          if (i === 0) {
            // balance starting locations across quadrants
            const q = cellQuadrant(cand, rows, cols);
            const min = Math.min.apply(null, Object.keys(ctx.firstQuadrant).map((k) => ctx.firstQuadrant[k]));
            if (ctx.firstQuadrant[q] > min && rng.chance(0.7)) continue;
            ctx.firstQuadrant[q]++;
          }
          cell = cand; break;
        }
        if (cell == null) return null;
        out.push(cell);
        if (out.length >= 3 && collinearRun(out, cols)) return null;
      }
      const sig = signature('A', variant, out);
      if (ctx.signatures.has(sig)) return null;   // never repeat an exact sequence (spec §4)
      ctx.signatures.add(sig);
      return out;
    });
    if (!seq) return null;

    if (variant === 'identify') {
      const lureCount = Math.max(2, Math.ceil(load / 2));
      const probes = tryAttempt(150, () => {
        const lures = [];
        for (let t = 0; t < 400 && lures.length < lureCount; t++) {
          const cand = rng.int(0, nCells - 1);
          if (seq.indexOf(cand) >= 0 || lures.indexOf(cand) >= 0) continue;
          lures.push(cand);
        }
        if (lures.length < lureCount) return null;
        // lures must not collapse into a single row or column (superficial grouping cue)
        const rowsUsed = new Set(lures.map((c) => Math.floor(c / cols)));
        const colsUsed = new Set(lures.map((c) => c % cols));
        if (rowsUsed.size === 1 || colsUsed.size === 1) return null;
        return lures;
      });
      if (!probes) return null;
      return {
        level,
        stimulus: { rows, cols, sequence: seq, probeSet: seq.concat(probes), load },
        key: { presented: seq, probeSet: seq.concat(probes), expected: seq.slice() },
        params: Object.assign({ source: 'generated', template: null }, p),
        itemSource: 'generated'
      };
    }

    const keySeq = variant === 'reverse' ? seq.slice().reverse() : seq.slice();
    return {
      level,
      stimulus: { rows, cols, sequence: seq, load },
      key: { presented: seq, expected: keySeq },
      params: Object.assign({ source: 'generated', template: null }, p),
      itemSource: 'generated'
    };
  }

  /* ---------------- B: verbal / auditory ---------------- */

  function generateB(variant, level, rng, cfg, ctx) {
    const p = window.WMBlueprint.FAMILY_LEVELS.B[level];
    const set = ITEM_SETS[(cfg.itemSet && cfg.itemSet.B) || 'letters'] || LETTERS;
    const load = p.load;
    const minDist = p.distractorSimilarity === 'near' ? 1 : 4;

    const seq = tryAttempt(250, () => {
      const out = [];
      for (let i = 0; i < load; i++) {
        let chosen = null;
        for (let t = 0; t < 200; t++) {
          const cand = set[rng.int(0, set.length - 1)];
          if (out.indexOf(cand) >= 0) continue;                       // no repeats
          if (i > 0 && itemDistance(cand, out[out.length - 1]) < minDist) continue;
          chosen = cand; break;
        }
        if (chosen == null) return null;
        out.push(chosen);
        if (hasVerbalPattern(out)) return null;
      }
      const sig = signature('B', variant, out);
      if (ctx.signatures.has(sig)) return null;
      ctx.signatures.add(sig);
      return out;
    });
    if (!seq) return null;

    if (variant === 'recognition') {
      const pr = ctx.probe;
      // Correct-answer balance (spec §4): keep OLD/NEW counts within 1, never 3+ in a row.
      let isOld;
      if (pr.streak >= 2) isOld = pr.last !== 'old';       // never 3+ same answers in a row
      else if (pr.old === pr.new) isOld = rng.chance(0.5); // balanced counts, but random at ties (no forced alternation)
      else isOld = pr.old < pr.new;                        // otherwise pick the minority status
      let probe = null;
      const ok = tryAttempt(120, () => {
        let cand;
        if (isOld) cand = seq[rng.int(0, seq.length - 1)];
        else {
          for (let t = 0; t < 200; t++) {
            const c2 = set[rng.int(0, set.length - 1)];
            if (seq.indexOf(c2) >= 0) continue;
            const near = seq.some((s) => itemDistance(s, c2) <= 3);
            if (p.distractorSimilarity === 'near' && !near) continue;
            if (p.distractorSimilarity === 'far' && near) continue;
            cand = c2; break;
          }
        }
        if (cand == null) return null;
        if (cand === pr.lastProbe) return null;   // no immediate probe repetition
        return cand;
      });
      probe = ok;
      if (probe == null) return null;
      pr[isOld ? 'old' : 'new']++;
      pr.streak = (pr.last === (isOld ? 'old' : 'new')) ? pr.streak + 1 : 1;
      pr.last = isOld ? 'old' : 'new';
      pr.lastProbe = probe;
      return {
        level,
        stimulus: { sequence: seq, probe, load, modality: (cfg.modality && cfg.modality.B) || 'visual' },
        key: { presented: seq, probe, isOld, expected: isOld ? 'old' : 'new' },
        params: Object.assign({ source: 'generated', template: null }, p),
        itemSource: 'generated'
      };
    }

    let expected = seq.slice();
    if (variant === 'backward') expected = seq.slice().reverse();
    if (variant === 'positions') {
      const k = Math.max(1, Math.min(2, load - 1));
      const positions = [];
      while (positions.length < k) {
        const pos = rng.int(0, load - 1);
        if (positions.indexOf(pos) < 0) positions.push(pos);
      }
      positions.sort((a, b) => a - b);
      expected = positions.map((i) => seq[i]);
      return {
        level,
        stimulus: { sequence: seq, load, positions, modality: (cfg.modality && cfg.modality.B) || 'visual' },
        key: { presented: seq, positions, expected },
        params: Object.assign({ source: 'generated', template: null }, p),
        itemSource: 'generated'
      };
    }
    return {
      level,
      stimulus: { sequence: seq, load, modality: (cfg.modality && cfg.modality.B) || 'visual' },
      key: { presented: seq, expected },
      params: Object.assign({ source: 'generated', template: null }, p),
      itemSource: 'generated'
    };
  }

  /* ---------------- C: updating (stream generation) ---------------- */

  /* A stream is a scored block: the rule and load are fixed for the whole stream (spec §3).
     Difficulty level → { load, interference, lureSimilarity } from the blueprint table.
     Streams use a controlled target proportion with tightly patterned answer statuses:
     targets never sit adjacent, and non-target gaps stay ≤ 2 steps wherever the target
     budget allows (spec §4 — no exploitable same-status runs). */
  function generateCStream(variant, level, nSteps, rng, cfg, ctx) {
    const p = window.WMBlueprint.FAMILY_LEVELS.C[level];
    const load = p.load;
    const set = ITEM_SETS[(cfg.itemSet && cfg.itemSet.C) || 'letters'] || LETTERS;
    const rate = U.clamp((cfg.updateTargetRate || 30) / 100, 0.1, 0.6);
    const lureRate = p.interference === 'lures+mask' ? 0.4 : (p.interference === 'lures' ? 0.25 : 0);
    const minDist = p.lureSimilarity === 'near' ? 1 : 4;

    const targetCount = Math.max(1, Math.round(nSteps * rate));
    const status = new Array(nSteps).fill(false);
    // Targets are only possible once the rule has a usable history:
    // n-back needs `load` prior steps; recent-set needs ≥2 prior items so the set ≠ just-previous item.
    const firstTarget = variant === 'nback' ? load : 2;
    const N = nSteps - firstTarget;                        // eligible positions
    if (N <= 0) return null;
    const nTargets = Math.min(targetCount, N);
    // Distribute the non-target slack over the nTargets+1 gaps around the targets so that
    // answer-status runs stay short and evenly spread (spec §4 pattern constraint): targets
    // never sit adjacent (target runs = 1), and internal/trailing gaps never exceed 2
    // non-target steps when the budget allows. The leading gap is fixed at zero — the warm-up
    // is already the rule's history requirement. Randomness lives in how the slack lands, so
    // forms differ without breaking the constraint.
    const gaps = new Array(nTargets + 1).fill(0);
    let slack = N - nTargets;                              // non-target steps to distribute
    const cap = slack <= 2 * nTargets ? 2 : Math.ceil(slack / nTargets) + 1;
    let guard = 0;
    while (slack > 0 && guard < 10000) {
      guard++;
      const g = 1 + rng.int(0, nTargets - 1);              // never the leading gap
      if (gaps[g] < cap) { gaps[g]++; slack--; }
    }
    let pos = firstTarget;
    for (let g = 0; g <= nTargets; g++) {
      pos += gaps[g];
      if (g < nTargets) { status[pos] = true; pos++; }
    }

    const stream = [];
    const stepFlags = [];
    let maskNext = false;
    for (let i = 0; i < nSteps; i++) {
      const isTarget = status[i];
      const flags = { lure: false, mask: false, relaxed: false };
      let item = null;
      const window = variant === 'nback'
        ? (i >= load ? [stream[i - load]] : [])
        : stream.slice(Math.max(0, i - load));
      const ruleOk = (cand) => {
        if (isTarget) {
          // The match rule takes precedence over the no-immediate-repeat guard: if the match
          // item also happens to be the just-shown item, the target still counts (recorded as
          // a relaxation on the trial). Without this precedence a target could be unsatisfiable.
          if (variant === 'nback') return i >= load && cand === stream[i - load];
          return window.length > 0 && window.indexOf(cand) >= 0;
        }
        if (i > 0 && cand === stream[i - 1]) return false;               // no immediate repeats
        if (variant === 'nback' && i >= load && cand === stream[i - load]) return false;
        if (variant === 'recent_set' && window.indexOf(cand) >= 0) return false;
        return true;
      };
      for (let t = 0; t < 300 && item == null; t++) {
        const cand = set[rng.int(0, set.length - 1)];
        if (isTarget) { if (ruleOk(cand)) item = cand; continue; }
        // lure: exact match at a wrong lag (high / very-high interference bands)
        if (lureRate > 0 && i > 0 && rng.chance(lureRate)) {
          const history = stream.slice(0, i);
          const lagPool = variant === 'nback'
            ? history.filter((_, k) => Math.abs(i - k - load) > 0 && Math.abs(i - k) <= load + 2)
            : history.slice(0, Math.max(0, history.length - load));
          const lurePool = lagPool.filter((x) => ruleOk(x) && x !== cand);
          if (lurePool.length) {
            const lp = lurePool[rng.int(0, lurePool.length - 1)];
            if (ruleOk(lp)) { item = lp; flags.lure = true; }
          }
          if (item != null) break;
        }
        // mask: distance-1 neighbour of the previous (just-presented) item
        if (maskNext && rng.chance(0.6)) {
          const neighbours = set.filter((x) => itemDistance(x, stream[i - 1]) === 1 && ruleOk(x));
          if (neighbours.length) { item = neighbours[rng.int(0, neighbours.length - 1)]; flags.mask = true; break; }
        }
        if (ruleOk(cand)) {
          const farEnough = window.every((w) => itemDistance(cand, w) >= minDist);
          if (farEnough || minDist <= 1) { item = cand; break; }
          // remember a rule-valid near candidate as a constrained fallback
          if (!flags.relaxed && window.every((w) => itemDistance(cand, w) >= 1)) flags.relaxedCandidate = cand;
        }
      }
      if (item == null) {
        // Deterministic fallback: any rule-valid item; the relaxation is recorded on the trial.
        const valid = set.filter((c) => {
          if (isTarget) {
            if (variant === 'nback') return i >= load && c === stream[i - load];
            return window.indexOf(c) >= 0;
          }
          if (i > 0 && c === stream[i - 1]) return false;
          if (variant === 'nback' && i >= load && c === stream[i - load]) return false;
          if (variant === 'recent_set' && window.indexOf(c) >= 0) return false;
          return true;
        });
        if (!valid.length) return null;
        item = valid[rng.int(0, valid.length - 1)];
        flags.relaxed = true;
      }
      // A target whose match item equals the just-shown item relaxes the repeat guard.
      if (isTarget && i > 0 && item === stream[i - 1]) flags.relaxed = true;
      stream.push(item);
      stepFlags.push(flags);
      maskNext = (p.interference === 'lures+mask') && isTarget;
    }

    const sig = signature('C', variant, stream);
    if (ctx.signatures.has(sig)) return null;
    ctx.signatures.add(sig);

    return stream.map((item, i) => ({
      level,
      load,
      streamIndex: i,
      streamLength: nSteps,
      stimulus: {
        item,
        window: variant === 'nback' ? (i >= load ? [stream[i - load]] : []) : stream.slice(Math.max(0, i - load)),
        load, streamIndex: i, streamLength: nSteps
      },
      key: {
        isTarget: status[i],
        expected: status[i] ? 'match' : 'nomatch',
        matchSource: status[i] ? (variant === 'nback' ? 'lag-' + load : 'set-' + load) : null
      },
      params: Object.assign({
        source: 'generated', template: 'c-stream-' + variant,
        lure: stepFlags[i].lure, mask: stepFlags[i].mask, constraintRelaxed: stepFlags[i].relaxed
      }, p),
      itemSource: 'generated',
      flags: stepFlags[i]
    }));
  }

  /* ---------------- D: complex span ---------------- */

  /* Processing problems come from a fixed parameter template so difficulty does not vary
     arbitrarily between generated forms (spec §3D): single-digit addition, sum ≤ 18,
     with a plausible off-by-one/miscalculation foil. */
  function makeProblem(rng) {
    const a = rng.int(2, 9), b = rng.int(2, 9);
    const correct = rng.chance(0.5);
    const sum = a + b;
    const c = correct ? sum : sum + rng.pick([-2, -1, 1, 2]);
    return { a, b, op: '+', c, correct };
  }

  function generateDList(level, rng, cfg, ctx) {
    const p = window.WMBlueprint.FAMILY_LEVELS.D[level];
    const load = p.load;
    const letters = tryAttempt(150, () => {
      const out = [];
      for (let i = 0; i < load; i++) {
        let chosen = null;
        for (let t = 0; t < 150; t++) {
          const cand = LETTERS[rng.int(0, LETTERS.length - 1)];
          if (out.indexOf(cand) >= 0) continue;
          if (p.distractorSimilarity === 'far' && out.some((o) => itemDistance(o, cand) < 4)) continue;
          chosen = cand; break;
        }
        if (chosen == null) return null;
        out.push(chosen);
        if (hasVerbalPattern(out)) return null;
      }
      const sig = signature('D', 'interleaved', out);
      if (ctx.signatures.has(sig)) return null;
      ctx.signatures.add(sig);
      return out;
    });
    if (!letters) return null;

    const problems = [];
    let lastCorrect = null, streak = 0;
    for (let i = 0; i < load; i++) {
      const trues = problems.filter((x) => x.correct).length;
      const falses = problems.length - trues;
      // Decide the answer status first (spec §4): counts stay within ±1 and there are never
      // 3+ same-status answers in a row. Randomness lives in which of the two statuses wins
      // at exact ties and in the numbers themselves.
      let want;
      if (streak >= 2) want = !lastCorrect;
      else if (trues === falses) want = rng.chance(0.5);
      else want = trues < falses;
      let pr = null;
      for (let t = 0; t < 60; t++) {
        const cand = makeProblem(rng);
        if (cand.correct === want) { pr = cand; break; }
      }
      if (!pr) pr = makeProblem(rng);
      streak = pr.correct === lastCorrect ? streak + 1 : 1;
      lastCorrect = pr.correct;
      problems.push(pr);
    }
    return {
      level, load,
      letters,
      problems,
      params: Object.assign({ source: 'template', template: 'd-verify-add-v1' }, p)
    };
  }

  /* ---------------- block generation ---------------- */

  /* Generates every trial for one family block.
     levelSchedule: array of difficulty labels, one per scheduled unit
       (A/B: one per trial · C: one per stream-step · D: one per list). */
  function generateBlock(family, variant, levelSchedule, rng, cfg, ctx) {
    const trials = [];
    if (family === 'C') {
      // Group the scheduled steps into streams: one stream per difficulty level (chunked if
      // long), shuffled order — the rule + load stay fixed inside a stream (spec §3).
      const counts = {};
      levelSchedule.forEach((lv) => { counts[lv] = (counts[lv] || 0) + 1; });
      let streams = [];
      window.WMBlueprint.LEVELS.forEach((lv) => {
        let rest = counts[lv] || 0;
        while (rest > 0) {
          const n = Math.min(rest, 16);
          streams.push({ level: lv, n });
          rest -= n;
        }
      });
      streams = rng.derive('stream-order').shuffle(streams);
      streams.forEach((s, si) => {
        const items = generateCStream(variant, s.level, s.n, rng.derive('stream' + si), cfg, ctx);
        if (items) items.forEach((it, ti) => {
          const tr = finalizeTrial('C', variant, it, 'stream-' + si + '-step-' + ti, si);
          tr.streamId = si;
          trials.push(tr);
        });
      });
      return trials;
    }
    if (family === 'D') {
      levelSchedule.forEach((lv, li) => {
        const list = generateDList(lv, rng.derive('list' + li), cfg, ctx);
        if (!list) return;
        list.letters.forEach((letter, li2) => {
          const prob = list.problems[li2];
          trials.push(finalizeTrial('D', variant, {
            level: list.level, load: list.load, listIndex: li,
            stimulus: { letter, problem: prob, load: list.load, listIndex: li, position: li2 },
            key: { processingAnswer: prob.correct, expected: prob.correct ? 'true' : 'false', storageLetter: letter },
            params: list.params, itemSource: 'template'
          }, 'list-' + li + '-proc-' + li2, li, 'processing'));
        });
        trials.push(finalizeTrial('D', variant, {
          level: list.level, load: list.load, listIndex: li,
          stimulus: { letters: list.letters, load: list.load, listIndex: li },
          key: { presented: list.letters, expected: list.letters.slice() },
          params: list.params, itemSource: 'template'
        }, 'list-' + li + '-recall', li, 'recall'));
      });
      return trials;
    }
    levelSchedule.forEach((lv, ti) => {
      const gen = family === 'A' ? generateA : generateB;
      const it = gen(variant, lv, rng.derive('trial' + ti), cfg, ctx);
      if (it) trials.push(finalizeTrial(family, variant, it, 'trial-' + ti));
    });
    return trials;
  }

  function finalizeTrial(family, variant, item, unitId, listIndex, kind) {
    return {
      family, variant,
      unitId: unitId || null,
      listIndex: listIndex == null ? null : listIndex,
      kind: kind || (family === 'C' ? 'step' : (family === 'B' && variant === 'recognition') ? 'probe' :
        (family === 'A' && variant === 'identify') ? 'set' : 'recall'),
      difficulty: item.level,
      memoryLoad: item.stimulus && (item.stimulus.load != null ? item.stimulus.load : null),
      stimulus: item.stimulus,
      key: item.key,
      params: item.params,
      itemSource: item.itemSource || 'generated'
    };
  }

  /* ---------------- scoring (trial level) ---------------- */

  /* Returns { correct, errorClass, metrics } — never mutates input.
     errorClass feeds the error-distribution analytics; metrics feed detailed stats. */
  function score(family, variant, trial, response) {
    if (!response) return { correct: false, errorClass: 'timeout', metrics: { omissions: 1 } };
    if (family === 'A' && variant === 'identify') {
      const expected = trial.key.expected || [];
      const selected = response.cells || [];
      const hits = selected.filter((c) => expected.indexOf(c) >= 0).length;
      const falseSel = selected.length - hits;
      const omissions = expected.length - hits;
      const exact = falseSel === 0 && omissions === 0;
      return {
        correct: exact, errorClass: exact ? 'correct' : (falseSel > 0 ? 'false_selection' : (hits === 0 ? 'omission' : 'item_error')),
        metrics: { hits, falseSelections: falseSel, omissions, itemLevel: expected.length ? hits / expected.length : 0 }
      };
    }
    if (family === 'A') return scoreSequence(trial.key.expected, response.cells || []);
    if (family === 'B' && variant === 'recognition') {
      const val = response.value;
      const isOld = trial.key.isOld;
      const hit = val === 'old' && isOld;
      const cr = val === 'new' && !isOld;
      const fa = val === 'old' && !isOld;
      const miss = val === 'new' && isOld;
      return {
        correct: hit || cr,
        errorClass: hit ? 'correct' : cr ? 'correct' : fa ? 'false_alarm' : 'miss',
        metrics: { hit: hit ? 1 : 0, falseAlarm: fa ? 1 : 0, miss: miss ? 1 : 0, correctRejection: cr ? 1 : 0, isTarget: isOld ? 1 : 0, responded: 1 }
      };
    }
    if (family === 'B') return scoreSequence(trial.key.expected, response.items || []);
    if (family === 'C') {
      const want = trial.key.isTarget;
      const gave = response.value === 'match';
      const responded = response.value === 'match' || response.value === 'nomatch';
      if (!responded) return { correct: false, errorClass: 'timeout', metrics: { omissions: 1, isTarget: want ? 1 : 0, responded: 0 } };
      const hit = want && gave, cr = !want && !gave, fa = !want && gave, miss = want && !gave;
      return {
        correct: hit || cr,
        errorClass: hit ? 'correct' : cr ? 'correct' : fa ? 'false_alarm' : 'miss',
        metrics: { hit: hit ? 1 : 0, falseAlarm: fa ? 1 : 0, miss: miss ? 1 : 0, correctRejection: cr ? 1 : 0, isTarget: want ? 1 : 0, responded: 1 }
      };
    }
    if (family === 'D' && trial.kind === 'processing') {
      const responded = response.value === 'true' || response.value === 'false';
      if (!responded) return { correct: false, errorClass: 'timeout', metrics: { omissions: 1, responded: 0 } };
      const ok = response.value === trial.key.expected;
      return { correct: ok, errorClass: ok ? 'correct' : 'processing_incorrect', metrics: { responded: 1, processingCorrect: ok ? 1 : 0 } };
    }
    if (family === 'D') return scoreSequence(trial.key.expected, response.items || []);
    return { correct: false, errorClass: 'unsupported', metrics: {} };
  }

  /* Exact-sequence vs item-level scoring (spec §8): a sequence with all correct items in the
     wrong order is NOT equivalent to a fully correct one. */
  function scoreSequence(expected, got) {
    const L = expected.length;
    if (!got || !got.length) return { correct: false, errorClass: 'omission', metrics: { omissions: L, exact: 0, itemLevel: 0, orderErrors: 0, falseSelections: 0 } };
    const exact = got.length === L && expected.every((v, i) => got[i] === v);
    let itemLevel = 0, orderErrors = 0, falseSel = 0;
    const remaining = expected.slice();
    got.forEach((g) => {
      const at = remaining.indexOf(g);
      if (at >= 0) remaining.splice(at, 1); else falseSel++;
    });
    for (let i = 0; i < Math.min(L, got.length); i++) {
      if (got[i] === expected[i]) itemLevel++;
      else if (expected.indexOf(got[i]) >= 0) orderErrors++;
    }
    const omissions = Math.max(0, L - got.length);
    let cls = 'correct';
    if (!exact) {
      if (falseSel > 0) cls = 'false_selection';
      else if (got.length === L && orderErrors > 0) cls = 'order';
      else if (itemLevel > 0) cls = 'item_error';
      else cls = 'incorrect';
    }
    return {
      correct: exact, errorClass: cls,
      metrics: { exact: exact ? 1 : 0, itemLevel: L ? itemLevel / L : 0, orderErrors, omissions, falseSelections: falseSel }
    };
  }

  /* ---------------- instructions / copy ---------------- */

  function instructions(family, variant, cfg) {
    const v = (FAMILIES[family].variants.find((x) => x.id === variant) || {});
    let rule = v.rule || '';
    if (family === 'C') {
      const p = window.WMBlueprint.FAMILY_LEVELS.C;
      const loads = window.WMBlueprint.LEVELS.map((l) => p[l].load);
      const n = Math.max.apply(null, loads);
      rule = rule.replace('N = the load recorded for that stream',
        'N varies between streams (load ' + Math.min.apply(null, loads) + '–' + n + ') and is always shown before each stream begins');
    }
    const modalityNote = family === 'B' && (cfg.modality && cfg.modality.B) === 'auditory'
      ? ' Items are played as sound. Make sure your volume is on.'
      : '';
    const noFeedback = 'During the scored session you will not be told whether a response was correct — this is a measurement, not practice.';
    return { title: (FAMILIES[family].short || family) + ' — ' + (v.name || ''), rule: rule + modalityNote, noFeedback };
  }

  return {
    LETTERS, DIGITS, TOKENS, ITEM_SETS, FAMILIES, DEFAULT_CONFIG,
    freshCtx, signature, generateBlock, score, scoreSequence, instructions,
    itemDistance, hasVerbalPattern, collinearRun,
    /* exposed for tests / dev inspection */
    _internal: { generateA, generateB, generateCStream, generateDList, makeProblem, cellQuadrant }
  };
})();
