// Agrégations du tableau de bord d'organisation (S21a).
//
// Ces tests portent sur les fonctions PURES : ce qui est compté, ce qui est
// masqué, et — surtout — ce qui n'est PAS inventé. Les cas nuls y ont autant de
// place que les cas nominaux : `null` n'est pas un détail d'implémentation ici,
// c'est la réponse correcte quand la donnée n'existe pas (doctrine ADR-0011,
// « on ne fabrique jamais un chiffre »).

import { describe, expect, it } from 'vitest';

import type { VarianceLine } from '../actuals/variance.js';
import { ORG_ROLES, type OrgRole } from '../authz/permissions.js';
import { PLAN_ENTITLEMENTS } from '../billing/entitlements.js';
import { DISPLAY_CURRENCIES } from './organization-space.dto.js';
import {
  ACTIONS_ECRITURE,
  BLOCS_DU_TABLEAU_DE_BORD,
  anomaliesDesEcarts,
  blocVisible,
  blocsMasques,
  consommation,
  depassements,
  estLectureSeule,
  hypothesesModifiees,
  moisACloturer,
  planEnAttente,
  prochainMoisASaisir,
  ratiosRougesDuPlan,
  resumeEcarts,
  type PlanSnapshotInput,
} from './dashboard.js';

function plan(overrides: Partial<PlanSnapshotInput> = {}): PlanSnapshotInput {
  return {
    projectId: 'p1',
    version: 3,
    approvedAt: new Date('2026-07-01T10:00:00.000Z'),
    driverValues: { prix_unitaire: 10, quantite_mois: 100 },
    soleApprover: false,
    lines: [],
    ...overrides,
  };
}

function ligneVariance(overrides: Partial<VarianceLine> = {}): VarianceLine {
  return {
    lineId: 'ca',
    label: 'Chiffre d’affaires',
    sens: 'produit',
    comparable: true,
    raison: null,
    saisi: true,
    base: 'projection',
    prevuMensuel: 100,
    prevuCumule: 300,
    realiseCumule: 240,
    ecart: -60,
    ecartPct: -0.2,
    statut: 'defavorable',
    diagnostics: [],
    ...overrides,
  };
}

describe('ratiosRougesDuPlan (S21a)', () => {
  it('ne remonte que les lignes dont le moteur a posé le feu au rouge', () => {
    const ratios = ratiosRougesDuPlan(
      plan({
        lines: [
          {
            lineId: 'a',
            label: 'A',
            value: 1,
            seuil: { valeur: 2, direction: 'min', statut: 'rouge' },
          },
          {
            lineId: 'b',
            label: 'B',
            value: 5,
            seuil: { valeur: 2, direction: 'min', statut: 'vert' },
          },
          {
            lineId: 'c',
            label: 'C',
            value: 3,
            seuil: { valeur: 2, direction: 'min', statut: 'orange' },
          },
          { lineId: 'd', label: 'D', value: 9 },
        ],
      }),
      'Boulangerie',
    );

    expect(ratios.map((r) => r.lineId)).toEqual(['a']);
    expect(ratios[0]).toMatchObject({
      projectName: 'Boulangerie',
      planVersion: 3,
      valeur: 1,
      seuilValeur: 2,
      seuilDirection: 'min',
    });
  });

  it('ne recalcule aucun seuil : une ligne sans `seuil` n’est jamais rouge', () => {
    // Le feu vient du snapshot figé à la validation. Si le pack n'en publiait pas
    // pour cette ligne, on ne va pas en inventer un — un plan parti chez un
    // banquier ne doit pas se repeindre parce qu'un pack a bougé depuis.
    const ratios = ratiosRougesDuPlan(
      plan({ lines: [{ lineId: 'autonomie', label: 'Autonomie', value: -50 }] }),
      'Projet',
    );
    expect(ratios).toEqual([]);
  });
});

