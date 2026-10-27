import { describe, expect, it } from 'vitest';

import type { IdeaView } from '@/lib/idea-lab-api';

import {
  appliquerSuggestion,
  corpsExperience,
  corpsFiche,
  droitsIdees,
  experienceVide,
  ficheDepuisIdee,
  ficheVide,
  formatPct,
  ideeDepuisRecherche,
  libelleScore,
  lienNouveauProjet,
  normaliseDecimal,
  ongletIdees,
  origineAssistance,
  tonNiveau,
} from './idea-model';

describe('navigation', () => {
  it('onglet : Validation sur /idees/validation seulement', () => {
    expect(ongletIdees('/idees')).toBe('idees');
    expect(ongletIdees('/idees/validation')).toBe('validation');
    expect(ongletIdees('/idees/0123456789abcdef01234567/validation')).toBe('idees');
    expect(ongletIdees('/idees-recues')).toBeNull();
  });

  it('création de projet ouverte depuis une idée, identifiant vérifié', () => {
    const id = '0123456789abcdef01234567';
    expect(lienNouveauProjet(id)).toBe(`/projects?idee=${id}`);
    expect(ideeDepuisRecherche(`?idee=${id}`)).toBe(id);
    expect(ideeDepuisRecherche('?idee=../../x')).toBeNull();
    expect(ideeDepuisRecherche('')).toBeNull();
  });

  it('droits affichés depuis les actions serveur', () => {
    expect(droitsIdees(null)).toEqual({ modifier: false, reglerIa: false });
    expect(droitsIdees(['project.read'])).toEqual({ modifier: false, reglerIa: false });
    expect(droitsIdees(['canvas.update', 'organization.manage'])).toEqual({
      modifier: true,
      reglerIa: true,
    });
  });
});

describe('affichage', () => {
  it('score indisponible : jamais un zéro', () => {
    expect(
      libelleScore({
        disponible: false,
        raison: 'CRITERES_INSUFFISANTS',
        message: '',
        manquants: [],
      }),
    ).toBe('Indisponible');
    expect(
      libelleScore({ disponible: true, valeur: 69, niveau: 'a_consolider', libelleNiveau: '' }),
    ).toBe('69 / 100');
    expect(tonNiveau(null)).toBe('neutre');
    expect(tonNiveau('prometteuse')).toBe('ok');
  });

  it('pourcentages et décimaux à la française', () => {
    expect(formatPct(0.75)).toBe('75 %');
    expect(formatPct(0.5833)).toBe('58,3 %');
    expect(normaliseDecimal('1 200,5')).toBe('1200.5');
    expect(normaliseDecimal('douze')).toBeNull();
  });
});

describe('corpsFiche', () => {
  it('titre requis', () => {
    expect(corpsFiche(ficheVide())).toMatchObject({ ok: false });
  });

  it('taille de marché vide : aucune ; partielle sans source : refusée', () => {
    const f = { ...ficheVide(), title: 'Idée' };
    const vide = corpsFiche(f);
    expect(vide.ok && vide.body.marketSize).toBeNull();
    const sansSource = corpsFiche({
      ...f,
      marche: { ...f.marche, value: '1200', scope: 'commerçantes' },
    });
    expect(sansSource).toMatchObject({ ok: false });
    if (!sansSource.ok) expect(sansSource.erreur).toMatch(/source est obligatoire/);
  });

  it('taille de marché complète ; en montant, la devise est exigée', () => {
    const f = {
      ...ficheVide(),
      title: 'Idée',
      marche: {
        ...ficheVide().marche,
        value: '1 200',
        scope: 'commerçantes',
        source: 'Comptage au marché',
      },
    };
    const r = corpsFiche(f);
    expect(r.ok && r.body.marketSize).toMatchObject({
      value: '1200',
      unit: 'personnes',
      currency: null,
      source: 'Comptage au marché',
    });
    expect(corpsFiche({ ...f, marche: { ...f.marche, unit: 'montant' } })).toMatchObject({
      ok: false,
    });
  });

  it('aller-retour depuis une idée de l’API', () => {
    const idea = {
      title: 'T',
      problem: 'P',
      target: 'C',
      solution: 'S',
      revenueModel: 'R',
      country: 'CD',
      market: 'M',
      alternatives: [{ name: 'A', description: 'd', source: null }],
      hypotheses: [{ id: 'h1', text: 'H', status: 'a_tester' }],
      marketSize: null,
    } as unknown as IdeaView;
    const r = corpsFiche(ficheDepuisIdee(idea));
    expect(r).toEqual({
      ok: true,
      body: {
        title: 'T',
        problem: 'P',
        target: 'C',
        solution: 'S',
        revenueModel: 'R',
        country: 'CD',
        market: 'M',
        alternatives: [{ name: 'A', description: 'd', source: null }],
        hypotheses: [{ id: 'h1', text: 'H', status: 'a_tester' }],
        marketSize: null,
      },
    });
  });
});

describe('suggestions de l’IA', () => {
  it('s’appliquent au formulaire seulement, sans doublon', () => {
    const f = { ...ficheVide(), title: 'T', problem: 'ancien' };
    const r = appliquerSuggestion(f, {
      intent: 'reformuler',
      reformulation: { probleme: 'nouveau', cible: '', solution: 'sol' },
    });
    expect(r).toMatchObject({ problem: 'nouveau', target: '', solution: 'sol' });
    const h = appliquerSuggestion(f, {
      intent: 'hypotheses',
      hypotheses: [
        { texte: 'H1', test: 't' },
        { texte: 'H2', test: 't' },
      ],
    });
    expect(h.hypotheses.map((x) => [x.id, x.text, x.status])).toEqual([
      ['h1', 'H1', 'a_tester'],
      ['h2', 'H2', 'a_tester'],
    ]);
    const encore = appliquerSuggestion(h, {
      intent: 'hypotheses',
      hypotheses: [{ texte: 'H1', test: 't' }],
    });
    expect(encore.hypotheses).toHaveLength(2);
  });

  it('origine toujours dite', () => {
    expect(origineAssistance('llm', null)).toMatch(/vérifiée/);
    expect(origineAssistance('fallback', 'rejetee')).toMatch(/écartée/);
    expect(origineAssistance('fallback', 'desactivee_organisation')).toMatch(/désactivée/);
  });
});

describe('corpsExperience', () => {
  it('résultats entiers, conclusion exigée pour une expérience terminée', () => {
    const f = experienceVide('page_attente');
    f.resultats.visiteurs = '100';
    f.resultats.inscrits = '30';
    f.targetPct = '25';
    const ok = corpsExperience(f);
    expect(ok.ok && ok.body).toMatchObject({
      type: 'page_attente',
      targetPct: 25,
      results: { visiteurs: 100, inscrits: 30, realises: null },
      conclusion: null,
    });
    expect(corpsExperience({ ...f, status: 'terminee' })).toMatchObject({ ok: false });
    expect(corpsExperience({ ...f, targetPct: '120' })).toMatchObject({ ok: false });
    expect(
      corpsExperience({ ...f, resultats: { ...f.resultats, inscrits: 'beaucoup' } }),
    ).toMatchObject({ ok: false });
  });

  it('pré-commande : montant déclaré avec sa devise', () => {
    const f = { ...experienceVide('pre_commande'), montant: '250', devise: '' };
    expect(corpsExperience(f)).toMatchObject({ ok: false });
    const r = corpsExperience({ ...f, devise: 'usd' });
    expect(r.ok && r.body.results).toMatchObject({ montant: '250', devise: 'USD' });
  });
});
