// Feuille de style d'un gabarit sur mesure — ADR-0029 O2 (barrières 2 et 3).
//
// Le CSS d'un paquet est du contenu NON FIABLE. Il est :
//   1. ANALYSÉ par un lecteur volontairement étroit : règles à plat
//      `sélecteurs { déclarations }`, sans at-règle (`@import`, `@page`,
//      `@font-face`, `@media`…), sans imbrication, sans échappement `\` ;
//   2. CONFINÉ : chaque sélecteur est préfixé par `.lx-modele ` et l'ensemble
//      est placé dans `@scope (.lx-modele)` — deux barrières indépendantes : il
//      ne sélectionne que des DESCENDANTS du conteneur du modèle, jamais la zone
//      DGI, le filigrane, `html` ou `body` ;
//   3. FILTRÉ par LISTE BLANCHE de propriétés. Rien qui positionne, empile,
//      transforme, rogne ou rend transparent n'est admis : sans contexte
//      d'empilement, le texte se peint au-dessus de tous les fonds (CSS 2.1,
//      annexe E) — un aplat ne recouvre pas une mention.
//
// Risque résiduel assumé (ADR-0029, Conséquences) : une couleur de texte égale
// à celle du fond n'est pas détectable statiquement.

import { positionOf, type IssueList } from './report.js';

/** Variables posées par le moteur (valeurs sûres : couleurs opaques, polices intégrées). */
export const ENGINE_CSS_VARIABLES = [
  '--lalanda-accent',
  '--lalanda-on-accent',
  '--lalanda-soft',
  '--lalanda-line',
  '--lalanda-side',
  '--lalanda-on-side',
  '--lalanda-font-body',
  '--lalanda-font-display',
  '--lalanda-font-code',
] as const;

const COLOR_VARS: ReadonlySet<string> = new Set(
  ENGINE_CSS_VARIABLES.filter((v) => !v.includes('font')),
);
const FONT_VARS: ReadonlySet<string> = new Set(
  ENGINE_CSS_VARIABLES.filter((v) => v.includes('font')),
);
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace']);

const ALLOWED_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'calc',
  'var',
  'url',
  'linear-gradient',
  'radial-gradient',
  'repeat',
  'minmax',
  'fit-content',
]);

/** Plafonds des longueurs (une valeur plus grande pousserait du texte hors de la page). */
const UNIT_MAX: Record<string, number> = {
  px: 1000,
  pt: 750,
  mm: 265,
  cm: 26.5,
  in: 10.5,
  em: 60,
  rem: 60,
  ch: 120,
  ex: 120,
  '%': 100,
  fr: 100,
  deg: 360,
  '': 1000,
};

type Kind =
  | 'color' // texte : opaque seulement
  | 'paint' // fond, bordure : toute couleur
  | 'background'
  | 'font-family'
  | 'font-size'
  | 'length' // positif ou nul
  | 'spacing' // letter-spacing : légèrement négatif admis
  | 'keyword'
  | 'display'
  | 'grid'
  | 'free'; // valeurs sans longueur risquée (graisse, alignements…)