describe('hypothesesModifiees / planEnAttente (S21a)', () => {
  it('détecte une surcharge d’hypothèse divergente du plan figé', () => {
    expect(hypothesesModifiees({ prix_unitaire: 12 }, { prix_unitaire: 10 })).toBe(true);
  });

  it('ignore les drivers résolus que le projet ne surcharge pas', () => {
    // Le snapshot porte des drivers RÉSOLUS (utilisateur > pack > template) et en
    // contient donc davantage que les surcharges du projet. Leur seule présence
    // ne signifie pas que quelque chose a changé.
    expect(hypothesesModifiees({ prix_unitaire: 10 }, { prix_unitaire: 10, tva: 16 })).toBe(false);
  });

  it('signale un projet sans aucun plan validé', () => {
    const attente = planEnAttente(
      { id: 'p1', name: 'Neuf', driverValues: {}, updatedAt: new Date('2026-08-01T00:00:00Z') },
      undefined,
    );
    expect(attente).toMatchObject({ raison: 'AUCUN_PLAN', derniereVersion: null });
  });

  it('signale un plan dépassé par les hypothèses saisies depuis', () => {
    const attente = planEnAttente(
      {
        id: 'p1',
        name: 'Boulangerie',
        driverValues: { prix_unitaire: 12 },
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      },
      plan(),
    );
    expect(attente).toMatchObject({ raison: 'HYPOTHESES_MODIFIEES', derniereVersion: 3 });
  });

  it('ne signale rien quand le plan validé est à jour', () => {
    const attente = planEnAttente(
      {
        id: 'p1',
        name: 'Boulangerie',
        driverValues: { prix_unitaire: 10 },
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      },
      plan(),
    );
    expect(attente).toBeNull();
  });
});

describe('resumeEcarts (S21a)', () => {
  const projet = { id: 'p1', name: 'Boulangerie' };

  it('ne compte que les lignes déjà marquées défavorables par le calcul d’écarts', () => {
    const resume = resumeEcarts(projet, 1, 4, [
      ligneVariance({ lineId: 'ca', ecartPct: -0.2 }),
      ligneVariance({ lineId: 'marge', statut: 'favorable', ecartPct: 0.9 }),
      ligneVariance({ lineId: 'loyer', statut: 'conforme', ecartPct: 0 }),
      ligneVariance({ lineId: 'salaires', ecartPct: -0.35 }),
    ]);
    expect(resume).toMatchObject({ lignesDefavorables: 2, planVersion: 4, year: 1 });
    // Pire écart = plus grande valeur ABSOLUE, la plus favorable étant exclue.
    expect(resume?.pireEcart).toMatchObject({ lineId: 'salaires', ecartPct: -0.35 });
  });

  it('renvoie `null` quand aucun écart n’est défavorable', () => {
    expect(resumeEcarts(projet, 1, 1, [ligneVariance({ statut: 'conforme' })])).toBeNull();
  });

  it('compte une ligne défavorable sans pourcentage, sans lui en inventer un', () => {
    // `ecartPct: null` = base prévue nulle (division impossible). La ligne compte
    // dans le total, mais elle ne peut pas prétendre au titre de « pire écart » :
    // renvoyer 0 ou -100 % serait un chiffre fabriqué.
    const resume = resumeEcarts(projet, 1, 1, [ligneVariance({ ecartPct: null })]);
    expect(resume?.lignesDefavorables).toBe(1);
    expect(resume?.pireEcart).toBeNull();
  });
});

describe('anomaliesDesEcarts (S21a)', () => {
  it('remonte les diagnostics de saisie sans les corriger', () => {
    const anomalies = anomaliesDesEcarts({ id: 'p1', name: 'Boulangerie' }, 1, [
      ligneVariance({
        lineId: 'marge_brute',
        diagnostics: [{ code: 'INCOHERENCE_SOLDE', message: 'Solde incohérent', months: [2, 3] }],
      }),
      ligneVariance({ lineId: 'ca' }),
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      lineId: 'marge_brute',
      code: 'INCOHERENCE_SOLDE',
      months: [2, 3],
      projectName: 'Boulangerie',
    });
  });
});

