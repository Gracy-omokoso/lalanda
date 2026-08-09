// Logique pure de l'espace organisation (S21a).
//
// Ce que ces tests protègent en priorité : les cas où la donnée N'EXISTE PAS.
// « illimité », « non chiffrable », « — » ne sont pas des habillages — ce sont
// les seules réponses honnêtes quand il n'y a pas de nombre, et les remplacer par
// 0 rendrait l'interface faussement rassurante.

import { describe, expect, it } from 'vitest';

import type { BlocMasqueView, ConsommationView, OrgAction } from '@/lib/api';

import {
  ORGANIZATION_TABS,
  accroche,
  aQuelqueChoseAMontrer,
  estRefus,
  formatDate,
  formatDateHeure,
  formatEcartPct,
  libelleLimite,
  libelleMois,
  libellePlan,
  libelleRaisonAttente,
  libelleSeuil,
  limiteAtteinte,
  masqueOrdonne,
  messageErreur,
  ongletsVisibles,
  resumeConsommation,
  segmentActif,
} from './organization-model';

describe('onglets de l’espace organisation (S21a)', () => {
  it('déduit l’onglet actif du chemin, sous-routes comprises', () => {
    expect(segmentActif('/organisation')).toBe('');
    expect(segmentActif('/organisation/parametres')).toBe('parametres');
    expect(segmentActif('/organisation/journal/2026')).toBe('journal');
    expect(segmentActif('/projects')).toBe('');
  });

  it('ne montre que le tableau de bord tant que les permissions sont inconnues', () => {
    // Afficher les quatre onglets puis en retirer trois au chargement ferait
    // clignoter la navigation et promettrait des pages qui répondront 403.
    expect(ongletsVisibles(null).map((t) => t.segment)).toEqual(['']);
  });

  it('ouvre les onglets exactement selon les actions du rôle', () => {
    const owner: OrgAction[] = [
      'analytics.read',
      'organization.manage',
      'billing.manage',
      'audit.read',
    ];
    expect(ongletsVisibles(owner).map((t) => t.segment)).toEqual([
      '',
      'parametres',
      'facturation',
      'journal',
    ]);

    // Administrateur : gouvernance et audit, mais PAS la facturation (ADR-0012 §3).
    const admin: OrgAction[] = ['analytics.read', 'organization.manage', 'audit.read'];
    expect(ongletsVisibles(admin).map((t) => t.segment)).toEqual(['', 'parametres', 'journal']);

    // Lecteur : le tableau de bord et rien d'autre.
    expect(ongletsVisibles(['project.read', 'analytics.read']).map((t) => t.segment)).toEqual(['']);
  });

  it('le tableau de bord n’exige aucune action : il est ouvert à tout membre', () => {
    expect(ORGANIZATION_TABS[0]!.action).toBeNull();
    expect(ORGANIZATION_TABS.filter((t) => t.action === null)).toHaveLength(1);
  });
});

describe('refus et messages (S21a)', () => {
  it('reconnaît 403 et 404 comme des refus, pas comme des pannes', () => {
    expect(estRefus({ status: 403 })).toBe(true);
    // 404 = ressource d'une autre organisation (ADR-0011 Contrat 4).
    expect(estRefus({ status: 404 })).toBe(true);
    expect(estRefus({ status: 500 })).toBe(false);
    expect(estRefus(new Error('réseau'))).toBe(false);
    expect(estRefus(null)).toBe(false);
  });

  it('traduit les codes connus et garde le message brut sinon', () => {
    const refus = Object.assign(new Error('Forbidden'), {
      status: 403,
      detail: { code: 'FORBIDDEN' },
    });
    expect(messageErreur(refus, 'repli')).toContain('rôle');

    const inconnu = Object.assign(new Error('Timeout base'), { status: 500, detail: {} });
    expect(messageErreur(inconnu, 'repli')).toBe('Timeout base');
    expect(messageErreur({}, 'repli')).toBe('repli');
  });
});

