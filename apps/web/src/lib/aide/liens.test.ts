// Intégrité du centre d'aide (S22d).
//
// Ces tests existent pour une raison précise : le contenu d'aide renvoie vers
// des ancres (`/aide/ratios-bancaires#dscr`) citées AUSSI depuis l'application —
// onglets de résultats, bandeau de ratios. Renommer une section est un geste
// anodin qui casse silencieusement ces liens : rien ne plante, l'utilisateur
// atterrit simplement en haut d'une page qui ne répond pas à sa question.
//
// Le test rend ce geste bruyant.

import { describe, expect, it } from 'vitest';

import { ARTICLES, LIENS_AIDE, articleParSlug } from './index';
import { construireIndex, normaliser, rechercher } from './recherche';
import { analyserTexte, extraireLiens, texteNu } from './texte';
import type { ArticleAide, Bloc } from './types';

/** Tous les textes enrichis d'un bloc, quel que soit son type. */
function textesDuBloc(bloc: Bloc): string[] {
  switch (bloc.type) {
    case 'paragraphe':
      return [bloc.texte];
    case 'liste':
      return [...bloc.items];
    case 'etapes':
      return bloc.items.map((i) => i.texte);
    case 'note':
      return [bloc.texte];
    case 'tableau':
      return [...bloc.lignes.flat(), ...(bloc.legende ? [bloc.legende] : [])];
    case 'exemple':
      return bloc.conclusion ? [bloc.conclusion] : [];
    case 'glossaire':
      return bloc.entrees.flatMap((e) => (e.ou ? [e.definition, e.ou] : [e.definition]));
  }
}

/** Chaque lien du corpus, avec sa provenance — pour un message d'échec exploitable. */
function tousLesLiens(): { href: string; provenance: string }[] {
  return ARTICLES.flatMap((article) =>
    article.sections.flatMap((section) =>
      section.blocs
        .flatMap(textesDuBloc)
        .flatMap(extraireLiens)
        .map((href) => ({ href, provenance: `${article.slug}#${section.id}` })),
    ),
  );
}

/**
 * Le couple (article, ancre) désigné par un lien interne d'aide, s'il en est un.
 *
 * `slug` est absent pour `/aide`, le sommaire du centre : c'est une cible
 * légitime qui ne correspond à aucun article, et qui n'a donc pas d'ancre à
 * vérifier.
 */