const PROPS: Record<string, Kind> = {
  color: 'color',
  'background-color': 'paint',
  background: 'background',
  'background-image': 'background',
  'background-size': 'length',
  'background-position': 'length',
  'background-repeat': 'keyword',
  'font-family': 'font-family',
  'font-size': 'font-size',
  'font-weight': 'free',
  'font-style': 'keyword',
  'font-variant-numeric': 'keyword',
  'line-height': 'length',
  'letter-spacing': 'spacing',
  'word-spacing': 'length',
  'text-align': 'keyword',
  'text-transform': 'keyword',
  'text-decoration': 'paint',
  'text-decoration-line': 'keyword',
  'text-decoration-color': 'paint',
  'text-decoration-style': 'keyword',
  'text-decoration-thickness': 'length',
  'text-underline-offset': 'length',
  'white-space': 'keyword',
  'word-break': 'keyword',
  'overflow-wrap': 'keyword',
  hyphens: 'keyword',
  'vertical-align': 'keyword',
  'box-sizing': 'keyword',
  display: 'display',
  width: 'length',
  'min-width': 'length',
  'max-width': 'length',
  height: 'length',
  'min-height': 'length',
  'max-height': 'length',
  'border-collapse': 'keyword',
  'border-spacing': 'length',
  'table-layout': 'keyword',
  'caption-side': 'keyword',
  'list-style': 'keyword',
  'list-style-type': 'keyword',
  'list-style-position': 'keyword',
  'break-before': 'keyword',
  'break-after': 'keyword',
  'break-inside': 'keyword',
  'page-break-before': 'keyword',
  'page-break-after': 'keyword',
  'page-break-inside': 'keyword',
  orphans: 'free',
  widows: 'free',
  'object-fit': 'keyword',
  float: 'keyword',
  clear: 'keyword',
  'box-shadow': 'paint',
  flex: 'free',
  'flex-direction': 'keyword',
  'flex-wrap': 'keyword',
  'flex-flow': 'keyword',
  'flex-grow': 'free',
  'flex-shrink': 'free',
  'flex-basis': 'length',
  'justify-content': 'keyword',
  'justify-items': 'keyword',
  'justify-self': 'keyword',
  'align-items': 'keyword',
  'align-content': 'keyword',
  'align-self': 'keyword',
  'place-items': 'keyword',
  'place-content': 'keyword',
  order: 'free',
  gap: 'length',
  'row-gap': 'length',
  'column-gap': 'length',
  'grid-template-columns': 'grid',
  'grid-template-rows': 'grid',
  'grid-auto-flow': 'keyword',
  'grid-auto-rows': 'grid',
  'grid-auto-columns': 'grid',
};
for (const side of ['', '-top', '-right', '-bottom', '-left']) {
  PROPS[`margin${side}`] = 'length';
  PROPS[`padding${side}`] = 'length';
  PROPS[`border${side}`] = 'paint';
  if (side) {
    PROPS[`border${side}-width`] = 'length';
    PROPS[`border${side}-style`] = 'keyword';
    PROPS[`border${side}-color`] = 'paint';
  }
}
for (const p of ['border-width', 'border-style', 'border-color']) {
  PROPS[p] = p.endsWith('color') ? 'paint' : p.endsWith('width') ? 'length' : 'keyword';
}
for (const c of ['', '-top-left', '-top-right', '-bottom-left', '-bottom-right']) {
  PROPS[`border${c}-radius`] = 'length';
}

/** Explications des refus les plus fréquents (le guide les reprend). */
const WHY: Record<string, string> = {
  position: 'le positionnement permettrait de recouvrir une mention',
  top: 'les décalages permettraient de recouvrir une mention',
  left: 'les décalages permettraient de recouvrir une mention',
  right: 'les décalages permettraient de recouvrir une mention',
  bottom: 'les décalages permettraient de recouvrir une mention',
  inset: 'les décalages permettraient de recouvrir une mention',
  'z-index': 'l’empilement permettrait de recouvrir une mention',
  transform: 'une transformation peut réduire ou déplacer une mention hors de vue',
  opacity: 'la transparence peut masquer une mention',
  visibility: 'la visibilité ne se règle pas dans un modèle',
  filter: 'un filtre peut effacer une mention',
  'clip-path': 'le rognage peut masquer une mention',
  overflow: 'le rognage peut masquer une mention',
  content: 'le texte imprimé vient du document, pas du CSS',
  'grid-area': 'le placement explicite permettrait de superposer deux éléments',
  'grid-row': 'le placement explicite permettrait de superposer deux éléments',
  'grid-column': 'le placement explicite permettrait de superposer deux éléments',
  'grid-template-areas': 'le placement explicite permettrait de superposer deux éléments',
  font: 'écrivez font-family, font-size et font-weight séparément',
};

export interface CssPolicyContext {
  file: string;
  /** Familles des polices du paquet (manifeste). */
  families: ReadonlySet<string>;
  /** Images du paquet → URI `data:` (substitution dans `url()`). */
  images: ReadonlyMap<string, string>;
}

export interface CompiledCss {
  /** CSS confiné, prêt à être placé dans le document. */
  css: string;
  rules: number;
}

