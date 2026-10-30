import { describe, expect, it } from 'vitest';

import {
  acceptErrorMessage,
  canAccept,
  phaseFromAcceptance,
  phaseFromCheckError,
} from './terms-gate-model';

const AFFICHEE = '2026-10-30';

describe('phase de l’écran de nouvelle acceptation', () => {
  it('n’affiche rien pour un utilisateur à jour', () => {
    expect(
      phaseFromAcceptance(
        { currentVersion: AFFICHEE, acceptedVersion: AFFICHEE, isCurrent: true },
        AFFICHEE,
      ),
    ).toEqual({ kind: 'current' });
  });

  it('bloque un utilisateur dont l’accord porte sur le corpus précédent', () => {
    expect(
      phaseFromAcceptance(
        { currentVersion: AFFICHEE, acceptedVersion: '2026-08-09', isCurrent: false },
        AFFICHEE,
      ),
    ).toEqual({ kind: 'required', previousVersion: '2026-08-09' });
  });

  it('bloque un compte sans aucun accord (Google, comptes anciens)', () => {
    expect(
      phaseFromAcceptance(
        { currentVersion: AFFICHEE, acceptedVersion: null, isCurrent: false },
        AFFICHEE,
      ),
    ).toEqual({ kind: 'required', previousVersion: null });
  });

  it('demande de recharger si le serveur exige une version que la page n’affiche pas', () => {
    // Enregistrer la version affichée serait un accord sur un texte périmé ;
    // enregistrer celle du serveur, un accord sur un texte jamais lu.
    expect(
      phaseFromAcceptance(
        { currentVersion: '2027-01-01', acceptedVersion: AFFICHEE, isCurrent: false },
        AFFICHEE,
      ),
    ).toEqual({ kind: 'reload', serverVersion: '2027-01-01' });
  });

  it('ne bloque pas sur un échec réseau : bandeau avec « Réessayer »', () => {
    expect(phaseFromCheckError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'check-failed',
    });
    expect(phaseFromCheckError(Object.assign(new Error('HTTP 503'), { status: 503 }))).toEqual({
      kind: 'check-failed',
    });
  });

  it('n’affiche rien sans session', () => {
    expect(phaseFromCheckError(Object.assign(new Error('HTTP 401'), { status: 401 }))).toEqual({
      kind: 'current',
    });
  });
});

describe('bouton « Accepter »', () => {
  it('reste inactif tant que la case n’est pas cochée', () => {
    expect(canAccept({ checked: false, busy: false })).toBe(false);
    expect(canAccept({ checked: true, busy: false })).toBe(true);
  });

  it('est inactif pendant l’envoi', () => {
    expect(canAccept({ checked: true, busy: true })).toBe(false);
  });
});

describe('message d’échec de l’enregistrement', () => {
  it('propose de réessayer après un échec réseau', () => {
    expect(acceptErrorMessage(new TypeError('Failed to fetch'))).toMatch(/réessayez/);
  });

  it('signale une session expirée', () => {
    expect(acceptErrorMessage({ status: 401 })).toMatch(/session a expiré/);
  });

  it('signale une version refusée par le serveur', () => {
    expect(acceptErrorMessage({ status: 400 })).toMatch(/Rechargez la page/);
  });
});
