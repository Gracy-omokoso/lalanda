import { describe, expect, it } from 'vitest';

import type { PublicLeadFormField } from '@lalanda/shared/crm';

import {
  corpsSoumission,
  couleurSure,
  erreursLocales,
  erreursParChamp,
  messageRefus,
  valeursInitiales,
} from './formulaire-public-model';

const CHAMPS: PublicLeadFormField[] = [
  { key: 'name', label: 'Nom', required: true, maxLength: 120 },
  { key: 'email', label: 'E-mail', required: true, maxLength: 254 },
  { key: 'message', label: 'Message', required: false, maxLength: 2000 },
  { key: 'source', label: 'Source', required: false, maxLength: 120 },
];

describe('formulaire public — modèle', () => {
  it('préremplit la source depuis l’adresse, bornée', () => {
    expect(valeursInitiales(CHAMPS, 'x'.repeat(200)).source).toHaveLength(120);
    expect(valeursInitiales(CHAMPS.slice(0, 2), 'salon').source).toBeUndefined();
  });

  it('erreurs locales : obligatoires, format, accord', () => {
    const e = erreursLocales(CHAMPS, { name: '', email: 'pas-un-email' }, false);
    expect(Object.keys(e).sort()).toEqual(['consent', 'email', 'name']);
    expect(erreursLocales(CHAMPS, { name: 'Awa', email: 'awa@exemple.cd' }, true)).toEqual({});
  });

  it('corps : champs affichés non vides, ticket, accord ; le piège seulement s’il est rempli', () => {
    expect(
      corpsSoumission(CHAMPS, { name: ' Awa ', email: 'a@b.cd', message: '' }, 't', true, ''),
    ).toEqual({ ticket: 't', consent: true, name: 'Awa', email: 'a@b.cd' });
    expect(corpsSoumission(CHAMPS, {}, 't', true, 'robot')).toMatchObject({ website: 'robot' });
  });

  it('première erreur par champ', () => {
    expect(
      erreursParChamp([
        { path: 'email', message: 'A' },
        { path: 'email', message: 'B' },
        { path: 'consent', message: 'C' },
      ]),
    ).toEqual({ email: 'A', consent: 'C' });
  });

  it('messages des refus', () => {
    expect(messageRefus(null, 0, 'r')).toMatch(/réseau/);
    expect(messageRefus('LEAD_FORM_NOT_FOUND', 404, 'r')).toMatch(/pas disponible/);
    expect(messageRefus('LEAD_FORM_RATE_LIMITED', 429, 'Trop de demandes.')).toBe(
      'Trop de demandes.',
    );
  });

  it('couleur : hexadécimal seulement (aucune injection de style)', () => {
    expect(couleurSure('#1A2b3c')).toBe('#1A2b3c');
    expect(couleurSure('red;background:url(x)')).toBeNull();
    expect(couleurSure(null)).toBeNull();
  });
});
