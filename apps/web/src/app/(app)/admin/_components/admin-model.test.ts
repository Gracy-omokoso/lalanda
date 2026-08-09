// Logique pure de l'espace admin plateforme (S21b).
//
// Deux propriétés dominent ce fichier, et elles ne sont pas de même nature :
//
//   - la première est une propriété de SÉCURITÉ : rien de ce module ne doit
//     pouvoir afficher plus que `last4`. Elle est testée en soumettant à chaque
//     fonction d'affichage une valeur sentinelle et en exigeant son absence du
//     rendu;
//   - les autres sont des propriétés d'INTERFACE : un statut juste, un message
//     de refus actionnable, une fenêtre de ré-authentification qui se ferme
//     avant plutôt qu'après.

import { describe, expect, it } from 'vitest';

import { PLATFORM_ROLES } from '@/lib/api';
import type {
  AdminUserSummary,
  IntegrationSecretView,
  IntegrationView,
  PlatformAuditEventView,
} from '@/lib/api';

import {
  ACTIONS_FILTRABLES,
  ADMIN_TABS,
  aideChamp,
  avertissementSource,
  codeErreur,
  empreinteSecret,
  exigeReauth,
  formaterDateHeure,
  formaterRestant,
  libelleAction,
  libelleChamp,
  libelleRole,
  libelleSource,
  MARGE_REAUTH_MS,
  messageErreur,
  metadonneesLisibles,
  motifSuspensionValide,
  offreDerogation,
  ongletsVisibles,
  raisonNonDesactivable,
  raisonNonRevocable,
  reauthRestantMs,
  reauthUtilisable,
  resumeDernierTest,
  secretsManquants,
  segmentActif,
  statutIntegration,
  statutErreur,
} from './admin-model';

// ── Fabriques ────────────────────────────────────────────────────────────────

function secret(over: Partial<IntegrationSecretView> = {}): IntegrationSecretView {
  return {
    configured: true,
    last4: '1234',
    updatedAt: '2026-08-01T10:00:00.000Z',
    updatedBy: 'user-1',
    source: 'db',
    ...over,
  };
}

function integration(over: Partial<IntegrationView> = {}): IntegrationView {
  return {
    provider: 'stripe',
    label: 'Stripe',
    enabled: true,
    config: {},
    secrets: { restrictedKey: secret(), webhookSecret: secret({ configured: false, last4: null }) },
    lastTest: {
      at: '2026-08-01T10:00:00.000Z',
      status: 'ok',
      detail: 'compte accessible',
      forced: false,
    },
    requiredSecrets: ['restrictedKey'],
    configFields: ['publishableKey', 'webhookEndpoint', 'accountCountry'],
    requiredConfig: [],
    testDescription: 'GET /v1/account — sans coût.',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  };
}

function erreurApi(code: string, status = 400): Error {
  const err = new Error('message technique du serveur') as Error & {
    status: number;
    detail: unknown;
  };
  err.status = status;
  err.detail = { code };
  return err;
}

// ── Propriété de sécurité ────────────────────────────────────────────────────

describe('aucune fonction d’affichage ne peut rendre une valeur en clair', () => {
  const SENTINELLE = 'VALEUR-EN-CLAIR-NE-DOIT-JAMAIS-SAPPARAITRE';

  it('empreinteSecret ne rend au plus que le suffixe', () => {
    // La vue de lecture ne PORTE pas la valeur — le contrat d'API l'interdit.
    // Ce test vérifie qu'aucune fonction ne la reconstituerait si un jour un
    // champ supplémentaire arrivait par erreur.
    const contamine = { ...secret(), valeur: SENTINELLE } as unknown as IntegrationSecretView;
    const rendu = empreinteSecret(contamine);
    expect(rendu).not.toContain(SENTINELLE);
    expect(rendu).toBe('•••• 1234');
  });

  it('les points de masquage ne révèlent pas la longueur réelle', () => {
    // Un masque proportionnel renseignerait sur le format de la clé.
    expect(empreinteSecret(secret({ last4: 'abcd' }))).toBe('•••• abcd');
    expect(empreinteSecret(secret({ last4: 'wxyz' }))).toBe('•••• wxyz');
  });

  it('un secret non configuré n’affiche aucun fragment', () => {
    expect(empreinteSecret(secret({ configured: false, last4: null }))).toBe('Non configuré');
    expect(empreinteSecret(undefined)).toBe('Non configuré');
  });

  it('un last4 nul (valeur trop courte) le dit sans inventer de fragment', () => {
    // ADR-0013 §4 : sous douze caractères, `last4` vaut `null` — « révéler 4
    // caractères d'un secret de 10 en divulgue 40 % ».
    expect(empreinteSecret(secret({ last4: null }))).toBe(
      'Enregistré (valeur trop courte pour un indice)',
    );
  });

  it('le résumé de test ne recopie que le detail assaini par le serveur', () => {
    const vue = integration({
      lastTest: {
        at: '2026-08-01T10:00:00.000Z',
        status: 'failed',
        detail: '[redacted]',
        forced: false,
      },
    });
    expect(resumeDernierTest(vue).detail).toBe('[redacted]');
  });
});

