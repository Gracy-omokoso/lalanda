// ADR-0052 — O5 : invitation suivie à travers l'inscription.

import { describe, expect, it } from 'vitest';

import {
  COOKIE_INVITATION,
  cheminAcceptation,
  effacementCookieInvitation,
  jetonInvitationValide,
  lireJetonInvitation,
  messageRefusInvitation,
} from './invitation-en-attente';

const JETON = 'a'.repeat(64);

describe('invitation suivie (ADR-0052 — O5)', () => {
  it('n’admet que le format de jeton émis par l’API', () => {
    expect(jetonInvitationValide(JETON)).toBe(true);
    expect(jetonInvitationValide('A'.repeat(64))).toBe(false);
    expect(jetonInvitationValide('a'.repeat(63))).toBe(false);
    expect(jetonInvitationValide('<script>')).toBe(false);
    expect(jetonInvitationValide(null)).toBe(false);
  });

  it('lit le jeton dans les cookies, ignore un jeton altéré', () => {
    expect(lireJetonInvitation(`x=1; ${COOKIE_INVITATION}=${JETON}; y=2`)).toBe(JETON);
    expect(lireJetonInvitation(`${COOKIE_INVITATION}=abc`)).toBeNull();
    expect(lireJetonInvitation('x=1')).toBeNull();
    expect(lireJetonInvitation(`${COOKIE_INVITATION}=%E0%A4%A`)).toBeNull();
  });

  it('mène à la page d’acceptation et sait effacer le cookie', () => {
    expect(cheminAcceptation(JETON)).toBe(`/invitations/accept?token=${JETON}`);
    expect(effacementCookieInvitation()).toContain('Max-Age=0');
  });

  it('traduit les refus de l’API en français simple', () => {
    expect(messageRefusInvitation({ detail: { code: 'INVITATION_EXPIRED' } })).toMatch(/expiré/);
    expect(messageRefusInvitation({ detail: { code: 'INVITATION_EMAIL_MISMATCH' } })).toMatch(
      /autre adresse/,
    );
    expect(messageRefusInvitation(new Error('x'))).toMatch(/Impossible/);
  });
});
