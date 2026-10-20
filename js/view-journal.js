/* Cognitive Evolution Tracker — Journal (main dashboard).

   Chronological feed of daily tickets + search + filters + recent-activity summary.
   Each ticket is a card summarising its day; clicking opens the editable detail view. */
window.ViewJournal = (function () {
  'use strict';
  const { el, esc } = U;

  const filters = { search: '', range: 'all', from: '', to: '', modeId: '', ticketModeId: '' };

  const RANGES = [
    ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'],
    ['6m', 'Last 6 months'], ['1y', 'Last year'], ['all', 'All data'], ['custom', 'Custom…']
  ];

  function rangeToFrom(range, toISO) {
    const to = toISO || U.todayISO();
    switch (range) {
      case '7d': return U.addDays(to, -6);
      case '30d': return U.addDays(to, -29);
      case '90d': return U.addDays(to, -89);
      case '6m': { const d = U.parseISODate(to); d.setMonth(d.getMonth() - 6); return U.todayISO(d); }
      case '1y': { const d = U.parseISODate(to); d.setFullYear(d.getFullYear() - 1); return U.todayISO(d); }
      default: return null;
    }
  }

  function render(host) {
    host.innerHTML = '';
    const wrap = el('<div class="page journal"></div>');
    wrap.appendChild(summaryRow());
    wrap.appendChild(toolbar());
    const feed = el('<div class="ticket-feed"></div>');
    const list = filteredTickets();
    if (!Store.state.tickets.length) {
      feed.appendChild(emptyState());
    } else if (!list.length) {
      feed.appendChild(el('<div class="empty"><div class="empty-icon">' + Icons.svg('search') + '</div>' +
        '<h3>No tickets match the current filters</h3>' +
        '<p>Try clearing the search box or widening the date range.</p></div>'));
    } else {
      list.forEach((t) => feed.appendChild(ticketCard(t)));
    }
    wrap.appendChild(feed);
    host.appendChild(wrap);
    bind(host);
  }

  /* ---------- summary ---------- */

  function summaryRow() {
    const tickets = Store.state.tickets;
    const sessions = Store.state.sessions;
    const last = Store.sortedTickets(true)[0];
    const lastSess = last ? Store.sessionsOf(last.id).slice(-1)[0] : null;
    const lastMode = lastSess ? Store.modeById(lastSess.modeId) : null;
    // current streak of consecutive logged days ending at the most recent ticket
    let streak = 0;
    if (last) {
      const dates = new Set(tickets.map((t) => t.date));
      let cur = last.date;
      while (dates.has(cur)) { streak++; cur = U.addDays(cur, -1); }
    }
    const row = el('<div class="summary-row"></div>');
    row.appendChild(statCard('Days logged', tickets.length, tickets.length ? 'first entry ' + U.fmtDateShort(Store.sortedTickets()[0].date) : 'start your journal below'));
    row.appendChild(statCard('Training sessions', sessions.length, 'across ' + new Set(sessions.map((s) => s.modeId)).size + ' mode(s)'));
    row.appendChild(statCard('Current streak', streak ? streak + 'd' : '—', streak ? 'consecutive logged days' : 'no tickets yet'));
    row.appendChild(statCard('Latest session', lastMode ? lastMode.name.split('(')[0].trim() : '—',
      last ? U.fmtDateShort(last.date) + (lastSess && lastSess.startTime ? ' · ' + lastSess.startTime : '') : 'nothing recorded yet'));
    return row;

    function statCard(label, value, sub) {
      return el('<div class="stat-card"><div class="stat-label">' + esc(label) + '</div>' +
        '<div class="stat-value">' + esc(String(value)) + '</div>' +
        '<div class="stat-sub">' + esc(sub) + '</div></div>');
    }
  }

  /* ---------- toolbar (search + filters) ---------- */

  function toolbar() {
    const modes = Store.state.modes.filter((m) => !m.archived);
    const t = el('<div class="toolbar card">' +
      '<div class="tb-search"><input type="search" placeholder="Search notes, modes, metrics…" value="' + esc(filters.search) + '" data-f="search"></div>' +
      '<div class="tb-range">' + RANGES.map(([v, l]) =>
        '<button class="chip-btn' + (filters.range === v ? ' on' : '') + '" data-range="' + v + '">' + esc(l) + '</button>').join('') + '</div>' +
      (filters.range === 'custom'
        ? '<div class="tb-custom"><input type="date" data-f="from" value="' + esc(filters.from) + '"><span>→</span><input type="date" data-f="to" value="' + esc(filters.to) + '"></div>'
        : '') +
      '<div class="tb-filter"><select data-f="modeId"><option value="">All training modes</option>' +
      modes.map((m) => '<option value="' + esc(m.id) + '"' + (filters.modeId === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') +
      '</select></div>' +
      '<button class="btn primary tb-new" data-act="new">' + Icons.svg('plus') + ' New daily ticket</button>' +
      '</div>');
    return t;
  }

  function bind(host) {
    const search = host.querySelector('[data-f="search"]');
    if (search) {
      search.addEventListener('input', U.debounce(() => {
        filters.search = search.value.trim();
        refresh('search');
      }, 250));
    }
    host.querySelectorAll('[data-range]').forEach((b) => {
      b.addEventListener('click', () => {
        filters.range = b.dataset.range;
        if (filters.range === 'custom' && !filters.from) {
          filters.from = U.addDays(U.todayISO(), -89);
          filters.to = U.todayISO();
        }
        refresh();
      });
    });
    const from = host.querySelector('[data-f="from"]');
    if (from) from.addEventListener('change', () => { filters.from = from.value; refresh(); });
    const to = host.querySelector('[data-f="to"]');
    if (to) to.addEventListener('change', () => { filters.to = to.value; refresh(); });
    const modeSel = host.querySelector('[data-f="modeId"]');
    if (modeSel) modeSel.addEventListener('change', () => { filters.modeId = modeSel.value; refresh(); });
    const newBtn = host.querySelector('[data-act="new"]');
    if (newBtn) newBtn.addEventListener('click', () => Editor.open(null));
    host.querySelectorAll('[data-open]').forEach((c) => {
      c.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]')) return;
        Editor.open(c.dataset.open);
      });
    });
  }

  /** Re-render the journal into the main #view container, optionally restoring input focus. */
  function refresh(focusKey) {
    const active = document.activeElement;
    const pos = active && active.selectionStart != null ? active.selectionStart : null;
    const container = document.getElementById('view');
    if (!container) return;
    container.innerHTML = '';
    render(container);
    if (focusKey) {
      const sel = '[data-f="' + focusKey + '"]';
      const s = container.querySelector(sel);
      if (s) {
        s.focus();
        if (pos != null) { try { s.setSelectionRange(pos, pos); } catch (e) { /* non-text input */ } }
      }
    }
  }

  /* ---------- filtering ---------- */

  function filteredTickets() {
    const from = filters.range === 'custom' ? (filters.from || null) : rangeToFrom(filters.range);
    const to = filters.range === 'custom' ? (filters.to || null) : null;
    let list = Store.sortedTickets(true);
    if (from) list = list.filter((t) => t.date >= from);
    if (to) list = list.filter((t) => t.date <= to);
    if (filters.modeId) {
      list = list.filter((t) => Store.sessionsOf(t.id).some((s) => s.modeId === filters.modeId));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((t) => {
        const parts = [t.date, t.notes || '', (t.sleep || {}).notes || ''];
        Store.sessionsOf(t.id).forEach((s) => {
          parts.push(s.notes || '', (Store.modeById(s.modeId) || {}).name || '');
          Store.observationsOf(s.id).forEach((o) => {
            const m = Store.metricById(o.metricId);
            parts.push((m ? m.name : '') + ' ' + (o.value == null ? '' : o.value) + (m ? m.unit : ''), o.notes || '');
          });
        });
        return parts.join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  /* ---------- ticket card ---------- */

  function ticketCard(t) {
    const sessions = Store.sessionsOf(t.id);
    const sleep = t.sleep || {};
    const pa = t.pa || {};
    const chips = sessions.map((s) => {
      const mode = Store.modeById(s.modeId);
      return '<span class="chip">' + (mode ? '<i class="dot" style="background:' + esc(mode.color || '#888') + '"></i>' : '') +
        esc(mode ? mode.name : 'Unassigned') + (s.startTime ? ' <em>' + esc(s.startTime) + '</em>' : '') + '</span>';
    }).join('');
    // top metric highlights (first observation of each session that has one)
    const highlights = [];
    sessions.forEach((s) => {
      const obs = Store.observationsOf(s.id);
      if (!obs.length) return;
      const mode = Store.modeById(s.modeId);
      const o = obs[0];
      const m = Store.metricById(o.metricId);
      if (!m || o.value == null) return;
      highlights.push({ mode, m, o });
    });
    // ticket-level attachments no longer exist — files belong to their session
    const attCount = sessions.reduce((n, s) => n + Store.attachmentsOf('session', s.id).length, 0);

    const card = el('<article class="ticket card" data-open="' + esc(t.id) + '" tabindex="0">' +
      '<div class="ticket-side">' +
      '<div class="ticket-date"><span class="dow">' + esc(dayAbbr(t.date)) + '</span>' +
      '<span class="dnum">' + esc(dayNum(t.date)) + '</span>' +
      '<span class="mon">' + esc(monthAbbr(t.date)) + '</span></div>' +
      '</div>' +
      '<div class="ticket-main">' +
      '<div class="ticket-top"><h3>' + esc(U.fmtDate(t.date)) + '</h3>' +
      '<div class="ticket-actions" data-stop>' +
      '<button class="icon-btn" data-edit="' + esc(t.id) + '" title="Edit">' + Icons.svg('pencil') + '</button>' +
      '<button class="icon-btn" data-dup="' + esc(t.id) + '" title="Duplicate">' + Icons.svg('copy') + '</button>' +
      '<button class="icon-btn danger" data-del="' + esc(t.id) + '" title="Delete">' + Icons.svg('trash') + '</button>' +
      '</div></div>' +
      '<div class="ticket-chips">' +
      (sleep.durationMin != null ? '<span class="chip soft">' + Icons.svg('moon') + ' ' + esc(U.fmtDuration(sleep.durationMin)) + ' sleep</span>' : '') +
      (pa.dailyMinutes != null ? '<span class="chip soft">' + Icons.svg('activity') + ' ' + esc(pa.dailyMinutes) + ' min' + (pa.type ? ' · ' + esc(pa.type) : '') + '</span>' : '') +
      (chips || '<span class="chip soft">no sessions</span>') +
      (attCount ? '<span class="chip soft">' + Icons.svg('paperclip') + ' ' + attCount + '</span>' : '') +
      '</div>' +
      (highlights.length
        ? '<div class="ticket-highlights">' + highlights.slice(0, 4).map((h) =>
          '<span class="hl"><i class="dot" style="background:' + esc((h.mode && h.mode.color) || '#888') + '"></i>' +
          esc(h.m.name) + ' <strong>' + esc(String(h.o.value)) + '</strong>' + esc(h.m.unit ? ' ' + h.m.unit : '') + '</span>').join('') +
          (highlights.length > 4 ? '<span class="hl muted">+' + (highlights.length - 4) + ' more</span>' : '') + '</div>'
        : '') +
      (t.notes ? '<p class="ticket-notes">' + esc(truncate(t.notes, 150)) + '</p>' : '') +
      '</div>' +
      '</article>');

    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') Editor.open(t.id); });
    card.querySelector('[data-edit]').addEventListener('click', () => Editor.open(t.id));
    card.querySelector('[data-dup]').addEventListener('click', async () => {
      const nd = Store.duplicateTicketDraft(t.id);
      if (nd) Editor.open(nd);
    });
    card.querySelector('[data-del]').addEventListener('click', async () => {
      const obsCount = sessions.reduce((n, s) => n + Store.observationsOf(s.id).length, 0);
      const ok = await UI.confirm({
        title: 'Delete ' + U.fmtDateShort(t.date) + '?',
        messageHtml: 'This permanently removes:<br>• 1 daily ticket' +
          '<br>• ' + sessions.length + ' training session(s)' +
          '<br>• ' + obsCount + ' performance observation(s)' +
          '<br>• ' + attCount + ' attached file(s)' +
          '<br><br>Graphs and statistics will be recalculated without this day.',
        okLabel: 'Delete permanently'
      });
      if (!ok) return;
      await Store.deleteTicket(t.id);
      UI.toast('Ticket deleted.');
    });
    return card;
  }

  /* ---------- empty state ---------- */

  function emptyState() {
    const e = el('<div class="empty big">' +
      '<div class="empty-icon">🧠</div>' +
      '<h3>Your cognitive training journal starts here</h3>' +
      '<p>Record your first day: sleep, one or more training sessions, and the metrics that matter for each task. ' +
      'Everything you enter stays on this device and feeds automatically into the Progress graphs.</p>' +
      '<div class="empty-actions">' +
      '<button class="btn primary" data-act="new">' + Icons.svg('plus') + ' New daily ticket</button>' +
      '<button class="btn" data-act="sample">Load sample data (demo)</button>' +
      '</div></div>');
    e.querySelector('[data-act="new"]').addEventListener('click', () => Editor.open(null));
    e.querySelector('[data-act="sample"]').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Load sample data?',
        message: 'This adds ~6 weeks of realistic demo tickets, sessions, metrics and two assessments so you can explore the graphs. You can erase everything later from Data & Backup.',
        okLabel: 'Load sample data'
      });
      if (!ok) return;
      await Store.loadSampleData();
      UI.toast('Sample data loaded — explore the Progress tab.');
    });
    return e;
  }

  /* ---------- misc ---------- */

  function dayAbbr(iso) { const d = U.parseISODate(iso); return d ? d.toLocaleDateString(undefined, { weekday: 'short' }) : ''; }
  function dayNum(iso) { const d = U.parseISODate(iso); return d ? d.getDate() : ''; }
  function monthAbbr(iso) { const d = U.parseISODate(iso); return d ? d.toLocaleDateString(undefined, { month: 'short' }) : ''; }
  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  return { render, filters, rangeToFrom };
})();
