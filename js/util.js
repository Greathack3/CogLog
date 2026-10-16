/* Cognitive Evolution Tracker — utility helpers (no dependencies) */
window.U = (function () {
  'use strict';

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function nowISO() { return new Date().toISOString(); }

  function parseISODate(s) {
    if (!s) return null;
    const p = String(s).slice(0, 10).split('-').map(Number);
    if (p.length < 3 || p.some(isNaN)) return null;
    const d = new Date(p[0], p[1] - 1, p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Accepts 'YYYY-MM-DD' or a full ISO timestamp, returns ms or NaN. */
  function toMs(s) {
    if (!s) return NaN;
    if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = parseISODate(s);
      return d ? d.getTime() : NaN;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? NaN : d.getTime();
  }

  function fmtDate(s) {
    const d = parseISODate(s);
    if (!d) return '—';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateShort(s) {
    const d = parseISODate(s);
    if (!d) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function addDays(iso, n) {
    const d = parseISODate(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return todayISO(d);
  }

  function daysBetween(isoA, isoB) {
    const a = toMs(isoA), b = toMs(isoB);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  /** 'HH:MM' -> minutes since midnight (or null). */
  function hhmmToMin(v) {
    if (!v || typeof v !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  function minToHHMM(min) {
    if (min == null || isNaN(min)) return '';
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /** Sleep duration in minutes from bed/wake times, handling midnight crossing. Returns null if inputs invalid. */
  function computeSleepMinutes(bed, wake) {
    const b = hhmmToMin(bed), w = hhmmToMin(wake);
    if (b == null || w == null) return null;
    let dur = w - b;
    if (dur <= 0) dur += 1440; // crossed midnight
    return dur;
  }

  /** Minutes between two HH:MM values, handling midnight crossing. */
  function minutesBetween(start, end) {
    const a = hhmmToMin(start), b = hhmmToMin(end);
    if (a == null || b == null) return null;
    let d = b - a;
    if (d <= 0) d += 1440;
    return d;
  }

  function fmtDuration(min) {
    if (min == null || isNaN(min) || min === '') return '—';
    const m = Math.round(min);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + 'h ' + r + 'm' : h + 'h';
  }

  function fmtHours(min) {
    if (min == null || isNaN(min)) return '—';
    return (Math.round((min / 60) * 100) / 100).toFixed(2).replace(/\.?0+$/, '') + ' h';
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toNum(v) {
    if (v === '' || v == null) return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function fmtNum(v, dp) {
    if (v == null || isNaN(v)) return '—';
    if (dp == null) dp = Math.abs(v) >= 100 ? 1 : 2;
    return String(Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp));
  }

  function fmtTimeOfDay(min) {
    if (min == null || isNaN(min)) return '—';
    return minToHHMM(min);
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  /* ---------- statistics (descriptive only) ---------- */

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function stdev(arr) {
    if (arr.length < 2) return null;
    const m = mean(arr);
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  }

  /** Ordinary least squares over [{x, y}] (x in ms or numeric). Returns {slope, intercept} or null. */
  function ols(pts) {
    if (!pts || pts.length < 2) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let num = 0, den = 0;
    for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) * (p.x - mx); }
    if (den === 0) return null;
    const slope = num / den;
    return { slope, intercept: my - slope * mx };
  }

  /* ---------- axis helpers ---------- */

  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  function niceTicks(min, max, count) {
    count = count || 5;
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
    if (min === max) { min -= 1; max += 1; }
    const range = niceNum(max - min, false);
    const step = niceNum(range / (count - 1), true);
    const nmin = Math.floor(min / step) * step;
    const nmax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = nmin; v <= nmax + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { min: nmin, max: nmax, ticks, step };
  }

  /** Time-axis ticks for a [minMs, maxMs] span. */
  function timeTicks(minMs, maxMs) {
    const span = maxMs - minMs;
    const DAY = 86400000;
    const ticks = [];
    if (span <= 0) return { ticks: [{ ms: minMs, label: fmtDateShort(new Date(minMs).toISOString().slice(0, 10)) }], fmt: 'd' };
    let stepDays;
    if (span <= 2 * DAY) stepDays = 0.5;
    else if (span <= 10 * DAY) stepDays = 2;
    else if (span <= 31 * DAY) stepDays = 7;
    else if (span <= 100 * DAY) stepDays = 14;
    else if (span <= 400 * DAY) stepDays = 30;
    else stepDays = 60;
    const stepMs = stepDays * DAY;
    const first = Math.ceil(minMs / stepMs) * stepMs;
    for (let t = first; t <= maxMs; t += stepMs) {
      const d = new Date(t);
      const iso = todayISO(d);
      ticks.push({
        ms: t,
        label: span <= 3 * DAY
          ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
          : (stepDays >= 30
            ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
            : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
      });
    }
    if (!ticks.length) ticks.push({ ms: minMs, label: fmtDateShort(new Date(minMs).toISOString().slice(0, 10)) });
    return { ticks };
  }

  /* ---------- CSV ---------- */

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of rows) lines.push(r.map(csvEscape).join(','));
    return lines.join('\r\n');
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* ---------- files ---------- */

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

  /** Downscale + re-encode an image to a JPEG data URL to keep storage small. */
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1400;
    quality = quality == null ? 0.82 : quality;
    return readAsDataURL(file).then((dataUrl) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        try { res(c.toDataURL('image/jpeg', quality)); }
        catch (e) { rej(e); }
      };
      img.onerror = () => rej(new Error('Could not decode image'));
      img.src = dataUrl;
    }));
  }

  function fileSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  return {
    uid, pad2, todayISO, nowISO, parseISODate, toMs, fmtDate, fmtDateShort, fmtDateTime,
    addDays, daysBetween, hhmmToMin, minToHHMM, computeSleepMinutes, minutesBetween,
    fmtDuration, fmtHours, fmtTimeOfDay, esc, toNum, clamp, fmtNum, el, qs, qsa, debounce,
    mean, median, stdev, ols, niceTicks, timeTicks, csvEscape, toCSV, download,
    readAsDataURL, compressImage, fileSize
  };
})();
