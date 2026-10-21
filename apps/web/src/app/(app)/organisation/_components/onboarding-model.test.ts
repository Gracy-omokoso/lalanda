// Mise en route — ADR-0030 § 8.
//
// Ce que ces tests protègent : une étape n'est « faite » que si la donnée existe
// côté serveur ; un refus de rôle n'est jamais compté comme un manque ; un fait
// inconnu (chargement, panne) n'est jamais compté comme fait ; la reprise
// tombe sur la première étape utile.

import { describe, expect, it } from 'vitest';

import type { BrandView, FiscalProfileView, NormalizedInvoicingView } from '@/lib/api';

import {
  ETAPES,
  etapeDeReprise,
  etapeDepuisParam,
  etapePrecedente,
  etapeSuivante,
  etatsAffiches,
  FAITS_INCONNUS,
  fiscalFait,
  identiteFaite,
  lienEtape,
  pointsDeVenteFaits,
  progression,
  refusDepuisActions,
  termine,
  type FaitsMiseEnRoute,
} from './onboarding-model';

const marque = (partiel: Partial<BrandView>): BrandView =>
  ({
    logos: { primary: null, horizontal: null, symbol: null, light: null },
    primaryColor: null,
    secondaryColor: null,
    font: null,
    ...partiel,
  }) as BrandView;

describe('ce qui rend une étape faite (lu sur le serveur)', () => {
  it('identité : un logo principal ou une couleur principale', () => {
    expect(identiteFaite(marque({}))).toBe(false);
    expect(identiteFaite(marque({ primaryColor: '#005263' }))).toBe(true);
    expect(
      identiteFaite(
        marque({
          logos: {
            primary: {} as BrandView['logos']['primary'],
            horizontal: null,
            symbol: null,
            light: null,
          },
        }),
      ),
    ).toBe(true);
    // Une police seule ne suffit pas : elle ne se voit pas sans logo ni couleur.
    expect(identiteFaite(marque({ font: 'inter' }))).toBe(false);
  });

  it('profil fiscal : une fiche existe', () => {
    expect(fiscalFait({ profile: null } as FiscalProfileView)).toBe(false);
    expect(fiscalFait({ profile: {} } as FiscalProfileView)).toBe(true);
  });

  it('points de vente : au moins un', () => {
    expect(pointsDeVenteFaits({ pointsOfSale: [] } as unknown as NormalizedInvoicingView)).toBe(
      false,
    );
    expect(pointsDeVenteFaits({ pointsOfSale: [{}] } as unknown as NormalizedInvoicingView)).toBe(
      true,
    );
  });
});

describe('refus et progression', () => {
  it('déduit les refus des actions, sans appel', () => {
    expect(refusDepuisActions(['fiscal.manage'])).toEqual({ identite: 'refus' });
    expect(refusDepuisActions(['organization.manage'])).toEqual({
      fiscal: 'refus',
      'points-de-vente': 'refus',
    });
    expect(refusDepuisActions(null)).toEqual({});
  });

  it('un refus ne compte pas dans le total ; un inconnu ne compte pas comme fait', () => {
    const faits: FaitsMiseEnRoute = {
      identite: 'refus',
      fiscal: true,
      'points-de-vente': null,
      modules: false,
    };
    expect(progression(faits)).toEqual({ faites: 1, total: 3 });
    expect(termine(faits)).toBe(false);
  });

  it('terminé quand toutes les étapes ouvertes sont faites', () => {
    expect(
      termine({ identite: true, fiscal: 'refus', 'points-de-vente': 'refus', modules: true }),
    ).toBe(true);
    expect(termine(FAITS_INCONNUS)).toBe(false);
  });
});

describe('reprise', () => {
  it('reprend à la première étape ouverte et non faite', () => {
    expect(etapeDeReprise(FAITS_INCONNUS)).toBe('identite');
    expect(
      etapeDeReprise({ identite: true, fiscal: false, 'points-de-vente': false, modules: false }),
    ).toBe('fiscal');
    expect(
      etapeDeReprise({ identite: 'refus', fiscal: true, 'points-de-vente': null, modules: false }),
    ).toBe('points-de-vente');
  });

  it('tout fait : rouvre sur la dernière étape', () => {
    expect(
      etapeDeReprise({ identite: true, fiscal: true, 'points-de-vente': true, modules: true }),
    ).toBe('modules');
  });

  it('lit l’étape demandée par l’URL, ignore l’inconnu', () => {
    expect(etapeDepuisParam('fiscal')).toBe('fiscal');
    expect(etapeDepuisParam('autre')).toBeNull();
    expect(etapeDepuisParam(null)).toBeNull();
    expect(lienEtape('modules')).toBe('/organisation/mise-en-route?etape=modules');
  });

  it('enchaîne les étapes dans l’ordre', () => {
    expect(ETAPES.map((e) => e.id)).toEqual(['identite', 'fiscal', 'points-de-vente', 'modules']);
    expect(etapeSuivante('identite')).toBe('fiscal');
    expect(etapeSuivante('modules')).toBeNull();
    expect(etapePrecedente('identite')).toBeNull();
    expect(etapePrecedente('modules')).toBe('points-de-vente');
  });
});

describe('états affichés', () => {
  it('l’étape ouverte prime, puis refus, fait, à faire', () => {
    const etats = etatsAffiches(
      { identite: 'refus', fiscal: true, 'points-de-vente': false, modules: null },
      'points-de-vente',
    ).map((e) => e.etat);
    expect(etats).toEqual(['locked', 'done', 'current', 'todo']);
  });
});
