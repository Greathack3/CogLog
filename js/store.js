/* Cognitive Evolution Tracker — data model + state store.

   Entities (spec §11):
     profile (meta) · tickets · sessions · modes · metrics · observations · assessments · attachments

   Relationships: ticket 1—n session 1—n observation n—1 metric.
   Every observation references the session that produced it; every session references its ticket,
   mode, and metric definitions keep a version history so records made under an older definition
   remain distinguishable (spec §3.6). Event dates (session.date) are stored separately from
   entry timestamps (createdAt) (spec §10). */
window.Store = (function () {
  'use strict';
  const { uid, todayISO, nowISO } = U;

  const state = {
    profile: null,
    modes: [], metrics: [], tickets: [], sessions: [], observations: [],
    assessments: [], attachments: [],
    ready: false, storageMode: 'idb'
  };

  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach((f) => { try { f(); } catch (e) { console.error('[CET] listener error', e); } }); }

  /* ---------------- defaults ---------------- */

  const DEFAULT_MODES = [
    { name: 'Executive N-back', color: '#4f7cff', description: 'Working-memory updating training (n-back family).' },
    { name: 'Relational Reasoning Training (RRT)', color: '#e0913a', description: 'Relational integration / reasoning training.' },
    { name: 'Processing-speed training', color: '#2aa18f', description: 'Speed-of-processing and reaction-time tasks.' },
    { name: 'Other / custom', color: '#8b7cf6', description: 'Any other training task.' }
  ];

  const DEFAULT_METRICS = [
    { name: 'Accuracy', unit: '%', dataType: 'percent', direction: 'higher_better', min: 0, max: 100, modes: '*',
      description: 'Percent correct under this session’s scoring rules. Record the trial count in the session notes so results computed over different trial counts stay comparable.' },
    { name: 'N-back level', unit: 'back', dataType: 'level', direction: 'higher_better', min: 0, max: null, modes: ['Executive N-back'],
      description: 'The n-back load trained in this session (e.g. 4 = 4-back). Level is a difficulty setting, not a score.' },
    { name: 'Highest level achieved', unit: 'level', dataType: 'level', direction: 'higher_better', min: 0, max: null, modes: '*',
      description: 'Highest difficulty level reached during the session.' },
    { name: 'RRT premises completed', unit: 'premises', dataType: 'count', direction: 'higher_better', min: 0, max: null,
      modes: ['Relational Reasoning Training (RRT)'], description: 'Number of reasoning premises completed.' },
    { name: 'Reaction time', unit: 'ms', dataType: 'duration_ms', direction: 'lower_better', min: 0, max: null, modes: '*',
      description: 'Mean response latency in milliseconds. Lower is better.' },
    { name: 'Correct responses', unit: 'count', dataType: 'count', direction: 'higher_better', min: 0, max: null, modes: '*',
      description: 'Absolute number of correct responses (pair with trial count for context).' },
    { name: 'Completed trials', unit: 'trials', dataType: 'count', direction: 'higher_better', min: 0, max: null, modes: '*',
      description: 'Number of trials completed in the session.' }
  ];

  function defaultProfile() {
    const t = nowISO();
    return {
      name: '', age: '', birthYear: '', snapshots: [], gender: '', occupation: '', occupationCustom: '',
      plans: { exercise: '', frequency: '', diet: '', other: '', startDate: '' },
      trainingPrep: { plan: '', conditions: '', goals: '', startDate: '' },
      sensitive: { notes: '' },
      createdAt: t, updatedAt: t
    };
  }

  /** Shape migration for profiles saved before the Training-preparation panel existed:
     add the default shape, and carry over any legacy baseline-assessment "training
     preparation" notes (the stored values stay on their records untouched; the panel
     simply surfaces them again so nothing the user wrote is lost). */
  async function ensureTrainingPrep() {
    const p = state.profile;
    if (!p || p.trainingPrep) return;
    const tp = { plan: '', conditions: '', goals: '', startDate: '' };
    const legacy = state.assessments
      .filter((a) => a.preparation && String(a.preparation).trim())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (legacy.length) {
      tp.plan = legacy.map((a) =>
        '[' + (a.date || 'undated') + (a.testName ? ' · ' + a.testName : '') + '] ' + String(a.preparation).trim()
      ).join('\n\n');
    }
    p.trainingPrep = tp;
    await DB.setMeta('profile', p);
  }

  async function seedDefaults() {
    const now = nowISO();
    const modeObjs = DEFAULT_MODES.map((m) => ({ id: uid(), name: m.name, color: m.color, description: m.description, archived: false, createdAt: now, updatedAt: now }));
    await DB.putMany('modes', modeObjs);
    state.modes = modeObjs;
    const metricObjs = DEFAULT_METRICS.map((m) => ({
      id: uid(), name: m.name, unit: m.unit, dataType: m.dataType, direction: m.direction,
      min: m.min, max: m.max, target: '',
      modeIds: m.modes === '*' ? modeObjs.map((x) => x.id) : modeObjs.filter((x) => m.modes.indexOf(x.name) >= 0).map((x) => x.id),
      description: m.description, archived: false, currentVersion: 1,
      versions: [{ v: 1, changedAt: now, note: 'Initial definition (shipped default).' }],
      createdAt: now, updatedAt: now
    }));
    await DB.putMany('metrics', metricObjs);
    state.metrics = metricObjs;
  }

  /* ---------------- init / reload ---------------- */

  async function init() {
    state.storageMode = await DB.open();
    await reload();
    state.ready = true;
    emit();
  }

  async function reload() {
    const [modes, metrics, tickets, sessions, observations, assessments, attachments] = await Promise.all([
      DB.all('modes'), DB.all('metrics'), DB.all('tickets'), DB.all('sessions'),
      DB.all('observations'), DB.all('assessments'), DB.all('attachments')
    ]);
    state.modes = modes; state.metrics = metrics; state.tickets = tickets;
    state.sessions = sessions; state.observations = observations;
    state.assessments = assessments; state.attachments = attachments;
    const prof = await DB.getMeta('profile');
    state.profile = prof || defaultProfile();
    await ensureTrainingPrep();
    if (!state.modes.length || !state.metrics.length) await seedDefaults();
  }

  async function eraseAll() {
    await DB.clearAll();
    state.profile = defaultProfile();
    await DB.setMeta('profile', state.profile);
    await seedDefaults();
    state.tickets = []; state.sessions = []; state.observations = [];
    state.assessments = []; state.attachments = [];
    // WM assessment data shares the same database — "erase everything" means it too.
    if (window.WMStore && WMStore.state.ready) await WMStore.deleteAllData();
    emit();
  }

  /* ---------------- generic helpers ---------------- */

  function upsert(arr, obj, keyField) {
    keyField = keyField || 'id';
    const i = arr.findIndex((r) => r[keyField] === obj[keyField]);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  }

  const byId = (arr, id) => arr.find((r) => r.id === id) || null;
  const ticketById = (id) => byId(state.tickets, id);
  const sessionById = (id) => byId(state.sessions, id);
  const observationById = (id) => byId(state.observations, id);
  const assessmentById = (id) => byId(state.assessments, id);
  const modeById = (id) => byId(state.modes, id);
  const metricById = (id) => byId(state.metrics, id);

  function sessionsOf(ticketId) {
    return state.sessions.filter((s) => s.ticketId === ticketId)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }
  function observationsOf(sessionId) {
    return state.observations.filter((o) => o.sessionId === sessionId);
  }
  function attachmentsOf(ownerType, ownerId) {
    return state.attachments.filter((a) => a.ownerType === ownerType && a.ownerId === ownerId)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  /** Chronological ticket ordering: by event date first, creation timestamp only as tie-breaker. */
  function sortedTickets(desc) {
    const arr = state.tickets.slice().sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      if (d !== 0) return d;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    return desc ? arr.reverse() : arr;
  }

  /* ---------------- profile ---------------- */

  async function saveProfile(patch) {
    Object.assign(state.profile, patch);
    state.profile.updatedAt = nowISO();
    await DB.setMeta('profile', state.profile);
    emit();
    return state.profile;
  }

  async function addSnapshot(snap) {
    snap.id = uid();
    snap.createdAt = nowISO();
    if (!snap.date) snap.date = todayISO();
    state.profile.snapshots = state.profile.snapshots || [];
    state.profile.snapshots.push(snap);
    state.profile.snapshots.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    state.profile.updatedAt = nowISO();
    await DB.setMeta('profile', state.profile);
    emit();
    return snap;
  }

  async function removeSnapshot(id) {
    state.profile.snapshots = (state.profile.snapshots || []).filter((s) => s.id !== id);
    state.profile.updatedAt = nowISO();
    await DB.setMeta('profile', state.profile);
    emit();
  }

  /* ---------------- training modes ---------------- */

  const MODE_PALETTE = ['#4f7cff', '#e0913a', '#2aa18f', '#8b7cf6', '#e5484d', '#d6459e', '#3b82c4', '#7a8f3c'];

  async function saveMode(m) {
    const now = nowISO();
    if (!m.id) {
      m.id = uid(); m.createdAt = now; m.archived = false;
      if (!m.color) m.color = MODE_PALETTE[state.modes.length % MODE_PALETTE.length];
    }
    m.updatedAt = now;
    await DB.put('modes', m);
    upsert(state.modes, m);
    emit();
    return m;
  }

  /** Deleting an in-use mode archives it instead so historical records keep a valid association. */
  async function deleteMode(id) {
    const used = state.sessions.some((s) => s.modeId === id);
    if (used) {
      const m = modeById(id);
      if (m) { m.archived = true; m.updatedAt = nowISO(); await DB.put('modes', m); }
      emit();
      return { archived: true };
    }
    await DB.del('modes', id);
    state.modes = state.modes.filter((m) => m.id !== id);
    emit();
    return { archived: false };
  }

  /* ---------------- metric definitions (versioned) ---------------- */

  const DEFINITIONAL_FIELDS = ['name', 'unit', 'dataType', 'direction', 'min', 'max', 'target'];

  async function saveMetric(m) {
    const now = nowISO();
    const existing = m.id ? metricById(m.id) : null;
    if (!existing) {
      m.id = uid(); m.createdAt = now; m.archived = false;
      m.currentVersion = 1;
      m.versions = [{ v: 1, changedAt: now, note: 'Initial definition.' }];
      // Normalise optional numerics: keep null (unknown), not 0 (spec: never invent values)
      m.min = m.min === '' || m.min == null ? null : U.toNum(m.min);
      m.max = m.max === '' || m.max == null ? null : U.toNum(m.max);
      m.target = m.target === '' || m.target == null ? null : U.toNum(m.target);
    } else {
      const changed = DEFINITIONAL_FIELDS.filter((f) => String(existing[f] == null ? '' : existing[f]) !== String(m[f] == null ? '' : m[f]));
      m.min = m.min === '' || m.min == null ? null : U.toNum(m.min);
      m.max = m.max === '' || m.max == null ? null : U.toNum(m.max);
      m.target = m.target === '' || m.target == null ? null : U.toNum(m.target);
      m.createdAt = existing.createdAt;
      m.versions = existing.versions || [{ v: 1, changedAt: existing.createdAt, note: 'Initial definition.' }];
      m.currentVersion = existing.currentVersion || 1;
      if (changed.length) {
        m.currentVersion = m.currentVersion + 1;
        m.versions.push({
          v: m.currentVersion, changedAt: now,
          note: 'Changed: ' + changed.join(', ') + '. Observations recorded before this point keep the earlier version number.'
        });
      }
    }
    m.updatedAt = now;
    await DB.put('metrics', m);
    upsert(state.metrics, m);
    emit();
    return m;
  }

  async function archiveMetric(id) {
    const m = metricById(id);
    if (!m) return;
    m.archived = !m.archived;
    m.updatedAt = nowISO();
    await DB.put('metrics', m);
    emit();
    return m;
  }

  /* ---------------- tickets / sessions / observations ---------------- */

  async function saveTicketDraft(draft) {
    const now = nowISO();
    const t = draft.ticket;
    if (!t.date) t.date = todayISO();
    if (!t.id) { t.id = uid(); t.createdAt = now; }
    t.updatedAt = now;
    await DB.put('tickets', t);
    upsert(state.tickets, t);

    const keepSessionIds = new Set();
    const keepObsIds = new Set();

    for (const s of draft.sessions) {
      keepSessionIds.add(s.id);
      if (!s.createdAt) s.createdAt = now;
      s.updatedAt = now;
      s.ticketId = t.id;
      if (!s.date) s.date = t.date;
      await DB.put('sessions', s);
      upsert(state.sessions, s);
      for (const o of (s.observations || [])) {
        keepObsIds.add(o.id);
        if (!o.createdAt) o.createdAt = now;
        o.updatedAt = now;
        o.sessionId = s.id;
        o.ticketId = t.id;
        const m = metricById(o.metricId);
        if (m) o.metricVersion = m.currentVersion;
        await DB.put('observations', o);
        upsert(state.observations, o);
      }
    }

    // cascade deletions inside this ticket
    for (const o of state.observations.slice()) {
      if (o.ticketId === t.id && !keepObsIds.has(o.id)) {
        await DB.del('observations', o.id);
        state.observations = state.observations.filter((x) => x.id !== o.id);
      }
    }
    for (const s of state.sessions.slice()) {
      if (s.ticketId === t.id && !keepSessionIds.has(s.id)) {
        for (const o of state.observations.slice()) {
          if (o.sessionId === s.id) {
            await DB.del('observations', o.id);
            state.observations = state.observations.filter((x) => x.id !== o.id);
          }
        }
        await removeAttachmentsFor('session', s.id);
        await DB.del('sessions', s.id);
        state.sessions = state.sessions.filter((x) => x.id !== s.id);
      }
    }

    for (const a of (draft.attachments || [])) {
      if (!a.createdAt) a.createdAt = now;
      await DB.put('attachments', a);
      upsert(state.attachments, a);
    }
    for (const id of (draft.deleteAttachmentIds || [])) {
      await DB.del('attachments', id);
      state.attachments = state.attachments.filter((x) => x.id !== id);
    }

    emit();
    return t;
  }

  async function deleteTicket(id) {
    const sess = state.sessions.filter((s) => s.ticketId === id);
    for (const s of sess) {
      for (const o of state.observations.filter((x) => x.sessionId === s.id)) {
        await DB.del('observations', o.id);
        state.observations = state.observations.filter((x) => x.id !== o.id);
      }
      await removeAttachmentsFor('session', s.id);
      await DB.del('sessions', s.id);
      state.sessions = state.sessions.filter((x) => x.id !== s.id);
    }
    await removeAttachmentsFor('ticket', id);
    await DB.del('tickets', id);
    state.tickets = state.tickets.filter((t) => t.id !== id);
    emit();
  }

  /** Duplicate a ticket into a new draft dated today (all ids fresh, timestamps reset). */
  function duplicateTicketDraft(id) {
    const src = ticketById(id);
    if (!src) return null;
    const now = nowISO();
    const newDate = todayISO();
    const draft = {
      isNew: true,
      ticket: {
        id: null, date: newDate,
        sleep: JSON.parse(JSON.stringify(src.sleep || {})),
        pa: JSON.parse(JSON.stringify(src.pa || {})),
        notes: src.notes || '', createdAt: null, updatedAt: null
      },
      sessions: sessionsOf(id).map((s) => ({
        id: uid(), ticketId: null, date: newDate,
        startTime: s.startTime || '', endTime: s.endTime || '', durationMin: s.durationMin == null ? null : s.durationMin,
        modeId: s.modeId || '', notes: s.notes || '', createdAt: null, updatedAt: null,
        observations: observationsOf(s.id).map((o) => ({
          id: uid(), sessionId: null, metricId: o.metricId, metricVersion: null, value: o.value, notes: o.notes || '', createdAt: null
        })),
        attachments: []
      })),
      attachments: [],
      deleteAttachmentIds: []
    };
    void now;
    return draft;
  }

  /* ---------------- attachments ---------------- */

  async function addAttachments(items) {
    const now = nowISO();
    for (const a of items) { if (!a.createdAt) a.createdAt = now; }
    await DB.putMany('attachments', items);
    for (const a of items) upsert(state.attachments, a);
    emit();
    return items;
  }

  async function deleteAttachment(id) {
    await DB.del('attachments', id);
    state.attachments = state.attachments.filter((a) => a.id !== id);
    emit();
  }

  async function removeAttachmentsFor(ownerType, ownerId) {
    const gone = state.attachments.filter((a) => a.ownerType === ownerType && a.ownerId === ownerId);
    for (const a of gone) await DB.del('attachments', a.id);
    state.attachments = state.attachments.filter((a) => !(a.ownerType === ownerType && a.ownerId === ownerId));
  }

  /* ---------------- assessments ---------------- */

  async function saveAssessment(a) {
    const now = nowISO();
    if (!a.id) { a.id = uid(); a.createdAt = now; }
    a.updatedAt = now;
    // normalise optional psychometrics: '' -> null (never invent values)
    for (const f of ['reliability', 'gLoading', 'normSD', 'scaleMin', 'scaleMax', 'overallScore']) {
      a[f] = (a[f] === '' || a[f] == null) ? null : U.toNum(a[f]);
    }
    // normalise the dedicated text fields (baseline preparation / follow-up conclusions)
    for (const f of ['preparation', 'conclusions']) {
      a[f] = a[f] == null ? null : (String(a[f]).trim() || null);
    }
    await DB.put('assessments', a);
    upsert(state.assessments, a);
    emit();
    return a;
  }

  async function deleteAssessment(id) {
    await removeAttachmentsFor('assessment', id);
    await DB.del('assessments', id);
    state.assessments = state.assessments.filter((a) => a.id !== id);
    emit();
  }

  function assessmentsOfKind(kind) {
    return state.assessments.filter((a) => a.kind === kind)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  /** Intervening training sessions between two assessment dates (exclusive). */
  function sessionsBetween(dateA, dateB) {
    if (!dateA || !dateB) return null;
    const lo = dateA < dateB ? dateA : dateB;
    const hi = dateA < dateB ? dateB : dateA;
    return state.sessions.filter((s) => s.date && s.date > lo && s.date < hi);
  }

  /* ---------------- ticket notes compilation ---------------- */

  /* Compiles every note inside each ticket — daily notes, sleep/PA notes, per-session
     notes, and per-observation notes — into a date-stamped, chronological document.
     Returns [{date, createdAt, lines:[{kind, label, text}]}], oldest first, containing
     only days that actually carry at least one note. Shared by the Profile notes panel
     and the shared-report export so both always agree. */
  function compileTicketNotes() {
    const days = [];
    sortedTickets(false).forEach((t) => {
      const lines = [];
      const tNote = (t.notes || '').trim();
      if (tNote) lines.push({ kind: 'ticket', label: 'Day notes', text: tNote });
      const sl = t.sleep || {};
      const slNote = (sl.notes || '').trim();
      if (slNote) lines.push({ kind: 'sleep', label: 'Sleep note', text: slNote });
      const pa = t.pa || {};
      const paNote = (pa.notes || '').trim();
      if (paNote) lines.push({ kind: 'pa', label: 'Physical-activity note', text: paNote });
      sessionsOf(t.id)
        .slice().sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')))
        .forEach((s) => {
          const mode = modeById(s.modeId);
          const label = (s.startTime ? s.startTime + ' · ' : '') + (mode ? mode.name : 'Session');
          const sNote = (s.notes || '').trim();
          if (sNote) lines.push({ kind: 'session', label: label, text: sNote });
          observationsOf(s.id).forEach((o) => {
            const oNote = (o.notes || '').trim();
            if (!oNote) return;
            const m = metricById(o.metricId);
            lines.push({
              kind: 'obs',
              label: label + ' · ' + (m ? m.name : 'metric'),
              text: oNote
            });
          });
        });
      if (lines.length) days.push({ date: t.date, createdAt: t.createdAt || null, lines });
    });
    return days;
  }

  /* ---------------- derived queries for graphs ---------------- */

  /* Returns rows {obs, session, ticket, metric, mode} sorted by session date then start time. */
  function queryObservations(opts) {
    opts = opts || {};
    const { metricId, metricVersion, modeIds, from, to, search } = opts;
    const rows = [];
    for (const o of state.observations) {
      if (metricId && o.metricId !== metricId) continue;
      if (metricVersion != null && o.metricVersion !== metricVersion) continue;
      const s = sessionById(o.sessionId);
      if (!s || !s.date) continue; // sessions without a date are not plotted (never plotted by createdAt)
      if (from && s.date < from) continue;
      if (to && s.date > to) continue;
      if (modeIds && modeIds.length && modeIds.indexOf(s.modeId) < 0) continue;
      const t = ticketById(s.ticketId);
      const m = metricById(o.metricId);
      if (!m) continue;
      if (search) {
        const hay = [m.name, (modeById(s.modeId) || {}).name, o.notes, s.notes, t && t.notes].join(' ').toLowerCase();
        if (hay.indexOf(String(search).toLowerCase()) < 0) continue;
      }
      rows.push({ obs: o, session: s, ticket: t, metric: m, mode: modeById(s.modeId) });
    }
    rows.sort((a, b) => {
      if (a.session.date !== b.session.date) return a.session.date < b.session.date ? -1 : 1;
      return (a.session.startTime || '').localeCompare(b.session.startTime || '');
    });
    return rows;
  }

  function ticketsInRange(from, to) {
    return state.tickets.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
  }

  /* ---------------- sample data (explicitly loaded by the user) ---------------- */

  async function loadSampleData() {
    const now = nowISO();
    const modes = state.modes;
    const findMode = (n) => modes.find((m) => m.name.indexOf(n) >= 0) || modes[modes.length - 1];
    const nback = findMode('N-back'), rrt = findMode('RRT'), speed = findMode('Processing');
    const mName = (n) => state.metrics.find((m) => m.name === n);
    const mLevel = mName('N-back level'), mHi = mName('Highest level achieved'), mPrem = mName('RRT premises completed'),
      mAcc = mName('Accuracy'), mRT = mName('Reaction time'), mTrials = mName('Completed trials');

    const rnd = (a, b) => a + Math.random() * (b - a);
    const tickets = [], sessions = [], observations = [];
    let nbackLevel = 2, rrtPrem = 3, rt = 720;

    for (let i = 60; i >= 0; i--) {
      if (Math.random() < 0.22) continue; // rest days
      const date = U.addDays(todayISO(), -i);
      const dayIdx = 60 - i;
      const t = { id: uid(), date, createdAt: now + 'T09:00:00.000Z', updatedAt: now, notes: '', sleep: {}, pa: {} };
      if (Math.random() < 0.9) {
        const bedMin = Math.round(rnd(22 * 60, 25 * 60)), dur = Math.round(rnd(330, 480));
        t.sleep = {
          bedTime: U.minToHHMM(bedMin), wakeTime: U.minToHHMM(bedMin + dur),
          durationMin: dur, quality: Math.round(rnd(2, 5)),
          notes: Math.random() < 0.1 ? 'Woke up once during the night.' : ''
        };
      }
      if (dayIdx % 2 === 0) {
        const sampleTypes = ['jogging', 'cycling', 'strength training'];
        t.pa = {
          dailyMinutes: Math.round(rnd(20, 75)),
          type: sampleTypes[Math.floor(dayIdx / 2) % sampleTypes.length],
          intensity: ['light', 'moderate', 'vigorous'][Math.floor(dayIdx / 4) % 3], notes: ''
        };
      }
      tickets.push(t);

      const makeSession = (mode, startMin, obsDefs) => {
        const s = {
          id: uid(), ticketId: t.id, date, startTime: U.minToHHMM(startMin),
          endTime: U.minToHHMM(startMin + Math.round(rnd(15, 50))),
          durationMin: null, modeId: mode.id, notes: '', createdAt: now, updatedAt: now
        };
        s.durationMin = U.minutesBetween(s.startTime, s.endTime);
        sessions.push(s);
        for (const [metric, value] of obsDefs) {
          if (!metric) continue;
          observations.push({
            id: uid(), sessionId: s.id, ticketId: t.id, metricId: metric.id,
            metricVersion: metric.currentVersion, value, notes: '', createdAt: now, updatedAt: now
          });
        }
      };

      if (Math.random() < 0.85) {
        nbackLevel = Math.min(6, 2 + dayIdx / 22 + rnd(-0.4, 0.4));
        const lvl = Math.max(1, Math.round(nbackLevel));
        makeSession(nback, 8 * 60 + Math.round(rnd(0, 90)), [
          [mLevel, lvl], [mAcc, Math.round(U.clamp(68 + dayIdx * 0.3 + rnd(-6, 6), 40, 99))]
        ]);
      }
      if (Math.random() < 0.55) {
        rrtPrem = Math.min(12, 3 + dayIdx / 9 + rnd(-0.5, 0.5));
        makeSession(rrt, 13 * 60 + Math.round(rnd(0, 120)), [
          [mPrem, Math.max(1, Math.round(rrtPrem))], [mAcc, Math.round(U.clamp(72 + dayIdx * 0.2 + rnd(-6, 6), 40, 99))]
        ]);
      }
      if (Math.random() < 0.4) {
        rt = Math.max(430, 730 - dayIdx * 4 + rnd(-30, 30));
        makeSession(speed, 19 * 60 + Math.round(rnd(0, 150)), [
          [mRT, Math.round(rt)], [mTrials, Math.round(rnd(40, 90))]
        ]);
      }
    }

    const assessments = [
      {
        id: uid(), kind: 'baseline', testName: 'WAIS-IV (full-scale)', date: U.addDays(todayISO(), -70),
        scoreType: 'Full-scale IQ (deviation, mean 100, SD 15)', scaleMin: 40, scaleMax: 160, normSD: 15,
        overallScore: 128, subtests: [{ name: 'Working memory index', value: 122 }, { name: 'Perceptual reasoning index', value: 131 }],
        reliability: 0.96, gLoading: null, notes: 'Tested in a quiet room, no time pressure, administered by a qualified examiner.',
        createdAt: now, updatedAt: now
      },
      {
        id: uid(), kind: 'followup', testName: 'WAIS-IV (full-scale)', date: U.addDays(todayISO(), -2),
        scoreType: 'Full-scale IQ (deviation, mean 100, SD 15)', scaleMin: 40, scaleMax: 160, normSD: 15,
        overallScore: 133, subtests: [{ name: 'Working memory index', value: 129 }, { name: 'Perceptual reasoning index', value: 134 }],
        reliability: 0.96, gLoading: null, notes: 'Same testing conditions as baseline.',
        createdAt: now, updatedAt: now
      }
    ];

    await DB.putMany('tickets', tickets);
    await DB.putMany('sessions', sessions);
    await DB.putMany('observations', observations);
    await DB.putMany('assessments', assessments);
    await reload();
    emit();
  }

  /* ---------------- export bundle ---------------- */

  function exportBundle(opts) {
    opts = opts || {};
    const includeAttachments = opts.attachments !== false;
    const data = {
      profile: state.profile,
      modes: state.modes, metrics: state.metrics, tickets: state.tickets,
      sessions: state.sessions, observations: state.observations, assessments: state.assessments,
      attachments: includeAttachments ? state.attachments : []
    };
    // WM Assessment Platform data rides along in the full backup (spec §11).
    if (window.WMStore && WMStore.state.ready) {
      data.wm = {
        participant: WMStore.state.participant,
        settings: WMStore.state.settings,
        configVersions: WMStore.state.configVersions,
        sessions: WMStore.state.sessions,
        blocks: WMStore.state.blocks,
        trials: WMStore.state.trials
      };
    }
    return {
      app: 'cognitive-evolution-tracker',
      schemaVersion: 1,
      exportedAt: nowISO(),
      includeAttachments,
      includeSensitive: !!opts.sensitive,
      data
    };
  }

  return {
    state, subscribe, emit, init, reload, eraseAll, seedDefaults,
    defaultProfile, saveProfile, addSnapshot, removeSnapshot,
    saveMode, deleteMode, saveMetric, archiveMetric,
    saveTicketDraft, deleteTicket, duplicateTicketDraft,
    addAttachments, deleteAttachment, removeAttachmentsFor,
    saveAssessment, deleteAssessment, assessmentsOfKind, sessionsBetween,
    queryObservations, ticketsInRange, sortedTickets, compileTicketNotes,
    loadSampleData, exportBundle,
    ticketById, sessionById, observationById, assessmentById, modeById, metricById,
    sessionsOf, observationsOf, attachmentsOf, upsert,
    MODE_PALETTE
  };
})();
