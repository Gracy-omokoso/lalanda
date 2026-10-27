// Sous-ensemble strict de Mustache, interprété — ADR-0029 O1.
//
// Pourquoi un interprète maison : un gabarit de tiers est du contenu NON FIABLE.
// Ce moteur ne génère AUCUN code (pas de `new Function`, pas d'`eval`), ne
// connaît ni helpers, ni filtres, ni partiels, ni HTML brut, et ne lit que les
// propriétés PROPRES de données qu'il a construites lui-même (aucune chaîne de
// prototypes : `{{constructor}}` ou `{{__proto__}}` sont des variables
// inconnues). Chaque variable est vérifiée contre le contrat typé AVANT
// installation (`checkTemplate`), et le rendu est borné en taille.
//
// Syntaxe admise (celle de Mustache) :
//   {{a.b}}            texte, TOUJOURS échappé (le même `esc` que le vérificateur DGI)
//   {{#a}}…{{/a}}      liste : répétée ; objet ou texte non vide : contexte ; booléen : condition
//   {{^a}}…{{/a}}      section inverse (absent, faux, liste vide)
//   {{.}}              élément courant (liste de textes, texte en contexte)
//   {{! commentaire }}

import { esc } from '../../invoice-document-html.js';
import type { DataValue, FieldType } from './data-contract.js';
import { positionOf, type IssueList } from './report.js';

export const MAX_SECTION_DEPTH = 8;
export const MAX_OUTPUT_CHARS = 1_500_000;

export type MustacheNode =
  | { t: 'text'; value: string; start: number }
  | { t: 'var'; name: string; start: number }
  | { t: 'section'; name: string; inverted: boolean; children: MustacheNode[]; start: number };

const NAME = /^(\.|[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)$/;

export class MustacheRenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MustacheRenderError';
  }
}

/** Analyse. Les erreurs vont dans `issues` ; renvoie `null` si l'arbre est inutilisable. */
export function parseTemplate(src: string, file: string, issues: IssueList): MustacheNode[] | null {
  const at = (index: number) => ({ file, ...positionOf(src, index) });
  const root: MustacheNode[] = [];
  const stack: Array<{ name: string; children: MustacheNode[]; start: number }> = [];
  let current = root;
  let i = 0;
  let ok = true;
  const fail = (code: string, message: string, index: number) => {
    ok = false;
    issues.error({ code, message, ...at(index) });
  };
  while (i < src.length) {
    const open = src.indexOf('{{', i);
    if (open === -1) {
      current.push({ t: 'text', value: src.slice(i), start: i });
      break;
    }
    if (open > i) current.push({ t: 'text', value: src.slice(i, open), start: i });
    const close = src.indexOf('}}', open + 2);
    if (close === -1) {
      fail('MUSTACHE_UNCLOSED_TAG', 'Balise « {{ » sans « }} » fermant.', open);
      break;
    }
    const inner = src.slice(open + 2, close);
    i = close + 2;
    const sigil = inner[0] ?? '';
    if (sigil === '!') continue;
    if (sigil === '{' || sigil === '&') {
      // `{{{x}}}` laisse un « } » derrière : on le consomme pour un seul message.
      if (sigil === '{' && src[i] === '}') i += 1;
      fail(
        'MUSTACHE_RAW_FORBIDDEN',
        'HTML brut interdit (« {{{ … }}} », « {{& … }} ») : toute valeur est échappée.',
        open,
      );
      continue;
    }
    if (sigil === '>' || sigil === '<' || sigil === '$' || sigil === '=') {
      fail(
        'MUSTACHE_TAG_FORBIDDEN',
        'Partiels, blocs et changement de délimiteurs interdits (« {{> }} », « {{< }} », « {{$ }} », « {{= =}} »).',
        open,
      );
      continue;
    }
    const kind = sigil === '#' || sigil === '^' || sigil === '/' ? sigil : '';
    const name = inner.slice(kind.length).trim();
    if (!NAME.test(name)) {
      fail(
        'MUSTACHE_BAD_NAME',
        `Nom de variable invalide « ${name.slice(0, 40)} » (lettres et chiffres, séparés par des points).`,
        open,
      );
      continue;
    }
    if (kind === '#' || kind === '^') {
      if (stack.length >= MAX_SECTION_DEPTH) {
        fail('MUSTACHE_TOO_DEEP', `Au plus ${MAX_SECTION_DEPTH} sections imbriquées.`, open);
        continue;
      }
      const node: MustacheNode = {
        t: 'section',
        name,
        inverted: kind === '^',
        children: [],
        start: open,
      };
      current.push(node);
      stack.push({ name, children: current, start: open });
      current = node.children;
    } else if (kind === '/') {
      const top = stack.pop();
      if (!top || top.name !== name) {
        fail(
          'MUSTACHE_UNBALANCED',
          top
            ? `« {{/${name}}} » ferme « {{#${top.name}}} » ouverte plus haut.`
            : `« {{/${name}}} » sans section ouverte.`,
          open,
        );
        if (top) stack.push(top);
        continue;
      }
      current = top.children;
    } else {
      current.push({ t: 'var', name, start: open });
    }
  }
  for (const s of stack) {
    fail('MUSTACHE_UNBALANCED', `Section « {{#${s.name}}} » jamais fermée.`, s.start);
  }
  return ok ? root : null;
}

