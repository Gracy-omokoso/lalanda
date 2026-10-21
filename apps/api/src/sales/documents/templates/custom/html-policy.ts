// HTML admis dans un gabarit sur mesure — ADR-0029 § 4.
//
// Deux passes, même analyseur :
//   - SOURCE (validation du paquet) : le gabarit, balises Mustache masquées,
//     avec positions ligne/colonne ; contrôle aussi le texte fixe (libellés
//     réservés au moteur, caractères invisibles) ;
//   - SORTIE (chaque rendu) : le HTML produit, re-validé AVANT d'être assemblé —
//     défense en profondeur : même si une règle du contrôle source avait un
//     trou, rien d'inattendu n'atteint Chromium.
//
// Liste BLANCHE de balises et d'attributs ; imbrication strictement équilibrée
// (chaque balise ouverte est fermée explicitement, dans l'ordre) : la sortie ne
// peut pas refermer le conteneur `<main class="lx-modele">` du moteur.

import { positionOf, type IssueList } from './report.js';

export const ALLOWED_TAGS = new Set([
  'div',
  'span',
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  'sup',
  'sub',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'img',
  'section',
  'header',
  'footer',
  'article',
  'aside',
  'figure',
  'figcaption',
  'address',
  'blockquote',
]);

const VOID = new Set(['br', 'hr', 'img', 'col']);

const ATTRS_ALL = new Set(['class']);
const ATTRS_BY_TAG: Record<string, ReadonlySet<string>> = {
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
};

const ENTITY = /^&(?:amp|lt|gt|quot|apos|nbsp|#39|#160);/;

/** Mot entier, frontières Unicode (« Détester » ne contient pas le mot « test »). */
const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'iu');

/**
 * Texte réservé au moteur (ADR-0029 § 4) : un gabarit ne peut pas contrefaire
 * un cadre DGI, un bandeau de test ou un DUPLICATA dans son texte fixe.
 */
const RESERVED: ReadonlyArray<[RegExp, string]> = [
  [/éléments\s+de\s+sécurité/iu, 'Éléments de sécurité DGI'],
  [word('code\\s+def'), 'Code DEF/DGI'],
  [word('def\\s+(?:nim|compteurs|heure)'), 'DEF NIM / DEF Compteurs / DEF Heure'],
  [word('isf'), 'ISF'],
  [word('duplicata'), 'DUPLICATA'],
  [word('test'), 'TEST'],
  [word('exemple'), 'EXEMPLE'],
  [/environnement\s+de\s+test/iu, 'Environnement de test'],
  [/sans\s+valeur\s+fiscale/iu, 'sans valeur fiscale'],
];

/** Caractère de contrôle (hors tabulation et sauts de ligne) ou de format invisible (Cf). */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/u;

export interface HtmlCheckOptions {
  mode: 'source' | 'output';
  file: string;
  /** Source d'origine (mode source) : texte des balises Mustache masquées. */
  original?: string;
  /** Images déclarées du paquet (`images/…`). */
  images: ReadonlySet<string>;
  /** `src` admis en plus des images : balises Mustache (source) ou jetons de logo (sortie). */
  allowedSrc: (value: string) => boolean;
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Masque `{{…}}` par des U+0001 de même longueur (positions conservées). */
export function maskMustache(src: string): string {
  return src.replace(/\{\{[\s\S]*?\}\}\}?/g, (m) => '\u0001'.repeat(m.length));
}

/**
 * Valide un fragment HTML. Renvoie `true` s'il est admis ; les problèmes vont
 * dans `issues` (mode source) — en mode sortie, la première erreur suffit.
 */
