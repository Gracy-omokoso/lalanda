// Modèle de contenu du centre d'aide (S22d).
//
// Pourquoi de la DONNÉE et pas du JSX ? Trois raisons concrètes :
//
//  1. `apps/web` n'a aucun environnement DOM (vitest tourne en `node`, cf.
//     `apps/web/vitest.config.ts`). Un contenu écrit en JSX serait intestable.
//     Écrit en données, il est vérifiable : liens internes, ancres, unicité des
//     slugs — voir `liens.test.ts`.
//  2. La recherche a besoin d'un index plat du texte. Le dériver du contenu
//     interdit qu'une page existe sans être trouvable.
//  3. L'application (onglets de résultats, bandeau de ratios) pointe vers des
//     ancres précises de ces articles. Un renommage d'ancre doit casser un test,
//     pas silencieusement produire un lien mort.
//
// Règle éditoriale non négociable (docs/CLAUDE.md, « ne pas inventer ») : toute
// affirmation de ce contenu décrit le produit TEL QU'IL EST. Une fonctionnalité
// absente ou partielle est nommée comme telle. Les limites documentées sont
// recensées dans `docs/27-CENTRE-AIDE.md` avec la condition qui les lèvera.

/**
 * Texte enrichi minimal.
 *
 * Seule syntaxe reconnue : `[libellé](/aide/article#ancre)` pour un lien, et
 * `**gras**`. Volontairement pauvre — le contenu n'a pas besoin de plus, et un
 * sous-ensemble fermé se teste (`liens.test.ts` extrait tous les liens et vérifie
 * leur cible).
 */
export type TexteRiche = string;

/** Ton d'un encadré. `limite` sert exclusivement à dire ce que le produit NE fait PAS. */
export type TonNote = 'info' | 'limite' | 'attention';

/** Une entrée de glossaire, avec son statut vis-à-vis du produit réel. */
export interface EntreeGlossaire {
  readonly terme: string;
  readonly definition: TexteRiche;
  /**
   * `calcule`      — le moteur produit ce chiffre et l'interface l'affiche.
   * `concept`      — notion utile à la lecture, sans ligne dédiée dans le produit.
   * `non_calcule`  — terme présent dans `docs/GLOSSAIRE.md` mais QUE LE PRODUIT NE
   *                  CALCULE PAS aujourd'hui. Affiché comme tel, jamais promis.
   */
  readonly statut: 'calcule' | 'concept' | 'non_calcule';
  /** Où le voir dans le produit, ou quel article l'explique. */
  readonly ou?: TexteRiche;
}

export type Bloc =
  | { readonly type: 'paragraphe'; readonly texte: TexteRiche }
  | { readonly type: 'liste'; readonly items: readonly TexteRiche[]; readonly ordonnee?: boolean }
  | {
      readonly type: 'etapes';
      readonly items: readonly { readonly titre: string; readonly texte: TexteRiche }[];
    }
  | {
      readonly type: 'note';
      readonly ton: TonNote;
      readonly titre: string;
      readonly texte: TexteRiche;
    }
  | {
      readonly type: 'tableau';
      readonly entetes: readonly string[];
      readonly lignes: readonly (readonly TexteRiche[])[];
      readonly legende?: TexteRiche;
    }
  | {
      /** Exemple chiffré — toujours une devise explicite (docs/03 § Principes UX). */
      readonly type: 'exemple';
      readonly titre: string;
      readonly lignes: readonly { readonly libelle: string; readonly valeur: string }[];
      readonly conclusion?: TexteRiche;
    }
  | { readonly type: 'glossaire'; readonly entrees: readonly EntreeGlossaire[] };

/** Une section d'article. `id` est l'ancre : elle est publique et citée depuis l'app. */
export interface SectionAide {
  readonly id: string;
  readonly titre: string;
  readonly blocs: readonly Bloc[];
}

export interface ArticleAide {
  readonly slug: string;
  readonly titre: string;
  /** Une phrase : sert de meta description, de sous-titre et de carte sur `/aide`. */
  readonly resume: string;
  /** Position dans le sommaire du centre d'aide. */
  readonly ordre: number;
  readonly sections: readonly SectionAide[];
}
