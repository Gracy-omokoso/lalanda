// Script anti-FOUC (S20b, ADR-0055), inséré tel quel dans le <head> par
// `app/layout.tsx` et exécuté AVANT le premier paint.
//
// Il pose les deux attributs que lisent les jetons (`@lalanda/ui/tokens.css`) :
//   - `data-ui-theme` : le thème choisi (Lalanda, Lagune, Ébène), lu dans
//     `localStorage['ui-theme']` ; absent ou inconnu, Lalanda ;
//   - `data-theme` : le mode AFFICHÉ, lu dans `localStorage['theme']` (absent :
//     le système) — sauf sous Ébène, toujours sombre.
//
// Les clés et le vocabulaire sont ceux de `@/lib/theme`, seul écrivain du
// stockage ; `theme-boot.test.ts` exécute ce texte pour s'en assurer. Écrit en
// ES5 sans dépendance : il tourne avant tout bundle.

export const THEME_BOOT_SCRIPT = `
(function() {
  var d = document.documentElement;
  try {
    var ui = localStorage.getItem('ui-theme');
    if (ui !== 'lagune' && ui !== 'ebene') ui = 'lalanda';
    var pref = localStorage.getItem('theme');
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var mode = pref === 'light' || pref === 'dark' ? pref : (systemDark ? 'dark' : 'light');
    d.dataset.uiTheme = ui;
    d.dataset.theme = ui === 'ebene' ? 'dark' : mode;
  } catch (e) {
    d.dataset.uiTheme = 'lalanda';
  }
})();
`;
