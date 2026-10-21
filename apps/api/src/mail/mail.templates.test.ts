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
  renderNormalizationAlert,
  renderNormalizedInvoicingDisabled,
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
  // ADR-0021, décision n° 5 — mêmes contraintes ADR-0014 § 2 que les trois autres.
  renderNormalizedInvoicingDisabled({
    url: 'https://app.exemple.com/organisation/fiscalite',
    organizationName: 'Boulangerie du Fleuve',
    deactivatedAt: new Date('2026-10-20T09:00:00Z'),
    reason: 'Passage temporaire à un autre logiciel de facturation.',
    actorName: 'Aline',
  }),
  // ADR-0024, décision ouverte n° 3 (amendement du 21 oct. 2026) : les quatre causes.
  ...(
    ['normalization_uncertain', 'number_abandoned', 'token_rejected', 'token_expired'] as const
  ).map((cause) =>
    renderNormalizationAlert({
      cause,
      url: 'https://app.exemple.com/ventes/factures/abc',
      organizationName: 'Boulangerie du Fleuve',
      subjectLabel: 'PF2610-000042',
      since: new Date('2026-10-21T09:00:00Z'),
      number: 'IN2610-000042',
    }),
  ),
];

describe('gabarits — propriétés communes aux trois emails', () => {
  it('ne charge aucune ressource distante : ni image, ni feuille de style, ni script', () => {
    for (const mail of ALL) {
      expect(mail.html).not.toMatch(/<script\b/i);
      expect(mail.html).not.toMatch(/<link\b/i);
      expect(mail.html).not.toMatch(/background-image\s*:/i);
      // Le SEUL `src` admis est `cid:` — une image jointe au message. Toute autre
      // source (http, https, //, data:) se chargerait ou serait bloquée à l'ouverture.
      const sources = [...mail.html.matchAll(/\bsrc\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
      expect(sources.length).toBe((mail.html.match(/\bsrc\s*=/gi) ?? []).length);
      for (const src of sources) expect(src).toMatch(/^cid:[\w-]+$/);
    }
  });

  it('joint au message chaque image référencée par cid:, et le logo dans les trois', () => {
    for (const mail of ALL) {
      const cids = [...mail.html.matchAll(/src="cid:([\w-]+)"/g)].map((m) => m[1]);
      expect(cids).toContain('logo-lalanda');
      const jointes = (mail.inlineImages ?? []).map((i) => i.cid);
      for (const cid of cids) expect(jointes).toContain(cid);
      const logo = mail.inlineImages?.find((i) => i.cid === 'logo-lalanda');
      expect(logo?.contentType).toBe('image/png');
      // Signature PNG (\x89PNG) en base64 : le contenu est bien une image, pas vide.
      expect(logo?.contentBase64.startsWith('iVBORw0KGgo')).toBe(true);
      expect(mail.html).toMatch(/<img[^>]*\balt="Lalanda"/);
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

describe('facture normalisée désactivée (ADR-0021, décision n° 5)', () => {
  const input = {
    url: 'https://app.exemple.com/organisation/fiscalite',
    organizationName: 'Boulangerie du Fleuve',
    deactivatedAt: new Date('2026-10-20T09:00:00Z'),
    reason: 'Passage temporaire à un autre logiciel de facturation.',
    actorName: 'Aline',
  };

  it('dit quoi, pour quelle organisation, quand, par qui et pourquoi — HTML et texte', () => {
    const mail = renderNormalizedInvoicingDisabled(input);
    expect(mail.subject).toContain('facture normalisée désactivée');
    expect(mail.subject).toContain('Boulangerie du Fleuve');
    for (const corps of [mail.html, mail.text]) {
      expect(corps).toContain('Boulangerie du Fleuve');
      expect(corps).toContain('20 octobre 2026');
      expect(corps).toContain('Aline');
      expect(corps).toContain('Passage temporaire à un autre logiciel de facturation.');
    }
    expect(mail.text).toContain(input.url);
  });

  it("reste lisible sans nom d'acteur", () => {
    const mail = renderNormalizedInvoicingDisabled({ ...input, actorName: null });
    expect(mail.text).not.toContain(', par ');
  });

  it('échappe le motif et le nom d’organisation (saisies utilisateur)', () => {
    const mail = renderNormalizedInvoicingDisabled({
      ...input,
      organizationName: '<b>Org</b>',
      reason: '<img src=x onerror=alert(1)> motif suffisamment long',
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<b>Org</b>');
    expect(mail.html).toContain('&lt;img src=x');
  });
});

describe('alertes de normalisation (ADR-0024, décision ouverte n° 3)', () => {
  const base = {
    url: 'https://app.exemple.com/ventes/factures/abc',
    organizationName: 'Boulangerie du Fleuve',
    subjectLabel: 'PF2610-000042',
    since: new Date('2026-10-21T09:00:00Z'),
  };

  it('incertitude : quoi, depuis quand, et la consigne de ne pas remettre le document', () => {
    const mail = renderNormalizationAlert({ ...base, cause: 'normalization_uncertain' });
    expect(mail.subject).toBe('Lalanda — normalisation incertaine pour PF2610-000042');
    for (const corps of [mail.html, mail.text]) {
      expect(corps).toContain('Boulangerie du Fleuve');
      expect(corps).toContain('21 octobre 2026');
      expect(corps).toContain('ne doit pas être remis au client');
    }
    expect(mail.text).toContain(base.url);
  });

  it('numéro abandonné : le numéro et le trou tracé', () => {
    const mail = renderNormalizationAlert({
      ...base,
      cause: 'number_abandoned',
      number: 'TEST-IN2610-000007',
    });
    expect(mail.subject).toBe('Lalanda — numéro de facture abandonné (TEST-IN2610-000007)');
    expect(mail.text).toContain('TEST-IN2610-000007');
    expect(mail.text).toContain('trou dans la série');
  });

  it('jeton refusé ou expiré : le point de vente et la marche à suivre', () => {
    const refuse = renderNormalizationAlert({
      ...base,
      cause: 'token_rejected',
      subjectLabel: 'Boutique',
    });
    expect(refuse.subject).toBe('Lalanda — jeton e-MCF refusé par la DGI (Boutique)');
    const expire = renderNormalizationAlert({
      ...base,
      cause: 'token_expired',
      subjectLabel: 'Boutique',
    });
    expect(expire.subject).toBe('Lalanda — jeton e-MCF expiré (Boutique)');
    for (const mail of [refuse, expire]) {
      expect(mail.text).toContain('Fiscalité');
      expect(mail.text).toContain('Propriétaire ou Directeur financier');
    }
  });

  it('échappe le nom d’organisation et le libellé (saisies utilisateur)', () => {
    const mail = renderNormalizationAlert({
      ...base,
      cause: 'token_rejected',
      organizationName: '<b>Org</b>',
      subjectLabel: '<img src=x onerror=alert(1)>',
    });
    expect(mail.html).not.toContain('<b>Org</b>');
    expect(mail.html).not.toContain('<img src=x');
  });
});