export function checkHtml(html: string, opts: HtmlCheckOptions, issues: IssueList): boolean {
  let ok = true;
  const src = opts.original ?? html;
  const fail = (code: string, message: string, index: number) => {
    ok = false;
    issues.error({ code, message, file: opts.file, ...positionOf(src, index) });
  };
  const checkText = (text: string, index: number) => {
    if (opts.mode !== 'source') return;
    // Sur le texte D'ORIGINE : le masquage des balises Mustache utilise U+0001.
    const m = INVISIBLE.exec(src.slice(index, index + text.length));
    if (m) {
      fail(
        'TEMPLATE_INVISIBLE_CHAR',
        `Caractère invisible ou de contrôle (U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}) interdit.`,
        index + m.index,
      );
    }
    const plain = decode(text.replace(/\u0001+/g, ' '));
    joined.push(decode(text.replace(/\u0001+/g, '')));
    for (const [re, label] of RESERVED) {
      if (re.test(plain)) {
        fail(
          'TEMPLATE_RESERVED_TEXT',
          `Le texte « ${label} » est réservé à la zone DGI posée par le moteur : un gabarit ne l’écrit pas.`,
          index,
        );
      }
    }
  };
  const checkEntities = (text: string, index: number) => {
    let at = text.indexOf('&');
    while (at !== -1) {
      if (!ENTITY.test(text.slice(at))) {
        fail(
          'TEMPLATE_BAD_ENTITY',
          'Entité HTML non admise : seules &amp; &lt; &gt; &quot; &apos; &nbsp; le sont (écrivez les accents directement en UTF-8).',
          index + at,
        );
        return;
      }
      at = text.indexOf('&', at + 1);
    }
  };

  // Texte fixe mis bout à bout : « DUPLI<b>CATA</b> » ne contourne pas la règle.
  const joined: string[] = [];
  const stack: Array<{ tag: string; index: number }> = [];
  let i = 0;
  while (i < html.length && (ok || opts.mode === 'source')) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? html.length : lt;
    if (textEnd > i) {
      const text = html.slice(i, textEnd);
      checkEntities(text, i);
      checkText(text, i);
    }
    if (lt === -1) break;
    i = lt;
    if (html.startsWith('<!--', i)) {
      fail('TEMPLATE_HTML_COMMENT', 'Commentaire HTML interdit : utilisez « {{! … }} ».', i);
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const close = /^<\/([a-z][a-z0-9]*)\s*>/.exec(html.slice(i, i + 40));
    if (close) {
      const tag = close[1]!;
      const top = stack.pop();
      if (!top || top.tag !== tag) {
        fail(
          'TEMPLATE_HTML_UNBALANCED',
          top
            ? `« </${tag}> » ferme « <${top.tag}> » : chaque balise se ferme dans l’ordre.`
            : `« </${tag}> » sans balise ouverte.`,
          i,
        );
        if (top) stack.push(top);
      }
      i += close[0].length;
      continue;
    }
    const open = /^<([a-z][a-z0-9]*)/.exec(html.slice(i, i + 40));
    if (!open) {
      fail(
        'TEMPLATE_HTML_SYNTAX',
        'Balise illisible : « < » doit ouvrir une balise en minuscules (écrivez &lt; pour le caractère).',
        i,
      );
      i += 1;
      continue;
    }
    const tag = open[1]!;
    const tagStart = i;
    i += open[0].length;
    if (!ALLOWED_TAGS.has(tag)) {
      fail(
        'TEMPLATE_TAG_FORBIDDEN',
        `Balise <${tag}> interdite (admises : ${[...ALLOWED_TAGS].join(', ')}).`,
        tagStart,
      );
    }
    const allowed = ATTRS_BY_TAG[tag];
    const seen = new Set<string>();
    let selfClosed = false;
    // Attributs : ` nom="valeur"` uniquement (guillemets doubles).
    for (;;) {
      const ws = /^\s*/.exec(html.slice(i))![0];
      i += ws.length;
      if (html.startsWith('/>', i)) {
        selfClosed = true;
        i += 2;
        break;
      }
      if (html[i] === '>') {
        i += 1;
        break;
      }
      const attr = /^([a-z][a-z0-9-]*)="([^"<>]*)"/.exec(html.slice(i));
      if (!attr || ws.length === 0) {
        fail(
          'TEMPLATE_HTML_SYNTAX',
          `Attribut illisible dans <${tag}> : écrivez nom="valeur" (guillemets doubles), séparés par des espaces.`,
          i,
        );
        const end = html.indexOf('>', i);
        i = end === -1 ? html.length : end + 1;
        break;
      }
      const name = attr[1]!;
      const valueIndex = i + name.length + 2;
      const value = attr[2]!;
      i += attr[0].length;
      if (seen.has(name))
        fail('TEMPLATE_HTML_SYNTAX', `Attribut « ${name} » en double.`, valueIndex);
      seen.add(name);
      if (!ATTRS_ALL.has(name) && !allowed?.has(name)) {
        fail(
          'TEMPLATE_ATTRIBUTE_FORBIDDEN',
          name === 'style'
            ? 'Attribut « style » interdit : le style s’écrit dans style.css.'
            : name.startsWith('on')
              ? 'Gestionnaire d’événement interdit (aucun script).'
              : `Attribut « ${name} » interdit sur <${tag}>.`,
          valueIndex,
        );
        continue;
      }
      checkEntities(value, valueIndex);
      if (name === 'class') {
        for (const cls of value.split(/\s+/).filter(Boolean)) {
          if (cls.startsWith('lx-')) {
            fail(
              'TEMPLATE_RESERVED_CLASS',
              `Classe « ${cls} » : le préfixe « lx- » est réservé au moteur.`,
              valueIndex,
            );
          } else if (!/^[A-Za-z0-9_\u0001-]+$/.test(cls)) {
            fail('TEMPLATE_HTML_SYNTAX', `Nom de classe invalide « ${cls} ».`, valueIndex);
          }
        }
      } else if (name === 'alt') {
        checkText(value, valueIndex);
      } else if (name === 'src') {
        const raw = opts.original
          ? opts.original.slice(valueIndex, valueIndex + value.length)
          : value;
        if (!opts.images.has(raw) && !opts.allowedSrc(raw)) {
          fail(
            'TEMPLATE_BAD_SRC',
            opts.mode === 'source'
              ? `« src » doit être une image du paquet (images/…) ou exactement {{brand.logo}} / {{brand.logos.primary|horizontal|symbol|light}} (reçu : « ${raw.slice(0, 60)} »).`
              : 'Source d’image inattendue dans la sortie du gabarit.',
            valueIndex,
          );
        }
      } else if (!/^\d{1,4}$/.test(value)) {
        fail('TEMPLATE_HTML_SYNTAX', `« ${name} » attend un nombre entier.`, valueIndex);
      }
    }
    if (VOID.has(tag)) continue;
    if (selfClosed) {
      fail(
        'TEMPLATE_HTML_SYNTAX',
        `<${tag} /> ne se ferme pas ainsi : écrivez <${tag}></${tag}>.`,
        tagStart,
      );
      continue;
    }
    stack.push({ tag, index: tagStart });
  }
  for (const s of stack) {
    fail('TEMPLATE_HTML_UNBALANCED', `<${s.tag}> jamais fermée.`, s.index);
  }
  if (opts.mode === 'source') {
    const all = joined.join('');
    for (const [re, label] of RESERVED) {
      if (re.test(all) && !joined.some((t) => re.test(t))) {
        fail(
          'TEMPLATE_RESERVED_TEXT',
          `Le texte « ${label} » est réservé à la zone DGI posée par le moteur, même découpé par des balises.`,
          0,
        );
      }
    }
  }
  return ok;
}
