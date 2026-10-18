// Règles pures du module fiscal — sans MongoDB (ADR-0021 §3, §4.1, §6, §10).
//
// Ce qui se prouve sans base : le contrôle d'un statut DGI, l'état calculé d'un
// point de vente, le contrôle croisé des taux, la normalisation du NIF, les
// routes qui exigent la ré-authentification, le seul écrivain du réglage de
// facture normalisée, et la fidélité du faux coffre en mémoire au contrat.

import 'reflect-metadata';

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { EdefInfoStatus } from '../edef/edef.types.js';
import { REQUIRES_RECENT_REAUTH_KEY } from '../integrations/reauth.guard.js';
import { normalizeNif, PutFiscalProfileSchema } from './fiscal.dto.js';
import { NormalizedInvoicingController } from './normalized-invoicing.controller.js';
import { evaluateStatus, parseDgiDate, statusOf } from './points-of-sale.service.js';
import { crossCheckTaxGroups } from './reference-data.service.js';
import { InMemoryOrganizationSecrets } from './testing/in-memory-organization-secrets.js';

const NOW = new Date('2026-10-20T09:00:00Z');

function info(over: Partial<EdefInfoStatus> = {}): EdefInfoStatus {
  return {
    status: true,
    version: '2.0',
    nif: 'A0000000X',
    nim: 'XX01000001-1',
    tokenValid: '2027-01-31T00:00:00',
    serverDateTime: '2026-10-20T09:00:00',
    emcfList: [
      {
        nim: 'XX01000001-1',
        status: 'Actif',
        shopName: 'Boutique',
        address1: 'Rue 1',
        address2: null,
        address3: 'Kinshasa',
        contact1: '+243',
        contact2: null,
        contact3: null,
      },
    ],
    ...over,
  };
}

describe('evaluateStatus — test du jeton (ADR-0021 §4.1)', () => {
  const base = { expectedNim: null, profileNif: 'A0000000X' };

  it('succès : relevé DGI complet, adresse et contacts sans valeurs vides', () => {
    const out = evaluateStatus(info(), base, [], NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dgi).toMatchObject({
      nif: 'A0000000X',
      nim: 'XX01000001-1',
      emcfStatus: 'Actif',
      address: ['Rue 1', 'Kinshasa'],
      contacts: ['+243'],
      apiVersion: '2.0',
    });
    expect(out.dgi.tokenValidUntil.toISOString()).toBe('2027-01-31T00:00:00.000Z');
  });

  const echecs: Array<[string, Partial<EdefInfoStatus>, Partial<typeof base>, string]> = [
    ['status = false', { status: false }, {}, 'EMCF_STATUS_FALSE'],
    ['NIF différent', { nif: 'B1111111Y' }, {}, 'EMCF_NIF_MISMATCH'],
    ['NIM attendu différent', {}, { expectedNim: 'XX09999999-1' }, 'EMCF_NIM_MISMATCH'],
    ['jeton expiré', { tokenValid: '2026-10-01T00:00:00' }, {}, 'EMCF_TOKEN_EXPIRED'],
    ['date illisible', { tokenValid: 'demain' }, {}, 'EDEF_INVALID_RESPONSE'],
    ['NIM absent', { nim: null }, {}, 'EDEF_INVALID_RESPONSE'],
  ];
  for (const [libelle, over, opts, code] of echecs) {
    it(`${libelle} → ${code}`, () => {
      const out = evaluateStatus(info(over), { ...base, ...opts }, [], NOW);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.code).toBe(code);
      expect(out.http).toBe(422);
    });
  }

  it('e-MCF désactivé à la DGI → EMCF_DISABLED_AT_DGI, quelle que soit l’accentuation', () => {
    for (const status of ['Désactivé', 'desactive', 'DÉSACTIVÉ']) {
      const out = evaluateStatus(
        info({ emcfList: [{ ...info().emcfList[0]!, status }] }),
        base,
        [],
        NOW,
      );
      expect(!out.ok && out.code, status).toBe('EMCF_DISABLED_AT_DGI');
    }
  });

  it('le NIF DGI est comparé après normalisation', () => {
    expect(evaluateStatus(info({ nif: 'a 000-0000x' }), base, [], NOW).ok).toBe(true);
  });

  it('une date DGI sans fuseau est lue en UTC', () => {
    expect(parseDgiDate('2027-01-31T00:00:00')?.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(parseDgiDate('2027-01-31T00:00:00+01:00')?.toISOString()).toBe(
      '2027-01-30T23:00:00.000Z',
    );
  });
});

