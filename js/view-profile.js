/* Cognitive Evolution Tracker — Profile, assessments (baseline & follow-up), comparisons.

   Sections: general info + historical snapshots, lifestyle plans, sensitive (private) info,
   baseline assessment panel, post-training assessment panel, side-by-side comparison with
   optional reliable-change analysis (spec §8). */
window.ViewProfile = (function () {
  'use strict';
  const { el, esc } = U;

  const OCCUPATIONS = ['High-school student', 'University student', 'Teacher', 'Researcher', 'Employed professional', 'Other'];

  /* Health-background options. These fields are rendered inside General information
     for convenience but are stored in profile.sensitive, so they follow the app's
     privacy rule: never in shared reports unless the user explicitly opts in. */
  const ND_STATUS = ['', 'None known', 'Diagnosed', 'Suspected (no formal diagnosis)', 'Currently under assessment', 'Prefer not to say'];
  const MED_STATUS = ['', 'None known', 'Yes — diagnosed', 'Currently under investigation', 'Prefer not to say'];

  const cmp = { baselineId: '', followupId: '' };

  function render(host) {
    host.innerHTML = '';
    const wrap = el('<div class="page profile"></div>');
    wrap.appendChild(generalPanel());
    wrap.appendChild(plansPanel());
    wrap.appendChild(sensitivePanel());
    wrap.appendChild(notesSummaryPanel());
    wrap.appendChild(assessmentPanel('baseline', 'Baseline assessments', 'Pre-training cognitive assessments. Record the test as administered before training began.'));
    wrap.appendChild(assessmentPanel('followup', 'Post-training assessments', 'Assessments taken after (or during) training. Compare any of them against a baseline below.'));
    wrap.appendChild(comparisonPanel());
    host.appendChild(wrap);
    bind(wrap, host);
  }

  /* ---------- general info ---------- */

  function generalPanel() {
    const p = Store.state.profile || {};
    const s = p.sensitive || {};
    const snaps = (p.snapshots || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>General information</h2>' +
      '<div class="panel-sub">Used only to contextualise your own records. Nothing here leaves this device unless you export it.</div></div>' +
      '<div class="panel-controls"><button class="btn" data-act="snapshot">' + Icons.svg('plus') + ' Save as dated snapshot</button></div></div>' +
      '<div class="ed-grid">' +
      '<div class="field"><label>Name or pseudonym</label><input type="text" data-p="name" value="' + esc(p.name || '') + '" placeholder="e.g. Alex"></div>' +
      '<div class="field"><label>Age</label><input type="number" min="1" max="120" data-p="age" value="' + esc(p.age == null ? '' : p.age) + '"></div>' +
      '<div class="field"><label>Gender</label><select data-p="gender">' +
      ['', 'Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'].map((g) =>
        '<option value="' + esc(g) + '"' + (p.gender === g ? ' selected' : '') + '>' + esc(g || '— not set —') + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Occupation / educational status</label><select data-p="occupation">' +
      OCCUPATIONS.map((o) => '<option value="' + esc(o) + '"' + (p.occupation === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
      '<option value="__custom"' + (p.occupation && OCCUPATIONS.indexOf(p.occupation) < 0 ? ' selected' : '') + '>Other (type below)…</option></select>' +
      '<input type="text" data-p="occupationCustom" placeholder="custom occupation" value="' + esc(p.occupationCustom || '') + '"></div>' +
      '<div class="field span2 form-subhead">Health background <span class="badge warn">private</span></div>' +
      '<div class="field"><label>Neurodevelopmental condition</label><select data-s="ndStatus">' +
      ND_STATUS.map((v) => '<option value="' + esc(v) + '"' + (s.ndStatus === v ? ' selected' : '') + '>' + esc(v || '— not recorded —') + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Details (diagnosed or suspected)</label><input type="text" data-s="ndDetails" placeholder="e.g. ADHD — diagnosed 2019" value="' + esc(s.ndDetails || '') + '"></div>' +
      '<div class="field"><label>Other medical conditions</label><select data-s="medicalStatus">' +
      MED_STATUS.map((v) => '<option value="' + esc(v) + '"' + (s.medicalStatus === v ? ' selected' : '') + '>' + esc(v || '— not recorded —') + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Details</label><input type="text" data-s="medicalDetails" placeholder="e.g. sleep apnoea, TBI in 2018" value="' + esc(s.medicalDetails || '') + '"></div>' +
      '<div class="field span2"><div class="hint">Saved with your sensitive information (see the private section below) — never included in shared reports unless you explicitly tick “include sensitive information”. ' +
      'Recorded for context only; the app never infers ability or expected progress from a diagnosis.</div></div>' +
      '</div>' +
      (snaps.length ? '<div class="snap-list"><h4>Historical snapshots</h4>' + snaps.map((s) =>
        '<div class="snap-row"><span>' + esc(U.fmtDateShort(s.date)) + '</span><strong>' +
        (s.age ? 'age ' + esc(s.age) : '') + (s.age && s.occupation ? ' · ' : '') + esc(s.occupation || '') + '</strong>' +
        '<button class="icon-btn danger" data-rmsnap="' + esc(s.id) + '" title="Remove snapshot">✕</button></div>').join('') + '</div>'
        : '<div class="hint mt">Snapshots let you interpret older records correctly when age or occupation change over time.</div>') +
      '</section>');
    return panel;
  }

  /* ---------- lifestyle plans ---------- */

  function plansPanel() {
    const p = Store.state.profile || {};
    const pl = p.plans || {};
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Lifestyle plans <span class="badge soft">intentions</span></h2>' +
      '<div class="panel-sub">These are <strong>plans, not confirmed behaviour</strong>. A planned workout is never treated as a completed one.</div></div></div>' +
      '<div class="ed-grid">' +
      '<div class="field span2"><label>Intentions to exercise</label><textarea rows="2" data-l="exercise" placeholder="e.g. Intend to jog 3× per week after work.">' + esc(pl.exercise || '') + '</textarea></div>' +
      '<div class="field"><label>Planned frequency &amp; duration</label><input type="text" data-l="frequency" placeholder="e.g. 3× / week, 30 min" value="' + esc(pl.frequency || '') + '"></div>' +
      '<div class="field"><label>Plan start date</label><input type="date" data-l="startDate" value="' + esc(pl.startDate || '') + '"></div>' +
      '<div class="field span2"><label>Intended diet routine (rough description)</label><textarea rows="2" data-l="diet">' + esc(pl.diet || '') + '</textarea></div>' +
      '<div class="field span2"><label>Other intended lifestyle changes</label><textarea rows="2" data-l="other">' + esc(pl.other || '') + '</textarea></div>' +
      '</div>' +
      '<div class="hint mt">Planned exercise appears here; actually-logged sessions live in each daily ticket; specific workouts (minutes + workout type) live in the physical-activity field. The three are never merged.</div>' +
      '</section>');
    return panel;
  }

  /* ---------- sensitive ---------- */

  function sensitivePanel() {
    const p = Store.state.profile || {};
    const s = p.sensitive || {};
    const panel = el('<section class="panel card sensitive">' +
      '<div class="panel-head"><div><h2>' + Icons.svg('lock') + 'Sensitive / diagnostic information <span class="badge warn">private</span></h2>' +
      '<div class="panel-sub">Optional. Structured health-background fields (neurodevelopmental condition, other medical conditions) are edited in General information above and stored here. ' +
      'Nothing here appears in shared reports unless you explicitly tick “include sensitive information”. ' +
      'This app never uses this information to draw conclusions about intelligence or expected progress.</div></div></div>' +
      '<div class="field"><textarea rows="3" data-s="notes" placeholder="Optional free text — leave blank if you prefer.">' + esc(s.notes || '') + '</textarea></div>' +
      '</section>');
    return panel;
  }

  /* ---------- ticket notes summary (compiled text document) ---------- */

  /* One date-stamped text document compiling every note inside every ticket:
     day notes, sleep notes, physical-activity notes, per-session notes and
     per-observation notes. Uses Store.compileTicketNotes() — the same compiler
     the shared-report export uses, so both always agree. */
  function notesSummaryPanel() {
    const days = Store.compileTicketNotes();
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Ticket notes summary</h2>' +
      '<div class="panel-sub">Every note written inside your daily tickets — day, sleep, activity, session, and per-metric notes — ' +
      'compiled into one date-stamped text document.</div></div>' +
      (days.length ? '<div class="panel-controls">' +
        '<button class="btn" data-act="copynotes" title="Copy the compiled document to the clipboard">' + Icons.svg('copy') + ' Copy as text</button>' +
        '<button class="btn" data-act="downloadnotes" title="Download the compiled document as a .txt file">' + Icons.svg('download') + ' Download .txt</button></div>' : '') +
      '</div>');
    if (!days.length) {
      panel.appendChild(el('<div class="empty small"><div class="empty-icon">' + Icons.svg('file') + '</div>' +
        '<h4>No notes yet</h4><p>Notes you write on daily tickets — day notes, sleep notes, activity notes, ' +
        'session notes, or per-metric observation notes — appear here as one compiled, date-stamped document.</p></div>'));
      return panel;
    }
    const doc = el('<div class="notes-doc"></div>');
    days.forEach((d) => {
      const day = el('<div class="notes-day">' +
        '<div class="notes-day-head"><span class="notes-day-date">' + esc(U.fmtDate(d.date)) + '</span>' +
        (d.createdAt ? '<span class="notes-day-stamp">entered ' + esc(U.fmtDateTime(d.createdAt)) + '</span>' : '') +
        '</div></div>');
      d.lines.forEach((ln) => {
        day.appendChild(el('<div class="notes-line ' + esc(ln.kind) + '">' +
          '<span class="nl-label">' + esc(ln.label) + '</span>' + esc(ln.text) + '</div>'));
      });
      doc.appendChild(day);
    });
    panel.appendChild(doc);
    panel.appendChild(el('<div class="hint mt">' + days.length + ' day' + (days.length === 1 ? '' : 's') +
      ' with notes · compiled in chronological order (oldest first).</div>'));
    return panel;
  }

  /* Plain-text rendering of the compiled notes (for copy & download). */
  function notesDocumentText() {
    const days = Store.compileTicketNotes();
    const lines = ['Cognitive Evolution Tracker — ticket notes',
      'Compiled: ' + new Date().toLocaleString() + ' · ' + days.length + ' day' + (days.length === 1 ? '' : 's') + ' with notes',
      ''];
    days.forEach((d) => {
      lines.push('═══ ' + U.fmtDate(d.date) + (d.createdAt ? '  (entered ' + U.fmtDateTime(d.createdAt) + ')' : '') + ' ═══');
      d.lines.forEach((ln) => {
        const segs = ln.text.split('\n');
        segs.forEach((seg, i) => { lines.push((i === 0 ? '  · ' + ln.label + ': ' : '    ') + seg); });
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  /* ---------- assessment panels ---------- */

  function assessmentPanel(kind, title, sub) {
    const items = Store.assessmentsOfKind(kind);
    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>' + esc(title) + '</h2><div class="panel-sub">' + esc(sub) + '</div></div>' +
      '<div class="panel-controls"><button class="btn primary" data-add="' + kind + '">' + Icons.svg('plus') + ' Add ' + (kind === 'baseline' ? 'baseline' : 'follow-up') + '</button></div></div>' +
      '</section>');
    if (items.length) {
      const holder = el('<div class="assess-cards"></div>');
      items.forEach((a) => holder.appendChild(assessCard(a)));
      panel.appendChild(holder);
    } else {
      panel.appendChild(el('<div class="empty small"><div class="empty-icon">' + Icons.svg('flask') + '</div><h4>No ' + (kind === 'baseline' ? 'baseline' : 'follow-up') + ' assessments yet</h4>' +
        '<p>' + (kind === 'baseline'
          ? 'Record a pre-training test result to anchor your longitudinal comparison.'
          : 'Once you take an assessment after training, record it here to compare against a baseline.') + '</p></div>'));
    }
    return panel;
  }

  function assessCard(a) {
    const subs = (a.subtests || []).filter((s) => s.name);
    const atts = Store.attachmentsOf('assessment', a.id);
    return el('<div class="assess-card ' + esc(a.kind) + '">' +
      '<div class="ac-head"><strong>' + esc(a.testName || '(unnamed test)') + '</strong>' +
      '<span class="badge ' + esc(a.kind) + '">' + (a.kind === 'baseline' ? 'Baseline' : 'Follow-up') + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="icon-btn" data-editassess="' + esc(a.id) + '" title="Edit">' + Icons.svg('pencil') + '</button>' +
      '<button class="icon-btn danger" data-delassess="' + esc(a.id) + '" title="Delete">' + Icons.svg('trash') + '</button></div>' +
      '<div class="ac-body">' +
      '<div class="ac-score">' + (a.overallScore == null ? '<span class="muted">no overall score</span>' : esc(a.overallScore)) +
      (a.scoreType ? '<span class="ac-scale">' + esc(a.scoreType) + '</span>' : '') + '</div>' +
      '<ul class="ac-meta">' +
      '<li>Administered: <strong>' + esc(U.fmtDateShort(a.date)) + '</strong></li>' +
      (a.scaleMin != null && a.scaleMax != null ? '<li>Scale: ' + esc(a.scaleMin) + '–' + esc(a.scaleMax) + (a.normSD != null ? ' (norm SD ' + esc(a.normSD) + ')' : '') + '</li>' : '') +
      (a.reliability != null ? '<li>Reliability: ' + esc(a.reliability) + '</li>' : '') +
      (a.gLoading != null ? '<li>Reported g-loading: ' + esc(a.gLoading) + '</li>' : '') +
      (a.notes ? '<li>Notes: ' + esc(a.notes) + '</li>' : '') +
      '</ul>' +
      (subs.length ? '<div class="ac-subtests">' + subs.map((s) =>
        '<span class="sub">' + esc(s.name) + ': <strong>' + esc(s.value) + '</strong></span>').join('') + '</div>' : '') +
      (a.preparation ? '<div class="ac-notes"><span class="acn-label">Training preparation</span>' + esc(a.preparation) + '</div>' : '') +
      (a.conclusions ? '<div class="ac-notes"><span class="acn-label">Session conclusions</span>' + esc(a.conclusions) + '</div>' : '') +
      (atts.length ? '<div class="ac-atts">' + atts.map((at) =>
        '<button class="chip" data-viewatt="' + esc(at.id) + '">' + Icons.svg('paperclip') + ' ' + esc(at.name) + '</button>').join('') + '</div>' : '') +
      '</div></div>');
  }

  /* ---------- comparison ---------- */

  function comparisonPanel() {
    const baselines = Store.assessmentsOfKind('baseline');
    const followups = Store.assessmentsOfKind('followup');
    if (!baselines.length && !followups.length) {
      return el('<section class="panel card"><div class="panel-head"><div><h2>Baseline ↔ Follow-up comparison</h2>' +
        '<div class="panel-sub">Add at least one baseline and one follow-up to enable comparisons.</div></div></div></section>');
    }
    if (!cmp.baselineId && baselines.length) cmp.baselineId = baselines[baselines.length - 1].id;
    if (!cmp.followupId && followups.length) cmp.followupId = followups[followups.length - 1].id;
    const b = baselines.find((x) => x.id === cmp.baselineId) || baselines[0];
    const f = followups.find((x) => x.id === cmp.followupId) || followups[0];

    const panel = el('<section class="panel card">' +
      '<div class="panel-head"><div><h2>Baseline ↔ Follow-up comparison</h2>' +
      '<div class="panel-sub">Score changes stay in their original scale. A 130→140 IQ change is +10 points, not “+10% intelligence”.</div></div>' +
      '<div class="panel-controls">' +
      '<select data-cmp="baseline">' + baselines.map((x) => '<option value="' + esc(x.id) + '"' + (b && x.id === b.id ? ' selected' : '') + '>Baseline: ' + esc(x.testName || 'test') + ' · ' + esc(U.fmtDateShort(x.date)) + '</option>').join('') + '</select>' +
      '<select data-cmp="followup">' + followups.map((x) => '<option value="' + esc(x.id) + '"' + (f && x.id === f.id ? ' selected' : '') + '>Follow-up: ' + esc(x.testName || 'test') + ' · ' + esc(U.fmtDateShort(x.date)) + '</option>').join('') + '</select>' +
      '</div></div>' +
      '</section>');
    if (b && f) panel.appendChild(compareBody(b, f));
    else panel.appendChild(el('<div class="hint">Need one baseline and one follow-up to compare.</div>'));
    return panel;
  }

  function compareBody(b, f) {
    const wrap = el('<div class="compare"></div>');
    const sameTest = (b.testName || '').toLowerCase() === (f.testName || '').toLowerCase();
    const bs = b.overallScore, fs = f.overallScore;
    const hasScores = bs != null && fs != null;
    const diff = hasScores ? fs - bs : null;
    const days = U.daysBetween(b.date, f.date);
    const intervening = Store.sessionsBetween(b.date, f.date);

    // percentage change only when a true zero exists (scale starts at 0) — otherwise not meaningful
    const ratioScale = b.scaleMin === 0 && f.scaleMin === 0;
    const pct = hasScores && ratioScale && bs !== 0 ? ((fs - bs) / Math.abs(bs)) * 100 : null;

    const rows = [
      ['Baseline score', hasScores ? esc(bs) : '—', (b.scoreType || '') + (b.date ? ' · ' + U.fmtDateShort(b.date) : '')],
      ['Follow-up score', hasScores ? esc(fs) : '—', (f.scoreType || '') + (f.date ? ' · ' + U.fmtDateShort(f.date) : '')],
      ['Absolute difference', hasScores ? (diff >= 0 ? '+' : '') + U.fmtNum(diff) + ' points' : '—',
        'on the original scale' + (b.scaleMin != null && b.scaleMax != null ? ' (' + b.scaleMin + '–' + b.scaleMax + ')' : '')],
      ['Percentage difference', pct != null ? (pct >= 0 ? '+' : '') + U.fmtNum(pct) + '%' : 'not shown',
        pct != null ? 'valid because the scale has a true zero' : 'percentage change is not meaningful on this scale (no true zero). A 130→140 change is +10 points, not +10%.'],
      ['Time elapsed', days != null ? days + ' days' : '—', '≈ ' + (days != null ? U.fmtNum(days / 30.44, 1) + ' months' : '—')],
      ['Intervening training sessions', intervening == null ? '—' : String(intervening.length),
        'sessions with an event date strictly between the two assessments'],
      ['Same test?', sameTest ? 'Yes' : 'No', sameTest ? '' : 'scores from different instruments are not directly comparable']
    ];

    const table = el('<table class="cmp-table"><tbody>' + rows.map((r) =>
      '<tr><td class="k">' + esc(r[0]) + '</td><td class="v">' + r[1] + '</td><td class="n">' + esc(r[2]) + '</td></tr>').join('') +
      '</tbody></table>');
    wrap.appendChild(table);

    // dedicated context fields: baseline preparation & follow-up conclusions
    if (b.preparation) wrap.appendChild(el('<div class="cmp-ctx"><strong>Baseline — training preparation</strong>' + esc(b.preparation) + '</div>'));
    if (f.conclusions) wrap.appendChild(el('<div class="cmp-ctx"><strong>Follow-up — session conclusions</strong>' + esc(f.conclusions) + '</div>'));

    // subtest comparison when both have matching subtest names
    const bsubs = (b.subtests || []).filter((s) => s.name);
    const fsubs = (f.subtests || []).filter((s) => s.name);
    const names = Array.from(new Set(bsubs.map((s) => s.name))).filter((n) => fsubs.some((s) => s.name === n));
    if (names.length) {
      const st = el('<table class="cmp-table subtests"><thead><tr><th>Subtest</th><th>Baseline</th><th>Follow-up</th><th>Δ</th></tr></thead><tbody>' +
        names.map((n) => {
          const bv = U.toNum(bsubs.find((s) => s.name === n).value);
          const fv = U.toNum(fsubs.find((s) => s.name === n).value);
          const d = bv != null && fv != null ? fv - bv : null;
          return '<tr><td class="k">' + esc(n) + '</td><td>' + esc(bsubs.find((s) => s.name === n).value) + '</td>' +
            '<td>' + esc(fsubs.find((s) => s.name === n).value) + '</td>' +
            '<td>' + (d == null ? '—' : (d >= 0 ? '+' : '') + U.fmtNum(d)) + '</td></tr>';
        }).join('') + '</tbody></table>');
      wrap.appendChild(el('<h4 class="cmp-sub">Subtest comparison</h4>'));
      wrap.appendChild(st);
    }

    // reliable change analysis (only when reliability + norm SD are available for both)
    const rel = b.reliability != null ? b.reliability : (f.reliability != null ? f.reliability : null);
    const sd = b.normSD != null ? b.normSD : (f.normSD != null ? f.normSD : null);
    if (hasScores && rel != null && sd != null && sd > 0 && rel < 1) {
      const sdiff = sd * Math.sqrt(2) * Math.sqrt(1 - rel);
      const rci = diff / sdiff;
      const reliable = Math.abs(rci) >= 1.96;
      wrap.appendChild(el('<div class="reliable-box ' + (reliable ? 'yes' : 'no') + '">' +
        '<h4>Reliable Change Index (RCI)</h4>' +
        '<div class="rci-math">SD<sub>diff</sub> = ' + esc(U.fmtNum(sd, 1)) + ' × √2 × √(1 − ' + esc(rel) + ') = <strong>' + esc(U.fmtNum(sdiff, 2)) + '</strong> · ' +
        'RCI = ' + esc(U.fmtNum(diff, 1)) + ' ÷ ' + esc(U.fmtNum(sdiff, 2)) + ' = <strong>' + esc(U.fmtNum(rci, 2)) + '</strong></div>' +
        '<p><strong>' + (reliable ? 'The score change exceeds the conventional ±1.96 threshold → “reliably” changed under these assumptions.' :
          'The score change does not reach the conventional ±1.96 threshold → it is within expected measurement noise.') + '</strong></p>' +
        '<p class="assumptions"><strong>Assumptions &amp; caveats:</strong> uses the reported reliability (' + esc(rel) +
        ') and normative SD (' + esc(U.fmtNum(sd, 1)) + ') you entered; assumes uncorrelated errors between administrations, equivalent forms/conditions, ' +
        'and no practice or floor/ceiling effects. A reliable change means the <em>test score</em> moved more than measurement error would predict — ' +
        'it is <em>not</em> by itself proof of a change in general intelligence or of a causal training effect.</p>' +
        '</div>'));
    } else if (hasScores) {
      wrap.appendChild(el('<div class="hint mt">Reliable-change analysis is available once you record the test’s reliability (e.g. 0.95) and normative standard deviation (e.g. 15) for at least one of these assessments.</div>'));
    }

    wrap.appendChild(el('<div class="caution mt">' + Icons.svg('alert') + ' Interpretation reminders: repeated testing can inflate scores through item familiarity; measurement error, ' +
      'testing conditions, motivation, and time of day all matter. Training-task gains do not automatically transfer to, or imply, ' +
      'changes in broad cognitive ability.</div>'));
    return wrap;
  }

  /* ---------- binding ---------- */

  function bind(wrap, host) {
    // profile fields
    wrap.querySelectorAll('[data-p]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const f = inp.dataset.p;
        let patch = {};
        if (f === 'occupation') {
          if (inp.value === '__custom') patch = { occupation: wrap.querySelector('[data-p="occupationCustom"]').value.trim() || 'Other' };
          else patch = { occupation: inp.value };
        } else if (f === 'occupationCustom') {
          const sel = wrap.querySelector('[data-p="occupation"]');
          if (sel.value === '__custom' || (Store.state.profile.occupation && OCCUPATIONS.indexOf(Store.state.profile.occupation) < 0)) {
            patch = { occupation: inp.value.trim() || 'Other', occupationCustom: inp.value.trim() };
          } else patch = { occupationCustom: inp.value.trim() };
        } else patch = { [f]: inp.value };
        await Store.saveProfile(patch);
      });
    });
    // plans
    wrap.querySelectorAll('[data-l]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const plans = Object.assign({}, Store.state.profile.plans || {});
        plans[inp.dataset.l] = inp.value;
        await Store.saveProfile({ plans });
      });
    });
    // sensitive
    wrap.querySelectorAll('[data-s]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const sensitive = Object.assign({}, Store.state.profile.sensitive || {});
        sensitive[inp.dataset.s] = inp.value;
        await Store.saveProfile({ sensitive });
      });
    });
    // snapshots
    const snapBtn = wrap.querySelector('[data-act="snapshot"]');
    if (snapBtn) snapBtn.addEventListener('click', async () => {
      const p = Store.state.profile;
      const occ = p.occupation && OCCUPATIONS.indexOf(p.occupation) >= 0 ? p.occupation : (p.occupationCustom || p.occupation || '');
      await Store.addSnapshot({ date: U.todayISO(), age: p.age || '', occupation: occ });
      UI.toast('Snapshot saved for today.');
      refresh(host);
    });
    wrap.querySelectorAll('[data-rmsnap]').forEach((b) => b.addEventListener('click', async () => {
      await Store.removeSnapshot(b.dataset.rmsnap);
      refresh(host);
    }));
    // ticket notes summary: copy / download the compiled document
    const copyBtn = wrap.querySelector('[data-act="copynotes"]');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const txt = notesDocumentText();
      try {
        await navigator.clipboard.writeText(txt);
        UI.toast('Compiled notes copied to clipboard.');
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); UI.toast('Compiled notes copied to clipboard.'); }
        catch (e2) { UI.toast('Copy failed — use “Download .txt” instead.', 'error'); }
        document.body.removeChild(ta);
      }
    });
    const dlBtn = wrap.querySelector('[data-act="downloadnotes"]');
    if (dlBtn) dlBtn.addEventListener('click', () => {
      U.download('cet-ticket-notes-' + U.todayISO() + '.txt', notesDocumentText(), 'text/plain;charset=utf-8');
      UI.toast('Ticket notes downloaded as .txt.');
    });
    // assessments
    wrap.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => AssessmentEditor.open(null, b.dataset.add)));
    wrap.querySelectorAll('[data-editassess]').forEach((b) => b.addEventListener('click', () => AssessmentEditor.open(b.dataset.editassess)));
    wrap.querySelectorAll('[data-delassess]').forEach((b) => b.addEventListener('click', async () => {
      const a = Store.assessmentById(b.dataset.delassess);
      const ok = await UI.confirm({
        title: 'Delete assessment?',
        messageHtml: 'This permanently removes <strong>' + esc(a.testName || 'this assessment') + '</strong> (' + esc(U.fmtDateShort(a.date)) + ') and any attached files. Comparisons referencing it will be unavailable.',
        okLabel: 'Delete'
      });
      if (!ok) return;
      await Store.deleteAssessment(a.id);
      UI.toast('Assessment deleted.');
      refresh(host);
    }));
    wrap.querySelectorAll('[data-viewatt]').forEach((b) => b.addEventListener('click', () => {
      const at = Store.state.attachments.find((x) => x.id === b.dataset.viewatt);
      if (!at) return;
      if (at.mime && at.mime.indexOf('image') === 0) UI.viewImage(at.dataUrl, at.name);
      else UI.toast('“' + at.name + '” — open the assessment to download or re-attach.');
    }));
    // comparison selects
    wrap.querySelectorAll('[data-cmp]').forEach((sel) => sel.addEventListener('change', () => {
      cmp[sel.dataset.cmp === 'baseline' ? 'baselineId' : 'followupId'] = sel.value;
      refresh(host);
    }));
  }

  function refresh(host) {
    const container = host || document.getElementById('view');
    container.innerHTML = '';
    render(container);
  }

  return { render, cmp };
})();

