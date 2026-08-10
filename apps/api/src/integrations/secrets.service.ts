// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLUTION DES SECRETS À L'USAGE — ADR-0013 §2 (déchiffrement) et option C
//
// `resolve()` est le SEUL point de l'application qui déchiffre. Aucune route HTTP
// ne l'appelle : ses appelants sont les fabriques de clients (client OpenAI,
// transport SMTP, client S3, client Stripe). Cette propriété est vérifiée par un
// test qui parcourt les contrôleurs.
//
// ── Ordre de résolution : base d'abord, environnement en secours ──────────────
//
// ADR-0013 rejette l'hybride permanent (option C) mais l'accepte « comme chemin
// de migration borné, et uniquement ainsi », à deux conditions que ce fichier
// tient :
//   1. la source effective (`db` | `env`) est affichée dans `/admin` — d'où
//      `sourceOf()`, consommé par la vue de lecture;
//   2. elle est journalisée au démarrage — d'où `logResolutionSources()`, appelé
//      au boot du module.
// Sans ces deux garde-fous, « une variable d'environnement oubliée masque
// silencieusement une clé pourtant rotée en base ».
// ─────────────────────────────────────────────────────────────────────────────

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Integration, type IntegrationDocument } from './integration.schema.js';
import { INTEGRATION_PROVIDERS, PROVIDER_SPECS, type IntegrationProvider } from './providers.js';
import { MASTER_KEYRING } from './keyring.provider.js';
import {
  decryptSecret,
  type EncryptedValue,
  type MasterKeyring,
  SecretKeyUnavailableError,
} from './secrets-crypto.js';
import type { Secret } from './secret-value.js';

/** D'où vient la valeur effectivement utilisée par le processus. */
export type SecretSource = 'db' | 'env';

export interface ResolvedSecret {
  secret: Secret;
  source: SecretSource;
}

/**
 * Durée de vie du cache mémoire (ADR-0013 §2 : « Cache mémoire de 60 s maximum,
 * invalidé à toute écriture »). Le plafond est court par choix : une clé rotée
 * doit prendre effet sans redéploiement, et une clé compromise doit cesser de
 * servir vite.
 */
