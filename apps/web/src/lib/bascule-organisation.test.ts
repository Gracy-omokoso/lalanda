// ADR-0052 — O1/O5 : bascule d'organisation sans état survivant.

import { describe, expect, it } from 'vitest';

import {
  CLE_MESSAGE_BASCULE,
  CLES_SESSION_ORGANISATION,
  basculerOrganisation,
  destinationSure,
  messageBascule,
  prendreMessageBascule,
  type EnvironnementBascule,
} from './bascule-organisation';

function faux(): EnvironnementBascule & {
  journal: string[];
  stock: Map<string, string>;
} {
  const journal: string[] = [];
  const stock = new Map<string, string>([
    ['lalanda.fiscalite.reprise', '{"action":"activer"}'],
    ['autre', 'garde'],
  ]);
  return {
    journal,
    stock,
    poserCookie: (id) => journal.push(`cookie:${id}`),
    session: {
      removeItem: (k) => {
        stock.delete(k);
      },
      setItem: (k, v) => {
        stock.set(k, v);
      },
    },
    recharger: (d) => journal.push(`recharger:${d}`),
  };
}

describe('basculerOrganisation (ADR-0052 — O1, O5)', () => {
  it('pose le cookie, efface les reprises de l’ancienne organisation, laisse le message, puis recharge', () => {
    const env = faux();
    basculerOrganisation({ id: 'org-b', name: 'Bantu SARL' }, '/accueil', env);
    expect(env.journal).toEqual(['cookie:org-b', 'recharger:/accueil']);
    for (const cle of CLES_SESSION_ORGANISATION) expect(env.stock.has(cle)).toBe(false);
    expect(env.stock.get('autre')).toBe('garde');
    expect(env.stock.get(CLE_MESSAGE_BASCULE)).toBe(
      'Vous êtes maintenant dans l’espace de Bantu SARL.',
    );
  });

  it('création : mène à la mise en route ; une destination externe est refusée', () => {
    const env = faux();
    basculerOrganisation({ id: 'org-c' }, '/organisation/mise-en-route?etape=societe', env);
    expect(env.journal.at(-1)).toBe('recharger:/organisation/mise-en-route?etape=societe');
    basculerOrganisation({ id: 'org-c' }, '//exemple.com', env);
    expect(env.journal.at(-1)).toBe('recharger:/accueil');
  });

  it('stockage indisponible : la bascule se fait quand même', () => {
    const env = { ...faux(), session: null };
    basculerOrganisation({ id: 'org-b' }, undefined, env);
    expect(env.journal).toEqual(['cookie:org-b', 'recharger:/accueil']);
  });
});

describe('messages de bascule', () => {
  it('nomme l’organisation, avec un repli neutre', () => {
    expect(messageBascule('  Kin Agro ')).toBe('Vous êtes maintenant dans l’espace de Kin Agro.');
    expect(messageBascule('')).toBe('Vous êtes maintenant dans l’espace de cette organisation.');
  });

  it('le message n’est lu qu’une fois', () => {
    const stock = new Map([[CLE_MESSAGE_BASCULE, 'Vous êtes maintenant dans l’espace de A.']]);
    const session = {
      getItem: (k: string) => stock.get(k) ?? null,
      removeItem: (k: string) => {
        stock.delete(k);
      },
    };
    expect(prendreMessageBascule(session)).toBe('Vous êtes maintenant dans l’espace de A.');
    expect(prendreMessageBascule(session)).toBeNull();
    expect(prendreMessageBascule(null)).toBeNull();
  });

  it('destinationSure n’admet que des chemins internes', () => {
    expect(destinationSure('/accueil')).toBe('/accueil');
    expect(destinationSure('https://x.y')).toBe('/accueil');
  });
});
