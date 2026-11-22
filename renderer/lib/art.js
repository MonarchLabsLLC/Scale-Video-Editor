// Small line drawings for the format cards, one per format "art" key. Drawn in the card's ink
// color on its pastel, inside a 16:9 frame, in the spirit of the toolkit site's drawn frames.
(function () {
  const s = (body) => `<svg viewBox="0 0 160 90" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ART = {
    timeline: s('<rect x="16" y="20" width="128" height="14" rx="4"/><rect x="16" y="40" width="80" height="14" rx="4"/><rect x="100" y="40" width="44" height="14" rx="4"/><rect x="16" y="60" width="128" height="10" rx="4" stroke-dasharray="3 5"/><path d="M60 14v62" stroke-width="3"/>'),
    browser: s('<rect x="22" y="14" width="116" height="62" rx="8"/><path d="M22 28h116"/><circle cx="32" cy="21" r="2"/><circle cx="40" cy="21" r="2"/><rect x="34" y="38" width="40" height="28" rx="4"/><path d="M84 42h40M84 52h30M84 62h36"/>'),
    film: s('<rect x="20" y="16" width="120" height="58" rx="6"/><path d="M34 16v58M126 16v58"/><path d="M72 34l22 11-22 11z"/>'),
    device: s('<rect x="62" y="8" width="36" height="74" rx="8"/><path d="M74 14h12"/><path d="M30 80h100" stroke-dasharray="2 6"/><path d="M20 24l26 10M140 24l-26 10"/>'),
    short: s('<rect x="62" y="8" width="38" height="74" rx="8"/><path d="M74 60h14M70 66h22"/><path d="M76 34l12 7-12 7z"/>'),
    cuts: s('<path d="M16 44c10-18 18 18 28 0s18-18 28 0"/><path d="M88 44c10-18 18 18 28 0s14-12 28 0"/><path d="M80 14v62" stroke-dasharray="4 4"/><circle cx="80" cy="14" r="4"/>'),
    lower: s('<rect x="16" y="12" width="128" height="66" rx="6"/><circle cx="80" cy="36" r="12"/><path d="M60 64c4-10 36-10 40 0"/><rect x="24" y="52" width="58" height="16" rx="4" fill="currentColor" fill-opacity=".14"/>'),
    clone: s('<circle cx="56" cy="36" r="13"/><path d="M34 74c4-16 40-16 44 0"/><circle cx="104" cy="36" r="13" stroke-dasharray="4 4"/><path d="M82 74c4-16 40-16 44 0" stroke-dasharray="4 4"/>'),
    cartoon: s('<circle cx="80" cy="42" r="24"/><circle cx="71" cy="38" r="3" fill="currentColor"/><circle cx="89" cy="38" r="3" fill="currentColor"/><path d="M70 50c6 6 14 6 20 0"/><path d="M60 22l-8-10M100 22l8-10"/>'),
    layers: s('<path d="M80 14l52 20-52 20-52-20z"/><path d="M28 46l52 20 52-20"/><path d="M28 58l52 20 52-20"/>'),
    mograph: s('<rect x="18" y="16" width="52" height="34" rx="6"/><circle cx="110" cy="33" r="17"/><path d="M18 66h124"/><path d="M76 33h14" stroke-width="3"/><path d="M84 27l6 6-6 6"/>'),
    stick: s('<circle cx="58" cy="24" r="8"/><path d="M58 32v24M58 40l-12 10M58 40l12 8M58 56l-10 18M58 56l10 18"/><circle cx="106" cy="24" r="8"/><path d="M106 32v24M106 40l12-12M106 40l-12 8M106 56l-10 18M106 56l10 18"/>'),
    chart: s('<path d="M20 76h124"/><rect x="30" y="52" width="18" height="24" rx="3"/><rect x="58" y="40" width="18" height="36" rx="3"/><rect x="86" y="28" width="18" height="48" rx="3"/><rect x="114" y="14" width="18" height="62" rx="3" fill="currentColor" fill-opacity=".14"/>'),
    flap: s('<rect x="16" y="24" width="28" height="42" rx="4"/><rect x="50" y="24" width="28" height="42" rx="4"/><rect x="84" y="24" width="28" height="42" rx="4"/><rect x="118" y="24" width="28" height="42" rx="4"/><path d="M16 45h130"/>'),
    relight: s('<circle cx="40" cy="30" r="12"/><path d="M40 10v4M40 46v4M20 30h4M56 30h4M26 16l3 3M51 41l3 3M26 44l3-3M51 19l3-3"/><rect x="74" y="20" width="68" height="50" rx="6"/><path d="M74 58l20-16 16 12 12-8 20 14"/>')
  };
  window.SVE_ART = k => ART[k] || ART.film;
})();
