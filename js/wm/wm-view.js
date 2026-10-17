/* WM Assessment Platform — view shell + Dashboard, Assessment Session,
   Task Configuration, Assessment Settings (spec §1–§5, §7, §12).

   Sections receive an empty container and own their own rendering. Analytics,
   History, Data Management, and Methodology live in wm-view2.js, which registers
   into `sections` as well. */

window.ViewWM = (function () {
  'use strict';
  const { el, esc } = U;

  const sections = {};

  const NAV = [
    ['dashboard', 'Dashboard'],
    ['session', 'Assessment session'],
    ['config', 'Task configuration'],
    ['analytics', 'Performance analytics'],
    ['history', 'Session history'],
    ['data', 'Data management'],
    ['settings', 'Assessment settings'],
    ['methodology', 'Methodology & limitations']
  ];

  function go(sub) {
    location.hash = '#wm' + (sub && sub !== 'dashboard' ? '/' + sub : '');
  }

  /* ================= shared builders ================= */

  function panel(title, sub, controlsHtml) {
    const root = el('<section class="panel card"></section>');
    const head = el('<div class="panel-head"><div><h2>' + esc(title) + '</h2>' +
      (sub ? '<div class="panel-sub">' + sub + '</div>' : '') + '</div>' +
      (controlsHtml ? '<div class="panel-controls">' + controlsHtml + '</div>' : '') + '</div>');
    root.appendChild(head);
    const body = el('<div class="wm-body"></div>');
    root.appendChild(body);
    return { root, body, controls: head.querySelector('.panel-controls') };
  }

  function statCard(label, value, sub) {
    return el('<div class="stat-card"><div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value">' + esc(String(value)) + '</div>' +
      '<div class="stat-sub">' + esc(sub || '') + '</div></div>');
  }

  function famChip(f) {
    const meta = WMTasks.FAMILIES[f] || {};
    const c = meta.color || '#888';
    return '<span class="chip" style="border-color:' + c + ';color:' + c + '">' +
      esc(f + ' · ' + (meta.short || f)) + '</span>';
  }

  function statusChip(status) {
    const map = {
      completed: ['✔ Completed', 'wm-ok'],
      in_progress: [Icons.svg('pause') + ' Resumable', 'wm-open'],
      incomplete: ['◐ Ended early', 'wm-warn']
    };
    const m = map[status] || [esc(status), ''];
    return '<span class="chip ' + m[1] + '">' + m[0] + '</span>';
  }

  /* Categorical distributions (difficulty / load / error classes) render as HTML
     bar rows: the shared chart engine's bar mode expects date-like x values. */
  function barRows(rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return el('<p class="hint">' + esc(opts.empty || 'No data recorded yet.') + '</p>');
    const wrap = el('<div class="wm-bars"></div>');
    rows.forEach((r) => {
      const width = Math.max(0, Math.min(100, r.pct == null ? 0 : r.pct));
      const row = el('<div class="wm-bar-row">' +
        '<div class="wm-bar-label">' + esc(r.label) + '</div>' +
        '<div class="wm-bar-track"><div class="wm-bar-fill" style="width:' + width + '%;' +
        (r.color ? 'background:' + r.color + ';' : '') + '"></div></div>' +
        '<div class="wm-bar-val">' + esc(r.valueLabel != null ? String(r.valueLabel) : (r.pct != null ? r.pct + '%' : String(r.n || 0))) + '</div>' +
        '</div>');
      if (r.tip) row.title = r.tip;
      wrap.appendChild(row);
    });
    return wrap;
  }

  function noteBox(kind, html) {
    return el('<div class="wm-note ' + (kind || '') + '">' + html + '</div>');
  }

  function num(v, dp) { return U.fmtNum(v, dp); }
  function pctStr(v, dp) { return v == null ? '—' : num(v, dp == null ? 1 : dp) + '%'; }

  /* ================= shell ================= */

  function render(host, sub) {
    const key = sections[sub] ? sub : 'dashboard';
    host.innerHTML = '';
    const wrap = el('<div class="page wm-page"></div>');

    const nav = el('<nav class="wm-nav" aria-label="WM assessment sections"></nav>');
    NAV.forEach(([id, label]) => {
      const b = el('<button type="button" class="chip-btn' + (id === key ? ' on' : '') + '"></button>');
      b.textContent = label;
      b.addEventListener('click', () => go(id));
      nav.appendChild(b);
    });
    wrap.appendChild(nav);

    if (window.WMRunner && WMRunner.isActive()) {
      wrap.appendChild(el('<div class="wm-note caution"><strong>Assessment in progress.</strong> ' +
        'The session overlay owns the screen until it is paused, ended early, or completed. ' +
        'Nothing on this page can alter the running session.</div>'));
    }

    const sec = el('<div class="wm-sec"></div>');
    wrap.appendChild(sec);
    host.appendChild(wrap);
    sections[key](sec);
  }

  /* ================= 1 · Dashboard ================= */

  sections.dashboard = function (host) {
    const dash = WMAnalytics.dashboard();
    const cfg = WMStore.currentConfig();
    const storeMode = DB.storageMode === 'idb' ? 'IndexedDB' : 'localStorage fallback';

    /* header + actions */
    const head = panel('Cognitive assessment dashboard',
      'Procedurally generated working-memory assessments. Every score below is per task family — ' +
      'this app never produces a single global working-memory score.',
      '<button class="btn" data-act="config">Task configuration</button>' +
      (dash.openSession ? '<button class="btn primary" data-act="resume">Resume session</button>'
        : '<button class="btn primary" data-act="start">Start assessment</button>'));
    host.appendChild(head.root);

    /* stat strip */
    const strip = el('<div class="stat-strip wm-stats"></div>');
    strip.appendChild(statCard('Completed sessions', dash.completedCount,
      dash.target ? 'target ' + dash.target + ' · ' + dash.progressPct + '%' : 'no target set'));
    strip.appendChild(statCard('Open session', dash.openSession ? 'Yes' : 'None',
      dash.openSession ? 'session #' + dash.openSession.number + ' can be resumed' : 'nothing waiting to resume'));
    strip.appendChild(statCard('Ended early', dash.incompleteCount,
      'kept for transparency, never counted as completed'));
    strip.appendChild(statCard('Storage', storeMode, 'local only — no account, no server'));
    strip.appendChild(statCard('Timing integrity', dash.timing.deviations + ' deviation' + (dash.timing.deviations === 1 ? '' : 's'),
      dash.timing.trialsTimed ? 'flagged across ' + dash.timing.trialsTimed + ' timed trials' : 'no timed trials yet'));
    head.body.appendChild(strip);

    /* target progress bar */
    if (dash.target) {
      const bar = el('<div class="wm-progress"><div class="wm-progress-track">' +
        '<div class="wm-progress-fill" style="width:' + dash.progressPct + '%"></div></div>' +
        '<div class="wm-progress-cap">' + dash.completedCount + ' of ' + dash.target + ' planned sessions</div></div>');
      head.body.appendChild(bar);
    }

    /* open session callout */
    if (dash.openSession) {
      const s = dash.openSession;
      const answered = WMStore.sessionTrials(s.id).filter((t) => t.completedAt).length;
      const box = el('<div class="wm-callout"><div><strong>Session #' + s.number + ' is unfinished.</strong> ' +
        'Started ' + esc(U.fmtDateTime(s.startedAt)) + ' · ' + answered + ' of ' + s.trialsPlanned + ' trials answered · ' +
        (s.interruptions || []).length + ' interruption(s) recorded. ' +
        'It stays resumable at the exact trial where it stopped.</div>' +
        '<div class="btn-row"><button class="btn primary" data-act="resume">Resume</button>' +
        '<button class="btn danger" data-act="discard">Discard…</button></div></div>');
      head.body.appendChild(box);
      box.querySelector('[data-act="resume"]').addEventListener('click', () => WMRunner.resume());
      box.querySelector('[data-act="discard"]').addEventListener('click', async () => {
        const ok = await UI.confirm({
          title: 'Discard unfinished session #' + s.number + '?',
          message: 'Deletes this session, its blocks, and all its trials (answered and pending). Other sessions are untouched.',
          okLabel: 'Discard session'
        });
        if (!ok) return;
        await WMStore.deleteSession(s.id);
        UI.toast('Session discarded.');
      });
    }

    /* next scheduled */
    if (dash.next && dash.completedCount) {
      head.body.appendChild(noteBox('', '<strong>Next scheduled assessment:</strong> ' +
        esc(dash.next.date) + ' (every ' + dash.next.intervalDays + ' day' + (dash.next.intervalDays === 1 ? '' : 's') + ', from Assessment Settings / Task configuration).'));
    }

    /* latest per family */
    const famPanel = panel('Latest result by task family',
      'Each family is scored on its own scale with its own 95% Wilson interval. Families with no completed data show “no data” rather than a number.');
    host.appendChild(famPanel.root);
    const famStrip = el('<div class="stat-strip wm-stats"></div>');
    const familiesOn = Object.keys(cfg.families).filter((f) => cfg.families[f]);
    const famList = familiesOn.length ? familiesOn : Object.keys(WMTasks.FAMILIES);
    famList.forEach((f) => {
      const meta = WMTasks.FAMILIES[f] || {};
      const latest = dash.latest[f];
      if (!latest) {
        famStrip.appendChild(statCard(meta.short || f, 'No data', 'family ' + f + ' · ' + (cfg.variants[f] || '—')));
        return;
      }
      famStrip.appendChild(statCard(meta.short || f,
        pctStr(latest.y),
        'session ' + latest.number + ' · ' + latest.date + ' · ' + latest.trials + ' trials'));
    });
    famPanel.body.appendChild(famStrip);
    famPanel.body.appendChild(noteBox('', esc(WMAnalytics.capacityDisclaimer())));

    /* trajectory chart */
    const trajPanel = panel('Accuracy trajectories (observed, per family)',
      'Points are session accuracy; hover for the session id, config version, and interval. ' +
      'A line joining points shows observed scores across sessions — not latent ability.');
    host.appendChild(trajPanel.root);
    const chartHost = el('<div class="chart-host" data-chart></div>');
    trajPanel.body.appendChild(chartHost);
    trajPanel.body.appendChild(noteBox('', esc(WMAnalytics.ciNote())));

    /* config warnings */
    if (dash.configWarnings.length) {
      const w = panel('Configuration-change warnings',
        'Sessions ran under different configurations. Comparing them is allowed but flagged — ' +
        'differences may reflect the configuration, not the participant.');
      host.appendChild(w.root);
      dash.configWarnings.forEach((cw) => {
        w.body.appendChild(el('<div class="wm-note warn">' + esc(cw.note) + '</div>'));
      });
    }

    /* recent sessions */
    const recent = WMStore.sortedSessions(true).slice(-6).reverse();
    const rec = panel('Recent sessions', 'Newest first. Incomplete and open sessions are listed with their true status.');
    host.appendChild(rec.root);
    if (!recent.length) {
      rec.body.appendChild(el('<p class="hint">No assessment sessions yet. Start one from the Assessment session tab — ' +
        'each run generates its own items from a stored seed.</p>'));
    } else {
      rec.body.appendChild(sessionTable(recent, { compact: true }));
    }

    /* wire actions */
    const startBtn = head.controls && head.controls.querySelector('[data-act="start"]');
    if (startBtn) startBtn.addEventListener('click', () => WMRunner.startNew());
    const resumeBtn = head.controls && head.controls.querySelector('[data-act="resume"]');
    if (resumeBtn) resumeBtn.addEventListener('click', () => WMRunner.resume());
    const cfgBtn = head.controls && head.controls.querySelector('[data-act="config"]');
    if (cfgBtn) cfgBtn.addEventListener('click', () => go('config'));

    /* chart renders after it is in the DOM (needs clientWidth) */
    Charts.render(chartHost, WMAnalytics.trajectoryChart(dash.trajectories));
  };

  /* Shared compact session table (dashboard + analytics use it). */
  function sessionTable(list, opts) {
    opts = opts || {};
    const t = el('<table class="cmp-table wm-table"><thead><tr>' +
      '<th>#</th><th>Date</th><th>Status</th><th>Families</th><th>Trials</th><th>Config</th>' +
      (opts.compact ? '' : '<th>Seed</th>') + '</tr></thead><tbody></tbody></table>');
    const tb = t.querySelector('tbody');
    list.forEach((s) => {
      const fams = Object.keys(s.config.families).filter((f) => s.config.families[f]);
      const row = el('<tr data-id="' + esc(s.id) + '" class="clickable">' +
        '<td>' + s.number + '</td>' +
        '<td>' + esc(s.date) + '</td>' +
        '<td>' + statusChip(s.status) + '</td>' +
        '<td>' + fams.map((f) => famChip(f)).join(' ') + '</td>' +
        '<td>' + (s.trialsCompleted || 0) + ' / ' + (s.trialsPlanned || 0) + '</td>' +
        '<td>v' + s.configVersion + '</td>' +
        (opts.compact ? '' : '<td><code>' + esc(s.seedHex || '—') + '</code></td>') +
        '</tr>');
      row.addEventListener('click', () => {
        if (opts.onOpen) opts.onOpen(s);
        else go('history');
      });
      tb.appendChild(row);
    });
    return t;
  }

  /* ================= 2 · Assessment session ================= */

  sections.session = function (host) {
    const open = WMStore.inProgress();

    /* --- resume card --- */
    if (open) {
      const p = panel('Unfinished session', 'Interrupted sessions are saved trial by trial — resume continues at the exact stopping point.');
      host.appendChild(p.root);
      const answered = WMStore.sessionTrials(open.id).filter((t) => t.completedAt).length;
      const stats = el('<div class="stat-strip wm-stats"></div>');
      stats.appendChild(statCard('Session', '#' + open.number, open.date));
      stats.appendChild(statCard('Progress', answered + ' / ' + open.trialsPlanned, 'trials answered'));
      stats.appendChild(statCard('Started', U.fmtDateTime(open.startedAt), 'local time'));
      stats.appendChild(statCard('Interruptions', String((open.interruptions || []).length),
        (open.timingDeviations || 0) + ' timing deviations recorded'));
      p.body.appendChild(stats);
      const row = el('<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn primary" data-act="resume">Resume session</button>' +
        '<button class="btn danger" data-act="discard">Discard…</button></div>');
      p.body.appendChild(row);
      row.querySelector('[data-act="resume"]').addEventListener('click', () => WMRunner.resume());
      row.querySelector('[data-act="discard"]').addEventListener('click', async () => {
        const ok = await UI.confirm({
          title: 'Discard unfinished session #' + open.number + '?',
          message: 'Deletes this session, its blocks, and all its trials. Completed sessions are untouched.',
          okLabel: 'Discard session'
        });
        if (!ok) return;
        await WMStore.deleteSession(open.id);
        UI.toast('Session discarded.');
      });
    }

    /* --- procedure --- */
    const proc = panel('Session procedure',
      'Identical for every run. Configuration is locked when the session starts — changes afterwards create a new version and never alter a session already in flight.');
    host.appendChild(proc.root);
    const steps = [
      ['Overview', 'Session summary, configuration, and any configuration-change or timing cautions are shown before anything begins.'],
      ['Instructions', 'The rule for each task family and variant, stated explicitly.'],
      ['Familiarization', 'A couple of practice trials per family with feedback — the only place feedback ever appears. These trials are excluded from every score and every export by default.'],
      ['Ready screen', 'A pause point so the first scored trial never starts while you are still reading.'],
      ['Scored trials', 'Stimulus → response → inter-trial interval, per block. <strong>No correctness feedback during scored trials.</strong> Pauses, visibility loss, and timing deviations are recorded.'],
      ['Scoring & summary', 'Per-family scores with denominators and intervals; the summary can be reopened any time from Session History.']
    ];
    const ol = el('<ol class="wm-steps"></ol>');
    steps.forEach(([title, desc]) => {
      ol.appendChild(el('<li><strong>' + title + '</strong> — ' + desc + '</li>'));
    });
    proc.body.appendChild(ol);
    proc.body.appendChild(el('<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn primary" data-act="start">Start new assessment session</button>' +
      '<button class="btn" data-act="config">Review task configuration</button></div>'));

    /* --- current config summary --- */
    const cfg = WMStore.currentConfig();
    const cver = WMStore.currentConfigVersion();
    const conf = panel('Configuration locked at start', 'Version ' + cver + ' · what the next session will use.');
    host.appendChild(conf.root);
    conf.body.appendChild(configSummary(cfg));

    const prev = WMStore.sortedSessions(true)
      .filter((x) => x.status !== 'in_progress' && x.id !== (open && open.id))
      .slice(-1)[0];
    if (prev && prev.configVersion !== cver) {
      const changes = WMStore.diffConfigs(prev.config, cfg);
      conf.body.appendChild(noteBox('warn',
        '<strong>Materially different from session #' + prev.number + ' (v' + prev.configVersion + ' → v' + cver + ').</strong> ' +
        'Analytics will flag comparisons across these versions. Changes: ' +
        esc(changes.map((c) => c.field + ' (' + c.from + ' → ' + c.to + ')').join('; ') || 'see configuration history') + '.'));
    }

    /* --- familiarization checklist --- */
    const fam = panel('Familiarization status',
      'Practice trials must be completed (with feedback) before a family counts in a scored session. Reset to re-run practice for a changed rule.');
    host.appendChild(fam.root);
    const settings = WMStore.getSettings();
    const famList = el('<div class="wm-checklist"></div>');
    Object.keys(cfg.families).filter((f) => cfg.families[f]).forEach((f) => {
      const v = cfg.variants[f];
      const key = f + ':' + v;
      const done = (settings.familiarization || {})[key];
      const vname = (WMTasks.FAMILIES[f].variants.find((x) => x.id === v) || {}).name || v;
      const item = el('<div class="wm-checkrow' + (done ? ' done' : '') + '">' +
        '<div class="wm-check-fam">' + famChip(f) + '</div>' +
        '<div class="wm-check-name">' + esc(vname) + '</div>' +
        '<div class="wm-check-state">' + (done ? '✔ practiced ' + esc(done) : '○ not yet practiced') + '</div>' +
        '</div>');
      famList.appendChild(item);
    });
    fam.body.appendChild(famList);
    fam.body.appendChild(el('<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn tiny" data-act="reset-fam">Reset all familiarization…</button></div>'));
    fam.body.querySelector('[data-act="reset-fam"]').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Reset familiarization?',
        message: 'Clears the practice-complete flags for every family/variant. The next session will show practice trials again (still excluded from scores).',
        okLabel: 'Reset'
      });
      if (!ok) return;
      await WMStore.resetFamiliarization();
      UI.toast('Familiarization reset.');
    });

    /* --- last completed summary --- */
    const done = WMStore.completedSessions();
    const last = done[done.length - 1];
    if (last && last.results) {
      const lp = panel('Last completed summary', 'Session #' + last.number + ' · ' + last.date + ' · config v' + last.configVersion +
        ' · ' + (last.results.complete ? 'completed' : 'partial'));
      host.appendChild(lp.root);
      lp.body.appendChild(resultsTable(last.results));
      const open2 = el('<div class="btn-row" style="margin-top:10px"><button class="btn tiny" data-act="hist">Open in Session History</button></div>');
      lp.body.appendChild(open2);
      open2.querySelector('[data-act="hist"]').addEventListener('click', () => go('history'));
    }

    proc.body.querySelector('[data-act="start"]').addEventListener('click', () => WMRunner.startNew());
    proc.body.querySelector('[data-act="config"]').addEventListener('click', () => go('config'));
  };

  /** Small key/value summary of a config. */
  function configSummary(cfg) {
    const fams = Object.keys(cfg.families).filter((f) => cfg.families[f]);
    const rows = [
      ['Families', fams.length ? fams.map((f) => f + ' ' + (cfg.variants[f] || '')).join(', ') : 'none enabled'],
      ['Trials per task', 'A ' + cfg.trialsPerTask.A + ' · B ' + cfg.trialsPerTask.B + ' · C ' + cfg.trialsPerTask.C + ' · D ' + cfg.trialsPerTask.D],
      ['Timing (ms)', 'stimulus ' + cfg.timing.stimulusMs + ' · ISI ' + cfg.timing.isiMs + ' · retention ' + cfg.timing.retentionMs +
        ' · response window ' + cfg.timing.responseMs + ' · ITI ' + cfg.timing.itiMs],
      ['Difficulty distribution', WMBlueprint.LEVELS.map((l) => WMBlueprint.LEVEL_LABEL[l] + ' ' + cfg.blueprint[l] + '%').join(' · '),
        'fixed, not adaptive (v1)'],
      ['Modality (B)', cfg.modality.B === 'auditory' ? 'auditory (spoken items, recorded per trial)' : 'visual (recorded per trial)'],
      ['Item sets', 'B ' + cfg.itemSet.B + ' · C ' + cfg.itemSet.C],
      ['Familiarization', cfg.familiarizationTrials + ' practice trial(s) per family — excluded from scores'],
      ['Sessions planned', cfg.sessionsToTrack + (cfg.scheduleEnabled ? ' · every ' + cfg.intervalDays + ' day(s)' : ' · no schedule reminders')]
    ];
    const t = el('<table class="cmp-table wm-table"><tbody></tbody></table>');
    const tb = t.querySelector('tbody');
    rows.forEach((r) => {
      tb.appendChild(el('<tr><th style="width:180px">' + esc(r[0]) + '</th><td>' + esc(r[1]) +
        (r[2] ? '<div class="hint">' + esc(r[2]) + '</div>' : '') + '</td></tr>'));
    });
    return t;
  }

  /** Per-family result rows for a session results object. */
  function resultsTable(results) {
    const t = el('<table class="cmp-table wm-table"><thead><tr>' +
      '<th>Family</th><th>Variant</th><th>Accuracy</th><th>95% CI</th><th>Trials</th>' +
      '<th>Median RT</th><th>Notes</th></tr></thead><tbody></tbody></table>');
    const tb = t.querySelector('tbody');
    Object.keys(results.families || {}).forEach((f) => {
      const r = results.families[f];
      const meta = WMTasks.FAMILIES[f] || {};
      const ci = r.ci95 ? (Math.round(r.ci95[0] * 1000) / 10) + '–' + (Math.round(r.ci95[1] * 1000) / 10) + '%' : '—';
      const notes = [];
      if (r.signalDetection) notes.push('d′ = ' + (r.signalDetection.dprime == null ? '—' : num(r.signalDetection.dprime, 2)) +
        ' (' + r.signalDetection.correction + ')');
      if (r.storage && r.processing) notes.push('storage ' + pctStr(r.storage.accuracyPct) + ' / processing ' + pctStr(r.processing.accuracyPct));
      tb.appendChild(el('<tr><td>' + famChip(f) + '</td><td>' + esc(r.variant || '') + '</td>' +
        '<td><strong>' + pctStr(r.accuracyPct) + '</strong></td><td>' + ci + '</td>' +
        '<td>' + (r.trialsCompleted || 0) + '</td><td>' + (r.medianRtMs == null ? '—' : num(r.medianRtMs) + ' ms') + '</td>' +
        '<td>' + esc(notes.join(' · ') || (r.available ? '' : 'no completed scored trials')) + '</td></tr>'));
    });
    if (results.provisionalComposite != null) {
      tb.appendChild(el('<tr class="wm-composite"><th colspan="7">Provisional composite: ' +
        pctStr(results.provisionalComposite) + ' — ' + esc(results.compositeNote || 'exploratory, not validated') + '</th></tr>'));
    }
    return t;
  }

  /* ================= 3 · Task configuration ================= */

  sections.config = function (host) {
    const p = panel('Task configuration',
      'Settings here define the <strong>next</strong> session. Saving creates a new configuration version; ' +
      'sessions already recorded keep the version they ran under (spec §5, §7).');
    host.appendChild(p.root);

    const draft = JSON.parse(JSON.stringify(WMStore.currentConfig()));
    const form = el('<div class="wm-form"></div>');
    p.body.appendChild(form);

    /* -- study schedule -- */
    form.appendChild(fieldset('Study schedule', [
      numField('Sessions to track', 'sessionsToTrack', draft.sessionsToTrack, 1, 100, 'How many completed sessions this plan aims for (dashboard progress).'),
      checkField('Show schedule reminders', draft.scheduleEnabled, 'Adds a “next scheduled assessment” date on the dashboard.', (v) => { draft.scheduleEnabled = v; }),
      numField('Interval (days)', 'intervalDays', draft.intervalDays, 1, 60, 'Gap after a completed session before the next is due.')
    ], (root) => {
      bindNum(root, 'sessionsToTrack', draft, 1, 100);
      bindNum(root, 'intervalDays', draft, 1, 60);
    }).root);

    /* -- families & variants -- */
    const famFs = fieldset('Task families & variants', [
      '<p class="hint">Four families, each scored separately. Variants change the response rule — ' +
      'analytics never merge families, and a variant change is a material configuration change.</p>'
    ]);
    Object.keys(WMTasks.FAMILIES).forEach((f) => {
      const meta = WMTasks.FAMILIES[f];
      const row = el('<div class="wm-famrow">' +
        '<label class="check"><input type="checkbox" data-fam="' + f + '"' + (draft.families[f] ? ' checked' : '') + '> ' +
        '<strong>' + esc(f) + ' · ' + esc(meta.name) + '</strong></label>' +
        '<div class="field"><label>Variant</label><select data-variant="' + f + '">' +
        meta.variants.map((v) => '<option value="' + v.id + '"' + (draft.variants[f] === v.id ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('') +
        '</select></div>');
      if (f === 'B') {
        row.appendChild(el('<div class="field"><label>Modality</label><select data-modality="B">' +
          '<option value="visual"' + (draft.modality.B === 'visual' ? ' selected' : '') + '>Visual (text on screen)</option>' +
          '<option value="auditory"' + (draft.modality.B === 'auditory' ? ' selected' : '') + '>Auditory (speech synthesis — timing varies by browser)</option>' +
          '</select></div>'));
        row.appendChild(el('<div class="field"><label>Item set</label><select data-itemset="B">' +
          ['letters', 'digits', 'tokens'].map((s) => '<option value="' + s + '"' + (draft.itemSet.B === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div>'));
      }
      if (f === 'C') {
        row.appendChild(el('<div class="field"><label>Item set</label><select data-itemset="C">' +
          ['letters', 'digits'].map((s) => '<option value="' + s + '"' + (draft.itemSet.C === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div>'));
      }
      famFs.body.appendChild(row);
    });
    form.appendChild(famFs.root);
    famFs.body.querySelectorAll('[data-fam]').forEach((cb) => {
      cb.addEventListener('change', () => { draft.families[cb.dataset.fam] = cb.checked; });
    });
    famFs.body.querySelectorAll('[data-variant]').forEach((sel) => {
      sel.addEventListener('change', () => { draft.variants[sel.dataset.variant] = sel.value; });
    });
    famFs.body.querySelectorAll('[data-modality]').forEach((sel) => {
      sel.addEventListener('change', () => { draft.modality[sel.dataset.modality] = sel.value; });
    });
    famFs.body.querySelectorAll('[data-itemset]').forEach((sel) => {
      sel.addEventListener('change', () => { draft.itemSet[sel.dataset.itemset] = sel.value; });
    });

    /* -- trials -- */
    const HINTS = {
      A: 'sequence trials (reproduce / reverse / identify)',
      B: 'serial-recall trials, or probe trials for recognition',
      C: 'stream steps — one continuous updating stream per block',
      D: 'lists — each list = N processing items + 1 recall'
    };
    const tfs = fieldset('Trials per task', [
      '<p class="hint">“Trials” means different units per family; the hint under each field says what is counted. ' +
      'Larger numbers give tighter intervals but longer sessions.</p>'
    ].concat(['A', 'B', 'C', 'D'].map((f) => numField('Family ' + f + ' — ' + HINTS[f], 'trials-' + f, draft.trialsPerTask[f], 1, 120))));
    form.appendChild(tfs.root);
    ['A', 'B', 'C', 'D'].forEach((f) => bindNum(tfs.root, 'trials-' + f, draft.trialsPerTask, 1, 120, f));

    /* -- timing -- */
    const TIMING = [
      ['stimulusMs', 'Stimulus duration (ms)', 'How long a stimulus stays on screen (A/B items).'],
      ['isiMs', 'Inter-stimulus interval (ms)', 'Blank gap between items.'],
      ['retentionMs', 'Retention interval (ms)', 'Delay before the response phase.'],
      ['responseMs', 'Response window (ms)', 'Deadline for C steps, D verification, and recognition probes. Open recall (A/B entry, D recall) is self-paced with RT recorded.'],
      ['itiMs', 'Inter-trial interval (ms)', 'Pause between trials.']
    ];
    const tmfs = fieldset('Timing (ms)', ['<p class="hint">Browser timing is approximate: every scheduled wait is measured, ' +
      'and drift beyond 80 ms is recorded on the trial and session rather than hidden.</p>']
      .concat(TIMING.map(([k, label, hint]) => numField(label, 'timing-' + k, draft.timing[k], 50, 30000, hint))));
    form.appendChild(tmfs.root);
    TIMING.forEach(([k]) => bindNum(tmfs.root, 'timing-' + k, draft.timing, 50, 30000, k));

    /* -- difficulty distribution -- */
    const dfs = fieldset('Difficulty distribution', [
      '<p class="hint">Fixed blueprint, identical every session (v1 is not adaptive): 25% low · ~33% moderate · 25% high · ~17% very high. ' +
      'Units are split by deterministic largest-remainder rounding, and each session records intended vs delivered. ' +
      'Difficulty means different things per family — see the table below.</p>'
    ]);
    const bpRow = el('<div class="wm-bp-row"></div>');
    WMBlueprint.LEVELS.forEach((l) => {
      const f = el('<div class="field"><label>' + esc(WMBlueprint.LEVEL_LABEL[l]) + ' (%)</label>' +
        '<input type="number" min="0" max="100" step="1" data-bp="' + l + '" value="' + draft.blueprint[l] + '"></div>');
      bpRow.appendChild(f);
    });
    const bpCap = el('<div class="wm-bp-sum" data-sum></div>');
    dfs.body.appendChild(bpRow);
    dfs.body.appendChild(bpCap);
    dfs.body.appendChild(el('<div class="btn-row"><button type="button" class="btn tiny" data-act="bp-default">Use default (25/33/25/17)</button></div>'));
    form.appendChild(dfs.root);
    dfs.body.querySelectorAll('[data-bp]').forEach((inp) => {
      inp.addEventListener('input', () => {
        draft.blueprint[inp.dataset.bp] = Math.max(0, Number(inp.value) || 0);
        updateBpSum();
      });
    });
    dfs.body.querySelector('[data-act="bp-default"]').addEventListener('click', () => {
      WMBlueprint.LEVELS.forEach((l) => {
        draft.blueprint[l] = WMBlueprint.DEFAULT[l];
        dfs.body.querySelector('[data-bp="' + l + '"]').value = WMBlueprint.DEFAULT[l];
      });
      updateBpSum();
    });
    function updateBpSum() {
      const total = WMBlueprint.LEVELS.reduce((s, l) => s + (Number(draft.blueprint[l]) || 0), 0);
      const norm = WMBlueprint.normalize(draft.blueprint);
      bpCap.className = 'wm-bp-sum ' + (total === 100 ? 'ok' : 'warn');
      bpCap.textContent = total === 100
        ? 'Sums to 100% — saved exactly as shown.'
        : 'Sums to ' + total + '% — on save this normalizes to ' +
          WMBlueprint.LEVELS.map((l) => WMBlueprint.LEVEL_LABEL[l] + ' ' + norm[l] + '%').join(' · ') + '.';
    }
    updateBpSum();

    /* -- updating parameters -- */
    form.appendChild(fieldset('Updating & practice parameters', [
      numField('Target rate for family C (%)', 'updateTargetRate', draft.updateTargetRate, 5, 60,
        'Share of stream steps that are matches, controlled per stream with no streaks longer than 2.'),
      numField('Familiarization trials per family', 'familiarizationTrials', draft.familiarizationTrials, 0, 10,
        'Practice trials with feedback before scored trials (0 disables practice).')
    ], (root) => {
      bindNum(root, 'updateTargetRate', draft, 5, 60);
      bindNum(root, 'familiarizationTrials', draft, 0, 10);
    }).root);

    /* -- difficulty parameter reference -- */
    const ref = panel('Difficulty parameters by family (read-only, v1 mapping)',
      'The same difficulty label is <strong>not</strong> equivalent across families — each family defines ' +
      'difficulty through its own task variables. Stored with every generated item.');
    host.appendChild(ref.root);
    ref.body.appendChild(familyLevelsTable());

    /* -- save -- */
    const bar = el('<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn primary" data-act="save">Save as new configuration version</button>' +
      '<button class="btn" data-act="reset">Discard changes</button></div>');
    p.body.appendChild(bar);
    bar.querySelector('[data-act="reset"]').addEventListener('click', () => go('config'));
    bar.querySelector('[data-act="save"]').addEventListener('click', async () => {
      if (!Object.keys(draft.families).some((f) => draft.families[f])) {
        UI.toast('Enable at least one task family.', 'error');
        return;
      }
      const res = await WMStore.saveConfig(draft, 'edited in Task configuration');
      if (!res.changed) {
        UI.toast('No changes — still config v' + res.version + '.');
        return;
      }
      UI.toast('Saved config v' + res.version + ' — changes: ' + res.changes.map((c) => c.field).join(', ') + '.');
      go('config');
    });
  };

  function familyLevelsTable() {
    const t = el('<table class="cmp-table wm-table"><thead><tr><th>Family</th>' +
      WMBlueprint.LEVELS.map((l) => '<th>' + esc(WMBlueprint.LEVEL_LABEL[l]) + '</th>').join('') +
      '</tr></thead><tbody></tbody></table>');
    const tb = t.querySelector('tbody');
    Object.keys(WMBlueprint.FAMILY_LEVELS).forEach((f) => {
      const tr = el('<tr><td>' + famChip(f) + '</td></tr>');
      WMBlueprint.LEVELS.forEach((l) => {
        const params = WMBlueprint.FAMILY_LEVELS[f][l];
        const parts = Object.keys(params).map((k) => k + ': ' + params[k]);
        tr.appendChild(el('<td class="wm-lvl-cell"><strong>load ' + params.load + '</strong><div class="hint">' +
          esc(parts.slice(1).join(' · ')) + '</div></td>'));
      });
      tb.appendChild(tr);
    });
    return t;
  }

  /* -- form helpers -- */

  function fieldset(legend, children, after) {
    const root = el('<fieldset class="wm-fieldset"><legend>' + esc(legend) + '</legend><div class="wm-fs-body"></div></fieldset>');
    const body = root.querySelector('.wm-fs-body');
    children.forEach((c) => {
      if (typeof c === 'string') body.appendChild(el(c));
      else if (c) body.appendChild(c);
    });
    if (after) after(root);
    return { root, body };
  }

  function numField(label, key, value, min, max, hint) {
    return el('<div class="field"><label>' + esc(label) + '</label>' +
      '<input type="number" data-num="' + esc(key) + '" min="' + min + '" max="' + max + '" value="' + esc(String(value)) + '">' +
      (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>');
  }

  function checkField(label, checked, hint, onChange) {
    const w = el('<div class="field"><label class="check"><input type="checkbox"' + (checked ? ' checked' : '') + '> ' +
      esc(label) + '</label>' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>');
    w.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
    return w;
  }

  function bindNum(root, key, target, min, max, field) {
    const inp = root.querySelector('[data-num="' + key + '"]');
    if (!inp) return;
    inp.addEventListener('input', () => {
      let v = Math.round(Number(inp.value));
      if (!isFinite(v)) return;
      v = U.clamp(v, min, max);
      if (field) target[field] = v; else target[key] = v;
    });
  }

  /* ================= 7 · Assessment settings ================= */

  sections.settings = function (host) {
    const settings = WMStore.getSettings();
    const p = panel('Assessment settings',
      'Local to this device. Nothing here is uploaded, and sensitive fields never leave the browser.');
    host.appendChild(p.root);

    /* participant */
    const part = fieldset('Participant', [
      el('<div class="field"><label>Label</label>' +
        '<input type="text" data-part-label maxlength="80" value="' + esc(WMStore.state.participant.label || '') + '">' +
        '<div class="hint">Shown in exports instead of a name. Participant id: <code>' +
        esc(WMStore.state.participant.id) + '</code> (random, not derived from personal data).</div></div>')
    ]);
    p.body.appendChild(part.root);
    const partBtn = el('<div class="btn-row"><button class="btn tiny" data-act="save-part">Save label</button></div>');
    part.body.appendChild(partBtn);
    partBtn.querySelector('button').addEventListener('click', async () => {
      const label = part.body.querySelector('[data-part-label]').value.trim() || 'Local participant';
      await DB.setMeta('wmParticipant', Object.assign({}, WMStore.state.participant, { label }));
      WMStore.state.participant.label = label;
      UI.toast('Participant label saved.');
      WMStore.emit();
    });

    /* toggles */
    const tg = fieldset('Behaviour flags', []);
    p.body.appendChild(tg.root);
    tg.body.appendChild(checkField('Dev mode', settings.devMode,
      'Shows seeds, generator version, and stimulus parameters during an assessment. Answer keys are NEVER shown during scored trials — ' +
      'they appear afterwards in Session History.', (v) => WMStore.saveSettings({ devMode: v })));
    tg.body.appendChild(checkField('Show provisional composite', settings.provisionalComposite,
      'Displays an exploratory equal-weight mean of family accuracies, clearly labelled provisional. Off by default: it is not a validated WM score.',
      (v) => WMStore.saveSettings({ provisionalComposite: v })));
    tg.body.appendChild(checkField('Reduced motion', settings.reducedMotion,
      'Removes non-essential transitions in the assessment stage (stimulus timing is never animated).',
      (v) => WMStore.saveSettings({ reducedMotion: v })));
    tg.body.appendChild(checkField('Include familiarization trials in exports', settings.includeFamiliarizationInExport,
      'Off by default: practice trials are excluded from exports just as they are excluded from scores.',
      (v) => WMStore.saveSettings({ includeFamiliarizationInExport: v })));

    /* reliability */
    const rel = fieldset('Reliable-change analysis (optional, per family)',
      ['<p class="hint">The reliable-change index needs a test–retest (or alternate-form) reliability for the exact task configuration. ' +
        'This app never guesses one: leave a field empty and the analytics show “unavailable” with the reason. ' +
        'Values must be between 0 and 1 (e.g. <code>0.80</code>). Source of the estimate is your responsibility to record.</p>']);
    p.body.appendChild(rel.root);
    Object.keys(WMTasks.FAMILIES).forEach((f) => {
      const meta = WMTasks.FAMILIES[f];
      const cur = (settings.reliability || {})[f];
      rel.body.appendChild(el('<div class="field"><label>' + esc(f + ' · ' + meta.short) + ' — reliability r</label>' +
        '<input type="number" data-rel="' + f + '" min="0.01" max="0.99" step="0.01" ' +
        'placeholder="unavailable" value="' + (cur != null ? esc(String(cur)) : '') + '"></div>'));
    });
    rel.body.querySelectorAll('[data-rel]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const f = inp.dataset.rel;
        const v = inp.value.trim() === '' ? null : Number(inp.value);
        if (v != null && (!isFinite(v) || v <= 0 || v >= 1)) {
          UI.toast('Reliability must be between 0 and 1.', 'error');
          inp.value = (WMStore.getSettings().reliability || {})[f] || '';
          return;
        }
        const cur = Object.assign({}, WMStore.getSettings().reliability);
        if (v == null) delete cur[f]; else cur[f] = v;
        await WMStore.saveSettings({ reliability: cur });
        UI.toast(v == null ? 'Reliability cleared — reliable change shows “unavailable”.' : 'Reliability saved for family ' + f + '.');
      });
    });

    /* storage & data */
    const st = fieldset('Storage & data', [
      '<p class="hint">Storage backend: <strong>' + esc(DB.storageMode === 'idb' ? 'IndexedDB' : 'localStorage (fallback)') + '</strong>. ' +
        'Sessions, blocks, trials, seeds, and configuration versions all persist locally and survive refresh. ' +
        'Full JSON/CSV export and scoped deletion live in <button class="btn tiny" data-act="to-data">Data management</button>.</p>'
    ]);
    p.body.appendChild(st.root);
    st.body.querySelector('[data-act="to-data"]').addEventListener('click', () => go('data'));

    /* familiarization reset */
    const fam = fieldset('Practice (familiarization)', [
      '<p class="hint">Practice-complete flags are stored per family:variant. Reset all of them to re-run practice — ' +
        'useful after changing a variant rule.</p>'
    ]);
    p.body.appendChild(fam.root);
    const famBtn = el('<div class="btn-row"><button class="btn tiny danger" data-act="reset-fam">Reset all familiarization…</button></div>');
    fam.body.appendChild(famBtn);
    famBtn.querySelector('button').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Reset familiarization?',
        message: 'Clears practice-complete flags for every family/variant. Practice trials will be shown again before scored trials (still excluded from scores).',
        okLabel: 'Reset'
      });
      if (!ok) return;
      await WMStore.resetFamiliarization();
      UI.toast('Familiarization reset.');
    });
  };

  return { render, sections, go, panel, statCard, famChip, statusChip, barRows, noteBox, sessionTable, resultsTable, num, pctStr };
})();
