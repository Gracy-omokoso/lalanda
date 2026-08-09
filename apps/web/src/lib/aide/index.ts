// Registre du centre d'aide (S22d).
//
// Point d'entrée unique : les pages, la recherche et les liens contextuels de
// l'application passent tous par ici. Un article qui n'est pas dans `ARTICLES`
// n'existe pas — il n'a ni page, ni entrée d'index, ni test.

import { DEMARRER } from './articles/demarrer';
import { COMPRENDRE_LES_CHIFFRES } from './articles/comprendre-les-chiffres';
import { RATIOS_BANCAIRES } from './articles/ratios-bancaires';
import { VALIDER_ET_EXPORTER } from './articles/valider-et-exporter';
import { SUIVRE_SON_ACTIVITE } from './articles/suivre-son-activite';
import { TRAVAILLER_A_PLUSIEURS } from './articles/travailler-a-plusieurs';
import { GLOSSAIRE } from './articles/glossaire';
import type { ArticleAide } from './types';

/** Tous les articles, dans l'ordre du sommaire. */
export const ARTICLES: readonly ArticleAide[] = [
  DEMARRER,
  COMPRENDRE_LES_CHIFFRES,
  RATIOS_BANCAIRES,
  VALIDER_ET_EXPORTER,
  SUIVRE_SON_ACTIVITE,
  TRAVAILLER_A_PLUSIEURS,
  GLOSSAIRE,
].sort((a, b) => a.ordre - b.ordre);

export function articleParSlug(slug: string): ArticleAide | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

// Les cibles d'aide citées depuis l'application vivent dans `./liens` — un
// module sans dépendance, pour que les composants client qui s'en servent
// n'embarquent pas tout le contenu d'aide dans le bundle du navigateur.
// Réexportées ici pour que le registre reste le point d'entrée unique.
export { LIENS_AIDE, lienAidePourFeuille } from './liens';

export type { ArticleAide, Bloc, EntreeGlossaire, SectionAide, TonNote } from './types';
