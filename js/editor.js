/* Cognitive Evolution Tracker — daily ticket editor.

   A ticket is a *container* (spec §2.1): daily lifestyle data + N training sessions, each session
   with its own time/mode/notes + N performance observations + attachments.
   The editor works on an in-memory draft; nothing is written until Save. */
window.Editor = (function () {
  'use strict';
  const { el, esc, qs, qsa } = U;

  /* ---------- draft construction ---------- */

  function newDraft(dateISO) {
    return {
      isNew: true,
      ticket: {
        id: null, date: dateISO || U.todayISO(),
        sleep: { bedTime: '', wakeTime: '', durationMin: null, quality: '', notes: '', manual: false },
        pa: { dailyMinutes: null, type: '', intensity: '', notes: '' },
        notes: '', createdAt: null, updatedAt: null
      },
      sessions: [newSession(dateISO || U.todayISO())],
      attachments: [],
      deleteAttachmentIds: []
    };
  }

  function newSession(date) {
    return {
      id: U.uid(), ticketId: null, date: date || U.todayISO(),
      startTime: '', endTime: '', durationMin: null, modeId: '', notes: '',
      observations: [], createdAt: null, updatedAt: null
    };
  }

  function draftFromTicket(id) {
    const t = Store.ticketById(id);
    if (!t) return null;
    const sleep = Object.assign({ bedTime: '', wakeTime: '', durationMin: null, quality: '', notes: '', manual: false }, t.sleep || {});
    const pa = Object.assign({ dailyMinutes: null, type: '', intensity: '', notes: '' }, t.pa || {});
    return {
      isNew: false,
      ticket: Object.assign({}, t, { sleep, pa }),
      sessions: Store.sessionsOf(id).map((s) => Object.assign({}, s, {
        observations: Store.observationsOf(s.id).map((o) => Object.assign({}, o))
      })),
      attachments: [],
      deleteAttachmentIds: []
    };
  }

  /* ---------- open ---------- */

  function open(input) {
    let draft = null;
    if (input && input.ticket) draft = input;                 // already a draft (Duplicate flow)
    else if (typeof input === 'string') draft = draftFromTicket(input); // existing ticket id
    else draft = newDraft();                                  // brand new
    if (!draft) { UI.toast('Ticket not found.', 'error'); return; }

    const root = el('<div class="editor"></div>');
    const m = UI.modal({
      title: draft.isNew ? 'New daily ticket' : 'Daily ticket — ' + U.fmtDate(draft.ticket.date),
      body: root, wide: true,
      onClose: () => {}
    });

    render();

    function render() {
      root.innerHTML = '';
      root.appendChild(headerRow());
      root.appendChild(section('Sleep', 'sleep', sleepBody, true));
      root.appendChild(section('Physical activity', 'pa', paBody, true));
      root.appendChild(section('Training sessions', 'sessions', sessionsBody, true));
      root.appendChild(section('Daily notes', 'notes', notesBody, false));
      if (!draft.isNew) root.appendChild(metaLine());
      root.appendChild(footerRow());
      updateHints();
    }

    /* ---------- sections ---------- */

    function section(title, key, bodyFn, openByDefault) {
      const s = el('<details class="ed-section"' + (openByDefault ? ' open' : '') + '>' +
        '<summary>' + esc(title) + '<span class="sec-hint" data-hint-' + key + '></span></summary>' +
        '<div class="ed-section-body"></div></details>');
      s.querySelector('.ed-section-body').appendChild(bodyFn());
      return s;
    }

    function headerRow() {
      const wrap = el('<div class="ed-header">' +
        '<div class="field inline"><label>Session date</label>' +
        '<input type="date" data-f="date" value="' + esc(draft.ticket.date) + '">' +
        '<div class="hint">Defaults to your computer’s current local date. Editing it reorders this ticket in the timeline — the recorded event date, not the creation timestamp, decides chronological position.</div></div>' +
        '</div>');
      wrap.querySelector('[data-f="date"]').addEventListener('change', (e) => {
        const oldDate = draft.ticket.date;
        const nd = e.target.value || U.todayISO();
        // Sessions that followed the ticket date keep following it (event-date integrity, spec §2.2/§10)
        draft.sessions.forEach((s) => { if (s.date === oldDate || !s.date) s.date = nd; });
        draft.ticket.date = nd;
        render();
      });
      return wrap;
    }

    function sleepBody() {
      const sl = draft.ticket.sleep;
      const wrap = el('<div class="ed-grid">' +
        '<div class="field"><label>Fell asleep at</label><input type="time" data-s="bedTime" value="' + esc(sl.bedTime || '') + '"></div>' +
        '<div class="field"><label>Woke up at</label><input type="time" data-s="wakeTime" value="' + esc(sl.wakeTime || '') + '"></div>' +
        '<div class="field"><label>Total sleep (auto)</label><div class="sleep-auto" data-sleep-auto></div>' +
        '<button class="btn tiny" data-s="useCalc" type="button">Use calculated value</button></div>' +
        '<div class="field"><label>Duration override</label><div class="dur-row">' +
        '<input type="number" min="0" max="24" step="1" data-s="durH" placeholder="h" value="' + (sl.durationMin != null && !sl.manual ? '' : (sl.durationMin != null ? Math.floor(sl.durationMin / 60) : '')) + '">' +
        '<span>h</span><input type="number" min="0" max="59" step="1" data-s="durM" placeholder="m" value="' + (sl.durationMin != null && sl.manual ? sl.durationMin % 60 : (sl.durationMin == null ? '' : '')) + '">' +
        '<span>m</span></div><div class="hint">Leave blank to keep the calculated value.</div></div>' +
        '<div class="field"><label>Sleep quality</label><select data-s="quality">' +
        ['', '1 — Very poor', '2 — Poor', '3 — Fair', '4 — Good', '5 — Excellent'].map((q) =>
          '<option value="' + esc(q ? q[0] : '') + '"' + (String(sl.quality) === (q ? q[0] : '') ? ' selected' : '') + '>' + esc(q || '— not recorded —') + '</option>').join('') +
        '</select></div>' +
        '<div class="field span2"><label>Notes</label><textarea rows="2" data-s="notes" placeholder="Interrupted sleep, unusual patterns…">' + esc(sl.notes || '') + '</textarea></div>' +
        '</div>');
      const autoEl = wrap.querySelector('[data-sleep-auto]');
      function recalc() {
        const bed = wrap.querySelector('[data-s="bedTime"]').value;
        const wake = wrap.querySelector('[data-s="wakeTime"]').value;
        const mins = U.computeSleepMinutes(bed, wake);
        autoEl.textContent = mins == null ? '— enter both times —' : U.fmtDuration(mins) + (bed && wake && U.hhmmToMin(wake) <= U.hhmmToMin(bed) ? ' (crosses midnight)' : '');
        autoEl.classList.toggle('valid', mins != null);
      }
      recalc();
      wrap.querySelectorAll('input[data-s], select[data-s], textarea[data-s]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const f = inp.dataset.s;
          if (f === 'bedTime' || f === 'wakeTime') { sl[f] = inp.value; sl.manual = false; syncDurInputs(wrap, null); }
          else if (f === 'durH' || f === 'durM') {
            const h = U.toNum(wrap.querySelector('[data-s="durH"]').value);
            const mm = U.toNum(wrap.querySelector('[data-s="durM"]').value);
            if (h == null && mm == null) sl.durationMin = null;
            else sl.durationMin = (h || 0) * 60 + (mm || 0);
            sl.manual = true;
          } else sl[f] = inp.value;
          recalc();
          updateHints();
        });
      });
      wrap.querySelector('[data-s="useCalc"]').addEventListener('click', () => {
        const mins = U.computeSleepMinutes(wrap.querySelector('[data-s="bedTime"]').value, wrap.querySelector('[data-s="wakeTime"]').value);
        if (mins == null) { UI.toast('Enter both sleep and wake times first.', 'error'); return; }
        sl.durationMin = mins; sl.manual = false;
        wrap.querySelector('[data-s="durH"]').value = Math.floor(mins / 60);
        wrap.querySelector('[data-s="durM"]').value = mins % 60;
        UI.toast('Sleep duration set to ' + U.fmtDuration(mins) + '.');
      });
      if (sl.durationMin != null) {
        wrap.querySelector('[data-s="durH"]').value = Math.floor(sl.durationMin / 60);
        wrap.querySelector('[data-s="durM"]').value = sl.durationMin % 60;
      }
      return wrap;
    }

    function syncDurInputs() { /* values already synced by handler */ }

    function paBody() {
      const pa = draft.ticket.pa;
      // workout suggestions: types already recorded in this journal, then common presets
      const seen = [];
      const push = (n) => {
        const v = String(n || '').trim();
        if (v && seen.findIndex((s) => s.toLowerCase() === v.toLowerCase()) < 0) seen.push(v);
      };
      Store.state.tickets.forEach((t) => push((t.pa || {}).type));
      ['jogging', 'running', 'swimming', 'cycling', 'walking', 'strength training', 'yoga', 'hiit', 'football', 'basketball'].forEach(push);
      const wrap = el('<div class="ed-grid">' +
        '<div class="field span2"><label>Workout performed</label><input type="text" data-p="type" list="ed-workout-list" placeholder="jogging, swimming…" value="' + esc(pa.type || '') + '" ' +
        'title="Pick a previously recorded workout or type your own"><div class="hint">Choose a previously recorded workout or type your own — every workout gets its own progress graph on the Progress page.</div></div>' +
        '<datalist id="ed-workout-list">' + seen.slice(0, 30).map((n) => '<option value="' + esc(n) + '"></option>').join('') + '</datalist>' +
        '<div class="field"><label>Minutes exercised this day</label><div class="dur-row">' +
        '<input type="number" min="0" data-p="dailyMinutes" placeholder="e.g. 45" value="' + (pa.dailyMinutes == null ? '' : pa.dailyMinutes) + '"><span>min</span></div>' +
        '<div class="hint">Minutes spent on this specific workout.</div></div>' +
        '<div class="field"><label>Intensity</label><select data-p="intensity">' +
        ['', 'light', 'moderate', 'vigorous'].map((i) => '<option value="' + esc(i) + '"' + (pa.intensity === i ? ' selected' : '') + '>' + esc(i || '— not recorded —') + '</option>').join('') +
        '</select></div>' +
        '<div class="field span2"><label>Notes</label><textarea rows="2" data-p="notes">' + esc(pa.notes || '') + '</textarea></div>' +
        '</div>');
      wrap.querySelectorAll('input[data-p], select[data-p], textarea[data-p]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const f = inp.dataset.p;
          pa[f] = f === 'dailyMinutes' ? (inp.value === '' ? null : U.toNum(inp.value)) : inp.value;
          updateHints();
        });
      });
      return wrap;
    }

    function sessionsBody() {
      const wrap = el('<div class="sessions"></div>');
      const list = el('<div class="session-list"></div>');
      draft.sessions.forEach((s, i) => list.appendChild(sessionCard(s, i)));
      wrap.appendChild(list);
      const addBtn = el('<button class="btn add" type="button">+ Add another training session</button>');
      addBtn.addEventListener('click', () => {
        syncFromDOM();
        draft.sessions.push(newSession(draft.ticket.date));
        render();
        const secs = qsa('.ed-section', root);
        secs[2].open = true;
      });
      wrap.appendChild(addBtn);
      const hint = el('<div class="hint mt">A ticket can hold several sessions of the same or different modes — each keeps its own time, duration, metrics, and attachments.</div>');
      wrap.appendChild(hint);
      return wrap;
    }

    function sessionCard(s, idx) {
      const modes = Store.state.modes.slice().sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
      const card = el('<div class="session-card" data-sid="' + esc(s.id) + '">' +
        '<div class="session-card-head"><strong>Session ' + (idx + 1) + '</strong>' +
        (s.date && s.date !== draft.ticket.date ? '<span class="badge warn">date differs from ticket</span>' : '') +
        '<button class="icon-btn danger" type="button" data-act="remove-session" title="Remove this session">✕</button></div>' +
        '<div class="ed-grid">' +
        '<div class="field"><label>Start time</label><input type="time" data-sf="startTime" value="' + esc(s.startTime || '') + '"></div>' +
        '<div class="field"><label>End time</label><input type="time" data-sf="endTime" value="' + esc(s.endTime || '') + '"></div>' +
        '<div class="field"><label>Duration (min)</label><input type="number" min="0" max="1440" data-sf="durationMin" value="' + (s.durationMin == null ? '' : s.durationMin) + '"><div class="hint" data-dur-hint></div></div>' +
        '<div class="field"><label>Training mode</label><select data-sf="modeId"><option value="">— select mode —</option>' +
        modes.map((mo) => '<option value="' + esc(mo.id) + '"' + (s.modeId === mo.id ? ' selected' : '') + '>' + esc(mo.name) + (mo.archived ? ' (archived)' : '') + '</option>').join('') +
        '<option value="__new">+ New training mode…</option></select></div>' +
        '<div class="field"><label>Session date</label><input type="date" data-sf="date" value="' + esc(s.date || draft.ticket.date) + '"><div class="hint">Defaults to the ticket date; override for cross-midnight or corrected sessions.</div></div>' +
        '<div class="field span2"><label>Session notes</label><textarea rows="2" data-sf="notes" placeholder="Difficulty, unusual circumstances, subjective experience, trial counts…">' + esc(s.notes || '') + '</textarea></div>' +
        '</div>' +
        '<div class="obs-block"><div class="obs-head">Performance metrics <span class="hint-inline">recorded for this session only</span></div><div class="obs-list"></div>' +
        '<button class="btn tiny add" type="button" data-act="add-obs">+ Add metric</button></div>' +
        '<div class="att-block"><div class="att-head">Session screenshots &amp; files <span class="hint-inline">files belong to this session</span></div><div class="thumbs" data-thumbs></div>' +
        '<label class="upload-btn">' + Icons.svg('paperclip') + ' Attach files<input type="file" multiple accept="image/*,.pdf,.txt,.csv" data-upload hidden></label>' +
        '<div class="hint mt">Images attached here also appear on the Profile &amp; Assessments page next to this ticket’s date. Files are downscaled and stored inside your browser with the rest of the journal.</div></div>' +
        '</div>');

      const obsList = card.querySelector('.obs-list');
      function renderObs() {
        obsList.innerHTML = '';
        if (!s.observations.length) obsList.appendChild(el('<div class="hint">No metrics recorded yet — the session can still be saved without any performance data (missing ≠ zero).</div>'));
        s.observations.forEach((o, oi) => obsList.appendChild(obsRow(o, oi)));
      }
      function obsRow(o, oi) {
        const active = Store.state.metrics.filter((m) => !m.archived || m.id === o.metricId);
        const mdef = Store.metricById(o.metricId);
        const row = el('<div class="obs-row" data-oid="' + esc(o.id) + '">' +
          '<select data-of="metricId"><option value="">— metric —</option>' +
          active.map((m) => '<option value="' + esc(m.id) + '"' + (o.metricId === m.id ? ' selected' : '') + '>' + esc(m.name) +
            (m.unit ? ' (' + esc(m.unit) + ')' : '') + (m.archived ? ' · archived' : '') + '</option>').join('') +
          '</select>' +
          '<input data-of="value" class="obs-value" placeholder="value" value="' + esc(o.value == null ? '' : o.value) + '">' +
          '<span class="obs-unit">' + esc(mdef ? mdef.unit : '') + '</span>' +
          '<input data-of="notes" class="obs-notes" placeholder="note (optional)" value="' + esc(o.notes || '') + '">' +
          '<button class="icon-btn danger" type="button" data-act="remove-obs" title="Remove">✕</button>' +
          '<div class="obs-err" data-err hidden></div></div>');
        row.querySelectorAll('[data-of]').forEach((inp) => {
          inp.addEventListener('change', () => {
            const f = inp.dataset.of;
            if (f === 'value') {
              const md = Store.metricById(o.metricId);
              if (md && md.dataType !== 'text') {
                const n = U.toNum(inp.value);
                o.value = inp.value.trim() === '' ? null : (n == null ? inp.value : n);
              } else o.value = inp.value.trim() === '' ? null : inp.value;
            } else if (f === 'metricId') {
              o.metricId = inp.value;
              const md = Store.metricById(o.metricId);
              card.querySelector('.obs-row[data-oid="' + o.id + '"] .obs-unit').textContent = md ? md.unit : '';
            } else o[f] = inp.value;
          });
        });
        row.querySelector('[data-act="remove-obs"]').addEventListener('click', () => {
          s.observations.splice(oi, 1); renderObs();
        });
        return row;
      }
      card.querySelector('[data-act="add-obs"]').addEventListener('click', () => {
        syncFromDOM();
        // preselect a sensible metric for the chosen mode if available
        let suggest = '';
        const mode = Store.modeById(s.modeId);
        if (mode) {
          const cand = Store.state.metrics.filter((m) => !m.archived && m.modeIds && m.modeIds.indexOf(mode.id) >= 0);
          if (cand.length) suggest = cand[0].id;
        }
        s.observations.push({ id: U.uid(), sessionId: null, metricId: suggest, value: null, notes: '', metricVersion: null, createdAt: null });
        renderObs();
      });
      renderObs();

      // session field bindings
      card.querySelectorAll('[data-sf]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const f = inp.dataset.sf;
          if (f === 'modeId') {
            if (inp.value === '__new') {
              inp.value = s.modeId || '';
              addModeFlow((nm) => { if (nm) s.modeId = nm.id; render(); });
              return;
            }
            s.modeId = inp.value;
          } else if (f === 'durationMin') s.durationMin = inp.value === '' ? null : U.toNum(inp.value);
          else s[f] = inp.value;
          if ((f === 'startTime' || f === 'endTime') && !s.durationMin && s.startTime && s.endTime) {
            s.durationMin = U.minutesBetween(s.startTime, s.endTime);
            card.querySelector('[data-sf="durationMin"]').value = s.durationMin;
          }
          const hintEl = card.querySelector('[data-dur-hint]');
          if (hintEl && s.startTime && s.endTime) {
            const auto = U.minutesBetween(s.startTime, s.endTime);
            hintEl.textContent = auto != null ? 'start–end = ' + U.fmtDuration(auto) : '';
          }
          updateHints();
        });
      });
      if (s.startTime && s.endTime) {
        const auto = U.minutesBetween(s.startTime, s.endTime);
        card.querySelector('[data-dur-hint]').textContent = auto != null ? 'start–end = ' + U.fmtDuration(auto) : '';
      }
      card.querySelector('[data-act="remove-session"]').addEventListener('click', async () => {
        const atts = Store.attachmentsOf('session', s.id);
        const msg = 'Remove “Session ' + (idx + 1) + '”?' +
          (s.observations.length ? '<br>• ' + s.observations.length + ' performance observation(s) will be deleted.' : '') +
          (atts.length ? '<br>• ' + atts.length + ' attached file(s) will be deleted.' : '') +
          '<br><br>Nothing is saved until you press <strong>Save ticket</strong>.';
        const ok = await UI.confirm({ title: 'Remove session', messageHtml: msg, okLabel: 'Remove session' });
        if (!ok) return;
        syncFromDOM();
        draft.sessions.splice(idx, 1);
        Store.attachmentsOf('session', s.id).forEach((a) => draft.deleteAttachmentIds.push(a.id));
        if (!draft.sessions.length) draft.sessions.push(newSession(draft.ticket.date));
        render();
      });

      renderThumbs(card, 'session', s);
      return card;
    }

    function notesBody() {
      return el('<div class="field"><textarea rows="4" data-t="notes" placeholder="Anything else about this day…">' + esc(draft.ticket.notes || '') + '</textarea></div>');
    }

    function renderThumbs(container, ownerType, ownerObj) {
      const host = container.querySelector('[data-thumbs]');
      const existing = Store.attachmentsOf(ownerType, ownerObj.id).filter((a) => draft.deleteAttachmentIds.indexOf(a.id) < 0);
      host.innerHTML = '';
      if (!existing.length) host.appendChild(el('<div class="hint">No files attached.</div>'));
      existing.forEach((a) => {
        const t = el('<div class="thumb" data-aid="' + esc(a.id) + '">' +
          (a.mime && a.mime.indexOf('image') === 0
            ? '<img src="' + a.dataUrl + '" alt="' + esc(a.name) + '">'
            : '<div class="thumb-file">' + esc((a.name || 'file').split('.').pop().toUpperCase()) + '</div>') +
          '<button class="icon-btn danger thumb-x" type="button" title="Remove">✕</button></div>');
        t.addEventListener('click', (e) => {
          if (e.target.closest('.thumb-x')) return;
          if (a.mime && a.mime.indexOf('image') === 0) UI.viewImage(a.dataUrl, a.name);
        });
        t.querySelector('.thumb-x').addEventListener('click', async () => {
          const ok = await UI.confirm({ title: 'Remove attachment', message: 'Remove “' + a.name + '”? This is applied on save.', okLabel: 'Remove' });
          if (!ok) return;
          draft.deleteAttachmentIds.push(a.id);
          renderThumbs(container, ownerType, ownerObj);
        });
        host.appendChild(t);
      });
      const up = container.querySelector('[data-upload]');
      if (up) {
        up.addEventListener('change', async () => {
          const files = Array.from(up.files || []);
          up.value = '';
          if (!files.length) return;
          await handleFiles(files, ownerType, ownerObj);
          renderThumbs(container, ownerType, ownerObj);
        });
      }
    }

    async function handleFiles(files, ownerType, ownerObj) {
      for (const f of files) {
        try {
          let dataUrl;
          if (f.type.indexOf('image/') === 0) dataUrl = await U.compressImage(f);
          else {
            if (f.size > 4 * 1048576) { UI.toast('“' + f.name + '” is too large (max 4 MB for non-images).', 'error'); continue; }
            dataUrl = await U.readAsDataURL(f);
          }
          draft.attachments.push({
            id: U.uid(), ownerType, ownerId: ownerObj.id, name: f.name,
            mime: f.type || 'application/octet-stream', size: f.size, dataUrl, createdAt: null
          });
        } catch (e) {
          UI.toast('Could not attach “' + f.name + '”: ' + e.message, 'error');
        }
      }
    }

    function metaLine() {
      const t = draft.ticket;
      return el('<div class="ed-meta">Created ' + esc(U.fmtDateTime(t.createdAt)) +
        ' · Last modified ' + esc(U.fmtDateTime(t.updatedAt)) +
        ' <span class="hint-inline">(recorded event date: ' + esc(U.fmtDate(t.date)) + ')</span></div>');
    }

    function footerRow() {
      const f = el('<div class="ed-footer">' +
        (draft.isNew ? '' : '<button class="btn" type="button" data-act="duplicate">Duplicate</button>') +
        (draft.isNew ? '' : '<button class="btn danger" type="button" data-act="delete">Delete ticket</button>') +
        '<span class="grow"></span>' +
        '<button class="btn" type="button" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" type="button" data-act="save">Save ticket</button>' +
        '</div>');
      const dup = footerRowEl(f, 'duplicate', async () => {
        const nd = Store.duplicateTicketDraft(draft.ticket.id);
        if (!nd) return;
        m.close();
        open(nd);
      });
      void dup;
      footerRowEl(f, 'delete', async () => {
        const sess = Store.sessionsOf(draft.ticket.id);
        const obsCount = sess.reduce((n, s) => n + Store.observationsOf(s.id).length, 0);
        const attCount = Store.state.attachments.filter((a) => a.ownerType === 'ticket' && a.ownerId === draft.ticket.id)
          .concat(sess.flatMap((s) => Store.attachmentsOf('session', s.id))).length;
        const ok = await UI.confirm({
          title: 'Delete this daily ticket?',
          messageHtml: 'This permanently removes:<br>• 1 daily ticket (' + esc(U.fmtDate(draft.ticket.date)) + ')' +
            '<br>• ' + sess.length + ' training session(s)' +
            '<br>• ' + obsCount + ' performance observation(s)' +
            '<br>• ' + attCount + ' attached file(s)' +
            '<br><br>All graphs and statistics will be recalculated without this day. This cannot be undone (export a backup first if unsure).',
          okLabel: 'Delete permanently'
        });
        if (!ok) return;
        await Store.deleteTicket(draft.ticket.id);
        UI.toast('Ticket deleted.');
        m.close();
      });
      footerRowEl(f, 'cancel', () => { discardDraftAttachments(); m.close(); });
      footerRowEl(f, 'save', () => save());
      return f;
    }

    function footerRowEl(root2, act, fn) {
      const b = root2.querySelector('[data-act="' + act + '"]');
      if (b) b.addEventListener('click', fn);
      return b;
    }

    /* ---------- syncing & saving ---------- */

    function syncFromDOM() {
      const dateIn = qs('[data-f="date"]', root);
      if (dateIn) draft.ticket.date = dateIn.value || U.todayISO();
      const notesIn = qs('[data-t="notes"]', root);
      if (notesIn) draft.ticket.notes = notesIn.value;
      qsa('.session-card', root).forEach((card) => {
        const sid = card.dataset.sid;
        const s = draft.sessions.find((x) => x.id === sid);
        if (!s) return;
        card.querySelectorAll('[data-sf]').forEach((inp) => {
          const f = inp.dataset.sf;
          if (f === 'modeId' && inp.value === '__new') return;
          if (f === 'durationMin') s.durationMin = inp.value === '' ? null : U.toNum(inp.value);
          else s[f] = inp.value;
        });
        s.observations = Array.from(card.querySelectorAll('.obs-row')).map((row) => {
          const oid = row.dataset.oid;
          const prev = s.observations.find((o) => o.id === oid) || {};
          const metricId = row.querySelector('[data-of="metricId"]').value;
          const valueRaw = row.querySelector('[data-of="value"]').value.trim();
          const md = Store.metricById(metricId);
          let value = null;
          if (valueRaw !== '') {
            if (md && md.dataType !== 'text') { const n = U.toNum(valueRaw); value = n == null ? valueRaw : n; }
            else value = valueRaw;
          }
          return Object.assign({}, prev, {
            id: oid, metricId, value,
            notes: row.querySelector('[data-of="notes"]').value.trim()
          });
        });
      });
    }

    async function save() {
      syncFromDOM();
      // validation
      const errors = [];
      if (!draft.ticket.date) errors.push('A session date is required.');
      for (let i = 0; i < draft.sessions.length; i++) {
        const s = draft.sessions[i];
        if (!s.modeId) errors.push('Session ' + (i + 1) + ': choose a training mode (use “Other / custom” if none fits).');
        for (const o of s.observations) {
          const md = Store.metricById(o.metricId);
          if (!o.metricId) { errors.push('Session ' + (i + 1) + ': a metric row is missing its metric.'); continue; }
          if (!md) continue;
          if (md.dataType !== 'text') {
            const n = U.toNum(o.value);
            if (o.value != null && o.value !== '' && n == null) errors.push('Session ' + (i + 1) + ', ' + md.name + ': “' + o.value + '” is not a number.');
            if (n != null) {
              if (md.min != null && n < md.min) errors.push('Session ' + (i + 1) + ', ' + md.name + ': ' + n + ' is below the valid minimum (' + md.min + ').');
              if (md.max != null && n > md.max) errors.push('Session ' + (i + 1) + ', ' + md.name + ': ' + n + ' exceeds the valid maximum (' + md.max + ').');
            }
          }
        }
      }
      if (errors.length) {
        UI.toast(errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : ''), 'error');
        return;
      }
      try {
        // attach uploaded files into the draft's pending list so they persist with the save
        const pending = draft.attachments.slice();
        draft.attachments = [];
        await Store.saveTicketDraft(draft);
        if (pending.length) await Store.addAttachments(pending);
        UI.toast(draft.isNew ? 'Ticket saved.' : 'Ticket updated — graphs refreshed.');
        m.close();
      } catch (e) {
        console.error(e);
        UI.toast('Save failed: ' + e.message, 'error');
      }
    }

    function discardDraftAttachments() {
      draft.attachments.forEach((a) => { /* never written to DB — nothing to clean */ });
    }

    function updateHints() {
      const sl = draft.ticket.sleep;
      const hSleep = qs('[data-hint-sleep]', root);
      if (hSleep) hSleep.textContent = sl.durationMin != null ? U.fmtDuration(sl.durationMin) : '';
      const pa = draft.ticket.pa;
      const hPa = qs('[data-hint-pa]', root);
      if (hPa) hPa.textContent = pa.dailyMinutes != null
        ? pa.dailyMinutes + ' min' + (pa.type ? ' · ' + pa.type : '')
        : '';
      const hSess = qs('[data-hint-sessions]', root);
      if (hSess) hSess.textContent = draft.sessions.length + ' session' + (draft.sessions.length === 1 ? '' : 's');
    }
    updateHints();
  }

  async function addModeFlow(cb) {
    const name = await UI.promptText({ title: 'New training mode', label: 'Mode / task name', placeholder: 'e.g. Dual n-back' });
    if (!name) { if (cb) cb(); return; }
    const m = await Store.saveMode({ name, description: '', color: '' });
    UI.toast('Mode “' + name + '” added.');
    if (cb) cb(m);
  }

  return { open, newDraft, draftFromTicket };
})();