// ── Statut d'une intégration ─────────────────────────────────────────────────

describe('statutIntegration', () => {
  it('« Non configurée » quand aucun secret requis n’est présent', () => {
    const vue = integration({
      secrets: { restrictedKey: secret({ configured: false, last4: null }) },
      lastTest: null,
    });
    expect(statutIntegration(vue).cle).toBe('non_configuree');
  });

  it('« Incomplète » quand un secret requis manque parmi plusieurs', () => {
    const vue = integration({
      requiredSecrets: ['restrictedKey', 'webhookSecret'],
      secrets: {
        restrictedKey: secret(),
        webhookSecret: secret({ configured: false, last4: null }),
      },
    });
    const statut = statutIntegration(vue);
    expect(statut.cle).toBe('incomplete');
    expect(statut.explication).toContain('webhookSecret');
  });

  it('« Configurée, inactive » quand tout est là mais que le drapeau est baissé', () => {
    expect(statutIntegration(integration({ enabled: false })).cle).toBe('prete');
  });

  it('« Active » quand tout est là, activée, et le dernier test réussi', () => {
    expect(statutIntegration(integration()).cle).toBe('active');
  });

  it('« Dernier test en échec » l’emporte sur « Active »', () => {
    // Confondre « configurée » et « qui marche » ferait apparaître comme
    // opérationnelle une intégration dont la dernière vérification a échoué.
    const vue = integration({
      lastTest: {
        at: '2026-08-01T10:00:00.000Z',
        status: 'failed',
        detail: 'refusé',
        forced: false,
      },
    });
    const statut = statutIntegration(vue);
    expect(statut.cle).toBe('en_echec');
    expect(statut.ton).toBe('echec');
  });

  it('signale une dérogation dans l’explication de l’échec', () => {
    const vue = integration({
      lastTest: { at: '2026-08-01T10:00:00.000Z', status: 'failed', detail: '', forced: true },
    });
    expect(statutIntegration(vue).explication).toContain('dérogation');
  });

  it('une intégration servie par l’environnement n’est pas « incomplète »', () => {
    // `configured` est vrai dès qu'une source existe. Elle fonctionne : c'est la
    // colonne « Source » qui dit d'où elle vient, pas le statut.
    const vue = integration({
      provider: 'openai',
      requiredSecrets: ['apiKey'],
      secrets: { apiKey: secret({ source: 'env', last4: null }) },
      lastTest: null,
    });
    expect(secretsManquants(vue)).toEqual([]);
    expect(statutIntegration(vue).cle).toBe('active');
  });
});

describe('source de la valeur — garde-fou du chemin de migration', () => {
  it('nomme les deux sources et l’absence', () => {
    expect(libelleSource('db')).toBe('Coffre chiffré');
    expect(libelleSource('env')).toBe('Variable d’environnement');
    expect(libelleSource(null)).toBe('—');
  });

  it('avertit quand la valeur vient encore de l’environnement', () => {
    // Sans cet avertissement, « une variable d'environnement oubliée masque
    // silencieusement une clé pourtant rotée en base » (ADR-0013 option C).
    expect(avertissementSource(secret({ source: 'env' }))).toContain('environnement');
    expect(avertissementSource(secret({ source: 'db' }))).toBeNull();
    expect(avertissementSource(undefined)).toBeNull();
  });
});