describe('formatage sans chiffre inventé (S21a)', () => {
  it('affiche « illimité » plutôt qu’un grand nombre ou un zéro', () => {
    expect(libelleLimite(7, null)).toBe('7 / illimité');
    expect(libelleLimite(1, 1)).toBe('1 / 1');
  });

  it('ne considère jamais une limite absente comme atteinte', () => {
    expect(limiteAtteinte(99, null)).toBe(false);
    expect(limiteAtteinte(1, 1)).toBe(true);
    expect(limiteAtteinte(0, 1)).toBe(false);
  });

  it('rend « non chiffrable » un écart sans base, jamais 0 %', () => {
    expect(formatEcartPct(null)).toBe('non chiffrable');
    expect(formatEcartPct(-0.2)).toBe('-20,0 %');
    expect(formatEcartPct(0.125)).toBe('+12,5 %');
  });

  it('rend un tiret sur une date absente ou invalide, jamais la date du jour', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('pas une date')).toBe('—');
    expect(formatDate('2026-08-09T10:00:00.000Z')).not.toBe('—');
    expect(formatDateHeure(null)).toBe('—');
    expect(formatDateHeure('pas une date')).toBe('—');
  });

  it('nomme les mois comme des mois d’EXERCICE, jamais comme des mois calendaires', () => {
    // Le réalisé est indexé par année d'exercice (1..5), pas par année civile
    // (docs/08). Écrire « janvier » ici serait une erreur métier.
    expect(libelleMois(1, 3)).toBe('Exercice 1 · mois 3');
  });

  it('traduit les plans commerciaux et laisse passer un plan inconnu', () => {
    expect(libellePlan('free')).toBe('Gratuit');
    expect(libellePlan('business')).toBe('Business');
    expect(libellePlan('entreprise')).toBe('entreprise');
  });

  it('explique le seuil dans les deux sens', () => {
    expect(libelleSeuil({ seuilValeur: 2, seuilDirection: 'min' })).toContain('minimum');
    expect(libelleSeuil({ seuilValeur: 0.5, seuilDirection: 'max' })).toContain('maximum');
  });

  it('distingue « aucun plan » de « hypothèses modifiées »', () => {
    expect(libelleRaisonAttente({ raison: 'AUCUN_PLAN' })).toContain('Aucun plan');
    expect(libelleRaisonAttente({ raison: 'HYPOTHESES_MODIFIEES' })).toContain('hypothèses');
  });
});

describe('composition du tableau de bord (S21a)', () => {
  const bloc = (section: BlocMasqueView['section']): BlocMasqueView => ({
    section,
    titre: section,
    action: 'organization.manage',
    raison: 'raison',
  });

  it('distingue un bloc FERMÉ d’un bloc vide', () => {
    // `null` = le serveur n'a rien chargé (rôle insuffisant). Un tableau vide =
    // le bloc est ouvert mais l'organisation n'a rien dedans. Les deux appellent
    // des messages différents; les confondre ferait dire « accès refusé » à un
    // propriétaire dont l'organisation est simplement neuve.
    expect(
      aQuelqueChoseAMontrer({
        gouvernance: null,
        validation: null,
        comptabilite: null,
        projets: null,
      }),
    ).toBe(false);
    expect(
      aQuelqueChoseAMontrer({
        gouvernance: null,
        validation: null,
        comptabilite: null,
        projets: { projets: [], dernieresValidations: [] },
      }),
    ).toBe(true);
  });

  it('ordonne les blocs masqués comme les sections affichées', () => {
    const ordonne = masqueOrdonne([bloc('comptabilite'), bloc('gouvernance'), bloc('validation')]);
    expect(ordonne.map((b) => b.section)).toEqual(['gouvernance', 'validation', 'comptabilite']);
  });

  it('choisit l’accroche sur les blocs ouverts, jamais sur le nom du rôle', () => {
    expect(
      accroche({ lectureSeule: false, gouvernance: true, validation: true, comptabilite: true }),
    ).toContain('Vue d’ensemble');
    expect(
      accroche({ lectureSeule: false, gouvernance: false, validation: true, comptabilite: false }),
    ).toContain('décision');
    expect(
      accroche({ lectureSeule: false, gouvernance: false, validation: false, comptabilite: true }),
    ).toContain('saisie');
    expect(
      accroche({ lectureSeule: true, gouvernance: false, validation: false, comptabilite: false }),
    ).toContain('Consultation seule');
    // Analyste : aucun bloc d'action ici, mais il n'est PAS en lecture seule.
    expect(
      accroche({ lectureSeule: false, gouvernance: false, validation: false, comptabilite: false }),
    ).not.toContain('Consultation seule');
  });

  it('résume la consommation sans jamais afficher « sur 0 sièges »', () => {
    const sansSieges: ConsommationView = {
      plan: 'pro',
      projets: { utilise: 3, limite: null },
      sieges: { utilise: 5, limite: null },
    };
    expect(resumeConsommation(sansSieges)).toBe('3 / illimité projets · 5 membres');

    const avecSieges: ConsommationView = {
      plan: 'business',
      projets: { utilise: 1, limite: null },
      sieges: { utilise: 21, limite: 20 },
    };
    expect(resumeConsommation(avecSieges)).toBe('1 / illimité projet · 21 / 20 sièges');
  });
});
