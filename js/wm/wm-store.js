/* WM Assessment Platform — data model + persistence (spec §11).

   Entities:
     wmParticipants? — single local participant (meta key) — no accounts, local-only.
     wmConfigVersions — frozen configuration snapshots (version numbers).
     wmSessions       — one row per assessment session (seed, status, blueprint, results).
     wmBlocks         — one row per task block within a session (family, variant, order).
     wmTrials         — trial-level records incl. generated items and answer keys.

   Settings (dev mode, composite toggle, reliability estimates) live under the 'meta' store.
   Everything is device-local; nothing is uploaded (spec §11). */

window.WMStore = (function () {
  'use strict';
  const { uid, nowISO } = U;

  const state = {
    sessions: [], blocks: [], trials: [], configVersions: [],
    settings: null, participant: null,
    ready: false, storageMode: 'idb'
  };

  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach((f) => { try { f(); } catch (e) { console.error('[WM] listener error', e); } }); }

  /* ---------------- settings & participant ---------------- */

  const DEFAULT_SETTINGS = {
    devMode: false,                 // inspect seeds/keys — never during scored presentation
    provisionalComposite: false,    // exploratory composite display (off by default, spec §8)
    reducedMotion: false,
    reliability: {},                // family → test–retest r supplied by the user (optional)
    familiarization: {},            // 'family:variant' → ISO date completed (spec §6)
    includeFamiliarizationInExport: false
  };

  function defaultParticipant() {
    return { id: uid(), label: 'Local participant', createdAt: nowISO(), localOnly: true, syncedToServer: false };
  }

  async function loadSettings() {
    let s = await DB.getMeta('wmSettings');
    if (!s) { s = Object.assign({}, DEFAULT_SETTINGS); await DB.setMeta('wmSettings', s); }
    state.settings = Object.assign({}, DEFAULT_SETTINGS, s);
    let p = await DB.getMeta('wmParticipant');
    if (!p) { p = defaultParticipant(); await DB.setMeta('wmParticipant', p); }
    state.participant = p;
  }

  async function saveSettings(patch) {
    Object.assign(state.settings, patch);
    await DB.setMeta('wmSettings', state.settings);
    emit();
    return state.settings;
  }

  /* ---------------- configuration versions ---------------- */

  async function loadConfigVersions() {
    const list = await DB.all('wmConfigVersions');
    state.configVersions = list.sort((a, b) => (a.version || 0) - (b.version || 0));
    if (!state.configVersions.length) {
      const v = {
        id: uid(), version: 1, createdAt: nowISO(),
        note: 'Shipped default configuration.',
        config: JSON.parse(JSON.stringify(WMTasks.DEFAULT_CONFIG))
      };
      await DB.put('wmConfigVersions', v);
      state.configVersions = [v];
    }
  }

  function currentConfig() {
    const v = state.configVersions[state.configVersions.length - 1];
    return JSON.parse(JSON.stringify(v.config));
  }
  function currentConfigVersion() {
    return state.configVersions[state.configVersions.length - 1].version;
  }

  /** Human-readable diff between two configs — powers change warnings (spec §6, §9). */
  function diffConfigs(a, b) {
    const changes = [];
    const flat = (obj, prefix, out) => {
      Object.keys(obj || {}).forEach((k) => {
        const key = prefix ? prefix + '.' + k : k;
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
        else out[key] = v;
      });
      return out;
    };
    const fa = flat(a, '', {}), fb = flat(b, '', {});
    const keys = new Set(Object.keys(fa).concat(Object.keys(fb)));
    keys.forEach((k) => {
      const va = JSON.stringify(fa[k]), vb = JSON.stringify(fb[k]);
      if (va !== vb) changes.push({ field: k, from: fa[k], to: fb[k] });
    });
    return changes;
  }

  /** Save a new config version (only when something actually changed). */
  async function saveConfig(config, note) {
    const prev = currentConfig();
    const changes = diffConfigs(prev, config);
    if (!changes.length) return { version: currentConfigVersion(), changed: false, changes: [] };
    const v = {
      id: uid(), version: currentConfigVersion() + 1, createdAt: nowISO(),
      note: note || ('Changed: ' + changes.map((c) => c.field).join(', ')),
      config: JSON.parse(JSON.stringify(config)),
      changes: changes.map((c) => ({ field: c.field, from: c.from, to: c.to }))
    };
    await DB.put('wmConfigVersions', v);
    state.configVersions.push(v);
    emit();
    return { version: v.version, changed: true, changes };
  }

  /* ---------------- init / reload ---------------- */

  async function init() {
    state.storageMode = DB.storageMode;
    await reload();
    state.ready = true;
    emit();
  }

  async function reload() {
    const [sessions, blocks, trials, configs] = await Promise.all([
      DB.all('wmSessions'), DB.all('wmBlocks'), DB.all('wmTrials'), DB.all('wmConfigVersions')
    ]);
    state.sessions = sessions;
    state.blocks = blocks;
    state.trials = trials;
    state.configVersions = configs.sort((a, b) => (a.version || 0) - (b.version || 0));
    await loadSettings();
    if (!state.configVersions.length) await loadConfigVersions();
  }

  /* ---------------- queries ---------------- */

  function sortedSessions(includeIncomplete) {
    return state.sessions
      .filter((s) => includeIncomplete || s.status === 'completed')
      .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  }
  function completedSessions() { return sortedSessions(false); }
  function sessionById(id) { return state.sessions.find((s) => s.id === id) || null; }
  function sessionBlocks(id) { return state.blocks.filter((b) => b.sessionId === id).sort((a, b) => a.order - b.order); }
  function sessionTrials(id) { return state.trials.filter((t) => t.sessionId === id); }
  function blockTrials(blockId) {
    return state.trials.filter((t) => t.blockId === blockId)
      .sort((a, b) => (a.trialIndex || 0) - (b.trialIndex || 0));
  }
  function inProgress() { return state.sessions.find((s) => s.status === 'in_progress') || null; }

  /** Signatures of every sequence this participant has already seen (duplicate prevention). */
  function seenSignatures() {
    const set = new Set();
    state.trials.forEach((t) => { if (t.signature) set.add(t.signature); });
    return set;
  }

  /* ---------------- session lifecycle ---------------- */

  /* Build (and persist) a new session with its blocks + fully generated trial plan.
     The form is generated once from the stored seed — audit/reconstruction is possible
     at any time without re-running the generator (spec §4). */
  async function createSession(opts) {
    opts = opts || {};
    const cfg = currentConfig();
    const cfgVersion = currentConfigVersion();
    const seed = WMRng.newSeed();
    const rng = WMRng.make(seed);
    const prev = sortedSessions(true)[0] || null;
    const changesVsPrev = prev ? diffConfigs(prev.config, cfg) : [];

    const session = {
      id: uid(),
      participantId: state.participant.id,
      number: state.sessions.length + 1,
      status: 'in_progress',
      seed, seedHex: WMRng.seedToHex(seed),
      generatorVersion: WMRng.VERSION,
      configVersion: cfgVersion,
      config: cfg,
      configChangesVsPrev: changesVsPrev,
      startedAt: nowISO(), completedAt: null,
      date: U.todayISO(),
      blueprintIntended: WMBlueprint.normalize(cfg.blueprint),
      blueprintRealized: null,
      interruptions: [], timingDeviations: 0,
      blocksCount: 0, trialsPlanned: 0, trialsCompleted: 0,
      results: null, notes: '',
      createdAt: nowISO(), updatedAt: nowISO()
    };

    // ---- difficulty schedule per family (deterministic from session seed)
    const signatures = seenSignatures();
    const ctx = WMTasks.freshCtx({ signatures });
    if (cfg.grid) ctx.grid = cfg.grid;
    else ctx.grid = { rows: 5, cols: 6 };   // calibrated default spatial grid

    const blocks = [];
    const trials = [];
    let order = 0;
    ['A', 'B', 'C', 'D'].forEach((family) => {
      if (!cfg.families[family]) return;
      const variant = cfg.variants[family];
      const n = Math.max(1, cfg.trialsPerTask[family] || 1);
      const familyRng = rng.derive('block-' + family);
      const schedule = WMBlueprint.schedule(n, cfg.blueprint, familyRng.derive('schedule'));
      const blockSeed = familyRng.seed;
      const genRng = familyRng.derive('generate');
      const generated = WMTasks.generateBlock(family, variant, schedule, genRng, cfg, ctx);

      const blockId = uid();
      const block = {
        id: blockId, sessionId: session.id, order: order++,
        family, variant,
        seed: blockSeed, seedHex: WMRng.seedToHex(blockSeed),
        trialsPlanned: n, trialsGenerated: generated.length,
        schedule, grid: family === 'A' ? ctx.grid : null,
        status: 'pending', startedAt: null, completedAt: null
      };
      blocks.push(block);

      generated.forEach((tr, i) => {
        trials.push(Object.assign(tr, {
          id: uid(), sessionId: session.id, blockId, participantId: session.participantId,
          trialIndex: i, phase: 'scored',
          seed: blockSeed, generatorVersion: WMRng.VERSION,
          configVersion: cfgVersion,
          signature: tr.signature || null,
          // answer + response fields (null until collected)
          correctResponse: tr.key ? JSON.parse(JSON.stringify(tr.key.expected)) : null,
          userResponse: null, correct: null, rtMs: null,
          omission: false, errorClass: null, scoreMetrics: null,
          timingFlags: [], completedAt: null,
          createdAt: nowISO()
        }));
      });
    });

    // Backfill signatures of generated sequences so a later session never repeats them.
    trials.forEach((t) => {
      if (!t.signature && t.stimulus && t.stimulus.sequence) {
        t.signature = WMTasks.signature(t.family, t.variant, t.stimulus.sequence);
      }
    });

    session.blocksCount = blocks.length;
    session.trialsPlanned = trials.length;

    await DB.put('wmSessions', session);
    if (blocks.length) await DB.putMany('wmBlocks', blocks);
    if (trials.length) await DB.putMany('wmTrials', trials);
    state.sessions.push(session);
    blocks.forEach((b) => state.blocks.push(b));
    trials.forEach((t) => state.trials.push(t));
    emit();
    return session;
  }

  async function saveTrial(trial) {
    trial.updatedAt = nowISO();
    await DB.put('wmTrials', trial);
    const i = state.trials.findIndex((t) => t.id === trial.id);
    if (i >= 0) state.trials[i] = trial; else state.trials.push(trial);
    return trial;
  }

  async function updateSession(session) {
    session.updatedAt = nowISO();
    await DB.put('wmSessions', session);
    const i = state.sessions.findIndex((s) => s.id === session.id);
    if (i >= 0) state.sessions[i] = session; else state.sessions.push(session);
    return session;
  }

  async function updateBlock(block) {
    await DB.put('wmBlocks', block);
    const i = state.blocks.findIndex((b) => b.id === block.id);
    if (i >= 0) state.blocks[i] = block; else state.blocks.push(block);
    return block;
  }

  /** Finalise a session: score it, mark status, persist. Never fabricates results —
     incomplete sessions are scored over the trials that exist and stay flagged. */
  async function finalizeSession(session, status) {
    const trials = sessionTrials(session.id);
    session.status = status || 'completed';
    session.completedAt = nowISO();
    session.blueprintRealized = WMBlueprint.realized(trials.filter((t) => t.phase === 'scored' && t.completedAt));
    session.results = WMScoring.scoreSession(session, trials);
    session.trialsCompleted = trials.filter((t) => t.completedAt && t.phase === 'scored').length;
    await updateSession(session);
    emit();
    return session;
  }

  /** Record an interruption (spec §7): reason + timestamp, kept on the session. */
  async function recordInterruption(session, reason) {
    session.interruptions = session.interruptions || [];
    session.interruptions.push({ at: nowISO(), reason: reason || 'interrupted' });
    await updateSession(session);
    emit();
  }

  async function deleteSession(id) {
    for (const t of state.trials.filter((x) => x.sessionId === id)) await DB.del('wmTrials', t.id);
    for (const b of state.blocks.filter((x) => x.sessionId === id)) await DB.del('wmBlocks', b.id);
    await DB.del('wmSessions', id);
    state.trials = state.trials.filter((t) => t.sessionId !== id);
    state.blocks = state.blocks.filter((b) => b.sessionId !== id);
    state.sessions = state.sessions.filter((s) => s.id !== id);
    emit();
  }

  /** Delete all WM assessment data — the participant's right to erase (spec §11). */
  async function deleteAllData() {
    await DB.clear('wmSessions');
    await DB.clear('wmBlocks');
    await DB.clear('wmTrials');
    await DB.clear('wmConfigVersions');
    state.sessions = []; state.blocks = []; state.trials = []; state.configVersions = [];
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    state.participant = defaultParticipant();
    await DB.setMeta('wmSettings', state.settings);
    await DB.setMeta('wmParticipant', state.participant);
    await loadConfigVersions();
    emit();
  }

  /* ---------------- familiarization bookkeeping ---------------- */

  function familiarized(family, variant) {
    return !!(state.settings.familiarization || {})[family + ':' + variant];
  }
  async function markFamiliarized(family, variant) {
    const f = Object.assign({}, state.settings.familiarization);
    f[family + ':' + variant] = nowISO();
    return saveSettings({ familiarization: f });
  }
  async function resetFamiliarization() { return saveSettings({ familiarization: {} }); }

  /* ---------------- trial scoring (used by the runner) ---------------- */

  /* Applies WMTasks.score, stamps RT/omission/timing fields, persists. Returns result. */
  function scoreTrial(trial, response, rtMs) {
    const out = WMTasks.score(trial.family, trial.variant, trial, response);
    trial.userResponse = response == null ? null : JSON.parse(JSON.stringify(response));
    trial.rtMs = rtMs == null ? null : Math.round(rtMs);
    trial.correct = out.correct;
    trial.errorClass = out.errorClass;
    trial.scoreMetrics = out.metrics || {};
    trial.omission = !!(out.metrics && out.metrics.omissions) || response == null;
    trial.completedAt = nowISO();
    return out;
  }

  return {
    state, subscribe, emit, init, reload,
    getSettings: () => state.settings,
    saveSettings, loadSettings,
    currentConfig, currentConfigVersion, diffConfigs, saveConfig,
    configVersions: () => state.configVersions,
    sortedSessions, completedSessions, sessionById, sessionBlocks, sessionTrials, blockTrials, inProgress,
    seenSignatures,
    createSession, saveTrial, updateSession, updateBlock, finalizeSession, recordInterruption,
    deleteSession, deleteAllData,
    familiarized, markFamiliarized, resetFamiliarization,
    scoreTrial
  };
})();