// ── Refus ────────────────────────────────────────────────────────────────────

describe('traduction des refus', () => {
  it('extrait le code et le statut d’une erreur d’`api.ts`', () => {
    const err = erreurApi('REAUTH_REQUIRED', 401);
    expect(codeErreur(err)).toBe('REAUTH_REQUIRED');
    expect(statutErreur(err)).toBe(401);
    expect(codeErreur(new Error('brut'))).toBeNull();
    expect(codeErreur(null)).toBeNull();
  });

  it('traduit les codes connus en consignes actionnables', () => {
    expect(messageErreur(erreurApi('REAUTH_REQUIRED', 401), 'x')).toContain('mot de passe');
    expect(messageErreur(erreurApi('INTEGRATION_TEST_FAILED', 422), 'x')).toContain(
      'rien n’a été enregistré',
    );
    expect(messageErreur(erreurApi('VAULT_UNAVAILABLE'), 'x')).toContain('SECRETS_MASTER_KEY');
    expect(messageErreur(erreurApi('SELF_DEMOTION_FORBIDDEN'), 'x')).toContain(
      'super-administrateur',
    );
  });

  it('explique le quota d’écriture plutôt que d’afficher « 429 »', () => {
    const err = new Error('Too Many Requests') as Error & { status: number };
    err.status = 429;
    expect(messageErreur(err, 'x')).toContain('dix par heure');
  });

  it('retombe sur le message brut plutôt que sur un « erreur survenue » creux', () => {
    expect(messageErreur(erreurApi('CODE_JAMAIS_VU'), 'repli')).toBe(
      'message technique du serveur',
    );
    expect(messageErreur({}, 'repli')).toBe('repli');
  });

  it('reconnaît le refus qui doit rouvrir la ré-authentification', () => {
    expect(exigeReauth(erreurApi('REAUTH_REQUIRED', 401))).toBe(true);
    expect(exigeReauth(erreurApi('FORBIDDEN', 403))).toBe(false);
  });

  it('n’offre la dérogation QUE sur un échec de test de connexion', () => {
    // « Une dérogation tracée vaut mieux qu'un contrôle qu'on finit par retirer
    // parce qu'il bloque » — mais la proposer partout ferait du contournement le
    // geste normal.
    expect(offreDerogation(erreurApi('INTEGRATION_TEST_FAILED', 422))).toBe(true);
    expect(offreDerogation(erreurApi('VALIDATION_ERROR'))).toBe(false);
    expect(offreDerogation(erreurApi('REAUTH_REQUIRED', 401))).toBe(false);
  });
});

// ── Ré-authentification ──────────────────────────────────────────────────────

describe('fenêtre de ré-authentification (ADR-0013 §5)', () => {
  const MAINTENANT = Date.parse('2026-08-09T12:00:00.000Z');

  it('compte le temps restant, et jamais un négatif', () => {
    expect(reauthRestantMs('2026-08-09T12:05:00.000Z', MAINTENANT)).toBe(5 * 60_000);
    expect(reauthRestantMs('2026-08-09T11:00:00.000Z', MAINTENANT)).toBe(0);
    expect(reauthRestantMs(null, MAINTENANT)).toBe(0);
    expect(reauthRestantMs('pas-une-date', MAINTENANT)).toBe(0);
  });

  it('ferme la fenêtre AVANT son expiration réelle', () => {
    // Une fenêtre qui expire pendant la saisie produirait un 401 après coup,
    // c'est-à-dire au pire moment. La marge redemande le mot de passe un peu tôt.
    const dansDixSecondes = new Date(MAINTENANT + 10_000).toISOString();
    expect(reauthRestantMs(dansDixSecondes, MAINTENANT)).toBeGreaterThan(0);
    expect(reauthUtilisable(dansDixSecondes, MAINTENANT)).toBe(false);

    const bienApres = new Date(MAINTENANT + MARGE_REAUTH_MS + 1_000).toISOString();
    expect(reauthUtilisable(bienApres, MAINTENANT)).toBe(true);
  });

  it('formate le temps restant en secondes puis en minutes', () => {
    expect(formaterRestant(0)).toBe('expirée');
    expect(formaterRestant(-5)).toBe('expirée');
    expect(formaterRestant(45_000)).toBe('45 s');
    expect(formaterRestant(9 * 60_000)).toBe('9 min');
  });
});