/* ---------------- assessment editor (modal) ---------------- */

window.AssessmentEditor = (function () {
  'use strict';
  const { el, esc } = U;

  function open(id, presetKind) {
    const existing = id ? Store.assessmentById(id) : null;
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
        id: null, kind: presetKind || 'baseline', testName: '', date: U.todayISO(),
        scoreType: '', scaleMin: '', scaleMax: '', normSD: '', overallScore: '',
        subtests: [], reliability: '', gLoading: '', notes: '',
        preparation: '', conclusions: '', createdAt: null, updatedAt: null
      };
    draft.subtests = draft.subtests || [];

    const root = el('<div class="editor assess-editor"></div>');
    const pending = [];   // attachments added this session (kept until save)
    const delIds = [];    // existing attachment ids to delete on save
    const m = UI.modal({
      title: existing ? 'Edit assessment' : 'New ' + (draft.kind === 'baseline' ? 'baseline' : 'follow-up') + ' assessment',
      body: root, wide: true
    });
    render();

    function render() {
      root.innerHTML = '';
      root.appendChild(el('<div class="ed-grid">' +
        '<div class="field"><label>Type</label><select data-a="kind">' +
        '<option value="baseline"' + (draft.kind === 'baseline' ? ' selected' : '') + '>Baseline (pre-training)</option>' +
        '<option value="followup"' + (draft.kind === 'followup' ? ' selected' : '') + '>Follow-up (post-training)</option></select></div>' +
        '<div class="field"><label>Test name</label><input type="text" data-a="testName" placeholder="e.g. WAIS-IV (full-scale), Raven’s APM…" value="' + esc(draft.testName || '') + '"></div>' +
        '<div class="field"><label>Administration date</label><input type="date" data-a="date" value="' + esc(draft.date || U.todayISO()) + '"></div>' +
        '<div class="field"><label>Overall score</label><input type="number" step="any" data-a="overallScore" value="' + esc(draft.overallScore == null ? '' : draft.overallScore) + '"></div>' +
        '<div class="field span2"><label>Score type &amp; scale</label><input type="text" data-a="scoreType" placeholder="e.g. Full-scale IQ (deviation, mean 100, SD 15)" value="' + esc(draft.scoreType || '') + '"></div>' +
        '<div class="field"><label>Scale minimum</label><input type="number" step="any" data-a="scaleMin" value="' + esc(draft.scaleMin == null ? '' : draft.scaleMin) + '"></div>' +
        '<div class="field"><label>Scale maximum</label><input type="number" step="any" data-a="scaleMax" value="' + esc(draft.scaleMax == null ? '' : draft.scaleMax) + '"></div>' +
        '<div class="field"><label>Normative SD (optional)</label><input type="number" step="any" data-a="normSD" placeholder="e.g. 15" value="' + esc(draft.normSD == null ? '' : draft.normSD) + '"><div class="hint">Enables reliable-change analysis.</div></div>' +
        '<div class="field"><label>Reliability (optional)</label><input type="number" step="0.01" min="0" max="1" data-a="reliability" placeholder="e.g. 0.96" value="' + esc(draft.reliability == null ? '' : draft.reliability) + '"></div>' +
        '<div class="field"><label>Reported g-loading (optional)</label><input type="number" step="0.01" data-a="gLoading" placeholder="leave blank if unknown" value="' + esc(draft.gLoading == null ? '' : draft.gLoading) + '"><div class="hint">Depends on the sample &amp; estimation method — never auto-filled.</div></div>' +
        '<div class="field span2"><label>Testing conditions / notes</label><textarea rows="2" data-a="notes" placeholder="quiet room, no time pressure, examiner…">' + esc(draft.notes || '') + '</textarea></div>' +
        '<div class="field span2"><label>' + (draft.kind === 'baseline' ? 'Training preparation' : 'Session conclusions') + '</label>' +
        '<textarea rows="2" data-a="' + (draft.kind === 'baseline' ? 'preparation' : 'conclusions') + '" placeholder="' +
        (draft.kind === 'baseline'
          ? 'How you prepared for the training before this baseline — schedule, practice habits, sleep/caffeine protocol, life circumstances…'
          : 'Conclusions from the training sessions — e.g. the premises reached for each RRT component, or the overall level achieved in Executive N-back…') +
        '">' + esc((draft.kind === 'baseline' ? draft.preparation : draft.conclusions) || '') + '</textarea>' +
        '<div class="hint">' + (draft.kind === 'baseline'
          ? 'Baseline: record the preparation related to the training so later comparisons have context.'
          : 'Follow-up: record what the training sessions concluded — kept separate from the test’s own notes.') + '</div></div>' +
        '</div>'));

      const subWrap = el('<div class="subtests"><div class="obs-head">Subtest scores</div><div class="sub-list"></div>' +
        '<button class="btn tiny" data-act="addsub" type="button">+ Add subtest</button></div>');
      const list = subWrap.querySelector('.sub-list');
      function renderSubs() {
        list.innerHTML = '';
        if (!draft.subtests.length) list.appendChild(el('<div class="hint">No subtests recorded (optional).</div>'));
        draft.subtests.forEach((s, i) => {
          const row = el('<div class="obs-row"><input data-sub="name" placeholder="subtest name" value="' + esc(s.name || '') + '">' +
            '<input data-sub="value" class="obs-value" placeholder="score" value="' + esc(s.value == null ? '' : s.value) + '">' +
            '<button class="icon-btn danger" data-act="rmsub" type="button">✕</button></div>');
          row.querySelector('[data-sub="name"]').addEventListener('change', (e) => { s.name = e.target.value; });
          row.querySelector('[data-sub="value"]').addEventListener('change', (e) => { s.value = U.toNum(e.target.value) == null ? e.target.value : U.toNum(e.target.value); });
          row.querySelector('[data-act="rmsub"]').addEventListener('click', () => { draft.subtests.splice(i, 1); renderSubs(); });
          list.appendChild(row);
        });
      }
      renderSubs();
      subWrap.querySelector('[data-act="addsub"]').addEventListener('click', () => { draft.subtests.push({ name: '', value: '' }); renderSubs(); });
      root.appendChild(subWrap);

      // attachments
      const attWrap = el('<div class="att-block"><div class="att-head">Supporting evidence (reports, screenshots)</div>' +
        '<div class="thumbs" data-thumbs></div>' +
        '<label class="upload-btn">' + Icons.svg('paperclip') + ' Attach files<input type="file" multiple accept="image/*,.pdf" data-upload hidden></label></div>');
      function renderAtts() {
        const host = attWrap.querySelector('[data-thumbs]');
        host.innerHTML = '';
        const existing2 = draft.id ? Store.attachmentsOf('assessment', draft.id).filter((a) => delIds.indexOf(a.id) < 0) : [];
        const all = existing2.concat(pending);
        if (!all.length) host.appendChild(el('<div class="hint">No files attached.</div>'));
        all.forEach((a) => {
          const t = el('<div class="thumb">' +
            (a.mime && a.mime.indexOf('image') === 0 ? '<img src="' + a.dataUrl + '" alt="' + esc(a.name) + '">' : '<div class="thumb-file">DOC</div>') +
            '<button class="icon-btn danger thumb-x" type="button">✕</button></div>');
          t.addEventListener('click', (e) => {
            if (e.target.closest('.thumb-x')) return;
            if (a.mime && a.mime.indexOf('image') === 0) UI.viewImage(a.dataUrl, a.name);
          });
          t.querySelector('.thumb-x').addEventListener('click', () => {
            const pi = pending.indexOf(a);
            if (pi >= 0) pending.splice(pi, 1);
            else if (a.id) delIds.push(a.id);
            renderAtts();
          });
          host.appendChild(t);
        });
      }
      renderAtts();
      attWrap.querySelector('[data-upload]').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        for (const f of files) {
          try {
            let dataUrl;
            if (f.type.indexOf('image/') === 0) dataUrl = await U.compressImage(f);
            else {
              if (f.size > 4 * 1048576) { UI.toast('“' + f.name + '” too large (max 4 MB).', 'error'); continue; }
              dataUrl = await U.readAsDataURL(f);
            }
            pending.push({ id: U.uid(), ownerType: 'assessment', ownerId: draft.id || '__new__', name: f.name, mime: f.type, size: f.size, dataUrl, createdAt: null });
          } catch (err) { UI.toast('Could not attach ' + f.name, 'error'); }
        }
        renderAtts();
      });
      root.appendChild(attWrap);

      // footer
      const foot = el('<div class="ed-footer"><span class="grow"></span>' +
        '<button class="btn" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="save">Save assessment</button></div>');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      foot.querySelector('[data-act="save"]').addEventListener('click', save);
      root.appendChild(foot);
      bindFields();
    }

    function bindFields() {
      root.querySelectorAll('[data-a]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const f = inp.dataset.a;
          if (f === 'kind') {
            // collect every visible field first so nothing typed is lost, then re-render
            // so the dedicated preparation/conclusions field follows the chosen type
            root.querySelectorAll('[data-a]').forEach((x) => { draft[x.dataset.a] = x.value; });
            draft.kind = inp.value;
            render();
            return;
          }
          draft[f] = inp.value;
        });
      });
    }

    async function save() {
      root.querySelectorAll('[data-a]').forEach((inp) => { draft[inp.dataset.a] = inp.value; });
      if (!draft.testName.trim()) { UI.toast('Give the test a name.', 'error'); return; }
      if (!draft.date) { UI.toast('An administration date is required.', 'error'); return; }
      const saved = await Store.saveAssessment(draft);
      // persist attachments now that the assessment has a real id
      pending.forEach((a) => { a.ownerId = saved.id; });
      if (pending.length) await Store.addAttachments(pending);
      for (const did of delIds) await Store.deleteAttachment(did);
      UI.toast('Assessment saved.');
      m.close();
      const container = document.getElementById('view');
      if (container) { container.innerHTML = ''; window.ViewProfile.render(container); }
      void saved;
    }
  }

  return { open };
})();
