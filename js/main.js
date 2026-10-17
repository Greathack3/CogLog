/* Cognitive Evolution Tracker — app bootstrap, navigation, and Data & Backup panel. */
(function () {
  'use strict';
  const { el, esc } = U;

  const VIEWS = {
    journal: { label: 'Journal', icon: 'book', render: () => ViewJournal.render },
    progress: { label: 'Progress', icon: 'chart', render: () => ViewProgress.render },
    profile: { label: 'Profile & Assessments', icon: 'user', render: () => ViewProfile.render },
    wm: { label: 'WM Assessment', icon: 'flask', render: () => ViewWM.render }
  };

  let current = 'journal';
  let subView = null;   // sub-section within the WM Assessment tab (e.g. 'analytics')

  async function boot() {
    await Store.init();
    if (window.WMStore) await WMStore.init();
    if (window.Theme) await Theme.init();
    buildShell();
    routeFromHash();
    window.addEventListener('hashchange', routeFromHash);
    // re-render the active view whenever any record changes (spec §7: automatic updates)
    Store.subscribe(() => {
      // never disturb an actively running assessment (spec §7)
      if (window.WMRunner && WMRunner.isActive()) { updateStorageBadge(); return; }
      const view = document.getElementById('view');
      if (view && document.body.contains(view)) {
        // preserve scroll position across data refreshes
        const y = window.scrollY;
        VIEWS[current].render()(view, current === 'wm' ? subView : undefined);
        window.scrollTo(0, y);
      }
      updateStorageBadge();
    });
    if (window.WMStore) {
      WMStore.subscribe(() => {
        if (window.WMRunner && WMRunner.isActive()) return;
        if (current !== 'wm') return;
        const view = document.getElementById('view');
        if (view && document.body.contains(view)) {
          const y = window.scrollY;
          VIEWS.wm.render()(view, subView);
          window.scrollTo(0, y);
        }
      });
    }
    updateStorageBadge();
  }

  /* ---------- shell ---------- */

  function buildShell() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    const header = el('<header class="topbar">' +
      '<div class="brand"><span class="logo">🧠</span>' +
      '<div class="brand-text"><strong>Cognitive Evolution Tracker</strong>' +
      '<span class="brand-sub">training journal · working-memory assessment lab</span></div></div>' +
      '<nav class="tabs" role="tablist"></nav>' +
      '<div class="topbar-right">' +
      '<button class="btn" data-act="appearance" title="Choose a theme and accent colour">' + Icons.svg('palette') + ' Appearance</button>' +
      '<button class="btn" data-act="backup" title="Export, import, and storage info">' + Icons.svg('database') + ' Data &amp; Backup</button>' +
      '</div>' +
      '</header>');

    const nav = header.querySelector('.tabs');
    Object.keys(VIEWS).forEach((key) => {
      const b = el('<button class="tab" data-tab="' + key + '" role="tab">' +
        '<span class="tab-icon">' + Icons.svg(VIEWS[key].icon) + '</span>' + esc(VIEWS[key].label) + '</button>');
      b.addEventListener('click', () => { location.hash = '#' + key; });
      nav.appendChild(b);
    });

    const main = el('<main id="view" class="view"></main>');
    const foot = el('<footer class="app-footer">' +
      '<span data-storage-badge></span>' +
      '<span class="sep">·</span>' +
      '<span>All records stay on this device. Export a backup regularly — browser-local data is not protected against device failure.</span>' +
      '</footer>');

    header.querySelector('[data-act="backup"]').addEventListener('click', openBackupPanel);
    header.querySelector('[data-act="appearance"]').addEventListener('click', () => {
      if (window.Theme) Theme.open();
    });
    app.appendChild(header);
    app.appendChild(main);
    app.appendChild(foot);
  }

  function updateStorageBadge() {
    const badge = document.querySelector('[data-storage-badge]');
    if (!badge) return;
    const mode = Store.state.storageMode;
    const n = Store.state.tickets.length;
    badge.innerHTML = Icons.svg('database') + ' ' + (mode === 'idb' ? 'IndexedDB' : 'localStorage (fallback)') + ' · ' +
      n + ' ticket' + (n === 1 ? '' : 's') + ' · ' + Store.state.attachments.length + ' file(s)';
  }

  /* ---------- routing ---------- */

  function routeFromHash() {
    const raw = (location.hash || '#journal').replace('#', '');
    const slash = raw.indexOf('/');
    const viewKey = slash >= 0 ? raw.slice(0, slash) : raw;
    current = VIEWS[viewKey] ? viewKey : 'journal';
    subView = null;
    if (current === 'wm') subView = slash >= 0 ? raw.slice(slash + 1) : null;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === current));
    // An active assessment owns the screen — keep its overlay, just update the tab state.
    if (window.WMRunner && WMRunner.isActive() && current !== 'wm') { /* overlay persists via body */ }
    const view = document.getElementById('view');
    view.innerHTML = '';
    VIEWS[current].render()(view, subView);
    window.scrollTo(0, 0);
  }

  /* ---------- Data & Backup panel ---------- */

  function openBackupPanel() {
    const mode = Store.state.storageMode;
    const counts = {
      tickets: Store.state.tickets.length, sessions: Store.state.sessions.length,
      observations: Store.state.observations.length, assessments: Store.state.assessments.length,
      metrics: Store.state.metrics.length, modes: Store.state.modes.length,
      attachments: Store.state.attachments.length,
      'wm sessions': window.WMStore ? WMStore.state.sessions.length : 0,
      'wm trials': window.WMStore ? WMStore.state.trials.length : 0
    };

    const body = el('<div class="backup-panel">' +
      '<div class="storage-info ' + (mode === 'idb' ? 'ok' : 'warn') + '">' +
      '<h4>' + (mode === 'idb' ? 'Storage: IndexedDB (this browser)' : 'Storage: localStorage fallback') + '</h4>' +
      '<p>' + (mode === 'idb'
        ? 'Your journal is stored locally in this browser profile using IndexedDB, which holds your tickets, sessions, metrics, assessments, and compressed image attachments.'
        : 'IndexedDB was unavailable, so records are kept in localStorage. This has a smaller size limit — prefer the JSON export for large journals, and consider serving the app over http://localhost for full IndexedDB support.') +
      '</p><p class="strong">' + Icons.svg('alert') + ' Local-only means local-only: nothing is uploaded, but nothing is backed up either. Clearing browser data, ' +
      'a profile reset, or device failure can erase it. Export a JSON backup after every meaningful stretch of logging.</p></div>' +

      '<div class="count-grid">' +
      Object.keys(counts).map((k) => '<div class="count"><span class="k">' + esc(k) + '</span><span class="v">' + counts[k] + '</span></div>').join('') +
      '</div>' +

      '<h4>Export</h4>' +
      '<div class="btn-row">' +
      '<button class="btn primary" data-act="export-json">' + Icons.svg('download') + ' Full JSON backup (incl. images)</button>' +
      '<button class="btn" data-act="export-json-nofiles">' + Icons.svg('download') + ' JSON (data only, no images)</button>' +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="csv-obs">CSV: observations</button>' +
      '<button class="btn" data-act="csv-daily">CSV: daily tickets</button>' +
      '<button class="btn" data-act="csv-assess">CSV: assessments</button>' +
      '<button class="btn" data-act="csv-metrics">CSV: metric definitions</button>' +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="shared-report">' + Icons.svg('file') + ' Shared report (Markdown)</button>' +
      '<label class="toggle"><input type="checkbox" data-act="inc-sensitive"> Include sensitive profile information</label>' +
      '</div>' +

      '<h4>Import / restore</h4>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="import">' + Icons.svg('upload') + ' Import JSON backup…</button>' +
      '<input type="file" accept="application/json,.json" data-import hidden>' +
      '</div>' +
      '<div class="hint">Import merges records by id. Conflicting records (same id, different content) are skipped by default so nothing is silently overwritten.</div>' +

      '<h4>Maintenance</h4>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="sample">Load sample data</button>' +
      '<button class="btn danger" data-act="erase">Erase everything…</button>' +
      '<button class="btn danger" data-act="erase-wm">Erase WM assessment data only…</button>' +
      '</div>' +

      '<h4>Modes &amp; metrics</h4>' +
      '<div class="btn-row"><button class="btn" data-act="defs">Manage training modes &amp; metric definitions…</button></div>' +
      '</div>');

    const m = UI.modal({ title: 'Data & Backup', body, wide: true });

    body.querySelector('[data-act="export-json"]').addEventListener('click', () => {
      Exporter.exportJSON({ attachments: true, sensitive: body.querySelector('[data-act="inc-sensitive"]').checked });
      UI.toast('JSON backup downloaded.');
    });
    body.querySelector('[data-act="export-json-nofiles"]').addEventListener('click', () => {
      Exporter.exportJSON({ attachments: false, sensitive: body.querySelector('[data-act="inc-sensitive"]').checked });
      UI.toast('JSON (data only) downloaded.');
    });
    body.querySelector('[data-act="csv-obs"]').addEventListener('click', () => Exporter.exportObservationsCSV());
    body.querySelector('[data-act="csv-daily"]').addEventListener('click', () => Exporter.exportDailyCSV());
    body.querySelector('[data-act="csv-assess"]').addEventListener('click', () => Exporter.exportAssessmentsCSV());
    body.querySelector('[data-act="csv-metrics"]').addEventListener('click', () => Exporter.exportMetricsCSV());
    body.querySelector('[data-act="shared-report"]').addEventListener('click', () => {
      Exporter.exportSharedReport({ sensitive: body.querySelector('[data-act="inc-sensitive"]').checked });
      UI.toast('Shared report downloaded (sensitive fields ' + (body.querySelector('[data-act="inc-sensitive"]').checked ? 'included' : 'excluded') + ').');
    });

    const importBtn = body.querySelector('[data-act="import"]');
    const importInput = body.querySelector('[data-import]');
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;
      const replace = await UI.confirm({
        title: 'Import mode',
        messageHtml: 'Replace <em>all</em> current data with the contents of this backup?<br><br>' +
          '<strong>Merge</strong> keeps existing records and adds/updates from the file (conflicts are skipped).<br>' +
          '<strong>Replace</strong> wipes the current journal and restores from the file.',
        okLabel: 'Replace all', cancelLabel: 'Merge (safer)'
      });
      try {
        const res = await Exporter.importBundle(file, { replaceAll: replace });
        UI.toast(replace
          ? 'Backup restored (' + res.added + ' records).'
          : 'Merged: ' + res.added + ' added, ' + res.updated + ' updated, ' + res.skippedConflicts + ' conflict(s) skipped.');
        m.close();
      } catch (e) {
        UI.toast('Import failed: ' + e.message, 'error');
      }
    });

    body.querySelector('[data-act="sample"]').addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Load sample data?', message: 'Adds ~6 weeks of demo tickets, sessions and two assessments.', okLabel: 'Load sample data' });
      if (!ok) return;
      await Store.loadSampleData();
      UI.toast('Sample data loaded.');
      m.close();
    });

    body.querySelector('[data-act="erase"]').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Erase ALL data?',
        messageHtml: 'This permanently deletes every ticket, session, observation, assessment, attachment, profile entry, <strong>and all WM assessment data (sessions, trials, seeds, configuration history)</strong> on this device, then restores the default empty state with starter training modes and metrics.<br><br><strong>This cannot be undone.</strong> Export a backup first if there is any chance you will want this data.',
        okLabel: 'Erase everything'
      });
      if (!ok) return;
      await Store.eraseAll();
      UI.toast('All data erased (journal + WM assessments).');
      m.close();
    });

    body.querySelector('[data-act="erase-wm"]').addEventListener('click', async () => {
      if (!window.WMStore) return;
      const ok = await UI.confirm({
        title: 'Erase WM assessment data?',
        messageHtml: 'Deletes all assessment sessions, blocks, trials, seeds, and configuration history for the WM Assessment Platform. Your journal (tickets, sessions, metrics) is untouched.<br><br><strong>This cannot be undone.</strong>',
        okLabel: 'Erase WM data'
      });
      if (!ok) return;
      await WMStore.deleteAllData();
      UI.toast('WM assessment data erased.');
      m.close();
    });

    body.querySelector('[data-act="defs"]').addEventListener('click', () => { m.close(); Definitions.open(); });
  }

  /* ---------- modes & metrics definitions manager ---------- */

  window.Definitions = (function () {
    const { el: h, esc: e } = U;
    function open() {
      const body = h('<div class="defs-panel"></div>');
      const m = UI.modal({ title: 'Training modes & metric definitions', body, wide: true });
      render();
      function render() {
        body.innerHTML = '';
        body.appendChild(modesSection());
        body.appendChild(metricsSection());
        bind();
      }
      function modesSection() {
        const list = Store.state.modes.slice().sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
        const sec = h('<section><div class="panel-head"><h3>Training modes</h3>' +
          '<button class="btn tiny" data-act="addmode">' + Icons.svg('plus') + ' Add mode</button></div>' +
          '<div class="def-list">' + list.map((mo) =>
            '<div class="def-row' + (mo.archived ? ' archived' : '') + '">' +
            '<i class="dot big" style="background:' + e(mo.color || '#888') + '"></i>' +
            '<input data-mode-name="' + e(mo.id) + '" value="' + e(mo.name) + '">' +
            '<input data-mode-color="' + e(mo.id) + '" type="color" value="' + e(mo.color || '#4f7cff') + '" title="Colour (consistent across all graphs)">' +
            '<span class="badge soft">' + (mo.archived ? 'archived' : Store.state.sessions.filter((s) => s.modeId === mo.id).length + ' sessions') + '</span>' +
            '<button class="btn tiny" data-archmode="' + e(mo.id) + '">' + (mo.archived ? 'Restore' : 'Archive') + '</button>' +
            '<button class="icon-btn danger" data-delmode="' + e(mo.id) + '" title="Delete">' + Icons.svg('trash') + '</button></div>').join('') +
          '</div><div class="hint mt">Archiving keeps historical records intact; a mode with sessions can’t be hard-deleted.</div></section>');
        return sec;
      }
      function metricsSection() {
        const list = Store.state.metrics.slice().sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
        const sec = h('<section><div class="panel-head"><h3>Metric definitions</h3>' +
          '<button class="btn tiny" data-act="addmetric">' + Icons.svg('plus') + ' Add metric</button></div>' +
          '<div class="def-list">' + list.map((me) =>
            '<div class="def-row metric' + (me.archived ? ' archived' : '') + '">' +
            '<div class="def-main"><strong>' + e(me.name) + '</strong> ' +
            '<span class="badge soft">' + e(me.unit || 'no unit') + '</span>' +
            '<span class="badge soft">' + e(me.dataType) + '</span>' +
            '<span class="badge soft">' + e((me.direction || '').replace('_', ' ')) + '</span>' +
            '<span class="badge soft">v' + e(String(me.currentVersion || 1)) + '</span>' +
            (me.min != null || me.max != null ? '<span class="badge soft">range ' + e(me.min == null ? '…' : me.min) + '–' + e(me.max == null ? '…' : me.max) + '</span>' : '') +
            (me.target != null ? '<span class="badge soft">target ' + e(me.target) + '</span>' : '') +
            '</div>' +
            '<div class="def-desc">' + e(me.description || '') + '</div>' +
            '<div class="def-actions">' +
            '<button class="btn tiny" data-editmetric="' + e(me.id) + '">Edit definition</button>' +
            '<button class="btn tiny" data-archmetric="' + e(me.id) + '">' + (me.archived ? 'Restore' : 'Archive') + '</button>' +
            '</div></div>').join('') +
          '</div><div class="hint mt">Editing a definition creates a new version — past observations keep their original version number so results computed under different definitions are never silently pooled.</div></section>');
        return sec;
      }
      function bind() {
        body.querySelector('[data-act="addmode"]').addEventListener('click', async () => {
          const name = await UI.promptText({ title: 'New training mode', label: 'Mode / task name' });
          if (!name) return;
          await Store.saveMode({ name, description: '', color: '' });
          render();
        });
        body.querySelectorAll('[data-mode-name]').forEach((inp) => inp.addEventListener('change', async () => {
          const mo = Store.modeById(inp.dataset.modeName);
          if (mo) { mo.name = inp.value; await Store.saveMode(mo); }
        }));
        body.querySelectorAll('[data-mode-color]').forEach((inp) => inp.addEventListener('change', async () => {
          const mo = Store.modeById(inp.dataset.modeColor);
          if (mo) { mo.color = inp.value; await Store.saveMode(mo); }
        }));
        body.querySelectorAll('[data-archmode]').forEach((b) => b.addEventListener('click', async () => {
          await Store.deleteMode(b.dataset.archmode); render();
        }));
        body.querySelectorAll('[data-delmode]').forEach((b) => b.addEventListener('click', async () => {
          const res = await Store.deleteMode(b.dataset.delmode);
          if (res.archived) UI.toast('Mode is in use — it was archived instead of deleted so history stays intact.');
          render();
        }));
        body.querySelector('[data-act="addmetric"]').addEventListener('click', () => { MetricEditor.open(null); setTimeout(render, 50); });
        body.querySelectorAll('[data-editmetric]').forEach((b) => b.addEventListener('click', () => { MetricEditor.open(b.dataset.editmetric); setTimeout(render, 50); }));
        body.querySelectorAll('[data-archmetric]').forEach((b) => b.addEventListener('click', async () => {
          await Store.archiveMetric(b.dataset.archmetric); render();
        }));
      }
    }
    return { open };
  })();

  window.MetricEditor = (function () {
    const { el: h, esc: e } = U;
    function open(id) {
      const ex = id ? Store.metricById(id) : null;
      const d = ex ? JSON.parse(JSON.stringify(ex)) : {
        id: null, name: '', unit: '', dataType: 'number', direction: 'higher_better',
        min: null, max: null, target: '', modeIds: [], description: ''
      };
      const body = h('<div class="editor">' +
        '<div class="ed-grid">' +
        '<div class="field"><label>Metric name</label><input data-m="name" value="' + e(d.name || '') + '" placeholder="e.g. d-prime"></div>' +
        '<div class="field"><label>Unit</label><input data-m="unit" value="' + e(d.unit || '') + '" placeholder="%, ms, back, count…"></div>' +
        '<div class="field"><label>Data type</label><select data-m="dataType">' +
        [['number', 'Number (decimal)'], ['integer', 'Integer (count)'], ['percent', 'Percentage (0–100)'], ['duration_ms', 'Duration (ms)'], ['level', 'Level / difficulty'], ['text', 'Free text']].map(([v, l]) =>
          '<option value="' + v + '"' + (d.dataType === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>Scoring direction</label><select data-m="direction">' +
        [['higher_better', 'Higher is better'], ['lower_better', 'Lower is better'], ['target', 'Target value'], ['neutral', 'Neutral / no direction']].map(([v, l]) =>
          '<option value="' + v + '"' + (d.direction === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<div class="hint">Drives ▲/▼ colouring in statistics.</div></div>' +
        '<div class="field"><label>Minimum valid value</label><input type="number" step="any" data-m="min" value="' + e(d.min == null ? '' : d.min) + '"></div>' +
        '<div class="field"><label>Maximum valid value</label><input type="number" step="any" data-m="max" value="' + e(d.max == null ? '' : d.max) + '"></div>' +
        '<div class="field"><label>Target value (optional)</label><input type="number" step="any" data-m="target" value="' + e(d.target == null ? '' : d.target) + '"></div>' +
        '<div class="field span2"><label>Description / calculation notes</label><textarea rows="2" data-m="description" placeholder="How is this computed? What conditions matter for comparability?">' + e(d.description || '') + '</textarea></div>' +
        '<div class="field span2"><label>Relevant training modes</label><div class="mode-checks">' +
        Store.state.modes.map((mo) =>
          '<label class="check"><input type="checkbox" data-modechk="' + e(mo.id) + '"' + (d.modeIds && d.modeIds.indexOf(mo.id) >= 0 ? ' checked' : '') + '> ' +
          '<i class="dot" style="background:' + e(mo.color) + '"></i>' + e(mo.name) + '</label>').join('') +
        '</div><div class="hint">Leave all unchecked to allow the metric with any mode.</div></div>' +
        '</div>' +
        (ex ? '<div class="version-history"><h4>Definition history</h4>' + (ex.versions || []).map((v) =>
          '<div class="vh-row">v' + e(String(v.v)) + ' · ' + e(U.fmtDateTime(v.changedAt)) + ' — ' + e(v.note || '') + '</div>').join('') + '</div>' : '') +
        '<div class="ed-footer"><span class="grow"></span><button class="btn" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="save">Save metric</button></div>' +
        '</div>');
      const m = UI.modal({ title: ex ? 'Edit metric definition' : 'New metric definition', body, wide: true });
      body.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      body.querySelector('[data-act="save"]').addEventListener('click', async () => {
        body.querySelectorAll('[data-m]').forEach((inp) => { d[inp.dataset.m] = inp.value; });
        d.modeIds = Array.from(body.querySelectorAll('[data-modechk]:checked')).map((c) => c.dataset.modechk);
        if (!d.name.trim()) { UI.toast('A metric needs a name.', 'error'); return; }
        const wasNew = !d.id;
        await Store.saveMetric(d);
        UI.toast(wasNew ? 'Metric “' + d.name + '” created.' : 'Metric updated' + (Store.metricById(d.id).currentVersion > 1 ? ' — new definition version recorded.' : '.'));
        m.close();
        const view = document.getElementById('view');
        if (view && document.querySelector('.defs-panel')) Definitions.open();
      });
    }
    return { open };
  })();

  /* ---------- go ---------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
