// Mise en route d'une société — ADR-0052 § 2 et § 3 (lot O2), étend ADR-0030 § 8.
//
// Ce que ces tests protègent : l'avancement vient de la vue du serveur, jamais d'un calcul
// local ; une étape reportée n'est pas une faute ; une étape fermée au rôle se laisse
// passer ; la reprise tombe sur la première étape utile ; aucun libellé ne qualifie
// d'« obligatoire » un champ que le serveur n'exige pas (critère 14, F3).

import {
  ORGANIZATION_SETUP_STEPS,
  ORGANIZATION_SETUP_STEP_IDS,
  OrganizationSetupViewSchema,
  type OrganizationSetupStepId,
  type OrganizationSetupStepState,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';
import { describe, expect, it } from 'vitest';

import {
  ETAPES,
  etapeDeReprise,
  etapeDepuisParam,
  etapePrecedente,
  etapeSuivante,
  etapeVue,
  etatsAffiches,
  lienEtape,
  pastilles,
  peutReporter,
  peutReprendre,
  progression,
  termine,
} from './onboarding-model';

function vue(
  etats: Partial<Record<OrganizationSetupStepId, OrganizationSetupStepState>> = {},
  refus: readonly OrganizationSetupStepId[] = [],
): OrganizationSetupView {
  return OrganizationSetupViewSchema.parse({
    organizationId: 'org-1',
    steps: ORGANIZATION_SETUP_STEP_IDS.map((id) => {
      const state = etats[id] ?? 'todo';
      return {
        id,
        state,
        level: ORGANIZATION_SETUP_STEPS[id].level,
        requiredFor: [...ORGANIZATION_SETUP_STEPS[id].requiredFor],
        missing: state === 'done' ? [] : [ORGANIZATION_SETUP_STEPS[id].missingCode],
        canAct: !refus.includes(id),
      };
    }),
    modules: null,
    capabilities: {
      invoice:
        etats.fiscal === 'done'
          ? { ready: true, missing: [] }
          : { ready: false, missing: ['fiscal_profile'] },
      normalize: { ready: false, enabled: false, missing: ['fiscal_profile', 'country_cd'] },
      accounting_active: { ready: false, active: false, missing: ['BOOK_CURRENCY_REQUIRED'] },
    },
  });
}

describe('neuf étapes (ADR-0052 § 2, décision n° 1)', () => {
  it('suivent l’ordre conseillé du contrat partagé', () => {
    expect(ETAPES.map((e) => e.id)).toEqual([...ORGANIZATION_SETUP_STEP_IDS]);
  });

  it('chaque étape est une URL, on va et vient librement', () => {
    expect(lienEtape('tresorerie')).toBe('/organisation/mise-en-route?etape=tresorerie');
    expect(etapeDepuisParam('equipe')).toBe('equipe');
    expect(etapeDepuisParam('points-de-vente')).toBeNull();
    expect(etapeDepuisParam(null)).toBeNull();
    expect(etapeSuivante('societe')).toBe('fiscal');
    expect(etapeSuivante('modules')).toBeNull();
    expect(etapePrecedente('societe')).toBeNull();
    expect(etapePrecedente('fiscal')).toBe('societe');
  });

  it('seules les quatre étapes de § 4 offrent un report, jamais la fiche fiscale (critère 7)', () => {
    expect(ETAPES.filter((e) => e.report !== null).map((e) => e.id)).toEqual([
      'normalisation',
      'tresorerie',
      'comptabilite',
      'equipe',
    ]);
    expect(ETAPES.find((e) => e.id === 'equipe')!.report).toBe('Je travaille seul');
  });
});

describe('libellés (critère 14, F3 ; F6)', () => {
  it('aucun libellé ne dit « obligatoire » ; le RCCM est dit facultatif', () => {
    for (const e of ETAPES) {
      expect(`${e.label} ${e.pourquoi}`, e.id).not.toMatch(/obligatoire/i);
    }
    const fiscal = ETAPES.find((e) => e.id === 'fiscal')!.pourquoi;
    expect(fiscal).toMatch(/RCCM/);
    expect(fiscal).toMatch(/facultatifs/);
    expect(fiscal).toMatch(/juriste/);
    // Ce que le serveur exige est dit par l'acte qu'il bloque.
    expect(fiscal).toMatch(/aucune facture ne peut être émise/);
  });

  it('la devise personnelle est distinguée de celle de la société (F6)', () => {
    expect(ETAPES.find((e) => e.id === 'devises')!.pourquoi).toMatch(/devise personnelle/);
  });

  it('aucune date d’exercice affirmée : à confirmer avec l’expert-comptable', () => {
    expect(ETAPES.find((e) => e.id === 'comptabilite')!.pourquoi).toMatch(/expert-comptable/);
  });
});

describe('avancement lu sur le serveur', () => {
  it('organisation neuve : rien de fait, reprise à l’étape 1', () => {
    const v = vue();
    expect(progression(v)).toEqual({ faites: 0, reglees: 0, total: 9 });
    expect(termine(v)).toBe(false);
    expect(etapeDeReprise(v)).toBe('societe');
  });

  it('une étape reportée compte comme réglée, jamais comme faite', () => {
    const v = vue({ fiscal: 'done', tresorerie: 'deferred' });
    expect(progression(v)).toEqual({ faites: 1, reglees: 2, total: 9 });
  });

  it('terminé quand tout est fait ou reporté (critère 18)', () => {
    const etats = Object.fromEntries(
      ORGANIZATION_SETUP_STEP_IDS.map((id) => [id, 'done' as const]),
    ) as Record<OrganizationSetupStepId, 'done'>;
    expect(termine(vue({ ...etats, equipe: 'deferred' } as never))).toBe(true);
    expect(termine(vue({ ...etats, equipe: 'todo' } as never))).toBe(false);
  });

  it('reprise : première étape à faire OUVERTE au rôle, sinon la première à faire', () => {
    expect(etapeDeReprise(vue({ societe: 'done' }, ['fiscal']))).toBe('devises');
    const toutFerme = vue({}, [...ORGANIZATION_SETUP_STEP_IDS]);
    expect(etapeDeReprise(toutFerme)).toBe('societe');
    const etats = Object.fromEntries(ORGANIZATION_SETUP_STEP_IDS.map((id) => [id, 'done']));
    expect(etapeDeReprise(vue(etats))).toBe('modules');
  });
});

describe('indicateur et déclarations', () => {
  it('fermée au rôle : cadenas et « faite par… » ; reportée : reprenable ; fiche : nécessaire pour facturer', () => {
    const v = vue({ tresorerie: 'deferred' }, ['normalisation']);
    const etats = etatsAffiches(v, 'societe');
    const de = (id: OrganizationSetupStepId) => etats.find((e) => e.etape.id === id)!;
    expect(de('societe').etat).toBe('current');
    expect(de('normalisation')).toMatchObject({ etat: 'locked' });
    expect(de('normalisation').hint).toMatch(/^Faite par/);
    expect(de('tresorerie')).toMatchObject({ etat: 'todo', hint: 'Pas maintenant — reprenable' });
    expect(de('fiscal').hint).toBe('Nécessaire pour facturer');
    expect(etatsAffiches(vue({ fiscal: 'done' }), 'societe')[1]!).toMatchObject({ etat: 'done' });
  });

  it('report offert à qui a l’action d’une étape reportable et à faire ; reprise d’un report', () => {
    const v = vue({ comptabilite: 'deferred' }, ['equipe']);
    expect(peutReporter(etapeVue(v, 'tresorerie'))).toBe(true);
    expect(peutReporter(etapeVue(v, 'fiscal'))).toBe(false);
    expect(peutReporter(etapeVue(v, 'equipe'))).toBe(false);
    expect(peutReporter(etapeVue(v, 'comptabilite'))).toBe(false);
    expect(peutReprendre(etapeVue(v, 'comptabilite'))).toBe(true);
    expect(peutReprendre(etapeVue(v, 'tresorerie'))).toBe(false);
  });
});

describe('capacités : ce qui bloque la facture est dit clairement (§ 3)', () => {
  it('facture : la fiche fiscale seule, reprise du code serveur', () => {
    const [facturer] = pastilles(vue());
    expect(facturer).toMatchObject({ id: 'invoice', pret: false, etape: 'fiscal' });
    expect(facturer!.phrase).toMatch(/Aucune facture/);
    expect(facturer!.manques).toEqual(['Enregistrer la fiche fiscale de l’organisation.']);
    expect(pastilles(vue({ fiscal: 'done' }))[0]).toMatchObject({ pret: true, manques: [] });
  });

  it('normaliser et comptabilité : facultatifs, codes du serveur mis en mots', () => {
    const [, normaliser, compta] = pastilles(vue());
    expect(normaliser!.phrase).toMatch(/Facultatif/);
    expect(normaliser!.manques).toHaveLength(2);
    expect(compta!.phrase).toMatch(/Facultatif/);
    expect(compta!.manques).toEqual(['Choisissez la monnaie de tenue (CDF ou USD).']);
  });

  it('une étape reportée n’est jamais présentée comme une faute', () => {
    const [, normaliser, compta] = pastilles(
      vue({ normalisation: 'deferred', comptabilite: 'deferred' }),
    );
    expect(normaliser!.phrase).toBe('Facture normalisée : pas maintenant.');
    expect(compta!.phrase).toBe('Comptabilité : pas maintenant.');
  });
});
