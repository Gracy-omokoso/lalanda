// Catalogue des intégrations — ADR-0013 §1.
//
// `providers.ts` annonce en tête que ses deux listes sont « DISJOINTES par
// construction (vérifié par `providers.test.ts`) ». Voici ce fichier.
//
// L'enjeu n'est pas cosmétique : la frontière `secrets` / `config` décide de ce
// qui est chiffré et de ce qui est stocké EN CLAIR. Une clé rangée des deux côtés,
// ou déplacée un jour de `secrets` vers `config` par inadvertance, serait
// persistée en clair sans que rien ne le signale — l'écriture réussirait, la vue
// de lecture l'afficherait, et le secret serait dans le prochain `mongodump`.

import { describe, expect, it } from 'vitest';

import {
  INTEGRATION_PROVIDERS,
  isIntegrationProvider,
  isKnownConfigKey,
  isKnownSecretName,
  LEGACY_PROVIDER_RENAMES,
  PROVIDER_SPECS,
  type IntegrationProvider,
} from './providers.js';

describe('le catalogue des fournisseurs', () => {
  it('est exactement celui du code — ADR-0013 augmenté de R2, ElevenLabs et ZeptoMail', () => {
    // ADR-0013 § Contexte en nommait cinq. Trois évolutions depuis : `s3` est
    // devenu `r2` (même protocole, fournisseur cible différent), `elevenlabs`
    // est ajouté, et `zeptomail` l'est par ADR-0014. La liste reste ÉNUMÉRÉE en
    // dur : c'est ce qui fait rougir le test le jour où un fournisseur est
    // ajouté sans que la décision soit prise. Toute ligne ajoutée doit pointer
    // son ADR — un fournisseur qui apparaît sans ADR apparaît aussi dans
    // `/admin`, avec un champ de saisie de secret que personne n'a arbitré.
    expect([...INTEGRATION_PROVIDERS]).toEqual([
      // ADR-0013 § Contexte — les cinq d'origine, `s3` renommé `r2`.
      'openai',
      'stripe',
      'paypal',
      'smtp',
      'r2',
      'elevenlabs',
      // ADR-0014 — chemin d'envoi préféré, SMTP conservé en repli.
      'zeptomail',
    ]);
  });

  it('ne propose plus `s3` — il ne survit que comme ancien nom à migrer', () => {
    // `s3` retiré du catalogue mais déclaré dans `LEGACY_PROVIDER_RENAMES` : un
    // déploiement en cours d'exploitation porte encore un document `provider:
    // 's3'`, et la migration doit savoir quoi chercher. L'y laisser ferait
    // apparaître dans /admin un fournisseur fantôme.
    expect(isIntegrationProvider('s3')).toBe(false);
    expect(LEGACY_PROVIDER_RENAMES['s3']).toBe('r2');
  });

  it('ne renomme jamais vers un fournisseur absent du catalogue', () => {
    // Une cible erronée produirait, après migration, un document que le service
    // refuserait de relire — panne découverte au premier chargement d'/admin.
    for (const [ancien, cible] of Object.entries(LEGACY_PROVIDER_RENAMES)) {
      expect(isIntegrationProvider(cible), `${ancien} → ${cible}`).toBe(true);
      expect(isIntegrationProvider(ancien), `${ancien} est encore actif`).toBe(false);
    }
  });

  it('ont tous une spécification complète', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const spec = PROVIDER_SPECS[provider];
      expect(spec, provider).toBeDefined();
      expect(spec.label.length, `${provider} : libellé vide`).toBeGreaterThan(0);
      expect(spec.secrets.length, `${provider} : aucun secret déclaré`).toBeGreaterThan(0);
      expect(
        spec.testDescription.length,
        `${provider} : le bouton « Tester » doit annoncer ce qu'il fait`,
      ).toBeGreaterThan(0);
    }
  });

  it('reconnaît ses fournisseurs et refuse le reste', () => {
    for (const provider of INTEGRATION_PROVIDERS)
      expect(isIntegrationProvider(provider)).toBe(true);
    for (const intrus of ['OPENAI', 'twilio', '', '__proto__', null, 42, undefined]) {
      expect(isIntegrationProvider(intrus), String(intrus)).toBe(false);
    }
  });
});

describe('la frontière secret / config est étanche', () => {
  it('aucun nom n’apparaît à la fois dans `secrets` et dans `config`', () => {
    // Le cas qui rendrait tout le dispositif inutile : un nom des deux côtés
    // permettrait d'écrire la valeur en clair par le chemin `config`.
    for (const provider of INTEGRATION_PROVIDERS) {
      const spec = PROVIDER_SPECS[provider];
      const collision = spec.secrets.filter((nom) => spec.config.includes(nom));
      expect(collision, `${provider} : « ${collision.join(', ')} » déclaré des deux côtés`).toEqual(
        [],
      );
    }
  });

  it('les listes ne comportent pas de doublon interne', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const spec = PROVIDER_SPECS[provider];
      expect(new Set(spec.secrets).size, `${provider}.secrets`).toBe(spec.secrets.length);
      expect(new Set(spec.config).size, `${provider}.config`).toBe(spec.config.length);
    }
  });

  it('`requiredSecrets` et `requiredConfig` sont des sous-ensembles de leurs listes', () => {
    // Un requis absent de la liste blanche serait impossible à saisir : le
    // formulaire exigerait une valeur que l'API refuserait en 400.
    for (const provider of INTEGRATION_PROVIDERS) {
      const spec = PROVIDER_SPECS[provider];
      for (const nom of spec.requiredSecrets) {
        expect(spec.secrets, `${provider} : requiredSecrets « ${nom} »`).toContain(nom);
      }
      for (const cle of spec.requiredConfig) {
        expect(spec.config, `${provider} : requiredConfig « ${cle} »`).toContain(cle);
      }
    }
  });

  it('les prédicats de liste blanche suivent les spécifications', () => {
    expect(isKnownSecretName('stripe', 'restrictedKey')).toBe(true);
    expect(isKnownSecretName('stripe', 'publishableKey')).toBe(false);
    expect(isKnownConfigKey('stripe', 'publishableKey')).toBe(true);
    expect(isKnownConfigKey('stripe', 'restrictedKey')).toBe(false);
  });
});

