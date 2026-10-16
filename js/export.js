/* Cognitive Evolution Tracker — export, import, and backup. */
window.Exporter = (function () {
  'use strict';
  const { toCSV, download, todayISO, esc } = U;

  function stamp() { return todayISO(); }

  /* -------- JSON (full structured export / backup) -------- */

  function exportJSON(opts) {
    const bundle = Store.exportBundle(opts);
    download('cognitive-evolution-tracker-backup-' + stamp() + '.json',
      JSON.stringify(bundle, null, 2), 'application/json');
  }

  /* -------- CSV: performance observations (tabular, one row per observation) -------- */

  function exportObservationsCSV() {
    const rows = Store.state.observations.map((o) => {
      const s = Store.sessionById(o.sessionId) || {};
      const t = Store.ticketById(o.ticketId) || {};
      const m = Store.metricById(o.metricId) || {};
      const mode = Store.modeById(s.modeId) || {};
      return [
        t.date || '', s.date || '', s.startTime || '', mode.name || '', m.name || '', m.unit || '',
        o.value == null ? '' : o.value, o.metricVersion == null ? '' : o.metricVersion,
        (o.notes || ''), (s.notes || ''), o.createdAt || '', o.updatedAt || ''
      ];
    });
    rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    download('cet-observations-' + stamp() + '.csv', toCSV(
      ['ticket_date', 'session_date', 'session_start', 'training_mode', 'metric', 'unit', 'value',
        'metric_definition_version', 'observation_notes', 'session_notes', 'created_at', 'updated_at'], rows
    ), 'text/csv;charset=utf-8');
  }

  /* -------- CSV: daily tickets + lifestyle -------- */

  function exportDailyCSV() {
    const rows = Store.sortedTickets(true).map((t) => {
      const sess = Store.sessionsOf(t.id);
      const sleep = t.sleep || {}, pa = t.pa || {};
      return [
        t.date || '', sleep.durationMin == null ? '' : sleep.durationMin, sleep.bedTime || '', sleep.wakeTime || '',
        sleep.quality == null ? '' : sleep.quality, (sleep.notes || ''),
        pa.dailyMinutes == null ? '' : pa.dailyMinutes, pa.type || '', pa.intensity || '',
        sess.length, (t.notes || ''), t.createdAt || '', t.updatedAt || ''
      ];
    });
    download('cet-daily-' + stamp() + '.csv', toCSV(
      ['date', 'sleep_minutes', 'bed_time', 'wake_time', 'sleep_quality', 'sleep_notes',
        'pa_workout_minutes', 'pa_type', 'pa_intensity', 'session_count', 'notes',
        'created_at', 'updated_at'], rows
    ), 'text/csv;charset=utf-8');
  }

  /* -------- CSV: assessments -------- */

  function exportAssessmentsCSV() {
    const rows = Store.state.assessments
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((a) => [
        a.kind || '', a.testName || '', a.date || '', a.scoreType || '',
        a.overallScore == null ? '' : a.overallScore, a.scaleMin == null ? '' : a.scaleMin,
        a.scaleMax == null ? '' : a.scaleMax, a.normSD == null ? '' : a.normSD,
        a.reliability == null ? '' : a.reliability, a.gLoading == null ? '' : a.gLoading,
        (a.subtests || []).map((s) => s.name + '=' + s.value).join('; '),
        (a.notes || ''), (a.preparation || ''), (a.conclusions || ''), a.createdAt || '', a.updatedAt || ''
      ]);
    download('cet-assessments-' + stamp() + '.csv', toCSV(
      ['kind', 'test_name', 'date', 'score_type', 'overall_score', 'scale_min', 'scale_max',
        'norm_sd', 'reliability', 'g_loading', 'subtests', 'notes', 'preparation', 'conclusions',
        'created_at', 'updated_at'], rows
    ), 'text/csv;charset=utf-8');
  }

  /* -------- CSV: metric definitions (documents the measurement system) -------- */

  function exportMetricsCSV() {
    const rows = Store.state.metrics.map((m) => [
      m.name, m.unit, m.dataType, m.direction, m.min == null ? '' : m.min, m.max == null ? '' : m.max,
      m.target == null ? '' : m.target, m.currentVersion || 1, (m.description || ''),
      (m.versions || []).map((v) => 'v' + v.v + ' @ ' + String(v.changedAt).slice(0, 10) + ': ' + v.note).join(' | '),
      m.archived ? 'archived' : 'active'
    ]);
    download('cet-metric-definitions-' + stamp() + '.csv', toCSV(
      ['metric', 'unit', 'data_type', 'direction', 'min', 'max', 'target', 'current_version',
        'description', 'version_history', 'status'], rows
    ), 'text/csv;charset=utf-8');
  }

  /* -------- import -------- */

  /** Merge a bundle into the database.
      Conflicting records (same id, different content) are skipped unless overwriteConflicts. */
  async function importBundle(file, opts) {
    opts = opts || {};
    const text = await file.text();
    let bundle;
    try { bundle = JSON.parse(text); }
    catch (e) { throw new Error('The file is not valid JSON.'); }
    if (!bundle || bundle.app !== 'cognitive-evolution-tracker' || !bundle.data) {
      throw new Error('Not a Cognitive Evolution Tracker backup file.');
    }
    const d = bundle.data;
    const result = { added: 0, updated: 0, skippedConflicts: 0, replaced: 0 };

    if (opts.replaceAll) {
      // Clear storage and in-memory state WITHOUT letting reload() reseed defaults
      // (a reseed would collide with the records we are about to import).
      for (const s of DB.STORES) await DB.clear(s);
      Store.state.modes = [];
      Store.state.metrics = [];
      Store.state.tickets = [];
      Store.state.sessions = [];
      Store.state.observations = [];
      Store.state.assessments = [];
      Store.state.attachments = [];
      Store.state.profile = null;
      if (window.WMStore) {
        WMStore.state.sessions = [];
        WMStore.state.blocks = [];
        WMStore.state.trials = [];
        WMStore.state.configVersions = [];
      }
      result.replaced = 1;
    }

    const stores = ['modes', 'metrics', 'tickets', 'sessions', 'observations', 'assessments', 'attachments'];
    for (const store of stores) {
      const incoming = Array.isArray(d[store]) ? d[store] : [];
      const existing = Store.state[store];
      const map = new Map(existing.map((r) => [r.id, r]));
      const toPut = [];
      for (const rec of incoming) {
        if (!rec || !rec.id) continue;
        const cur = map.get(rec.id);
        if (!cur) { toPut.push(rec); map.set(rec.id, rec); result.added++; }
        else if (JSON.stringify(cur) === JSON.stringify(rec)) { /* identical, nothing to do */ }
        else if (opts.overwriteConflicts) { toPut.push(rec); map.set(rec.id, rec); result.updated++; }
        else result.skippedConflicts++;
      }
      if (toPut.length) await DB.putMany(store, toPut);
    }

    // WM assessment data (sessions → blocks → trials + config versions): same merge rules.
    if (window.WMStore && d.wm) {
      const wmMap = [
        ['wmSessions', 'sessions'], ['wmBlocks', 'blocks'], ['wmTrials', 'trials'],
        ['wmConfigVersions', 'configVersions']
      ];
      for (const [store, key] of wmMap) {
        const incoming = Array.isArray(d.wm[key]) ? d.wm[key] : [];
        const existing = WMStore.state[key] || [];
        const map = new Map(existing.map((r) => [r.id != null ? r.id : r.version, r]));
        const toPut = [];
        for (const rec of incoming) {
          if (!rec) continue;
          const idKey = rec.id != null ? 'id' : 'version';
          if (rec[idKey] == null) continue;
          const cur = map.get(rec[idKey]);
          if (!cur) { toPut.push(rec); map.set(rec[idKey], rec); result.added++; }
          else if (JSON.stringify(cur) === JSON.stringify(rec)) { /* identical */ }
          else if (opts.overwriteConflicts) { toPut.push(rec); map.set(rec[idKey], rec); result.updated++; }
          else result.skippedConflicts++;
        }
        if (toPut.length) await DB.putMany(store, toPut);
      }
      if (d.wm.settings && (opts.replaceAll || !WMStore.state.settings)) {
        await DB.setMeta('wmSettings', d.wm.settings);
      }
      if (d.wm.participant && opts.replaceAll) {
        await DB.setMeta('wmParticipant', d.wm.participant);
      }
      await WMStore.reload();
      WMStore.emit();
    }

    // Profile: always restore on replace; on merge only overwrite when asked or when
    // there is no meaningful local profile yet (fresh default state).
    if (d.profile) {
      const cur = Store.state.profile;
      const p = cur || {};
      const hasLocalProfile = !!(p.name || (p.snapshots && p.snapshots.length) || p.occupation ||
        p.occupationCustom || p.age || p.gender ||
        (p.plans && Object.values(p.plans).some((v) => v)) ||
        (p.sensitive && p.sensitive.notes));
      if (opts.replaceAll || opts.overwriteConflicts || !hasLocalProfile) {
        await DB.setMeta('profile', d.profile);
      }
    }
    await Store.reload();
    Store.emit();
    return result;
  }

  /* -------- shared-report export (sensitive fields excluded by default) -------- */

  function exportSharedReport(opts) {
    const inc = (opts && opts.sensitive) === true;
    const lines = [];
    lines.push('# Cognitive training report');
    lines.push('Generated: ' + new Date().toLocaleString());
    lines.push('');
    const p = Store.state.profile || {};
    lines.push('## Profile');
    lines.push('- Name/pseudonym: ' + (p.name || '(not set)'));
    lines.push('- Gender: ' + (p.gender || '(not set)'));
    lines.push('- Occupation: ' + (p.occupation || '(not set)'));
    if (inc && p.sensitive && p.sensitive.notes) lines.push('- Private notes: ' + p.sensitive.notes);
    if (!inc) lines.push('- (Private/sensitive fields excluded — enable “include sensitive information” to add them.)');
    lines.push('');
    lines.push('## Training log (' + Store.state.tickets.length + ' days, ' + Store.state.sessions.length + ' sessions)');
    Store.sortedTickets(true).slice(0, 30).forEach((t) => {
      const sess = Store.sessionsOf(t.id);
      const bits = sess.map((s) => {
        const mode = Store.modeById(s.modeId);
        const obs = Store.observationsOf(s.id).map((o) => {
          const m = Store.metricById(o.metricId);
          return (m ? m.name : '?') + ' ' + (o.value == null ? '—' : o.value) + (m && m.unit ? ' ' + m.unit : '');
        }).join(', ');
        return (mode ? mode.name : 'session') + (s.startTime ? ' @ ' + s.startTime : '') + (obs ? ' — ' + obs : '');
      });
      lines.push('- ' + t.date + ': ' + (bits.length ? bits.join('; ') : 'no sessions recorded') +
        ((t.sleep || {}).durationMin != null ? ' · sleep ' + U.fmtDuration(t.sleep.durationMin) : ''));
    });
    if (Store.state.tickets.length > 30) lines.push('- (showing the 30 most recent days of ' + Store.state.tickets.length + ')');
    lines.push('');
    const noteDays = Store.compileTicketNotes();
    if (noteDays.length) {
      lines.push('## Ticket notes (' + noteDays.length + ' day' + (noteDays.length === 1 ? '' : 's') + ' with notes)');
      noteDays.forEach((d) => {
        lines.push('- ' + d.date + (d.createdAt ? ' (entered ' + String(d.createdAt).slice(0, 16).replace('T', ' ') + ')' : ''));
        d.lines.forEach((ln) => {
          const segs = ln.text.split('\n');
          segs.forEach((seg, i) => { lines.push('  ' + (i === 0 ? '· ' + ln.label + ': ' : '  ') + seg); });
        });
      });
      lines.push('');
    }
    lines.push('## Assessments');
    Store.state.assessments.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((a) => {
      lines.push('- ' + (a.kind === 'baseline' ? 'Baseline' : 'Follow-up') + ' · ' + a.testName + ' · ' + a.date +
        ' · ' + (a.overallScore == null ? 'no score' : a.overallScore) + (a.scoreType ? ' (' + a.scoreType + ')' : ''));
      if (a.preparation) lines.push('  · Training preparation: ' + String(a.preparation).replace(/\n/g, '\n    '));
      if (a.conclusions) lines.push('  · Session conclusions: ' + String(a.conclusions).replace(/\n/g, '\n    '));
    });
    lines.push('');
    lines.push('> Training-task improvement documents performance on the trained task. It is not, by itself,');
    lines.push('> evidence of a change in general cognitive ability.');
    download('cognitive-training-report-' + stamp() + '.md', lines.join('\n'), 'text/markdown;charset=utf-8');
    void esc;
  }

  return {
    exportJSON, exportObservationsCSV, exportDailyCSV, exportAssessmentsCSV, exportMetricsCSV,
    importBundle, exportSharedReport
  };
})();