describe('statusOf — état calculé, dans l’ordre du §4.1', () => {
  const dgi = {
    nif: 'A0000000X',
    nim: 'N1',
    tokenValidUntil: new Date('2027-01-01T00:00:00Z'),
    emcfStatus: 'Actif',
    shopName: null,
    address: [],
    contacts: [],
    apiVersion: '2.0',
    checkedAt: NOW,
  };
  const ok = { at: NOW, ok: true, code: null, message: 'Connexion réussie.' };

  it('disabled › token_missing › nif_mismatch › token_expired › failing › active', () => {
    expect(statusOf({ enabled: false, dgi, lastTest: ok }, true, 'A0000000X', NOW)).toBe(
      'disabled',
    );
    expect(statusOf({ enabled: true, dgi, lastTest: ok }, false, 'A0000000X', NOW)).toBe(
      'token_missing',
    );
    expect(statusOf({ enabled: true, dgi, lastTest: ok }, true, 'B1111111Y', NOW)).toBe(
      'nif_mismatch',
    );
    expect(
      statusOf(
        { enabled: true, dgi: { ...dgi, tokenValidUntil: new Date('2026-01-01') }, lastTest: ok },
        true,
        'A0000000X',
        NOW,
      ),
    ).toBe('token_expired');
    expect(
      statusOf({ enabled: true, dgi, lastTest: { ...ok, ok: false } }, true, 'A0000000X', NOW),
    ).toBe('failing');
    expect(statusOf({ enabled: true, dgi, lastTest: ok }, true, 'A0000000X', NOW)).toBe('active');
  });
});

describe('crossCheckTaxGroups — garde-fou du pack (ADR-0021 §6)', () => {
  const pack = {
    tva_taux_normal: { valeur: 0.16 },
    tva_taux_reduit: { valeur: 0.05 },
    tva_taux_reduit_1pct: { valeur: 0.01 },
  };

  it('aucun avertissement quand les taux concordent', () => {
    expect(crossCheckTaxGroups({ a: 0, b: 16, c: 5, o: 1 }, pack)).toEqual([]);
  });

  it('taux du groupe C différent → TAX_RATE_DIFFERS_FROM_PACK, non bloquant', () => {
    expect(crossCheckTaxGroups({ b: 16, c: 8, o: 1 }, pack)).toEqual([
      { code: 'TAX_RATE_DIFFERS_FROM_PACK', group: 'c', dgi: 8, pack: 5 },
    ]);
  });

  it('groupe absent de la réponse DGI → avertissement avec dgi = null', () => {
    expect(crossCheckTaxGroups({ b: 16, c: 5 }, pack)).toEqual([
      { code: 'TAX_RATE_DIFFERS_FROM_PACK', group: 'o', dgi: null, pack: 1 },
    ]);
  });
});

describe('fiche fiscale — validation (ADR-0021 §2, §13)', () => {
  const corps = {
    legalName: '  Exemple SARL ',
    tradeName: null,
    legalForm: 'sarl',
    legalFormOther: null,
    nif: 'a 000-0000x',
    rccm: null,
    nationalId: null,
    vatRegistered: true,
    headOffice: {
      line1: '1, avenue Exemple',
      line2: null,
      commune: 'Gombe',
      city: 'Kinshasa',
      province: 'Kinshasa',
      country: 'cd',
    },
    phone: '+243 800 000 000',
    email: 'facturation@exemple.cd',
  };

  it('normalise le NIF et retire les espaces de bord', () => {
    const out = PutFiscalProfileSchema.parse(corps);
    expect(out.nif).toBe('A0000000X');
    expect(out.legalName).toBe('Exemple SARL');
    expect(out.headOffice.country).toBe('CD');
    expect(normalizeNif('ab-12 34')).toBe('AB1234');
  });

  it('refuse un champ inconnu, et « autre » sans précision', () => {
    expect(PutFiscalProfileSchema.safeParse({ ...corps, isf: 'X' }).success).toBe(false);
    expect(PutFiscalProfileSchema.safeParse({ ...corps, legalForm: 'autre' }).success).toBe(false);
    expect(
      PutFiscalProfileSchema.safeParse({ ...corps, legalForm: 'autre', legalFormOther: 'Mutuelle' })
        .success,
    ).toBe(true);
  });
});