describe('les arbitrages nommés par ADR-0013 sont bien ceux du code', () => {
  it('Stripe expose `restrictedKey`, jamais `secretKey` (ADR-0013 §7)', () => {
    // « Le nom du champ porte la recommandation : on ne peut pas enregistrer une
    // `sk_…` par défaut sans remarquer qu'on la range dans un emplacement nommé
    // clé restreinte. »
    expect(PROVIDER_SPECS.stripe.secrets).toContain('restrictedKey');
    expect(PROVIDER_SPECS.stripe.secrets).not.toContain('secretKey');
  });

  it('la clé publiable Stripe est en clair — elle est publique par conception', () => {
    expect(PROVIDER_SPECS.stripe.config).toContain('publishableKey');
  });

  it('le secret de signature des webhooks est un secret à part entière', () => {
    expect(PROVIDER_SPECS.stripe.secrets).toContain('webhookSecret');
  });

  it('R2 range `accessKey` en config et `secretKey` en secret', () => {
    // « `accessKey` est un IDENTIFIANT, publiable au même titre qu'un nom
    // d'utilisateur — seule la `secretKey` ouvre quoi que ce soit. »
    expect(PROVIDER_SPECS.r2.config).toContain('accessKey');
    expect(PROVIDER_SPECS.r2.secrets).toContain('secretKey');
  });

  it('ElevenLabs range `apiKey` en secret et ne déclare aucun champ d’usage', () => {
    // Le périmètre est la CONFIGURATION, pas l'usage : ni `voiceId` ni `modelId`,
    // qui préjugeraient d'une décision produit non prise.
    expect(PROVIDER_SPECS.elevenlabs.secrets).toContain('apiKey');
    expect(PROVIDER_SPECS.elevenlabs.config).toEqual(['baseUrl']);
  });

  it('PayPal range `clientId` en config et `clientSecret` en secret', () => {
    // Le piège inverse : `clientId` ressemble à un secret et n'en est pas un.
    expect(PROVIDER_SPECS.paypal.config).toContain('clientId');
    expect(PROVIDER_SPECS.paypal.secrets).toContain('clientSecret');
  });

  it('SMTP range `user` en config et `password` en secret', () => {
    expect(PROVIDER_SPECS.smtp.config).toContain('user');
    expect(PROVIDER_SPECS.smtp.secrets).toContain('password');
  });

  it('ZeptoMail n’expose QUE son jeton d’envoi, et rien en clair (ADR-0014)', () => {
    // Le jeton « Send Mail Token » vaut le droit d'écrire depuis le domaine :
    // c'est un secret entier, jamais une moitié publiable comme `s3.accessKey`.
    expect(PROVIDER_SPECS.zeptomail.secrets).toEqual(['sendMailToken']);
    // `config` VIDE est l'arbitrage, pas un manque : l'adresse d'expédition
    // (`SMTP_FROM`) et le point d'entrée régional (`ZEPTOMAIL_API_URL`) sont des
    // réglages d'environnement, et les redéclarer ici donnerait deux sources de
    // vérité à une même valeur — dont une seule serait lue par le transport.
    expect(PROVIDER_SPECS.zeptomail.config).toEqual([]);
  });
});

describe('les variables de secours restent bornées — ADR-0013 option C', () => {
  /** Les SEULS secrets qui transitaient déjà par l'environnement avant S21b. */
  const SECOURS_AUTORISES: Partial<Record<IntegrationProvider, Record<string, string>>> = {
    openai: { apiKey: 'OPENAI_API_KEY' },
    // Le NOM de la variable reste `S3_SECRET_KEY` sous le fournisseur `r2` : elle
    // nomme le PROTOCOLE, elle est déjà posée en production et lue par le service
    // MinIO de `docker-compose.prod.yml`. La renommer couperait le secours au
    // premier déploiement.
    r2: { secretKey: 'S3_SECRET_KEY' },
  };

  it('seuls OpenAI et R2 ont un secours, et exactement celui-là', () => {
    // « Y ajouter une entrée serait recréer l'hybride permanent que l'ADR rejette. »
    // Ce test est donc un verrou d'architecture, pas une vérification de valeur :
    // il rougit le jour où quelqu'un branche Stripe sur une variable
    // d'environnement « juste pour la mise en production ».
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(PROVIDER_SPECS[provider].envFallback, provider).toEqual(
        SECOURS_AUTORISES[provider] ?? {},
      );
    }
  });

  it('tout secours porte sur un nom de secret réellement déclaré', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      for (const nom of Object.keys(PROVIDER_SPECS[provider].envFallback)) {
        expect(PROVIDER_SPECS[provider].secrets, `${provider}.${nom}`).toContain(nom);
      }
    }
  });
});
