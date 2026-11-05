// Jetons de couleur du design system (ADR-0030 § 4, ADR-0055).
//
// La source servie au navigateur est `styles/tokens.css` ; ce fichier en est le
// miroir typé. Deux usages :
//   1. les tests vérifient que les deux disent la même chose (`tokens.test.ts`) ;
//   2. ils vérifient surtout les CONTRASTES des paires réellement employées
//      (texte sur fond, bordure de champ sur surface…), pour CHAQUE combinaison
//      thème × mode.
// Un jeton modifié qui ferait tomber une paire sous le seuil WCAG casse le test,
// pas l'écran d'un utilisateur.
//
// ADR-0055 : trois thèmes au choix par personne (`data-ui-theme` sur <html>),
// chacun en clair et en sombre (`data-theme`), sauf Ébène, toujours sombre.
// Cinq combinaisons, donc cinq jeux complets de jetons.

/** Mode clair/sombre (`data-theme`). */
export type Theme = 'light' | 'dark';

/** Thèmes d'interface (`data-ui-theme`), choisis par personne. */
export const UI_THEMES = ['lalanda', 'lagune', 'ebene'] as const;
export type UiTheme = (typeof UI_THEMES)[number];
export const DEFAULT_UI_THEME: UiTheme = 'lalanda';

/** Vrai pour un thème qui ignore le choix clair/sombre (Ébène). */
export function themeToujoursSombre(uiTheme: UiTheme): boolean {
  return uiTheme === 'ebene';
}

/** Mode réellement affiché : Ébène impose le sombre, les autres suivent le choix. */
export function modeAffiche(uiTheme: UiTheme, mode: Theme): Theme {
  return themeToujoursSombre(uiTheme) ? 'dark' : mode;
}

/** Les cinq combinaisons servies. */
export const COMBINAISONS = [
  'lalanda-light',
  'lalanda-dark',
  'lagune-light',
  'lagune-dark',
  'ebene',
] as const;
export type Combinaison = (typeof COMBINAISONS)[number];

/** Combinaison affichée pour un thème et un mode. */
export function combinaison(uiTheme: UiTheme, mode: Theme): Combinaison {
  if (uiTheme === 'ebene') return 'ebene';
  return `${uiTheme}-${mode}`;
}

/**
 * Sélecteur CSS de chaque bloc de `tokens.css`, dans l'ordre du fichier. L'ordre
 * et la spécificité font la cascade : Lalanda clair est le défaut (`:root`),
 * Lagune sombre (deux attributs) l'emporte sur Lagune clair, Ébène vient en
 * dernier et l'emporte sur `[data-theme='dark']` à spécificité égale.
 */
export const SELECTEURS_CSS: Record<Combinaison, string> = {
  'lalanda-light': ":root,\n[data-theme='light']",
  'lalanda-dark': "[data-theme='dark']",
  'lagune-light': "[data-ui-theme='lagune']",
  'lagune-dark': "[data-ui-theme='lagune'][data-theme='dark']",
  ebene: "[data-ui-theme='ebene']",
};

/** Jetons qui changent avec le thème. Les noms sont ceux des variables CSS, sans `--`. */
const LALANDA_CLAIR = {
  background: '#F5F4F0',
  surface: '#FFFFFF',
  'surface-muted': '#F7F5F0',
  border: '#E2DED5',
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
} as const;

export type ThemeToken = keyof typeof LALANDA_CLAIR;

