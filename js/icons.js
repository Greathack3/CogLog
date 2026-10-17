/* Cognitive Evolution Tracker — inline icon set.

   Hand-drawn stroke pictograms in a consistent academic/clinical style, replacing
   the former decorative emoji glyphs everywhere in the interface:
   - 24×24 grid, 1.75 stroke, round caps/joins, currentColor (follows theme ink)
   - default size 1em so icons scale with the font-size of their context
   - no build step, no CDN, no external assets
   The brand brain (🧠) is deliberately kept and is never produced by this module. */
window.Icons = (function () {
  'use strict';

  const P = {
    /* navigation & identity */
    book: '<path d="M12 6.5C10 5 7.5 4.5 4 5v13c3.5-.5 6 0 8 1.5 2-1.5 4.5-2 8-1.5V5c-3.5-.5-6 0-8 1.5z"/><path d="M12 6.5v13"/>',
    chart: '<path d="M4 4v15a1 1 0 0 0 1 1h15"/><path d="M7.5 14.5l3.5-4 3 2.5 4.5-6"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 19.5c1.3-3.2 4-4.8 7-4.8s5.7 1.6 7 4.8"/>',
    flask: '<path d="M9.5 3v6.2L4.8 17.4A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-3.1L14.5 9.2V3"/><path d="M8.5 3h7"/><path d="M7.7 14.5h8.6"/>',

    /* actions */
    plus: '<path d="M12 5v14M5 12h14"/>',
    pencil: '<path d="M4 20l.9-3.6L15.6 5.7a1.8 1.8 0 0 1 2.6 0l.9.9a1.8 1.8 0 0 1 0 2.6L8.4 19.9 4 20z"/><path d="M14.2 7.1l3.5 3.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5"/>',
    trash: '<path d="M5 7h14"/><path d="M9.5 7V4.5h5V7"/><path d="M6.8 7l.8 12.3A1.5 1.5 0 0 0 9.1 20.7h5.8a1.5 1.5 0 0 0 1.5-1.4L17.2 7"/><path d="M10.2 10.5v6M13.8 10.5v6"/>',
    download: '<path d="M12 4v10"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
    upload: '<path d="M12 15V5"/><path d="M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19h14"/>',
    paperclip: '<path d="M17.5 9.5l-7.8 7.8a3.3 3.3 0 0 1-4.7-4.7l8.4-8.4a2.2 2.2 0 0 1 3.1 3.1l-8.3 8.3a1.1 1.1 0 0 1-1.6-1.6l7.5-7.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    maximize: '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M15 20h5v-5"/><path d="M9 20H4v-5"/>',
    pause: '<rect x="7" y="5" width="3.4" height="14" rx="1.1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.1"/>',

    /* data & appearance */
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4.1-4-7.2-9-7.2z"/><circle cx="8" cy="10.3" r="1.05"/><circle cx="12" cy="7.6" r="1.05"/><circle cx="16" cy="10.3" r="1.05"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12.5h6M9 16h6"/>',

    /* lifestyle & measurement */
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    activity: '<path d="M3 12.5h4l2.5-6.5 4 12 2.5-6.5H21"/>',
    volume: '<path d="M11 5.5L6.5 9H4v6h2.5L11 18.5z"/><path d="M14.8 9.2a4 4 0 0 1 0 5.6"/><path d="M17.3 6.7a7.5 7.5 0 0 1 0 10.6"/>',

    /* status & privacy */
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.8v2"/>',
    alert: '<path d="M12 4.5L21 19.5H3z"/><path d="M12 10v3.8"/><path d="M12 16.8h.01"/>'
  };

  function svg(name, size) {
    const d = P[name];
    if (!d) return '';
    const s = size ? ' width="' + size + '" height="' + size + '"' : ' width="1em" height="1em"';
    return '<svg class="icn icn-' + name + '"' + s +
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  return { svg: svg, names: Object.keys(P) };
})();
