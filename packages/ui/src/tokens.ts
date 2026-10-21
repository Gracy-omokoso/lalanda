// Jetons de couleur du design system (ADR-0030 § 4).
//
// La source servie au navigateur est `styles/tokens.css` ; ce fichier en est le
// miroir typé. Deux usages :
//   1. les tests vérifient que les deux disent la même chose (`tokens.test.ts`) ;
//   2. ils vérifient surtout les CONTRASTES des paires réellement employées
//      (texte sur fond, bordure de champ sur surface…), dans les deux thèmes.
// Un jeton modifié qui ferait tomber une paire sous le seuil WCAG casse le test,
// pas l'écran d'un utilisateur.

export type Theme = 'light' | 'dark';

/** Jetons qui changent avec le thème. Les noms sont ceux des variables CSS, sans `--`. */
export const THEME_TOKENS = {
  light: {
    background: '#F4F2ED',
    surface: '#FFFFFF',
    'surface-muted': '#ECE8DF',
    border: '#D9D3C6',
    'border-strong': '#8F8775',
    foreground: '#14191B',
    'foreground-muted': '#575449',
    accent: '#005263',
    'accent-foreground': '#FFFFFF',
    'accent-soft': '#DDEEF1',
    focus: '#007C93',
    danger: '#B3261E',
    'danger-bg': '#FBEDEC',
    ok: '#1B7A36',
    warn: '#8A5A06',
    ko: '#B3261E',
    'module-build': '#005263',
    'module-run': '#00758C',
    'module-grow': '#9C4F18',
    'nature-hypothese': '#4E5A63',
  },
  dark: {
    background: '#08181D',
    surface: '#0E232A',
    'surface-muted': '#132E36',
    border: '#21414B',
    'border-strong': '#5A7C86',
    foreground: '#EEE7D7',
    'foreground-muted': '#A7BEC4',
    accent: '#3CC4DD',
    'accent-foreground': '#03242B',
    'accent-soft': '#12343D',
    focus: '#5AD2E8',
    danger: '#F28B82',
    'danger-bg': '#2C1715',
    ok: '#5CC285',
    warn: '#E0AE4F',
    ko: '#F28B82',
    'module-build': '#96C9D7',
    'module-run': '#3CC4DD',
    'module-grow': '#E39A5E',
    'nature-hypothese': '#B4C2C8',
  },
} as const satisfies Record<Theme, Record<string, string>>;

export type ThemeToken = keyof (typeof THEME_TOKENS)['light'];

/** Barre latérale : un panneau « pétrole » dans les deux thèmes. */
export const NAV_TOKENS = {
  light: {
    'nav-bg': '#00323D',
    'nav-fg': '#EEE7D7',
    'nav-muted': '#9FC0C8',
    'nav-border': '#0D4855',
    'nav-active-bg': '#0B4A58',
    'nav-accent': '#00ACCA',
  },
  dark: {
    'nav-bg': '#04141A',
    'nav-fg': '#EEE7D7',
    'nav-muted': '#93AEB5',
    'nav-border': '#14303A',
    'nav-active-bg': '#0F2F39',
    'nav-accent': '#3CC4DD',
  },
} as const satisfies Record<Theme, Record<string, string>>;

// ─── Contraste (WCAG 2.2, § 1.4.3 et 1.4.11) ─────────────────────────────────

function canal(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative d'une couleur `#RRGGBB`. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Couleur invalide : ${hex}`);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => canal(parseInt(x, 16))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste entre deux couleurs, de 1 à 21. */
export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Seuil exigé : 4,5 pour du texte, 3 pour un élément d'interface (bordure, focus, icône). */
export const SEUIL_TEXTE = 4.5;
export const SEUIL_INTERFACE = 3;

/**
 * Paires effectivement employées par les écrans : [premier plan, arrière-plan, seuil].
 * Ajouter ici toute nouvelle combinaison avant de l'utiliser.
 */
export const PAIRES: ReadonlyArray<readonly [ThemeToken, ThemeToken, number]> = [
  ['foreground', 'background', SEUIL_TEXTE],
  ['foreground', 'surface', SEUIL_TEXTE],
  ['foreground', 'surface-muted', SEUIL_TEXTE],
  ['foreground-muted', 'background', SEUIL_TEXTE],
  ['foreground-muted', 'surface', SEUIL_TEXTE],
  ['foreground-muted', 'surface-muted', SEUIL_TEXTE],
  ['accent', 'surface', SEUIL_TEXTE],
  ['accent', 'background', SEUIL_TEXTE],
  ['accent-foreground', 'accent', SEUIL_TEXTE],
  ['accent', 'accent-soft', SEUIL_TEXTE],
  ['danger', 'danger-bg', SEUIL_TEXTE],
  ['danger', 'surface', SEUIL_TEXTE],
  ['ok', 'surface', SEUIL_TEXTE],
  ['warn', 'surface', SEUIL_TEXTE],
  ['module-build', 'surface', SEUIL_TEXTE],
  ['module-run', 'surface', SEUIL_TEXTE],
  ['module-grow', 'surface', SEUIL_TEXTE],
  ['nature-hypothese', 'surface', SEUIL_TEXTE],
  ['border-strong', 'surface', SEUIL_INTERFACE],
  ['focus', 'surface', SEUIL_INTERFACE],
  ['focus', 'background', SEUIL_INTERFACE],
];

export const PAIRES_NAV: ReadonlyArray<
  readonly [keyof (typeof NAV_TOKENS)['light'], keyof (typeof NAV_TOKENS)['light'], number]
> = [
  ['nav-fg', 'nav-bg', SEUIL_TEXTE],
  ['nav-muted', 'nav-bg', SEUIL_TEXTE],
  ['nav-fg', 'nav-active-bg', SEUIL_TEXTE],
  ['nav-accent', 'nav-bg', SEUIL_INTERFACE],
];
