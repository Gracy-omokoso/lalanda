// Contrat légal partagé (S22c) — ce que ces tests protègent.
//
// L'erreur visée n'est pas une exception à l'exécution : c'est une acceptation
// enregistrée sur une version qui n'a jamais été publiée, ou un accord déjà
// donné qu'on redemande à chaque connexion. Les deux passent le build et les
// types, et aucune ne se voit en production autrement qu'en relisant la base.

import { describe, expect, it } from 'vitest';

import {
  KNOWN_LEGAL_VERSIONS,
  LEGAL_VERSION,
  PUBLISHER_NAME,
  isKnownLegalVersion,
  isTermsAcceptanceCurrent,
  legalTodo,
} from './index.js';

describe('version du corpus légal', () => {
  it('est une date ISO', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('figure parmi les versions connues', () => {
    // Sans cette garantie, la version courante serait refusée à l'écriture :
    // plus aucune acceptation ne pourrait être enregistrée.
    expect(isKnownLegalVersion(LEGAL_VERSION)).toBe(true);
  });

  it('refuse une version jamais publiée', () => {
    expect(isKnownLegalVersion('2099-01-01')).toBe(false);
    expect(isKnownLegalVersion('')).toBe(false);
    expect(isKnownLegalVersion('n’importe quoi')).toBe(false);
  });

  it('ne contient pas de doublon', () => {
    expect(new Set(KNOWN_LEGAL_VERSIONS).size).toBe(KNOWN_LEGAL_VERSIONS.length);
  });
});

describe('fraîcheur d’une acceptation', () => {
  it('reconnaît une acceptation portant la version en vigueur', () => {
    expect(isTermsAcceptanceCurrent(LEGAL_VERSION)).toBe(true);
  });

  it('traite l’absence d’acceptation comme un accord non donné', () => {
    expect(isTermsAcceptanceCurrent(null)).toBe(false);
    expect(isTermsAcceptanceCurrent(undefined)).toBe(false);
  });

  it('traite une acceptation périmée comme un accord non donné', () => {
    // Opposer à un utilisateur un texte qu'il n'a pas lu est précisément ce que
    // la version du corpus sert à empêcher.
    expect(isTermsAcceptanceCurrent('2020-01-01')).toBe(false);
  });
});

describe('identification de l’éditeur', () => {
  it('nomme Televerx LLC', () => {
    expect(PUBLISHER_NAME).toBe('Televerx LLC');
  });

  it('n’ajoute aucune coordonnée déduite au nom de l’éditeur', () => {
    // Garde-fou contre la dérive la plus probable de cette constante : y coller
    // une adresse ou un numéro d'immatriculation « pour faire propre ». Ces
    // informations ne sont pas connues ; les inventer produirait un document
    // faux publié sous le nom d'une personne morale réelle.
    expect(PUBLISHER_NAME).not.toMatch(/\d/);
    expect(PUBLISHER_NAME.split(',')).toHaveLength(1);
  });
});

describe('marqueur à compléter', () => {
  it('encadre le libellé d’une forme repérable en relecture', () => {
    expect(legalTodo('adresse du siège')).toBe('[À COMPLÉTER : adresse du siège]');
  });
});
