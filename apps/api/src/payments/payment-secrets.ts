// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLUTION DES SECRETS DE PAIEMENT (S22b)
//
// ADR-0013 tranche la cible : les secrets d'intégration vivent CHIFFRÉS en base,
// éditables depuis `/admin`, résolus par `SecretsService.resolve(provider, name)`
// avec un repli borné sur l'environnement pendant la migration.
//
// `apps/api/src/integrations/` n'existe pas encore — un autre développeur le
// livre. Attendre serait un blocage inutile : ce fichier déclare le CONTRAT
// attendu (`PaymentSecretsResolver`) et fournit l'implémentation de repli
// (environnement). Quand `SecretsService` arrive, il suffit de le lier au jeton
// `PAYMENT_SECRETS` dans un module — aucun fournisseur de paiement ne change.
//
// Le contrat est délibérément plus étroit que `SecretsService` : `resolve` et
// rien d'autre. Un fournisseur de paiement n'a aucune raison de LISTER les
// secrets, encore moins de les écrire.
//
// ── La règle qui compte ──────────────────────────────────────────────────────
//
// Une valeur absente renvoie `null`. JAMAIS une chaîne vide, jamais une valeur
// par défaut, jamais une clé de test codée en dur. Un fournisseur sans clé doit
// être INDISPONIBLE et le dire ; un fournisseur qui démarre avec une clé bidon
// échoue au premier client, en production, sur de l'argent réel.
// ─────────────────────────────────────────────────────────────────────────────

import type { PaymentProviderId } from './payment-provider.js';

/** Jeton d'injection Nest — voir `payments.module.ts`. */
export const PAYMENT_SECRETS = Symbol('PAYMENT_SECRETS');

/** D'où vient effectivement la valeur (ADR-0013 §C : la source est visible). */
export type SecretSource = 'db' | 'env';

export interface ResolvedSecret {
  value: string;
  source: SecretSource;
}

/**
 * Contrat attendu de `IntegrationsService`/`SecretsService` (ADR-0013 §2).
 *
 * Volontairement `Promise`-based même pour l'implémentation environnement :
 * la lecture en base est asynchrone, et une signature synchrone obligerait à
 * tout réécrire le jour de la bascule.
 */
export interface PaymentSecretsResolver {
  /**
   * Valeur d'un secret, ou `null` s'il n'est configuré nulle part.
   * `name` suit le nommage d'ADR-0013 §4 (`restrictedKey`, `webhookSecret`, …).
   */
  resolve(provider: PaymentProviderId, name: string): Promise<ResolvedSecret | null>;
}

/**
 * Noms de secrets attendus par fournisseur.
 *
 * Déclarés ici et pas dans chaque fournisseur : c'est la liste que
 * `/admin/integrations` devra proposer à la saisie, et celle que l'API renvoie
 * dans `missingSecrets` quand un moyen de paiement est indisponible. Une seule
 * source évite qu'un formulaire d'administration demande `stripeSecret` quand
 * le code lit `restrictedKey`.
 */
export const REQUIRED_SECRETS: Readonly<Record<PaymentProviderId, readonly string[]>> = {
  // `restrictedKey` et non `secretKey` : ADR-0013 §4 montre `rk_…` en exemple, et
  // une clé restreinte limitée à Checkout + Billing suffit ici. Une clé secrète
  // complète donnerait à ce processus le droit de créer des remboursements.
  stripe: ['restrictedKey', 'webhookSecret'],
  // PayPal vérifie ses rappels par APPEL SERVEUR (voir `paypal.provider.ts`) :
  // il faut donc les identifiants OAuth ET l'identifiant du webhook enregistré.
  paypal: ['clientId', 'clientSecret', 'webhookId'],
  // `manual` n'a aucun secret : il n'appelle personne et ne reçoit aucun rappel.
  manual: [],
};

/**
 * Variables d'environnement de repli, par (fournisseur, secret).
 *
 * Le nommage `LALANDA_` n'est pas décoratif : ces variables ne sont PAS celles
 * qu'un SDK lirait tout seul (`STRIPE_SECRET_KEY`). Un préfixe explicite évite
 * qu'une bibliothèque tierce ramasse une clé de production sans qu'on l'ait
 * décidé, et rend une fuite dans un `printenv` immédiatement attribuable.
 */
