// Fourniture du trousseau de clés maîtresses (ADR-0013 §3).
//
// Jeton d'injection dédié plutôt qu'une lecture de `process.env` dispersée dans
// les services : un seul endroit décode les clés, un seul endroit décide quoi
// faire quand elles manquent, et les tests injectent un trousseau de test sans
// toucher à l'environnement du process.

import { Logger, type Provider } from '@nestjs/common';

import { keyringFromEnv, type MasterKeyring } from './secrets-crypto.js';

export const MASTER_KEYRING = Symbol('MASTER_KEYRING');

/**
 * Trousseau construit depuis l'environnement, ou `null` si `SECRETS_MASTER_KEY`
 * est absente.
 *
 * Pourquoi `null` et non un refus de démarrer ICI : le refus de démarrer
 * appartient au schéma Zod de `packages/shared/src/env` (brief §9-4), qui
 * s'exécute AVANT Nest et produit un message d'erreur lisible. Refuser une
 * seconde fois dans un provider Nest transformerait un message clair en trace
 * d'injection de dépendances. Ce provider, lui, doit rester tolérant : les
 * suites de tests unitaires montent des modules sans coffre.
 *
 * Une clé PRÉSENTE mais MAL FORMÉE lève, en revanche, y compris en test : c'est
 * une erreur de configuration, pas une absence de configuration.
 */
export const MasterKeyringProvider: Provider = {
  provide: MASTER_KEYRING,
  useFactory: (): MasterKeyring | null => {
    const keyring = keyringFromEnv({
      SECRETS_MASTER_KEY: process.env['SECRETS_MASTER_KEY'],
      SECRETS_MASTER_KEY_ID: process.env['SECRETS_MASTER_KEY_ID'],
      SECRETS_MASTER_KEY_PREVIOUS: process.env['SECRETS_MASTER_KEY_PREVIOUS'],
      SECRETS_MASTER_KEY_PREVIOUS_ID: process.env['SECRETS_MASTER_KEY_PREVIOUS_ID'],
    });
    if (keyring && keyring.keyIds().length > 1) {
      new Logger('MasterKeyring').warn(
        `Rotation en cours : clés ${keyring.keyIds().join(', ')} au trousseau, ` +
          `courante « ${keyring.currentKeyId} ». Exécuter la migration secrets:rewrap ` +
          "puis retirer SECRETS_MASTER_KEY_PREVIOUS de l'environnement (ADR-0013 §3).",
      );
    }
    return keyring;
  },
};
