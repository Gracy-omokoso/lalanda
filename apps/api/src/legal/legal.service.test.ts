// Preuve d'acceptation des conditions (S22c) — ce que ces tests protègent.
//
// Aucun des défauts visés ne se voit à l'exécution : ils produisent une base
// cohérente en apparence et une preuve fausse. On vérifie donc les invariants
// eux-mêmes plutôt que le comportement heureux.

import { LEGAL_VERSION } from '@lalanda/shared/legal';
import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import { AcceptTermsSchema } from './legal.dto.js';
import { LegalService } from './legal.service.js';
import type { TermsAcceptance, TermsAcceptanceDocument } from './terms-acceptance.schema.js';

/**
 * Modèle mongoose réduit à ce que le service utilise réellement :
 * `updateOne` et la chaîne `findOne().sort().lean().exec()`.
 */
function serviceWith(latest: Partial<TermsAcceptance> | null) {
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const exec = vi.fn().mockResolvedValue(latest);
  const lean = vi.fn().mockReturnValue({ exec });
  const sort = vi.fn().mockReturnValue({ lean });
  const findOne = vi.fn().mockReturnValue({ sort });

  const model = { updateOne, findOne } as unknown as Model<TermsAcceptanceDocument>;
  return { service: new LegalService(model), updateOne, findOne, sort };
}

describe('enregistrement de l’acceptation', () => {
  it('écrit en $setOnInsert pour ne jamais déplacer la date d’acceptation', async () => {
    // Une seconde acceptation de la même version est un doublon d'appel (double
    // clic, rejeu), pas un nouvel accord. Si l'écriture passait en `$set`, la
    // date de preuve serait réécrite à chaque rechargement du formulaire et ne
    // désignerait plus le moment où l'utilisateur a réellement accepté.
    const { service, updateOne } = serviceWith({
      termsVersion: LEGAL_VERSION,
      acceptedAt: new Date('2026-08-09T10:00:00.000Z'),
    });

    await service.recordAcceptance('u1', LEGAL_VERSION, new Date('2026-08-09T10:00:00.000Z'));

    const [filter, update, options] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ userId: 'u1', termsVersion: LEGAL_VERSION });
    expect(options).toEqual({ upsert: true });
    expect(Object.keys(update)).toEqual(['$setOnInsert']);
    expect(update['$set']).toBeUndefined();
  });

  it('scope l’écriture sur l’utilisateur reçu, sans autre critère', async () => {
    const { service, updateOne } = serviceWith(null);
    await service.recordAcceptance('u1', LEGAL_VERSION, new Date());
    const [filter] = updateOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter['userId']).toBe('u1');
  });
});

describe('lecture de l’acceptation', () => {
  it('rend l’accord courant quand la dernière version acceptée est celle en vigueur', async () => {
    const { service } = serviceWith({
      termsVersion: LEGAL_VERSION,
      acceptedAt: new Date('2026-08-09T10:00:00.000Z'),
    });

    const view = await service.getAcceptance('u1');

    expect(view.acceptedVersion).toBe(LEGAL_VERSION);
    expect(view.currentVersion).toBe(LEGAL_VERSION);
    expect(view.acceptedAt).toBe('2026-08-09T10:00:00.000Z');
    expect(view.isCurrent).toBe(true);
  });

  it('traite l’absence d’acceptation comme un accord non donné', async () => {
    const { service } = serviceWith(null);

    const view = await service.getAcceptance('u1');

    expect(view.acceptedVersion).toBeNull();
    expect(view.acceptedAt).toBeNull();
    expect(view.isCurrent).toBe(false);
  });

  it('traite une acceptation périmée comme un accord non donné', async () => {
    // Le point est ici : accepter une ANCIENNE version ne vaut pas accepter la
    // nouvelle. Rendre `isCurrent: true` reviendrait à opposer à l'utilisateur
    // un texte qu'il n'a jamais lu.
    const { service } = serviceWith({
      termsVersion: '2020-01-01',
      acceptedAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const view = await service.getAcceptance('u1');

    expect(view.acceptedVersion).toBe('2020-01-01');
    expect(view.isCurrent).toBe(false);
  });

  it('retient la plus récente acceptation, pas la première trouvée', async () => {
    const { service, sort } = serviceWith({ termsVersion: LEGAL_VERSION, acceptedAt: new Date() });
    await service.getAcceptance('u1');
    expect(sort).toHaveBeenCalledWith({ acceptedAt: -1 });
  });
});

describe('validation du corps de la requête', () => {
  it('accepte la version en vigueur', () => {
    expect(AcceptTermsSchema.safeParse({ version: LEGAL_VERSION }).success).toBe(true);
  });

  it('refuse une version jamais publiée', () => {
    // Sans ce refus, un client pourrait enregistrer une version future et ne
    // plus jamais se voir redemander son accord.
    expect(AcceptTermsSchema.safeParse({ version: '2099-01-01' }).success).toBe(false);
    expect(AcceptTermsSchema.safeParse({ version: '' }).success).toBe(false);
  });

  it('refuse un userId glissé dans le corps plutôt que de l’ignorer', () => {
    // `.strict()` transforme la tentative de désigner autrui en 400. Un schéma
    // permissif la laisserait passer en silence, et seule la lecture de la ligne
    // qui prend l'utilisateur dans la session dirait qu'elle est sans effet.
    const res = AcceptTermsSchema.safeParse({ version: LEGAL_VERSION, userId: 'victime' });
    expect(res.success).toBe(false);
  });
});