describe('périodes du Comptable (S21a)', () => {
  it('propose le premier mois sans document', () => {
    expect(
      prochainMoisASaisir([
        { month: 1, status: 'closed', values: { ca: 10 } },
        { month: 2, status: 'open', values: { ca: 12 } },
      ]),
    ).toBe(3);
  });

  it('propose un mois dont le document existe mais reste vide', () => {
    expect(prochainMoisASaisir([{ month: 1, status: 'open', values: {} }])).toBe(1);
  });

  it('ne propose rien quand les douze mois sont saisis', () => {
    const douze = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      status: 'closed' as const,
      values: { ca: 1 },
    }));
    expect(prochainMoisASaisir(douze)).toBeNull();
  });

  it('n’appelle « à clôturer » qu’un mois ouvert ET saisi', () => {
    expect(
      moisACloturer([
        { month: 3, status: 'open', values: { ca: 1 } },
        { month: 1, status: 'open', values: {} },
        { month: 2, status: 'closed', values: { ca: 1 } },
        { month: 5, status: 'open', values: { ca: 2 } },
      ]),
    ).toEqual([3, 5]);
  });
});

describe('consommation et dépassements (S21a)', () => {
  it('traduit « illimité » par `null`, jamais par un grand nombre', () => {
    // Business porte `maxProjects: null` dans la grille à cinq paliers (Pro est
    // désormais plafonné à 5, il ne sert donc plus d'exemple d'illimité).
    const c = consommation('business', PLAN_ENTITLEMENTS.business, { projets: 7, membres: 3 });
    expect(c.projets).toEqual({ utilise: 7, limite: null });
    expect(depassements(c)).toEqual([]);
  });

  it('traduit des sièges négociés au contrat par `null`, jamais par 0', () => {
    // Expert est la seule offre dont les sièges ne sont pas un nombre : ils sont
    // négociés. Un 0 afficherait « 3 membres sur 0 autorisés », faux et alarmant.
    const c = consommation('expert', PLAN_ENTITLEMENTS.expert, { projets: 1, membres: 3 });
    expect(c.sieges).toEqual({ utilise: 3, limite: null });
    expect(depassements(c)).toEqual([]);
  });

  it('signale un dépassement sans rien supprimer (rétrogradation de plan)', () => {
    // docs/13 § Changements de plan : « aucune suppression automatique de projet ».
    // Une organisation repassée en `free` avec 4 projets doit pouvoir le LIRE.
    const c = consommation('free', PLAN_ENTITLEMENTS.free, { projets: 4, membres: 1 });
    expect(depassements(c)).toEqual([
      { code: 'PROJETS', libelle: 'Projets', utilise: 4, limite: 1 },
    ]);
  });

  it('cumule les dépassements plutôt que de n’en montrer qu’un', () => {
    // Free contractualise maintenant 1 siège. Une organisation à 4 projets et
    // 2 membres dépasse DEUX limites : n'en afficher qu'une laisserait
    // l'utilisateur corriger la première et se heurter à la seconde sans l'avoir
    // vue venir.
    const c = consommation('free', PLAN_ENTITLEMENTS.free, { projets: 4, membres: 2 });
    expect(depassements(c).map((d) => d.code)).toEqual(['PROJETS', 'SIEGES']);
  });

  it('signale un dépassement de sièges sur une offre qui en contractualise', () => {
    const c = consommation('business', PLAN_ENTITLEMENTS.business, { projets: 3, membres: 21 });
    expect(depassements(c).map((d) => d.code)).toEqual(['SIEGES']);
  });
});

