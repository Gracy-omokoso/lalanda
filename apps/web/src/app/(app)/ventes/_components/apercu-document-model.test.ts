import { describe, expect, it } from 'vitest';

import {
  adresseValide,
  lecteurPdfIntegre,
  lireCopies,
  messageErreurEnvoi,
  messageResultat,
  phraseConfirmation,
  raisonSansDroit,
  verifierEnvoi,
} from './apercu-document-model';

const ok = { to: 'client@exemple.cd', cc: '', subject: 'Facture', message: 'Bonjour' };

describe('verifierEnvoi', () => {
  it('produit le corps attendu, copies découpées', () => {
    const r = verifierEnvoi({ ...ok, cc: 'a@b.cd; c@d.cd ,' });
    expect(r.erreurs).toEqual({});
    expect(r.corps).toEqual({
      to: 'client@exemple.cd',
      cc: ['a@b.cd', 'c@d.cd'],
      subject: 'Facture',
      message: 'Bonjour',
    });
  });

  it('signale adresse invalide, doublon, objet vide, message trop long', () => {
    expect(verifierEnvoi({ ...ok, to: 'x' }).erreurs.to).toBeDefined();
    expect(verifierEnvoi({ ...ok, cc: 'CLIENT@exemple.cd' }).erreurs.cc).toMatch(/deux fois/);
    expect(verifierEnvoi({ ...ok, cc: 'a@b' }).erreurs.cc).toMatch(/invalide/);
    expect(verifierEnvoi({ ...ok, cc: 'a@b.c,b@b.c,c@b.c,d@b.c,e@b.c,f@b.c' }).erreurs.cc).toMatch(
      /Cinq/,
    );
    expect(verifierEnvoi({ ...ok, subject: '  ' }).erreurs.subject).toBeDefined();
    expect(verifierEnvoi({ ...ok, message: 'x'.repeat(5001) }).erreurs.message).toBeDefined();
    expect(verifierEnvoi({ ...ok, to: 'x' }).corps).toBeNull();
  });
});

describe('textes', () => {
  it('adresses et copies', () => {
    expect(adresseValide(' a@b.cd ')).toBe(true);
    expect(adresseValide('a@b')).toBe(false);
    expect(lireCopies('')).toEqual([]);
  });

  it('raison sans droit, confirmation, résultat', () => {
    expect(raisonSansDroit('facture')).toMatch(/émettent/);
    expect(raisonSansDroit('devis')).toMatch(/devis/);
    expect(
      phraseConfirmation({ to: 'a@b.cd', cc: ['c@d.cd'], subject: 's', message: '' }, 'F.pdf'),
    ).toBe('Envoyer F.pdf à a@b.cd (copie : c@d.cd) ?');
    expect(messageResultat({ delivered: true, reason: null, to: 'a@b.cd', cc: [] })).toEqual({
      ok: true,
      texte: 'E-mail envoyé à a@b.cd.',
    });
    expect(
      messageResultat({ delivered: false, reason: 'MAIL_NOT_CONFIGURED', to: 'a@b.cd', cc: [] }).ok,
    ).toBe(false);
  });

  it('erreurs HTTP : rôle, débit (message de l’API), saisie', () => {
    expect(messageErreurEnvoi({ status: 403 })).toMatch(/rôle/);
    expect(
      messageErreurEnvoi({
        status: 429,
        detail: { code: 'DOCUMENT_EMAIL_RATE_LIMITED', message: 'Réessayez dans 5 minutes.' },
      }),
    ).toBe('Réessayez dans 5 minutes.');
    expect(messageErreurEnvoi({ status: 400, detail: { code: 'INVALID_REQUEST' } })).toMatch(
      /adresses/,
    );
    expect(messageErreurEnvoi(null)).toBe('Envoi impossible.');
  });

  it('lecteur PDF intégré : seul `false` explicite le refuse', () => {
    expect(lecteurPdfIntegre({ pdfViewerEnabled: false })).toBe(false);
    expect(lecteurPdfIntegre({ pdfViewerEnabled: true })).toBe(true);
    expect(lecteurPdfIntegre({})).toBe(true);
    expect(lecteurPdfIntegre(undefined)).toBe(true);
  });
});
