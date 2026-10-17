/* WM Assessment Platform — assessment session runner (spec §7, §12).

   State machine: overview → per block: instructions → familiarization → ready →
   scored trials → completion summary. No correctness feedback during scored trials.
   Timing is scheduled explicitly and measured: deviations beyond tolerance are recorded
   on the trial and session (browser timing is never presented as laboratory-grade).

   Task presentation lives here; task logic/answer keys live in wm-tasks.js (spec §13).
   Dev mode may show seeds + stimulus parameters during an assessment, but NEVER the
   answer key — keys are inspectable afterwards in Session History. */

window.WMRunner = (function () {
  'use strict';
  const { el, esc } = U;

  const TIMING_TOLERANCE_MS = 80;   // scheduled-vs-actual drift that counts as a deviation

  let S = null;        // active run state, null when no assessment is running
  let keyListener = null;

  function isActive() { return !!S; }

  /* ---------------- timers / waits ---------------- */

  function wait(ms, stage) {
    return new Promise((resolve) => {
      if (!S || S.closed) { resolve('closed'); return; }
      const t0 = performance.now();
      const id = setTimeout(() => {
        if (!S || S.closed) { resolve('closed'); return; }
        const actual = performance.now() - t0;
        if (Math.abs(actual - ms) > TIMING_TOLERANCE_MS) {
          S.session.timingDeviations = (S.session.timingDeviations || 0) + 1;
          if (S.trial) S.trial.timingFlags.push({ stage: stage || 'wait', intended: Math.round(ms), actual: Math.round(actual) });
        }
        resolve('ok');
      }, ms);
      S.timers.push(id);
    });
  }

  /** Deadline race: resolves null on timeout (deadlines are not schedule drift). */
  function deadline(promise, ms) {
    return new Promise((resolve) => {
      if (!S || S.closed) { resolve('closed'); return; }
      let done = false;
      const id = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
      S.timers.push(id);
      promise.then((v) => {
        if (done) return;
        if (S && S.closed) { done = true; resolve('closed'); return; }
        done = true; clearTimeout(id); resolve(v);
      });
    });
  }

  function clearTimers() {
    if (!S) return;
    S.timers.forEach((id) => clearTimeout(id));
    S.timers = [];
  }

  function abortIfClosed(v) { return !S || S.closed || v === 'closed'; }

  /* ---------------- stage scaffolding ---------------- */

  function buildStage(session) {
    const stage = el('<div class="wm-stage" role="dialog" aria-label="Assessment session">' +
      '<header class="wm-stage-bar">' +
      '<span class="wm-stage-title" data-title>Assessment</span>' +
      '<span class="wm-stage-progress" data-progress></span>' +
      '<span class="wm-stage-actions">' +
      '<button class="btn tiny" data-act="fullscreen" title="Toggle full screen">' + Icons.svg('maximize') + ' Full screen</button>' +
      '<button class="btn tiny" data-act="pause">' + Icons.svg('pause') + ' Pause</button>' +
      '</span></header>' +
      '<main class="wm-stage-body" data-body></main>' +
      '<footer class="wm-stage-foot" data-foot></footer>' +
      '</div>');
    if (WMStore.getSettings().reducedMotion) stage.classList.add('reduce-motion');
    document.body.appendChild(stage);
    stage.querySelector('[data-act="pause"]').addEventListener('click', () => pausePrompt());
    stage.querySelector('[data-act="fullscreen"]').addEventListener('click', () => {
      try {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
      } catch (e) { /* unsupported */ }
    });
    return stage;
  }

  function setTitle(text, progress) {
    if (!S) return;
    S.stage.querySelector('[data-title]').textContent = text;
    if (progress != null) S.stage.querySelector('[data-progress]').textContent = progress;
  }
  function setFoot(html) {
    if (!S) return;
    S.stage.querySelector('[data-foot]').innerHTML = html || '';
  }
  function body() { return S.stage.querySelector('[data-body]'); }
  function setBody(node) {
    const b = body();
    b.innerHTML = '';
    if (typeof node === 'string') b.innerHTML = node; else b.appendChild(node);
    b.scrollTop = 0;
    S.onKey = null;
    return b;
  }

  /** Awaiting user advance (click or Space/Enter) — resolves 'closed' if the stage goes away. */
  function awaitAdvance(sel) {
    return new Promise((resolve) => {
      if (!S || S.closed) { resolve('closed'); return; }
      const nodes = sel ? Array.from(body().querySelectorAll(sel)) : [];
      const done = () => { cleanup(); resolve('ok'); };
      const onKey = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
          e.preventDefault(); done();
        }
      };
      const onClosed = () => { cleanup(); resolve('closed'); };
      function cleanup() {
        nodes.forEach((n) => n.removeEventListener('click', done));
        if (S) {
          S.resolvers.delete(onClosed);
          if (S.onKey === onKey) S.onKey = null;
        }
      }
      nodes.forEach((n) => n.addEventListener('click', done));
      S.resolvers.add(onClosed);
      if (S) S.onKey = onKey;
    });
  }

  /* ---------------- lifecycle ---------------- */

  async function begin(session, opts) {
    if (S) return false;
    opts = opts || {};
    S = {
      session, closed: false, timers: [], resolvers: new Set(),
      blockIdx: 0, trial: null, onKey: null,
      paused: false, stage: buildStage(session)
    };
    keyListener = (e) => {
      if (!S) return;
      if (e.key === 'Escape') { e.preventDefault(); pausePrompt(); return; }
      if (S.onKey) S.onKey(e);
    };
    document.addEventListener('keydown', keyListener);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    if (!opts.skipStart) await overview();
    else { await runAllBlocks(); }
    return true;
  }

  function beforeUnload(e) {
    if (S && !S.closed) { e.preventDefault(); e.returnValue = ''; return ''; }
  }

  function onVisibility() {
    if (!S || S.closed) return;
    if (document.hidden) {
      const cur = S.trial;
      if (cur) cur.timingFlags.push({ stage: 'tab-hidden', intended: null, actual: null, at: new Date().toISOString() });
      S.session.interruptions.push({ at: new Date().toISOString(), reason: 'tab hidden during trial' });
      WMStore.updateSession(S.session);
    }
  }

  async function close(finalized) {
    if (!S) return;
    const s = S;
    S = null;
    clearTimers.call(null);
    s.closed = true;
    s.timers.forEach((id) => clearTimeout(id));
    s.resolvers.forEach((r) => r());
    s.resolvers.clear();
    if (keyListener) { document.removeEventListener('keydown', keyListener); keyListener = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', beforeUnload);
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
    s.stage.remove();
    void finalized;
    WMStore.emit();
  }

  /* ---------------- pause / interruption (spec §7) ---------------- */

  function pausePrompt() {
    if (!S || S.closed) return;
    const wasTrial = !!S.trial;
    const bodyEl = el('<div class="confirm-body">' +
      '<p><strong>Pause the assessment?</strong></p>' +
      '<p class="muted">Progress is saved after every trial. Resuming continues exactly where you stopped. ' +
      'Ending now keeps everything recorded so far and marks the session <em>incomplete</em> — it will not be counted as a completed assessment.</p></div>');
    const foot = el('<div class="confirm-actions">' +
      '<button class="btn" data-keep>Keep going</button>' +
      '<button class="btn" data-pause>Pause / resume later</button>' +
      '<button class="btn danger" data-end>End &amp; save as incomplete</button></div>');
    const m = UI.modal({ title: 'Assessment paused', body: bodyEl, footer: foot, dismissable: false });
    if (wasTrial) S.paused = true;
    foot.querySelector('[data-keep]').addEventListener('click', () => { m.close(); if (S) S.paused = false; });
    foot.querySelector('[data-pause]').addEventListener('click', async () => {
      m.close();
      if (!S) return;
      S.session.interruptions.push({ at: new Date().toISOString(), reason: 'participant paused' });
      await WMStore.updateSession(S.session);
      await close();
      UI.toast('Session paused and saved. Resume from the dashboard.');
      if (location.hash.indexOf('wm') !== 0) location.hash = '#wm';
    });
    foot.querySelector('[data-end]').addEventListener('click', async () => {
      m.close();
      if (!S) return;
      const sess = S.session;
      sess.interruptions.push({ at: new Date().toISOString(), reason: 'ended by participant before completion' });
      await WMStore.finalizeSession(sess, 'incomplete');
      await close();
      UI.toast('Session saved as incomplete.');
      location.hash = '#wm';
    });
  }

  /* ---------------- overview (spec §7 step 1) ---------------- */

  async function overview() {
    const s = S.session;
    const cfg = s.config;
    const blocks = WMStore.sessionBlocks(s.id);
    setTitle('Session ' + s.number + ' — overview', '');

    const rows = blocks.map((b) => {
      const fam = WMTasks.FAMILIES[b.family];
      const variant = (fam.variants.find((v) => v.id === b.variant) || {}).name || b.variant;
      const counts = {};
      (b.schedule || []).forEach((lv) => { counts[lv] = (counts[lv] || 0) + 1; });
      return '<tr><td><strong>' + esc(fam.short) + '</strong></td><td>' + esc(variant) + '</td>' +
        '<td>' + b.trialsPlanned + '</td>' +
        '<td class="n">' + WMBlueprint.LEVELS.map((l) => counts[l] ? esc(WMBlueprint.LEVEL_LABEL[l]) + ' ' + counts[l] : '').filter(Boolean).join(' · ') + '</td></tr>';
    }).join('');

    const t = cfg.timing;
    const changed = s.configChangesVsPrev || [];
    const wrap = el('<div class="wm-screen wm-overview">' +
      '<h2>Assessment session ' + s.number + '</h2>' +
      '<p class="wm-lede">This is a <strong>measurement</strong>, not training: no feedback is given during scored trials, ' +
      'difficulty follows a fixed blueprint, and every stimulus is freshly generated from a stored seed.</p>' +
      '<table class="wm-table"><thead><tr><th>Task family</th><th>Variant</th><th>Trials</th><th>Difficulty schedule</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="wm-facts">' +
      '<span><em>Blueprint</em>' + WMBlueprint.LEVELS.map((l) => esc(WMBlueprint.LEVEL_LABEL[l]) + ' ' + s.blueprintIntended[l] + '%').join(' · ') + '</span>' +
      '<span><em>Timing</em>stimulus ' + t.stimulusMs + 'ms · ISI ' + t.isiMs + 'ms · retention ' + t.retentionMs + 'ms · response ' + t.responseMs + 'ms · ITI ' + t.itiMs + 'ms</span>' +
      '<span><em>Seed</em>' + esc(s.seedHex) + ' · <em>Generator</em> ' + esc(s.generatorVersion) + ' · <em>Config</em> v' + s.configVersion + '</span>' +
      '<span><em>Planned</em> ' + s.trialsPlanned + ' scored trials across ' + s.blocksCount + ' blocks</span>' +
      '</div>' +
      (changed.length ? '<div class="caution"><strong>Configuration changed since the last session.</strong><br>' +
        changed.slice(0, 6).map((c) => esc(c.field) + ': ' + esc(String(c.from)) + ' → <strong>' + esc(String(c.to)) + '</strong>').join('<br>') +
        (changed.length > 6 ? '<br>… and ' + (changed.length - 6) + ' more (recorded in session metadata).' : '') +
        '<br>Scores from sessions with materially different configurations are never silently compared.' +
        '</div>' : '') +
      '<div class="caution">Browser timing is accurate to a few milliseconds of scheduling under ideal conditions, but devices, refresh rates, and background tabs introduce error. ' +
      'Deviations from the planned schedule are recorded per trial.</div>' +
      '<div class="wm-actions">' +
      '<button class="btn primary" data-begin>Begin session</button>' +
      '<button class="btn danger" data-cancel>Cancel (discard)</button>' +
      '</div></div>');
    setBody(wrap);
    setFoot('Nothing has been scored yet — cancelling now discards this session entirely.');

    const v = await new Promise((resolve) => {
      if (!S || S.closed) { resolve('closed'); return; }
      const done = (r) => { cleanup(); resolve(r); };
      const onClosed = () => done('closed');
      function cleanup() {
        if (S) {
          S.resolvers.delete(onClosed);
          S.onKey = null;
        }
      }
      S.resolvers.add(onClosed);
      wrap.querySelector('[data-begin]').addEventListener('click', () => done('begin'));
      wrap.querySelector('[data-cancel]').addEventListener('click', () => done('cancel'));
      S.onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); done('begin'); } };
    });
    if (abortIfClosed(v)) return;
    if (v === 'cancel') {
      await WMStore.deleteSession(S.session.id);
      await close();
      UI.toast('Session discarded — nothing was scored.');
      location.hash = '#wm';
      return;
    }
    await runAllBlocks();
  }

  /* ---------------- block flow ---------------- */

  async function runAllBlocks() {
    const s = S.session;
    const blocks = WMStore.sessionBlocks(s.id);
    for (let i = 0; i < blocks.length; i++) {
      if (!S || S.closed) return;
      S.blockIdx = i;
      const block = blocks[i];
      const remaining = WMStore.blockTrials(block.id).filter((t) => t.phase === 'scored' && !t.completedAt);
      if (!remaining.length) { await markBlock(block, 'completed'); continue; }

      await instructionsScreen(block);
      if (!S || S.closed) return;

      const famDone = WMStore.familiarized(block.family, block.variant);
      if (!famDone) {
        await familiarization(block);
        if (!S || S.closed) return;
      }

      await readyScreen(block);
      if (!S || S.closed) return;

      await scoredBlock(block);
      if (!S || S.closed) return;
      await markBlock(block, 'completed');
    }
    if (!S || S.closed) return;
    await finish();
  }

  async function markBlock(block, status) {
    block.status = status;
    block.completedAt = new Date().toISOString();
    await WMStore.updateBlock(block);
  }

  async function instructionsScreen(block) {
    const cfg = S.session.config;
    const fam = WMTasks.FAMILIES[block.family];
    const copy = WMTasks.instructions(block.family, block.variant, cfg);
    const variant = (fam.variants.find((v) => v.id === block.variant) || {});
    setTitle('Session ' + S.session.number + ' — instructions', 'Block ' + (S.blockIdx + 1) + ' of ' + S.session.blocksCount);
    const wrap = el('<div class="wm-screen">' +
      '<div class="wm-kicker">' + esc(fam.name) + '</div>' +
      '<h2>' + esc(copy.title) + '</h2>' +
      '<p class="wm-lede">' + esc(copy.rule) + '</p>' +
      (variant.response ? '<p class="muted">Response: ' + esc(variant.response) + '.</p>' : '') +
      '<div class="caution">' + esc(copy.noFeedback) + '</div>' +
      '<div class="wm-actions"><button class="btn primary" data-next>Continue</button></div>' +
      '</div>');
    setBody(wrap);
    setFoot('Instructions stay the same for every trial in this block — rules never change inside a scored block.');
    const v = await awaitAdvance('[data-next]');
    void v;
  }

  async function readyScreen(block) {
    const fam = WMTasks.FAMILIES[block.family];
    setTitle('Session ' + S.session.number + ' — ready', 'Block ' + (S.blockIdx + 1) + ' of ' + S.session.blocksCount);
    const wrap = el('<div class="wm-screen wm-ready">' +
      '<div class="wm-kicker">Ready check</div>' +
      '<h2>' + esc(fam.short) + ' — ' + block.trialsPlanned + ' scored trials</h2>' +
      '<p class="wm-lede">Sit comfortably, focus on the centre of the screen, and respond as accurately as you can. ' +
      'You will not be told whether responses are correct.</p>' +
      '<div class="wm-actions"><button class="btn primary" data-start>I\'m ready — start</button></div>' +
      '</div>');
    setBody(wrap);
    setFoot('Take a breath. The first trial begins immediately after you start.');
    const v = await awaitAdvance('[data-start]');
    if (abortIfClosed(v)) return;
    block.startedAt = new Date().toISOString();
    block.status = 'active';
    await WMStore.updateBlock(block);
    S.blockStart = performance.now();
  }

  /* ---------------- familiarization (spec §6/§7 step 3) ---------------- */

  async function familiarization(block) {
    const cfg = S.session.config;
    const n = Math.max(1, cfg.familiarizationTrials || 2);
    setTitle('Session ' + S.session.number + ' — practice', 'Not scored');

    // Intro
    const intro = el('<div class="wm-screen">' +
      '<div class="wm-kicker">Familiarization — excluded from all scores</div>' +
      '<h2>Practice: ' + esc(WMTasks.FAMILIES[block.family].short) + '</h2>' +
      '<p class="wm-lede">Try ' + n + ' practice ' + (n === 1 ? 'trial' : 'trials') +
      ' first. <strong>Feedback is shown during practice only</strong>, so you can learn the rule. ' +
      'These trials are stored but never counted in results.</p>' +
      '<div class="wm-actions"><button class="btn primary" data-next>Start practice</button></div></div>');
    setBody(intro);
    let v = await awaitAdvance('[data-next]');
    if (abortIfClosed(v)) return;

    // Generate practice trials (fresh seed stream, never part of the scored schedule).
    const famTrials = makeFamTrials(block, n);
    if (!famTrials.length) { await WMStore.markFamiliarized(block.family, block.variant); return; }

    for (const t of famTrials) {
      if (!S || S.closed) return;
      hydrateFamTrial(t, block);
      S.trial = t;
      const presented = await presentTrial(block, t, { familiarization: true });
      if (abortIfClosed(presented)) return;
      // Score + persist practice trials (phase='familiarization' keeps them out of all results).
      WMStore.scoreTrial(t, presented.response, presented.rtMs);
      await WMStore.saveTrial(t);
      S.trial = null;
      const ok = t.correct === true;
      const fb = el('<div class="wm-screen wm-feedback ' + (ok ? 'ok' : 'no') + '">' +
        '<div class="wm-fb-icon">' + (ok ? '✓' : '✗') + '</div>' +
        '<h2>' + (ok ? 'Correct' : 'Not quite') + '</h2>' +
        (ok ? '' : '<p class="wm-lede">Correct response: <strong>' + esc(describeKey(t)) + '</strong></p>') +
        '<div class="wm-actions"><button class="btn primary" data-next>Next practice trial</button></div></div>');
      setBody(fb);
      setFoot('Practice only — never included in scored results.');
      const fv = await awaitAdvance('[data-next]');
      if (abortIfClosed(fv)) return;
    }
    await WMStore.markFamiliarized(block.family, block.variant);
    UI.toast('Familiarization recorded for ' + WMTasks.FAMILIES[block.family].short + '.');
  }

  function describeKey(t) {
    const k = t.key || {};
    if (t.family === 'C') return k.isTarget ? 'MATCH' : 'NO MATCH';
    if (t.kind === 'processing') return k.expected === 'true' ? 'TRUE' : 'FALSE';
    if (t.variant === 'recognition') return String(k.expected || '').toUpperCase();
    if (Array.isArray(k.expected)) return k.expected.join(' · ');
    return String(k.expected == null ? '' : k.expected);
  }

  function makeFamTrials(block, n) {
    const cfg = S.session.config;
    const rng = WMRng.make(S.session.seed).derive('fam-' + block.family + '-' + block.variant + '-' + S.session.id);
    const ctx = WMTasks.freshCtx({ signatures: WMStore.seenSignatures() });
    ctx.grid = { rows: 5, cols: 6 };
    let schedule;
    if (block.family === 'C') {
      const p = WMBlueprint.FAMILY_LEVELS.C.moderate;
      schedule = new Array(Math.max(n, p.load + 5)).fill('moderate');
    } else {
      schedule = new Array(n).fill('moderate');
    }
    return WMTasks.generateBlock(block.family, block.variant, schedule, rng, cfg, ctx);
  }

  function hydrateFamTrial(t, block) {
    t.id = U.uid();
    t.sessionId = S.session.id;
    t.blockId = block.id;
    t.participantId = S.session.participantId;
    t.trialIndex = -1000 - Math.floor(Math.random() * 1000);
    t.phase = 'familiarization';
    t.seed = block.seed;
    t.generatorVersion = WMRng.VERSION;
    t.configVersion = S.session.configVersion;
    t.signature = t.signature || (t.stimulus && t.stimulus.sequence
      ? WMTasks.signature(t.family, t.variant, t.stimulus.sequence) : null);
    t.userResponse = null; t.correct = null; t.rtMs = null;
    t.omission = false; t.errorClass = null; t.scoreMetrics = null;
    t.timingFlags = []; t.completedAt = null;
    t.createdAt = new Date().toISOString();
    return t;
  }

  /* ---------------- scored block (spec §7 steps 5–9) ---------------- */

  async function scoredBlock(block) {
    const trials = WMStore.blockTrials(block.id).filter((t) => t.phase === 'scored');
    const total = trials.length;
    let prevStream = null;
    for (let i = 0; i < trials.length; i++) {
      if (!S || S.closed) return;
      const t = trials[i];
      S.trial = t;

      if (t.completedAt) { S.trial = null; continue; }   // resume: skip what was already answered

      // stream intro for family C (rule + load shown before each stream, spec §3)
      if (t.family === 'C') {
        if (t.streamId !== prevStream) {
          prevStream = t.streamId;
          const iv = await streamIntro(t, i + 1, total);
          if (abortIfClosed(iv)) return;
        }
      } else {
        setTitle('Session ' + S.session.number + ' — ' + WMTasks.FAMILIES[block.family].short,
          'Trial ' + (i + 1) + ' of ' + total);
      }

      const presented = await presentTrial(block, t, {});
      if (abortIfClosed(presented)) return;

      // Persist the trial — scoring only, no feedback (spec §7 step 8).
      await recordScored(t, presented.response, presented.rtMs);
      S.trial = null;
    }
    setTitle('Session ' + S.session.number + ' — ' + WMTasks.FAMILIES[block.family].short, 'Block complete');
  }

  async function streamIntro(t, idx, total) {
    const n = t.memoryLoad;
    const rule = t.variant === 'nback'
      ? 'Respond MATCH when the current item is the same as the item shown <strong>' + n + ' step' + (n === 1 ? '' : 's') + ' earlier</strong>.'
      : 'Respond MATCH when the current item appears <strong>anywhere among the last ' + n + ' items</strong>.';
    const wrap = el('<div class="wm-screen wm-stream-intro">' +
      '<div class="wm-kicker">New stream — load ' + n + '</div>' +
      '<h2>' + (t.variant === 'nback' ? n + '-back' : 'Recent-set (' + n + ')') + ' stream</h2>' +
      '<p class="wm-lede">' + rule + ' Otherwise respond NO MATCH.</p>' +
      '<p class="muted">Stream position ' + idx + '–' + Math.min(total, idx + (t.stimulus.streamLength - t.stimulus.streamIndex) - 1) + ' of ' + total + ' total trials in this block.</p>' +
      '<div class="wm-actions"><button class="btn primary" data-next>Start stream</button></div></div>');
    setBody(wrap);
    setFoot('Respond on every step — 1 = match, 2 = no match.');
    const v = await awaitAdvance('[data-next]');
    if (abortIfClosed(v)) return v;
    setTitle('Session ' + S.session.number + ' — updating', '');
    return v;
  }

  async function recordScored(t, response, rtMs) {
    WMStore.scoreTrial(t, response, rtMs);
    // A self-paced response that overruns the planned window is never cut off — the true RT
    // stays in the data — but the overrun is recorded as a schedule deviation so timing
    // problems are visible in the session record instead of silently absorbed.
    const planned = S.session.config.timing.responseMs;
    if (rtMs != null && rtMs > planned + TIMING_TOLERANCE_MS) {
      t.timingFlags = t.timingFlags || [];
      t.timingFlags.push({
        stage: 'response-overrun', intended: planned, actual: Math.round(rtMs),
        at: new Date().toISOString()
      });
      S.session.timingDeviations = (S.session.timingDeviations || 0) + 1;
    }
    await WMStore.saveTrial(t);
    S.session.trialsCompleted = WMStore.sessionTrials(S.session.id)
      .filter((x) => x.phase === 'scored' && x.completedAt).length;
    S.session.cursor = { blockIdx: S.blockIdx, trialId: t.id };
    await WMStore.updateSession(S.session);
  }

  /* ---------------- completion (spec §7 steps 10–12) ---------------- */

  async function finish() {
    const s = S.session;
    setTitle('Session ' + s.number + ' — complete', '');
    await WMStore.finalizeSession(s, 'completed');
    const res = s.results;
    const famRows = Object.keys(res.families).map((f) => {
      const r = res.families[f];
      const sd = r.signalDetection ? ' · d′ ' + r.signalDetection.dprime : '';
      return '<tr><td><strong>' + esc(WMTasks.FAMILIES[f].short) + '</strong></td>' +
        '<td class="v">' + (r.accuracyPct == null ? '—' : r.accuracyPct + '%') + '</td>' +
        '<td class="n">' + r.trialsCompleted + ' trials · median RT ' + (r.medianRtMs == null ? '—' : r.medianRtMs + ' ms') + sd + '</td>' +
        (r.ci95 ? '<td class="n">95% CI ' + Math.round(r.ci95[0] * 1000) / 10 + '–' + Math.round(r.ci95[1] * 1000) / 10 + '%</td>' : '<td class="n"></td>') +
        '</tr>';
    }).join('');

    const wrap = el('<div class="wm-screen wm-finish">' +
      '<div class="wm-kicker">Session ' + s.number + ' finished</div>' +
      '<h2>Assessment complete</h2>' +
      '<p class="wm-lede">' + s.trialsCompleted + ' scored trials recorded. Below are <strong>task-specific</strong> results — ' +
      'there is no single “working-memory score”, and higher numbers here document performance on these tasks, not a change in latent capacity.</p>' +
      '<table class="wm-table"><tbody>' + famRows + '</tbody></table>' +
      (res.provisionalComposite != null && WMStore.getSettings().provisionalComposite
        ? '<div class="caution">Provisional exploratory composite: ' + res.provisionalComposite + '% — ' + esc(res.compositeNote || '') + '</div>' : '') +
      '<div class="wm-facts">' +
      '<span><em>Blueprint (realized)</em>' + WMBlueprint.LEVELS.map((l) => esc(WMBlueprint.LEVEL_LABEL[l]) + ' ' + ((s.blueprintRealized && s.blueprintRealized.counts[l]) || 0)).join(' · ') + '</span>' +
      '<span><em>Seed</em>' + esc(s.seedHex) + ' · <em>Config</em> v' + s.configVersion + '</span>' +
      '<span><em>Timing deviations</em> ' + (s.timingDeviations || 0) + (s.interruptions.length ? ' · <em>Interruptions</em> ' + s.interruptions.length : '') + '</span>' +
      '</div>' +
      '<div class="wm-actions">' +
      '<button class="btn primary" data-analytics>View analytics</button>' +
      '<button class="btn" data-dash>Back to dashboard</button>' +
      '</div></div>');
    setBody(wrap);
    setFoot('Results were saved the moment each trial finished — this session survives a page reload.');
    S.onKey = null;

    await new Promise((resolve) => {
      const b = body();
      b.querySelector('[data-analytics]').addEventListener('click', () => { location.hash = '#wm/analytics'; resolve('ok'); });
      b.querySelector('[data-dash]').addEventListener('click', () => { location.hash = '#wm'; resolve('ok'); });
      S.resolvers.add(() => resolve('closed'));
    });
    await close(true);
  }

  /* ---------------- trial presentation ---------------- */

  /* Returns { response, rtMs } (or 'closed'). Response shapes:
       A: {cells:[…]}   B recall: {items:[…]}   B recognition: {value:'old'|'new'}
       C: {value:'match'|'nomatch'}   D processing: {value:'true'|'false'}   D recall: {items:[…]} */
  async function presentTrial(block, t, opts) {
    opts = opts || {};
    if (t.family === 'A') return presentA(t, opts);
    if (t.family === 'B') return presentB(t, opts);
    if (t.family === 'C') return presentC(t, opts);
    if (t.family === 'D') return presentD(t, opts);
    return { response: null, rtMs: null };
  }

  /* ---- helpers ---- */

  function gridEl(rows, cols, opts) {
    opts = opts || {};
    const g = el('<div class="wm-grid" style="--wm-rows:' + rows + ';--wm-cols:' + cols + '"></div>');
    for (let i = 0; i < rows * cols; i++) {
      const cell = el('<button type="button" class="wm-cell" data-cell="' + i + '" tabindex="-1" aria-label="Location ' + (i + 1) + '"></button>');
      if (opts.marked && opts.marked.indexOf(i) < 0) cell.classList.add('dim');
      g.appendChild(cell);
    }
    return g;
  }

  function keypadEl(set, opts) {
    opts = opts || {};
    const k = el('<div class="wm-keypad' + (set.length > 12 ? ' dense' : '') + '" role="group" aria-label="Response keypad"></div>');
    set.forEach((item) => {
      k.appendChild(el('<button type="button" class="wm-key" data-key="' + esc(item) + '">' + esc(item) + '</button>'));
    });
    void opts;
    return k;
  }

  function answerBar(load, label) {
    return el('<div class="wm-answerbar">' +
      '<span class="wm-answer-label">' + esc(label || 'Your answer') + '</span>' +
      '<span class="wm-answer-slots" data-slots>' +
      Array.from({ length: load }).map(() => '<span class="wm-slot"></span>').join('') +
      '</span>' +
      '<span class="wm-answer-actions">' +
      '<button class="btn tiny" data-undo>Undo</button>' +
      '<button class="btn tiny" data-clear>Clear</button>' +
      '<button class="btn tiny primary" data-submit disabled>Submit</button>' +
      '</span></div>');
  }

  function renderSlots(host, arr, load) {
    const slots = host.querySelector('[data-slots]');
    if (!slots) return;
    slots.innerHTML = '';
    for (let i = 0; i < load; i++) {
      slots.appendChild(el('<span class="wm-slot' + (arr[i] != null ? ' filled' : '') + '">' + esc(arr[i] == null ? '' : arr[i]) + '</span>'));
    }
    const sub = host.querySelector('[data-submit]');
    if (sub) sub.disabled = arr.length === 0;
  }

  function devBadge(t) {
    if (!WMStore.getSettings().devMode) return '';
    // Dev info during a scored assessment: seed + parameters only — never the answer key.
    return '<div class="wm-devbar">DEV · seed ' + esc(WMRng.seedToHex(t.seed)) +
      ' · ' + esc(t.difficulty) + ' · load ' + esc(String(t.memoryLoad)) +
      ' · ' + esc(t.itemSource) + ' · unit ' + esc(t.unitId || '—') +
      ' <span class="muted">(answer keys are viewable in Session History after the session)</span></div>';
  }

  /* ---- Task A: visuospatial ---- */

  async function presentA(t, opts) {
    const st = t.stimulus;
    const seq = st.sequence;
    const cfg = S.session.config.timing;
    const retention = Math.round(cfg.retentionMs * (t.params.retentionMult || 1));
    setTitle('Session ' + S.session.number + ' — visuospatial',
      opts.familiarization ? 'Practice (not scored)' : progressLabel(t));

    // 1. attention cue
    const scr = el('<div class="wm-screen wm-trial">' + devBadge(t) +
      '<div class="wm-kicker">' + (t.variant === 'reverse' ? 'Watch the sequence — you will recall it in reverse' :
        t.variant === 'identify' ? 'Watch the sequence — you will select the locations you saw' : 'Watch the sequence — recall it in order') + '</div>' +
      '<div class="wm-grid-host" data-gridhost></div></div>');
    setBody(scr);
    setFoot('Memorise the highlighted locations.');

    const grid = gridEl(st.rows, st.cols, t.variant === 'identify' ? { marked: st.probeSet } : {});
    scr.querySelector('[data-gridhost]').appendChild(grid);
    const cells = Array.from(grid.querySelectorAll('.wm-cell'));

    let r = await wait(cfg.isiMs, 'isi');
    if (abortIfClosed(r)) return 'closed';

    for (const c of seq) {
      cells[c].classList.add('lit');
      r = await wait(cfg.stimulusMs, 'stimulus');
      cells[c].classList.remove('lit');
      if (abortIfClosed(r)) return 'closed';
      r = await wait(cfg.isiMs, 'isi');
      if (abortIfClosed(r)) return 'closed';
    }

    // 2. retention (blank)
    cells.forEach((c) => c.classList.add('gone'));
    r = await wait(retention, 'retention');
    if (abortIfClosed(r)) return 'closed';

    // 3. response
    const t0 = performance.now();
    if (t.variant === 'identify') {
      cells.forEach((c) => c.classList.remove('gone'));
      const answer = [];
      const bar = answerBar(st.load, 'Selected locations');
      const wrap2 = el('<div class="wm-screen wm-trial">' + devBadge(t) +
        '<div class="wm-kicker">Select every location you saw, then Submit</div>' +
        '<div class="wm-grid-host" data-gridhost></div></div>');
      wrap2.appendChild(bar);
      setBody(wrap2);
      const grid2 = gridEl(st.rows, st.cols, { marked: st.probeSet });
      wrap2.querySelector('[data-gridhost]').appendChild(grid2);
      renderSlots(bar, answer, st.load);
      const clickable = st.probeSet.map((c) => grid2.querySelector('[data-cell="' + c + '"]'));
      clickable.forEach((cell) => cell.addEventListener('click', () => {
        const idx = Number(cell.dataset.cell);
        const at = answer.indexOf(idx);
        if (at >= 0) { answer.splice(at, 1); cell.classList.remove('sel'); }
        else { answer.push(idx); cell.classList.add('sel'); }
        renderSlots(bar, answer, st.load);
        bar.querySelector('[data-slots]').innerHTML = answer.map((c) => '<span class="wm-slot filled">' + (c + 1) + '</span>').join('');
        bar.querySelector('[data-submit]').disabled = answer.length === 0;
      }));
      bar.querySelector('[data-clear]').addEventListener('click', () => {
        answer.length = 0;
        grid2.querySelectorAll('.wm-cell.sel').forEach((c) => c.classList.remove('sel'));
        renderSlots(bar, answer, st.load);
      });
      bar.querySelector('[data-undo]').addEventListener('click', () => {
        const last = answer.pop();
        if (last != null) { const c = grid2.querySelector('[data-cell="' + last + '"]'); if (c) c.classList.remove('sel'); }
        renderSlots(bar, answer, st.load);
      });
      const res = await new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; if (S) { S.resolvers.delete(onClosed); S.onKey = null; } resolve(v); };
        const onClosed = () => finish('closed');
        S.resolvers.add(onClosed);
        bar.querySelector('[data-submit]').addEventListener('click', () => finish({ response: { cells: answer.slice() }, rtMs: performance.now() - t0 }));
        S.onKey = (e) => {
          if (e.key === 'Enter' && answer.length) { e.preventDefault(); finish({ response: { cells: answer.slice() }, rtMs: performance.now() - t0 }); }
        };
      });
      if (res === 'closed') return 'closed';
      await feedbacklessDelay(opts);
      return res;
    }

    // reproduce / reverse: click cells in order
    const answer = [];
    const bar = answerBar(st.load, t.variant === 'reverse' ? 'Reverse order (last first)' : 'Your order');
    const wrap2 = el('<div class="wm-screen wm-trial">' + devBadge(t) +
      '<div class="wm-kicker">' + (t.variant === 'reverse' ? 'Click the locations in REVERSE order' : 'Click the locations in the same order') + '</div>' +
      '<div class="wm-grid-host" data-gridhost></div></div>');
    wrap2.appendChild(bar);
    setBody(wrap2);
    const grid2 = gridEl(st.rows, st.cols, {});
    wrap2.querySelector('[data-gridhost]').appendChild(grid2);
    renderSlots(bar, answer, st.load);
    const update = () => {
      const slots = bar.querySelector('[data-slots]');
      slots.innerHTML = '';
      for (let i = 0; i < st.load; i++) slots.appendChild(el('<span class="wm-slot' + (answer[i] != null ? ' filled' : '') + '">' + (answer[i] != null ? answer[i] + 1 : '') + '</span>'));
      bar.querySelector('[data-submit]').disabled = answer.length === 0;
      grid2.querySelectorAll('.wm-cell').forEach((c) => {
        c.classList.toggle('picked', answer.indexOf(Number(c.dataset.cell)) >= 0);
      });
    };
    grid2.querySelectorAll('.wm-cell').forEach((cell) => cell.addEventListener('click', () => {
      const idx = Number(cell.dataset.cell);
      const at = answer.indexOf(idx);
      if (at >= 0) answer.splice(at, 1); else answer.push(idx);
      update();
    }));
    bar.querySelector('[data-clear]').addEventListener('click', () => { answer.length = 0; update(); });
    bar.querySelector('[data-undo]').addEventListener('click', () => { answer.pop(); update(); });
    const res = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (S) { S.resolvers.delete(onClosed); S.onKey = null; } resolve(v); };
      const onClosed = () => finish('closed');
      S.resolvers.add(onClosed);
      bar.querySelector('[data-submit]').addEventListener('click', () => finish({ response: { cells: answer.slice() }, rtMs: performance.now() - t0 }));
      S.onKey = (e) => {
        if (e.key === 'Enter' && answer.length) { e.preventDefault(); finish({ response: { cells: answer.slice() }, rtMs: performance.now() - t0 }); }
        if (e.key === 'Backspace') { e.preventDefault(); answer.pop(); update(); }
      };
    });
    if (res === 'closed') return 'closed';
    await feedbacklessDelay(opts);
    return res;
  }

  /* ---- Task B: verbal / auditory ---- */

  async function presentB(t, opts) {
    const st = t.stimulus;
    const cfg = S.session.config.timing;
    const modality = st.modality || 'visual';
    const retention = Math.round(cfg.retentionMs * (t.params.retentionMult || 1));
    setTitle('Session ' + S.session.number + ' — verbal',
      opts.familiarization ? 'Practice (not scored)' : progressLabel(t));

    const scr = el('<div class="wm-screen wm-trial">' + devBadge(t) +
      '<div class="wm-kicker">' + (modality === 'auditory' ? 'Listen — items are spoken aloud' : 'Memorise the sequence') + '</div>' +
      '<div class="wm-stage-center" data-center><div class="wm-item" data-item></div></div></div>');
    setBody(scr);
    setFoot(modality === 'auditory' ? 'Volume up — items are spoken.' : 'Items appear one at a time.');

    const itemHost = scr.querySelector('[data-item]');
    let r = await wait(cfg.isiMs, 'isi');
    if (abortIfClosed(r)) return 'closed';

    for (const item of st.sequence) {
      if (modality === 'auditory') {
        const spoken = speak(item);
        itemHost.classList.add('audible');
        itemHost.innerHTML = Icons.svg('volume');
        r = await Promise.all([spoken, wait(Math.max(cfg.stimulusMs, 500), 'stimulus')]);
      } else {
        itemHost.textContent = item;
        itemHost.classList.add('show');
        r = await wait(cfg.stimulusMs, 'stimulus');
        itemHost.classList.remove('show');
      }
      if (abortIfClosed(r)) return 'closed';
      r = await wait(cfg.isiMs, 'isi');
      if (abortIfClosed(r)) return 'closed';
    }
    itemHost.textContent = '';
    itemHost.classList.remove('show', 'audible');

    r = await wait(retention, 'retention');
    if (abortIfClosed(r)) return 'closed';

    const t0 = performance.now();

    if (t.variant === 'recognition') {
      const wrap2 = el('<div class="wm-screen wm-trial">' + devBadge(t) +
        '<div class="wm-kicker">Was this probe in the sequence?</div>' +
        '<div class="wm-stage-center"><div class="wm-item show big">' + esc(st.probe) + '</div></div>' +
        '<div class="wm-choice">' +
        '<button class="wm-choice-btn" data-old><kbd>1</kbd> OLD — was in sequence</button>' +
        '<button class="wm-choice-btn" data-new><kbd>2</kbd> NEW — not in sequence</button>' +
        '</div></div>');
      setBody(wrap2);
      setFoot('No feedback is given during scored trials.');
      const res = await choice({ old: wrap2.querySelector('[data-old]'), new: wrap2.querySelector('[data-new]') },
        (v) => ({ response: { value: v }, rtMs: performance.now() - t0 }),
        { '1': 'old', '2': 'new' });
      if (res === 'closed') return 'closed';
      await feedbacklessDelay(opts);
      return res;
    }

    // sequence entry (forward / backward / positions)
    const set = WMTasks.ITEM_SETS[(S.session.config.itemSet && S.session.config.itemSet.B) || 'letters'] || WMTasks.LETTERS;
    const answer = [];
    const label = t.variant === 'backward' ? 'Reverse order (last first)'
      : t.variant === 'positions' ? 'Positions ' + (t.positions || st.positions || []).map((p) => p + 1).join(' & ') + ' only, in order'
        : 'Your sequence';
    const bar = answerBar(st.load, label);
    const prompt = t.variant === 'positions'
      ? '<div class="wm-kicker">Enter only the items at ' + (st.positions || []).map((p) => 'position ' + (p + 1)).join(' and ') + ', in ascending order</div>'
      : '<div class="wm-kicker">Enter the sequence — then Submit</div>';
    const wrap2 = el('<div class="wm-screen wm-trial">' + devBadge(t) + prompt +
      '<div class="wm-stage-center" data-center><div class="wm-item show big" data-probe></div></div>' +
      '</div>');
    wrap2.appendChild(bar);
    wrap2.appendChild(keypadEl(set));
    setBody(wrap2);
    setFoot('Click keys or type on your keyboard. Enter submits, Backspace undoes.');
    renderSlots(bar, answer, (t.variant === 'positions' ? (st.positions || []).length : st.load));

    const loadSlots = t.variant === 'positions' ? (st.positions || []).length : st.load;
    const kp = wrap2.querySelector('.wm-keypad');
    const update = () => renderSlots(bar, answer, loadSlots);
    kp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (!b) return;
      if (answer.length < loadSlots) { answer.push(b.dataset.key); update(); }
    });
    bar.querySelector('[data-undo]').addEventListener('click', () => { answer.pop(); update(); });
    bar.querySelector('[data-clear]').addEventListener('click', () => { answer.length = 0; update(); });

    const res = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (S) { S.resolvers.delete(onClosed); S.onKey = null; } resolve(v); };
      const onClosed = () => finish('closed');
      S.resolvers.add(onClosed);
      bar.querySelector('[data-submit]').addEventListener('click', () => finish({ response: { items: answer.slice() }, rtMs: performance.now() - t0 }));
      S.onKey = (e) => {
        if (e.key === 'Enter' && answer.length) { e.preventDefault(); finish({ response: { items: answer.slice() }, rtMs: performance.now() - t0 }); return; }
        if (e.key === 'Backspace') { e.preventDefault(); answer.pop(); update(); return; }
        if (e.key.length === 1) {
          const up = e.key.toUpperCase();
          if (set.indexOf(up) >= 0 && answer.length < loadSlots) { answer.push(up); update(); }
        }
      };
    });
    if (res === 'closed') return 'closed';
    await feedbacklessDelay(opts);
    return res;
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        // Auditory presentation unavailable → fall back visually and flag it.
        if (S && S.trial) S.trial.timingFlags.push({ stage: 'auditory-fallback', intended: 'auditory', actual: 'visual', at: new Date().toISOString() });
        resolve('ok');
        return;
      }
      try {
        const u = new SpeechSynthesisUtterance(text.split('').join(' '));
        u.rate = 0.9; u.lang = 'en-US';
        u.onend = () => resolve('ok');
        u.onerror = () => resolve('ok');
        speechSynthesis.speak(u);
        const id = setTimeout(() => resolve('ok'), 2500);
        if (S) S.timers.push(id);
      } catch (e) { resolve('ok'); }
    });
  }

  /* ---- Task C: updating stream ---- */

  async function presentC(t, opts) {
    const cfg = S.session.config.timing;
    const st = t.stimulus;
    setTitle('Session ' + S.session.number + ' — updating',
      opts.familiarization ? 'Practice (not scored)' : 'Step ' + (st.streamIndex + 1) + ' of ' + st.streamLength);

    const scr = el('<div class="wm-screen wm-trial wm-stream">' + devBadge(t) +
      '<div class="wm-kicker">' + (t.variant === 'nback' ? t.memoryLoad + '-back' : 'Last ' + t.memoryLoad) +
      ' · step ' + (st.streamIndex + 1) + '/' + st.streamLength + '</div>' +
      '<div class="wm-stage-center" data-center><div class="wm-item" data-item></div></div>' +
      '<div class="wm-choice">' +
      '<button class="wm-choice-btn" data-match><kbd>1</kbd> MATCH</button>' +
      '<button class="wm-choice-btn" data-nomatch><kbd>2</kbd> NO MATCH</button>' +
      '</div></div>');
    setBody(scr);
    setFoot('Respond on every step — your response is recorded without feedback.');

    const itemHost = scr.querySelector('[data-item]');
    const t0 = performance.now();
    const window_ = cfg.stimulusMs + cfg.isiMs;

    const resP = choice({ match: scr.querySelector('[data-match]'), nomatch: scr.querySelector('[data-nomatch]') },
      (v) => ({ response: { value: v }, rtMs: performance.now() - t0 }),
      { '1': 'match', '2': 'nomatch' }, true);

    // show the item for its stimulus window, then blank for the ISI; response closes early
    itemHost.textContent = st.item;
    itemHost.classList.add('show');
    const lit = await wait(cfg.stimulusMs, 'stimulus');
    itemHost.classList.remove('show');
    if (abortIfClosed(lit)) return 'closed';

    const res = await deadline(resP, window_ - cfg.stimulusMs);
    if (res === 'closed') return 'closed';
    if (res === null) {
      // deadline passed with no response → timeout (recorded as omission)
      return { response: null, rtMs: null, timeout: true };
    }
    // absorb remaining ISI so the stream keeps a steady cadence
    return res;
  }

  /* ---- Task D: complex span ---- */

  async function presentD(t, opts) {
    const cfg = S.session.config.timing;
    setTitle('Session ' + S.session.number + ' — complex span',
      opts.familiarization ? 'Practice (not scored)' : progressLabel(t));

    if (t.kind === 'processing') {
      // phase 1: storage item
      const scr = el('<div class="wm-screen wm-trial">' + devBadge(t) +
        '<div class="wm-kicker">Remember this letter</div>' +
        '<div class="wm-stage-center"><div class="wm-item show" data-letter></div></div></div>');
      setBody(scr);
      setFoot('Keep the letters in order — a problem follows each one.');
      scr.querySelector('[data-letter]').textContent = t.stimulus.letter;
      let r = await wait(cfg.stimulusMs, 'stimulus');
      if (abortIfClosed(r)) return 'closed';
      r = await wait(cfg.isiMs, 'isi');
      if (abortIfClosed(r)) return 'closed';

      // phase 2: processing probe with response window
      const p = t.stimulus.problem;
      const scr2 = el('<div class="wm-screen wm-trial">' + devBadge(t) +
        '<div class="wm-kicker">True or false?</div>' +
        '<div class="wm-stage-center"><div class="wm-problem">' +
        esc(p.a + ' ' + p.op + ' ' + p.b + ' = ' + p.c) + '</div></div>' +
        '<div class="wm-choice">' +
        '<button class="wm-choice-btn" data-true><kbd>1</kbd> TRUE</button>' +
        '<button class="wm-choice-btn" data-false><kbd>2</kbd> FALSE</button>' +
        '</div></div>');
      setBody(scr2);
      setFoot('Answer within the response window.');
      const t0 = performance.now();
      const res = await deadline(
        choice({ true: scr2.querySelector('[data-true]'), false: scr2.querySelector('[data-false]') },
          (v) => ({ response: { value: v }, rtMs: performance.now() - t0 }),
          { '1': 'true', '2': 'false' }),
        cfg.responseMs);
      if (res === 'closed') return 'closed';
      if (res === null) return { response: null, rtMs: null, timeout: true };
      await feedbacklessDelay(opts);
      return res;
    }

    // final recall of the list
    const letters = t.stimulus.letters;
    const answer = [];
    const bar = answerBar(letters.length, 'Letters in order');
    const scr = el('<div class="wm-screen wm-trial">' + devBadge(t) +
      '<div class="wm-kicker">Recall ALL letters from this list, in order</div></div>');
    scr.appendChild(bar);
    scr.appendChild(keypadEl(WMTasks.LETTERS));
    setBody(scr);
    setFoot('Type or click letters. Enter submits.');
    renderSlots(bar, answer, letters.length);
    const t0 = performance.now();
    const kp = scr.querySelector('.wm-keypad');
    const update = () => renderSlots(bar, answer, letters.length);
    kp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (!b) return;
      if (answer.length < letters.length) { answer.push(b.dataset.key); update(); }
    });
    bar.querySelector('[data-undo]').addEventListener('click', () => { answer.pop(); update(); });
    bar.querySelector('[data-clear]').addEventListener('click', () => { answer.length = 0; update(); });
    const res = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (S) { S.resolvers.delete(onClosed); S.onKey = null; } resolve(v); };
      const onClosed = () => finish('closed');
      S.resolvers.add(onClosed);
      bar.querySelector('[data-submit]').addEventListener('click', () => finish({ response: { items: answer.slice() }, rtMs: performance.now() - t0 }));
      S.onKey = (e) => {
        if (e.key === 'Enter' && answer.length) { e.preventDefault(); finish({ response: { items: answer.slice() }, rtMs: performance.now() - t0 }); return; }
        if (e.key === 'Backspace') { e.preventDefault(); answer.pop(); update(); return; }
        if (e.key.length === 1) {
          const up = e.key.toUpperCase();
          if (WMTasks.LETTERS.indexOf(up) >= 0 && answer.length < letters.length) { answer.push(up); update(); }
        }
      };
    });
    if (res === 'closed') return 'closed';
    await feedbacklessDelay(opts);
    return res;
  }

  /* Shared two-alternative choice binding. `keyMap` maps keyboard keys → values. */
  function choice(buttons, makeResult, keyMap, allowEarly) {
    return new Promise((resolve) => {
      if (!S || S.closed) { resolve('closed'); return; }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        Object.keys(buttons).forEach((k) => { if (buttons[k]) { buttons[k].disabled = true; buttons[k].classList.add('chosen'); } });
        if (S) {
          S.resolvers.delete(onClosed);
          if (S.onKey === onKey) S.onKey = null;
        }
        resolve(v);
      };
      const onClosed = () => finish('closed');
      S.resolvers.add(onClosed);
      Object.keys(buttons).forEach((k) => {
        const b = buttons[k];
        if (!b) return;
        b.addEventListener('click', () => finish(makeResult(k)));
      });
      const onKey = (e) => {
        const v = keyMap[e.key];
        if (v) { e.preventDefault(); finish(makeResult(v)); }
        if (allowEarly && (e.key === ' ')) e.preventDefault();
      };
      S.onKey = onKey;
      void allowEarly;
    });
  }

  /** ITI pause after a scored response; during familiarization, nothing (feedback screen follows). */
  async function feedbacklessDelay(opts) {
    if (opts && opts.familiarization) return;
    const r = await wait(S.session.config.timing.itiMs, 'iti');
    void r;
  }

  function progressLabel(t) {
    const trials = WMStore.blockTrials(t.blockId).filter((x) => x.phase === 'scored');
    const idx = trials.findIndex((x) => x.id === t.id);
    return 'Trial ' + (idx + 1) + ' of ' + trials.length;
  }

  /* ---------------- public API ---------------- */

  /** Start a brand-new session (creates the record first — cancel discards it). */
  async function startNew() {
    if (S) { UI.toast('A session is already running.', 'error'); return; }
    if (WMStore.inProgress()) {
      const go = await UI.confirm({
        title: 'Unfinished session found',
        message: 'You have a session that was started but not completed. Start a new one? The unfinished session stays saved as resumable.',
        okLabel: 'Start new session', cancelLabel: 'Close'
      });
      if (!go) return;
    }
    const session = await WMStore.createSession();
    if (!session.blocksCount) {
      await WMStore.deleteSession(session.id);
      UI.toast('No task families are enabled in the configuration.', 'error');
      return;
    }
    location.hash = '#wm/session';
    await begin(session);
  }

  /** Resume an in-progress session at its saved cursor. */
  async function resume() {
    if (S) return;
    const session = WMStore.inProgress();
    if (!session) { UI.toast('No session to resume.'); return; }
    await WMStore.recordInterruption(session, 'resumed after interruption');
    location.hash = '#wm/session';
    await begin(session, { skipStart: false });
  }

  return { startNew, resume, isActive, close };
})();