export const THEME_TOKENS = {
  'lalanda-light': LALANDA_CLAIR,
  'lalanda-dark': {
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
  'lagune-light': {
    background: '#F3F6F6',
    surface: '#FFFFFF',
    'surface-muted': '#F5F8F8',
    border: '#E1E7E8',
    'border-strong': '#7A8A8E',
    foreground: '#0E1A1E',
    'foreground-muted': '#4F5D61',
    accent: '#00687D',
    'accent-foreground': '#FFFFFF',
    'accent-soft': '#E3F0F2',
    focus: '#007C93',
    danger: '#B3261E',
    'danger-bg': '#FBEDEC',
    ok: '#1B7A36',
    warn: '#8A5A06',
    ko: '#B3261E',
    'module-build': '#005263',
    'module-run': '#00687D',
    'module-grow': '#9C4F18',
    'nature-hypothese': '#4E5A63',
  },
  'lagune-dark': {
    background: '#0C1517',
    surface: '#121E21',
    'surface-muted': '#18272B',
    border: '#24363B',
    'border-strong': '#5B767D',
    foreground: '#E8EEEF',
    'foreground-muted': '#A3B4B8',
    accent: '#4FC3D9',
    'accent-foreground': '#03242B',
    'accent-soft': '#133840',
    focus: '#6AD3E6',
    danger: '#F28B82',
    'danger-bg': '#2C1715',
    ok: '#5CC285',
    warn: '#E0AE4F',
    ko: '#F28B82',
    'module-build': '#96C9D7',
    'module-run': '#4FC3D9',
    'module-grow': '#E39A5E',
    'nature-hypothese': '#B4C2C8',
  },
  ebene: {
    background: '#0A171B',
    surface: '#0F2026',
    'surface-muted': '#13282F',
    border: '#1F3A42',
    // Maquette : #3E5E67, à 2,39:1 sur la surface — éclairci pour tenir 3:1.
    'border-strong': '#55757E',
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
} as const satisfies Record<Combinaison, Record<ThemeToken, string>>;

/**
 * Barre de navigation. Lalanda et Ébène : panneau sombre ; Lagune clair :
 * panneau blanc, d'où `nav-active-fg` (le texte de l'entrée active n'est pas
 * toujours blanc).
 */
const NAV_LALANDA_CLAIR = {
  'nav-bg': '#00323D',
  'nav-fg': '#EEE7D7',
  'nav-muted': '#9FC0C8',
  'nav-border': '#0D4855',
  'nav-active-bg': '#0B4A58',
  'nav-active-fg': '#FFFFFF',
  'nav-accent': '#00ACCA',
  'nav-build': '#96C9D7',
  'nav-run': '#00ACCA',
  'nav-grow': '#E39A5E',
} as const;

export type NavToken = keyof typeof NAV_LALANDA_CLAIR;

export const NAV_TOKENS = {
  'lalanda-light': NAV_LALANDA_CLAIR,
  'lalanda-dark': {
    'nav-bg': '#04141A',
    'nav-fg': '#EEE7D7',
    'nav-muted': '#93AEB5',
    'nav-border': '#14303A',
    'nav-active-bg': '#0F2F39',
    'nav-active-fg': '#FFFFFF',
    'nav-accent': '#3CC4DD',
    'nav-build': '#96C9D7',
    'nav-run': '#00ACCA',
    'nav-grow': '#E39A5E',
  },
  'lagune-light': {
    'nav-bg': '#FFFFFF',
    'nav-fg': '#0E1A1E',
    'nav-muted': '#55666A',
    'nav-border': '#E1E7E8',
    'nav-active-bg': '#E3F0F2',
    'nav-active-fg': '#00566A',
    'nav-accent': '#00687D',
    'nav-build': '#005263',
    'nav-run': '#00687D',
    'nav-grow': '#9C4F18',
  },
  'lagune-dark': {
    'nav-bg': '#081013',
    'nav-fg': '#E8EEEF',
    'nav-muted': '#93A9AE',
    'nav-border': '#1A2A2E',
    'nav-active-bg': '#143139',
    'nav-active-fg': '#FFFFFF',
    'nav-accent': '#4FC3D9',
    'nav-build': '#96C9D7',
    'nav-run': '#4FC3D9',
    'nav-grow': '#E39A5E',
  },
  ebene: {
    'nav-bg': '#050F12',
    'nav-fg': '#EEE7D7',
    'nav-muted': '#8FA9B0',
    'nav-border': '#14262C',
    'nav-active-bg': '#12343D',
    'nav-active-fg': '#FFFFFF',
    'nav-accent': '#3CC4DD',
    'nav-build': '#96C9D7',
    'nav-run': '#3CC4DD',
    'nav-grow': '#E39A5E',
  },
} as const satisfies Record<Combinaison, Record<NavToken, string>>;

/**
 * Graphiques (vague 4, SVG maison) : six séries et la grille. Chaque série tient
 * 3:1 sur la surface (élément graphique, WCAG 1.4.11) ; la grille est un repère
 * décoratif, sans seuil. La légende écrit toujours le nom de la série.
 */
export const CHART_SERIES = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
] as const;
export type ChartToken = (typeof CHART_SERIES)[number] | 'chart-grid';

export const CHART_TOKENS = {
  'lalanda-light': {
    'chart-1': '#005263',
    'chart-2': '#9C4F18',
    // Maquette : #00ACCA (2,71:1 sur blanc) et #CFC9BC (1,65:1) — assombris.
    'chart-3': '#0097B2',
    'chart-4': '#B3261E',
    'chart-5': '#B07A12',
    'chart-6': '#948C7B',
    'chart-grid': '#ECE8DF',
  },
  'lalanda-dark': {
    'chart-1': '#3CC4DD',
    'chart-2': '#E39A5E',
    'chart-3': '#96C9D7',
    'chart-4': '#F28B82',
    'chart-5': '#E0AE4F',
    'chart-6': '#5A7C86',
    'chart-grid': '#1A3640',
  },
  'lagune-light': {
    'chart-1': '#00687D',
    'chart-2': '#C26A2E',
    // Maquette : #4FB3C8 (2,44:1 sur blanc) et #C3CDCF (1,62:1) — assombris.
    'chart-3': '#2F98AE',
    'chart-4': '#C2372B',
    'chart-5': '#B98A1A',
    'chart-6': '#7F8E92',
    'chart-grid': '#E8EEEF',
  },
  'lagune-dark': {
    'chart-1': '#4FC3D9',
    'chart-2': '#E39A5E',
    'chart-3': '#96C9D7',
    'chart-4': '#F28B82',
    'chart-5': '#E0AE4F',
    'chart-6': '#5B767D',
    'chart-grid': '#1E2E32',
  },
  ebene: {
    'chart-1': '#3CC4DD',
    'chart-2': '#E39A5E',
    'chart-3': '#96C9D7',
    'chart-4': '#F28B82',
    'chart-5': '#E0AE4F',
    // Maquette : #3E5E67 (2,39:1 sur la surface) — éclairci.
    'chart-6': '#55757E',
    'chart-grid': '#1A333A',
  },
} as const satisfies Record<Combinaison, Record<ChartToken, string>>;

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
 * Vérifiées pour chaque combinaison. Ajouter ici toute nouvelle combinaison
 * avant de l'utiliser.
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

export const PAIRES_NAV: ReadonlyArray<readonly [NavToken, NavToken, number]> = [
  ['nav-fg', 'nav-bg', SEUIL_TEXTE],
  ['nav-muted', 'nav-bg', SEUIL_TEXTE],
  ['nav-fg', 'nav-active-bg', SEUIL_TEXTE],
  ['nav-active-fg', 'nav-active-bg', SEUIL_TEXTE],
  ['nav-accent', 'nav-bg', SEUIL_INTERFACE],
  // Pastille du nombre de notifications : texte `nav-bg` sur `nav-accent`.
  ['nav-bg', 'nav-accent', SEUIL_TEXTE],
  // Icônes de module, au repos et sur l'onglet actif.
  ['nav-build', 'nav-bg', SEUIL_INTERFACE],
  ['nav-run', 'nav-bg', SEUIL_INTERFACE],
  ['nav-grow', 'nav-bg', SEUIL_INTERFACE],
  ['nav-build', 'nav-active-bg', SEUIL_INTERFACE],
  ['nav-run', 'nav-active-bg', SEUIL_INTERFACE],
  ['nav-grow', 'nav-active-bg', SEUIL_INTERFACE],
];

/** Séries de graphique contre la surface qui les porte (élément graphique). */
export const PAIRES_GRAPHIQUE: ReadonlyArray<readonly [ChartToken, number]> = CHART_SERIES.map(
  (serie) => [serie, SEUIL_INTERFACE] as const,
);

// ─── Étiquettes (ADR-0039 § 2.1) ─────────────────────────────────────────────

/**
 * Couleurs d'étiquette : palette FERMÉE, mêmes clés que `WORK_LABEL_COLORS`
 * (`@lalanda/shared/work`) — le web vérifie l'égalité des deux listes. Une
 * étiquette ne porte jamais un code couleur libre.
 */
export const TAG_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

type Etiquette = { bg: string; fg: string; dot: string };

/**
 * Valeurs par mode (variables `--label-<clé>-bg|fg|dot`). `fg` sur `bg` : texte
 * (≥ 4,5:1) ; `dot` sur la surface et sur `bg` : repère d'interface (≥ 3:1).
 * Les thèmes clairs partagent une palette, les thèmes sombres l'autre ; le test
 * vérifie chaque repère contre la surface de CHAQUE combinaison.
 */
const ETIQUETTES_CLAIR = {
  gray: { bg: '#ECEAE4', fg: '#3F3D36', dot: '#6B675C' },
  red: { bg: '#FBE4E1', fg: '#8E1F17', dot: '#C2372B' },
  orange: { bg: '#FCE8D6', fg: '#8A3B0A', dot: '#C25A12' },
  yellow: { bg: '#FAF0C8', fg: '#6B4E00', dot: '#9A7400' },
  green: { bg: '#E1F2E3', fg: '#1F5F2C', dot: '#2E8B45' },
  teal: { bg: '#DCF0EE', fg: '#145A55', dot: '#1C8A82' },
  blue: { bg: '#E0EAFB', fg: '#1E4796', dot: '#2F64D0' },
  purple: { bg: '#EEE5F8', fg: '#5B2D8E', dot: '#8150C2' },
  pink: { bg: '#FBE3EF', fg: '#8C1D58', dot: '#C83D86' },
} as const satisfies Record<TagColor, Etiquette>;

const ETIQUETTES_SOMBRE = {
  gray: { bg: '#24343A', fg: '#D9DEDC', dot: '#9AA6AA' },
  red: { bg: '#3A1C1A', fg: '#F5B4AD', dot: '#EF7D72' },
  orange: { bg: '#3A2414', fg: '#F6C49A', dot: '#EE9A55' },
  yellow: { bg: '#352C0F', fg: '#F0D985', dot: '#D9B83A' },
  green: { bg: '#173323', fg: '#A6DDB4', dot: '#5CC285' },
  teal: { bg: '#12332F', fg: '#9EDCD4', dot: '#43B8AC' },
  blue: { bg: '#172A47', fg: '#ADC8F5', dot: '#6E9CEB' },
  purple: { bg: '#2A1F3D', fg: '#CDB5F0', dot: '#A584DD' },
  pink: { bg: '#3A1A2B', fg: '#F3B0D2', dot: '#E07AAE' },
} as const satisfies Record<TagColor, Etiquette>;

export const LABEL_TOKENS = {
  'lalanda-light': ETIQUETTES_CLAIR,
  'lalanda-dark': ETIQUETTES_SOMBRE,
  'lagune-light': ETIQUETTES_CLAIR,
  'lagune-dark': ETIQUETTES_SOMBRE,
  ebene: ETIQUETTES_SOMBRE,
} as const satisfies Record<Combinaison, Record<TagColor, Etiquette>>;

// ─── Couleurs des cartes, façon post-it (ADR-0061 § 4) ────────────────────────

/**
 * Palette FERMÉE des cartes de tâche : mêmes clés que `WORK_CARD_COLORS`
 * (`@lalanda/shared/work`). Huit pastels CLAIRS en Lalanda et Lagune clairs ;
 * versions désaturées SOMBRES en mode sombre et en Ébène. Variables
 * `--card-<clé>-bg` (fond de la carte : le texte du thème, `foreground` et
 * `foreground-muted`, y reste ≥ 4,5:1) et `--card-<clé>-dot` (liseré et pastille
 * de la Liste : ≥ 3:1 sur la surface).
 */
export const CARD_COLORS = [
  'yellow',
  'orange',
  'pink',
  'purple',
  'blue',
  'teal',
  'green',
  'gray',
] as const;
export type CardColor = (typeof CARD_COLORS)[number];

type Carte = { bg: string; dot: string };

const CARTES_CLAIR = {
  yellow: { bg: '#FFF4B8', dot: '#9A7400' },
  orange: { bg: '#FFE3C7', dot: '#C25A12' },
  pink: { bg: '#FCDDEB', dot: '#C83D86' },
  purple: { bg: '#E9DFFA', dot: '#8150C2' },
  blue: { bg: '#DCEBFD', dot: '#2F64D0' },
  teal: { bg: '#D3F2EC', dot: '#1C8A82' },
  green: { bg: '#DDF3D5', dot: '#2E8B45' },
  gray: { bg: '#ECEBE6', dot: '#6B675C' },
} as const satisfies Record<CardColor, Carte>;

const CARTES_SOMBRE = {
  yellow: { bg: '#3A341C', dot: '#D9B83A' },
  orange: { bg: '#3D2A1C', dot: '#EE9A55' },
  pink: { bg: '#3B2230', dot: '#E07AAE' },
  purple: { bg: '#2F2840', dot: '#A584DD' },
  blue: { bg: '#1F2E45', dot: '#6E9CEB' },
  teal: { bg: '#183632', dot: '#43B8AC' },
  green: { bg: '#1F3524', dot: '#5CC285' },
  gray: { bg: '#2E3436', dot: '#9AA6AA' },
} as const satisfies Record<CardColor, Carte>;

export const CARD_TOKENS = {
  'lalanda-light': CARTES_CLAIR,
  'lalanda-dark': CARTES_SOMBRE,
  'lagune-light': CARTES_CLAIR,
  'lagune-dark': CARTES_SOMBRE,
  ebene: CARTES_SOMBRE,
} as const satisfies Record<Combinaison, Record<CardColor, Carte>>;