// ── Dates ────────────────────────────────────────────────────────────────────

describe('formatage des dates', () => {
  it('ne montre jamais « Invalid Date »', () => {
    expect(formaterDateHeure(null)).toBe('—');
    expect(formaterDateHeure(undefined)).toBe('—');
    expect(formaterDateHeure('')).toBe('—');
    expect(formaterDateHeure('pas-une-date')).toBe('—');
  });

  it('rend une date valide', () => {
    expect(formaterDateHeure('2026-08-01T10:00:00.000Z')).toContain('2026');
  });
});

// ── Champs ───────────────────────────────────────────────────────────────────

describe('libellés et aides de champs', () => {
  it('traduit les noms connus', () => {
    expect(libelleChamp('restrictedKey')).toBe('Clé restreinte (rk_…)');
    expect(libelleChamp('bucketExports')).toBe('Bucket des exports');
  });

  it('retombe sur le nom technique plutôt que de masquer un champ', () => {
    // Un champ que l'API accepte doit rester saisissable même si personne n'a
    // pensé à le traduire.
    expect(libelleChamp('champInconnuDuFutur')).toBe('champInconnuDuFutur');
  });

  it('porte la recommandation Stripe là où elle change la nature de l’incident', () => {
    const aide = aideChamp('stripe', 'restrictedKey');
    expect(aide).toContain('rk_');
    expect(aide).toContain('Payouts');
  });

  it('dit explicitement ce qui est stocké EN CLAIR', () => {
    expect(aideChamp('stripe', 'publishableKey')).toContain('en clair');
    expect(aideChamp('s3', 'accessKey')).toContain('en clair');
    expect(aideChamp('paypal', 'clientId')).toContain('en clair');
  });

  it('renvoie null quand il n’y a rien de particulier à dire', () => {
    expect(aideChamp('openai', 'apiKey')).toBeNull();
  });
});

// ── Gouvernance ──────────────────────────────────────────────────────────────

describe('garde-fous de gouvernance', () => {
  const MOI: AdminUserSummary = {
    id: 'moi',
    email: 'moi@exemple.test',
    name: 'Moi',
    platformRoles: [
      { role: 'platform_super_admin', label: 'Super administrateur', expiresAt: null },
    ],
    organizationCount: 0,
    disabledAt: null,
    createdAt: null,
  };

  it('interdit l’auto-désactivation, et l’explique', () => {
    expect(raisonNonDesactivable(MOI, 'moi')).toContain('votre propre compte');
    expect(raisonNonDesactivable(MOI, 'quelquun-dautre')).toBeNull();
    expect(raisonNonDesactivable(MOI, null)).toBeNull();
  });

  it('interdit l’auto-rétrogradation du super-administrateur', () => {
    // « Se retirer soi-même peut laisser la plateforme sans aucun
    // super-administrateur, donc sans personne pour en nommer un. »
    expect(raisonNonRevocable(MOI, 'platform_super_admin', 'moi')).toContain(
      'super-administrateur',
    );
    expect(raisonNonRevocable(MOI, 'platform_admin', 'moi')).toBeNull();
    expect(raisonNonRevocable(MOI, 'platform_super_admin', 'autre')).toBeNull();
  });

  it('exige un motif de suspension d’au moins dix caractères', () => {
    expect(motifSuspensionValide('court')).toBe(false);
    expect(motifSuspensionValide('   court   ')).toBe(false);
    expect(motifSuspensionValide('impayés répétés depuis six mois')).toBe(true);
  });
});

// ── Journal ──────────────────────────────────────────────────────────────────