// ── Contrôle statique contre le contrat ──────────────────────────────────────

type Frame = FieldType;

function lookupType(name: string, stack: readonly Frame[]): FieldType | null {
  // `{{.}}` à la racine n'a pas d'élément courant.
  if (name === '.') return stack.length > 1 ? stack[stack.length - 1]! : null;
  const [first, ...rest] = name.split('.');
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const f = stack[i]!;
    if (f.kind !== 'object' || !Object.hasOwn(f.fields, first!)) continue;
    let t: FieldType = f.fields[first!]!;
    for (const seg of rest) {
      if (t.kind !== 'object' || !Object.hasOwn(t.fields, seg)) return null;
      t = t.fields[seg]!;
    }
    return t;
  }
  return null;
}

/** Vérifie chaque variable et section contre le schéma (contrat de données). */
export function checkTemplate(
  nodes: readonly MustacheNode[],
  schema: FieldType,
  src: string,
  file: string,
  issues: IssueList,
): void {
  const at = (index: number) => ({ file, ...positionOf(src, index) });
  const walk = (list: readonly MustacheNode[], stack: Frame[]) => {
    for (const n of list) {
      if (n.t === 'text') continue;
      const type = lookupType(n.name, stack);
      if (type === null) {
        issues.error({
          code: 'TEMPLATE_UNKNOWN_VARIABLE',
          message:
            n.name === '.'
              ? '« {{.}} » hors d’une section : il n’y a pas d’élément courant.'
              : `Variable inconnue « ${n.name} » (voir la liste des variables du guide).`,
          ...at(n.start),
        });
        continue;
      }
      if (n.t === 'var') {
        if (type.kind !== 'text') {
          issues.error({
            code: 'TEMPLATE_NOT_TEXT',
            message: `« {{${n.name}}} » n’est pas un texte (${type.kind === 'list' ? 'liste' : type.kind === 'bool' ? 'booléen' : 'objet'}) : utilisez une section « {{#${n.name}}} … {{/${n.name}}} ».`,
            ...at(n.start),
          });
        }
        continue;
      }
      if (n.inverted || type.kind === 'bool') {
        walk(n.children, stack);
      } else if (type.kind === 'list') {
        walk(n.children, [...stack, type.item]);
      } else {
        walk(n.children, [...stack, type]);
      }
    }
  };
  walk(nodes, [schema]);
}

// ── Rendu ────────────────────────────────────────────────────────────────────

const isRecord = (v: DataValue | undefined): v is { [k: string]: DataValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function lookup(name: string, stack: readonly DataValue[]): DataValue | undefined {
  if (name === '.') return stack[stack.length - 1];
  const [first, ...rest] = name.split('.');
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const f = stack[i];
    if (!isRecord(f) || !Object.hasOwn(f, first!)) continue;
    let v: DataValue | undefined = f[first!];
    for (const seg of rest) {
      if (!isRecord(v) || !Object.hasOwn(v, seg)) return undefined;
      v = v[seg];
    }
    return v;
  }
  return undefined;
}

const truthy = (v: DataValue | undefined): boolean =>
  !(
    v === undefined ||
    v === null ||
    v === false ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );

/** Rendu, borné à `maxChars` (la sortie est vérifiée PENDANT le rendu). */
export function renderTemplate(
  nodes: readonly MustacheNode[],
  data: DataValue,
  maxChars = MAX_OUTPUT_CHARS,
): string {
  const out: string[] = [];
  let size = 0;
  const emit = (s: string) => {
    size += s.length;
    if (size > maxChars) {
      throw new MustacheRenderError(
        'TEMPLATE_OUTPUT_TOO_LARGE',
        `Le gabarit produit plus de ${maxChars} caractères.`,
      );
    }
    out.push(s);
  };
  const walk = (list: readonly MustacheNode[], stack: DataValue[]) => {
    for (const n of list) {
      if (n.t === 'text') {
        emit(n.value);
        continue;
      }
      const v = lookup(n.name, stack);
      if (n.t === 'var') {
        // Seul un texte s'imprime (le contrôle statique l'a garanti) ; le reste : rien.
        if (typeof v === 'string') emit(esc(v));
        continue;
      }
      if (n.inverted) {
        if (!truthy(v)) walk(n.children, stack);
      } else if (Array.isArray(v)) {
        for (const item of v) walk(n.children, [...stack, item]);
      } else if (truthy(v)) {
        walk(n.children, typeof v === 'boolean' ? stack : [...stack, v!]);
      }
    }
  };
  walk(nodes, [data]);
  return out.join('');
}
