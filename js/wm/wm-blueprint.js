/* WM Assessment Platform — fixed difficulty blueprint (spec §5).

   Every scored session draws its trials from a fixed difficulty distribution:
   25% low · ~33% moderate · 25% high · ~17% very high.
   Counts are rounded deterministically (largest-remainder method) and the exact
   distribution used is recorded on the session. The blueprint is fixed (not adaptive)
   so longitudinal results stay interpretable. */

window.WMBlueprint = (function () {
  'use strict';

  const LEVELS = ['low', 'moderate', 'high', 'very_high'];
  const LEVEL_LABEL = { low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very high' };

  const DEFAULT = { low: 25, moderate: 33, high: 25, very_high: 17 };

  /* Difficulty is defined per family by task-specific variables — the same label never
     implies equivalent difficulty across families (spec §5). This table is the documented
     v1 mapping; it is stored with each generated item as its difficulty parameters. */
  const FAMILY_LEVELS = {
    A: {
      low:      { load: 3, retentionMult: 1.0, probeSimilarity: 'any' },
      moderate: { load: 4, retentionMult: 1.25, probeSimilarity: 'any' },
      high:     { load: 5, retentionMult: 1.6, probeSimilarity: 'near' },
      very_high:{ load: 6, retentionMult: 2.0, probeSimilarity: 'near' }
    },
    B: {
      low:      { load: 3, retentionMult: 1.0, distractorSimilarity: 'far' },
      moderate: { load: 4, retentionMult: 1.25, distractorSimilarity: 'far' },
      high:     { load: 5, retentionMult: 1.6, distractorSimilarity: 'near' },
      very_high:{ load: 6, retentionMult: 2.0, distractorSimilarity: 'near' }
    },
    C: {
      low:      { load: 2, interference: 'none', lureSimilarity: 'far' },
      moderate: { load: 3, interference: 'none', lureSimilarity: 'far' },
      high:     { load: 3, interference: 'lures', lureSimilarity: 'near' },
      very_high:{ load: 3, interference: 'lures+mask', lureSimilarity: 'near' }
    },
    D: {
      low:      { load: 2, processingLoad: 1, distractorSimilarity: 'far' },
      moderate: { load: 3, processingLoad: 1, distractorSimilarity: 'far' },
      high:     { load: 4, processingLoad: 2, distractorSimilarity: 'near' },
      very_high:{ load: 5, processingLoad: 2, distractorSimilarity: 'near' }
    }
  };

  function normalize(bp) {
    const src = bp || DEFAULT;
    const out = {};
    let total = 0;
    LEVELS.forEach((l) => {
      let v = Number(src[l]);
      if (!isFinite(v) || v < 0) v = 0;
      out[l] = v;
      total += v;
    });
    if (total <= 0) return { ...DEFAULT };
    // Rescale so levels sum to exactly 100 (keeps rounding deterministic).
    const scaled = {};
    let acc = 0;
    LEVELS.slice(0, -1).forEach((l) => {
      scaled[l] = Math.round((out[l] / total) * 100);
      acc += scaled[l];
    });
    scaled[LEVELS[LEVELS.length - 1]] = 100 - acc;
    return scaled;
  }

  /** Deterministic largest-remainder allocation of `n` trials across the four levels.
      Returns per-level counts that always sum to n. */
  function allocate(n, bp) {
    const pct = normalize(bp);
    const raw = LEVELS.map((l) => ({ l, exact: (n * pct[l]) / 100 }));
    const out = {};
    let used = 0;
    raw.forEach((r) => { out[r.l] = Math.floor(r.exact); used += out[r.l]; });
    let rest = n - used;
    // Largest fractional part first; ties broken by the fixed LEVELS order → deterministic.
    const byFrac = raw.slice().sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) ||
      LEVELS.indexOf(a.l) - LEVELS.indexOf(b.l));
    for (let i = 0; rest > 0; i = (i + 1) % byFrac.length) { out[byFrac[i].l]++; rest--; }
    return { counts: out, pct };
  }

  /** Schedule `n` level labels in a shuffled-but-reproducible order (seeded).
      Blocks never present difficulty monotonically, which would cue the participant. */
  function schedule(n, bp, rng) {
    const { counts } = allocate(n, bp);
    const arr = [];
    LEVELS.forEach((l) => { for (let i = 0; i < counts[l]; i++) arr.push(l); });
    return rng.shuffle(arr);
  }

  /** Actual distribution recorded on a session from its scored trials. */
  /* Realised difficulty distribution, counted in scheduled UNITS — A/B: one per trial,
      C: one per stream step, D: one per list (a D list contributes several trials at the
      same difficulty, so counting trials would systematically overweight the high bands;
      the blueprint governs units). */
  function realized(trials) {
    const out = { low: 0, moderate: 0, high: 0, very_high: 0 };
    const seen = new Set();
    trials.forEach((t) => {
      const unit = t.family === 'D'
        ? t.family + ':list:' + (t.listIndex != null ? t.listIndex : t.unitId)
        : t.family + ':' + (t.unitId || t.id || Math.random());
      if (seen.has(unit)) return;
      seen.add(unit);
      if (out[t.difficulty] != null) out[t.difficulty]++;
    });
    const n = seen.size;
    const pct = {};
    LEVELS.forEach((l) => { pct[l] = n ? Math.round((out[l] / n) * 1000) / 10 : 0; });
    return { counts: out, pct, n };
  }

  /** Differences between the intended blueprint and what a session actually delivered. */
  function drift(session) {
    const bp = normalize(session.config && session.config.blueprint);
    const rz = session.blueprintRealized || realized([]);
    const notes = [];
    LEVELS.forEach((l) => {
      const want = bp[l], got = rz.pct ? rz.pct[l] : 0;
      if (rz.n && Math.abs(want - got) > 6) {
        notes.push(LEVEL_LABEL[l] + ': intended ' + want + '%, delivered ' + got + '%');
      }
    });
    return notes;
  }

  return { LEVELS, LEVEL_LABEL, DEFAULT, FAMILY_LEVELS, normalize, allocate, schedule, realized, drift };
})();