describe('ré-authentification — les six écritures sensibles du §10', () => {
  const proto = NormalizedInvoicingController.prototype as unknown as Record<string, object>;
  const exigees = Object.getOwnPropertyNames(NormalizedInvoicingController.prototype)
    .filter((nom) => nom !== 'constructor')
    .filter((nom) => Reflect.getMetadata(REQUIRES_RECENT_REAUTH_KEY, proto[nom]!) === true)
    .sort();

  it('exactement : activation, désactivation, environnement, création, jeton, retrait', () => {
    expect(exigees).toEqual(
      [
        'activate',
        'createPointOfSale',
        'deactivate',
        'disablePointOfSale',
        'environment',
        'replaceToken',
      ].sort(),
    );
  });
});

describe('R4 — seul NormalizedInvoicingService écrit normalized_invoicing_settings', () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const fichiers: string[] = [];
  const parcourir = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) parcourir(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) fichiers.push(p);
    }
  };
  parcourir(src);

  const importeurs = fichiers
    .filter((f) => readFileSync(f, 'utf8').includes('normalized-invoicing-settings.schema'))
    .map((f) => relative(src, f))
    .sort();

  it('seuls le service, le lecteur et le module importent le modèle', () => {
    expect(importeurs).toEqual(
      [
        'fiscal/fiscal.module.ts',
        'fiscal/normalized-invoicing-state.reader.ts',
        'fiscal/normalized-invoicing.service.ts',
      ].sort(),
    );
  });

  it('le lecteur ne contient aucune méthode d’écriture', () => {
    const lecteur = readFileSync(
      resolve(src, 'fiscal/normalized-invoicing-state.reader.ts'),
      'utf8',
    )
      // Les commentaires peuvent parler d'écriture ; le code, non.
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(lecteur).not.toMatch(
      /\.(updateOne|updateMany|findOneAndUpdate|findOneAndReplace|replaceOne|create|insertMany|deleteOne|deleteMany|findOneAndDelete|bulkWrite|save)\(/,
    );
  });
});

describe('faux coffre en mémoire — fidélité au contrat OrganizationSecretsPort', () => {
  const ref = { organizationId: 'org-1', kind: 'dgi_emcf_token' as const, ownerId: 'pos-1' };
  const VALEUR = 'ANTIFUITE-jeton-faux-coffre-0123456789';

  it('aller-retour, description sans valeur, last4, destruction', async () => {
    const coffre = new InMemoryOrganizationSecrets();
    const desc = await coffre.put(ref, VALEUR, 'u1');
    expect(desc).toMatchObject({ configured: true, last4: VALEUR.slice(-4), updatedBy: 'u1' });
    expect(JSON.stringify(desc)).not.toContain(VALEUR);
    const secret = await coffre.resolve(ref);
    expect(secret?.expose()).toBe(VALEUR);
    expect(JSON.stringify(secret)).not.toContain(VALEUR);
    expect(inspect(secret)).not.toContain(VALEUR);
    expect(
      (await coffre.describeMany('org-1', 'dgi_emcf_token', ['pos-1', 'pos-2'])).get('pos-2'),
    ).toMatchObject({ configured: false });
    await coffre.destroy(ref);
    expect(await coffre.resolve(ref)).toBeNull();
  });

  it('isolé par organisation', async () => {
    const coffre = new InMemoryOrganizationSecrets();
    await coffre.put(ref, VALEUR, 'u1');
    expect(await coffre.resolve({ ...ref, organizationId: 'org-2' })).toBeNull();
  });
});