describe('visibilité des blocs par rôle (S21a)', () => {
  const sansContexte = {};

  it('n’ouvre le pilotage qu’aux rôles détenant `organization.manage`', () => {
    const ouverts = ORG_ROLES.filter((r) => blocVisible('gouvernance', r, sansContexte));
    expect(ouverts).toEqual(['owner', 'admin']);
  });

  it('n’ouvre la validation financière qu’aux rôles détenant `plan.approve`', () => {
    const ouverts = ORG_ROLES.filter((r) => blocVisible('validation', r, sansContexte));
    expect(ouverts).toEqual(['owner', 'finance_director']);
  });

  it('n’ouvre la saisie du réalisé qu’aux rôles détenant `actuals.import`', () => {
    const ouverts = ORG_ROLES.filter((r) => blocVisible('comptabilite', r, sansContexte));
    expect(ouverts).toEqual(['owner', 'admin', 'finance_director', 'accountant']);
  });

  it('ouvre les projets à TOUS les rôles, Conseiller et Lecteur compris', () => {
    for (const role of ORG_ROLES) {
      expect(blocVisible('projets', role, sansContexte), role).toBe(true);
    }
  });

  it('un Lecteur ne voit que les projets, et sait pourquoi pour le reste', () => {
    const masque = blocsMasques('viewer', sansContexte);
    expect(masque.map((m) => m.section)).toEqual(['gouvernance', 'validation', 'comptabilite']);
    for (const bloc of masque) {
      expect(bloc.raison.length, bloc.section).toBeGreaterThan(30);
    }
  });

  it('la liste des blocs masqués ne transporte AUCUNE donnée', () => {
    // C'est la propriété qui rend cette liste envoyable à un Lecteur : elle nomme
    // un bloc absent et l'action qui l'ouvrirait, jamais un compteur ni un projet.
    for (const role of ORG_ROLES) {
      for (const bloc of blocsMasques(role, sansContexte)) {
        expect(Object.keys(bloc).sort()).toEqual(['action', 'raison', 'section', 'titre']);
      }
    }
  });

  it('chaque bloc déclaré porte un titre, une action et une justification', () => {
    for (const bloc of BLOCS_DU_TABLEAU_DE_BORD) {
      expect(bloc.titre.length, bloc.section).toBeGreaterThan(3);
      expect(bloc.raison.length, bloc.section).toBeGreaterThan(30);
    }
    // Une section déclarée deux fois rendrait `blocVisible` dépendant de l'ordre.
    const sections = BLOCS_DU_TABLEAU_DE_BORD.map((b) => b.section);
    expect(new Set(sections).size).toBe(sections.length);
  });
});

describe('lecture seule (S21a)', () => {
  it('ne considère en lecture seule que le Conseiller et le Lecteur', () => {
    const lecteurs = ORG_ROLES.filter((r) => estLectureSeule(r, {}));
    expect(lecteurs).toEqual(['advisor', 'viewer']);
  });

  it('le Comptable n’est jamais en lecture seule, droit de clôture ou non', () => {
    for (const canClosePeriods of [false, true]) {
      expect(estLectureSeule('accountant', { canClosePeriods })).toBe(false);
    }
  });

  it('un Analyste n’est PAS en lecture seule, même sans bloc d’action ici', () => {
    // Aucun bloc de l'espace organisation ne s'ouvre à lui, mais il saisit et
    // calcule dans l'espace projet (`canvas.update`, `inputs.update`,
    // `plan.calculate`). Lui annoncer « lecture seule » serait faux.
    const role: OrgRole = 'analyst';
    expect(estLectureSeule(role, {})).toBe(false);
    expect(blocsMasques(role, {}).map((m) => m.section)).toEqual([
      'gouvernance',
      'validation',
      'comptabilite',
    ]);
  });

  it('la liste des actions d’écriture est sans doublon et exclut les lectures', () => {
    expect(new Set(ACTIONS_ECRITURE).size).toBe(ACTIONS_ECRITURE.length);
    for (const lecture of ['project.read', 'analytics.read', 'report.export', 'audit.read']) {
      expect(ACTIONS_ECRITURE, lecture).not.toContain(lecture);
    }
  });
});

describe('devises d’affichage (S21a)', () => {
  it('reste alignée sur la liste de l’espace compte', async () => {
    // Duplication assumée (voir `organization-space.dto.ts`) : `account/` est un
    // autre périmètre d'écriture. Ce test la rend surveillée plutôt que subie —
    // une devise ajoutée d'un côté et pas de l'autre fait rougir la CI.
    const { DISPLAY_CURRENCIES: DU_COMPTE } = await import('../account/account.dto.js');
    expect([...DISPLAY_CURRENCIES]).toEqual([...DU_COMPTE]);
  });
});
