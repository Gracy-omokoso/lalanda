import { describe, expect, it } from 'vitest';

import {
  PHRASE_PAS_ENCORE,
  formatJour,
  identifiantExistant,
  lienCommande,
  messageAchats,
  nomPersonne,
  peutApprouverAchats,
  peutLireAchats,
  tonStatut,
} from './achats-model';

describe('droits lus dans les actions du serveur', () => {
  it('jamais vrais tant que les actions sont inconnues', () => {
    expect(peutLireAchats(null)).toBe(false);
    expect(peutApprouverAchats(['purchase.read'])).toBe(false);
    expect(peutApprouverAchats(['purchase.approve'])).toBe(true);
  });
});

describe('messageAchats', () => {
  it('404 : la route n’existe pas encore, aucune donnée inventée', () => {
    expect(messageAchats({ status: 404 }, 'x')).toBe(PHRASE_PAS_ENCORE);
  });
  it('codes métier traduits, avant le statut', () => {
    expect(
      messageAchats({ status: 409, detail: { code: 'SELF_APPROVAL_FORBIDDEN' } }, 'x'),
    ).toMatch(/séparation des tâches/);
    expect(messageAchats({ status: 409, detail: { code: 'STALE_REVISION' } }, 'x')).toMatch(
      /Rechargez/,
    );
  });
  it('403, 429, message de l’API, repli', () => {
    expect(messageAchats({ status: 403 }, 'x')).toMatch(/rôle/);
    expect(messageAchats({ status: 429 }, 'x')).toMatch(/réessayez/);
    expect(messageAchats({ status: 400, detail: { message: 'Champ requis.' } }, 'x')).toBe(
      'Champ requis.',
    );
    expect(messageAchats(null, 'Repli.')).toBe('Repli.');
  });
  it('identifiant existant d’un doublon de NIF', () => {
    expect(identifiantExistant({ detail: { details: { existingId: 'abc' } } })).toBe('abc');
    expect(identifiantExistant({ detail: {} })).toBeNull();
  });
});

describe('affichage', () => {
  it('dates civiles sans fuseau', () => {
    expect(formatJour('2026-03-02')).toBe('2 mars 2026');
    expect(formatJour(null)).toBe('—');
  });
  it('tons et liens', () => {
    expect(tonStatut('submitted')).toBe('warning');
    expect(tonStatut('cancelled')).toBe('danger');
    expect(lienCommande('a b')).toBe('/achats/commandes/a%20b');
  });
  it('« vous », le nom du membre, ou « un membre »', () => {
    const m = [{ userId: 'u1', name: 'Awa' }];
    expect(nomPersonne(m, 'u1', 'u1')).toBe('vous');
    expect(nomPersonne(m, 'u1', null)).toBe('Awa');
    expect(nomPersonne([], 'u2', null)).toBe('un membre');
  });
});

// ADR-0044 — P8 : un 404 PORTANT un code (facture introuvable) n'est pas une route absente.
describe('messageAchats — codes des réceptions, factures et paiements', () => {
  it('404 avec code : message du code, pas « pas encore disponible »', () => {
    expect(
      messageAchats({ status: 404, detail: { code: 'SUPPLIER_INVOICE_NOT_FOUND' } }, 'x'),
    ).toBe('Facture fournisseur introuvable.');
  });
  it('doublon, écart, litige, paiement, dépense possédée', () => {
    for (const code of [
      'SUPPLIER_INVOICE_DUPLICATE',
      'SUPPLIER_INVOICE_VARIANCE',
      'SUPPLIER_INVOICE_DISPUTED',
      'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH',
      'SUPPLIER_PAYMENT_EXCEEDS_REMAINING',
      'EXPENSE_OWNED_BY_PURCHASES',
      'PURCHASE_ORDER_NOT_RECEIVABLE',
    ]) {
      const m = messageAchats({ status: 409, detail: { code, message: 'brut' } }, 'x');
      expect(m).not.toBe('brut');
      expect(m.length).toBeGreaterThan(10);
    }
  });
});
