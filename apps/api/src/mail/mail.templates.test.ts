// Gabarits des emails (S22a).
//
// Ces tests protègent trois propriétés qui, une fois cassées, ne se voient qu'en
// production dans la boîte de quelqu'un d'autre :
//   1. aucune ressource distante (confidentialité du destinataire);
//   2. variante texte COMPLÈTE, lien compris (un client sans HTML doit pouvoir
//      terminer l'opération);
//   3. échappement des données utilisateur (un nom d'organisation est une saisie).

import { describe, expect, it } from 'vitest';

import {
  renderEmailVerification,
  renderInvitation,
  renderPasswordReset,
} from './mail.templates.js';

const ALL = [
  renderEmailVerification({ url: 'https://app.exemple.com/v?token=abc', expiresInHours: 24 }),
  renderEmailVerification({
    url: 'https://app.exemple.com/v?token=abc',
    expiresInHours: 24,
    isEmailChange: true,
  }),
  renderInvitation({
    url: 'https://app.exemple.com/i?token=abc',
    organizationName: 'Boulangerie du Fleuve',
    roleLabel: 'Comptable',
    inviterName: 'Aline',
    expiresAt: new Date('2026-09-01T10:00:00Z'),
  }),
  renderPasswordReset({ url: 'https://app.exemple.com/p?token=abc', expiresInMinutes: 30 }),
];

describe('gabarits — propriétés communes aux trois emails', () => {
  it('ne charge aucune ressource distante : ni image, ni feuille de style, ni script', () => {
    for (const mail of ALL) {
      expect(mail.html).not.toMatch(/<img\b/i);
      expect(mail.html).not.toMatch(/<script\b/i);
      expect(mail.html).not.toMatch(/<link\b/i);
      expect(mail.html).not.toMatch(/background-image\s*:/i);
      // Le SEUL usage autorisé d'une URL externe est le lien d'action lui-même
      // (attribut href), jamais un chargement automatique à l'ouverture.
      expect(mail.html).not.toMatch(/\bsrc\s*=/i);
    }
  });

  it('porte un sujet en français et un corps non vide', () => {
    for (const mail of ALL) {
      expect(mail.subject.length).toBeGreaterThan(10);
      expect(mail.subject).toContain('Lalanda');
      expect(mail.html.length).toBeGreaterThan(200);
      expect(mail.text.length).toBeGreaterThan(80);
    }
  });

  it("inclut le lien d'action dans la variante texte, pas seulement dans le HTML", () => {
    for (const mail of ALL) {
      expect(mail.text).toContain('https://app.exemple.com/');
    }
  });

  it('affiche le lien en clair dans le HTML, sous le bouton', () => {
    // Un bouton dont on ne peut pas lire la destination a la forme exacte d'un
    // email d'hameçonnage.
    for (const mail of ALL) {
      expect(mail.html).toContain('Si le bouton ne fonctionne pas');
    }
  });
});

describe('vérification d’adresse', () => {
  it('distingue l’inscription du changement d’adresse', () => {
    const inscription = renderEmailVerification({ url: 'https://x/1', expiresInHours: 24 });
    const changement = renderEmailVerification({
      url: 'https://x/1',
      expiresInHours: 24,
      isEmailChange: true,
    });

    expect(inscription.subject).not.toBe(changement.subject);
    expect(changement.text).toContain('votre adresse actuelle reste inchangée');
  });

  it('annonce la durée de validité et l’usage unique', () => {
    const mail = renderEmailVerification({ url: 'https://x/1', expiresInHours: 24 });
    expect(mail.text).toContain('valable 24 heures');
    expect(mail.text).toContain('une seule fois');
  });

  it('salue par le nom quand il est connu, neutrement sinon', () => {
    expect(
      renderEmailVerification({ url: 'https://x', expiresInHours: 24, name: 'Aline' }).text,
    ).toContain('Bonjour Aline,');
    expect(
      renderEmailVerification({ url: 'https://x', expiresInHours: 24, name: '  ' }).text,
    ).toContain('Bonjour,');
  });
});

describe('invitation', () => {
  it("annonce l'organisation, le rôle et l'expiration", () => {
    const mail = renderInvitation({
      url: 'https://x/i',
      organizationName: 'Boulangerie du Fleuve',
      roleLabel: 'Comptable',
      inviterName: 'Aline',
      expiresAt: new Date('2026-09-01T10:00:00Z'),
    });

    expect(mail.subject).toContain('Boulangerie du Fleuve');
    // Le rôle doit être lisible AVANT l'acceptation : sinon on demande un
    // consentement sur ce qu'on ne montre qu'après.
    expect(mail.text).toContain('Comptable');
    expect(mail.text).toContain('Aline vous invite');
    expect(mail.text).toContain('1 septembre 2026');
    expect(mail.text).toContain('UTC');
  });

  it("reste lisible quand l'inviteur n'a pas de nom", () => {
    const mail = renderInvitation({
      url: 'https://x/i',
      organizationName: 'Org',
      roleLabel: 'Viewer',
      expiresAt: new Date('2026-09-01T10:00:00Z'),
    });
    expect(mail.text).toContain('Vous êtes invité·e');
  });

  it('échappe le nom d’organisation : une saisie utilisateur ne réécrit pas le message', () => {
    const mail = renderInvitation({
      url: 'https://x/i',
      organizationName: '<script>alert(1)</script>',
      roleLabel: 'Viewer',
      expiresAt: new Date('2026-09-01T10:00:00Z'),
    });

    expect(mail.html).not.toContain('<script>alert(1)</script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('réinitialisation de mot de passe', () => {
  it('annonce une expiration courte et l’usage unique', () => {
    const mail = renderPasswordReset({ url: 'https://x/p', expiresInMinutes: 30 });

    expect(mail.text).toContain('valable 30 minutes');
    expect(mail.text).toContain('une seule fois');
  });

  it('rassure explicitement le destinataire qui n’a rien demandé', () => {
    // Ce paragraphe n'est pas décoratif : sans lui, un email de réinitialisation
    // non sollicité ressemble à une intrusion réussie et pousse à cliquer.
    const mail = renderPasswordReset({ url: 'https://x/p', expiresInMinutes: 30 });
    expect(mail.text).toContain('votre mot de passe actuel reste valable');
    expect(mail.text).toContain("personne n'a accédé à votre compte");
  });

  it('ne divulgue aucune donnée du compte', () => {
    const mail = renderPasswordReset({ url: 'https://x/p', expiresInMinutes: 30, name: 'Aline' });
    // Le nom est la seule donnée personnelle admise (elle vient du compte visé) ;
    // ni organisation, ni adresse, ni rôle ne doivent apparaître.
    expect(mail.text).not.toMatch(/@/);
  });
});