describe('journal d’audit plateforme', () => {
  it('traduit les actions en français lisible', () => {
    expect(libelleAction('integration.secret.updated')).toBe('Secret d’intégration remplacé');
    expect(libelleAction('platform_role.granted')).toBe('Rôle plateforme attribué');
  });

  it('retombe sur le code brut pour une action inconnue', () => {
    expect(libelleAction('quelque.chose.de.neuf')).toBe('quelque.chose.de.neuf');
  });

  it('propose au filtre toutes les actions du lot', () => {
    for (const action of [
      'integration.secret.updated',
      'integration.tested',
      'secret.rewrapped',
      'organization.suspended',
      'platform_role.revoked',
      'user.disabled',
    ]) {
      expect(ACTIONS_FILTRABLES).toContain(action);
    }
  });

  it('met en avant les deux suffixes et écarte le bruit', () => {
    // `last4Before` / `last4After` répondent à la seule question utile en
    // investigation. `ip` et `userAgent` sont longs, presque toujours identiques,
    // et les noieraient.
    const event: PlatformAuditEventView = {
      id: '1',
      action: 'integration.secret.updated',
      actorUserId: 'u1',
      actorRole: 'platform_super_admin',
      targetType: 'integration',
      targetId: 'stripe',
      metadata: {
        last4Before: 'abcd',
        last4After: 'wxyz',
        secretName: 'restrictedKey',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 …',
        vide: null,
      },
      createdAt: '2026-08-09T12:00:00.000Z',
    };

    const lignes = metadonneesLisibles(event);
    const cles = lignes.map((l) => l.cle);
    expect(cles).toContain('Ancien suffixe');
    expect(cles).toContain('Nouveau suffixe');
    expect(cles).not.toContain('ip');
    expect(cles).not.toContain('userAgent');
    // Une métadonnée nulle n'apparaît pas : une ligne « — » n'informe personne.
    expect(cles).not.toContain('vide');
  });
});

describe('navigation de l’espace admin', () => {
  const TOUT = { canManagePlatform: true, canManageIntegrations: true };
  const RIEN = { canManagePlatform: false, canManageIntegrations: false };

  it('propose les cinq onglets à qui gère les intégrations', () => {
    expect(ongletsVisibles(TOUT).map((t) => t.segment)).toEqual([
      '',
      'organisations',
      'utilisateurs',
      'integrations',
      'journal',
    ]);
  });

  it('masque le seul onglet dont l’ouverture révélerait quelque chose', () => {
    // Les autres onglets restent proposés : ils affichent un refus explicite,
    // ce qui vaut mieux qu'une navigation qui varie sans qu'on sache pourquoi.
    // Intégrations est l'exception — son contenu EST la liste des fournisseurs.
    const segments = ongletsVisibles(RIEN).map((t) => t.segment);
    expect(segments).not.toContain('integrations');
    expect(segments).toContain('journal');
  });

  it('n’ouvre jamais un onglet que le serveur n’a pas ouvert', () => {
    for (const tab of ADMIN_TABS) {
      if (tab.besoin === null) continue;
      expect(ongletsVisibles(RIEN)).not.toContainEqual(tab);
    }
  });

  it('garde l’onglet parent allumé sur une sous-page', () => {
    expect(segmentActif('/admin')).toBe('');
    expect(segmentActif('/admin/')).toBe('');
    expect(segmentActif('/admin/organisations')).toBe('organisations');
    expect(segmentActif('/admin/organisations/org_123')).toBe('organisations');
    expect(segmentActif('/admin/integrations')).toBe('integrations');
  });

  it('ne revendique rien hors de l’espace admin', () => {
    expect(segmentActif('/projects')).toBe('');
    // `/administration` n'est PAS `/admin` : le préfixe seul ne suffit pas.
    expect(segmentActif('/administration/xyz')).toBe('');
  });
});

describe('libellés des rôles plateforme', () => {
  it('traduit les six rôles, sans en oublier un', () => {
    // Un rôle sans libellé s'afficherait en clé technique dans le sélecteur
    // d'attribution — lisible par qui a écrit `permissions.ts`, par personne
    // d'autre. Le test échoue quand un septième rôle est ajouté côté API.
    for (const role of PLATFORM_ROLES) {
      expect(libelleRole(role)).not.toBe(role);
    }
  });

  it('retombe sur la clé technique plutôt que de masquer un rôle inconnu', () => {
    expect(libelleRole('platform_futur')).toBe('platform_futur');
  });
});
