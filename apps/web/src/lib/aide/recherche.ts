// Recherche du centre d'aide (S22d).
//
// Index dérivé du contenu, pas maintenu à côté : une section qui existe est
// forcément indexée. L'inverse — une liste d'articles tenue à la main — laisse
// des pages introuvables sans que rien ne le signale.
//
// Pas de dépendance de recherche floue : le corpus fait quelques dizaines de
// sections, un filtrage par sous-chaîne normalisée est instantané et se raisonne.
// Ce qui compte davantage ici, c'est la normalisation des accents : un
// utilisateur qui tape « tresorerie » doit trouver « trésorerie ».

import type { ArticleAide, Bloc } from './types';
import { texteNu } from './texte';

/** Une section indexée, adressable par son ancre. */
export interface EntreeIndex {
  readonly slugArticle: string;
  readonly titreArticle: string;
  readonly idSection: string;
  readonly titreSection: string;
  /** Texte nu de la section, normalisé, pour la comparaison. */
  readonly corpusNormalise: string;
  /** Extrait lisible affiché dans les résultats. */
  readonly extrait: string;
}

/**
 * Minuscules, sans accents, espaces réduits.
 *
 * `NFD` sépare la lettre de son accent, la plage `̀-ͯ` retire les
 * diacritiques : « Trésorerie » et « tresorerie » se comparent alors à égalité.
 */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Texte nu d'un bloc, quel que soit son type. */
function texteDuBloc(bloc: Bloc): string {
  switch (bloc.type) {
    case 'paragraphe':
      return texteNu(bloc.texte);
    case 'liste':
      return bloc.items.map(texteNu).join(' ');
    case 'etapes':
      return bloc.items.map((i) => `${i.titre} ${texteNu(i.texte)}`).join(' ');
    case 'note':
      return `${bloc.titre} ${texteNu(bloc.texte)}`;
    case 'tableau':
      return [
        bloc.entetes.join(' '),
        ...bloc.lignes.map((l) => l.map(texteNu).join(' ')),
        bloc.legende ? texteNu(bloc.legende) : '',
      ].join(' ');
    case 'exemple':
      return [
        bloc.titre,
        ...bloc.lignes.map((l) => `${l.libelle} ${l.valeur}`),
        bloc.conclusion ? texteNu(bloc.conclusion) : '',
      ].join(' ');
    case 'glossaire':
      return bloc.entrees.map((e) => `${e.terme} ${texteNu(e.definition)}`).join(' ');
  }
}

/** Construit l'index plat : une entrée par section de chaque article. */
export function construireIndex(articles: readonly ArticleAide[]): EntreeIndex[] {
  return articles.flatMap((article) =>
    article.sections.map((section) => {
      const corps = section.blocs.map(texteDuBloc).join(' ').replace(/\s+/gu, ' ').trim();
      return {
        slugArticle: article.slug,
        titreArticle: article.titre,
        idSection: section.id,
        titreSection: section.titre,
        corpusNormalise: normaliser(`${article.titre} ${section.titre} ${corps}`),
        extrait: corps.length > 180 ? `${corps.slice(0, 180).trimEnd()}…` : corps,
      };
    }),
  );
}

export interface ResultatRecherche extends EntreeIndex {
  readonly href: string;
}

/**
 * Cherche les sections correspondant à la requête.
 *
 * Tous les mots de la requête doivent être présents (ET, pas OU) : sur un
 * corpus court, le OU ramène presque tout et n'aide personne. Le classement
 * privilégie les correspondances de titre, qui sont les plus pertinentes.
 */
export function rechercher(
  index: readonly EntreeIndex[],
  requete: string,
  limite = 12,
): ResultatRecherche[] {
  const mots = normaliser(requete).split(' ').filter(Boolean);
  if (mots.length === 0) return [];

  return index
    .filter((entree) => mots.every((mot) => entree.corpusNormalise.includes(mot)))
    .map((entree) => {
      const titre = normaliser(`${entree.titreArticle} ${entree.titreSection}`);
      const dansLeTitre = mots.filter((mot) => titre.includes(mot)).length;
      return { entree, score: dansLeTitre };
    })
    .sort((a, b) => b.score - a.score || a.entree.titreSection.localeCompare(b.entree.titreSection))
    .slice(0, limite)
    .map(({ entree }) => ({
      ...entree,
      href: `/aide/${entree.slugArticle}#${entree.idSection}`,
    }));
}
