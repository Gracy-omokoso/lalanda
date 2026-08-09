// Analyse du texte enrichi du centre d'aide (S22d).
//
// La syntaxe est délibérément minuscule : `**gras**` et `[libellé](cible)`.
// Elle n'est pas destinée à grandir. Deux raisons de l'analyser ici plutôt que
// de l'interpréter dans le composant de rendu :
//
//  1. Le rendu React n'est pas testable dans ce paquet (vitest tourne en
//     environnement `node`, cf. `apps/web/vitest.config.ts`). Un analyseur pur
//     l'est, et c'est lui qui porte la logique risquée.
//  2. `liens.test.ts` doit énumérer TOUS les liens du contenu pour vérifier
//     qu'aucun ne pointe vers un article ou une ancre inexistants. Il lui faut
//     la même lecture du texte que le rendu — sinon le test validerait une
//     syntaxe que l'affichage interprète autrement.

/** Fragment de texte enrichi, prêt à rendre. */
export type Segment =
  | { readonly type: 'texte'; readonly texte: string }
  | { readonly type: 'gras'; readonly texte: string }
  | { readonly type: 'lien'; readonly texte: string; readonly href: string };

// Un lien `[libellé](cible)` ou un passage `**gras**`. Le libellé d'un lien
// n'admet pas de `]`, la cible pas de `)` : suffisant pour du contenu rédigé,
// et sans ambiguïté d'analyse.
const MOTIF = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;

/**
 * Découpe un texte enrichi en segments.
 *
 * Tout ce qui n'est pas reconnu reste du texte littéral : un `*` isolé ou un
 * crochet non apparié s'affiche tel quel plutôt que de faire disparaître la
 * phrase. Dans un centre d'aide, une coquille visible vaut mieux qu'un texte
 * silencieusement tronqué.
 */
export function analyserTexte(texte: string): Segment[] {
  const segments: Segment[] = [];
  let curseur = 0;

  for (const found of texte.matchAll(MOTIF)) {
    const index = found.index;
    if (index > curseur) {
      segments.push({ type: 'texte', texte: texte.slice(curseur, index) });
    }

    const [brut, libelleLien, cible, gras] = found;
    if (gras !== undefined) {
      segments.push({ type: 'gras', texte: gras });
    } else if (libelleLien !== undefined && cible !== undefined) {
      segments.push({ type: 'lien', texte: libelleLien, href: cible });
    }

    curseur = index + brut.length;
  }

  if (curseur < texte.length) {
    segments.push({ type: 'texte', texte: texte.slice(curseur) });
  }

  return segments;
}

/** Toutes les cibles de lien d'un texte enrichi, dans l'ordre d'apparition. */
export function extraireLiens(texte: string): string[] {
  return analyserTexte(texte)
    .filter((s): s is Extract<Segment, { type: 'lien' }> => s.type === 'lien')
    .map((s) => s.href);
}

/**
 * Texte nu, balises retirées — pour l'index de recherche et les meta.
 *
 * Le libellé d'un lien est conservé (c'est du texte que l'utilisateur lit et
 * peut chercher) ; la cible est retirée (une URL n'est pas du contenu).
 */
export function texteNu(texte: string): string {
  return analyserTexte(texte)
    .map((s) => s.texte)
    .join('');
}
