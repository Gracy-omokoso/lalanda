// ─────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION DE SIGNATURE — le test le plus important de ce lot (S22b)
//
// Chaque cas ci-dessous correspond à une attaque concrète :
//
//   « aucun en-tête »            → POST direct sur l'URL du webhook;
//   « signature d'un autre corps » → charge modifiée après capture;
//   « secret différent »          → attaquant qui devine le schéma sans la clé;
//   « horodatage périmé »         → rejeu d'un rappel authentique capté;
//   « schéma v0 »                 → dégradation vers un schéma non maîtrisé.
//
// Aucun de ces cas ne doit renvoyer `valid: true`. Le test construit les
// signatures à la main avec `crypto` — c'est la définition de l'algorithme
// Stripe, pas une reformulation de l'implémentation testée.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  hmacSha256Hex,
  parseStripeSignatureHeader,
  SIGNATURE_TOLERANCE_SECONDS,
  timingSafeEqualHex,
  verifyStripeSignature,
} from './webhook-signature.js';

const SECRET = 'whsec_test_0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-08-09T12:00:00.000Z');
const BODY = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }), 'utf8');

/** Fabrique un en-tête `Stripe-Signature` valide, indépendamment du code testé. */
function signHeader(params: {
  body?: Buffer;
  secret?: string;
  at?: Date;
  scheme?: 'v1' | 'v0';
}): string {
  const body = params.body ?? BODY;
  const secret = params.secret ?? SECRET;
  const timestamp = Math.floor((params.at ?? NOW).getTime() / 1000);
  const signed = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
  const signature = createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestamp},${params.scheme ?? 'v1'}=${signature}`;
}

describe('en-tête de signature Stripe', () => {
  it('décompose horodatage et signatures v1', () => {
    const parsed = parseStripeSignatureHeader('t=1700000000,v1=aaa,v1=bbb');
    expect(parsed).toEqual({ timestamp: 1700000000, v1: ['aaa', 'bbb'] });
  });

  it('ignore les schémas inconnus plutôt que de les accepter', () => {
    // `v0` est réservé aux outils de test de Stripe. L'accepter reviendrait à
    // reconnaître un schéma dont on ne maîtrise pas la construction.
    expect(parseStripeSignatureHeader('t=1700000000,v0=aaa')).toBeNull();
  });

  it('refuse un en-tête absent, vide ou sans horodatage', () => {
    expect(parseStripeSignatureHeader(undefined)).toBeNull();
    expect(parseStripeSignatureHeader('')).toBeNull();
    expect(parseStripeSignatureHeader('v1=aaa')).toBeNull();
    expect(parseStripeSignatureHeader('t=pasunnombre,v1=aaa')).toBeNull();
  });
});

describe('comparaison en temps constant', () => {
  it('accepte deux valeurs identiques', () => {
    const a = hmacSha256Hex(SECRET, 'charge');
    expect(timingSafeEqualHex(a, a)).toBe(true);
  });

  it('refuse des longueurs différentes, des valeurs vides et du non-hexadécimal', () => {
    expect(timingSafeEqualHex('aabb', 'aabbcc')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualHex('zzzz', 'aabb')).toBe(false);
  });

  it('refuse une valeur qui ne diffère que du dernier octet', () => {
    const a = hmacSha256Hex(SECRET, 'charge');
    const b = `${a.slice(0, -1)}${a.endsWith('0') ? '1' : '0'}`;
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });
});

describe('vérification de signature Stripe', () => {
  it('accepte un rappel authentique', () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signHeader({}),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ valid: true });
  });

  it("REFUSE un rappel sans en-tête de signature — l'attaque de base", () => {
    // C'est le scénario « quiconque connaît l'URL s'offre un abonnement ».
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: undefined,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'missing_header' });
  });

  it('REFUSE une signature calculée avec un autre secret', () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signHeader({ secret: 'whsec_autre_secret_completement_different' }),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('REFUSE une charge modifiée après signature', () => {
    // Rappel authentique capté, puis `organizationId` remplacé par celui de
    // l'attaquant : la signature ne couvre plus le corps.
    const header = signHeader({ body: BODY });
    const falsifie = Buffer.from(
      JSON.stringify({ id: 'evt_1', type: 'invoice.paid', hacked: true }),
      'utf8',
    );
    const result = verifyStripeSignature({
      rawBody: falsifie,
      header,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('REFUSE un rappel authentique mais trop ancien (rejeu)', () => {
    const vieux = new Date(NOW.getTime() - (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signHeader({ at: vieux }),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  it('REFUSE un rappel daté dans le futur', () => {
    // Un horodatage futur permettrait de fabriquer une charge valide longtemps.
    const futur = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signHeader({ at: futur }),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  it('accepte à la limite exacte de la fenêtre de tolérance', () => {
    const limite = new Date(NOW.getTime() - SIGNATURE_TOLERANCE_SECONDS * 1000);
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: signHeader({ at: limite }),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ valid: true });
  });

  it('accepte quand une seule des signatures fournies est bonne (rotation de secret)', () => {
    const bon = signHeader({});
    const avecIntrus = `${bon},v1=${'0'.repeat(64)}`;
    expect(
      verifyStripeSignature({ rawBody: BODY, header: avecIntrus, secret: SECRET, now: NOW }),
    ).toEqual({ valid: true });
  });

  it('REFUSE quand aucune des signatures fournies ne correspond', () => {
    const header = `t=${Math.floor(NOW.getTime() / 1000)},v1=${'0'.repeat(64)},v1=${'1'.repeat(64)}`;
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET, now: NOW })).toEqual({
      valid: false,
      reason: 'mismatch',
    });
  });

  it('est sensible au moindre octet du corps, espaces compris', () => {
    // Un corps re-sérialisé (`JSON.stringify(JSON.parse(x))`) diffère de
    // l'original par les espaces : vérifier une signature sur du JSON reparsé,
    // c'est ne rien vérifier. Ce test fige cette propriété.
    const espace = Buffer.from(`${BODY.toString('utf8')} `, 'utf8');
    expect(
      verifyStripeSignature({
        rawBody: espace,
        header: signHeader({ body: BODY }),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('REFUSE un corps vide signé pour un autre corps', () => {
    expect(
      verifyStripeSignature({
        rawBody: Buffer.alloc(0),
        header: signHeader({}),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: 'mismatch' });
  });
});