export const SECRET_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  resolved: ResolvedSecret;
  expiresAt: number;
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(Integration.name) private readonly model: Model<IntegrationDocument>,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  /** Le coffre est-il utilisable ? `false` si `SECRETS_MASTER_KEY` est absente. */
  get vaultAvailable(): boolean {
    return this.keyring !== null;
  }

  /**
   * Valeur en clair d'un secret, ou `null` si aucune source ne le fournit.
   *
   * `null` signifie « non configuré » et rien d'autre. Un secret configuré mais
   * INDÉCHIFFRABLE ne renvoie pas `null` : il LÈVE (ADR-0013 §3, « jamais de
   * repli silencieux »). Confondre les deux transformerait une clé maîtresse
   * perdue en « intégration non configurée », et l'application repartirait
   * tranquillement sur son fallback sans que personne ne s'en aperçoive.
   */
  async resolve(provider: IntegrationProvider, name: string): Promise<ResolvedSecret | null> {
    const key = `${provider}:${name}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.resolved;

    const resolved = await this.resolveUncached(provider, name);
    if (resolved) {
      this.cache.set(key, { resolved, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
    } else {
      this.cache.delete(key);
    }
    return resolved;
  }

  private async resolveUncached(
    provider: IntegrationProvider,
    name: string,
  ): Promise<ResolvedSecret | null> {
    // Le document est lu AVANT de tester le coffre, et c'est délibéré (S22l) :
    // `enabled` est un interrupteur d'exploitation, il doit valoir même quand
    // `SECRETS_MASTER_KEY` est absente. Autrement, un déploiement sans coffre
    // ignorerait la désactivation et repartirait sur l'environnement — le
    // scénario où l'interrupteur ment le plus gravement, puisque personne ne
    // fait le lien entre une clé maîtresse manquante et une intégration qu'on
    // croyait coupée.
    const doc = await this.model.findOne({ provider, scope: 'platform' }).exec();

    // ── Interrupteur (S22l) ───────────────────────────────────────────────────
    //
    // Une intégration désactivée ne fournit RIEN, et ne retombe PAS sur
    // l'environnement. `/admin` annonce « Les secrets sont en place mais
    // l'intégration n'est pas activée » : jusqu'ici la résolution ignorait
    // `enabled` et servait la clé quand même, si bien que couper l'interrupteur
    // n'arrêtait aucun appel ni aucune facturation.
    //
    // Le refus du secours par l'environnement est le point important. ADR-0013
    // §C rejette l'hybride permanent pour une raison précise — « une variable
    // d'environnement oubliée masque silencieusement une clé pourtant rotée en
    // base » — et retomber sur `env` ici produirait exactement ce défaut :
    // l'opérateur coupe, les appels continuent depuis une variable qu'il ne
    // regarde pas. Un enregistrement présent et désactivé est une décision
    // explicite; l'absence d'enregistrement, elle, reste un amorçage et laisse
    // le secours jouer.
    if (doc && !doc.enabled) return null;

    if (this.keyring) {
      const record = doc?.secrets?.[name] as EncryptedValue | undefined;
      if (doc && record) {
        // L'exception remonte volontairement : `SECRET_KEY_UNAVAILABLE` et une
        // altération de chiffré doivent provoquer une panne bruyante.
        const secret = decryptSecret({
          location: { documentId: String(doc._id), provider, secretName: name },
          record,
          keyring: this.keyring,
        });
        return { secret, source: 'db' };
      }
    }

    const envVar = PROVIDER_SPECS[provider].envFallback[name];
    if (envVar) {
      const raw = process.env[envVar];
      if (raw) {
        const { Secret: SecretCtor } = await import('./secret-value.js');
        return { secret: new SecretCtor(raw), source: 'env' };
      }
    }
    return null;
  }

  /**
   * Source effective, SANS déchiffrer — alimente la vue de lecture d'`/admin`.
   *
   * Ne passe pas par `resolve()` : afficher une page d'administration ne doit
   * jamais faire circuler de valeur en clair, même dans un objet jeté aussitôt.
   */
  sourceOfRecord(
    provider: IntegrationProvider,
    name: string,
    hasDbRecord: boolean,
  ): SecretSource | null {
    if (hasDbRecord && this.keyring) return 'db';
    const envVar = PROVIDER_SPECS[provider].envFallback[name];
    if (envVar && process.env[envVar]) return 'env';
    return null;
  }

  /** Invalide le cache d'une intégration — appelé à CHAQUE écriture (ADR-0013 §2). */
  invalidate(provider: IntegrationProvider): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${provider}:`)) this.cache.delete(key);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Journalise la source effective de chaque secret au démarrage — second
   * garde-fou d'ADR-0013 option C.
   *
   * Ne journalise QUE le triplet (fournisseur, nom, source). Ni valeur, ni
   * `last4` : un journal de démarrage part souvent vers un agrégateur, et
   * ADR-0013 §10 rappelle qu'aucun agrégateur externe n'est aujourd'hui assaini.
   */
  async logResolutionSources(): Promise<void> {
    if (!this.keyring) {
      this.logger.warn(
        'SECRETS_MASTER_KEY absente : le coffre est indisponible, seules les variables ' +
          "d'environnement de secours sont utilisables (ADR-0013 §8).",
      );
    }
    const docs = await this.model.find({ scope: 'platform' }).exec();
    const byProvider = new Map(docs.map((d) => [d.provider, d]));
    for (const provider of INTEGRATION_PROVIDERS) {
      for (const name of PROVIDER_SPECS[provider].secrets) {
        const hasDb = Boolean(byProvider.get(provider)?.secrets?.[name]);
        const source = this.sourceOfRecord(provider, name, hasDb);
        this.logger.log(`intégration ${provider}.${name} — source : ${source ?? 'non configurée'}`);
      }
    }
  }

  /**
   * Secrets en clair déjà stockés pour un fournisseur — utilisé par le test de
   * connexion, qui a besoin des valeurs NON soumises dans la requête (tester
   * `stripe.webhookSecret` seul exige la `restrictedKey` déjà en base).
   *
   * Volontairement `Record<string,string>` et non `Secret` : ces valeurs partent
   * directement vers un testeur qui doit les mettre sur le réseau. L'enveloppe
   * protège des sérialisations accidentelles, pas des usages légitimes.
   */
  async plainSecretsOf(doc: IntegrationDocument | null): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!doc || !this.keyring) return out;
    for (const [name, record] of Object.entries(doc.secrets ?? {})) {
      try {
        out[name] = decryptSecret({
          location: { documentId: String(doc._id), provider: doc.provider, secretName: name },
          record: record as unknown as EncryptedValue,
          keyring: this.keyring,
        }).expose();
      } catch (err) {
        // Un secret indéchiffrable n'empêche pas de tester les autres, mais il est
        // signalé : c'est le symptôme d'une rotation inachevée.
        if (err instanceof SecretKeyUnavailableError) {
          this.logger.error(`${doc.provider}.${name} : ${err.message}`);
        } else {
          throw err;
        }
      }
    }
    return out;
  }
}
