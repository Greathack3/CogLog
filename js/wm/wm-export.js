/* WM Assessment Platform — CSV / JSON export (spec §11).

   Trial-level CSV carries every field the spec requires (seed, stimulus parameters,
   difficulty, load, responses, RT, omissions, error class, generator + config version,
   completion status, timing flags). Session-level CSV carries blueprint + config + status.
   JSON preserves the hierarchical session → blocks → trials structure. */

window.WMExport = (function () {
  'use strict';
  const { toCSV, download, todayISO } = U;

  function stamp() { return todayISO(); }

  function jitter(v) {
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }

  /* ---------------- JSON (hierarchical) ---------------- */

  function buildBundle(opts) {
    opts = opts || {};
    const includeFam = !!(WMStore.getSettings() || {}).includeFamiliarizationInExport;
    const sessions = WMStore.state.sessions
      .slice()
      .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
    return {
      schema: 'wm-assessment-platform',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      generator: WMRng.VERSION,
      participant: WMStore.state.participant,
      settings: WMStore.getSettings(),
      configVersions: WMStore.state.configVersions,
      sessions: sessions.map((s) => ({
        session: s,
        blocks: WMStore.sessionBlocks(s.id),
        trials: WMStore.sessionTrials(s.id)
          .filter((t) => includeFam || t.phase === 'scored')
      }))
    };
  }

  function exportJSON() {
    const bundle = buildBundle();
    download('wm-assessment-export-' + stamp() + '.json', JSON.stringify(bundle, null, 2), 'application/json');
    return bundle;
  }

  /* ---------------- trial-level CSV ---------------- */

  const TRIAL_HEADERS = [
    'participant_id', 'session_id', 'session_number', 'session_status', 'block_id', 'trial_id',
    'family', 'variant', 'phase', 'block_order', 'trial_index', 'unit_id', 'kind',
    'difficulty', 'memory_load', 'modality', 'item_source',
    'stimulus_params', 'correct_response', 'user_response',
    'correct', 'rt_ms', 'omission', 'error_class',
    'seed_hex', 'generator_version', 'config_version',
    'started_at', 'completed_at', 'timing_flags', 'timing_deviations', 'completion_status'
  ];

  function trialRows() {
    const rows = [];
    const includeFam = !!(WMStore.getSettings() || {}).includeFamiliarizationInExport;
    const sessions = WMStore.state.sessions
      .slice().sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
    sessions.forEach((s) => {
      const blocks = {};
      WMStore.sessionBlocks(s.id).forEach((b) => { blocks[b.id] = b; });
      WMStore.sessionTrials(s.id)
        .filter((t) => includeFam || t.phase === 'scored')
        .forEach((t) => {
          const b = blocks[t.blockId] || {};
          rows.push([
            t.participantId || s.participantId || '', s.id, s.number, s.status, t.blockId || '', t.id,
            t.family, t.variant, t.phase, b.order == null ? '' : b.order,
            t.trialIndex == null ? '' : t.trialIndex, t.unitId || '', t.kind || '',
            t.difficulty || '', t.memoryLoad == null ? '' : t.memoryLoad,
            (t.stimulus && t.stimulus.modality) || '', t.itemSource || '',
            jitter(t.stimulus), jitter(t.correctResponse), jitter(t.userResponse),
            t.correct == null ? '' : t.correct, t.rtMs == null ? '' : t.rtMs,
            t.omission ? 1 : 0, t.errorClass || '',
            WMRng.seedToHex(t.seed || 0), t.generatorVersion || '', t.configVersion == null ? '' : t.configVersion,
            '', t.completedAt || '',
            jitter(t.timingFlags || []), (t.timingFlags || []).length,
            t.completedAt ? 'completed' : 'pending'
          ]);
        });
    });
    return rows;
  }

  function exportTrialsCSV() {
    const csv = toCSV(TRIAL_HEADERS, trialRows());
    download('wm-trials-' + stamp() + '.csv', csv, 'text/csv');
    return csv;
  }

  /* ---------------- session-level CSV ---------------- */

  const SESSION_HEADERS = [
    'participant_id', 'session_id', 'session_number', 'status', 'date',
    'started_at', 'completed_at', 'seed_hex', 'generator_version', 'config_version',
    'families_enabled', 'variants', 'trials_planned', 'trials_completed',
    'blueprint_intended', 'blueprint_realized', 'timing_deviations', 'interruption_count',
    'config_changes_vs_prev', 'scores_by_family', 'provisional_composite'
  ];

  function sessionRows() {
    return WMStore.state.sessions
      .slice().sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
      .map((s) => {
        const fam = Object.keys(s.config.families).filter((f) => s.config.families[f]);
        const variants = fam.map((f) => f + ':' + s.config.variants[f]).join(' ');
        const scores = {};
        Object.keys(((s.results || {}).families) || {}).forEach((f) => {
          const r = s.results.families[f];
          scores[f] = r.accuracyPct == null ? 'n/a' : r.accuracyPct + '%';
        });
        return [
          s.participantId || '', s.id, s.number, s.status, s.date,
          s.startedAt || '', s.completedAt || '', s.seedHex || '', s.generatorVersion || '', s.configVersion,
          fam.join(' '), variants, s.trialsPlanned || 0, s.trialsCompleted || 0,
          jitter(s.blueprintIntended), jitter(s.blueprintRealized),
          s.timingDeviations || 0, (s.interruptions || []).length,
          jitter((s.configChangesVsPrev || []).map((c) => c.field + ':' + c.from + '→' + c.to)),
          jitter(scores),
          (s.results && s.results.provisionalComposite != null) ? s.results.provisionalComposite : ''
        ];
      });
  }

  function exportSessionsCSV() {
    const csv = toCSV(SESSION_HEADERS, sessionRows());
    download('wm-sessions-' + stamp() + '.csv', csv, 'text/csv');
    return csv;
  }

  /* ---------------- import (JSON produced by this exporter) ---------------- */

  /* Merge semantics mirror the journal import: only records whose id does not already
     exist are added — existing data is never silently overwritten (spec §12). */
  async function importJSON(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'Not valid JSON: ' + e.message }; }
    if (!data || data.schema !== 'wm-assessment-platform') {
      return { ok: false, error: 'Not a WM assessment export (missing schema marker).' };
    }
    const added = { sessions: 0, blocks: 0, trials: 0, skipped: 0 };
    const knownSess = new Set(WMStore.state.sessions.map((s) => s.id));
    const knownBlocks = new Set(WMStore.state.blocks.map((b) => b.id));
    const knownTrials = new Set(WMStore.state.trials.map((t) => t.id));

    for (const entry of (data.sessions || [])) {
      const s = entry.session;
      if (!s || !s.id) continue;
      if (knownSess.has(s.id)) { added.skipped++; continue; }
      await DB.put('wmSessions', s);
      WMStore.state.sessions.push(s);
      knownSess.add(s.id);
      added.sessions++;
      for (const b of (entry.blocks || [])) {
        if (!b || !b.id || knownBlocks.has(b.id)) continue;
        await DB.put('wmBlocks', b);
        WMStore.state.blocks.push(b);
        knownBlocks.add(b.id);
        added.blocks++;
      }
      for (const t of (entry.trials || [])) {
        if (!t || !t.id || knownTrials.has(t.id)) continue;
        await DB.put('wmTrials', t);
        WMStore.state.trials.push(t);
        knownTrials.add(t.id);
        added.trials++;
      }
    }
    // Config versions: add any unknown version numbers.
    for (const v of (data.configVersions || [])) {
      if (!v || WMStore.state.configVersions.some((x) => x.version === v.version)) continue;
      await DB.put('wmConfigVersions', v);
      WMStore.state.configVersions.push(v);
    }
    WMStore.state.configVersions.sort((a, b) => (a.version || 0) - (b.version || 0));
    WMStore.emit();
    return { ok: true, added };
  }

  return { buildBundle, exportJSON, exportTrialsCSV, exportSessionsCSV, importJSON, trialRows, sessionRows, TRIAL_HEADERS, SESSION_HEADERS };
})();
