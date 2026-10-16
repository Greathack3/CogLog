/* Cognitive Evolution Tracker — appearance customization.

   Curated theme presets (light & dark) plus accent-colour overrides, applied as CSS
   custom properties on <html> via data attributes. A localStorage mirror is written on
   every change so a tiny inline script in index.html can apply the look before first
   paint (no flash of the wrong theme); the IndexedDB meta record is the source of truth
   once the storage layer is ready. Appearance is cosmetic only — it never rides along
   in data backups and is never touched by data erasure. */

window.Theme = (function () {
  'use strict';
  const { el, esc } = U;

  const LS_KEY = 'cet-appearance';

  /* Theme presets — the CSS carries the actual palettes under [data-theme="…"];
     this registry powers the picker (names, descriptions, preview gradients). */
  const THEMES = [
    { id: 'lumen', name: 'Lumen', desc: 'Bright indigo — the classic journal look', mode: 'light', sig: '#4f6ef7', preview: 'linear-gradient(135deg, #eef1fb 0%, #dfe6fb 55%, #e9edff 100%)' },
    { id: 'sepia', name: 'Sepia', desc: 'Warm paper & roasted amber', mode: 'light', sig: '#a1682e', preview: 'linear-gradient(135deg, #f7f1e5 0%, #efe3cc 55%, #f6ead6 100%)' },
    { id: 'forest', name: 'Forest', desc: 'Sage daylight with deep pine', mode: 'light', sig: '#2f7d4f', preview: 'linear-gradient(135deg, #eef4ec 0%, #dcead9 55%, #e6f1e4 100%)' },
    { id: 'blush', name: 'Blush', desc: 'Soft rose light', mode: 'light', sig: '#c2456a', preview: 'linear-gradient(135deg, #faf1f2 0%, #f3e2e6 55%, #fbeef3 100%)' },
    { id: 'midnight', name: 'Midnight', desc: 'Deep navy with calm blue glow', mode: 'dark', sig: '#6e8bff', preview: 'linear-gradient(135deg, #0c1020 0%, #141c36 55%, #101830 100%)' },
    { id: 'graphite', name: 'Graphite', desc: 'Neutral slate & warm amber', mode: 'dark', sig: '#e5a94e', preview: 'linear-gradient(135deg, #141619 0%, #22262d 55%, #1a1d22 100%)' },
    { id: 'aurora', name: 'Aurora', desc: 'Twilight violet with teal glow', mode: 'dark', sig: '#3ecfb2', preview: 'linear-gradient(135deg, #120f22 0%, #201a3c 55%, #131a30 100%)' }
  ];

  /* Accent overrides — 'auto' is the theme's signature accent; explicit colours have
     light/dark pairs because the soft-tint and ink roles flip meaning between modes
     (dark ink on a pale tint vs pale ink on a dark tint). */
  const ACCENTS = [
    { id: 'auto', name: 'Theme default', dot: 'linear-gradient(135deg, #4f6ef7, #26a69a)' },
    { id: 'indigo', name: 'Indigo', dot: '#4f6ef7' },
    { id: 'ocean', name: 'Ocean', dot: '#2f8fdd' },
    { id: 'teal', name: 'Teal', dot: '#14b8a6' },
    { id: 'emerald', name: 'Emerald', dot: '#22a97a' },
    { id: 'amber', name: 'Amber', dot: '#e0a445' },
    { id: 'rose', name: 'Rose', dot: '#e05a80' },
    { id: 'violet', name: 'Violet', dot: '#8b5cf6' },
    { id: 'crimson', name: 'Crimson', dot: '#e04b58' }
  ];

  let state = { theme: 'lumen', accent: 'auto' };

  /* ---------------- application ---------------- */

  function readMirror() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const a = JSON.parse(raw);
      if (!a || typeof a !== 'object') return null;
      return {
        theme: THEMES.some((t) => t.id === a.theme) ? a.theme : 'lumen',
        accent: ACCENTS.some((x) => x.id === a.accent) ? a.accent : 'auto'
      };
    } catch (e) { return null; }
  }

  function applyNow() {
    const root = document.documentElement;
    const def = THEMES.find((t) => t.id === state.theme) || THEMES[0];
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-mode', def.mode);
    root.setAttribute('data-accent', ACCENTS.some((x) => x.id === state.accent) ? state.accent : 'auto');
    // meta color-scheme keeps form controls & scrollbars in tone
    const ms = document.querySelector('meta[name="color-scheme"]');
    if (ms) ms.setAttribute('content', def.mode === 'dark' ? 'dark light' : 'light');
  }

  async function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
    try { if (window.DB && DB.setMeta) await DB.setMeta('appearance', state); } catch (e) { /* storage unavailable */ }
  }

  async function set(patch) {
    state = Object.assign({}, state, patch || {});
    applyNow();
    await persist();
    return state;
  }

  /** Called from boot once storage is ready — the DB record wins over the mirror. */
  async function init() {
    const mirror = readMirror();
    if (mirror) state = mirror;
    try {
      const saved = await DB.getMeta('appearance');
      if (saved && (THEMES.some((t) => t.id === saved.theme) || ACCENTS.some((a) => a.id === saved.accent))) {
        state = {
          theme: THEMES.some((t) => t.id === saved.theme) ? saved.theme : 'lumen',
          accent: ACCENTS.some((a) => a.id === saved.accent) ? saved.accent : 'auto'
        };
      } else {
        await persist();   // self-heal the meta record from the mirror
      }
    } catch (e) { /* keep mirror state */ }
    applyNow();
    return state;
  }

  /* ---------------- picker modal ---------------- */

  function open() {
    const draft = { theme: state.theme, accent: state.accent };
    const root = el('<div class="appearance"></div>');

    const themeGrid = el('<div class="theme-grid"></div>');
    THEMES.forEach((t) => {
      const card = el('<button type="button" class="theme-card' + (draft.theme === t.id ? ' on' : '') + '" data-theme-id="' + esc(t.id) + '">' +
        '<span class="theme-preview" style="background:' + t.preview + '">' +
        '<span class="tp-panel"></span><span class="tp-accent" style="background:' + esc(t.sig) + '"></span></span>' +
        '<span class="theme-name">' + esc(t.name) + ' <em>' + esc(t.mode) + '</em></span>' +
        '<span class="theme-desc">' + esc(t.desc) + '</span>' +
        '</button>');
      card.addEventListener('click', () => {
        draft.theme = t.id;
        themeGrid.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('on', c.dataset.themeId === t.id));
        set({ theme: t.id });
      });
      themeGrid.appendChild(card);
    });

    const swatches = el('<div class="accent-row"></div>');
    ACCENTS.forEach((a) => {
      const b = el('<button type="button" class="accent-dot' + (draft.accent === a.id ? ' on' : '') + '" data-accent-id="' + esc(a.id) + '" ' +
        'style="background:' + esc(a.dot) + '" title="' + esc(a.name) + '" aria-label="Accent: ' + esc(a.name) + '"></button>');
      b.addEventListener('click', () => {
        draft.accent = a.id;
        swatches.querySelectorAll('.accent-dot').forEach((c) => c.classList.toggle('on', c.dataset.accentId === a.id));
        set({ accent: a.id });
      });
      swatches.appendChild(b);
    });

    root.appendChild(el('<div class="ap-section"><div class="ap-head">Theme</div>' +
      '<div class="hint">Seven curated looks — light and dark. Applies instantly.</div></div>'));
    root.appendChild(themeGrid);
    root.appendChild(el('<div class="ap-section"><div class="ap-head">Accent colour</div>' +
      '<div class="hint">Used for buttons, links, highlights, and the assessment stage.</div></div>'));
    root.appendChild(swatches);

    const foot = el('<div class="ed-footer"><span class="grow"></span>' +
      '<button class="btn" data-act="reset">Reset to defaults</button>' +
      '<button class="btn primary" data-act="done">Done</button></div>');
    foot.querySelector('[data-act="reset"]').addEventListener('click', async () => {
      await set({ theme: 'lumen', accent: 'auto' });
      m.close();
      UI.toast('Appearance reset to defaults.');
    });
    foot.querySelector('[data-act="done"]').addEventListener('click', () => m.close());
    root.appendChild(foot);

    const m = UI.modal({ title: 'Appearance', body: root });
    void esc;
  }

  return { init, set, open, THEMES, ACCENTS, state: () => state };
})();