export const ENV_FALLBACK: Readonly<Record<PaymentProviderId, Readonly<Record<string, string>>>> = {
  stripe: {
    restrictedKey: 'LALANDA_STRIPE_RESTRICTED_KEY',
    webhookSecret: 'LALANDA_STRIPE_WEBHOOK_SECRET',
    priceIdProMonth: 'LALANDA_STRIPE_PRICE_PRO_MONTH',
    priceIdProYear: 'LALANDA_STRIPE_PRICE_PRO_YEAR',
    priceIdBusinessMonth: 'LALANDA_STRIPE_PRICE_BUSINESS_MONTH',
  },
  paypal: {
    clientId: 'LALANDA_PAYPAL_CLIENT_ID',
    clientSecret: 'LALANDA_PAYPAL_CLIENT_SECRET',
    webhookId: 'LALANDA_PAYPAL_WEBHOOK_ID',
    environment: 'LALANDA_PAYPAL_ENVIRONMENT',
    // PayPal n'accepte PAS de tarif défini à la volée pour un abonnement : il
    // exige un `plan_id` créé au préalable dans le catalogue du marchand. Ces
    // identifiants ne peuvent donc pas être déduits de `pricing-catalog.ts` —
    // c'est la limite structurelle qui rend PayPal inutilisable sans compte.
    planIdProMonth: 'LALANDA_PAYPAL_PLAN_PRO_MONTH',
    planIdProYear: 'LALANDA_PAYPAL_PLAN_PRO_YEAR',
    planIdBusinessMonth: 'LALANDA_PAYPAL_PLAN_BUSINESS_MONTH',
  },
  manual: {
    /** Coordonnées de dépôt affichées au client, format `Libellé|Valeur;…`. */
    accounts: 'LALANDA_MANUAL_PAYMENT_ACCOUNTS',
  },
};

/**
 * Implémentation de repli : lecture de l'environnement, sans cache.
 *
 * Pas de cache parce qu'il n'y a rien à mettre en cache — `process.env` est déjà
 * en mémoire. Le cache de 60 s d'ADR-0013 §2 concerne la lecture EN BASE, qui
 * n'a pas lieu ici.
 */
export class EnvPaymentSecrets implements PaymentSecretsResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(provider: PaymentProviderId, name: string): Promise<ResolvedSecret | null> {
    const variable = ENV_FALLBACK[provider][name];
    if (!variable) return null;
    const raw = this.env[variable];
    // Une chaîne vide ou faite d'espaces vaut « non configuré ». C'est le cas
    // réel d'une variable déclarée mais laissée vide dans un `.env` d'exemple :
    // la traiter comme une clé produirait un 401 fournisseur incompréhensible.
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    return { value: raw.trim(), source: 'env' };
  }
}

/**
 * Compose la résolution d'ADR-0013 §C : base d'abord, environnement en secours.
 *
 * À utiliser le jour où `SecretsService` existe :
 * `new LayeredPaymentSecrets(secretsService, new EnvPaymentSecrets())`.
 * Écrit maintenant plutôt que plus tard pour que la bascule soit une ligne de
 * module et non une reprise de tous les fournisseurs.
 */
export class LayeredPaymentSecrets implements PaymentSecretsResolver {
  constructor(
    private readonly primary: PaymentSecretsResolver,
    private readonly fallback: PaymentSecretsResolver,
  ) {}

  async resolve(provider: PaymentProviderId, name: string): Promise<ResolvedSecret | null> {
    const fromPrimary = await this.primary.resolve(provider, name);
    if (fromPrimary) return fromPrimary;
    return this.fallback.resolve(provider, name);
  }
}

/**
 * Récupère plusieurs secrets et signale ceux qui manquent, en un passage.
 *
 * Renvoie la LISTE des manquants plutôt que de s'arrêter au premier : une
 * exploitante qui configure Stripe veut savoir d'un coup qu'il lui manque la clé
 * ET le secret de rappel, pas les découvrir l'un après l'autre.
 */
export async function resolveAll(
  secrets: PaymentSecretsResolver,
  provider: PaymentProviderId,
  names: readonly string[],
): Promise<{ values: Record<string, string>; missing: string[]; source: SecretSource | null }> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  let source: SecretSource | null = null;

  for (const name of names) {
    const resolved = await secrets.resolve(provider, name);
    if (!resolved) {
      missing.push(name);
      continue;
    }
    values[name] = resolved.value;
    // La source rapportée est celle du PREMIER secret trouvé. Un mélange
    // base/environnement sur un même fournisseur est un état transitoire
    // anormal ; ADR-0013 §C exige qu'il soit visible, `/admin` le détaillera
    // secret par secret. Ici, une valeur suffit à l'affichage de disponibilité.
    source ??= resolved.source;
  }

  return { values, missing, source };
}

/**
 * Devine le mode d'une clé Stripe à partir de son préfixe.
 * Utilisé UNIQUEMENT pour l'affichage d'exploitation — jamais pour décider
 * d'un comportement. Aucun fragment de la clé n'est renvoyé.
 */
export function stripeKeyMode(key: string): 'live' | 'test' {
  return key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test';
}