/** Retire les commentaires en conservant les positions (espaces de même longueur). */
function blankComments(src: string, ctx: CssPolicyContext, issues: IssueList): string {
  return src.replace(/\/\*[\s\S]*?(\*\/|$)/g, (m, end: string, index: number) => {
    if (end !== '*/') {
      issues.error({
        code: 'CSS_SYNTAX',
        message: 'Commentaire « /* » jamais fermé.',
        file: ctx.file,
        ...positionOf(src, index),
      });
    }
    return m.replace(/[^\n]/g, ' ');
  });
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const SELECTOR_CHARS = /^[A-Za-z0-9_\-.#:>+~*\s()[\]="'^$|,]+$/;
const FORBIDDEN_SELECTOR: ReadonlyArray<[RegExp, string]> = [
  [
    /(^|[\s>+~(,])(html|body|head|main)(?=$|[\s.#:[>+~),])/i,
    '« html », « body » et « main » sont hors du modèle',
  ],
  [/:root\b/i, '« :root » est hors du modèle'],
  [/:host\b|::part|::slotted/i, 'sélecteur de composant interdit'],
  [/lx-/i, 'le préfixe « lx- » est réservé au moteur'],
  [/::?(before|after|marker|first-letter|first-line|selection)\b/i, 'pseudo-éléments interdits'],
];

/**
 * Racine de chaque sélecteur. Dans `@scope`, un sélecteur SANS `:scope` est
 * implicitement préfixé par `:scope ` (il chercherait un `.lx-modele` DANS le
 * conteneur) : on écrit donc `:scope` explicitement, ET la classe du conteneur.
 * Les deux barrières restent indépendantes : sans `@scope`, la règle exige un
 * ancêtre `.lx-modele` ; si `:scope` désignait autre chose que le conteneur,
 * la classe exigée ne correspondrait plus à rien.
 */
const ROOT = '.lx-modele:scope';

/** Préfixe un sélecteur par le conteneur. `:scope` en tête désigne le conteneur lui-même. */
function scopeSelector(sel: string): string | { error: string } {
  const s = sel.trim().replace(/\s+/g, ' ');
  if (s === '') return { error: 'Sélecteur vide.' };
  if (!SELECTOR_CHARS.test(s)) return { error: `Caractère interdit dans le sélecteur « ${s} ».` };
  for (const [re, why] of FORBIDDEN_SELECTOR) {
    if (re.test(s)) return { error: `Sélecteur « ${s} » refusé : ${why}.` };
  }
  if (s.startsWith(':scope')) {
    const rest = s.slice(':scope'.length);
    if (rest.includes(':scope')) return { error: '« :scope » seulement en tête de sélecteur.' };
    // `:scope ~ x`, `:scope + x` viseraient les VOISINS du conteneur : la zone DGI.
    if (/^\s*[~+]/.test(rest)) {
      return { error: `Sélecteur « ${s} » refusé : il viserait des éléments hors du modèle.` };
    }
    return `${ROOT}${rest}`;
  }
  if (s.includes(':scope')) return { error: '« :scope » seulement en tête de sélecteur.' };
  return `${ROOT} ${s}`;
}

/** Couleur de texte opaque ? (ni `transparent`, ni canal alpha). */
function opaqueColor(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (s === 'transparent' || s === 'currentcolor' || s === 'inherit') return s !== 'transparent';
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return true;
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/.test(s)) return false;
  const v1 = /^var\((--[a-z-]+)\)$/.exec(s);
  if (v1) return COLOR_VARS.has(v1[1]!);
  const fn = /^(rgb|hsl)a?\(([^)]*)\)$/.exec(s);
  if (fn) return !fn[2]!.includes('/') && fn[2]!.split(/[\s,]+/).filter(Boolean).length === 3;
  return /^[a-z]+$/.test(s);
}

interface DeclCheck {
  error?: string;
  value?: string;
}

/** Contrôle et réécrit une valeur (substitution des `url(images/…)`). */
function checkValue(prop: string, kind: Kind, raw: string, ctx: CssPolicyContext): DeclCheck {
  let value = raw.trim();
  const important = /\s*!important$/i.exec(value);
  if (important) value = value.slice(0, important.index).trim();
  if (value === '') return { error: 'Valeur vide.' };
  if (/[{}<>@\\!;]/.test(value)) return { error: 'Caractère interdit dans la valeur.' };

  // Fonctions admises ; `var()` limité aux variables du moteur, sans repli.
  for (const m of value.matchAll(/([a-zA-Z-]+)\(/g)) {
    if (!ALLOWED_FUNCTIONS.has(m[1]!.toLowerCase()))
      return { error: `Fonction « ${m[1]}() » interdite.` };
  }
  for (const m of value.matchAll(/var\(([^)]*)\)/gi)) {
    const name = m[1]!.trim();
    if (!(ENGINE_CSS_VARIABLES as readonly string[]).includes(name)) {
      return {
        error: `« var(${name}) » : seules les variables du moteur (${ENGINE_CSS_VARIABLES.join(', ')}) sont admises, sans valeur de repli.`,
      };
    }
  }
  if (/calc\(/i.test(value) && !['length', 'grid'].includes(kind)) {
    return { error: '« calc() » n’est admis que pour les largeurs, hauteurs et grilles.' };
  }
  if (/calc\(/i.test(value) && /^(margin|padding|letter|word|text|font)/.test(prop)) {
    return { error: '« calc() » n’est pas admis ici.' };
  }

  // Images : seulement celles du paquet, intégrées en `data:`.
  let urlError: string | undefined;
  value = value.replace(/url\(\s*(['"]?)([^'")\s]*)\1\s*\)/gi, (_m, _q, target: string) => {
    if (kind !== 'background') {
      urlError = '« url() » n’est admis que dans background et background-image.';
      return '';
    }
    const data = ctx.images.get(target);
    if (!data) {
      urlError = `« url(${target.slice(0, 60)}) » : seules les images du paquet (images/…) sont admises — aucune adresse externe.`;
      return '';
    }
    return `url("${data}")`;
  });
  if (urlError) return { error: urlError };
  if (/url\(/i.test(value.replace(/url\("data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"\)/g, ''))) {
    return { error: '« url() » illisible.' };
  }

  // Longueurs : unités connues, plafonnées ; négatif interdit sauf letter-spacing léger.
  const scan = value
    .replace(/url\("[^"]*"\)/g, ' ')
    .replace(/"[^"]*"|'[^']*'/g, ' ')
    .replace(/#[0-9a-fA-F]{3,8}\b/g, ' ')
    .replace(/var\([^)]*\)/g, ' ');
  for (const m of scan.matchAll(/(^|[^A-Za-z0-9_-])(-?)(\d+\.?\d*|\.\d+)([A-Za-z%]*)/g)) {
    const negative = m[2] === '-';
    const n = Number(m[3]);
    const unit = m[4]!.toLowerCase();
    if (!(unit in UNIT_MAX))
      return { error: `Unité « ${unit} » non admise (px, pt, mm, cm, em, rem, %, fr…).` };
    if (n > UNIT_MAX[unit]!)
      return { error: `Valeur trop grande (${m[3]}${unit}) : au plus ${UNIT_MAX[unit]}${unit}.` };
    if (negative) {
      // Ombre : un décalage négatif ne cache rien (elle se peint sous le texte).
      if (prop === 'box-shadow') continue;
      const smallSpacing =
        kind === 'spacing' &&
        ((unit === 'px' && n <= 1) ||
          (unit === 'pt' && n <= 0.75) ||
          ((unit === 'em' || unit === 'rem') && n <= 0.05));
      if (!smallSpacing)
        return {
          error:
            'Valeur négative interdite (elle permettrait de superposer ou de cacher du texte).',
        };
    }
    if (kind === 'font-size') {
      const px = unit === 'px' ? n : unit === 'pt' ? (n * 4) / 3 : unit === 'mm' ? n * 3.7795 : NaN;
      if (Number.isNaN(px)) return { error: 'Taille de police en px, pt ou mm uniquement.' };
      if (px < 6) return { error: 'Taille de police trop petite : au moins 6 px (4,5 pt).' };
    }
  }
  if (kind === 'font-size' && !/^\d/.test(value)) {
    return { error: 'Taille de police : un nombre en px, pt ou mm (ex. 10px, 9pt).' };
  }

  if (kind === 'color' && !opaqueColor(value)) {
    return { error: 'Couleur de texte opaque exigée (ni « transparent », ni canal alpha).' };
  }
  if (kind === 'display' && /\b(none|contents)\b/i.test(value)) {
    return {
      error:
        '« display: none » et « display: contents » sont interdits (une mention doit rester visible).',
    };
  }
  if (kind === 'font-family') {
    for (const part of splitTopLevel(value, ',')) {
      const name = part.trim().replace(/^(['"])(.*)\1$/, '$2');
      const v = /^var\((--[a-z-]+)\)$/.exec(name);
      if (
        v
          ? FONT_VARS.has(v[1]!)
          : GENERIC_FAMILIES.has(name.toLowerCase()) || ctx.families.has(name.toLowerCase())
      ) {
        continue;
      }
      return {
        error: `Police « ${name} » inconnue : utilisez var(--lalanda-font-body), var(--lalanda-font-display), var(--lalanda-font-code), une police déclarée dans le manifeste, ou serif / sans-serif / monospace.`,
      };
    }
  }
  return { value: important ? `${value} !important` : value };
}

/**
 * Analyse, filtre et confine une feuille. Renvoie `null` si elle contient une
 * erreur (toutes sont rapportées dans `issues`).
 */
export function compileCss(
  src: string,
  ctx: CssPolicyContext,
  issues: IssueList,
): CompiledCss | null {
  let ok = true;
  const fail = (code: string, message: string, index: number) => {
    ok = false;
    issues.error({ code, message, file: ctx.file, ...positionOf(src, index) });
  };
  const ctrl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.exec(src);
  if (ctrl) fail('CSS_SYNTAX', 'Caractère de contrôle interdit.', ctrl.index);
  const before = issues.errors.length;
  const text = blankComments(src, ctx, issues);
  if (issues.errors.length > before) ok = false;
  for (const [re, code, message] of [
    [/\\/g, 'CSS_ESCAPE_FORBIDDEN', 'Échappement « \\ » interdit dans le CSS.'],
    [
      /@/g,
      'CSS_AT_RULE_FORBIDDEN',
      'At-règle interdite (@import, @page, @font-face, @media…) : les polices se déclarent dans le manifeste.',
    ],
    [/</g, 'CSS_SYNTAX', 'Caractère « < » interdit dans le CSS.'],
  ] as const) {
    const m = re.exec(text);
    if (m) fail(code, message, m.index);
  }
  if (!ok) return null;

  const rules: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) {
      if (text.slice(i).trim() !== '') fail('CSS_SYNTAX', 'Texte hors d’une règle.', i);
      break;
    }
    const close = text.indexOf('}', open + 1);
    const nested = text.indexOf('{', open + 1);
    if (close === -1) {
      fail('CSS_SYNTAX', '« { » sans « } » fermant.', open);
      break;
    }
    if (nested !== -1 && nested < close) {
      fail(
        'CSS_NESTING_FORBIDDEN',
        'Règles imbriquées interdites : écrivez des règles à plat.',
        nested,
      );
      i = close + 1;
      continue;
    }
    const selectorText = text.slice(i, open);
    if (selectorText.includes('}') || selectorText.includes(';')) {
      fail('CSS_SYNTAX', 'Accolade ou point-virgule inattendu avant un sélecteur.', i);
      i = close + 1;
      continue;
    }
    const scoped: string[] = [];
    for (const part of splitTopLevel(selectorText, ',')) {
      const s = scopeSelector(part);
      if (typeof s === 'string') scoped.push(s);
      else
        fail('CSS_SELECTOR_FORBIDDEN', s.error, i + Math.max(0, selectorText.indexOf(part.trim())));
    }
    const decls: string[] = [];
    let at = open + 1;
    for (const d of splitTopLevel(text.slice(open + 1, close), ';')) {
      const index = at;
      at += d.length + 1;
      if (d.trim() === '') continue;
      const colon = d.indexOf(':');
      const prop = (colon === -1 ? d : d.slice(0, colon)).trim().toLowerCase();
      if (prop.startsWith('--')) {
        fail(
          'CSS_PROPERTY_FORBIDDEN',
          'Propriétés personnalisées (--…) interdites : utilisez les variables --lalanda-* du moteur.',
          index,
        );
        continue;
      }
      if (colon === -1 || !/^-?[a-z][a-z-]*$/.test(prop)) {
        fail('CSS_SYNTAX', `Déclaration illisible « ${d.trim().slice(0, 40)} ».`, index);
        continue;
      }
      const kind = PROPS[prop];
      if (!kind) {
        const why = WHY[prop] ?? WHY[prop.replace(/-.*$/, '')];
        fail(
          'CSS_PROPERTY_FORBIDDEN',
          `Propriété « ${prop} » non admise${why ? ` : ${why}` : ' (voir la liste des propriétés du guide)'}.`,
          index,
        );
        continue;
      }
      const r = checkValue(prop, kind, d.slice(colon + 1), ctx);
      if (r.error) {
        fail('CSS_VALUE_FORBIDDEN', `${prop} : ${r.error}`, index);
        continue;
      }
      decls.push(`${prop}: ${r.value}`);
    }
    if (scoped.length > 0 && decls.length > 0)
      rules.push(`${scoped.join(', ')} { ${decls.join('; ')}; }`);
    i = close + 1;
  }
  if (!ok) return null;
  return { css: `@scope (.lx-modele) {\n${rules.join('\n')}\n}`, rules: rules.length };
}
