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

/**
 * Valeurs par thème (variables `--label-<clé>-bg|fg|dot`). `fg` sur `bg` : texte
 * (≥ 4,5:1) ; `dot` sur la surface et sur `bg` : repère d'interface (≥ 3:1).
 */
export const LABEL_TOKENS = {
  light: {
    gray: { bg: '#ECEAE4', fg: '#3F3D36', dot: '#6B675C' },
    red: { bg: '#FBE4E1', fg: '#8E1F17', dot: '#C2372B' },
    orange: { bg: '#FCE8D6', fg: '#8A3B0A', dot: '#C25A12' },
    yellow: { bg: '#FAF0C8', fg: '#6B4E00', dot: '#9A7400' },
    green: { bg: '#E1F2E3', fg: '#1F5F2C', dot: '#2E8B45' },
    teal: { bg: '#DCF0EE', fg: '#145A55', dot: '#1C8A82' },
    blue: { bg: '#E0EAFB', fg: '#1E4796', dot: '#2F64D0' },
    purple: { bg: '#EEE5F8', fg: '#5B2D8E', dot: '#8150C2' },
    pink: { bg: '#FBE3EF', fg: '#8C1D58', dot: '#C83D86' },
  },
  dark: {
    gray: { bg: '#24343A', fg: '#D9DEDC', dot: '#9AA6AA' },
    red: { bg: '#3A1C1A', fg: '#F5B4AD', dot: '#EF7D72' },
    orange: { bg: '#3A2414', fg: '#F6C49A', dot: '#EE9A55' },
    yellow: { bg: '#352C0F', fg: '#F0D985', dot: '#D9B83A' },
    green: { bg: '#173323', fg: '#A6DDB4', dot: '#5CC285' },
    teal: { bg: '#12332F', fg: '#9EDCD4', dot: '#43B8AC' },
    blue: { bg: '#172A47', fg: '#ADC8F5', dot: '#6E9CEB' },
    purple: { bg: '#2A1F3D', fg: '#CDB5F0', dot: '#A584DD' },
    pink: { bg: '#3A1A2B', fg: '#F3B0D2', dot: '#E07AAE' },
  },
} as const satisfies Record<Theme, Record<TagColor, { bg: string; fg: string; dot: string }>>;