function cibleAide(href: string): { slug?: string; ancre?: string } | null {
  const found = /^\/aide(?:\/([a-z0-9-]+))?(?:#([a-z0-9-]+))?$/u.exec(href);
  if (!found) return null;
  return { slug: found[1], ancre: found[2] };
}

describe('intégrité des liens du centre d’aide (S22d)', () => {
  it('ne cite aucun article inexistant', () => {
    const morts = tousLesLiens()
      .map((lien) => ({ ...lien, cible: cibleAide(lien.href) }))
      .filter(
        ({ cible }) =>
          cible !== null && cible.slug !== undefined && articleParSlug(cible.slug) === undefined,
      )
      .map(({ href, provenance }) => `${provenance} → ${href}`);

    expect(morts, `Articles d’aide inexistants cités :\n${morts.join('\n')}`).toEqual([]);
  });

  it('ne cite aucune ancre inexistante', () => {
    const morts = tousLesLiens()
      .map((lien) => ({ ...lien, cible: cibleAide(lien.href) }))
      .filter(({ cible }) => {
        if (!cible?.ancre || cible.slug === undefined) return false;
        const article = articleParSlug(cible.slug);
        // Un article manquant est déjà signalé par le test précédent.
        if (!article) return false;
        return !article.sections.some((s) => s.id === cible.ancre);
      })
      .map(({ href, provenance }) => `${provenance} → ${href}`);

    expect(morts, `Ancres d’aide inexistantes citées :\n${morts.join('\n')}`).toEqual([]);
  });

  it('n’expose que des liens internes absolus', () => {
    // Un lien relatif se résoudrait différemment selon la page qui l'affiche ;
    // un lien externe dans le contenu d'aide mérite une décision explicite.
    const suspects = tousLesLiens()
      .filter(({ href }) => !href.startsWith('/'))
      .map(({ href, provenance }) => `${provenance} → ${href}`);

    expect(suspects, `Liens non absolus :\n${suspects.join('\n')}`).toEqual([]);
  });

  it('vérifie les ancres citées par l’application elle-même', () => {
    // `LIENS_AIDE` est la seule porte par laquelle l'application référence
    // l'aide (onglets de résultats, bandeau de ratios). Sans ce test, un
    // renommage d'ancre laisserait des liens contextuels muets.
    const morts = Object.entries(LIENS_AIDE)
      .map(([cle, href]) => ({ cle, href, cible: cibleAide(href) }))
      .filter(({ cible }) => {
        if (!cible) return true;
        // `/aide` — le sommaire : cible valide, rien à vérifier de plus.
        if (cible.slug === undefined) return cible.ancre !== undefined;
        const article = articleParSlug(cible.slug);
        if (!article) return true;
        return cible.ancre !== undefined && !article.sections.some((s) => s.id === cible.ancre);
      })
      .map(({ cle, href }) => `LIENS_AIDE.${cle} → ${href}`);

    expect(morts, `Liens contextuels cassés :\n${morts.join('\n')}`).toEqual([]);
  });
});

describe('structure du corpus d’aide (S22d)', () => {
  it('donne un slug unique à chaque article', () => {
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('donne un identifiant de section unique dans chaque article', () => {
    for (const article of ARTICLES) {
      const ids = article.sections.map((s) => s.id);
      expect(new Set(ids).size, `Ancres dupliquées dans « ${article.slug} »`).toBe(ids.length);
    }
  });

  it('n’emploie que des ancres utilisables en URL', () => {
    for (const article of ARTICLES) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/u);
      for (const section of article.sections) {
        expect(section.id, `${article.slug}#${section.id}`).toMatch(/^[a-z0-9-]+$/u);
      }
    }
  });

  it('trie les articles par ordre strictement croissant', () => {
    const ordres = ARTICLES.map((a) => a.ordre);
    expect(ordres).toEqual([...ordres].sort((a, b) => a - b));
    expect(new Set(ordres).size).toBe(ordres.length);
  });

  it('donne à chaque article un résumé et au moins une section', () => {
    for (const article of ARTICLES) {
      expect(article.resume.length, article.slug).toBeGreaterThan(20);
      expect(article.sections.length, article.slug).toBeGreaterThan(0);
      for (const section of article.sections) {
        expect(section.blocs.length, `${article.slug}#${section.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('analyse du texte enrichi (S22d)', () => {
  it('découpe gras, liens et texte littéral', () => {
    expect(
      analyserTexte('Le **DSCR** mesure — voir [les ratios](/aide/ratios-bancaires).'),
    ).toEqual([
      { type: 'texte', texte: 'Le ' },
      { type: 'gras', texte: 'DSCR' },
      { type: 'texte', texte: ' mesure — voir ' },
      { type: 'lien', texte: 'les ratios', href: '/aide/ratios-bancaires' },
      { type: 'texte', texte: '.' },
    ]);
  });

  it('laisse intacte une syntaxe incomplète plutôt que d’avaler le texte', () => {
    // Une coquille visible vaut mieux qu'une phrase silencieusement tronquée.
    expect(texteNu('Un taux de 5 * 3 et un [crochet non fermé')).toBe(
      'Un taux de 5 * 3 et un [crochet non fermé',
    );
  });

  it('conserve le libellé d’un lien dans le texte nu, mais pas sa cible', () => {
    const nu = texteNu('Voir [le glossaire](/aide/glossaire) pour le BFR.');
    expect(nu).toBe('Voir le glossaire pour le BFR.');
    expect(nu).not.toContain('/aide/glossaire');
  });
});

describe('recherche dans l’aide (S22d)', () => {
  const index = construireIndex(ARTICLES);

  it('indexe toutes les sections de tous les articles', () => {
    const total = ARTICLES.reduce((n, a) => n + a.sections.length, 0);
    expect(index).toHaveLength(total);
  });

  it('ignore les accents et la casse', () => {
    expect(normaliser('Trésorerie MINIMALE')).toBe('tresorerie minimale');
    // Une recherche sans accents doit ramener le contenu accentué.
    expect(rechercher(index, 'tresorerie').length).toBeGreaterThan(0);
  });

  it('trouve les termes bancaires que l’utilisateur vient chercher', () => {
    for (const terme of ['DSCR', 'apport', 'export', 'glossaire']) {
      expect(rechercher(index, terme).length, `« ${terme} » introuvable`).toBeGreaterThan(0);
    }
  });

  it('exige tous les mots de la requête', () => {
    expect(rechercher(index, 'dscr zzzzinexistant')).toEqual([]);
  });

  it('ne renvoie rien pour une requête vide', () => {
    expect(rechercher(index, '   ')).toEqual([]);
  });

  it('renvoie des liens qui pointent vers des ancres réelles', () => {
    for (const resultat of rechercher(index, 'plan')) {
      const cible = cibleAide(resultat.href);
      // Un résultat de recherche vise toujours une section précise, jamais le sommaire.
      expect(cible?.slug, resultat.href).toBeDefined();
      expect(cible?.ancre, resultat.href).toBeDefined();
      const article = articleParSlug(cible!.slug!) as ArticleAide;
      expect(article, resultat.href).toBeDefined();
      expect(
        article.sections.some((s) => s.id === cible!.ancre),
        resultat.href,
      ).toBe(true);
    }
  });
});
